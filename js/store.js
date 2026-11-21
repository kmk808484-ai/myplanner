(function (global) {
  'use strict';

  const DB_KEY = 'brainOS_v6_DB';
  const LEGACY_DB_KEY = 'brainOS_DB';
  const SETTINGS_KEY = 'brainOS_api_settings';
  const CHAT_KEY = 'brainOS_chat_history';
  const THEME_KEY = 'brainOS_theme';
  const SYNC_META_KEY = 'brainOS_sync_meta';

  function createDefaultData() {
    return {
      id: 'root',
      name: '내 세컨드 브레인',
      type: 'folder',
      icon: '🧠',
      children: [
        {
          id: 'welcome-folder',
          name: '시작 가이드',
          type: 'folder',
          icon: '📁',
          children: [
            {
              id: 'welcome-note',
              type: 'doc',
              name: 'Second Brain OS 사용법',
              icon: '✨',
              tag: '#가이드 #MultiAI',
              link: '',
              summary:
                '## 환영합니다!\n\n' +
                '이 앱은 **GitHub Pages**에서 바로 실행되는 **Multi-AI 세컨드 브레인**입니다.\n\n' +
                '### 주요 기능\n' +
                '- **탐색기**: 폴더 생성, 드래그 이동, `Ctrl+C / X / V / Z`, 우클릭 메뉴\n' +
                '- **파일 드롭**: `.md`, `.txt`, `.json` 파일을 중앙에 끌어다 놓으면 본문이 자동 입력됩니다.\n' +
                '- **4대 AI API 지원**: 상단 **⚙️ API 설정**에서 **Gemini · OpenAI · Anthropic(Claude) · Grok(xAI)** 키를 등록하세요.\n' +
                '- **컨텍스트 대화**: 우측 **🤖 AI 대화** 탭에서 `📎 현재 메모` 또는 `📂 현재 폴더`를 첨부해 내 지식 기반으로 질문하세요.\n' +
                '- **답변 저장**: AI의 좋은 답변은 `💾 메모로 저장` 버튼으로 현재 폴더에 바로 보관할 수 있습니다.'
            }
          ]
        }
      ]
    };
  }

  function loadFileSystem() {
    try {
      const saved = localStorage.getItem(DB_KEY);
      if (saved) return JSON.parse(saved);
      // v4/v5 데이터 자동 마이그레이션
      const legacy = localStorage.getItem(LEGACY_DB_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        localStorage.setItem(DB_KEY, JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) {
      console.error('DB 로드 오류:', e);
    }
    return createDefaultData();
  }

  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCuCNfM7l1aInsq_KCFWKQmoyME2tJXCZU',
    authDomain: 'gen-lang-client-0519883143.firebaseapp.com',
    projectId: 'gen-lang-client-0519883143',
    storageBucket: 'gen-lang-client-0519883143.firebasestorage.app',
    messagingSenderId: '845419336299',
    appId: '1:845419336299:web:0909e669b1713c052cd72e'
  };

  function loadSettings() {
    const defaults = {
      keys: { gemini: '', openai: '', anthropic: '', grok: '' },
      customModels: { gemini: '', openai: '', anthropic: '', grok: '' },
      lastProvider: 'gemini',
      lastModel: '',
      localBridgeUrl: 'http://127.0.0.1:4820',
      firebaseConfig: { ...DEFAULT_FIREBASE_CONFIG },
      ownerEmail: ''
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const savedFb = parsed.firebaseConfig || {};
      const mergedFb = {
        apiKey: String(savedFb.apiKey || '').trim() || DEFAULT_FIREBASE_CONFIG.apiKey,
        authDomain: String(savedFb.authDomain || '').trim() || DEFAULT_FIREBASE_CONFIG.authDomain,
        projectId: String(savedFb.projectId || '').trim() || DEFAULT_FIREBASE_CONFIG.projectId,
        storageBucket: String(savedFb.storageBucket || '').trim() || DEFAULT_FIREBASE_CONFIG.storageBucket,
        messagingSenderId: String(savedFb.messagingSenderId || '').trim() || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
        appId: String(savedFb.appId || '').trim() || DEFAULT_FIREBASE_CONFIG.appId
      };
      return {
        ...defaults,
        ...parsed,
        keys: { ...defaults.keys, ...(parsed.keys || {}) },
        customModels: { ...defaults.customModels, ...(parsed.customModels || {}) },
        firebaseConfig: mergedFb
      };
    } catch (e) {
      return defaults;
    }
  }

  function loadChatHistory() {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function loadSyncMeta() {
    const hasExistingDb = Boolean(localStorage.getItem(DB_KEY) || localStorage.getItem(LEGACY_DB_KEY));
    const defaults = {
      updatedAt: hasExistingDb ? Date.now() : 0,
      lastSyncedAt: 0,
      driveDbFileId: '',
      hasUserEdits: hasExistingDb
    };
    try {
      const raw = localStorage.getItem(SYNC_META_KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      return defaults;
    }
  }

  let syncMeta = loadSyncMeta();

  function getSyncMeta() {
    return { ...syncMeta };
  }

  function setSyncMeta(patch) {
    syncMeta = { ...syncMeta, ...(patch || {}) };
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
    } catch (_) {}
    return { ...syncMeta };
  }

  const state = {
    fileSystem: loadFileSystem(),
    currentFolder: null,
    selectedItem: null,
    undoStack: [],
    clipboard: null,
    settings: loadSettings(),
    chatHistory: loadChatHistory(),
    attachedContextIds: []
  };
  state.currentFolder = state.fileSystem;

  function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function regenerateIds(node) {
    node.id = genId();
    if (node.children) node.children.forEach(regenerateIds);
  }

  function persistFS(options = {}) {
    localStorage.setItem(DB_KEY, JSON.stringify(state.fileSystem));
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function persistSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function persistChat(options = {}) {
    localStorage.setItem(CHAT_KEY, JSON.stringify(state.chatHistory.slice(-60)));
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function saveStateForUndo() {
    state.undoStack.push(JSON.stringify(state.fileSystem));
    if (state.undoStack.length > 30) state.undoStack.shift();
  }

  function findNodeAndParent(id, currentNode = state.fileSystem, parent = null) {
    if (!currentNode) return null;
    if (currentNode.id === id) return { node: currentNode, parent };
    if (currentNode.children) {
      for (const child of currentNode.children) {
        const res = findNodeAndParent(id, child, currentNode);
        if (res) return res;
      }
    }
    return null;
  }

  function isDescendant(ancestorId, targetId) {
    const found = findNodeAndParent(ancestorId);
    if (!found) return false;
    return Boolean(findNodeAndParent(targetId, found.node));
  }

  function getPathToNode(targetId, currentNode = state.fileSystem, path = []) {
    const nextPath = [...path, currentNode];
    if (currentNode.id === targetId) return nextPath;
    if (currentNode.children) {
      for (const child of currentNode.children) {
        const res = getPathToNode(targetId, child, nextPath);
        if (res) return res;
      }
    }
    return null;
  }

  function searchNodes(query, currentNode = state.fileSystem, results = []) {
    const q = query.trim().toLowerCase();
    if (!q) return results;
    if (currentNode.id !== 'root') {
      const hay = `${currentNode.name || ''} ${currentNode.tag || ''} ${currentNode.summary || ''}`.toLowerCase();
      if (hay.includes(q)) results.push(currentNode);
    }
    if (currentNode.children) {
      currentNode.children.forEach((c) => searchNodes(q, c, results));
    }
    return results;
  }

  function collectDocsInFolder(folder, docs = []) {
    if (!folder || !folder.children) return docs;
    for (const child of folder.children) {
      if (child.type === 'doc') docs.push(child);
      else if (child.type === 'folder') collectDocsInFolder(child, docs);
    }
    return docs;
  }

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
  }

  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  global.BrainStore = {
    DEFAULT_FIREBASE_CONFIG,
    state,
    genId,
    regenerateIds,
    persistFS,
    persistSettings,
    persistChat,
    getSyncMeta,
    setSyncMeta,
    saveStateForUndo,
    findNodeAndParent,
    isDescendant,
    getPathToNode,
    searchNodes,
    collectDocsInFolder,
    getTheme,
    setTheme
  };
})(window);
