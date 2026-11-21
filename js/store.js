(function (global) {
  'use strict';

  const LEGACY_V6_DB_KEY = 'brainOS_v6_DB';
  const LEGACY_DB_KEY = 'brainOS_DB';
  const LEGACY_CHAT_KEY = 'brainOS_chat_history';
  const LEGACY_CLAIMED_KEY = 'brainOS_legacy_claimed_by';
  const SETTINGS_KEY = 'brainOS_api_settings';
  const THEME_KEY = 'brainOS_theme';

  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCuCNfM7l1aInsq_KCFWKQmoyME2tJXCZU',
    authDomain: 'gen-lang-client-0519883143.firebaseapp.com',
    projectId: 'gen-lang-client-0519883143',
    storageBucket: 'gen-lang-client-0519883143.firebasestorage.app',
    messagingSenderId: '845419336299',
    appId: '1:845419336299:web:0909e669b1713c052cd72e'
  };

  let activeUserEmail = '';

  function createLockedPlaceholderFS() {
    return {
      id: 'root',
      name: '잠김',
      type: 'folder',
      icon: '🔒',
      children: []
    };
  }

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
              name: 'Second Brain OS 사용법.md',
              icon: '✨',
              tag: '#가이드 #MD #MultiAI',
              link: '',
              summary:
                '## 환영합니다!\n\n' +
                '이 앱은 **Google Drive 자동 동기화**와 **Multi-AI**를 지원하는 개인 지식 OS입니다.\n\n' +
                '### 주요 기능\n' +
                '- **탐색기**: 폴더 생성, 드래그 이동, `F2`(이름 바꾸기), `Ctrl+C / X / V / Z`, 우클릭 메뉴\n' +
                '- **내장 MD 뷰어**: `.md` 파일을 더블클릭하면 이동·크기조절·최소화가 가능한 전용 마크다운 창이 열립니다.\n' +
                '- **파일 업로드**: 이미지, PDF, PPT, Word, Excel, HTML, MD 파일을 끌어다 놓으면 내 구글 드라이브(`SecondBrainOS`)에 자동 동기화됩니다.\n' +
                '- **4대 AI API 지원**: 상단 **⚙️ API 설정**에서 **Gemini · OpenAI · Claude · Grok** 키를 등록하세요.'
            }
          ]
        }
      ]
    };
  }

  function getUserKeys(email) {
    const clean = String(email || '').trim().toLowerCase();
    const prefix = `brainOS_u_${encodeURIComponent(clean)}_`;
    return {
      db: `${prefix}DB`,
      chat: `${prefix}chat`,
      syncMeta: `${prefix}sync_meta`
    };
  }

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

  let syncMeta = {
    updatedAt: 0,
    lastSyncedAt: 0,
    driveDbFileId: '',
    hasUserEdits: false
  };

  const state = {
    fileSystem: createLockedPlaceholderFS(),
    currentFolder: null,
    selectedItem: null,
    undoStack: [],
    clipboard: null,
    settings: loadSettings(),
    chatHistory: [],
    attachedContextIds: []
  };
  state.currentFolder = state.fileSystem;

  function getActiveUserEmail() {
    return activeUserEmail;
  }

  function switchUser(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) {
      clearActiveWorkspace();
      return;
    }

    activeUserEmail = clean;
    const keys = getUserKeys(clean);

    // 1. 해당 계정 전용 DB 로드 (없으면 기존 단일 계정 레거시 DB 1회 마이그레이션 검토)
    let loadedFS = null;
    let loadedChat = [];
    let hasLocalUserDb = false;

    try {
      const saved = localStorage.getItem(keys.db);
      if (saved) {
        loadedFS = JSON.parse(saved);
        hasLocalUserDb = true;
      } else {
        // 기존 ownerEmail 또는 최초 사용자가 레거시 단일 DB를 보유한 경우 1회 안전 이전
        const claimedBy = String(localStorage.getItem(LEGACY_CLAIMED_KEY) || '').trim().toLowerCase();
        const prevOwner = String(state.settings.ownerEmail || '').trim().toLowerCase();
        const legacyRaw = localStorage.getItem(LEGACY_V6_DB_KEY) || localStorage.getItem(LEGACY_DB_KEY);
        const canClaimLegacy = Boolean(legacyRaw) && (
          claimedBy === clean ||
          (!claimedBy && (!prevOwner || prevOwner === clean))
        );

        if (canClaimLegacy) {
          loadedFS = JSON.parse(legacyRaw);
          localStorage.setItem(keys.db, JSON.stringify(loadedFS));
          localStorage.setItem(LEGACY_CLAIMED_KEY, clean);
          hasLocalUserDb = true;

          const legacyChatRaw = localStorage.getItem(LEGACY_CHAT_KEY);
          if (legacyChatRaw) {
            try {
              loadedChat = JSON.parse(legacyChatRaw) || [];
              localStorage.setItem(keys.chat, JSON.stringify(loadedChat));
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      console.error('계정별 DB 로드 오류:', e);
    }

    if (!loadedFS) {
      loadedFS = createDefaultData();
    }

    // 2. 해당 계정 전용 채팅 로드
    if (loadedChat.length === 0) {
      try {
        const rawChat = localStorage.getItem(keys.chat);
        loadedChat = rawChat ? JSON.parse(rawChat) : [];
      } catch (_) {
        loadedChat = [];
      }
    }

    // 3. 해당 계정 전용 동기화 메타 로드 (타 계정의 driveDbFileId와 절대 섞이지 않음)
    const defaultMeta = {
      updatedAt: hasLocalUserDb ? Date.now() : 0,
      lastSyncedAt: 0,
      driveDbFileId: '',
      hasUserEdits: hasLocalUserDb
    };
    try {
      const rawMeta = localStorage.getItem(keys.syncMeta);
      syncMeta = rawMeta ? { ...defaultMeta, ...JSON.parse(rawMeta) } : defaultMeta;
    } catch (_) {
      syncMeta = defaultMeta;
    }

    state.fileSystem = loadedFS;
    state.currentFolder = state.fileSystem;
    state.selectedItem = null;
    state.undoStack = [];
    state.clipboard = null;
    state.chatHistory = Array.isArray(loadedChat) ? loadedChat : [];
    state.attachedContextIds = [];
  }

  function clearActiveWorkspace() {
    activeUserEmail = '';
    syncMeta = {
      updatedAt: 0,
      lastSyncedAt: 0,
      driveDbFileId: '',
      hasUserEdits: false
    };
    state.fileSystem = createLockedPlaceholderFS();
    state.currentFolder = state.fileSystem;
    state.selectedItem = null;
    state.undoStack = [];
    state.clipboard = null;
    state.chatHistory = [];
    state.attachedContextIds = [];
  }

  function getSyncMeta() {
    return { ...syncMeta };
  }

  function setSyncMeta(patch) {
    syncMeta = { ...syncMeta, ...(patch || {}) };
    if (activeUserEmail) {
      try {
        localStorage.setItem(getUserKeys(activeUserEmail).syncMeta, JSON.stringify(syncMeta));
      } catch (_) {}
    }
    return { ...syncMeta };
  }

  function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function regenerateIds(node) {
    node.id = genId();
    if (node.children) node.children.forEach(regenerateIds);
  }

  function persistFS(options = {}) {
    if (!activeUserEmail) return;
    localStorage.setItem(getUserKeys(activeUserEmail).db, JSON.stringify(state.fileSystem));
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function persistSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function persistChat(options = {}) {
    if (!activeUserEmail) return;
    localStorage.setItem(getUserKeys(activeUserEmail).chat, JSON.stringify(state.chatHistory.slice(-60)));
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
    getActiveUserEmail,
    switchUser,
    clearActiveWorkspace,
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
