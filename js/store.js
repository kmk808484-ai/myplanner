(function (global) {
  'use strict';

  const LEGACY_V6_DB_KEY = 'brainOS_v6_DB';
  const LEGACY_DB_KEY = 'brainOS_DB';
  const LEGACY_CHAT_KEY = 'brainOS_chat_history';
  const LEGACY_CLAIMED_KEY = 'brainOS_legacy_claimed_by';
  const SETTINGS_KEY = 'brainOS_api_settings';
  const THEME_KEY = 'brainOS_theme';

  // 보안: 배포 코드에 개인 Firebase 프로젝트 키/ID를 하드코딩하지 않습니다.
  // 사용자는 로그인 모달(⚙️ Firebase 설정) 또는 로컬 bridge-config.json에서 본인 프로젝트를 설정합니다.
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
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

  const PARA_ROOTS = [
    { id: 'para-projects', paraRoot: 'project', name: '1. 프로젝트', icon: '🚀', tag: '#프로젝트' },
    { id: 'para-areas', paraRoot: 'area', name: '2. 영역', icon: '🧭', tag: '#영역' },
    { id: 'para-resources', paraRoot: 'resource', name: '3. 자료', icon: '📚', tag: '#자료' },
    { id: 'para-archives', paraRoot: 'archive', name: '4. 보관', icon: '📦', tag: '#보관' }
  ];

  // 이전 버전에서 물리 트리에 자동 생성된 빈 PARA 스텁 폴더만 안전하게 정리 (파일이 들어있는 폴더는 절대 건드리지 않음)
  function cleanupEmptyAutoParaFolders(fs = state.fileSystem) {
    if (!fs || !Array.isArray(fs.children)) return false;
    const autoIds = new Set(['para-projects', 'para-areas', 'para-resources', 'para-archives']);
    const before = fs.children.length;
    fs.children = fs.children.filter((c) => {
      if (!c || c.type !== 'folder') return true;
      if (autoIds.has(c.id) && (!Array.isArray(c.children) || c.children.length === 0)) {
        return false;
      }
      return true;
    });
    return fs.children.length !== before;
  }

  function findParaEntity(entityId) {
    if (!entityId) return null;
    return (state.paraEntities || []).find((e) => e.id === entityId) || null;
  }

  function resolveAnyNode(id) {
    if (!id) return null;
    const ent = findParaEntity(id);
    if (ent) return ent;
    return findNodeAndParent(id)?.node || null;
  }

  function persistParaEntities(options = {}) {
    if (!activeUserEmail) return;
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).paraEntities, JSON.stringify(state.paraEntities));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function normalizeParaEntityFields(e) {
    if (!e || typeof e !== 'object') return e;
    if (e.paraType === 'archive') {
      e.paraType = 'project';
      e.archived = true;
    }
    if (!['project', 'area', 'resource'].includes(e.paraType)) {
      e.paraType = 'project';
    }
    e.archived = Boolean(e.archived);
    e.createdAt = Number(e.createdAt) || Date.now();
    e.updatedAt = Number(e.updatedAt) || e.createdAt;
    if (e.archived && !e.archivedAt) e.archivedAt = e.updatedAt;
    if (!e.archived) e.archivedAt = 0;

    if (e.paraType === 'project') {
      if (!['active', 'hold', 'completed'].includes(e.status)) {
        e.status = e.archived ? 'completed' : 'active';
      }
      if (e.archived && e.status !== 'completed') e.status = 'completed';
      e.dueDate = typeof e.dueDate === 'string' ? e.dueDate.trim() : '';
      const p = Number(e.progress);
      e.progress = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : (e.archived ? 100 : 0);
    }
    return e;
  }

  function declareParaEntity({
    paraType = 'project',
    name = '',
    summary = '',
    archived = false,
    status = '',
    dueDate = '',
    progress = 0
  }) {
    const isArchiveCall = paraType === 'archive';
    const cleanType = ['project', 'area', 'resource'].includes(paraType) ? paraType : 'project';
    const isArchived = Boolean(archived || isArchiveCall);
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;

    const dup = (state.paraEntities || []).find(
      (e) => e.paraType === cleanType && String(e.name || '').trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (dup) {
      normalizeParaEntityFields(dup);
      if (dup.archived !== isArchived) {
        dup.archived = isArchived;
        dup.archivedAt = isArchived ? Date.now() : 0;
      }
      if (cleanType === 'project') {
        if (status && ['active', 'hold', 'completed'].includes(status)) dup.status = status;
        if (dueDate) dup.dueDate = String(dueDate).trim();
        if (Number.isFinite(Number(progress)) && Number(progress) > 0) {
          dup.progress = Math.max(0, Math.min(100, Math.round(Number(progress))));
        }
      }
      dup.updatedAt = Date.now();
      persistParaEntities();
      return dup;
    }

    const now = Date.now();
    const iconMap = { project: '🚀', area: '🧭', resource: '📚' };
    const tagMap = { project: '#프로젝트', area: '#영역', resource: '#자료' };
    const entity = normalizeParaEntityFields({
      id: `para-${cleanType}-${genId()}`,
      type: 'para-entity',
      isVirtual: true,
      paraType: cleanType,
      archived: isArchived,
      archivedAt: isArchived ? now : 0,
      status: cleanType === 'project'
        ? (['active', 'hold', 'completed'].includes(status) ? status : (isArchived ? 'completed' : 'active'))
        : undefined,
      dueDate: cleanType === 'project' ? String(dueDate || '').trim() : undefined,
      progress: cleanType === 'project'
        ? (isArchived ? 100 : Math.max(0, Math.min(100, Math.round(Number(progress) || 0))))
        : undefined,
      name: cleanName,
      icon: iconMap[cleanType],
      tag: tagMap[cleanType],
      summary: String(summary || '').trim(),
      createdAt: now,
      updatedAt: now
    });
    state.paraEntities.push(entity);
    persistParaEntities();
    return entity;
  }

  function updateParaEntity(entityId, patch = {}) {
    const ent = findParaEntity(entityId);
    if (!ent) return null;
    if (patch.name !== undefined && String(patch.name).trim()) {
      ent.name = String(patch.name).trim();
    }
    if (patch.summary !== undefined) {
      ent.summary = String(patch.summary || '').trim();
    }
    if (patch.paraType && ['project', 'area', 'resource'].includes(patch.paraType)) {
      ent.paraType = patch.paraType;
    }
    if (ent.paraType === 'project') {
      if (patch.status && ['active', 'hold', 'completed'].includes(patch.status)) {
        ent.status = patch.status;
      }
      if (patch.dueDate !== undefined) {
        ent.dueDate = String(patch.dueDate || '').trim();
      }
      if (patch.progress !== undefined && Number.isFinite(Number(patch.progress))) {
        ent.progress = Math.max(0, Math.min(100, Math.round(Number(patch.progress))));
      }
    }
    if (patch.archived !== undefined) {
      ent.archived = Boolean(patch.archived);
      ent.archivedAt = ent.archived ? (ent.archivedAt || Date.now()) : 0;
      if (ent.paraType === 'project') {
        if (ent.archived) {
          ent.status = 'completed';
          if (ent.progress < 100) ent.progress = 100;
        } else if (ent.status === 'completed') {
          ent.status = 'active';
        }
      }
    }
    ent.updatedAt = Date.now();
    normalizeParaEntityFields(ent);
    persistParaEntities();
    return ent;
  }

  function completeAndArchiveProject(entityId) {
    return updateParaEntity(entityId, {
      status: 'completed',
      progress: 100,
      archived: true
    });
  }

  function archiveParaEntity(entityId, archived = true) {
    return Boolean(updateParaEntity(entityId, { archived: Boolean(archived) }));
  }

  function removeParaEntity(entityId) {
    const before = (state.paraEntities || []).length;
    state.paraEntities = (state.paraEntities || []).filter((e) => e.id !== entityId);
    if (state.paraEntities.length !== before) {
      persistParaEntities();
      // 해당 가상 엔티티에 걸린 관계만 정리 (물리 파일은 그대로 보존)
      const relBefore = state.relations.length;
      state.relations = state.relations.filter((r) => r.sourceId !== entityId && r.targetId !== entityId);
      if (state.relations.length !== relBefore) persistRelations();
      return true;
    }
    return false;
  }

  function renameParaEntity(entityId, newName) {
    const clean = String(newName || '').trim();
    if (!clean) return false;
    const ent = findParaEntity(entityId);
    if (!ent) return false;
    ent.name = clean;
    persistParaEntities();
    return true;
  }

  function getParaEntities(paraType, opts = {}) {
    let list = [...(state.paraEntities || [])];
    list.forEach((e) => normalizeParaEntityFields(e));
    if (paraType === 'archive') {
      list = list.filter((e) => Boolean(e.archived));
      if (opts.subType) list = list.filter((e) => e.paraType === opts.subType);
      return list;
    }
    if (paraType) {
      list = list.filter((e) => e.paraType === paraType);
    }
    if (opts.onlyActive) {
      list = list.filter((e) => !e.archived);
    } else if (opts.onlyArchived) {
      list = list.filter((e) => Boolean(e.archived));
    }
    return list;
  }

  // 레거시(v30~v31) 폴더형 PARA → 가상 엔티티로 변환. 물리 파일은 절대 삭제하지 않음.
  function normalizeParaWorkspace() {
    const fs = state.fileSystem;
    if (!fs || !Array.isArray(fs.children)) return false;
    if (!Array.isArray(state.paraEntities)) state.paraEntities = [];
    if (!Array.isArray(state.relations)) state.relations = [];
    let changed = false;

    const collectDocs = (node, out = []) => {
      (node.children || []).forEach((c) => {
        if (c.type === 'doc') out.push(c);
        else if (c.type === 'folder') collectDocs(c, out);
      });
      return out;
    };

    const legacyFolders = [];
    const walk = (node) => {
      (node.children || []).forEach((c) => {
        if (c && c.type === 'folder') {
          if (c.paraType && ['project', 'area', 'resource', 'archive'].includes(c.paraType)) legacyFolders.push(c);
          walk(c);
        }
      });
    };
    walk(fs);

    legacyFolders.forEach((folder) => {
      const pType = folder.paraType;
      const exists = state.paraEntities.some((e) => e.id === folder.id);
      const entityId = folder.id;
      if (!exists) {
        const iconMap = { project: '🚀', area: '🧭', resource: '📚', archive: '📦' };
        state.paraEntities.push({
          id: entityId,
          type: 'para-entity',
          isVirtual: true,
          paraType: pType,
          name: folder.name,
          icon: iconMap[pType],
          tag: folder.tag || '',
          summary: folder.summary || '',
          createdAt: Date.now()
        });
      }
      // 폴더 내부 물리 파일들은 엔티티와 관계로 연결
      collectDocs(folder).forEach((doc) => {
        const dup = state.relations.some((r) => r.type === pType &&
          ((r.sourceId === doc.id && r.targetId === entityId) || (r.sourceId === entityId && r.targetId === doc.id)));
        if (!dup && pType !== 'archive') {
          state.relations.push({ id: `rel-${genId()}`, sourceId: doc.id, targetId: entityId, type: pType, label: '', createdAt: Date.now() });
        } else if (!dup && pType === 'archive') {
          state.relations.push({ id: `rel-${genId()}`, sourceId: doc.id, targetId: entityId, type: 'archive', label: '', createdAt: Date.now() });
        }
      });
      // 물리 폴더는 일반 폴더로 남기되 ID 충돌 방지를 위해 새 ID 부여
      folder.id = `folder-${genId()}`;
      delete folder.paraType;
      if (folder.icon === '🚀' || folder.icon === '🧭' || folder.icon === '📚' || folder.icon === '📦') folder.icon = '📁';
      changed = true;
    });

    // 빈 폴더(레거시 자동 생성 스텁) 정리 — 파일이 남아 있으면 일반 폴더로 유지
    const pruneEmpty = (node) => {
      if (!Array.isArray(node.children)) return;
      node.children.forEach(pruneEmpty);
      const before = node.children.length;
      node.children = node.children.filter((c) => {
        if (c.type !== 'folder') return true;
        const wasLegacy = c.paraRoot || String(c.id || '').startsWith('folder-') && legacyFolders.includes(c);
        return !(wasLegacy && (!c.children || c.children.length === 0));
      });
      if (node.children.length !== before) changed = true;
    };
    pruneEmpty(fs);
    // paraRoot 표식이 남은 비어있지 않은 폴더는 일반 폴더로 전환
    (fs.children || []).forEach((c) => {
      if (c.paraRoot) {
        delete c.paraRoot;
        changed = true;
      }
    });
    if (cleanupEmptyAutoParaFolders(fs)) changed = true;
    return changed;
  }

  function getUnassignedNodes(visibilityFilter = null) {
    // 3개 영역(프로젝트 · 영역 · 리소스) 중 하나라도 연결되어 있으면(아카이브된 프로젝트/영역/리소스 포함) 미지정 즉시 해제
    const validParaEntityIds = new Set(
      (state.paraEntities || [])
        .filter((e) => ['project', 'area', 'resource', 'archive'].includes(e.paraType))
        .map((e) => e.id)
    );
    const linkedToParaSet = new Set();
    (state.relations || []).forEach((r) => {
      if (r.type === 'project' || r.type === 'area' || r.type === 'resource') {
        if (validParaEntityIds.has(r.sourceId)) linkedToParaSet.add(r.targetId);
        if (validParaEntityIds.has(r.targetId)) linkedToParaSet.add(r.sourceId);
        // 엔티티와 직접 연결된 경우 모두 미지정 해제
        linkedToParaSet.add(r.sourceId);
        linkedToParaSet.add(r.targetId);
      }
    });

    const allNodes = collectAllNodes(state.fileSystem);
    return allNodes.filter((n) => {
      if (!n || n.type !== 'doc') return false;
      if (typeof visibilityFilter === 'function' && !visibilityFilter(n)) return false;
      return !linkedToParaSet.has(n.id);
    });
  }

  function createGuestDefaultData() {
    return {
      id: 'root',
      name: '물리적 자료 보관소 (게스트)',
      type: 'folder',
      icon: '💾',
      children: [
        {
          id: 'guest-welcome-folder',
          name: '시작 가이드',
          type: 'folder',
          icon: '📁',
          children: [
            {
              id: 'guest-welcome-note',
              type: 'doc',
              name: '오프라인 게스트 안내.md',
              icon: '📘',
              tag: '#오프라인 #게스트 #MD',
              link: '',
              summary:
                '## 오프라인 게스트 모드입니다\n\n' +
                '좌측 상단 **🧭 PARA 트리**는 관계 기반 가상 뷰이고, 하단 **💾 물리적 자료 보관소**가 실제 파일 본체입니다.\n\n' +
                '- 물리적 파일은 한 곳에 안전하게 보관하고, 여러 **🚀 프로젝트 · 🧭 영역 · 📚 리소스**에 중복 없이 관계로 연결해 보세요.'
            }
          ]
        }
      ]
    };
  }

  function createDefaultData() {
    return {
      id: 'root',
      name: '물리적 자료 보관소',
      type: 'folder',
      icon: '💾',
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
              tag: '#가이드 #MD #PARA',
              link: '',
              summary:
                '## 환영합니다!\n\n' +
                '이 앱은 **🧭 PARA 가상 트리**와 **💾 물리적 자료 보관소(Google Drive 백업 본체)**가 분리된 차세대 Second Brain OS입니다.\n\n' +
                '### 핵심 구조\n' +
                '- **💾 물리적 자료 보관소**: 실제 파일 본체가 저장되고 Google Drive(`SecondBrainOS`)로 백업됩니다.\n' +
                '- **🧭 PARA 트리**: 프로젝트·영역·리소스·아카이브를 선언하고 물리 파일을 관계로 연결하면, 각 프로젝트에서 관련 파일들이 **가상 뷰(허상)**로 보입니다.\n' +
                '- **🕸️ 관계 맵**: 선언된 PARA 열매를 클릭하면 연결된 자료들이 옵시디언처럼 방사형으로 펼쳐집니다.'
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
      relations: `${prefix}relations`,
      paraEntities: `${prefix}para_entities`,
      pinnedApps: `${prefix}pinned_apps`,
      syncMeta: `${prefix}sync_meta`
    };
  }

  function loadSettings() {
    const emptyKeys = { gemini: '', openai: '', anthropic: '', grok: '' };
    const sessionKeys = global.BrainSecurity ? global.BrainSecurity.loadSessionKeys() : emptyKeys;
    const defaults = {
      keys: { ...emptyKeys, ...sessionKeys },
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
        apiKey: String(savedFb.apiKey || '').trim(),
        authDomain: String(savedFb.authDomain || '').trim(),
        projectId: String(savedFb.projectId || '').trim(),
        storageBucket: String(savedFb.storageBucket || '').trim(),
        messagingSenderId: String(savedFb.messagingSenderId || '').trim(),
        appId: String(savedFb.appId || '').trim()
      };

      // 보안 마이그레이션: 과거 localStorage에 평문 API 키가 남아있다면 세션 메모리로 이전하고 즉시 제거
      let activeKeys = { ...emptyKeys, ...sessionKeys };
      const legacyKeys = parsed.keys || {};
      const hasLegacyPlaintext = Object.values(legacyKeys).some((v) => Boolean(String(v || '').trim()));
      if (hasLegacyPlaintext) {
        activeKeys = {
          gemini: activeKeys.gemini || String(legacyKeys.gemini || '').trim(),
          openai: activeKeys.openai || String(legacyKeys.openai || '').trim(),
          anthropic: activeKeys.anthropic || String(legacyKeys.anthropic || '').trim(),
          grok: activeKeys.grok || String(legacyKeys.grok || '').trim()
        };
        if (global.BrainSecurity) {
          global.BrainSecurity.saveSessionKeys(activeKeys);
        }
        try {
          const scrubbed = { ...parsed, keys: emptyKeys };
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(scrubbed));
        } catch (_) {}
      }

      return {
        ...defaults,
        ...parsed,
        keys: activeKeys,
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
    relations: [],
    paraEntities: [],
    pinnedAppIds: [],
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
        const isGuest = clean === 'guest@local.offline';
        const claimedBy = String(localStorage.getItem(LEGACY_CLAIMED_KEY) || '').trim().toLowerCase();
        const prevOwner = String(state.settings.ownerEmail || '').trim().toLowerCase();
        const legacyRaw = localStorage.getItem(LEGACY_V6_DB_KEY) || localStorage.getItem(LEGACY_DB_KEY);
        const canClaimLegacy = !isGuest && Boolean(legacyRaw) && (
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
      loadedFS = clean === 'guest@local.offline' ? createGuestDefaultData() : createDefaultData();
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

    // 4. 해당 계정 전용 관계(Relations) 및 홈 화면 고정 앱 로드
    let loadedRelations = [];
    let loadedPinnedApps = [];
    let loadedParaEntities = [];
    try {
      const rawRel = localStorage.getItem(keys.relations);
      if (rawRel) loadedRelations = JSON.parse(rawRel) || [];
    } catch (_) {}
    try {
      const rawPinned = localStorage.getItem(keys.pinnedApps);
      if (rawPinned) loadedPinnedApps = JSON.parse(rawPinned) || [];
    } catch (_) {}
    try {
      const rawPara = localStorage.getItem(keys.paraEntities);
      if (rawPara) loadedParaEntities = JSON.parse(rawPara) || [];
    } catch (_) {}

    state.fileSystem = loadedFS;
    state.currentFolder = state.fileSystem;
    state.selectedItem = null;
    state.undoStack = [];
    state.clipboard = null;
    state.chatHistory = Array.isArray(loadedChat) ? loadedChat : [];
    state.relations = Array.isArray(loadedRelations) ? loadedRelations : [];
    state.paraEntities = Array.isArray(loadedParaEntities) ? loadedParaEntities : [];
    state.pinnedAppIds = Array.isArray(loadedPinnedApps) ? loadedPinnedApps : [];
    state.attachedContextIds = [];

    // 이전 버전(폴더형 PARA) → 가상 PARA 엔티티 구조로 자동 마이그레이션
    if (normalizeParaWorkspace()) {
      try {
        localStorage.setItem(keys.db, JSON.stringify(state.fileSystem));
        localStorage.setItem(keys.relations, JSON.stringify(state.relations));
        localStorage.setItem(keys.paraEntities, JSON.stringify(state.paraEntities));
      } catch (_) {}
    }
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
    state.relations = [];
    state.paraEntities = [];
    state.pinnedAppIds = [];
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
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).db, JSON.stringify(state.fileSystem));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function persistSettings() {
    try {
      // 보안: 평문 AI API 키는 절대 localStorage에 저장하지 않습니다.
      const safeToPersist = {
        ...state.settings,
        keys: { gemini: '', openai: '', anthropic: '', grok: '' }
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(safeToPersist));
      if (global.BrainSecurity) {
        global.BrainSecurity.saveSessionKeys(state.settings.keys);
      }
    } catch (_) {}
  }

  function persistChat(options = {}) {
    if (!activeUserEmail) return;
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).chat, JSON.stringify(state.chatHistory.slice(-60)));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function persistRelations(options = {}) {
    if (!activeUserEmail) return;
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).relations, JSON.stringify(state.relations));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function persistPinnedApps(options = {}) {
    if (!activeUserEmail) return;
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).pinnedApps, JSON.stringify(state.pinnedAppIds));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  const SYMMETRIC_REL_TYPES = ['project', 'area', 'resource', 'archive', 'related'];
  const VALID_REL_TYPES = ['project', 'area', 'resource', 'archive', 'parent', 'related', 'reference'];

  function addRelation({ sourceId, targetId, type = 'project', label = '' }) {
    if (!sourceId || !targetId || sourceId === targetId) return null;
    const cleanType = VALID_REL_TYPES.includes(type) ? type : 'related';
    const cleanLabel = String(label || '').trim();
    const isSym = SYMMETRIC_REL_TYPES.includes(cleanType);
    const dup = state.relations.find((r) => {
      if (isSym) {
        return r.type === cleanType && (
          (r.sourceId === sourceId && r.targetId === targetId) ||
          (r.sourceId === targetId && r.targetId === sourceId)
        );
      }
      return r.type === cleanType && r.sourceId === sourceId && r.targetId === targetId;
    });
    if (dup) {
      if (cleanLabel) {
        dup.label = cleanLabel;
        persistRelations();
      }
      return dup;
    }
    const rel = {
      id: `rel-${genId()}`,
      sourceId,
      targetId,
      type: cleanType,
      label: cleanLabel,
      createdAt: Date.now()
    };
    state.relations.push(rel);
    persistRelations();
    return rel;
  }

  function removeRelation(relId) {
    const before = state.relations.length;
    state.relations = state.relations.filter((r) => r.id !== relId);
    if (state.relations.length !== before) {
      persistRelations();
      return true;
    }
    return false;
  }

  function getRelationsForNode(nodeId) {
    const projects = [];
    const areas = [];
    const resources = [];
    const parents = [];
    const children = [];
    const related = [];
    const references = [];
    const referencedBy = [];

    const archives = [];
    for (const r of state.relations) {
      if (r.type === 'project' || r.type === 'area' || r.type === 'resource' || r.type === 'archive' || r.type === 'related') {
        if (r.sourceId === nodeId || r.targetId === nodeId) {
          const otherId = r.sourceId === nodeId ? r.targetId : r.sourceId;
          const other = resolveAnyNode(otherId);
          if (other) {
            if (r.type === 'project') projects.push({ rel: r, node: other });
            else if (r.type === 'area') areas.push({ rel: r, node: other });
            else if (r.type === 'resource') resources.push({ rel: r, node: other });
            else if (r.type === 'archive') archives.push({ rel: r, node: other });
            else related.push({ rel: r, node: other });
          }
        }
      } else if (r.type === 'parent') {
        if (r.targetId === nodeId) {
          const other = resolveAnyNode(r.sourceId);
          if (other) parents.push({ rel: r, node: other });
        } else if (r.sourceId === nodeId) {
          const other = resolveAnyNode(r.targetId);
          if (other) children.push({ rel: r, node: other });
        }
      } else if (r.type === 'reference') {
        if (r.sourceId === nodeId) {
          const other = resolveAnyNode(r.targetId);
          if (other) references.push({ rel: r, node: other });
        } else if (r.targetId === nodeId) {
          const other = resolveAnyNode(r.sourceId);
          if (other) referencedBy.push({ rel: r, node: other });
        }
      }
    }
    return { projects, areas, resources, archives, parents, children, related, references, referencedBy };
  }

  function collectAllNodes(currentNode = state.fileSystem, list = []) {
    if (!currentNode) return list;
    if (currentNode.id !== 'root') list.push(currentNode);
    if (Array.isArray(currentNode.children)) {
      currentNode.children.forEach((c) => collectAllNodes(c, list));
    }
    return list;
  }

  function getSortMode() {
    try {
      return localStorage.getItem('brainOS_sort_mode') || 'default';
    } catch (_) {
      return 'default';
    }
  }

  function setSortMode(mode) {
    try {
      localStorage.setItem('brainOS_sort_mode', mode || 'default');
    } catch (_) {}
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

  function touchNode(node) {
    if (!node || typeof node !== 'object') return node;
    const now = Date.now();
    if (!node.createdAt) node.createdAt = now;
    node.updatedAt = now;
    return node;
  }

  function searchAll(query, visibilityFilter = null) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { files: [], paraEntities: [], relations: [] };

    const files = searchNodes(q).filter((n) => (typeof visibilityFilter === 'function' ? visibilityFilter(n) : true));
    const paraEntities = (state.paraEntities || []).filter((e) => {
      normalizeParaEntityFields(e);
      const statusKo = e.status === 'active' ? '진행' : (e.status === 'hold' ? '보류' : (e.status === 'completed' ? '완료' : ''));
      const typeKo = e.archived ? '보관 아카이브' : (e.paraType === 'project' ? '프로젝트' : (e.paraType === 'area' ? '영역' : '자료 리소스'));
      const hay = `${e.name || ''} ${e.tag || ''} ${e.summary || ''} ${e.dueDate || ''} ${statusKo} ${typeKo}`.toLowerCase();
      return hay.includes(q);
    });

    const relations = [];
    const seenRel = new Set();
    (state.relations || []).forEach((rel) => {
      const s = resolveAnyNode(rel.sourceId);
      const t = resolveAnyNode(rel.targetId);
      if (!s || !t) return;
      if (typeof visibilityFilter === 'function' && (!visibilityFilter(s) || !visibilityFilter(t))) return;
      const hay = `${rel.label || ''} ${rel.type || ''} ${s.name || ''} ${t.name || ''}`.toLowerCase();
      if (hay.includes(q) && !seenRel.has(rel.id)) {
        seenRel.add(rel.id);
        relations.push({ rel, source: s, target: t });
      }
    });

    return { files, paraEntities, relations };
  }

  global.BrainStore = {
    DEFAULT_FIREBASE_CONFIG,
    PARA_ROOTS,
    state,
    getActiveUserEmail,
    switchUser,
    clearActiveWorkspace,
    normalizeParaWorkspace,
    findParaEntity,
    resolveAnyNode,
    persistParaEntities,
    updateParaEntity,
    completeAndArchiveProject,
    archiveParaEntity,
    removeParaEntity,
    renameParaEntity,
    declareParaEntity,
    getParaEntities,
    getUnassignedNodes,
    touchNode,
    searchAll,
    genId,
    regenerateIds,
    persistFS,
    persistSettings,
    persistChat,
    persistRelations,
    persistPinnedApps,
    addRelation,
    removeRelation,
    getRelationsForNode,
    collectAllNodes,
    getSortMode,
    setSortMode,
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
