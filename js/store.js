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

  const DEFAULT_GLOBAL_TEMPLATES = [
    {
      id: 'gtpl-ext-report',
      name: '외부 처리 결과 보고서',
      content:
        '# {{제목}} — 외부 처리 결과\n\n' +
        '- **처리일시**: {{날짜}}\n' +
        '- **관련 프로젝트**: {{프로젝트}}\n' +
        '- **처리 대상 / 담당**: \n\n' +
        '## 1. 처리 요약\n- \n\n' +
        '## 2. 핵심 결과 및 협의 내용\n- \n\n' +
        '## 3. 후속 조치 (Next Action)\n- [ ] \n'
    },
    {
      id: 'gtpl-meeting-note',
      name: '외부 미팅 · 협의 기록',
      content:
        '# {{제목}} — 미팅 기록\n\n' +
        '- **일시**: {{날짜}}\n' +
        '- **참석자**: \n' +
        '- **프로젝트**: {{프로젝트}}\n\n' +
        '## 논의 안건\n1. \n\n' +
        '## 결정 사항\n- \n\n' +
        '## 공유/참고 링크\n- \n'
    },
    {
      id: 'gtpl-simple-log',
      name: '간단 완료 메모',
      content:
        '# {{제목}} 완료 기록 ({{날짜}})\n\n' +
        '- 완료 내용: \n' +
        '- 비고: \n'
    }
  ];

  function getParaPrefixLetter(paraType) {
    if (paraType === 'project') return 'P';
    if (paraType === 'resource') return 'R';
    if (paraType === 'area') return 'A';
    return 'P';
  }

  function nextParaNumberForType(paraType) {
    let maxNum = 0;
    (state.paraEntities || []).forEach((e) => {
      if (e && e.paraType === paraType) {
        const n = Number(e.paraNumber || 0);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }
    });
    return maxNum + 1;
  }

  function ensureParaNumbers() {
    let changed = false;
    ['project', 'area', 'resource'].forEach((t) => {
      const list = (state.paraEntities || []).filter((e) => e && e.paraType === t);
      const used = new Set();
      list.forEach((e) => {
        const n = Number(e.paraNumber || 0);
        if (Number.isInteger(n) && n > 0 && !used.has(n)) {
          used.add(n);
        } else {
          e.paraNumber = 0;
        }
      });
      let cursor = 1;
      list.forEach((e) => {
        if (!e.paraNumber) {
          while (used.has(cursor)) cursor++;
          e.paraNumber = cursor;
          used.add(cursor);
          changed = true;
        }
      });
    });
    return changed;
  }

  function getParaCode(ent) {
    if (!ent) return 'P-00';
    normalizeParaEntityFields(ent);
    const num = String(Math.max(1, Number(ent.paraNumber || 1))).padStart(2, '0');
    return `${getParaPrefixLetter(ent.paraType)}-${num}`;
  }

  function getSbFolderName(ent) {
    if (!ent) return 'P-00_기타';
    const safeTitle = String(ent.name || '이름없음')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 60) || '이름없음';
    return `${getParaCode(ent)}_${safeTitle}`;
  }

  function stripSbPrefix(fileName) {
    return String(fileName || '').replace(/^[PRA]-\d{2}-[TSR]-/i, '');
  }

  const DEFAULT_GTD_TAG_OPTIONS = {
    contexts: ['@PC', '@폰', '@외출', '@집'],
    times: ['@15분', '@30분', '@1시간', '@2시간'],
    energies: ['@높음', '@중간', '@낮음']
  };

  const DEFAULT_LIFE_GOALS = [
    { id: 'lg-1', title: '', desc: '', color: '#4f46e5' },
    { id: 'lg-2', title: '', desc: '', color: '#0ea5e9' },
    { id: 'lg-3', title: '', desc: '', color: '#10b981' },
    { id: 'lg-4', title: '', desc: '', color: '#f59e0b' },
    { id: 'lg-5', title: '', desc: '', color: '#e11d48' }
  ];

  const DEFAULT_WEEKLY_REVIEW_CONFIG = {
    reviewWeekday: 0, // 0=일, 1=월 ... 6=토
    checklist: { inbox: false, waiting: false, someday: false },
    lastReviewedDate: ''
  };

  function createDefaultRequirementTemplate(title = '', projectName = '') {
    const t = String(title || '').trim() || '(처음 떠오른 요구 한 줄)';
    const p = String(projectName || '').trim();
    return (
      `# 요구사항: ${t}\n\n` +
      `- 요청자: \n` +
      `- 구분: 필수 / 내가 덧붙임\n` +
      `- 관련 프로젝트: ${p}\n\n` +
      `## 다섯 번 질문 (답은 매번 한 문장)\n` +
      `1. 왜? \n` +
      `2. 왜? \n` +
      `3. 왜? \n` +
      `4. 왜? \n` +
      `5. 왜? \n` +
      `## 막혔을 때 (3번 이후 답이 안 나오면 여기로)\n` +
      `- 막힌 단계: \n` +
      `- 대안 질문: 어떻게 하면 되지? / 다른 방법은? / 이게 없으면? / 누가 이미 해결했지?\n` +
      `- 답 (한 문장): \n` +
      `## 본질 요구 (5번 답을 요구로 다시 쓰기)\n` +
      `- \n`
    );
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
    if (!Number.isInteger(Number(e.paraNumber)) || Number(e.paraNumber) < 1) {
      e.paraNumber = nextParaNumberForType(e.paraType);
    } else {
      e.paraNumber = Number(e.paraNumber);
    }

    if (e.paraType === 'project') {
      if (!['active', 'hold', 'completed'].includes(e.status)) {
        e.status = e.archived ? 'completed' : 'active';
      }
      if (e.archived && e.status !== 'completed') e.status = 'completed';
      e.dueDate = typeof e.dueDate === 'string' ? e.dueDate.trim() : '';
      const p = Number(e.progress);
      e.progress = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : (e.archived ? 100 : 0);
      if (!Array.isArray(e.templates)) e.templates = [];
      if (!Array.isArray(e.risks)) e.risks = [];
      if (typeof e.riskDocId !== 'string') e.riskDocId = '';
      if (typeof e.lifeGoalId !== 'string') e.lifeGoalId = '';
      if (typeof e.parentProjectId !== 'string') e.parentProjectId = '';
      if (!Array.isArray(e.requirements)) e.requirements = [];
      if (!Array.isArray(e.deliverableSpecs)) e.deliverableSpecs = [];
      if (!Array.isArray(e.evaluationCriteria)) e.evaluationCriteria = [];
      if (typeof e.ganttOrder !== 'number' || !Number.isFinite(e.ganttOrder)) e.ganttOrder = e.paraNumber || 0;
      if (typeof e.nextProjectId !== 'string') e.nextProjectId = '';
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
    progress = 0,
    lifeGoalId = '',
    parentProjectId = ''
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
      lifeGoalId: cleanType === 'project' ? String(lifeGoalId || '').trim() : undefined,
      parentProjectId: cleanType === 'project' ? String(parentProjectId || '').trim() : undefined,
      name: cleanName,
      icon: iconMap[cleanType],
      tag: tagMap[cleanType],
      summary: String(summary || '').trim(),
      createdAt: now,
      updatedAt: now
    });
    state.paraEntities.push(entity);
    persistParaEntities();
    logChange({
      category: 'project',
      projectName: entity.name,
      message: `${getParaCode(entity)} "${entity.name}" (${cleanType === 'project' ? '프로젝트' : (cleanType === 'area' ? '영역' : '자료')}) 생성`
    });
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
      if (patch.lifeGoalId !== undefined) ent.lifeGoalId = String(patch.lifeGoalId || '').trim();
      if (patch.parentProjectId !== undefined) ent.parentProjectId = String(patch.parentProjectId || '').trim();
      if (Array.isArray(patch.requirements)) ent.requirements = patch.requirements;
      if (Array.isArray(patch.deliverableSpecs)) ent.deliverableSpecs = patch.deliverableSpecs;
      if (Array.isArray(patch.evaluationCriteria)) ent.evaluationCriteria = patch.evaluationCriteria;
      if (patch.ganttOrder !== undefined && Number.isFinite(Number(patch.ganttOrder))) ent.ganttOrder = Number(patch.ganttOrder);
      if (patch.nextProjectId !== undefined) ent.nextProjectId = String(patch.nextProjectId || '').trim();
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
      syncMeta: `${prefix}sync_meta`,
      globalTemplates: `${prefix}global_templates`,
      lifeGoals: `${prefix}life_goals`,
      gtdTagOptions: `${prefix}gtd_tags`,
      weeklyReview: `${prefix}weekly_review`,
      changeLogs: `${prefix}change_logs`
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
    globalTemplates: [],
    lifeGoals: JSON.parse(JSON.stringify(DEFAULT_LIFE_GOALS)),
    gtdTagOptions: JSON.parse(JSON.stringify(DEFAULT_GTD_TAG_OPTIONS)),
    weeklyReviewConfig: JSON.parse(JSON.stringify(DEFAULT_WEEKLY_REVIEW_CONFIG)),
    changeLogs: [],
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
    let loadedGlobalTemplates = null;
    let loadedLifeGoals = null;
    let loadedGtdTags = null;
    let loadedWeeklyReview = null;
    let loadedChangeLogs = [];
    try { const r = localStorage.getItem(keys.relations); if (r) loadedRelations = JSON.parse(r) || []; } catch (_) {}
    try { const r = localStorage.getItem(keys.pinnedApps); if (r) loadedPinnedApps = JSON.parse(r) || []; } catch (_) {}
    try { const r = localStorage.getItem(keys.paraEntities); if (r) loadedParaEntities = JSON.parse(r) || []; } catch (_) {}
    try { const r = localStorage.getItem(keys.globalTemplates); if (r) loadedGlobalTemplates = JSON.parse(r); } catch (_) {}
    try { const r = localStorage.getItem(keys.lifeGoals); if (r) loadedLifeGoals = JSON.parse(r); } catch (_) {}
    try { const r = localStorage.getItem(keys.gtdTagOptions); if (r) loadedGtdTags = JSON.parse(r); } catch (_) {}
    try { const r = localStorage.getItem(keys.weeklyReview); if (r) loadedWeeklyReview = JSON.parse(r); } catch (_) {}
    try { const r = localStorage.getItem(keys.changeLogs); if (r) loadedChangeLogs = JSON.parse(r) || []; } catch (_) {}

    state.fileSystem = loadedFS;
    state.currentFolder = state.fileSystem;
    state.selectedItem = null;
    state.undoStack = [];
    state.clipboard = null;
    state.chatHistory = Array.isArray(loadedChat) ? loadedChat : [];
    state.relations = Array.isArray(loadedRelations) ? loadedRelations : [];
    state.paraEntities = Array.isArray(loadedParaEntities) ? loadedParaEntities : [];
    state.pinnedAppIds = Array.isArray(loadedPinnedApps) ? loadedPinnedApps : [];
    state.globalTemplates = Array.isArray(loadedGlobalTemplates)
      ? loadedGlobalTemplates
      : JSON.parse(JSON.stringify(DEFAULT_GLOBAL_TEMPLATES));
    state.lifeGoals = Array.isArray(loadedLifeGoals) && loadedLifeGoals.length === 5
      ? loadedLifeGoals
      : JSON.parse(JSON.stringify(DEFAULT_LIFE_GOALS));
    state.gtdTagOptions = loadedGtdTags && typeof loadedGtdTags === 'object'
      ? {
          contexts: Array.isArray(loadedGtdTags.contexts) && loadedGtdTags.contexts.length ? loadedGtdTags.contexts : [...DEFAULT_GTD_TAG_OPTIONS.contexts],
          times: Array.isArray(loadedGtdTags.times) && loadedGtdTags.times.length ? loadedGtdTags.times : [...DEFAULT_GTD_TAG_OPTIONS.times],
          energies: Array.isArray(loadedGtdTags.energies) && loadedGtdTags.energies.length ? loadedGtdTags.energies : [...DEFAULT_GTD_TAG_OPTIONS.energies]
        }
      : JSON.parse(JSON.stringify(DEFAULT_GTD_TAG_OPTIONS));
    state.weeklyReviewConfig = loadedWeeklyReview && typeof loadedWeeklyReview === 'object'
      ? {
          ...DEFAULT_WEEKLY_REVIEW_CONFIG,
          ...loadedWeeklyReview,
          checklist: { ...DEFAULT_WEEKLY_REVIEW_CONFIG.checklist, ...(loadedWeeklyReview.checklist || {}) }
        }
      : JSON.parse(JSON.stringify(DEFAULT_WEEKLY_REVIEW_CONFIG));
    state.changeLogs = Array.isArray(loadedChangeLogs) ? loadedChangeLogs : [];
    state.attachedContextIds = [];

    // 이전 버전(폴더형 PARA) → 가상 PARA 엔티티 구조로 자동 마이그레이션 & 고유 넘버링 보장
    const migrated = normalizeParaWorkspace();
    const numbered = ensureParaNumbers();
    if (migrated || numbered) {
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
    state.globalTemplates = [];
    state.lifeGoals = JSON.parse(JSON.stringify(DEFAULT_LIFE_GOALS));
    state.gtdTagOptions = JSON.parse(JSON.stringify(DEFAULT_GTD_TAG_OPTIONS));
    state.weeklyReviewConfig = JSON.parse(JSON.stringify(DEFAULT_WEEKLY_REVIEW_CONFIG));
    state.changeLogs = [];
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

  let _isPropagatingPara = false;

  function addRelation({ sourceId, targetId, type = 'project', label = '', skipPropagate = false }) {
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
    const sNode = resolveAnyNode(sourceId);
    const tNode = resolveAnyNode(targetId);
    let rel = dup;
    if (dup) {
      if (cleanLabel) {
        dup.label = cleanLabel;
        persistRelations();
      }
    } else {
      rel = {
        id: `rel-${genId()}`,
        sourceId,
        targetId,
        type: cleanType,
        label: cleanLabel,
        createdAt: Date.now()
      };
      state.relations.push(rel);
      persistRelations();
      if (sNode && tNode) {
        const projTarget = sNode.paraType === 'project' ? sNode : (tNode.paraType === 'project' ? tNode : null);
        logChange({
          category: 'relation',
          projectName: projTarget?.name || '',
          message: `관계 연결(${cleanType}): "${sNode.name}" ↔ "${tNode.name}"${cleanLabel ? ` (${cleanLabel})` : ''}`
        });
      }
    }

    // 상위 할일에 프로젝트/영역이 지정되면 하위 일들도 자연스럽게 동일 소속 상속
    if (!skipPropagate && !_isPropagatingPara && sNode && tNode) {
      _isPropagatingPara = true;
      try {
        if (cleanType === 'project' || cleanType === 'area') {
          const docNode = sNode.type === 'doc' ? sNode : (tNode.type === 'doc' ? tNode : null);
          const entNode = sNode.type === 'para-entity' ? sNode : (tNode.type === 'para-entity' ? tNode : null);
          if (docNode && entNode) {
            const descendants = getAllDescendantCards(docNode.id);
            descendants.forEach((desc) => {
              addRelation({ sourceId: desc.id, targetId: entNode.id, type: cleanType, skipPropagate: true });
            });
          }
        } else if (cleanType === 'parent' && sNode.type === 'doc' && tNode.type === 'doc') {
          const parentRels = getRelationsForNode(sNode.id);
          const targets = [tNode, ...getAllDescendantCards(tNode.id)];
          (parentRels.projects || []).forEach(({ node }) => {
            if (node?.type === 'para-entity') {
              targets.forEach((d) => addRelation({ sourceId: d.id, targetId: node.id, type: 'project', skipPropagate: true }));
            }
          });
          (parentRels.areas || []).forEach(({ node }) => {
            if (node?.type === 'para-entity') {
              targets.forEach((d) => addRelation({ sourceId: d.id, targetId: node.id, type: 'area', skipPropagate: true }));
            }
          });
        }
      } finally {
        _isPropagatingPara = false;
      }
    }

    return rel;
  }

  function removeRelation(relId) {
    const targetRel = (state.relations || []).find((r) => r.id === relId);
    const before = state.relations.length;
    state.relations = state.relations.filter((r) => r.id !== relId);
    if (state.relations.length !== before) {
      persistRelations();
      if (targetRel) {
        const sNode = resolveAnyNode(targetRel.sourceId);
        const tNode = resolveAnyNode(targetRel.targetId);
        if (sNode && tNode) {
          logChange({
            category: 'relation',
            projectName: sNode.paraType === 'project' ? sNode.name : (tNode.paraType === 'project' ? tNode.name : ''),
            message: `관계 해제(${targetRel.type}): "${sNode.name}" ↔ "${tNode.name}"`
          });
        }
      }
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

  function persistGlobalTemplates(options = {}) {
    if (!activeUserEmail) return;
    try {
      localStorage.setItem(getUserKeys(activeUserEmail).globalTemplates, JSON.stringify(state.globalTemplates || []));
    } catch (_) {}
    if (!options.silent) {
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
    }
  }

  function getGlobalTemplates() {
    if (!Array.isArray(state.globalTemplates) || state.globalTemplates.length === 0) {
      state.globalTemplates = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_TEMPLATES));
    }
    return state.globalTemplates;
  }

  function saveGlobalTemplate({ id = '', name = '', content = '' }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return null;
    const list = getGlobalTemplates();
    const existing = id ? list.find((t) => t.id === id) : null;
    if (existing) {
      existing.name = cleanName;
      existing.content = String(content ?? '');
      existing.updatedAt = Date.now();
      persistGlobalTemplates();
      return existing;
    }
    const created = {
      id: `gtpl-${genId()}`,
      name: cleanName,
      content: String(content ?? ''),
      updatedAt: Date.now()
    };
    list.push(created);
    persistGlobalTemplates();
    return created;
  }

  function deleteGlobalTemplate(id) {
    const list = getGlobalTemplates();
    const before = list.length;
    state.globalTemplates = list.filter((t) => t.id !== id);
    if (state.globalTemplates.length !== before) {
      persistGlobalTemplates();
      return true;
    }
    return false;
  }

  function saveProjectTemplate(projectId, { id = '', name = '', content = '' }) {
    const ent = findParaEntity(projectId);
    const cleanName = String(name || '').trim();
    if (!ent || !cleanName) return null;
    normalizeParaEntityFields(ent);
    if (!Array.isArray(ent.templates)) ent.templates = [];
    const existing = id ? ent.templates.find((t) => t.id === id) : null;
    if (existing) {
      existing.name = cleanName;
      existing.content = String(content ?? '');
      existing.updatedAt = Date.now();
    } else {
      ent.templates.push({
        id: `ptpl-${genId()}`,
        name: cleanName,
        content: String(content ?? ''),
        updatedAt: Date.now()
      });
    }
    ent.updatedAt = Date.now();
    persistParaEntities();
    return existing || ent.templates[ent.templates.length - 1];
  }

  function deleteProjectTemplate(projectId, tplId) {
    const ent = findParaEntity(projectId);
    if (!ent || !Array.isArray(ent.templates)) return false;
    const before = ent.templates.length;
    ent.templates = ent.templates.filter((t) => t.id !== tplId);
    if (ent.templates.length !== before) {
      ent.updatedAt = Date.now();
      persistParaEntities();
      return true;
    }
    return false;
  }

  // ---- Project Risk Management (A/B/C Severity + Scenario -> Markdown Sync) ----
  function addProjectRisk(projectId, { scenario = '', risk = '', level = 'B', mitigation = '', status = 'monitoring' }) {
    const ent = findParaEntity(projectId);
    if (!ent) return null;
    normalizeParaEntityFields(ent);
    const cleanScenario = String(scenario || '').trim();
    const cleanRisk = String(risk || '').trim();
    if (!cleanScenario && !cleanRisk) return null;
    const item = {
      id: `risk-${genId()}`,
      scenario: cleanScenario || '기본 시나리오',
      risk: cleanRisk || cleanScenario,
      level: ['A', 'B', 'C'].includes(level) ? level : 'B',
      mitigation: String(mitigation || '').trim(),
      status: ['monitoring', 'mitigating', 'resolved'].includes(status) ? status : 'monitoring',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    ent.risks.push(item);
    ent.updatedAt = Date.now();
    persistParaEntities();
    return item;
  }

  function updateProjectRisk(projectId, riskId, patch = {}) {
    const ent = findParaEntity(projectId);
    if (!ent || !Array.isArray(ent.risks)) return null;
    const item = ent.risks.find((r) => r.id === riskId);
    if (!item) return null;
    if (patch.scenario !== undefined) item.scenario = String(patch.scenario || '').trim();
    if (patch.risk !== undefined) item.risk = String(patch.risk || '').trim();
    if (patch.level && ['A', 'B', 'C'].includes(patch.level)) item.level = patch.level;
    if (patch.mitigation !== undefined) item.mitigation = String(patch.mitigation || '').trim();
    if (patch.status && ['monitoring', 'mitigating', 'resolved'].includes(patch.status)) item.status = patch.status;
    item.updatedAt = Date.now();
    ent.updatedAt = Date.now();
    persistParaEntities();
    return item;
  }

  function deleteProjectRisk(projectId, riskId) {
    const ent = findParaEntity(projectId);
    if (!ent || !Array.isArray(ent.risks)) return false;
    const before = ent.risks.length;
    ent.risks = ent.risks.filter((r) => r.id !== riskId);
    if (ent.risks.length !== before) {
      ent.updatedAt = Date.now();
      persistParaEntities();
      return true;
    }
    return false;
  }

  function renderRisksToMarkdown(ent) {
    if (!ent) return '';
    normalizeParaEntityFields(ent);
    const code = getParaCode(ent);
    const statusMap = { monitoring: '모니터링', mitigating: '대응 중', resolved: '해소됨' };
    const levelLabel = {
      A: '🔴 A등급 (고위험 · 즉시 대응)',
      B: '🟠 B등급 (중위험 · 계획 수립)',
      C: '🟢 C등급 (저위험 · 관찰)'
    };
    const grouped = { A: [], B: [], C: [] };
    (ent.risks || []).forEach((r) => {
      const lv = ['A', 'B', 'C'].includes(r.level) ? r.level : 'B';
      grouped[lv].push(r);
    });
    const lines = [
      `# ${code} ${ent.name} — 리스크 관리 (시나리오 분석)`,
      '',
      `- 최종 갱신: ${new Date().toLocaleString('ko-KR')}`,
      `- 요약: **A등급 ${grouped.A.length}건** · **B등급 ${grouped.B.length}건** · **C등급 ${grouped.C.length}건**`,
      ''
    ];
    ['A', 'B', 'C'].forEach((lv) => {
      lines.push(`## ${levelLabel[lv]}`);
      if (grouped[lv].length === 0) {
        lines.push('- 등록된 리스크 없음');
      } else {
        lines.push('| 시나리오 | 예상 리스크 | 대응 방안 | 상태 |');
        lines.push('|---|---|---|---|');
        grouped[lv].forEach((r) => {
          const escCell = (v) => String(v || '-').replace(/\|/g, '\\|').replace(/\n/g, ' ');
          lines.push(`| ${escCell(r.scenario)} | ${escCell(r.risk)} | ${escCell(r.mitigation)} | ${statusMap[r.status] || '모니터링'} |`);
        });
      }
      lines.push('');
    });
    return lines.join('\n');
  }

  // ---- Unified Card Helpers (Role T/S/R/M, Subtype, Reuse, Extract, GTD, Sub-Cards, Tags, Schedule) ----
  function getCardRole(doc) {
    if (!doc) return 'S';
    if (['T', 'S', 'R', 'M'].includes(doc.cardRole)) return doc.cardRole;
    if (doc.cardKind === 'milestone') return 'M';
    if (doc.cardKind === 'deliverable') return 'R';
    if (doc.cardKind === 'task' || doc.cardKind === 'event' || doc.isTodayCore || /#할일|#todo\b/i.test(String(doc.tag || ''))) return 'T';
    if (/#마일스톤|#milestone\b/i.test(String(doc.tag || ''))) return 'M';
    if (/#산출물|#결과|#result\b/i.test(String(doc.tag || ''))) return 'R';
    return 'S';
  }

  function setCardRole(doc, role, resultSubtype) {
    if (!doc || !['T', 'S', 'R', 'M'].includes(role)) return false;
    doc.cardRole = role;
    if (role === 'T' && (!doc.cardKind || doc.cardKind === 'note')) doc.cardKind = 'task';
    if (role === 'M') doc.cardKind = 'milestone';
    if (role === 'R') {
      doc.cardKind = 'deliverable';
      if (resultSubtype && ['output', 'trial_error', 'mistake'].includes(resultSubtype)) {
        doc.resultSubtype = resultSubtype;
      } else if (!doc.resultSubtype) {
        doc.resultSubtype = 'output';
      }
    }
    if (role === 'S' && (doc.cardKind === 'deliverable' || doc.cardKind === 'milestone')) doc.cardKind = 'note';
    touchNode(doc);
    persistFS();
    return true;
  }

  function setCardResultSubtype(doc, subtype) {
    if (!doc || !['output', 'trial_error', 'mistake'].includes(subtype)) return false;
    doc.cardRole = 'R';
    doc.cardKind = 'deliverable';
    doc.resultSubtype = subtype;
    touchNode(doc);
    persistFS();
    return true;
  }

  function incrementCardReuse(docId) {
    const doc = findNodeAndParent(docId)?.node;
    if (!doc) return 0;
    doc.reuseCount = Number(doc.reuseCount || 0) + 1;
    touchNode(doc);
    persistFS();
    return doc.reuseCount;
  }

  function getRecommendedDeliverables(queryText = '', extraTags = []) {
    const rawTokens = `${queryText || ''} ${(Array.isArray(extraTags) ? extraTags.join(' ') : String(extraTags || ''))}`
      .toLowerCase()
      .split(/[\s,#/_\-()\[\]]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const tokenSet = new Set(rawTokens);

    const archivedProjects = getParaEntities('project', { onlyArchived: true });
    const allProjects = getParaEntities('project');
    const results = [];
    const seenDoc = new Set();

    const scanProjects = archivedProjects.length > 0 ? archivedProjects : allProjects;
    scanProjects.forEach((proj) => {
      const projHay = `${proj.name || ''} ${proj.summary || ''} ${proj.tag || ''}`.toLowerCase();
      let projScore = 0;
      tokenSet.forEach((tk) => {
        if (projHay.includes(tk)) projScore += 3;
      });

      const docs = getProjectLinkedDocs(proj.id);
      docs.forEach((doc) => {
        if (seenDoc.has(doc.id)) return;
        if (getCardRole(doc) !== 'R') return;
        const docTags = getCardTags(doc).map((t) => t.toLowerCase());
        const docHay = `${doc.name || ''} ${doc.summary || ''} ${docTags.join(' ')}`.toLowerCase();
        let score = projScore + (proj.archived ? 2 : 0) + Math.min(3, Number(doc.reuseCount || 0));
        tokenSet.forEach((tk) => {
          if (docHay.includes(tk)) score += 4;
        });
        if (tokenSet.size === 0 || score > (proj.archived ? 2 : 0)) {
          seenDoc.add(doc.id);
          results.push({ doc, project: proj, score });
        }
      });
    });

    return results.sort((a, b) => (b.score - a.score) || (Number(b.doc.reuseCount || 0) - Number(a.doc.reuseCount || 0)));
  }

  // ---- Life Goals (5), GTD Tags, Weekly Review, Project Hierarchy, Change Logs, Relation Export/Import ----
  function persistLifeGoals() {
    if (!activeUserEmail) return;
    try { localStorage.setItem(getUserKeys(activeUserEmail).lifeGoals, JSON.stringify(state.lifeGoals || [])); } catch (_) {}
    setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
  }

  function saveLifeGoals(goalsArr) {
    const clean = DEFAULT_LIFE_GOALS.map((def, idx) => {
      const src = Array.isArray(goalsArr) ? (goalsArr[idx] || {}) : {};
      return {
        id: src.id || def.id,
        title: String(src.title || '').trim(),
        desc: String(src.desc || '').trim(),
        color: src.color || def.color
      };
    });
    state.lifeGoals = clean;
    persistLifeGoals();
    logChange({ category: 'goal', message: '인생 중요 목표 5가지 업데이트' });
    return clean;
  }

  function getLifeGoalById(id) {
    if (!id) return null;
    return (state.lifeGoals || []).find((g) => g.id === id && g.title) || null;
  }

  function persistGtdTagOptions() {
    if (!activeUserEmail) return;
    try { localStorage.setItem(getUserKeys(activeUserEmail).gtdTagOptions, JSON.stringify(state.gtdTagOptions)); } catch (_) {}
  }

  function addCustomGtdTag(group, rawTag) {
    if (!['contexts', 'times', 'energies'].includes(group)) return '';
    let clean = String(rawTag || '').trim();
    if (!clean) return '';
    if (!clean.startsWith('@')) clean = `@${clean}`;
    if (!state.gtdTagOptions[group]) state.gtdTagOptions[group] = [];
    if (!state.gtdTagOptions[group].includes(clean)) {
      state.gtdTagOptions[group].push(clean);
      persistGtdTagOptions();
    }
    return clean;
  }

  function persistWeeklyReviewConfig() {
    if (!activeUserEmail) return;
    try { localStorage.setItem(getUserKeys(activeUserEmail).weeklyReview, JSON.stringify(state.weeklyReviewConfig)); } catch (_) {}
  }

  function updateWeeklyReviewConfig(patch = {}) {
    state.weeklyReviewConfig = {
      ...DEFAULT_WEEKLY_REVIEW_CONFIG,
      ...(state.weeklyReviewConfig || {}),
      ...patch,
      checklist: {
        ...DEFAULT_WEEKLY_REVIEW_CONFIG.checklist,
        ...(state.weeklyReviewConfig?.checklist || {}),
        ...(patch.checklist || {})
      }
    };
    persistWeeklyReviewConfig();
    return state.weeklyReviewConfig;
  }

  function getLocalYmd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function persistChangeLogs() {
    if (!activeUserEmail) return;
    try { localStorage.setItem(getUserKeys(activeUserEmail).changeLogs, JSON.stringify((state.changeLogs || []).slice(0, 400))); } catch (_) {}
  }

  function logChange({ category = 'general', projectName = '', message = '' }) {
    if (!activeUserEmail || !message) return;
    const now = new Date();
    const entry = {
      id: `log-${genId()}`,
      date: getLocalYmd(now),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      ts: now.getTime(),
      category: String(category || 'general'),
      projectName: String(projectName || '').trim(),
      message: String(message || '').trim()
    };
    if (!Array.isArray(state.changeLogs)) state.changeLogs = [];
    state.changeLogs.unshift(entry);
    if (state.changeLogs.length > 400) state.changeLogs.length = 400;
    persistChangeLogs();
  }

  function getChangeLogsGroupedByDate(filterCat = 'all', query = '') {
    const q = String(query || '').trim().toLowerCase();
    const groups = new Map();
    (state.changeLogs || []).forEach((log) => {
      if (filterCat !== 'all' && log.category !== filterCat) return;
      if (q && !`${log.projectName || ''} ${log.message || ''} ${log.date || ''}`.toLowerCase().includes(q)) return;
      const d = log.date || '기타';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(log);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  // ---- Project Hierarchy (Level 1 = Top, Drag & Drop Nesting / Unnesting) ----
  function getProjectLevel(projectId) {
    let level = 1;
    let cur = findParaEntity(projectId);
    const seen = new Set();
    while (cur && cur.parentProjectId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = findParaEntity(cur.parentProjectId);
      if (!p) break;
      level++;
      cur = p;
      if (level > 10) break;
    }
    return level;
  }

  function isProjectAncestor(possibleAncestorId, targetId) {
    let cur = findParaEntity(targetId);
    const seen = new Set();
    while (cur && cur.parentProjectId && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.parentProjectId === possibleAncestorId) return true;
      cur = findParaEntity(cur.parentProjectId);
    }
    return false;
  }

  function setProjectParent(childId, parentId = '') {
    const child = findParaEntity(childId);
    if (!child || child.paraType !== 'project') return false;
    if (parentId && (parentId === childId || isProjectAncestor(childId, parentId))) return false;
    child.parentProjectId = parentId ? String(parentId) : '';
    child.updatedAt = Date.now();
    persistParaEntities();
    const parent = parentId ? findParaEntity(parentId) : null;
    logChange({
      category: 'project',
      projectName: child.name,
      message: parent
        ? `프로젝트 계층 변경: "${child.name}" → "${parent.name}" 하위 (Lv.${getProjectLevel(child.id)})`
        : `프로젝트 계층 해제: "${child.name}" 최상위 (Lv.1)`
    });
    return true;
  }

  // ---- GTD Next Actions & Current Running Tasks & Overdue->Waiting Auto-Sync ----
  function isTaskCurrentlyRunning(doc, todayYmd = getLocalYmd()) {
    if (!doc || doc.completed) return false;
    if (getCardRole(doc) !== 'T') return false;
    const s = String(doc.startDate || '').trim();
    const e = String(doc.endDate || '').trim();
    if (!s && !e) return false;
    if (s && e) return todayYmd >= s && todayYmd <= e;
    if (s) return todayYmd >= s;
    return todayYmd <= e;
  }

  function addNextActionToDoc(doc, { text = '', context = '@PC', time = '@30분', energy = '@중간' }) {
    if (!doc || !String(text || '').trim()) return null;
    if (!Array.isArray(doc.nextActions)) doc.nextActions = [];
    const na = {
      id: `na-${genId()}`,
      text: String(text).trim(),
      context: String(context || '@PC').trim(),
      time: String(time || '@30분').trim(),
      energy: String(energy || '@중간').trim(),
      done: false,
      createdAt: Date.now()
    };
    doc.nextActions.push(na);
    touchNode(doc);
    persistFS();
    const rels = getRelationsForNode(doc.id);
    const proj = (rels.projects || []).find((x) => x.node?.type === 'para-entity')?.node;
    logChange({
      category: 'task',
      projectName: proj?.name || '',
      message: `다음 행동 추가 ("${doc.name.replace(/\.md$/i, '')}"): ${na.text} [${na.context} ${na.time} ${na.energy}]`
    });
    return na;
  }

  function toggleNextActionOnDoc(doc, naId) {
    if (!doc || !Array.isArray(doc.nextActions)) return false;
    const item = doc.nextActions.find((x) => x.id === naId);
    if (!item) return false;
    item.done = !item.done;
    touchNode(doc);
    persistFS();
    return true;
  }

  function deleteNextActionOnDoc(doc, naId) {
    if (!doc || !Array.isArray(doc.nextActions)) return false;
    const before = doc.nextActions.length;
    doc.nextActions = doc.nextActions.filter((x) => x.id !== naId);
    if (doc.nextActions.length !== before) {
      touchNode(doc);
      persistFS();
      return true;
    }
    return false;
  }

  function syncOverdueTasksToWaiting(todayYmd = getLocalYmd()) {
    let movedCount = 0;
    collectAllNodes(state.fileSystem).forEach((doc) => {
      if (!doc || doc.type !== 'doc' || doc.completed) return;
      if (getCardRole(doc) !== 'T') return;
      if (doc.endDate && doc.endDate < todayYmd) {
        if (doc.gtdStatus !== 'waiting' || !doc.missedToWaiting) {
          doc.gtdStatus = 'waiting';
          doc.missedToWaiting = true;
          movedCount++;
        }
      } else if (doc.missedToWaiting && (!doc.endDate || doc.endDate >= todayYmd)) {
        doc.missedToWaiting = false;
        if (doc.gtdStatus === 'waiting' && !doc.delegatedTo) doc.gtdStatus = 'active';
      }
    });
    if (movedCount > 0) persistFS({ silent: true });
    return movedCount;
  }

  function getProjectOverdueMissedTasks(projectId, visibilityFilter = null, todayYmd = getLocalYmd()) {
    return getProjectLinkedDocs(projectId, visibilityFilter).filter((d) =>
      !d.completed && getCardRole(d) === 'T' && ((d.endDate && d.endDate < todayYmd) || d.missedToWaiting)
    );
  }

  function getProjectNextActionEntries(projectId, visibilityFilter = null) {
    const docs = projectId
      ? getProjectLinkedDocs(projectId, visibilityFilter)
      : collectAllNodes(state.fileSystem).filter((n) => n && n.type === 'doc' && (!visibilityFilter || visibilityFilter(n)));
    const entries = [];
    const todayYmd = getLocalYmd();
    docs.forEach((doc) => {
      if (doc.completed) return;
      const rels = getRelationsForNode(doc.id);
      const proj = projectId
        ? findParaEntity(projectId)
        : ((rels.projects || []).find((x) => x.node?.type === 'para-entity')?.node || null);
      const running = isTaskCurrentlyRunning(doc, todayYmd);
      // 1. Explicit sub nextActions on this doc
      if (Array.isArray(doc.nextActions)) {
        doc.nextActions.forEach((na) => {
          if (na.done) return;
          entries.push({
            kind: 'sub-action',
            id: na.id,
            text: na.text,
            context: na.context || '@PC',
            time: na.time || '@30분',
            energy: na.energy || '@중간',
            doc,
            project: proj,
            isRunningTask: running
          });
        });
      }
      // 2. Standalone next action card (gtdStatus === 'next')
      if (doc.gtdStatus === 'next' && getCardRole(doc) === 'T') {
        entries.push({
          kind: 'card-action',
          id: `card-${doc.id}`,
          text: String(doc.name || '').replace(/\.md$/i, ''),
          context: doc.gtdContext || '@PC',
          time: doc.gtdTime || '@30분',
          energy: doc.gtdEnergy || '@중간',
          doc,
          project: proj,
          isRunningTask: running
        });
      }
    });
    return entries;
  }

  // ---- Local Folder Relation File Export & Import (Skipping Missing Files Silently!) ----
  function getNodeRelativePathString(nodeId) {
    const pathNodes = getPathToNode(nodeId) || [];
    if (pathNodes.length <= 1) return '';
    return pathNodes.slice(1).map((n) => n.name).join('/');
  }

  function buildRelationsExportPayload() {
    const docMetaById = {};
    collectAllNodes(state.fileSystem).forEach((n) => {
      if (!n || n.id === 'root') return;
      docMetaById[n.id] = {
        id: n.id,
        name: n.name,
        type: n.type,
        relPath: getNodeRelativePathString(n.id),
        cardRole: n.type === 'doc' ? getCardRole(n) : undefined,
        resultSubtype: n.resultSubtype || undefined,
        isTodayCore: Boolean(n.isTodayCore) || undefined,
        customTags: Array.isArray(n.customTags) ? n.customTags : undefined,
        startDate: n.startDate || undefined,
        endDate: n.endDate || undefined,
        gtdStatus: n.gtdStatus || undefined,
        gtdContext: n.gtdContext || undefined,
        gtdTime: n.gtdTime || undefined,
        gtdEnergy: n.gtdEnergy || undefined,
        nextActions: Array.isArray(n.nextActions) && n.nextActions.length ? n.nextActions : undefined,
        extractStage: n.extractStage || undefined,
        reuseCount: n.reuseCount || undefined
      };
    });

    const exportedRelations = (state.relations || []).map((r) => {
      const s = resolveAnyNode(r.sourceId);
      const t = resolveAnyNode(r.targetId);
      return {
        id: r.id,
        type: r.type,
        label: r.label || '',
        sourceKind: s?.type === 'para-entity' ? 'para' : 'node',
        sourceId: r.sourceId,
        sourcePath: s?.type === 'para-entity' ? s.id : getNodeRelativePathString(r.sourceId),
        sourceName: s?.name || '',
        targetKind: t?.type === 'para-entity' ? 'para' : 'node',
        targetId: r.targetId,
        targetPath: t?.type === 'para-entity' ? t.id : getNodeRelativePathString(r.targetId),
        targetName: t?.name || ''
      };
    });

    return {
      format: 'secondbrain-relations-v1',
      exportedAt: new Date().toISOString(),
      paraEntities: state.paraEntities || [],
      lifeGoals: state.lifeGoals || [],
      fileMeta: Object.values(docMetaById),
      relations: exportedRelations
    };
  }

  function importRelationsExportPayload(payload) {
    if (!payload || !Array.isArray(payload.relations)) {
      throw new Error('올바른 관계 파일(.json) 형식이 아닙니다.');
    }

    // Build lookup index of existing files in current workspace/local folder
    const allNodes = collectAllNodes(state.fileSystem);
    const byId = new Map();
    const byPath = new Map();
    const byName = new Map();
    allNodes.forEach((n) => {
      byId.set(n.id, n);
      const rp = getNodeRelativePathString(n.id).toLowerCase();
      if (rp) byPath.set(rp, n);
      const nm = String(n.name || '').toLowerCase();
      if (nm && !byName.has(nm)) byName.set(nm, n);
    });

    // 1. Merge PARA entities
    let paraAdded = 0;
    const paraIdRemap = new Map();
    (payload.paraEntities || []).forEach((ent) => {
      if (!ent || !ent.name) return;
      const existing = findParaEntity(ent.id) || (state.paraEntities || []).find(
        (e) => e.paraType === ent.paraType && String(e.name).toLowerCase() === String(ent.name).toLowerCase()
      );
      if (existing) {
        paraIdRemap.set(ent.id, existing.id);
      } else {
        const clone = normalizeParaEntityFields(JSON.parse(JSON.stringify(ent)));
        state.paraEntities.push(clone);
        paraIdRemap.set(ent.id, clone.id);
        paraAdded++;
      }
    });
    if (paraAdded > 0) {
      ensureParaNumbers();
      persistParaEntities();
    }

    // 2. Restore file metadata only for files that actually exist in current folder (ignore missing!)
    let metaApplied = 0;
    let missingFiles = 0;
    (payload.fileMeta || []).forEach((fm) => {
      const node = byId.get(fm.id)
        || (fm.relPath ? byPath.get(String(fm.relPath).toLowerCase()) : null)
        || (fm.name ? byName.get(String(fm.name).toLowerCase()) : null);
      if (!node) {
        missingFiles++;
        return; // 지정 폴더에 파일이 없으면 무시하고 넘어감
      }
      if (fm.cardRole) node.cardRole = fm.cardRole;
      if (fm.resultSubtype) node.resultSubtype = fm.resultSubtype;
      if (fm.isTodayCore !== undefined) node.isTodayCore = Boolean(fm.isTodayCore);
      if (Array.isArray(fm.customTags)) node.customTags = fm.customTags;
      if (fm.startDate) node.startDate = fm.startDate;
      if (fm.endDate) node.endDate = fm.endDate;
      if (fm.gtdStatus) node.gtdStatus = fm.gtdStatus;
      if (fm.gtdContext) node.gtdContext = fm.gtdContext;
      if (fm.gtdTime) node.gtdTime = fm.gtdTime;
      if (fm.gtdEnergy) node.gtdEnergy = fm.gtdEnergy;
      if (Array.isArray(fm.nextActions)) node.nextActions = fm.nextActions;
      if (fm.extractStage) node.extractStage = fm.extractStage;
      if (fm.reuseCount) node.reuseCount = fm.reuseCount;
      metaApplied++;
    });

    // 3. Restore relations only when BOTH endpoints exist (skip missing files silently!)
    let relRestored = 0;
    let relSkippedMissing = 0;
    const resolveEndpoint = (kind, id, relPath, name) => {
      if (kind === 'para') {
        const mapped = paraIdRemap.get(id) || id;
        return findParaEntity(mapped)?.id || null;
      }
      const node = byId.get(id)
        || (relPath ? byPath.get(String(relPath).toLowerCase()) : null)
        || (name ? byName.get(String(name).toLowerCase()) : null);
      return node ? node.id : null;
    };

    (payload.relations || []).forEach((r) => {
      const sId = resolveEndpoint(r.sourceKind, r.sourceId, r.sourcePath, r.sourceName);
      const tId = resolveEndpoint(r.targetKind, r.targetId, r.targetPath, r.targetName);
      if (!sId || !tId) {
        relSkippedMissing++;
        return; // 파일이 없으면 조용히 무시하고 넘어감
      }
      if (addRelation({ sourceId: sId, targetId: tId, type: r.type, label: r.label || '' })) {
        relRestored++;
      }
    });

    if (metaApplied > 0) persistFS();
    logChange({
      category: 'relation',
      message: `관계 파일 불러오기: 관계 ${relRestored}건 복원 (미존재 파일 ${relSkippedMissing}건 무시)`
    });
    return { paraAdded, metaApplied, relRestored, relSkippedMissing, missingFiles };
  }

  function setCardTodayCore(doc, flag, timeStr) {
    if (!doc) return false;
    doc.isTodayCore = Boolean(flag);
    if (timeStr !== undefined) doc.coreTime = String(timeStr || '').trim();
    if (doc.isTodayCore && !doc.cardRole) doc.cardRole = 'T';
    touchNode(doc);
    persistFS();
    return true;
  }

  function getCardTags(doc) {
    if (!doc) return [];
    const set = new Set();
    if (Array.isArray(doc.customTags)) {
      doc.customTags.forEach((t) => {
        const c = String(t || '').trim().replace(/^#+/, '');
        if (c) set.add(c);
      });
    }
    const raw = String(doc.tag || '');
    const matches = raw.match(/#[^\s#]+/g) || [];
    matches.forEach((m) => {
      const c = m.replace(/^#+/, '').trim();
      if (c && !['MD', '수신함', '일일메모', 'Excel', '시트'].includes(c)) set.add(c);
    });
    return Array.from(set);
  }

  function setCardTags(doc, tagsArr) {
    if (!doc) return;
    const clean = Array.from(new Set(
      (Array.isArray(tagsArr) ? tagsArr : String(tagsArr || '').split(/[,\s]+/))
        .map((t) => String(t || '').trim().replace(/^#+/, ''))
        .filter(Boolean)
    ));
    doc.customTags = clean;
    const baseTag = clean.map((t) => `#${t}`).join(' ');
    doc.tag = baseTag || doc.tag || '';
    touchNode(doc);
    persistFS();
  }

  function getSubCards(parentCardId, visibilityFilter = null) {
    if (!parentCardId) return [];
    const map = new Map();
    // 1. Direct parentCardId property
    collectAllNodes(state.fileSystem).forEach((n) => {
      if (!n || n.type !== 'doc' || n.id === parentCardId) return;
      if (n.parentCardId === parentCardId) {
        if (typeof visibilityFilter !== 'function' || visibilityFilter(n)) {
          map.set(n.id, n);
        }
      }
    });
    // 2. Relation DB parent -> child links
    (state.relations || []).forEach((r) => {
      if (r.type === 'parent' && r.sourceId === parentCardId) {
        const child = findNodeAndParent(r.targetId)?.node;
        if (child && child.type === 'doc' && child.id !== parentCardId) {
          if (typeof visibilityFilter !== 'function' || visibilityFilter(child)) {
            map.set(child.id, child);
          }
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function getAllDescendantCards(parentCardId, visibilityFilter = null) {
    if (!parentCardId) return [];
    const visited = new Set([parentCardId]);
    const result = [];
    const queue = [parentCardId];
    while (queue.length > 0) {
      const curId = queue.shift();
      const children = getSubCards(curId, visibilityFilter);
      for (const ch of children) {
        if (!ch || visited.has(ch.id)) continue;
        visited.add(ch.id);
        result.push(ch);
        queue.push(ch.id);
      }
    }
    return result;
  }

  function syncCardParaRelations(docId, { projectIds, areaIds, resourceIds } = {}) {
    const doc = findNodeAndParent(docId)?.node;
    if (!doc) return { added: 0, removed: 0, propagatedSubCount: 0 };
    const descendants = getAllDescendantCards(doc.id);
    let added = 0;
    let removed = 0;

    const syncOneType = (paraType, desiredIds) => {
      if (!Array.isArray(desiredIds)) return;
      const desiredSet = new Set(desiredIds.filter(Boolean));
      const existingRels = (state.relations || []).filter((r) => {
        if (r.type !== paraType) return false;
        if (r.sourceId !== doc.id && r.targetId !== doc.id) return false;
        const otherId = r.sourceId === doc.id ? r.targetId : r.sourceId;
        return Boolean(findParaEntity(otherId));
      });
      const existingEntityIds = new Set();
      existingRels.forEach((r) => {
        const otherId = r.sourceId === doc.id ? r.targetId : r.sourceId;
        existingEntityIds.add(otherId);
        if (!desiredSet.has(otherId)) {
          removeRelation(r.id);
          removed += 1;
        }
      });
      desiredSet.forEach((eid) => {
        if (!existingEntityIds.has(eid) && findParaEntity(eid)) {
          addRelation({ sourceId: doc.id, targetId: eid, type: paraType });
          added += 1;
        } else if (existingEntityIds.has(eid) && (paraType === 'project' || paraType === 'area')) {
          // Ensure existing descendants also inherit currently connected projects/areas
          descendants.forEach((desc) => {
            addRelation({ sourceId: desc.id, targetId: eid, type: paraType, skipPropagate: true });
          });
        }
      });
    };

    syncOneType('project', projectIds);
    syncOneType('area', areaIds);
    syncOneType('resource', resourceIds);
    touchNode(doc);
    persistFS();
    return { added, removed, propagatedSubCount: descendants.length };
  }

  function linkSubCard(parentDoc, childDoc, { inheritPara = true } = {}) {
    if (!parentDoc || !childDoc || parentDoc.id === childDoc.id) return false;
    childDoc.parentCardId = parentDoc.id;
    addRelation({ sourceId: parentDoc.id, targetId: childDoc.id, type: 'parent', label: childDoc.cardRole === 'R' ? '산출물' : '하위 카드' });
    if (inheritPara) {
      const parentRels = getRelationsForNode(parentDoc.id);
      const targets = [childDoc, ...getAllDescendantCards(childDoc.id)];
      (parentRels.projects || []).forEach(({ node }) => {
        if (node?.type === 'para-entity') {
          targets.forEach((d) => addRelation({ sourceId: d.id, targetId: node.id, type: 'project', skipPropagate: true }));
        }
      });
      (parentRels.areas || []).forEach(({ node }) => {
        if (node?.type === 'para-entity') {
          targets.forEach((d) => addRelation({ sourceId: d.id, targetId: node.id, type: 'area', skipPropagate: true }));
        }
      });
      (parentRels.resources || []).forEach(({ node }) => {
        if (node?.type === 'para-entity') {
          targets.forEach((d) => addRelation({ sourceId: d.id, targetId: node.id, type: 'resource', skipPropagate: true }));
        }
      });
    }
    touchNode(childDoc);
    persistFS();
    return true;
  }

  function updateCardSchedule(doc, { startDate, endDate, preservePlannedEnd = true } = {}) {
    if (!doc) return false;
    if (preservePlannedEnd && doc.endDate && !doc.plannedEndDate && endDate && endDate !== doc.endDate) {
      doc.plannedEndDate = doc.endDate;
    }
    if (startDate !== undefined) doc.startDate = String(startDate || '').trim();
    if (endDate !== undefined) doc.endDate = String(endDate || '').trim();
    if (!doc.plannedEndDate && doc.endDate) doc.plannedEndDate = doc.endDate;
    touchNode(doc);
    persistFS();
    return true;
  }

  function getProjectLinkedDocs(projectId, visibilityFilter = null) {
    const map = new Map();
    (state.relations || []).forEach((r) => {
      if (r.sourceId === projectId || r.targetId === projectId) {
        const otherId = r.sourceId === projectId ? r.targetId : r.sourceId;
        const found = findNodeAndParent(otherId)?.node;
        if (found && found.type === 'doc') {
          if (typeof visibilityFilter !== 'function' || visibilityFilter(found)) {
            map.set(found.id, found);
          }
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
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
    normalizeParaEntityFields,
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
    ensureParaNumbers,
    getParaCode,
    getSbFolderName,
    stripSbPrefix,
    persistGlobalTemplates,
    getGlobalTemplates,
    saveGlobalTemplate,
    deleteGlobalTemplate,
    saveProjectTemplate,
    deleteProjectTemplate,
    addProjectRisk,
    updateProjectRisk,
    deleteProjectRisk,
    renderRisksToMarkdown,
    getCardRole,
    setCardRole,
    setCardResultSubtype,
    incrementCardReuse,
    getRecommendedDeliverables,
    createDefaultRequirementTemplate,
    persistLifeGoals,
    saveLifeGoals,
    getLifeGoalById,
    persistGtdTagOptions,
    addCustomGtdTag,
    persistWeeklyReviewConfig,
    updateWeeklyReviewConfig,
    getLocalYmd,
    logChange,
    getChangeLogsGroupedByDate,
    getProjectLevel,
    setProjectParent,
    isTaskCurrentlyRunning,
    addNextActionToDoc,
    toggleNextActionOnDoc,
    deleteNextActionOnDoc,
    syncOverdueTasksToWaiting,
    getProjectOverdueMissedTasks,
    getProjectNextActionEntries,
    buildRelationsExportPayload,
    importRelationsExportPayload,
    setCardTodayCore,
    getCardTags,
    setCardTags,
    getSubCards,
    getAllDescendantCards,
    syncCardParaRelations,
    linkSubCard,
    updateCardSchedule,
    getProjectLinkedDocs,
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
