(function () {
  'use strict';

  const { DEFAULT_FIREBASE_CONFIG, state, getActiveUserEmail, switchUser, clearActiveWorkspace, normalizeParaWorkspace, findParaEntity, resolveAnyNode, persistParaEntities, archiveParaEntity, removeParaEntity, renameParaEntity, declareParaEntity, updateParaEntity, completeAndArchiveProject, getParaEntities, getUnassignedNodes, touchNode, searchAll, genId, regenerateIds, persistFS, persistSettings, persistChat, persistRelations, persistPinnedApps, addRelation, removeRelation, getRelationsForNode, collectAllNodes, getSortMode, setSortMode, getSyncMeta, setSyncMeta, saveStateForUndo, findNodeAndParent, isDescendant, getPathToNode, searchNodes, collectDocsInFolder, getTheme, setTheme } = window.BrainStore;
  const { PROVIDERS, sendChat } = window.BrainAI;
  const { render: renderMarkdown, escapeHtml } = window.BrainMarkdown;
  const BrainAuth = window.BrainAuth;
  const BrainDrive = window.BrainDrive;
  const LocalBridge = window.BrainLocalBridge;
  const BrainLocalFolder = window.BrainLocalFolder;
  const WinManager = window.BrainWindowManager;
  const BrainSheet = window.BrainSpreadsheet;
  const BrainSecurity = window.BrainSecurity;
  const BrainBackup = window.BrainBackup;
  const BrainIcons = window.BrainIcons;
  const BrainSbMirror = window.BrainSbMirror;

  let isEditing = false;
  let isSendingChat = false;
  let isBridgeConnected = false;
  let isGuestMode = false;
  let searchQuery = '';
  let offlineBannerDismissed = false;
  let currentSortMode = getSortMode();
  let isHomeMode = false;
  let paraDashboard = null;
  let autoBackupDirty = false;

  // Desktop multi-selection & marquee state
  let selectedItemIds = new Set();
  let lastClickedItemId = null;
  let currentRenderedItems = [];
  let justFinishedMarquee = false;

  // Google Drive & Local Folder sync + OS window state
  let driveSyncTimer = null;
  let isDriveSyncing = false;
  let driveSyncStatus = 'disconnected'; // 'disconnected' | 'syncing' | 'synced' | 'expired' | 'error'
  let lastDriveErrorMessage = '';
  let lastDriveErrorCode = '';
  let hasSyncedDriveThisSession = false;
  let previewRenderSeq = 0;
  const openMdWindows = new Map(); // itemId -> { win, syncFromItem }
  const mdDriveSyncTimers = new Map(); // itemId -> timerId
  const localFolderTimers = new Map(); // itemId -> timerId
  let localMetaSaveTimer = null;

  // ================= DOM References =================
  const $ = (id) => document.getElementById(id);

  const elTreeRoot = $('tree-root');
  const elParaTreeRoot = $('para-tree-root');
  let activeParaView = null; // null | { mode: 'entity', entityId } | { mode: 'unassigned' }
  const paraCollapsedCats = new Set();
  const elBreadcrumb = $('breadcrumb');
  const elContentArea = $('content-area');
  const elContextMenu = $('context-menu');
  const elGlobalSearch = $('global-search');
  const elBtnClearSearch = $('btn-clear-search');
  const elApiStatusSummary = $('api-status-summary');

  // Preview panel
  const elEmptyState = $('empty-state');
  const elMultiSelectState = $('multi-select-state');
  const elDetailState = $('detail-state');
  const elViewMode = $('view-mode');
  const elEditMode = $('edit-mode');

  // Chat panel
  const elChatProvider = $('chat-provider');
  const elChatModel = $('chat-model');
  const elChatMessages = $('chat-messages');
  const elChatInput = $('chat-input');
  const elBtnSendChat = $('btn-send-chat');
  const elContextBar = $('attached-context-bar');
  const elContextChips = $('context-chips');
  const elContextCountBadge = $('context-count-badge');

  // Settings & Local Folder modals
  const elSettingsModal = $('settings-modal');
  const elLocalFolderModal = $('local-folder-modal');

  // ================= Toast =================
  function showToast(msg, durationMs) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    const isWarn = typeof msg === 'string' && (msg.startsWith('⚠️') || msg.startsWith('🚫'));
    const timeout = durationMs || (isWarn ? 5800 : 2600);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, timeout);
  }

  // ================= Theme & Top More Menu =================
  function closeMoreMenu() {
    const m = $('os-more-menu');
    if (m) m.style.display = 'none';
  }

  function updateThemeMenuLabel(themeName) {
    const lbl = $('theme-menu-label');
    if (lbl) lbl.textContent = themeName === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
  }

  function initTheme() {
    const current = getTheme();
    setTheme(current);
    updateThemeMenuLabel(current);
  }

  $('btn-theme')?.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updateThemeMenuLabel(next);
    closeMoreMenu();
  });

  $('btn-more-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('os-more-menu');
    if (!m) return;
    closeOsNavMenu();
    m.style.display = m.style.display === 'none' ? 'flex' : 'none';
  });

  $('btn-more-local-folder')?.addEventListener('click', () => {
    closeMoreMenu();
    openLocalFolderModal();
  });

  $('btn-more-drive-sync')?.addEventListener('click', () => {
    closeMoreMenu();
    $('btn-drive-sync')?.click();
  });

  $('btn-more-local-bridge')?.addEventListener('click', () => {
    closeMoreMenu();
    refreshBridgeStatus(true);
  });

  $('btn-brand-home')?.addEventListener('click', () => {
    setHomeMode(true);
    paraDashboard?.setActiveView('home');
  });

  $('btn-mode-home')?.addEventListener('click', () => {
    setHomeMode(true);
    paraDashboard?.setActiveView('home');
  });

  $('btn-mode-explorer')?.addEventListener('click', () => {
    setHomeMode(false);
  });

  // ================= Panel Toggle & Resizers =================
  function togglePanel(panelId, btnId, resizerId) {
    const panel = $(panelId);
    const btn = $(btnId);
    const resizer = $(resizerId);
    if (!panel || !resizer) return;
    const hidden = panel.style.display === 'none';
    panel.style.display = hidden ? 'flex' : 'none';
    resizer.style.display = hidden ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', hidden);
    closeMoreMenu();
  }

  $('btn-sidebar')?.addEventListener('click', () => {
    if (isHomeMode) setHomeMode(false);
    togglePanel('sidebar', 'btn-sidebar', 'resizer-left');
  });
  $('btn-right-panel')?.addEventListener('click', () => {
    if (isHomeMode) setHomeMode(false);
    togglePanel('right-panel', 'btn-right-panel', 'resizer-right');
  });

  function initResizer(resizerId, panelId, isLeft) {
    const resizer = $(resizerId);
    const panel = $(panelId);
    let dragging = false;

    resizer.addEventListener('mousedown', (e) => {
      dragging = true;
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (isLeft) {
        const w = e.clientX;
        if (w >= 160 && w <= 420) panel.style.width = `${w}px`;
      } else {
        const w = document.body.clientWidth - e.clientX;
        if (w >= 300 && w <= 720) panel.style.width = `${w}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = 'default';
    });
  }

  initResizer('resizer-left', 'sidebar', true);
  initResizer('resizer-right', 'right-panel', false);

  // ================= Right Panel Tabs =================
  function switchRightTab(tabName) {
    if (isGuestMode && tabName === 'chat') tabName = 'preview';
    document.querySelectorAll('.panel-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    $('panel-preview').classList.toggle('active', tabName === 'preview');
    $('panel-relations')?.classList.toggle('active', tabName === 'relations');
    $('panel-chat').classList.toggle('active', tabName === 'chat');
    if (tabName === 'relations') {
      if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
    } else if (tabName === 'chat') {
      elChatMessages.scrollTop = elChatMessages.scrollHeight;
      elChatInput.focus();
    }
  }

  $('tab-preview').addEventListener('click', () => switchRightTab('preview'));
  $('tab-relations')?.addEventListener('click', () => switchRightTab('relations'));
  $('tab-chat').addEventListener('click', () => switchRightTab('chat'));

  // ================= File System & Dual Tree (PARA Virtual Tree + Physical Storage Tree) =================
  const PARA_TREE_CATS = [
    { type: 'project', num: 1, label: '1. 프로젝트', icon: '🚀' },
    { type: 'area', num: 2, label: '2. 영역', icon: '🧭' },
    { type: 'resource', num: 3, label: '3. 자료', icon: '📚' },
    { type: 'archive', num: 4, label: '4. 보관', icon: '📦' }
  ];

  function getVirtualFilesForParaEntity(entity) {
    if (!entity) return [];
    const map = new Map();
    (state.relations || []).forEach((r) => {
      if (r.sourceId === entity.id || r.targetId === entity.id) {
        const otherId = r.sourceId === entity.id ? r.targetId : r.sourceId;
        const found = findNodeAndParent(otherId)?.node;
        if (found && isItemVisible(found)) {
          map.set(found.id, { node: found, rel: r });
        }
      }
    });
    return Array.from(map.values());
  }

  function createParaEntityRowEl(ent, fallbackIcon, numLabel) {
    const linkedList = getVirtualFilesForParaEntity(ent);
    const isActive = activeParaView && activeParaView.mode === 'entity' && activeParaView.entityId === ent.id && !searchQuery;
    const isArchived = Boolean(ent.archived);
    const row = document.createElement('li');
    row.className = 'para-entity-row' + (isActive ? ' active' : '');
    row.title = `${numLabel} ${ent.name} — 물리 파일을 드래그해 놓으면 연결됩니다`;
    row.innerHTML =
      `<span class="tree-num-prefix">${escapeHtml(numLabel)}</span>` +
      `<span>${ent.icon || fallbackIcon}</span>` +
      `<span class="para-entity-name">${escapeHtml(ent.name)}</span>` +
      `<span class="para-entity-meta">` +
      `  <span class="para-entity-badge">${linkedList.length}</span>` +
      `  <button type="button" class="para-entity-act-btn" title="${isArchived ? '활성 목록으로 복원' : '4. 아카이브로 보내기 (소속 유지)'}">${isArchived ? '↩️' : '📦'}</button>` +
      `  <button type="button" class="para-entity-del" title="선언 삭제 (물리 파일은 유지됨)">✕</button>` +
      `</span>`;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.para-entity-del') || e.target.closest('.para-entity-act-btn')) return;
      clearSearch(false);
      openParaVirtualView({ mode: 'entity', entityId: ent.id });
    });

    row.querySelector('.para-entity-act-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (archiveParaEntity(ent.id, !isArchived)) {
        saveAndRender();
        if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
        showToast(
          !isArchived
            ? `📦 "${ent.name}"이(가) 4. 아카이브(${ent.tag || ent.paraType})로 이동했습니다. (기존 연결·소속 그대로 유지)`
            : `↩️ "${ent.name}"이(가) 활성 목록으로 복원되었습니다.`
        );
      }
    });

    row.querySelector('.para-entity-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (removeParaEntity(ent.id)) {
        if (activeParaView?.entityId === ent.id) {
          openFolder(state.currentFolder || state.fileSystem);
        }
        saveAndRender();
        if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
        showToast(`"${ent.name}" 항목이 제거되었습니다. (물리 파일은 그대로 보존됨)`);
      }
    });

    // 물리 파일을 PARA 엔티티 위로 드래그 앤 드롭하면 즉시 관계 연결
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('folder-drag-hover');
    });
    row.addEventListener('dragleave', () => row.classList.remove('folder-drag-hover'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('folder-drag-hover');
      let dragIds = [];
      try {
        const raw = e.dataTransfer.getData('application/x-brain-ids');
        if (raw) dragIds = JSON.parse(raw);
      } catch (_) {}
      if (dragIds.length === 0) {
        const single = e.dataTransfer.getData('text/plain');
        if (single) dragIds = [single];
      }
      let linkedCnt = 0;
      dragIds.forEach((fid) => {
        const found = findNodeAndParent(fid)?.node;
        if (found && found.id !== 'root') {
          if (addRelation({ sourceId: found.id, targetId: ent.id, type: ent.paraType })) {
            linkedCnt++;
          }
        }
      });
      if (linkedCnt > 0) {
        scheduleDriveSync();
        triggerSbMirrorSync();
        renderParaTree();
        if (activeParaView?.entityId === ent.id) openParaVirtualView(activeParaView);
        if (state.selectedItem) renderDetailRelations(state.selectedItem);
        if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
        if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
        showToast(`🔗 ${linkedCnt}개 파일이 "${ent.name}"에 연결되었습니다.`);
      }
    });

    return row;
  }

  function renderParaTree() {
    if (!elParaTreeRoot) return;
    elParaTreeRoot.innerHTML = '';

    // 1~3: 활성 프로젝트 · 영역 · 리소스 (하위 자동 넘버링 1.1, 1.2...)
    PARA_TREE_CATS.filter((c) => c.type !== 'archive').forEach((cat) => {
      const entities = getParaEntities(cat.type, { onlyActive: true });
      const isCollapsed = paraCollapsedCats.has(cat.type);
      const li = document.createElement('li');
      li.className = 'para-cat-item';

      const head = document.createElement('div');
      head.className = 'para-cat-head';
      head.innerHTML =
        `<div class="para-cat-left">` +
        `  <span style="font-size:0.65rem; width:10px;">${isCollapsed ? '▶' : '▼'}</span>` +
        `  <span>${cat.icon}</span>` +
        `  <span>${escapeHtml(cat.label)}</span>` +
        `  <span class="para-cat-count">(${entities.length})</span>` +
        `</div>` +
        `<button type="button" class="para-cat-add" title="${escapeHtml(cat.label)} 선언 추가">＋</button>`;

      head.addEventListener('click', (e) => {
        if (e.target.closest('.para-cat-add')) return;
        if (isCollapsed) paraCollapsedCats.delete(cat.type);
        else paraCollapsedCats.add(cat.type);
        renderParaTree();
      });

      head.querySelector('.para-cat-add').addEventListener('click', (e) => {
        e.stopPropagation();
        switchRightTab('relations');
        if (typeof openDeclareForm === 'function') {
          openDeclareForm(cat.type);
        }
      });

      li.appendChild(head);

      if (!isCollapsed) {
        const ul = document.createElement('ul');
        ul.className = 'para-entity-list';

        if (entities.length === 0) {
          const emptyRow = document.createElement('li');
          emptyRow.className = 'para-tree-empty-row';
          emptyRow.innerHTML = `<span>항목 없음</span><button type="button" class="sb-empty-cta">· 만들기</button>`;
          emptyRow.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            switchRightTab('relations');
            if (typeof openDeclareForm === 'function') openDeclareForm(cat.type);
          });
          ul.appendChild(emptyRow);
        } else {
          entities.forEach((ent, idx) => {
            const numLabel = `${cat.num}.${idx + 1}`;
            ul.appendChild(createParaEntityRowEl(ent, cat.icon, numLabel));
          });
        }
        li.appendChild(ul);
      }
      elParaTreeRoot.appendChild(li);
    });

    // 4. 보관 (Archives): 프로젝트(4.1) · 영역(4.2) · 자료(4.3)로 소속 유지
    const archivedAll = getParaEntities('archive');
    const isArchCollapsed = paraCollapsedCats.has('archive');
    const archLi = document.createElement('li');
    archLi.className = 'para-cat-item';

    const archHead = document.createElement('div');
    archHead.className = 'para-cat-head';
    archHead.innerHTML =
      `<div class="para-cat-left">` +
      `  <span class="sb-caret-mini">${isArchCollapsed ? '▶' : '▼'}</span>` +
      `  <span>📦</span>` +
      `  <span>4. 보관</span>` +
      `  <span class="para-cat-count">(${archivedAll.length})</span>` +
      `</div>` +
      `<button type="button" class="para-cat-add" title="보관 항목 바로 추가">＋</button>`;
    archHead.addEventListener('click', (e) => {
      if (e.target.closest('.para-cat-add')) return;
      if (isArchCollapsed) paraCollapsedCats.delete('archive');
      else paraCollapsedCats.add('archive');
      renderParaTree();
    });
    archHead.querySelector('.para-cat-add').addEventListener('click', (e) => {
      e.stopPropagation();
      switchRightTab('relations');
      if (typeof openDeclareForm === 'function') openDeclareForm('archive');
    });
    archLi.appendChild(archHead);

    if (!isArchCollapsed) {
      const archUl = document.createElement('ul');
      archUl.className = 'para-entity-list';
      const subDefs = [
        { subType: 'project', subNum: '4.1', label: '프로젝트', icon: '🚀' },
        { subType: 'area', subNum: '4.2', label: '영역', icon: '🧭' },
        { subType: 'resource', subNum: '4.3', label: '자료', icon: '📚' }
      ];

      subDefs.forEach((sd) => {
        const subItems = getParaEntities(sd.subType, { onlyArchived: true });
        const subKey = `arch:${sd.subType}`;
        const subCollapsed = paraCollapsedCats.has(subKey);
        const subLi = document.createElement('li');
        subLi.className = 'para-archive-subcat';

        const subHead = document.createElement('div');
        subHead.className = 'para-archive-subhead';
        subHead.innerHTML =
          `<div class="para-cat-left">` +
          `  <span class="sb-caret-mini">${subCollapsed ? '▶' : '▼'}</span>` +
          `  <span class="tree-num-prefix">${sd.subNum}</span>` +
          `  <span>${sd.icon} ${sd.label}</span>` +
          `  <span class="para-cat-count">(${subItems.length})</span>` +
          `</div>`;
        subHead.addEventListener('click', () => {
          if (subCollapsed) paraCollapsedCats.delete(subKey);
          else paraCollapsedCats.add(subKey);
          renderParaTree();
        });
        subLi.appendChild(subHead);

        if (!subCollapsed) {
          const subUl = document.createElement('ul');
          subUl.className = 'para-archive-sublist';
          if (subItems.length === 0) {
            const emptySub = document.createElement('li');
            emptySub.className = 'para-tree-empty-row';
            emptySub.textContent = '보관된 항목 없음';
            subUl.appendChild(emptySub);
          } else {
            subItems.forEach((ent, idx) => {
              const numLabel = `${sd.subNum}.${idx + 1}`;
              subUl.appendChild(createParaEntityRowEl(ent, sd.icon, numLabel));
            });
          }
          subLi.appendChild(subUl);
        }
        archUl.appendChild(subLi);
      });

      archLi.appendChild(archUl);
    }
    elParaTreeRoot.appendChild(archLi);

    // 수신함(미분류) 바로가기 — 프로젝트·영역·자료 중 하나만 연결해도 자동 정리
    const unassigned = getUnassignedNodes(isItemVisible);
    const unRow = document.createElement('li');
    const isUnActive = activeParaView && activeParaView.mode === 'unassigned' && !searchQuery;
    unRow.className = 'para-entity-row para-inbox-shortcut' + (isUnActive ? ' active' : '');
    unRow.innerHTML =
      `<span>📥</span>` +
      `<span class="para-entity-name">수신함 (미분류)</span>` +
      `<span class="para-entity-meta"><span class="para-entity-badge">${unassigned.length}</span></span>`;
    unRow.addEventListener('click', () => {
      clearSearch(false);
      openParaVirtualView({ mode: 'unassigned' });
    });
    elParaTreeRoot.appendChild(unRow);
  }

  function openParaVirtualView(viewSpec) {
    activeParaView = viewSpec;
    selectedItemIds.clear();
    lastClickedItemId = null;
    renderParaTree();
    renderTree(state.fileSystem, elTreeRoot, true);

    if (viewSpec?.mode === 'unassigned') {
      const items = getUnassignedNodes(isItemVisible);
      renderBreadcrumb(null);
      renderItemsGrid(items, '미지정 파일이 없습니다.', {
        isVirtual: true,
        bannerTitle: '⚠️ 미지정 파일'
      });
      return;
    }

    const ent = findParaEntity(viewSpec?.entityId);
    if (!ent) {
      openFolder(state.currentFolder || state.fileSystem);
      return;
    }
    const pairs = getVirtualFilesForParaEntity(ent);
    const items = pairs.map((p) => p.node);
    const relByNodeId = new Map(pairs.map((p) => [p.node.id, p.rel]));
    renderBreadcrumb(null);
    renderItemsGrid(
      items,
      '연결된 파일이 없습니다.',
      {
        isVirtual: true,
        paraEntity: ent,
        relByNodeId,
        bannerTitle: `${ent.icon} ${ent.name}`
      }
    );
  }

  function getSbMirrorHooks() {
    return {
      isItemVisible,
      getLocalFileNameForItem,
      serializeItemForLocalFile,
      getRelativeFolderPathForItem
    };
  }

  function triggerSbMirrorSync(opts = {}) {
    if (BrainSbMirror && BrainLocalFolder?.isConnected()) {
      BrainSbMirror.scheduleSbMirrorSync(getSbMirrorHooks(), opts);
    }
  }

  function saveAndRender(options = {}) {
    persistFS(options);
    autoBackupDirty = true;
    renderParaTree();
    renderTree(state.fileSystem, elTreeRoot, true);
    if (searchQuery) renderSearchResults(searchQuery);
    else if (activeParaView) openParaVirtualView(activeParaView);
    else openFolder(state.currentFolder);
    renderContextChips();
    if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
    if (isHomeMode && paraDashboard) paraDashboard.renderAll();
    triggerSbMirrorSync();
    if (!options.skipDriveSync) {
      scheduleDriveSync();
    }
  }

  function sortNodesList(items) {
    const mode = currentSortMode || 'default';
    const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
    return [...(items || [])].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (mode === 'updated-desc') {
        const tA = Number(a.updatedAt || a.createdAt || 0);
        const tB = Number(b.updatedAt || b.createdAt || 0);
        if (tB !== tA) return tB - tA;
        return collator.compare(String(a.name || ''), String(b.name || ''));
      }
      if (mode === 'created-desc') {
        const tA = Number(a.createdAt || a.updatedAt || 0);
        const tB = Number(b.createdAt || b.updatedAt || 0);
        if (tB !== tA) return tB - tA;
        return collator.compare(String(a.name || ''), String(b.name || ''));
      }
      if (mode === 'name-asc') {
        return collator.compare(String(a.name || ''), String(b.name || ''));
      }
      if (mode === 'name-desc') {
        return collator.compare(String(b.name || ''), String(a.name || ''));
      }
      if (mode === 'type-asc') {
        const extA = String(a.name || '').includes('.') ? String(a.name).split('.').pop().toLowerCase() : '';
        const extB = String(b.name || '').includes('.') ? String(b.name).split('.').pop().toLowerCase() : '';
        const extCmp = collator.compare(extA, extB);
        if (extCmp !== 0) return extCmp;
        return collator.compare(String(a.name || ''), String(b.name || ''));
      }
      return 0;
    });
  }

  function renderTree(node, container, isRoot = false, numPrefix = '') {
    if (isRoot) container.innerHTML = '';
    const li = document.createElement('li');
    const div = document.createElement('div');
    div.className = 'tree-node' + (!activeParaView && state.currentFolder && state.currentFolder.id === node.id && !searchQuery ? ' active' : '');
    const prefixHtml = numPrefix ? `<span class="tree-num-prefix">${escapeHtml(numPrefix)}</span> ` : '';
    div.innerHTML = `${prefixHtml}<span>${node.icon || '📁'}</span> <span>${escapeHtml(node.name)}</span>`;

    if (node.type === 'folder') {
      div.addEventListener('dragover', (e) => {
        e.preventDefault();
        div.classList.add('folder-drag-hover');
      });
      div.addEventListener('dragleave', () => div.classList.remove('folder-drag-hover'));
      div.addEventListener('drop', (e) => {
        e.preventDefault();
        div.classList.remove('folder-drag-hover');
        handleInternalDrop(e, node);
      });
    }

    div.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSearch(false);
      openFolder(node);
      renderTree(state.fileSystem, elTreeRoot, true);
    });

    // 좌측 폴더 트리 우클릭 컨텍스트 메뉴 지원
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSearch(false);
      openFolder(node);
      renderTree(state.fileSystem, elTreeRoot, true);
      if (node.id !== 'root') {
        selectedItemIds = new Set([node.id]);
        lastClickedItemId = node.id;
        selectItem(node);
      } else {
        selectedItemIds.clear();
        state.selectedItem = null;
      }
      showContextMenu(e);
    });

    li.appendChild(div);
    if (node.children) {
      let subFolders = node.children.filter((c) => c.type === 'folder' && isItemVisible(c));
      if (currentSortMode === 'name-asc' || currentSortMode === 'name-desc') {
        subFolders = sortNodesList(subFolders);
      }
      if (subFolders.length > 0) {
        const ul = document.createElement('ul');
        subFolders.forEach((child, idx) => {
          const childNum = numPrefix ? `${numPrefix}.${idx + 1}` : `${idx + 1}.`;
          renderTree(child, ul, false, childNum);
        });
        li.appendChild(ul);
      }
    }
    container.appendChild(li);
  }

  function renderBreadcrumb(folder) {
    elBreadcrumb.innerHTML = '';
    if (searchQuery) {
      const span = document.createElement('span');
      span.className = 'crumb current';
      span.textContent = `🔍 "${searchQuery}" 검색 결과`;
      elBreadcrumb.appendChild(span);
      return;
    }

    if (activeParaView) {
      const rootCrumb = document.createElement('span');
      rootCrumb.className = 'crumb';
      rootCrumb.textContent = '🧭 PARA 트리';
      rootCrumb.addEventListener('click', () => {
        openFolder(state.currentFolder || state.fileSystem);
        renderTree(state.fileSystem, elTreeRoot, true);
      });
      elBreadcrumb.appendChild(rootCrumb);

      const sep1 = document.createElement('span');
      sep1.className = 'crumb-sep';
      sep1.textContent = '›';
      elBreadcrumb.appendChild(sep1);

      const curCrumb = document.createElement('span');
      curCrumb.className = 'crumb current';
      if (activeParaView.mode === 'unassigned') {
        curCrumb.textContent = '⚠️ 미분류 (지정필요 가상 뷰)';
      } else {
        const ent = findParaEntity(activeParaView.entityId);
        const catMeta = PARA_TREE_CATS.find((c) => c.type === ent?.paraType);
        curCrumb.textContent = ent ? `${catMeta ? catMeta.label + ' › ' : ''}${ent.icon} ${ent.name} (관계 가상 뷰)` : '가상 뷰';
      }
      elBreadcrumb.appendChild(curCrumb);
      return;
    }

    const path = getPathToNode(folder.id) || [state.fileSystem];
    path.forEach((node, idx) => {
      const span = document.createElement('span');
      span.className = 'crumb' + (idx === path.length - 1 ? ' current' : '');
      span.textContent = `${node.icon || '📁'} ${node.name}`;
      span.addEventListener('click', () => {
        openFolder(node);
        renderTree(state.fileSystem, elTreeRoot, true);
      });
      elBreadcrumb.appendChild(span);

      if (idx < path.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '/';
        elBreadcrumb.appendChild(sep);
      }
    });
  }

  // ================= Desktop Multi-Selection & Marquee =================
  function getSelectedItems() {
    const items = [];
    const seen = new Set();
    const pushNode = (node) => {
      if (!node || node.id === 'root' || seen.has(node.id) || !isItemVisible(node)) return;
      seen.add(node.id);
      items.push(node);
    };

    // Preserve visual order for currently rendered items
    currentRenderedItems.forEach((item) => {
      if (selectedItemIds.has(item.id)) pushNode(item);
    });
    // Include any selected ID not in currentRenderedItems
    selectedItemIds.forEach((id) => {
      if (!seen.has(id)) {
        const found = findNodeAndParent(id);
        if (found?.node) pushNode(found.node);
      }
    });
    if (items.length === 0 && state.selectedItem && state.selectedItem.id !== 'root') {
      pushNode(state.selectedItem);
    }
    return items;
  }

  function syncCardSelectionVisuals() {
    elContentArea.querySelectorAll('.item-card').forEach((card) => {
      card.classList.toggle('selected', selectedItemIds.has(card.dataset.itemId));
    });
  }

  function renderMultiSelectPanel(items) {
    isEditing = false;
    elEmptyState.style.display = 'none';
    elDetailState.style.display = 'none';
    if (!elMultiSelectState) return;
    elMultiSelectState.style.display = 'flex';
    const countEl = $('multi-select-count');
    const listEl = $('multi-select-list');
    if (countEl) countEl.textContent = `✅ ${items.length}개 항목 선택됨`;
    if (listEl) {
      const preview = items.slice(0, 12);
      listEl.innerHTML = preview.map((it) =>
        `<div class="multi-select-row">` +
        `  <span class="multi-select-ico">${escapeHtml(it.icon || (it.type === 'folder' ? '📁' : '📄'))}</span>` +
        `  <span class="multi-select-name">${escapeHtml(it.name)}</span>` +
        `</div>`
      ).join('') + (items.length > 12 ? `<div class="multi-select-more">… 외 ${items.length - 12}개 항목</div>` : '');
    }
  }

  function updateSelectionPanel() {
    const items = getSelectedItems();
    if (items.length === 0) {
      clearSelectionView();
      return;
    }
    if (items.length === 1) {
      selectItem(items[0], { preserveMulti: true });
      return;
    }
    state.selectedItem = items[items.length - 1];
    renderMultiSelectPanel(items);
  }

  function setSelectedItemIds(ids, primaryId = null) {
    selectedItemIds = new Set(Array.from(ids || []).filter(Boolean));
    if (selectedItemIds.size === 0) {
      state.selectedItem = null;
      syncCardSelectionVisuals();
      clearSelectionView();
      return;
    }
    if (primaryId && selectedItemIds.has(primaryId)) {
      const found = findNodeAndParent(primaryId);
      state.selectedItem = found?.node || null;
    }
    syncCardSelectionVisuals();
    updateSelectionPanel();
  }

  function selectAllVisibleItems() {
    if (!currentRenderedItems.length) return;
    const ids = currentRenderedItems.map((it) => it.id);
    lastClickedItemId = ids[0] || null;
    setSelectedItemIds(ids, ids[ids.length - 1]);
  }

  function renderItemsGrid(items, emptyMessage, virtualOpts = null) {
    elContentArea.innerHTML = '';
    updateLocalLockBanner();

    if (virtualOpts?.isVirtual) {
      const banner = document.createElement('div');
      banner.className = 'para-virtual-banner';
      banner.innerHTML =
        `<div>` +
        `  <div style="font-weight:750; margin-bottom:2px;">${escapeHtml(virtualOpts.bannerTitle || '🔗 관계 가상 뷰')}</div>` +
        `  <div style="font-size:0.72rem; color:var(--text-sub);">${escapeHtml(virtualOpts.bannerSub || '')}</div>` +
        `</div>` +
        `<button type="button" class="btn-xs-inline" id="btn-exit-para-virtual">💾 물리 보관소로 돌아가기</button>`;
      banner.querySelector('#btn-exit-para-virtual')?.addEventListener('click', () => {
        openFolder(state.currentFolder || state.fileSystem);
        renderTree(state.fileSystem, elTreeRoot, true);
      });
      elContentArea.appendChild(banner);
    }

    const visibleItems = (items || []).filter((item) => isItemVisible(item));
    if (visibleItems.length === 0) {
      currentRenderedItems = [];
      const empty = document.createElement('div');
      empty.className = 'empty-folder-hint';
      empty.textContent = emptyMessage || '이 폴더는 비어 있습니다. 우클릭하거나 상단 버튼으로 폴더/메모를 만들어 보세요.';
      elContentArea.appendChild(empty);
      return;
    }

    // 폴더 먼저, 그 다음 선택된 정렬 기준 적용
    const sorted = sortNodesList(visibleItems);
    currentRenderedItems = sorted;

    sorted.forEach((item) => {
      const isSelected = selectedItemIds.has(item.id) || (selectedItemIds.size === 0 && state.selectedItem && state.selectedItem.id === item.id);
      const isGhost = Boolean(virtualOpts?.isVirtual && virtualOpts?.paraEntity);
      const linkedRel = isGhost ? virtualOpts.relByNodeId?.get(item.id) : null;
      const card = document.createElement('div');
      card.className = 'item-card' + (isSelected ? ' selected' : '') + (isGhost ? ' is-virtual-ghost' : '');
      card.dataset.itemId = item.id;
      card.draggable = true;
      card.innerHTML =
        (isGhost ? `<span class="item-virtual-badge" title="관계에 의해 보이는 가상 항목 (원본은 물리 보관소에 위치)">🔗 가상</span>` : '') +
        (item.driveFile ? `<span class="item-cloud-badge" title="Google Drive 동기화 파일">☁️</span>` : '') +
        `<div class="item-icon">${escapeHtml(item.icon || (item.type === 'folder' ? '📁' : '📄'))}</div>` +
        `<div class="item-name">${escapeHtml(item.name)}</div>` +
        (item.tag ? `<div class="item-tag-mini">${escapeHtml(item.tag)}</div>` : '') +
        (linkedRel ? `<button type="button" class="item-virtual-unlink" title="이 PARA 항목과의 연결만 해제 (물리 파일 본체는 유지)">연결 해제</button>` : '');

      card.querySelector('.item-virtual-unlink')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (linkedRel && removeRelation(linkedRel.id)) {
          scheduleDriveSync();
          renderParaTree();
          openParaVirtualView(activeParaView);
          if (state.selectedItem) renderDetailRelations(state.selectedItem);
          if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
          showToast('가상 연결이 해제되었습니다. (물리 파일 본체는 그대로 유지됨)');
        }
      });

      card.addEventListener('dragstart', (e) => {
        const dragIds = (selectedItemIds.has(item.id) && selectedItemIds.size > 1)
          ? Array.from(selectedItemIds)
          : [item.id];
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.setData('application/x-brain-ids', JSON.stringify(dragIds));
      });

      if (item.type === 'folder') {
        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          card.classList.add('folder-drag-hover');
        });
        card.addEventListener('dragleave', () => card.classList.remove('folder-drag-hover'));
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove('folder-drag-hover');
          handleInternalDrop(e, item);
        });
      }

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.item-rename-input')) return;
        elContextMenu.style.display = 'none';

        if (e.shiftKey && lastClickedItemId) {
          const idxA = currentRenderedItems.findIndex((x) => x.id === lastClickedItemId);
          const idxB = currentRenderedItems.findIndex((x) => x.id === item.id);
          if (idxA !== -1 && idxB !== -1) {
            const lo = Math.min(idxA, idxB);
            const hi = Math.max(idxA, idxB);
            const rangeIds = currentRenderedItems.slice(lo, hi + 1).map((x) => x.id);
            const nextIds = (e.ctrlKey || e.metaKey)
              ? new Set([...selectedItemIds, ...rangeIds])
              : new Set(rangeIds);
            setSelectedItemIds(nextIds, item.id);
            return;
          }
        }

        if (e.ctrlKey || e.metaKey) {
          const nextIds = new Set(selectedItemIds);
          if (nextIds.has(item.id)) nextIds.delete(item.id);
          else nextIds.add(item.id);
          lastClickedItemId = item.id;
          setSelectedItemIds(nextIds, item.id);
          return;
        }

        lastClickedItemId = item.id;
        selectedItemIds = new Set([item.id]);
        syncCardSelectionVisuals();
        selectItem(item);
      });

      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('.item-rename-input')) return;
        if (item.type === 'folder') {
          clearSearch(false);
          openFolder(item);
          renderTree(state.fileSystem, elTreeRoot, true);
        } else if (isSpreadsheetItem(item)) {
          selectItem(item);
          openSpreadsheetWindow(item);
        } else if (item.driveFile && item.driveFile.id) {
          selectItem(item);
          openDriveFileViewer(item);
        } else if (item.link && LocalBridge.isWebUrl(item.link)) {
          window.open(item.link, '_blank', 'noopener,noreferrer');
        } else if (item.link && LocalBridge.isLocalPath(item.link)) {
          launchLocalItem(item.link, 'open');
        } else if (isHtmlContentItem(item)) {
          selectItem(item);
          openHtmlWindow(item);
        } else if (isMarkdownDocItem(item)) {
          selectItem(item);
          openMarkdownWindow(item, 'view');
        } else if (isBridgeConnected && isOwnerAuthenticated() && /\.[a-z0-9]{1,8}$/i.test(String(item.name || '').trim()) && !isBinaryFileName(item.name)) {
          openMemoInLocalApp(item);
        } else {
          selectItem(item);
          toggleEditMode(true);
        }
      });

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!(selectedItemIds.has(item.id) && selectedItemIds.size > 1)) {
          lastClickedItemId = item.id;
          selectedItemIds = new Set([item.id]);
          syncCardSelectionVisuals();
          selectItem(item);
        }
        showContextMenu(e);
      });

      elContentArea.appendChild(card);
    });
  }

  // 바탕화면 빈 영역 왼쪽 클릭 드래그로 영역 선택 (Rubber-band Marquee Selection)
  elContentArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.item-card, .item-rename-input')) return;
    e.preventDefault();
    elContextMenu.style.display = 'none';

    const areaRect = elContentArea.getBoundingClientRect();
    const startX = e.clientX - areaRect.left + elContentArea.scrollLeft;
    const startY = e.clientY - areaRect.top + elContentArea.scrollTop;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const toggleMode = e.ctrlKey || e.metaKey;
    const baseIds = additive ? new Set(selectedItemIds) : new Set();

    let marqueeEl = null;
    let didDrag = false;

    const onMove = (ev) => {
      const curRect = elContentArea.getBoundingClientRect();
      const maxW = Math.max(elContentArea.scrollWidth, curRect.width);
      const maxH = Math.max(elContentArea.scrollHeight, curRect.height);
      const curX = Math.max(0, Math.min(maxW, ev.clientX - curRect.left + elContentArea.scrollLeft));
      const curY = Math.max(0, Math.min(maxH, ev.clientY - curRect.top + elContentArea.scrollTop));

      if (!didDrag) {
        if (Math.hypot(curX - startX, curY - startY) < 4) return;
        didDrag = true;
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'desktop-marquee';
        elContentArea.appendChild(marqueeEl);
      }

      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      marqueeEl.style.left = `${left}px`;
      marqueeEl.style.top = `${top}px`;
      marqueeEl.style.width = `${width}px`;
      marqueeEl.style.height = `${height}px`;

      // Convert marquee box to viewport coords for pixel-accurate intersection test
      const mLeft = curRect.left - elContentArea.scrollLeft + left;
      const mTop = curRect.top - elContentArea.scrollTop + top;
      const mRight = mLeft + width;
      const mBottom = mTop + height;

      const hitIds = new Set();
      elContentArea.querySelectorAll('.item-card').forEach((card) => {
        const r = card.getBoundingClientRect();
        const intersects = !(r.right < mLeft || r.left > mRight || r.bottom < mTop || r.top > mBottom);
        if (intersects) hitIds.add(card.dataset.itemId);
      });

      const nextIds = new Set(baseIds);
      if (toggleMode) {
        hitIds.forEach((id) => {
          if (baseIds.has(id)) nextIds.delete(id);
          else nextIds.add(id);
        });
      } else {
        hitIds.forEach((id) => nextIds.add(id));
      }

      selectedItemIds = nextIds;
      syncCardSelectionVisuals();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (marqueeEl) {
        marqueeEl.remove();
        marqueeEl = null;
      }

      if (didDrag) {
        justFinishedMarquee = true;
        setTimeout(() => { justFinishedMarquee = false; }, 0);
        const items = getSelectedItems();
        if (items.length > 0) {
          lastClickedItemId = items[items.length - 1].id;
        }
        updateSelectionPanel();
      } else if (!additive) {
        selectedItemIds.clear();
        lastClickedItemId = null;
        syncCardSelectionVisuals();
        clearSelectionView();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function openFolder(folder) {
    const wasVirtual = Boolean(activeParaView);
    activeParaView = null;
    const folderChanged = wasVirtual || (state.currentFolder && folder && state.currentFolder.id !== folder.id);
    state.currentFolder = folder;
    if (folderChanged) {
      selectedItemIds.clear();
      lastClickedItemId = null;
    }
    renderParaTree();
    renderBreadcrumb(folder);
    renderItemsGrid(folder.children || []);
  }

  const elGlobalSearchPopover = $('global-search-popover');

  function closeGlobalSearchPopover() {
    if (elGlobalSearchPopover) elGlobalSearchPopover.style.display = 'none';
  }

  function renderGlobalSearchPopover(query) {
    if (!elGlobalSearchPopover) return;
    const q = String(query || '').trim();
    if (!q) {
      closeGlobalSearchPopover();
      return;
    }

    const res = searchAll(q, isItemVisible) || {};
    const paraList = res.paraEntities || [];
    const fileList = res.files || [];
    const relList = res.relations || [];
    const totalHits = paraList.length + fileList.length + relList.length;
    const paraLabelMap = { project: '프로젝트', area: '영역', resource: '자료', archive: '보관' };
    const relTypeMap = { project: '프로젝트', area: '영역', resource: '자료', parent: '상하', related: '연관', reference: '참조' };

    let html = '';
    if (paraList.length > 0) {
      html += `<div class="sb-sp-section"><div class="sb-sp-title">PARA 항목 (${paraList.length})</div>`;
      paraList.slice(0, 6).forEach((ent) => {
        const badge = ent.archived ? '보관' : (paraLabelMap[ent.paraType] || 'PARA');
        html +=
          `<button type="button" class="sb-sp-row" data-sp-kind="para" data-sp-id="${escapeHtml(ent.id)}">` +
          `  <span class="sb-sp-main">${escapeHtml(ent.name)}</span>` +
          `  <span class="sb-sp-badge">${escapeHtml(badge)}</span>` +
          `</button>`;
      });
      html += `</div>`;
    }

    if (fileList.length > 0) {
      html += `<div class="sb-sp-section"><div class="sb-sp-title">메모 · 파일 (${fileList.length})</div>`;
      fileList.slice(0, 8).forEach((n) => {
        const tag = n.type === 'folder' ? '폴더' : (n.tag ? n.tag.split(/\s+/)[0] : '문서');
        html +=
          `<button type="button" class="sb-sp-row" data-sp-kind="node" data-sp-id="${escapeHtml(n.id)}">` +
          `  <span class="sb-sp-main">${escapeHtml(n.name)}</span>` +
          `  <span class="sb-sp-badge">${escapeHtml(tag)}</span>` +
          `</button>`;
      });
      html += `</div>`;
    }

    if (relList.length > 0) {
      html += `<div class="sb-sp-section"><div class="sb-sp-title">연결 관계 (${relList.length})</div>`;
      relList.slice(0, 5).forEach(({ rel, source, target }) => {
        const relLabel = rel.label || relTypeMap[rel.type] || '연결';
        html +=
          `<button type="button" class="sb-sp-row" data-sp-kind="rel" data-sp-id="${escapeHtml(source.id)}">` +
          `  <span class="sb-sp-main">${escapeHtml(source.name)} ↔ ${escapeHtml(target.name)}</span>` +
          `  <span class="sb-sp-badge">${escapeHtml(relLabel)}</span>` +
          `</button>`;
      });
      html += `</div>`;
    }

    if (totalHits === 0) {
      html += `<div class="sb-sp-empty">"${escapeHtml(q)}"에 해당하는 메모 · 파일 · 관계 · PARA가 없습니다.</div>`;
    }

    html +=
      `<div class="sb-sp-foot">` +
      `  <button type="button" class="sb-sp-quick-save" data-sp-kind="quick-memo">` +
      `    <span>＋ "${escapeHtml(q)}" 수신함에 빠른 메모로 저장</span>` +
      `    <kbd>Ctrl+Enter</kbd>` +
      `  </button>` +
      `</div>`;

    elGlobalSearchPopover.innerHTML = html;
    elGlobalSearchPopover.style.display = 'block';

    elGlobalSearchPopover.querySelectorAll('.sb-sp-row, .sb-sp-quick-save').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const kind = btn.dataset.spKind;
        const id = btn.dataset.spId;
        if (kind === 'quick-memo') {
          if (paraDashboard) {
            paraDashboard.captureQuickMemo({ title: q, body: q });
          }
          clearSearch(false);
          closeGlobalSearchPopover();
          return;
        }
        closeGlobalSearchPopover();
        if (kind === 'para') {
          const ent = findParaEntity(id);
          if (!ent) return;
          if (isHomeMode && paraDashboard) {
            if (ent.paraType === 'project') paraDashboard.openProjectDetail(ent.id, 'cards');
            else paraDashboard.openProjectModal(ent);
          } else {
            openParaVirtualView({ mode: 'entity', entityId: ent.id });
          }
        } else if (kind === 'node') {
          const found = findNodeAndParent(id)?.node;
          if (!found) return;
          if (found.type === 'folder') {
            setHomeMode(false);
            openFolder(found);
          } else {
            launchItemDirectly(found);
          }
        } else if (kind === 'rel') {
          const found = resolveAnyNode(id);
          if (!found) return;
          setHomeMode(false);
          navigateToNode(found);
          switchRightTab('relations');
        }
      });
    });
  }

  function renderSearchResults(query) {
    const results = searchNodes(query).filter((item) => isItemVisible(item));
    renderBreadcrumb(state.currentFolder);
    renderItemsGrid(results, `"${query}"에 해당하는 메모나 폴더가 없습니다.`);
  }

  function clearSearch(rerender = true) {
    searchQuery = '';
    elGlobalSearch.value = '';
    elBtnClearSearch.style.display = 'none';
    closeGlobalSearchPopover();
    if (rerender && !isHomeMode) openFolder(state.currentFolder);
  }

  elGlobalSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    elBtnClearSearch.style.display = searchQuery ? 'inline-block' : 'none';
    renderGlobalSearchPopover(searchQuery);
    if (!isHomeMode) {
      if (searchQuery) renderSearchResults(searchQuery);
      else openFolder(state.currentFolder);
    }
  });

  elGlobalSearch.addEventListener('focus', () => {
    if (searchQuery) renderGlobalSearchPopover(searchQuery);
  });

  elGlobalSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeGlobalSearchPopover();
      elGlobalSearch.blur();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const q = elGlobalSearch.value.trim();
      if (q && paraDashboard) {
        e.preventDefault();
        paraDashboard.captureQuickMemo({ title: q, body: q });
        clearSearch(false);
      }
    }
  });

  elBtnClearSearch.addEventListener('click', () => clearSearch(true));

  // ================= CRUD, Rename, Clipboard & Undo =================
  function getUniqueNameInFolder(folder, baseName, ext = '') {
    const existing = new Set((folder?.children || []).map((c) => String(c.name || '').toLowerCase()));
    const first = `${baseName}${ext}`;
    if (!existing.has(first.toLowerCase())) return first;
    let n = 2;
    while (existing.has(`${baseName} ${n}${ext}`.toLowerCase())) n++;
    return `${baseName} ${n}${ext}`;
  }

  function syncOpenWindowsForItem(item) {
    if (!item) return;
    const mdWin = WinManager.getWindow(`md-${item.id}`);
    if (mdWin) mdWin.setTitle(item.name);
    const fileWin = WinManager.getWindow(`file-${item.id}`);
    if (fileWin) fileWin.setTitle(item.name);
    const htmlWin = WinManager.getWindow(`html-${item.id}`);
    if (htmlWin) htmlWin.setTitle(item.name);
    const sheetWin = WinManager.getWindow(`sheet-${item.id}`);
    if (sheetWin) sheetWin.setTitle(item.name);
    const mdEntry = openMdWindows.get(item.id);
    if (mdEntry && typeof mdEntry.syncFromItem === 'function') {
      mdEntry.syncFromItem();
    }
  }

  function applyItemRename(item, rawNewName) {
    const trimmed = String(rawNewName || '').trim();
    if (!item || !trimmed || trimmed === item.name) return false;
    const oldName = item.type === 'folder' ? item.name : getLocalFileNameForItem(item);
    const parentSegs = getRelativeFolderPathForItem(item.id);
    saveStateForUndo();
    item.name = trimmed;
    touchNode(item);
    if (item.driveFile) item.driveFile.name = trimmed;
    saveAndRender();
    if (state.selectedItem && state.selectedItem.id === item.id) {
      selectItem(item);
    }
    syncOpenWindowsForItem(item);

    // 로컬 폴더 동기화 (이름 변경 반영)
    if (BrainLocalFolder && BrainLocalFolder.isConnected()) {
      const newLocalName = item.type === 'folder' ? item.name : getLocalFileNameForItem(item);
      if (BrainLocalFolder.getStatus().mode === 'bridge') {
        BrainLocalFolder.renameEntry(parentSegs, oldName, parentSegs, newLocalName)
          .then(() => scheduleLocalWorkspaceMetaSave())
          .catch(() => {});
      } else {
        syncSubtreeToLocalFolder(item)
          .then(() => {
            if (oldName !== newLocalName) return BrainLocalFolder.removeEntry(parentSegs, oldName);
          })
          .then(() => scheduleLocalWorkspaceMetaSave())
          .catch(() => {});
      }
    }

    // Google Drive 실제 파일 이름도 함께 변경
    const driveIdToRename = item.driveDocId || item.driveFile?.id;
    const driveToken = BrainAuth.getDriveAccessToken();
    if (driveIdToRename && driveToken) {
      BrainDrive.renameFile(driveToken, driveIdToRename, trimmed).catch((err) => {
        console.warn('Drive 파일 이름 변경 실패:', err);
      });
    } else if (item.type === 'doc') {
      scheduleDocFileSyncToDrive(item, true);
    }

    showToast(`✏️ 이름이 "${trimmed}"(으)로 변경되었습니다.`);
    return true;
  }

  function startRenameItem(item) {
    if (!item || item.id === 'root') {
      showToast('이름을 바꿀 항목을 먼저 선택해 주세요.');
      return;
    }

    const card = elContentArea.querySelector(`.item-card[data-item-id="${CSS.escape(item.id)}"]`);
    const nameEl = card ? card.querySelector('.item-name') : null;

    if (!nameEl) {
      const next = prompt('새 이름을 입력하세요:', item.name || '');
      if (next !== null) applyItemRename(item, next);
      return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'item-rename-input';
    input.value = item.name || '';

    nameEl.replaceWith(input);
    input.focus();

    // 확장자 앞부분만 자동 선택 (Windows 탐색기 방식)
    const dotIdx = item.type === 'doc' ? input.value.lastIndexOf('.') : -1;
    if (dotIdx > 0) {
      input.setSelectionRange(0, dotIdx);
    } else {
      input.select();
    }

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      const val = input.value;
      if (commit && val.trim() && val.trim() !== item.name) {
        applyItemRename(item, val);
      } else {
        if (searchQuery) renderSearchResults(searchQuery);
        else openFolder(state.currentFolder);
      }
    };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function getFolderPathSegments(folderNode) {
    if (!folderNode || folderNode.id === 'root') return [];
    const pathNodes = getPathToNode(folderNode.id) || [];
    if (pathNodes.length <= 1) return [];
    return pathNodes.slice(1).map((n) => n.name);
  }

  function syncMovedNodeToDrive(node) {
    if (!node || !isOwnerAuthenticated()) return;
    const driveToken = BrainAuth.getDriveAccessToken();
    if (!driveToken) return;
    const userEmail = BrainAuth.getUser()?.email || '';
    const driveId = node.driveDocId || node.driveFile?.id;
    if (driveId) {
      const newFolderPath = getRelativeFolderPathForItem(node.id);
      BrainDrive.moveFile(driveToken, driveId, newFolderPath, userEmail).catch((err) => {
        console.warn('Drive 파일 이동 실패:', err);
      });
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => syncMovedNodeToDrive(child));
    }
  }

  function createNew(type) {
    saveStateForUndo();
    if (type === 'folder' && activeParaView) {
      activeParaView = null;
    }
    const activeVirtualEnt = (activeParaView && activeParaView.mode === 'entity')
      ? findParaEntity(activeParaView.entityId)
      : null;

    if (type === 'sheet') {
      const newName = getUniqueNameInFolder(state.currentFolder, '새 스프레드시트', '.xlsx');
      const emptyWb = BrainSheet.createEmptyWorkbook('Sheet1');
      const newItem = touchNode({
        id: genId(),
        type: 'doc',
        name: newName,
        icon: '📊',
        tag: '#Excel #시트',
        summary: BrainSheet.workbookToMarkdownSummary(emptyWb),
        link: '',
        sheetData: emptyWb
      }, { isNew: true });
      if (!state.currentFolder.children) state.currentFolder.children = [];
      state.currentFolder.children.push(newItem);
      if (activeVirtualEnt) {
        addRelation({ sourceId: newItem.id, targetId: activeVirtualEnt.id, type: activeVirtualEnt.paraType });
      }
      selectedItemIds = new Set([newItem.id]);
      lastClickedItemId = newItem.id;
      saveAndRender();
      selectItem(newItem);
      syncSpreadsheetToDriveNow(newItem).catch(() => {});
      syncItemToLocalFolderNow(newItem, { allowAutoDownload: true }).catch(() => {});
      openSpreadsheetWindow(newItem);
      const lfStatus = BrainLocalFolder?.getStatus();
      showToast(
        lfStatus?.connected
          ? `📊 "${newName}" 생성 및 로컬 폴더(${lfStatus.folderName})에 저장됨`
          : `📊 새 빈 엑셀 시트(${newName})를 물리 보관소에 만들고 연결했습니다.`
      );
      return;
    }

    const newName = type === 'folder'
      ? getUniqueNameInFolder(state.currentFolder, '새 폴더')
      : getUniqueNameInFolder(state.currentFolder, '새 메모', '.md');
    const newItem = touchNode({
      id: genId(),
      type,
      name: newName,
      icon: type === 'folder' ? '📁' : '📝',
      tag: type === 'folder' ? '' : '#MD',
      summary: '',
      link: '',
      children: type === 'folder' ? [] : undefined
    }, { isNew: true });
    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newItem);
    if (type !== 'folder' && activeVirtualEnt) {
      addRelation({ sourceId: newItem.id, targetId: activeVirtualEnt.id, type: activeVirtualEnt.paraType });
    }
    selectedItemIds = new Set([newItem.id]);
    lastClickedItemId = newItem.id;
    saveAndRender();
    selectItem(newItem);
    if (type === 'folder') {
      const driveToken = BrainAuth.getDriveAccessToken();
      if (driveToken && isOwnerAuthenticated()) {
        const folderSegs = getFolderPathSegments(newItem);
        BrainDrive.ensureFolderPath(driveToken, folderSegs, BrainAuth.getUser()?.email || '').catch(() => {});
      }
      syncItemToLocalFolderNow(newItem).catch(() => {});
      startRenameItem(newItem);
    } else {
      scheduleDocFileSyncToDrive(newItem, true);
      syncItemToLocalFolderNow(newItem, { allowAutoDownload: true }).catch(() => {});
      openMarkdownWindow(newItem, 'split');
    }
    const lfStatus = BrainLocalFolder?.getStatus();
    if (lfStatus?.connected) {
      showToast(
        type === 'folder'
          ? `📁 새 폴더 생성 및 로컬 폴더(${lfStatus.folderName})에 반영됨`
          : `📝 "${newName}" 생성 및 로컬 폴더(${lfStatus.folderName})에 저장됨`
      );
    } else {
      showToast(type === 'folder' ? '새 폴더를 만들었습니다.' : `새 마크다운 메모(${newName})를 만들었습니다.`);
    }
  }

  function execCopy() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    state.clipboard = {
      action: 'copy',
      itemsData: items.map((it) => JSON.parse(JSON.stringify(it)))
    };
    showToast(items.length === 1 ? `복사됨: ${items[0].name}` : `복사됨: ${items.length}개 항목`);
  }

  function execCut() {
    const items = getSelectedItems();
    if (items.length === 0) return;
    state.clipboard = {
      action: 'cut',
      itemsData: items.map((it) => JSON.parse(JSON.stringify(it)))
    };
    showToast(items.length === 1 ? `잘라내기됨: ${items[0].name}` : `잘라내기됨: ${items.length}개 항목`);
  }

  function execPaste() {
    if (!state.clipboard) return;
    const rawList = Array.isArray(state.clipboard.itemsData)
      ? state.clipboard.itemsData
      : (state.clipboard.itemData ? [state.clipboard.itemData] : []);
    if (rawList.length === 0) return;

    const wasCut = state.clipboard.action === 'cut';
    saveStateForUndo();
    if (!state.currentFolder.children) state.currentFolder.children = [];

    const pastedItems = [];
    const oldMoveRecords = [];

    for (const rawItem of rawList) {
      const newItem = JSON.parse(JSON.stringify(rawItem));
      if (wasCut) {
        if (newItem.id === state.currentFolder.id || isDescendant(newItem.id, state.currentFolder.id)) {
          showToast('폴더를 자기 자신의 하위 폴더로 이동할 수 없습니다.');
          continue;
        }
        const original = findNodeAndParent(newItem.id);
        if (original && original.parent) {
          oldMoveRecords.push({
            item: newItem,
            oldSegs: getRelativeFolderPathForItem(newItem.id),
            oldName: newItem.type === 'folder' ? newItem.name : getLocalFileNameForItem(newItem)
          });
          original.parent.children = original.parent.children.filter((c) => c.id !== newItem.id);
        }
      } else {
        newItem.name += ' - 복사본';
        delete newItem.driveDocId;
        regenerateIds(newItem);
      }
      state.currentFolder.children.push(newItem);
      pastedItems.push(newItem);
    }

    if (wasCut) state.clipboard = null;
    if (pastedItems.length === 0) return;

    selectedItemIds = new Set(pastedItems.map((it) => it.id));
    saveAndRender();
    updateSelectionPanel();

    pastedItems.forEach((it) => {
      if (wasCut) syncMovedNodeToDrive(it);
      else if (it.type === 'doc') scheduleDocFileSyncToDrive(it, true);
    });

    if (BrainLocalFolder && BrainLocalFolder.isConnected()) {
      if (wasCut) {
        oldMoveRecords.forEach(({ item, oldSegs, oldName }) => {
          const newSegs = getRelativeFolderPathForItem(item.id);
          const newName = item.type === 'folder' ? item.name : getLocalFileNameForItem(item);
          if (BrainLocalFolder.getStatus().mode === 'bridge') {
            BrainLocalFolder.renameEntry(oldSegs, oldName, newSegs, newName).catch(() => {});
          } else {
            syncSubtreeToLocalFolder(item)
              .then(() => BrainLocalFolder.removeEntry(oldSegs, oldName))
              .catch(() => {});
          }
        });
      } else {
        pastedItems.forEach((it) => syncSubtreeToLocalFolder(it).catch(() => {}));
      }
      scheduleLocalWorkspaceMetaSave();
    }

    showToast(
      pastedItems.length === 1
        ? `붙여넣기 완료: ${pastedItems[0].name}`
        : `붙여넣기 완료: ${pastedItems.length}개 항목`
    );
  }

  function execUndo() {
    if (state.undoStack.length === 0) {
      showToast('되돌릴 작업이 없습니다.');
      return;
    }
    state.fileSystem = JSON.parse(state.undoStack.pop());
    const found = findNodeAndParent(state.currentFolder.id);
    state.currentFolder = found ? found.node : state.fileSystem;
    selectedItemIds.clear();
    lastClickedItemId = null;
    clearSelectionView();
    saveAndRender();
    scheduleLocalWorkspaceMetaSave();
    showToast('실행 취소되었습니다.');
  }

  function execDelete(askConfirm = false) {
    const targets = getSelectedItems();
    if (targets.length === 0) return;
    if (askConfirm) {
      const msg = targets.length === 1
        ? `"${targets[0].name}" 항목을 삭제할까요?`
        : `선택한 ${targets.length}개 항목을 모두 삭제할까요?`;
      if (!confirm(msg)) return;
    }

    saveStateForUndo();
    const deleteLocalRecords = [];

    targets.forEach((target) => {
      const deletedId = target.id;
      const found = findNodeAndParent(deletedId);
      if (found && found.parent) {
        deleteLocalRecords.push({
          folderSegs: getRelativeFolderPathForItem(deletedId),
          entryName: target.type === 'folder' ? target.name : getLocalFileNameForItem(target)
        });
        found.parent.children = found.parent.children.filter((c) => c.id !== deletedId);
      }
      WinManager.getWindow(`md-${deletedId}`)?.close();
      WinManager.getWindow(`file-${deletedId}`)?.close();
      WinManager.getWindow(`html-${deletedId}`)?.close();
      const sViews = openSheetViews.get(deletedId);
      if (sViews) Array.from(sViews).forEach((v) => v.win?.close());
      state.attachedContextIds = state.attachedContextIds.filter((id) => id !== deletedId);
    });

    selectedItemIds.clear();
    lastClickedItemId = null;
    clearSelectionView();
    saveAndRender();

    if (BrainLocalFolder && BrainLocalFolder.isConnected()) {
      deleteLocalRecords.forEach(({ folderSegs, entryName }) => {
        BrainLocalFolder.removeEntry(folderSegs, entryName).catch(() => {});
      });
      scheduleLocalWorkspaceMetaSave();
    }

    showToast(
      targets.length === 1
        ? '삭제되었습니다. (Ctrl+Z로 복구 가능)'
        : `${targets.length}개 항목이 삭제되었습니다. (Ctrl+Z로 복구 가능)`
    );
  }

  // ================= Drag & Drop =================
  function handleInternalDrop(e, targetFolder) {
    let draggedIds = [];
    const rawIds = e.dataTransfer.getData('application/x-brain-ids');
    if (rawIds) {
      try {
        const parsed = JSON.parse(rawIds);
        if (Array.isArray(parsed)) draggedIds = parsed.filter(Boolean);
      } catch (_) {}
    }
    if (draggedIds.length === 0) {
      const single = e.dataTransfer.getData('text/plain');
      if (single) draggedIds = [single];
    }
    if (draggedIds.length === 0) return;

    const movable = [];
    for (const id of draggedIds) {
      if (!id || id === targetFolder.id) continue;
      if (isDescendant(id, targetFolder.id)) {
        showToast('상위 폴더를 하위 폴더 안으로 이동할 수 없습니다.');
        continue;
      }
      const original = findNodeAndParent(id);
      if (original && original.parent && original.parent.id !== targetFolder.id) {
        movable.push({
          id,
          node: original.node,
          parent: original.parent,
          oldSegs: getRelativeFolderPathForItem(id),
          oldName: original.node.type === 'folder' ? original.node.name : getLocalFileNameForItem(original.node)
        });
      }
    }
    if (movable.length === 0) return;

    saveStateForUndo();
    if (!targetFolder.children) targetFolder.children = [];
    movable.forEach(({ id, node, parent }) => {
      parent.children = parent.children.filter((c) => c.id !== id);
      targetFolder.children.push(node);
    });
    selectedItemIds.clear();
    lastClickedItemId = null;
    saveAndRender();

    movable.forEach(({ node, oldSegs, oldName }) => {
      syncMovedNodeToDrive(node);
      if (BrainLocalFolder && BrainLocalFolder.isConnected()) {
        const newSegs = getRelativeFolderPathForItem(node.id);
        const newName = node.type === 'folder' ? node.name : getLocalFileNameForItem(node);
        if (BrainLocalFolder.getStatus().mode === 'bridge') {
          BrainLocalFolder.renameEntry(oldSegs, oldName, newSegs, newName).catch(() => {});
        } else {
          syncSubtreeToLocalFolder(node)
            .then(() => BrainLocalFolder.removeEntry(oldSegs, oldName))
            .catch(() => {});
        }
      }
    });
    scheduleLocalWorkspaceMetaSave();

    showToast(
      movable.length === 1
        ? `"${movable[0].node.name}" 이동 완료`
        : `${movable.length}개 항목을 "${targetFolder.name}" 폴더로 이동했습니다.`
    );
  }

  elContentArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elContentArea.classList.add('drag-over');
  });

  elContentArea.addEventListener('dragleave', () => {
    elContentArea.classList.remove('drag-over');
  });

  function getFileMetaByExt(fileName) {
    const ext = String(fileName || '').includes('.') ? String(fileName).split('.').pop().toLowerCase() : '';
    if (['md', 'txt'].includes(ext)) return { ext, icon: '📝', tag: '#Note' };
    if (['html', 'htm'].includes(ext)) return { ext, icon: '🌐', tag: '#HTML' };
    if (['js', 'ts', 'py', 'css', 'json', 'xml', 'yml', 'yaml', 'c', 'cpp', 'java'].includes(ext)) return { ext, icon: '💻', tag: '#Code' };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return { ext, icon: '🖼️', tag: '#Image' };
    if (ext === 'pdf') return { ext, icon: '📕', tag: '#PDF' };
    if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return { ext, icon: '📙', tag: '#PPT' };
    if (['doc', 'docx', 'hwp', 'hwpx', 'odt'].includes(ext)) return { ext, icon: '📘', tag: '#Word' };
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { ext, icon: '📊', tag: '#Excel' };
    if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return { ext, icon: '🎬', tag: '#Video' };
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return { ext, icon: '🎵', tag: '#Audio' };
    if (['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) return { ext, icon: '🗜️', tag: '#Archive' };
    return { ext, icon: '📄', tag: '#File' };
  }

  function readFileAsTextAsync(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsText(file, 'utf-8');
    });
  }

  async function handleIncomingFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const textReadable = ['md', 'txt', 'json', 'csv', 'js', 'ts', 'py', 'html', 'htm', 'css', 'xml', 'yml', 'yaml'];
    const excelExts = ['xlsx', 'xls'];
    const binaryFiles = files.filter((f) => {
      const { ext } = getFileMetaByExt(f.name);
      if (excelExts.includes(ext)) return false; // Excel 파일은 Drive 미연결 상태에서도 내장 실행기로 열 수 있음
      return !(textReadable.includes(ext) && f.size <= 500 * 1024);
    });

    // 이미지/PDF/PPT 등 바이너리 파일이 있으면 Google Drive 또는 연결된 로컬 폴더 확인
    const hasLocalFolder = Boolean(BrainLocalFolder && BrainLocalFolder.isConnected());
    let driveToken = BrainAuth.getDriveAccessToken();
    if (binaryFiles.length > 0 && !hasLocalFolder && (!driveToken || !isOwnerAuthenticated())) {
      if (isGuestMode) {
        showToast('📂 오프라인에서 이미지·PDF 등 바이너리 파일을 저장하려면 먼저 상단 [📂 로컬 폴더]를 연결해 주세요.');
        openLocalFolderModal();
        return;
      }
      if (!BrainAuth.isConfigComplete(state.settings.firebaseConfig)) {
        showToast('☁️ 이미지·PDF·PPT 파일 저장은 Google 로그인 또는 [📂 로컬 폴더] 연결 후 이용할 수 있습니다.');
        openAuthModal();
        return;
      }
      try {
        showToast('☁️ 파일 업로드를 위해 Google Drive 연결을 확인합니다...');
        driveToken = await ensureDriveToken(true);
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
        openAuthModal();
        return;
      }
      if (!driveToken) {
        showToast('☁️ Google Drive 연결 후 파일을 업로드해 주세요.');
        openAuthModal();
        return;
      }
    }

    saveStateForUndo();
    const userEmail = BrainAuth.getUser()?.email || '';
    let addedCount = 0;
    let lastAdded = null;

    for (const file of files) {
      const { ext, icon, tag } = getFileMetaByExt(file.name);
      const isInlineText = textReadable.includes(ext) && file.size <= 500 * 1024;

      if (excelExts.includes(ext)) {
        try {
          const buf = await file.arrayBuffer();
          const parsedWb = await BrainSheet.parseArrayBufferToWorkbook(buf, file.name);
          const mdSummary = BrainSheet.workbookToMarkdownSummary(parsedWb);
          let uploaded = null;
          if (driveToken && isOwnerAuthenticated()) {
            try {
              showToast(`☁️ "${file.name}" Google Drive 업로드 중...`);
              const folderPath = getFolderPathSegments(state.currentFolder);
              uploaded = await BrainDrive.uploadFile(driveToken, file, userEmail, folderPath);
            } catch (uploadErr) {
              handleDriveError(uploadErr);
            }
          }
          const newItem = {
            id: genId(),
            type: 'doc',
            name: file.name,
            icon: '📊',
            tag: '#Excel',
            summary: mdSummary,
            link: '',
            sheetData: parsedWb,
            ...(uploaded ? { driveFile: uploaded } : {})
          };
          if (!state.currentFolder.children) state.currentFolder.children = [];
          state.currentFolder.children.push(newItem);
          syncItemToLocalFolderNow(newItem).catch(() => {});
          lastAdded = newItem;
          addedCount++;
        } catch (err) {
          showToast(`⚠️ "${file.name}" 엑셀 파싱 실패: ${err.message}`);
        }
      } else if (isInlineText) {
        const contentText = await readFileAsTextAsync(file);
        const parsedCsvWb = ext === 'csv'
          ? BrainSheet.parseCsvToWorkbook(contentText || '', file.name.replace(/\.csv$/i, '') || 'Sheet1')
          : null;
        const newItem = {
          id: genId(),
          type: 'doc',
          name: file.name,
          icon: ext === 'csv' ? '📊' : icon,
          tag: ext === 'csv' ? '#CSV #Excel' : tag,
          summary: parsedCsvWb ? BrainSheet.workbookToMarkdownSummary(parsedCsvWb) : (contentText || ''),
          link: '',
          ...(parsedCsvWb ? { sheetData: parsedCsvWb } : {})
        };
        if (!state.currentFolder.children) state.currentFolder.children = [];
        state.currentFolder.children.push(newItem);
        if (parsedCsvWb) {
          syncSpreadsheetToDriveNow(newItem).catch(() => {});
        } else {
          scheduleDocFileSyncToDrive(newItem, true);
        }
        syncItemToLocalFolderNow(newItem).catch(() => {});
        lastAdded = newItem;
        addedCount++;
      } else if (hasLocalFolder && (!driveToken || !isOwnerAuthenticated())) {
        try {
          const folderSegs = getFolderPathSegments(state.currentFolder);
          await BrainLocalFolder.writeBlobFile(folderSegs, file.name, file);
          const newItem = {
            id: genId(),
            type: 'doc',
            name: file.name,
            icon,
            tag: `${tag} #로컬폴더`,
            summary: `📂 연결된 로컬 폴더에 저장된 파일입니다. (${file.name}, ${Math.max(1, Math.round(file.size / 1024))} KB)`,
            link: ''
          };
          if (!state.currentFolder.children) state.currentFolder.children = [];
          state.currentFolder.children.push(newItem);
          lastAdded = newItem;
          addedCount++;
        } catch (err) {
          showToast(`⚠️ "${file.name}" 로컬 폴더 저장 실패: ${err.message}`);
        }
      } else {
        showToast(`☁️ "${file.name}" Google Drive 업로드 중...`);
        try {
          const folderPath = getFolderPathSegments(state.currentFolder);
          const uploaded = await BrainDrive.uploadFile(driveToken, file, userEmail, folderPath);
          if (hasLocalFolder) {
            BrainLocalFolder.writeBlobFile(folderPath, file.name, file).catch(() => {});
          }
          const newItem = {
            id: genId(),
            type: 'doc',
            name: file.name,
            icon,
            tag,
            summary: '',
            link: '',
            driveFile: uploaded
          };
          if (!state.currentFolder.children) state.currentFolder.children = [];
          state.currentFolder.children.push(newItem);
          lastAdded = newItem;
          addedCount++;
        } catch (err) {
          handleDriveError(err);
          showToast(`⚠️ "${file.name}" 업로드 실패: ${err.message}`);
        }
      }
    }

    if (addedCount > 0) {
      saveAndRender();
      if (lastAdded) selectItem(lastAdded);
      showToast(
        addedCount === 1
          ? `✅ "${lastAdded.name}" 파일이 추가되었습니다.`
          : `✅ 파일 ${addedCount}개가 추가되었습니다.`
      );
    }
  }

  elContentArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elContentArea.classList.remove('drag-over');
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    handleIncomingFiles(e.dataTransfer.files);
  });

  // ================= Detail Preview & Edit =================
  function clearSelectionView() {
    state.selectedItem = null;
    isEditing = false;
    elDetailState.style.display = 'none';
    if (elMultiSelectState) elMultiSelectState.style.display = 'none';
    elEmptyState.style.display = 'flex';
    if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
  }

  function getDriveOpenButtonLabel(driveFile) {
    const cat = BrainDrive.getFileCategory(driveFile);
    if (cat === 'image') return '🖼️ 크게 보기';
    if (cat === 'pdf') return '📕 PDF 바로 열기';
    if (cat === 'ppt') return '📙 슬라이드 바로 열기';
    if (cat === 'word') return '📘 문서 바로 열기';
    if (cat === 'excel') return '📊 시트 바로 열기';
    if (cat === 'video' || cat === 'audio') return '▶️ 바로 재생';
    return '👁️ 바로 열기';
  }

  function getDriveCategoryDesc(driveFile) {
    const cat = BrainDrive.getFileCategory(driveFile);
    const sizeText = BrainDrive.formatFileSize(driveFile.size);
    const labelMap = {
      image: '이미지 파일',
      pdf: 'PDF 문서',
      ppt: 'PowerPoint 프레젠테이션',
      word: 'Word 문서',
      excel: 'Excel 스프레드시트',
      video: '동영상 파일',
      audio: '오디오 파일',
      other: 'Google Drive 파일'
    };
    return [labelMap[cat] || 'Google Drive 파일', sizeText].filter(Boolean).join(' · ');
  }

  async function renderDrivePreviewBox(item, seq) {
    const box = $('drive-preview-box');
    if (!box) return;

    const df = item?.driveFile;
    if (!df || !df.id) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    const cat = BrainDrive.getFileCategory(df);
    const desc = getDriveCategoryDesc(df);
    box.style.display = 'block';

    // Office(PPT/Word/Excel)나 기타 파일은 즉시 클릭 가능한 카드 표시
    if (!['image', 'pdf', 'video', 'audio'].includes(cat)) {
      box.innerHTML =
        `<div class="drive-preview-file-card" title="클릭하여 바로 열기">` +
        `  <div class="drive-preview-file-icon">${escapeHtml(item.icon || '📄')}</div>` +
        `  <div class="drive-preview-file-info">` +
        `    <div class="drive-preview-file-name">${escapeHtml(df.name || item.name)}</div>` +
        `    <div class="drive-preview-file-sub">${escapeHtml(desc)} · 클릭하여 바로 열기</div>` +
        `  </div>` +
        `</div>`;
      box.querySelector('.drive-preview-file-card').addEventListener('click', () => openDriveFileViewer(item));
      return;
    }

    // 이미지 / PDF / 미디어: 토큰 있으면 인증된 Blob URL로 즉시 미리보기
    const token = BrainAuth.getDriveAccessToken();
    if (!token) {
      box.innerHTML =
        `<div class="drive-preview-file-card" title="클릭하여 Google Drive 연결 후 보기">` +
        `  <div class="drive-preview-file-icon">${escapeHtml(item.icon || '📄')}</div>` +
        `  <div class="drive-preview-file-info">` +
        `    <div class="drive-preview-file-name">${escapeHtml(df.name || item.name)}</div>` +
        `    <div class="drive-preview-file-sub">🔑 Google Drive 연결 후 바로 미리보기 가능 (${escapeHtml(desc)})</div>` +
        `  </div>` +
        `</div>`;
      box.querySelector('.drive-preview-file-card').addEventListener('click', () => openDriveFileViewer(item));
      return;
    }

    box.innerHTML = `<div class="drive-preview-loading">☁️ Google Drive에서 미리보기 불러오는 중...</div>`;
    try {
      const entry = await BrainDrive.getFileBlobUrl(token, df.id, df.mimeType);
      if (seq !== previewRenderSeq) return; // 다른 메모로 이동함

      if (cat === 'image') {
        box.innerHTML = `<div class="drive-preview-img-wrap" title="클릭하여 크게 보기"><img alt=""></div>`;
        const img = box.querySelector('img');
        img.src = entry.url;
        img.alt = df.name || item.name;
        box.querySelector('.drive-preview-img-wrap').addEventListener('click', () => openDriveFileViewer(item));
      } else if (cat === 'pdf') {
        box.innerHTML = `<div class="drive-preview-pdf-wrap"><iframe title="PDF 미리보기"></iframe></div>`;
        box.querySelector('iframe').src = entry.url;
      } else if (cat === 'video') {
        box.innerHTML = `<div class="drive-preview-media-wrap"><video controls preload="metadata"></video></div>`;
        box.querySelector('video').src = entry.url;
      } else if (cat === 'audio') {
        box.innerHTML = `<div class="drive-preview-media-wrap"><audio controls preload="metadata"></audio></div>`;
        box.querySelector('audio').src = entry.url;
      }
    } catch (err) {
      if (seq !== previewRenderSeq) return;
      handleDriveError(err);
      box.innerHTML =
        `<div class="drive-preview-file-card" title="클릭하여 다시 시도">` +
        `  <div class="drive-preview-file-icon">${escapeHtml(item.icon || '📄')}</div>` +
        `  <div class="drive-preview-file-info">` +
        `    <div class="drive-preview-file-name">${escapeHtml(df.name || item.name)}</div>` +
        `    <div class="drive-preview-file-sub">⚠️ 미리보기 로드 실패 — 클릭하여 재연결/열기</div>` +
        `  </div>` +
        `</div>`;
      box.querySelector('.drive-preview-file-card').addEventListener('click', () => openDriveFileViewer(item));
    }
  }

  function selectItem(item, opts = {}) {
    if (!item || !isItemVisible(item)) {
      clearSelectionView();
      return;
    }
    state.selectedItem = item;
    if (!opts.preserveMulti) {
      selectedItemIds = new Set([item.id]);
      syncCardSelectionVisuals();
    }
    isEditing = false;
    elEmptyState.style.display = 'none';
    if (elMultiSelectState) elMultiSelectState.style.display = 'none';
    elDetailState.style.display = 'flex';
    elViewMode.style.display = 'flex';
    elEditMode.style.display = 'none';

    $('p-icon').textContent = item.icon || (item.type === 'folder' ? '📁' : '📄');
    $('p-title').textContent = item.name;
    $('p-tag').textContent = item.tag || (item.type === 'folder' ? '폴더' : '문서');

    const linkBadge = $('p-link-badge');
    const localActionRow = $('local-action-row');
    const driveActionRow = $('drive-action-row');
    const sheetActionRow = $('sheet-action-row');
    const mdActionRow = $('md-action-row');
    const btnOpenLocal = $('btn-open-local');
    const btnRevealLocal = $('btn-reveal-local');

    previewRenderSeq++;
    const hasDriveFile = Boolean(item.driveFile && item.driveFile.id);
    const isSheet = isSpreadsheetItem(item);
    if (sheetActionRow) {
      sheetActionRow.style.display = isSheet ? 'flex' : 'none';
    }
    if (hasDriveFile) {
      driveActionRow.style.display = 'flex';
      $('btn-drive-open').textContent = isSheet ? '📊 엑셀 실행기' : getDriveOpenButtonLabel(item.driveFile);
      renderDrivePreviewBox(item, previewRenderSeq);
    } else {
      driveActionRow.style.display = 'none';
      const box = $('drive-preview-box');
      if (box) {
        box.style.display = 'none';
        box.innerHTML = '';
      }
    }

    if (mdActionRow) {
      mdActionRow.style.display = !isSheet && isMarkdownDocItem(item) ? 'flex' : 'none';
    }

    if (item.link && LocalBridge.isLocalPath(item.link)) {
      linkBadge.style.display = 'inline-block';
      linkBadge.href = '#';
      linkBadge.removeAttribute('target');
      linkBadge.dataset.localPath = item.link;
      linkBadge.textContent = `🖥️ ${item.link.length > 28 ? item.link.slice(0, 28) + '…' : item.link}`;
      btnOpenLocal.textContent = '🚀 로컬에서 실행';
      btnRevealLocal.textContent = '📂 폴더 열기';
      btnRevealLocal.style.display = '';
      localActionRow.style.display = 'flex';
    } else if (item.link) {
      linkBadge.style.display = 'inline-block';
      linkBadge.href = item.link;
      linkBadge.setAttribute('target', '_blank');
      delete linkBadge.dataset.localPath;
      linkBadge.textContent = `🔗 ${item.link.length > 28 ? item.link.slice(0, 28) + '…' : item.link}`;
      localActionRow.style.display = 'none';
    } else if (hasDriveFile || isSheet) {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      localActionRow.style.display = 'none';
    } else if (item.type === 'doc' && isBinaryFileName(item.name)) {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      localActionRow.style.display = 'none';
      const box = $('drive-preview-box');
      if (box) {
        box.style.display = 'block';
        box.innerHTML =
          `<div style="padding:12px 14px;">` +
          `  <div style="font-size:0.83rem; font-weight:700; margin-bottom:4px;">⚠️ 원본 파일이 연결되어 있지 않습니다</div>` +
          `  <div style="font-size:0.76rem; color:var(--text-sub); line-height:1.45; margin-bottom:10px;">이 카드에는 파일 이름만 저장되어 있어 바로 열 수 없습니다. 원본 파일을 Google Drive에 올리거나 PC 경로를 연결해 주세요.</div>` +
          `  <div class="action-row">` +
          `    <button type="button" class="btn btn-drive" id="btn-inline-reattach-drive" style="padding:6px 10px; font-size:0.78rem;">📤 원본 파일 업로드(Drive)</button>` +
          `    <button type="button" class="btn btn-secondary" id="btn-inline-link-local" style="padding:6px 10px; font-size:0.78rem;">📂 PC 경로 연결</button>` +
          `  </div>` +
          `</div>`;
        const btnReattach = $('btn-inline-reattach-drive');
        const btnLinkLocal = $('btn-inline-link-local');
        if (btnReattach) btnReattach.addEventListener('click', () => $('reattach-file-input').click());
        if (btnLinkLocal) btnLinkLocal.addEventListener('click', () => { toggleEditMode(true); });
      }
    } else if (item.type === 'doc' && isHtmlContentItem(item)) {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      btnOpenLocal.textContent = '🌐 창으로 실행';
      btnRevealLocal.textContent = '🖥️ PC 브라우저로 열기';
      btnRevealLocal.style.display = '';
      localActionRow.style.display = 'flex';
    } else if (item.type === 'doc') {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      btnOpenLocal.textContent = getLocalAppButtonLabel(item);
      btnRevealLocal.style.display = 'none';
      localActionRow.style.display = 'flex';
    } else {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      localActionRow.style.display = 'none';
    }

    $('p-summary').innerHTML = renderMarkdown(item.summary);
    window.BrainMarkdown.renderMermaidBlocks($('p-summary')).catch(() => {});
    renderDetailRelations(item);
    if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
    renderContextChips();
  }

  function toggleEditMode(forceState) {
    if (!state.selectedItem) return;
    isEditing = typeof forceState === 'boolean' ? forceState : !isEditing;
    if (isEditing) {
      elViewMode.style.display = 'none';
      elEditMode.style.display = 'flex';
      $('edit-icon').value = state.selectedItem.icon || '';
      $('edit-title').value = state.selectedItem.name || '';
      $('edit-tag').value = state.selectedItem.tag || '';
      $('edit-link').value = state.selectedItem.link || '';
      $('edit-local-private').checked = Boolean(
        state.selectedItem.isLocalPrivate || LocalBridge.isLocalPath(state.selectedItem.link)
      );
      $('edit-summary').value = state.selectedItem.summary || '';
      $('edit-title').focus();
    } else {
      selectItem(state.selectedItem);
    }
  }

  function saveEdits() {
    if (!state.selectedItem) return;
    const linkVal = $('edit-link').value.trim();
    const isProtected = $('edit-local-private').checked || LocalBridge.isLocalPath(linkVal);

    if (isProtected && !isOwnerAuthenticated()) {
      showToast('🔒 로컬 경로/비공개 항목은 내 구글 계정 로그인 후 저장할 수 있습니다.');
      openAuthModal();
      return;
    }

    saveStateForUndo();
    const oldLocalName = state.selectedItem.type === 'folder' ? state.selectedItem.name : getLocalFileNameForItem(state.selectedItem);
    const parentSegs = getRelativeFolderPathForItem(state.selectedItem.id);
    const iconVal = $('edit-icon').value.trim();
    if (iconVal) state.selectedItem.icon = iconVal;
    state.selectedItem.name = $('edit-title').value.trim() || '제목 없음';
    state.selectedItem.tag = $('edit-tag').value.trim();
    state.selectedItem.link = linkVal;
    state.selectedItem.isLocalPrivate = isProtected;
    state.selectedItem.summary = $('edit-summary').value;
    touchNode(state.selectedItem);
    saveAndRender();
    selectItem(state.selectedItem);
    syncOpenWindowsForItem(state.selectedItem);
    if (state.selectedItem.type === 'doc') {
      scheduleDocFileSyncToDrive(state.selectedItem, true);
    }
    if (BrainLocalFolder) {
      const newLocalName = state.selectedItem.type === 'folder' ? state.selectedItem.name : getLocalFileNameForItem(state.selectedItem);
      if (BrainLocalFolder.isConnected() && oldLocalName !== newLocalName) {
        BrainLocalFolder.removeEntry(parentSegs, oldLocalName).catch(() => {});
      }
      syncItemToLocalFolderNow(state.selectedItem, { allowAutoDownload: true }).catch(() => {});
    }
    const lf = BrainLocalFolder?.getStatus();
    showToast(lf?.connected ? `💾 저장 및 로컬 폴더(${lf.folderName}) 반영 완료` : '저장되었습니다.');
  }

  $('btn-edit-note').addEventListener('click', () => toggleEditMode(true));
  $('btn-save-edit').addEventListener('click', saveEdits);
  $('btn-cancel-edit').addEventListener('click', () => toggleEditMode(false));

  $('btn-copy-prompt').addEventListener('click', () => {
    if (!state.selectedItem) return;
    const text =
      `[나의 세컨드 브레인 DB]\n` +
      `- 분류: ${state.selectedItem.tag || '없음'}\n` +
      `- 제목: ${state.selectedItem.name}\n` +
      `- 내용:\n${state.selectedItem.summary || ''}\n\n질문: `;
    navigator.clipboard.writeText(text).then(() => showToast('✨ 프롬프트가 클립보드에 복사되었습니다.'));
  });

  $('btn-ask-ai').addEventListener('click', () => {
    if (!state.selectedItem) return;
    attachNodeToContext(state.selectedItem);
    switchRightTab('chat');
  });

  // AI 자동 요약 버튼
  $('btn-ai-summarize').addEventListener('click', async () => {
    if (!state.selectedItem || state.selectedItem.type === 'folder') {
      showToast('문서 메모를 선택한 상태에서 사용해 주세요.');
      return;
    }
    const provider = elChatProvider.value;
    const model = elChatModel.value;
    const apiKey = state.settings.keys[provider];

    if (!apiKey) {
      showToast(`${PROVIDERS[provider].label} API 키를 먼저 설정해 주세요.`);
      openSettingsModal();
      return;
    }

    const btn = $('btn-ai-summarize');
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 요약 중...';

    try {
      const prompt =
        `다음 메모를 핵심 포인트 3~5개 불릿으로 깔끔하게 요약하고, 맨 마지막 줄에 어울리는 해시태그 2~3개만 제안해줘.\n\n` +
        `제목: ${state.selectedItem.name}\n내용:\n${state.selectedItem.summary || '(내용 없음)'}`;

      const reply = await sendChat({
        provider,
        model,
        apiKey,
        messages: [{ role: 'user', content: prompt }],
        contextDocs: []
      });

      saveStateForUndo();
      state.selectedItem.summary =
        (state.selectedItem.summary ? state.selectedItem.summary + '\n\n---\n### ✨ AI 요약 (' + PROVIDERS[provider].label + ')\n' : '') +
        reply;
      saveAndRender();
      selectItem(state.selectedItem);
      showToast('✨ AI 요약이 메모에 추가되었습니다.');
    } catch (err) {
      showToast(`오류: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  });

  // ================= Context Menu & Buttons =================
  function showContextMenu(e) {
    const selCount = getSelectedItems().length;
    const cutLbl = $('ctx-cut-label');
    const copyLbl = $('ctx-copy-label');
    const delLbl = $('ctx-delete-label');
    if (cutLbl) cutLbl.textContent = selCount > 1 ? `✂️ ${selCount}개 항목 잘라내기` : '✂️ 잘라내기';
    if (copyLbl) copyLbl.textContent = selCount > 1 ? `📄 ${selCount}개 항목 복사` : '📄 복사';
    if (delLbl) delLbl.textContent = selCount > 1 ? `🗑️ ${selCount}개 항목 삭제` : '🗑️ 삭제';

    let x = e.clientX;
    let y = e.clientY;
    elContextMenu.style.display = 'block';
    const menuW = elContextMenu.offsetWidth || 200;
    const menuH = elContextMenu.offsetHeight || 260;
    if (x + menuW > window.innerWidth - 8) x = window.innerWidth - menuW - 8;
    if (y + menuH > window.innerHeight - 8) y = window.innerHeight - menuH - 8;
    elContextMenu.style.left = `${Math.max(4, x)}px`;
    elContextMenu.style.top = `${Math.max(4, y)}px`;
  }

  elContentArea.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e);
  });

  document.body.addEventListener('click', () => {
    elContextMenu.style.display = 'none';
  });

  elContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    elContextMenu.style.display = 'none';
    if (action === 'new-folder') createNew('folder');
    else if (action === 'new-doc') createNew('doc');
    else if (action === 'new-sheet') createNew('sheet');
    else if (action === 'upload-file') $('file-upload-input').click();
    else if (action === 'select-all') selectAllVisibleItems();
    else if (action === 'save-to-pc') {
      const selItems = getSelectedItems();
      if (selItems.length === 0) showToast('저장할 항목을 먼저 선택해 주세요.');
      else saveItemsToPC(selItems);
    }
    else if (action === 'rename') startRenameItem(state.selectedItem);
    else if (action === 'add-relation') {
      if (state.selectedItem && state.selectedItem.id !== 'root') openRelationModal(state.selectedItem);
      else showToast('관계를 연결할 항목을 먼저 선택해 주세요.');
    }
    else if (action === 'pin-home') {
      if (state.selectedItem && state.selectedItem.id !== 'root') togglePinAppToHome(state.selectedItem);
      else showToast('홈 화면에 고정할 항목을 먼저 선택해 주세요.');
    }
    else if (action === 'open-local') {
      if (isSpreadsheetItem(state.selectedItem)) {
        openSpreadsheetWindow(state.selectedItem);
      } else if (state.selectedItem && state.selectedItem.driveFile && state.selectedItem.driveFile.id) {
        openDriveFileViewer(state.selectedItem);
      } else if (state.selectedItem && state.selectedItem.link && LocalBridge.isLocalPath(state.selectedItem.link)) {
        launchLocalItem(state.selectedItem.link, 'open');
      } else if (state.selectedItem && state.selectedItem.link && LocalBridge.isWebUrl(state.selectedItem.link)) {
        window.open(state.selectedItem.link, '_blank', 'noopener,noreferrer');
      } else if (isHtmlContentItem(state.selectedItem)) {
        openHtmlWindow(state.selectedItem);
      } else if (isMarkdownDocItem(state.selectedItem)) {
        openMarkdownWindow(state.selectedItem, 'view');
      } else if (state.selectedItem && state.selectedItem.type === 'doc') {
        openMemoInLocalApp(state.selectedItem);
      } else {
        showToast('실행할 메모를 먼저 선택해 주세요.');
      }
    }
    else if (action === 'attach-ai') {
      const selItems = getSelectedItems();
      if (selItems.length > 0) {
        selItems.forEach((it) => attachNodeToContext(it));
        switchRightTab('chat');
      } else {
        showToast('먼저 메모나 폴더를 선택해 주세요.');
      }
    }
    else if (action === 'cut') execCut();
    else if (action === 'copy') execCopy();
    else if (action === 'paste') execPaste();
    else if (action === 'undo') execUndo();
    else if (action === 'delete') execDelete(true);
  });

  $('btn-save-item-pc')?.addEventListener('click', () => {
    if (state.selectedItem) saveItemsToPC([state.selectedItem]);
  });
  $('btn-multi-copy')?.addEventListener('click', execCopy);
  $('btn-multi-cut')?.addEventListener('click', execCut);
  $('btn-multi-delete')?.addEventListener('click', () => execDelete(true));
  $('btn-multi-save-pc')?.addEventListener('click', () => saveItemsToPC(getSelectedItems()));
  $('btn-multi-attach-ai')?.addEventListener('click', () => {
    const selItems = getSelectedItems();
    if (selItems.length > 0) {
      selItems.forEach((it) => attachNodeToContext(it));
      switchRightTab('chat');
    }
  });

  $('btn-new-folder').addEventListener('click', () => createNew('folder'));
  $('btn-quick-folder').addEventListener('click', () => createNew('folder'));
  $('btn-new-doc').addEventListener('click', () => createNew('doc'));
  $('btn-new-sheet').addEventListener('click', () => createNew('sheet'));
  $('btn-upload-file').addEventListener('click', () => $('file-upload-input').click());
  $('file-upload-input').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleIncomingFiles(e.target.files);
    }
    e.target.value = '';
  });
  $('btn-undo').addEventListener('click', execUndo);

  // ================= Keyboard Shortcuts =================
  document.addEventListener('keydown', (e) => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    const inFloatingWin = Boolean(e.target.closest && e.target.closest('.os-floating-win'));
    const inModal = Boolean(e.target.closest && e.target.closest('.modal-overlay'));

    // Ctrl+K: 검색 포커스 (플로팅 창 내부가 아닐 때)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !inFloatingWin) {
      e.preventDefault();
      elGlobalSearch.focus();
      elGlobalSearch.select();
      return;
    }

    // Ctrl+S: 편집 중 저장
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && isEditing && !inFloatingWin) {
      e.preventDefault();
      saveEdits();
      return;
    }

    if (isInput || inFloatingWin || inModal) return;

    if (e.key === 'F2') {
      e.preventDefault();
      startRenameItem(state.selectedItem);
      return;
    }

    if (e.key === 'Escape') {
      if (selectedItemIds.size > 0 || state.selectedItem) {
        selectedItemIds.clear();
        lastClickedItemId = null;
        syncCardSelectionVisuals();
        clearSelectionView();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); selectAllVisibleItems(); }
      else if (k === 'c') { e.preventDefault(); execCopy(); }
      else if (k === 'x') { e.preventDefault(); execCut(); }
      else if (k === 'v') { e.preventDefault(); execPaste(); }
      else if (k === 'z') { e.preventDefault(); execUndo(); }
    } else if (e.key === 'Delete') {
      execDelete(false);
    }
  });

  // ================= Multi-AI Chat =================
  function populateModels(providerId) {
    const provider = PROVIDERS[providerId];
    if (!provider) return;
    elChatModel.innerHTML = '';

    const customModel = (state.settings.customModels[providerId] || '').trim();
    if (customModel) {
      const opt = document.createElement('option');
      opt.value = customModel;
      opt.textContent = `★ ${customModel} (커스텀)`;
      elChatModel.appendChild(opt);
    }

    provider.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      elChatModel.appendChild(opt);
    });

    if (state.settings.lastProvider === providerId && state.settings.lastModel) {
      const exists = Array.from(elChatModel.options).some((o) => o.value === state.settings.lastModel);
      if (exists) elChatModel.value = state.settings.lastModel;
    }
  }

  function updateApiStatusSummary() {
    if (isGuestMode) {
      elApiStatusSummary.textContent = '📴 오프라인 게스트 모드 (로컬 저장)';
      return;
    }
    const configured = Object.keys(PROVIDERS).filter((id) => Boolean(state.settings.keys[id]?.trim()));
    if (configured.length === 0) {
      elApiStatusSummary.textContent = '⚠️ API 키 미설정 (상단 ⚙️ 클릭)';
    } else {
      elApiStatusSummary.textContent = `✅ 연결됨: ${configured.map((id) => PROVIDERS[id].label).join(' · ')}`;
    }
  }

  elChatProvider.addEventListener('change', () => {
    const providerId = elChatProvider.value;
    state.settings.lastProvider = providerId;
    populateModels(providerId);
    state.settings.lastModel = elChatModel.value;
    persistSettings();
  });

  elChatModel.addEventListener('change', () => {
    state.settings.lastModel = elChatModel.value;
    persistSettings();
  });

  function attachNodeToContext(node) {
    if (!node || !isItemVisible(node)) return;
    if (node.type === 'folder') {
      const docs = collectDocsInFolder(node).filter((d) => isItemVisible(d));
      if (docs.length === 0) {
        showToast('선택한 폴더 안에 문서 메모가 없습니다.');
        return;
      }
      docs.forEach((d) => {
        if (!state.attachedContextIds.includes(d.id)) state.attachedContextIds.push(d.id);
      });
      renderContextChips();
      showToast(`폴더 내 메모 ${docs.length}개가 AI 컨텍스트에 첨부되었습니다.`);
    } else {
      if (!state.attachedContextIds.includes(node.id)) {
        state.attachedContextIds.push(node.id);
        renderContextChips();
        showToast(`"${node.name}" 첨부됨`);
      } else {
        showToast('이미 첨부된 메모입니다.');
      }
    }
  }

  function getAttachedDocs() {
    const docs = [];
    state.attachedContextIds = state.attachedContextIds.filter((id) => {
      const found = findNodeAndParent(id);
      if (found && found.node && found.node.type === 'doc' && isItemVisible(found.node)) {
        docs.push(found.node);
        return true;
      }
      return false;
    });
    return docs;
  }

  // 열려 있는 HTML 창이나 현재 선택된 문서에 AI 마커가 있으면 자동으로 AI가 인식할 수 있도록 수집
  function getAutoMarkedDocs(excludeIds = new Set()) {
    const result = [];
    const seen = new Set(excludeIds);

    const tryAdd = (node) => {
      if (!node || node.type !== 'doc' || seen.has(node.id) || !isItemVisible(node)) return;
      if (Array.isArray(node.aiMarkers) && node.aiMarkers.length > 0) {
        seen.add(node.id);
        result.push(node);
      }
    };

    // 1. 현재 열려 있는 HTML/MD 창의 문서들
    const openWinIds = WinManager.listOpenWindowIds ? WinManager.listOpenWindowIds() : [];
    openWinIds.forEach((wid) => {
      const m = String(wid).match(/^(?:html|md)-(.+)$/);
      if (m) {
        const found = findNodeAndParent(m[1]);
        if (found?.node) tryAdd(found.node);
      }
    });

    // 2. 현재 탐색기에서 선택 중인 문서
    if (state.selectedItem) tryAdd(state.selectedItem);

    return result;
  }

  function getContextDocsForAI() {
    const manualDocs = getAttachedDocs();
    const exclude = new Set(manualDocs.map((d) => d.id));
    const autoMarked = getAutoMarkedDocs(exclude);
    return [...manualDocs, ...autoMarked];
  }

  function renderContextChips() {
    const manualDocs = getAttachedDocs();
    const exclude = new Set(manualDocs.map((d) => d.id));
    const autoMarkedDocs = getAutoMarkedDocs(exclude);
    const totalCount = manualDocs.length + autoMarkedDocs.length;

    elContextChips.innerHTML = '';

    if (totalCount === 0) {
      elContextBar.style.display = 'none';
      elContextCountBadge.style.display = 'none';
      return;
    }

    elContextBar.style.display = 'flex';
    elContextCountBadge.style.display = 'inline-block';
    elContextCountBadge.textContent = String(totalCount);

    manualDocs.forEach((doc) => {
      const mCount = Array.isArray(doc.aiMarkers) ? doc.aiMarkers.length : 0;
      const chip = document.createElement('span');
      chip.className = 'context-chip';
      chip.innerHTML =
        `<span>${escapeHtml(doc.icon || '📄')} ${escapeHtml(doc.name)}${mCount > 0 ? ` · 🖍️${mCount}` : ''}</span>` +
        `<button title="제거">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.attachedContextIds = state.attachedContextIds.filter((id) => id !== doc.id);
        renderContextChips();
      });
      elContextChips.appendChild(chip);
    });

    autoMarkedDocs.forEach((doc) => {
      const mCount = doc.aiMarkers.length;
      const chip = document.createElement('span');
      chip.className = 'context-chip marker-auto-chip';
      chip.title = '형광펜 마커가 표시된 문서입니다. 채팅에서 "거기 마커 쳐놓은 거 어떻게 생각해?"처럼 바로 물어볼 수 있습니다.';
      chip.innerHTML = `<span>🖍️ ${escapeHtml(doc.name)} (마커 ${mCount}개)</span>`;
      elContextChips.appendChild(chip);
    });
  }

  $('btn-attach-current').addEventListener('click', () => {
    if (!state.selectedItem) {
      showToast('먼저 탐색기에서 메모를 선택해 주세요.');
      return;
    }
    attachNodeToContext(state.selectedItem);
  });

  $('btn-attach-folder').addEventListener('click', () => {
    attachNodeToContext(state.currentFolder);
  });

  $('btn-new-chat').addEventListener('click', () => {
    if (state.chatHistory.length > 0 && !confirm('현재 대화 기록을 초기화할까요?')) return;
    state.chatHistory = [];
    persistChat();
    scheduleDriveSync();
    renderChatMessages();
    showToast('새 대화를 시작했습니다.');
  });

  function renderChatMessages() {
    elChatMessages.innerHTML = '';

    if (state.chatHistory.length === 0) {
      elChatMessages.innerHTML = `
        <div class="chat-welcome">
          <div class="chat-welcome-icon">🤖</div>
          <h4>Multi-AI 세컨드 브레인</h4>
          <p>Grok · Gemini · Claude · OpenAI 중 원하는 모델을 실시간으로 바꿔가며 대화하세요.</p>
          <p class="chat-welcome-tip">💡 상단의 <b>📎 현재 메모</b> 또는 <b>📂 현재 폴더</b>를 누르면 내 메모를 바탕으로 답변합니다.</p>
        </div>`;
      return;
    }

    state.chatHistory.forEach((msg) => {
      const row = document.createElement('div');
      row.className = `msg-row ${msg.role}${msg.isError ? ' error' : ''}`;

      if (msg.role === 'assistant') {
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const provLabel = PROVIDERS[msg.provider]?.label || msg.provider || 'AI';
        meta.innerHTML = `<span class="provider-pill ${escapeHtml(msg.provider || '')}">${escapeHtml(provLabel)}</span><span>${escapeHtml(msg.model || '')}</span>`;
        row.appendChild(meta);
      }

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble' + (msg.role === 'assistant' ? ' markdown-body' : '');
      if (msg.role === 'assistant' && !msg.isError) {
        bubble.innerHTML = renderMarkdown(msg.content);
      } else {
        bubble.textContent = msg.content;
      }
      row.appendChild(bubble);

      if (msg.role === 'assistant' && !msg.isError) {
        const actions = document.createElement('div');
        actions.className = 'msg-actions';

        const btnCopy = document.createElement('button');
        btnCopy.className = 'msg-action-btn';
        btnCopy.textContent = '📋 복사';
        btnCopy.addEventListener('click', () => {
          navigator.clipboard.writeText(msg.content).then(() => showToast('답변을 복사했습니다.'));
        });

        const btnSaveNote = document.createElement('button');
        btnSaveNote.className = 'msg-action-btn';
        btnSaveNote.textContent = '💾 메모로 저장';
        btnSaveNote.addEventListener('click', () => saveAiReplyAsNote(msg));

        actions.appendChild(btnCopy);
        actions.appendChild(btnSaveNote);
        row.appendChild(actions);
      }

      elChatMessages.appendChild(row);
    });

    elChatMessages.scrollTop = elChatMessages.scrollHeight;
  }

  function saveAiReplyAsNote(msg) {
    saveStateForUndo();
    const firstLine = (msg.content || '').split('\n').find((l) => l.trim()) || 'AI 답변 메모';
    const cleanTitle = firstLine.replace(/^[#*\-\s]+/, '').slice(0, 36).trim();
    const provLabel = PROVIDERS[msg.provider]?.label || 'AI';
    const baseName = (cleanTitle || `${provLabel} 답변`).replace(/\.md$/i, '');

    const newNote = {
      id: genId(),
      type: 'doc',
      name: getUniqueNameInFolder(state.currentFolder, baseName, '.md'),
      icon: '🤖',
      tag: `#AI #${provLabel} #MD`,
      link: '',
      summary: msg.content
    };
    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newNote);
    saveAndRender();
    scheduleDocFileSyncToDrive(newNote, true);
    showToast(`"${state.currentFolder.name}" 폴더에 .md 메모로 저장되었습니다.`);
  }

  async function handleSendChat() {
    if (isSendingChat) return;
    const text = elChatInput.value.trim();
    if (!text) return;

    const provider = elChatProvider.value;
    const model = elChatModel.value;
    const apiKey = state.settings.keys[provider];

    if (!apiKey || !apiKey.trim()) {
      showToast(`${PROVIDERS[provider].label} API 키를 먼저 설정해 주세요.`);
      openSettingsModal();
      return;
    }

    elChatInput.value = '';
    elChatInput.style.height = 'auto';

    state.chatHistory.push({ role: 'user', content: text });
    persistChat();
    renderChatMessages();

    // Typing indicator
    const loadingRow = document.createElement('div');
    loadingRow.className = 'msg-row assistant';
    loadingRow.innerHTML =
      `<div class="msg-meta"><span class="provider-pill ${escapeHtml(provider)}">${escapeHtml(PROVIDERS[provider].label)}</span><span>${escapeHtml(model)}</span></div>` +
      `<div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    elChatMessages.appendChild(loadingRow);
    elChatMessages.scrollTop = elChatMessages.scrollHeight;

    isSendingChat = true;
    elBtnSendChat.disabled = true;

    try {
      const historyForApi = state.chatHistory.filter((m) => !m.isError).slice(-20);
      const reply = await sendChat({
        provider,
        model,
        apiKey,
        messages: historyForApi,
        contextDocs: getContextDocsForAI()
      });

      state.chatHistory.push({
        role: 'assistant',
        content: reply,
        provider,
        model
      });
    } catch (err) {
      state.chatHistory.push({
        role: 'assistant',
        content: `⚠️ 호출 실패 (${PROVIDERS[provider].label}): ${err.message}`,
        provider,
        model,
        isError: true
      });
    } finally {
      isSendingChat = false;
      elBtnSendChat.disabled = false;
      persistChat();
      scheduleDriveSync();
      renderChatMessages();
    }
  }

  elBtnSendChat.addEventListener('click', handleSendChat);
  elChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSendChat();
    }
  });

  // ================= Settings Modal, Security Vault & Auto-Backup =================
  function buildFullBackupPayload() {
    const exportFs = isOwnerAuthenticated() ? state.fileSystem : stripLocalItemsForExport(state.fileSystem);
    return {
      exportedAt: new Date().toISOString(),
      version: '7.1',
      fileSystem: exportFs,
      paraEntities: state.paraEntities || [],
      relations: state.relations || [],
      pinnedAppIds: state.pinnedAppIds || [],
      globalTemplates: state.globalTemplates || [],
      dfpState: typeof loadDfpState === 'function' ? loadDfpState() : null,
      chatHistory: state.chatHistory || []
    };
  }

  async function applyBackupPayload(parsed, { skipPreImportSnapshot = false, reasonLabel = '가져오기 직전 안전 스냅샷' } = {}) {
    const fs = parsed?.fileSystem || (parsed?.id === 'root' ? parsed : null);
    if (!fs || !fs.id) throw new Error('올바른 세컨드 브레인 백업 파일이 아닙니다.');

    if (!skipPreImportSnapshot && BrainBackup) {
      await BrainBackup.saveSnapshot({
        kind: 'pre-import',
        label: reasonLabel,
        userEmail: getActiveUserEmail() || 'guest',
        payload: buildFullBackupPayload()
      });
    }

    saveStateForUndo();
    state.fileSystem = fs;
    state.currentFolder = state.fileSystem;
    state.selectedItem = null;
    if (Array.isArray(parsed.paraEntities)) {
      state.paraEntities = parsed.paraEntities;
      persistParaEntities();
    }
    if (Array.isArray(parsed.relations)) {
      state.relations = parsed.relations;
      persistRelations();
    }
    if (Array.isArray(parsed.pinnedAppIds)) {
      state.pinnedAppIds = parsed.pinnedAppIds;
      persistPinnedApps();
    }
    if (Array.isArray(parsed.globalTemplates)) {
      state.globalTemplates = parsed.globalTemplates;
      window.BrainStore.persistGlobalTemplates();
    }
    if (parsed.dfpState && typeof parsed.dfpState === 'object' && typeof saveDfpState === 'function') {
      saveDfpState(parsed.dfpState);
    }
    if (Array.isArray(parsed.chatHistory)) {
      state.chatHistory = parsed.chatHistory;
      persistChat();
      renderChatMessages();
    }
    normalizeParaWorkspace();
    saveAndRender();
    if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
  }

  function updateVaultModalUI() {
    const modeSel = $('key-storage-mode');
    const passRow = $('sb-vault-pass-row');
    const statusEl = $('sb-vault-status-text');
    const unlockBtn = $('btn-unlock-vault');
    const clearBtn = $('btn-clear-vault');
    if (!modeSel || !passRow || !statusEl || !BrainSecurity) return;

    const mode = modeSel.value || BrainSecurity.getKeyStorageMode();
    const hasVault = BrainSecurity.hasEncryptedVault();
    const locked = BrainSecurity.isVaultLocked();
    const subtleOk = BrainSecurity.isCryptoSubtleAvailable();

    passRow.style.display = (mode === 'vault' || hasVault) ? 'flex' : 'none';
    if (unlockBtn) unlockBtn.style.display = hasVault ? 'inline-flex' : 'none';
    if (clearBtn) clearBtn.style.display = hasVault ? 'inline-flex' : 'none';

    if (!subtleOk && mode === 'vault') {
      statusEl.textContent = '⚠️ file:// 등 비보안 출처에서는 브라우저 Web Crypto 암호화가 제한되어 세션 전용으로 동작합니다.';
    } else if (hasVault && locked) {
      statusEl.textContent = '🔒 암호화 금고가 잠겨 있습니다. 비밀번호를 입력해 [금고 해제]를 누르면 키가 복원됩니다.';
    } else if (hasVault) {
      statusEl.textContent = '🔓 암호화 금고 해제됨 · 저장 시 AES-256-GCM으로 암호화되어 보관됩니다.';
    } else {
      statusEl.textContent = '현재 세션 메모리 전용 모드입니다. (localStorage에 평문 키를 남기지 않음)';
    }
  }

  async function renderBackupSnapshotList() {
    const listEl = $('backup-snapshot-list');
    if (!listEl || !BrainBackup) return;
    const snaps = await BrainBackup.listSnapshots(getActiveUserEmail() || 'guest');
    if (!snaps || snaps.length === 0) {
      listEl.innerHTML = `<div class="sb-snap-empty">저장된 백업 스냅샷이 아직 없습니다. [스냅샷 저장] 또는 JSON 가져오기 시 자동 생성됩니다.</div>`;
      return;
    }
    const kindMap = { 'pre-import': '가져오기 전', manual: '수동', auto: '자동' };
    listEl.innerHTML = snaps.slice(0, 8).map((s) => {
      const dt = new Date(s.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const kindCls = s.kind === 'pre-import' ? 'is-pre' : (s.kind === 'manual' ? 'is-manual' : 'is-auto');
      return (
        `<div class="sb-snap-row">` +
        `  <span class="sb-snap-pill ${kindCls}">${kindMap[s.kind] || '자동'}</span>` +
        `  <span class="sb-snap-label">${escapeHtml(s.label || '스냅샷')}</span>` +
        `  <span class="sb-snap-time">${dt}</span>` +
        `  <button type="button" class="sb-snap-restore" data-snap-id="${escapeHtml(s.id)}">복원</button>` +
        `</div>`
      );
    }).join('');

    listEl.querySelectorAll('.sb-snap-restore').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const snap = await BrainBackup.getSnapshot(btn.dataset.snapId);
        if (!snap?.payload) {
          showToast('스냅샷을 불러올 수 없습니다.');
          return;
        }
        try {
          await applyBackupPayload(snap.payload, { reasonLabel: '스냅샷 복원 직전 자동 백업' });
          await renderBackupSnapshotList();
          showToast('↩️ 선택한 스냅샷 시점으로 복원되었습니다.');
        } catch (err) {
          showToast(`복원 실패: ${err.message}`);
        }
      });
    });
  }

  function openSettingsModal() {
    closeMoreMenu();
    $('key-gemini').value = state.settings.keys.gemini || '';
    $('key-openai').value = state.settings.keys.openai || '';
    $('key-anthropic').value = state.settings.keys.anthropic || '';
    $('key-grok').value = state.settings.keys.grok || '';

    $('custom-model-gemini').value = state.settings.customModels.gemini || '';
    $('custom-model-openai').value = state.settings.customModels.openai || '';
    $('custom-model-anthropic').value = state.settings.customModels.anthropic || '';
    $('custom-model-grok').value = state.settings.customModels.grok || '';
    $('local-bridge-url').value = state.settings.localBridgeUrl || LocalBridge.DEFAULT_URL;

    if ($('key-storage-mode') && BrainSecurity) {
      $('key-storage-mode').value = BrainSecurity.hasEncryptedVault() ? 'vault' : BrainSecurity.getKeyStorageMode();
    }
    if ($('key-vault-passphrase')) $('key-vault-passphrase').value = '';
    updateVaultModalUI();
    renderBackupSnapshotList();

    elSettingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    elSettingsModal.style.display = 'none';
  }

  $('key-storage-mode')?.addEventListener('change', updateVaultModalUI);

  $('btn-unlock-vault')?.addEventListener('click', async () => {
    if (!BrainSecurity) return;
    const pass = String($('key-vault-passphrase')?.value || '');
    if (pass.length < 4) {
      showToast('금고 비밀번호(4자 이상)를 입력해 주세요.');
      $('key-vault-passphrase')?.focus();
      return;
    }
    try {
      const keys = await BrainSecurity.unlockEncryptedVault(pass);
      state.settings.keys = { ...state.settings.keys, ...keys };
      $('key-gemini').value = state.settings.keys.gemini || '';
      $('key-openai').value = state.settings.keys.openai || '';
      $('key-anthropic').value = state.settings.keys.anthropic || '';
      $('key-grok').value = state.settings.keys.grok || '';
      updateVaultModalUI();
      updateApiStatusSummary();
      if (isHomeMode && paraDashboard) paraDashboard.renderAll();
      showToast('🔓 암호화 금고가 해제되어 세션에 키가 복원되었습니다.');
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  $('btn-clear-vault')?.addEventListener('click', () => {
    if (!BrainSecurity) return;
    BrainSecurity.clearEncryptedVault();
    if ($('key-storage-mode')) $('key-storage-mode').value = 'session';
    if ($('key-vault-passphrase')) $('key-vault-passphrase').value = '';
    updateVaultModalUI();
    showToast('🧹 암호화 금고를 삭제하고 세션 전용 모드로 전환했습니다.');
  });

  $('btn-save-snapshot-now')?.addEventListener('click', async () => {
    if (!BrainBackup) return;
    await BrainBackup.saveSnapshot({
      kind: 'manual',
      label: '수동 백업 스냅샷',
      userEmail: getActiveUserEmail() || 'guest',
      payload: buildFullBackupPayload()
    });
    autoBackupDirty = false;
    await renderBackupSnapshotList();
    showToast('💾 현재 상태의 백업 스냅샷이 저장되었습니다.');
  });

  $('btn-settings').addEventListener('click', openSettingsModal);
  $('btn-close-settings').addEventListener('click', closeSettingsModal);
  $('btn-cancel-settings').addEventListener('click', closeSettingsModal);
  elSettingsModal.addEventListener('click', (e) => {
    if (e.target === elSettingsModal) closeSettingsModal();
  });

  $('btn-save-settings').addEventListener('click', async () => {
    state.settings.keys.gemini = $('key-gemini').value.trim();
    state.settings.keys.openai = $('key-openai').value.trim();
    state.settings.keys.anthropic = $('key-anthropic').value.trim();
    state.settings.keys.grok = $('key-grok').value.trim();

    state.settings.customModels.gemini = $('custom-model-gemini').value.trim().replace(/^models\//i, '');
    state.settings.customModels.openai = $('custom-model-openai').value.trim();
    state.settings.customModels.anthropic = $('custom-model-anthropic').value.trim();
    state.settings.customModels.grok = $('custom-model-grok').value.trim();
    state.settings.localBridgeUrl = $('local-bridge-url').value.trim() || LocalBridge.DEFAULT_URL;

    const storageMode = $('key-storage-mode')?.value || 'session';
    const hasAnyKey = Object.values(state.settings.keys).some((v) => Boolean(v));
    if (!isGuestMode && BrainSecurity) {
      BrainSecurity.saveSessionKeys(state.settings.keys);
      if (storageMode === 'vault' && hasAnyKey) {
        const pass = String($('key-vault-passphrase')?.value || '');
        if (pass.length >= 4) {
          try {
            await BrainSecurity.saveEncryptedVault(state.settings.keys, pass);
          } catch (err) {
            showToast(`⚠️ 암호화 금고 저장 실패(세션에만 유지됨): ${err.message}`);
          }
        } else if (!BrainSecurity.hasEncryptedVault()) {
          showToast('⚠️ 암호화 금고 저장을 위해 4자 이상 비밀번호를 입력해 주세요. (현재 세션에만 저장됨)');
        }
      } else if (storageMode === 'session') {
        BrainSecurity.setKeyStorageMode('session');
      }
    }

    persistSettings();
    populateModels(elChatProvider.value);
    updateApiStatusSummary();
    refreshBridgeStatus(false);
    if (isHomeMode && paraDashboard) paraDashboard.renderAll();
    closeSettingsModal();
    showToast(
      isGuestMode
        ? '✅ 설정이 저장되었습니다.'
        : (storageMode === 'vault' && BrainSecurity?.hasEncryptedVault()
          ? '🔐 API 키가 AES-256-GCM 암호화 금고에 안전하게 저장되었습니다.'
          : '🔒 API 키가 현재 세션 메모리에 안전하게 저장되었습니다. (평문 localStorage 미저장)')
    );
  });

  $('btn-export-json').addEventListener('click', () => {
    const payload = buildFullBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `second-brain-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇️ 전체 백업 JSON 파일(파일·PARA·관계·일정 포함, API 키 제외)이 다운로드되었습니다.');
  });

  $('btn-import-json').addEventListener('click', () => $('import-file-input').click());
  $('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        await applyBackupPayload(parsed, { reasonLabel: `JSON 가져오기 전 (${file.name})` });
        await renderBackupSnapshotList();
        closeSettingsModal();
        showToast('⬆️ 가져오기 전 안전 스냅샷을 저장하고 데이터를 복원했습니다.');
      } catch (err) {
        showToast(`복원 실패: ${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  // ================= Google Auth & Windows-Style Login Screen =================
  const elAuthModal = $('auth-modal');
  const elOsWindow = $('os-window');
  const elLoginScreen = $('os-login-screen');
  const elLoginClock = $('login-clock');
  const elLoginDate = $('login-date');
  const elLoginStatusText = $('login-status-text');
  const elLoginErrorBox = $('login-error-box');
  const elLoginFileWarning = $('login-file-warning');
  const elBtnOsGoogleLogin = $('btn-os-google-login');

  let isAuthBusy = false;

  function updateLoginClock() {
    if (!elLoginClock || !elLoginDate) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    elLoginClock.textContent = `${hh}:${mm}`;
    elLoginDate.textContent = now.toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  }

  function setLoginScreenError(msg = '') {
    if (!elLoginErrorBox) return;
    if (msg) {
      elLoginErrorBox.innerHTML = `<b>⚠️ 로그인 / 동기화 오류:</b> ${escapeHtml(msg)}`;
      elLoginErrorBox.style.display = 'block';
    } else {
      elLoginErrorBox.style.display = 'none';
      elLoginErrorBox.innerHTML = '';
    }
  }

  function applyGuestModeUI(enabled) {
    isGuestMode = Boolean(enabled);
    document.body.classList.toggle('guest-mode', isGuestMode);
    const badge = $('os-mode-badge');
    if (badge) badge.textContent = isGuestMode ? 'Offline' : 'Multi-AI';
    const settingsBtnTxt = $('settings-btn-text');
    if (settingsBtnTxt) settingsBtnTxt.textContent = isGuestMode ? '백업 설정' : 'API 설정';
    const settingsTitle = $('settings-modal-title');
    if (settingsTitle) settingsTitle.textContent = isGuestMode ? '⚙️ 오프라인 데이터 백업 · 로컬 설정' : '⚙️ API 키 & 데이터 설정';
    const rpBtnTxt = $('right-panel-btn-text');
    if (rpBtnTxt) rpBtnTxt.textContent = isGuestMode ? '메모 상세' : '메모 / AI';
    const driveBtn = $('btn-drive-sync');
    if (driveBtn) driveBtn.style.display = isGuestMode ? 'none' : '';
    if (isGuestMode) {
      switchRightTab('preview');
    }
    updateApiStatusSummary();
    updateAuthButtonUI();
  }

  function enterGuestWorkspace() {
    closeAuthModal();
    if (driveSyncTimer) {
      clearTimeout(driveSyncTimer);
      driveSyncTimer = null;
    }
    for (const t of mdDriveSyncTimers.values()) clearTimeout(t);
    mdDriveSyncTimers.clear();
    WinManager.closeAll();
    openMdWindows.clear();
    openSheetViews.clear();
    BrainDrive.clearCache();
    hasSyncedDriveThisSession = false;
    driveSyncStatus = 'disconnected';

    switchUser('guest@local.offline');
    selectedItemIds.clear();
    lastClickedItemId = null;
    offlineBannerDismissed = false;
    applyGuestModeUI(true);

    if (elOsWindow) elOsWindow.classList.remove('os-locked');
    if (elLoginScreen) elLoginScreen.classList.add('hidden');
    if (elLoginStatusText) elLoginStatusText.textContent = '';
    setLoginScreenError('');

    renderTree(state.fileSystem, elTreeRoot, true);
    openFolder(state.currentFolder);
    clearSelectionView();
    updateLocalLockBanner();
    setHomeMode(true);
    initLocalFolderSyncForWorkspace().then((st) => {
      if (st?.connected) {
        showToast(`👤 게스트 모드 입장 · 📂 로컬 폴더(${st.folderName}) 자동 저장 활성화됨`);
      } else {
        showToast('👤 게스트 모드(오프라인)로 입장했습니다. 상단 [📂 로컬 폴더]를 연결하면 파일이 PC에 자동 저장됩니다.');
      }
    });
  }

  function showLoginScreen(statusText = '', errorMsg = '') {
    closeMoreMenu();
    closeOsNavMenu();
    closeGlobalSearchPopover();
    applyGuestModeUI(false);
    if (driveSyncTimer) {
      clearTimeout(driveSyncTimer);
      driveSyncTimer = null;
    }
    for (const t of mdDriveSyncTimers.values()) clearTimeout(t);
    mdDriveSyncTimers.clear();
    hasSyncedDriveThisSession = false;
    WinManager.closeAll();
    openMdWindows.clear();
    BrainDrive.clearCache();
    clearActiveWorkspace();

    searchQuery = '';
    if (elGlobalSearch) elGlobalSearch.value = '';
    if (elBtnClearSearch) elBtnClearSearch.style.display = 'none';
    if (elTreeRoot) elTreeRoot.innerHTML = '';
    if (elContentArea) elContentArea.innerHTML = '';
    if (elChatMessages) elChatMessages.innerHTML = '';
    selectedItemIds.clear();
    lastClickedItemId = null;
    clearSelectionView();

    if (elOsWindow) elOsWindow.classList.add('os-locked');
    if (elLoginScreen) elLoginScreen.classList.remove('hidden');

    const isFile = BrainAuth.isFileProtocol();
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const offlineFirst = isFile || isOffline;

    const elOfflineBadge = $('login-offline-badge');
    const elOnlineBlock = $('login-online-block');
    const elOnlineTip = $('login-online-tip');
    const elGuestBtn = $('btn-os-guest-login');
    const elGuestText = $('btn-os-guest-text');

    if (elOfflineBadge) elOfflineBadge.style.display = offlineFirst ? 'block' : 'none';
    if (elOnlineBlock) elOnlineBlock.style.display = offlineFirst ? 'none' : 'block';
    if (elOnlineTip) elOnlineTip.style.display = offlineFirst ? 'block' : 'none';
    if (elLoginFileWarning) elLoginFileWarning.style.display = 'none';
    if (elBtnOsGoogleLogin) elBtnOsGoogleLogin.disabled = offlineFirst;
    if (elGuestBtn) elGuestBtn.classList.toggle('is-primary', offlineFirst);
    if (elGuestText) {
      elGuestText.textContent = offlineFirst
        ? '게스트로 바로 시작 (.bat 없이 오프라인 실행)'
        : '게스트로 시작 (오프라인 · AI 제외)';
    }
    if (elLoginStatusText) elLoginStatusText.textContent = statusText || '';
    setLoginScreenError(errorMsg);
    updateLoginClock();
    updateAuthButtonUI();
    updateDriveStatusUI();
  }

  async function enterWorkspaceForUser(user, { triggerInitialSync = false, waitForSyncBeforeReveal = false } = {}) {
    if (!user || !user.email) {
      showLoginScreen();
      return;
    }

    const email = String(user.email).trim().toLowerCase();
    applyGuestModeUI(false);
    const isAccountChanged = getActiveUserEmail() !== email;

    if (isAccountChanged) {
      if (driveSyncTimer) {
        clearTimeout(driveSyncTimer);
        driveSyncTimer = null;
      }
      WinManager.closeAll();
      openMdWindows.clear();
      BrainDrive.clearCache();
      hasSyncedDriveThisSession = false;
      lastDriveErrorMessage = '';
      lastDriveErrorCode = '';
      driveSyncStatus = BrainAuth.hasDriveAccess() ? 'synced' : 'expired';
      switchUser(email);
    }

    const shouldSync =
      (triggerInitialSync || (BrainAuth.hasDriveAccess() && !hasSyncedDriveThisSession)) &&
      BrainAuth.hasDriveAccess();

    if (waitForSyncBeforeReveal && shouldSync) {
      if (elLoginStatusText) elLoginStatusText.textContent = `☁️ ${email}의 Google Drive(SecondBrainOS) 불러오는 중...`;
      await syncWithDrive({ mode: 'initial', interactive: false, showSuccessToast: true });
    }

    if (elOsWindow) elOsWindow.classList.remove('os-locked');
    if (elLoginScreen) elLoginScreen.classList.add('hidden');
    if (elLoginStatusText) elLoginStatusText.textContent = '';
    setLoginScreenError('');

    onAuthStateChanged();
    renderChatMessages();
    setHomeMode(true);
    initLocalFolderSyncForWorkspace().catch(() => {});

    if (!waitForSyncBeforeReveal && shouldSync) {
      syncWithDrive({ mode: 'initial', interactive: false, showSuccessToast: true });
    }
  }

  async function logoutAndLockOS(reasonMsg = '로그아웃되었습니다. 다른 Google 계정으로 로그인하거나 게스트로 입장할 수 있습니다.') {
    const wasGuest = isGuestMode;
    closeAuthModal();
    if (driveSyncTimer) {
      clearTimeout(driveSyncTimer);
      driveSyncTimer = null;
    }
    hasSyncedDriveThisSession = false;
    lastDriveErrorMessage = '';
    lastDriveErrorCode = '';
    driveSyncStatus = 'disconnected';
    BrainDrive.clearCache();
    if (!wasGuest) {
      try { await BrainAuth.signOut(); } catch (_) {}
    }
    showLoginScreen(wasGuest ? '게스트 모드에서 나왔습니다. Google 로그인 또는 게스트로 다시 입장할 수 있습니다.' : reasonMsg);
    showToast('🔒 잠금 화면으로 이동했습니다.');
  }

  function isOwnerAuthenticated() {
    const user = BrainAuth.getUser();
    return Boolean(user && user.email && user.emailVerified);
  }

  function isItemVisible(item) {
    if (!item || item.id === 'root') return true;
    if (!LocalBridge.isLocalProtectedItem(item)) return true;
    return isOwnerAuthenticated();
  }

  function countHiddenLocalItems(node = state.fileSystem) {
    if (!node || isOwnerAuthenticated()) return 0;
    let count = 0;
    if (node.id !== 'root' && LocalBridge.isLocalProtectedItem(node)) {
      return 1;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        count += countHiddenLocalItems(child);
      }
    }
    return count;
  }

  function stripLocalItemsForExport(node) {
    const clone = { ...node };
    if (Array.isArray(node.children)) {
      clone.children = node.children
        .filter((child) => !LocalBridge.isLocalProtectedItem(child))
        .map((child) => stripLocalItemsForExport(child));
    }
    return clone;
  }

  function updateLocalLockBanner() {
    const banner = $('local-lock-banner');
    const textEl = $('local-lock-banner-text');
    if (!banner || !textEl) return;

    const hiddenCount = countHiddenLocalItems(state.fileSystem);
    if (!isOwnerAuthenticated() && hiddenCount > 0) {
      const user = BrainAuth.getUser();
      if (user) {
        textEl.textContent = `🔒 저장된 로컬 항목 ${hiddenCount}개 잠김 — 현재 계정(${user.email})은 허용된 소유자가 아닙니다.`;
      } else {
        textEl.textContent = `🔒 저장된 로컬 항목 ${hiddenCount}개가 숨겨져 있습니다. 내 구글 계정으로 로그인하면 볼 수 있습니다.`;
      }
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }

  function updateAuthButtonUI() {
    const btn = $('btn-google-auth');
    const iconEl = $('auth-btn-icon');
    const textEl = $('auth-btn-text');
    if (!btn || !iconEl || !textEl) return;

    const userSvg = BrainIcons ? BrainIcons.svg('user', 15) : '👤';
    const user = BrainAuth.getUser();
    const unlocked = isOwnerAuthenticated();

    if (isGuestMode) {
      btn.classList.remove('active');
      iconEl.innerHTML = userSvg;
      textEl.textContent = '게스트 (오프라인)';
      btn.title = '오프라인 게스트 모드 — 클릭하여 Google 로그인 설정';
      return;
    }

    if (unlocked && user) {
      btn.classList.add('active');
      iconEl.innerHTML = user.picture
        ? `<img src="${escapeHtml(user.picture)}" alt="" class="auth-avatar-mini" referrerpolicy="no-referrer">`
        : userSvg;
      textEl.textContent = user.email.split('@')[0];
      btn.title = `인증됨 (${user.email}) — 클릭하여 로그아웃/잠금`;
    } else if (user) {
      btn.classList.remove('active');
      iconEl.innerHTML = userSvg;
      textEl.textContent = '권한 없음';
      btn.title = `${user.email} 계정은 허용된 소유자 이메일과 다릅니다.`;
    } else {
      btn.classList.remove('active');
      iconEl.innerHTML = userSvg;
      textEl.textContent = 'Google 로그인';
      btn.title = '내 구글 계정으로 로그인하여 저장한 로컬 항목 보기';
    }
  }

  function renderAuthModalContent() {
    const user = BrainAuth.getUser();
    const unlocked = isOwnerAuthenticated();
    const hasDrive = BrainAuth.hasDriveAccess();
    const ownerEmail = (state.settings.ownerEmail || '').trim();
    const hasConfig = BrainAuth.isConfigComplete(state.settings.firebaseConfig);
    const isFile = BrainAuth.isFileProtocol();
    const card = $('auth-status-card');
    const titleEl = $('auth-status-title');
    const subEl = $('auth-status-sub');
    const btnSignIn = $('btn-firebase-google-login');
    const btnSignOut = $('btn-google-signout');
    const driveActions = $('auth-drive-actions');
    const fileWarn = $('auth-file-warning');
    const driveErrBox = $('auth-drive-error-box');

    card.classList.remove('unlocked', 'denied');
    fileWarn.style.display = isFile ? 'block' : 'none';

    if (driveErrBox) {
      if (lastDriveErrorMessage) {
        const projId = (state.settings.firebaseConfig?.projectId || '').trim();
        const enableUrl = projId
          ? `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${encodeURIComponent(projId)}`
          : 'https://console.cloud.google.com/apis/library/drive.googleapis.com';
        const extraLink =
          lastDriveErrorCode === 'API_DISABLED'
            ? `<div style="margin-top:6px;"><a href="${escapeHtml(enableUrl)}" target="_blank" rel="noopener" style="font-weight:700; color:var(--primary);">👉 Google Drive API 지금 켜러 가기 (${escapeHtml(projId || '프로젝트 선택')}) ↗</a></div>`
            : '';
        driveErrBox.innerHTML = `<b>⚠️ Google Drive 연동 오류:</b> ${escapeHtml(lastDriveErrorMessage)}${extraLink}`;
        driveErrBox.style.display = 'block';
      } else {
        driveErrBox.style.display = 'none';
        driveErrBox.innerHTML = '';
      }
    }

    if (isGuestMode) {
      titleEl.textContent = '👤 오프라인 게스트 모드 사용 중';
      subEl.textContent = '현재 로컬 오프라인 모드로 실행 중이며 AI·API 및 Google Drive 동기화는 비활성화되어 있습니다. 온라인 상태에서 Google 로그인하면 클라우드 동기화와 AI 기능을 사용할 수 있습니다.';
      btnSignIn.style.display = isFile ? 'none' : 'flex';
      btnSignIn.disabled = !hasConfig;
      if (driveActions) driveActions.style.display = 'none';
      btnSignOut.style.display = 'none';
      return;
    }

    if (unlocked && user) {
      card.classList.add('unlocked');
      titleEl.textContent = `🔓 본인 인증 완료 (${user.email})`;
      subEl.textContent = hasDrive
        ? 'Google Drive(내 드라이브 / SecondBrainOS 폴더)에 메모·HTML·MD·이미지·PDF·PPT가 자동 동기화됩니다.'
        : '로그인되어 있으나 Google Drive 토큰이 만료/미연결 상태입니다. 아래 [지금 동기화] 또는 다시 로그인을 눌러 연결하세요.';
      btnSignIn.style.display = hasDrive ? 'none' : (isFile ? 'none' : 'flex');
      btnSignIn.disabled = !hasConfig;
      if (driveActions) driveActions.style.display = 'flex';
      btnSignOut.style.display = 'block';
    } else if (user) {
      card.classList.add('denied');
      titleEl.textContent = `🚫 접근 거부됨 (${user.email})`;
      subEl.textContent = ownerEmail
        ? `허용된 내 구글 이메일(${ownerEmail})과 다른 계정입니다. 본인 계정으로 다시 로그인해 주세요.`
        : '아래에 허용할 내 구글 이메일을 입력하고 저장해 주세요.';
      btnSignIn.style.display = isFile ? 'none' : 'flex';
      btnSignIn.disabled = !hasConfig;
      if (driveActions) driveActions.style.display = 'none';
      btnSignOut.style.display = 'block';
    } else {
      titleEl.textContent = '🔒 잠김 상태 (드라이브 미연결)';
      subEl.textContent = hasConfig
        ? (ownerEmail
          ? `허용된 계정(${ownerEmail})으로 Google 로그인하면 내 드라이브(SecondBrainOS 폴더)와 자동 동기화됩니다.`
          : '아래에 허용할 내 구글 이메일을 입력한 뒤 Google 로그인을 눌러 주세요.')
        : '아래에 Firebase 설정(firebaseConfig)과 내 구글 이메일을 입력한 뒤 로그인해 주세요.';
      btnSignIn.style.display = isFile ? 'none' : 'flex';
      btnSignIn.disabled = !hasConfig;
      if (driveActions) driveActions.style.display = 'none';
      btnSignOut.style.display = 'none';
    }
  }

  function handleAuthUserChanged(fbUser) {
    if (isAuthBusy) return;
    const user = fbUser || BrainAuth.getUser();
    if (user && user.email) {
      enterWorkspaceForUser(user, { triggerInitialSync: false, waitForSyncBeforeReveal: false });
    } else if (!isGuestMode) {
      showLoginScreen('');
    }
    if (elAuthModal.style.display === 'flex') {
      renderAuthModalContent();
    }
  }

  function onAuthStateChanged() {
    updateAuthButtonUI();
    updateDriveStatusUI();

    if (!isOwnerAuthenticated()) {
      hasSyncedDriveThisSession = false;
      if (state.selectedItem && !isItemVisible(state.selectedItem)) {
        clearSelectionView();
      }
      const curPath = getPathToNode(state.currentFolder?.id) || [];
      if (curPath.some((n) => !isItemVisible(n))) {
        state.currentFolder = state.fileSystem;
      }
      return;
    }

    renderTree(state.fileSystem, elTreeRoot, true);
    if (searchQuery) renderSearchResults(searchQuery);
    else openFolder(state.currentFolder);
    renderContextChips();
    updateLocalLockBanner();
  }

  function openAuthModal() {
    const fb = state.settings.firebaseConfig || {};
    $('auth-owner-email').value = state.settings.ownerEmail || '';
    $('auth-firebase-paste').value = '';
    $('auth-fb-apikey').value = fb.apiKey || '';
    $('auth-fb-authdomain').value = fb.authDomain || '';
    $('auth-fb-projectid').value = fb.projectId || '';
    elAuthModal.style.display = 'flex';
    renderAuthModalContent();
  }

  function closeAuthModal() {
    elAuthModal.style.display = 'none';
  }

  function saveAuthFormToState() {
    const pasted = BrainAuth.parseFirebaseConfigText($('auth-firebase-paste').value);
    if (pasted) {
      if (pasted.apiKey) $('auth-fb-apikey').value = pasted.apiKey;
      if (pasted.authDomain) $('auth-fb-authdomain').value = pasted.authDomain;
      if (pasted.projectId) $('auth-fb-projectid').value = pasted.projectId;
    }
    state.settings.ownerEmail = $('auth-owner-email').value.trim().toLowerCase();
    state.settings.firebaseConfig = {
      ...(state.settings.firebaseConfig || {}),
      ...(pasted && pasted.storageBucket ? { storageBucket: pasted.storageBucket } : {}),
      ...(pasted && pasted.messagingSenderId ? { messagingSenderId: pasted.messagingSenderId } : {}),
      ...(pasted && pasted.appId ? { appId: pasted.appId } : {}),
      apiKey: $('auth-fb-apikey').value.trim(),
      authDomain: $('auth-fb-authdomain').value.trim(),
      projectId: $('auth-fb-projectid').value.trim()
    };
    persistSettings();
  }

  $('auth-firebase-paste').addEventListener('input', (e) => {
    const parsed = BrainAuth.parseFirebaseConfigText(e.target.value);
    if (parsed) {
      if (parsed.apiKey) $('auth-fb-apikey').value = parsed.apiKey;
      if (parsed.authDomain) $('auth-fb-authdomain').value = parsed.authDomain;
      if (parsed.projectId) $('auth-fb-projectid').value = parsed.projectId;
      showToast('✨ firebaseConfig 값이 자동으로 채워졌습니다. 저장을 눌러주세요.');
    }
  });

  $('btn-google-auth').addEventListener('click', openAuthModal);
  $('btn-banner-google-login').addEventListener('click', openAuthModal);
  $('btn-close-auth').addEventListener('click', closeAuthModal);
  $('btn-cancel-auth').addEventListener('click', closeAuthModal);
  elAuthModal.addEventListener('click', (e) => {
    if (e.target === elAuthModal) closeAuthModal();
  });

  async function performGoogleLoginFlow(fromLoginScreen = false) {
    if (isAuthBusy) return;
    isAuthBusy = true;

    const btnOs = $('btn-os-google-login');
    const btnModal = $('btn-firebase-google-login');
    if (btnOs) btnOs.disabled = true;
    if (btnModal) btnModal.disabled = true;

    if (fromLoginScreen) {
      setLoginScreenError('');
      if (elLoginStatusText) elLoginStatusText.textContent = '🔑 Google 로그인 창을 여는 중...';
    }

    try {
      const user = await BrainAuth.signInWithGoogle(state.settings.firebaseConfig);
      if (user && user.email) {
        closeAuthModal();
        await enterWorkspaceForUser(user, {
          triggerInitialSync: true,
          waitForSyncBeforeReveal: fromLoginScreen
        });
        showToast(`🔓 ${user.email} 계정으로 접속했습니다.`);
      }
    } catch (err) {
      if (fromLoginScreen) {
        setLoginScreenError(err.message);
        if (elLoginStatusText) elLoginStatusText.textContent = '';
      }
      showToast(`⚠️ ${err.message}`);
    } finally {
      isAuthBusy = false;
      if (btnOs) btnOs.disabled = BrainAuth.isFileProtocol();
      if (btnModal) btnModal.disabled = !BrainAuth.isConfigComplete(state.settings.firebaseConfig);
      if (elAuthModal.style.display === 'flex') {
        renderAuthModalContent();
      }
    }
  }

  $('btn-os-google-login').addEventListener('click', () => performGoogleLoginFlow(true));
  $('btn-os-guest-login').addEventListener('click', () => enterGuestWorkspace());
  $('btn-login-firebase-config').addEventListener('click', openAuthModal);
  $('btn-lock-os').addEventListener('click', () => logoutAndLockOS());

  $('btn-firebase-google-login').addEventListener('click', async () => {
    saveAuthFormToState();
    await performGoogleLoginFlow(false);
  });

  $('btn-google-signout').addEventListener('click', async () => {
    await logoutAndLockOS();
  });

  $('btn-save-auth-config').addEventListener('click', async () => {
    saveAuthFormToState();
    try {
      await BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged);
    } catch (err) {
      showToast(`⚠️ Firebase 초기화 오류: ${err.message}`);
    }
    onAuthStateChanged();
    renderAuthModalContent();
    showToast('✅ Firebase 인증 설정이 저장되었습니다.');
  });

  // 편집 중 로컬 경로 입력 시 비공개 체크박스 자동 활성화
  $('edit-link').addEventListener('input', (e) => {
    if (LocalBridge.isLocalPath(e.target.value)) {
      $('edit-local-private').checked = true;
    }
  });

  // ================= Local Program Bridge =================
  function getBridgeUrl() {
    return state.settings.localBridgeUrl || LocalBridge.DEFAULT_URL;
  }

  async function refreshBridgeStatus(showFeedback = false) {
    const health = await LocalBridge.checkHealth(getBridgeUrl());
    const ok = Boolean(health && health.ok);
    isBridgeConnected = ok;
    const dot = $('bridge-status-dot');
    const text = $('bridge-status-text');
    const moreBadge = $('more-bridge-badge');
    if (dot) dot.classList.toggle('connected', ok);
    if (text) text.textContent = ok ? '로컬 연결됨' : '로컬 미연결';
    if (moreBadge) moreBadge.textContent = ok ? '연결됨' : '미연결';

    // bridge-config.json에 설정된 firebaseConfig가 있고 브라우저에 아직 없으면 자동 동기화
    if (ok && health.firebaseConfig && BrainAuth.isConfigComplete(health.firebaseConfig) && !BrainAuth.isConfigComplete(state.settings.firebaseConfig)) {
      state.settings.firebaseConfig = {
        apiKey: health.firebaseConfig.apiKey || '',
        authDomain: health.firebaseConfig.authDomain || '',
        projectId: health.firebaseConfig.projectId || ''
      };
      persistSettings();
      BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged).catch(() => {});
    }

    if (showFeedback) {
      if (ok && !health.firebaseConfigured) {
        showToast('⚠️ 로컬 브릿지 연결됨 — local-bridge/bridge-config.json에 firebaseApiKey를 설정해 주세요.');
      } else if (ok && !health.allowedEmailConfigured) {
        showToast('🟢 로컬 실행 도우미 연결됨! Google 로그인 후 처음 로컬 실행 시 본인 계정이 자동 등록됩니다.');
      } else if (ok) {
        showToast('🟢 로컬 실행 도우미가 정상 연결되어 있습니다.');
      } else {
        showToast('⚪ 로컬 미연결: local-bridge/로컬연결_실행.bat 파일을 먼저 실행해 주세요.');
      }
    }
    return ok;
  }

  async function launchLocalItem(targetPath, mode = 'open') {
    if (!targetPath) return;
    if (!isOwnerAuthenticated()) {
      showToast('🔒 내 구글 계정으로 로그인해야 로컬 프로그램을 실행할 수 있습니다.');
      openAuthModal();
      return;
    }

    const token = await BrainAuth.getToken();
    if (!token) {
      onAuthStateChanged();
      showToast('🔒 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      openAuthModal();
      return;
    }

    try {
      const res = await LocalBridge.openLocal(targetPath, mode, getBridgeUrl(), token);
      const dot = $('bridge-status-dot');
      const text = $('bridge-status-text');
      if (dot) dot.classList.add('connected');
      if (text) text.textContent = '로컬 연결됨';
      showToast(mode === 'reveal' ? `📂 폴더 열림: ${res.opened}` : `🚀 실행됨: ${res.opened}`);
    } catch (err) {
      refreshBridgeStatus(false);
      showToast(`⚠️ ${err.message}`);
    }
  }

  $('p-link-badge').addEventListener('click', (e) => {
    const localPath = e.currentTarget.dataset.localPath;
    if (localPath) {
      e.preventDefault();
      launchLocalItem(localPath, 'open');
    }
  });

  function isHtmlContentItem(item) {
    if (!item || item.type !== 'doc') return false;
    const content = String(item.summary || '').trim();
    if (!content) return false;
    const isHtmlName = /\.html?$/i.test(String(item.name || '').trim());
    const looksLikeHtml = /<!doctype\s+html|<html[\s>]/i.test(content);
    return isHtmlName || looksLikeHtml;
  }

  function runHtmlContent(item) {
    const content = String(item?.summary || '');
    if (!content.trim()) {
      showToast('실행할 HTML 내용이 비어 있습니다.');
      return;
    }
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      showToast('브라우저에서 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast(`🌐 "${item.name}" HTML 실행됨`);
  }

  const TEXT_EDITABLE_EXTS = new Set([
    'txt', 'md', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
    'json', 'csv', 'xml', 'yml', 'yaml', 'py', 'java', 'c', 'cpp',
    'h', 'sql', 'log', 'ini', 'conf', 'sh', 'bat', 'ps1'
  ]);

  function isBinaryFileName(fileName) {
    const raw = String(fileName || '').trim();
    const m = raw.match(/\.([a-z0-9]{1,8})$/i);
    if (!m) return false;
    return !TEXT_EDITABLE_EXTS.has(m[1].toLowerCase());
  }

  function resolveVirtualFileName(item) {
    const rawName = String(item?.name || 'memo').trim() || 'memo';
    if (/\.[a-z0-9]{1,8}$/i.test(rawName)) return rawName;
    if (isHtmlContentItem(item)) return `${rawName}.html`;
    return `${rawName}.txt`;
  }

  function getLocalAppButtonLabel(item) {
    const fileName = resolveVirtualFileName(item).toLowerCase();
    if (/\.html?$/.test(fileName)) return '🖥️ PC 브라우저로 열기';
    if (/\.csv$/.test(fileName)) return '📊 PC 엑셀로 열기';
    if (/\.txt$/.test(fileName)) return '📝 PC 메모장으로 열기';
    return '🖥️ PC 연결 앱으로 열기';
  }

  async function openMemoInLocalApp(item) {
    if (!item || item.type !== 'doc') return;
    if (!isOwnerAuthenticated()) {
      showToast('🔒 내 구글 계정으로 로그인해야 PC 연결 프로그램으로 열 수 있습니다.');
      openAuthModal();
      return;
    }
    const token = await BrainAuth.getToken();
    if (!token) {
      onAuthStateChanged();
      showToast('🔒 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
      openAuthModal();
      return;
    }

    // Google Drive에 저장된 실제 바이너리 파일(PPT/PDF/Excel/Word/이미지 등)을 PC 앱으로 바로 열기
    if (item.driveFile && item.driveFile.id) {
      let driveToken;
      try {
        driveToken = await ensureDriveToken(true);
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
        return;
      }
      const targetName = item.driveFile.name || resolveVirtualFileName(item);
      showToast(`🚀 "${targetName}" PC 앱으로 불러오는 중...`);
      try {
        const base64 = await BrainDrive.getFileBase64(driveToken, item.driveFile.id);
        const res = await LocalBridge.openContentLocal(targetName, base64, getBridgeUrl(), token, true);
        isBridgeConnected = true;
        const dot = $('bridge-status-dot');
        const text = $('bridge-status-text');
        if (dot) dot.classList.add('connected');
        if (text) text.textContent = '로컬 연결됨';
        showToast(`🚀 PC 앱에서 열림: ${res.fileName || targetName}`);
      } catch (err) {
        handleDriveError(err);
        refreshBridgeStatus(false);
        showToast(`⚠️ ${err.message}`);
      }
      return;
    }

    const fileName = resolveVirtualFileName(item);
    if (isBinaryFileName(fileName)) {
      showToast('⚠️ 이 항목에는 원본 파일이 저장되어 있지 않습니다. 우측 패널에서 [원본 파일 업로드] 또는 [PC 경로 연결]을 진행해 주세요.');
      return;
    }

    const content = String(item.summary || '');
    try {
      const res = await LocalBridge.openContentLocal(fileName, content, getBridgeUrl(), token, false);
      isBridgeConnected = true;
      const dot = $('bridge-status-dot');
      const text = $('bridge-status-text');
      if (dot) dot.classList.add('connected');
      if (text) text.textContent = '로컬 연결됨';
      showToast(`🚀 PC 앱에서 열림: ${res.fileName || fileName}`);
    } catch (err) {
      refreshBridgeStatus(false);
      showToast(`⚠️ ${err.message}`);
    }
  }

  $('btn-open-local').addEventListener('click', () => {
    if (!state.selectedItem) return;
    if (state.selectedItem.link && LocalBridge.isLocalPath(state.selectedItem.link)) {
      launchLocalItem(state.selectedItem.link, 'open');
    } else if (isHtmlContentItem(state.selectedItem)) {
      openHtmlWindow(state.selectedItem);
    } else if (state.selectedItem.type === 'doc') {
      openMemoInLocalApp(state.selectedItem);
    }
  });

  $('btn-reveal-local').addEventListener('click', () => {
    if (!state.selectedItem) return;
    if (state.selectedItem.link && LocalBridge.isLocalPath(state.selectedItem.link)) {
      launchLocalItem(state.selectedItem.link, 'reveal');
    } else if (isHtmlContentItem(state.selectedItem)) {
      openMemoInLocalApp(state.selectedItem);
    }
  });

  $('btn-local-bridge').addEventListener('click', () => {
    refreshBridgeStatus(true);
  });

  $('btn-pick-local-file').addEventListener('click', async () => {
    if (!isOwnerAuthenticated()) {
      showToast('🔒 먼저 내 구글 계정으로 로그인해 주세요.');
      openAuthModal();
      return;
    }
    const token = await BrainAuth.getToken();
    if (!token) {
      onAuthStateChanged();
      openAuthModal();
      return;
    }
    try {
      const res = await LocalBridge.pickLocalFile(getBridgeUrl(), token);
      if (res.ok && res.path) {
        $('edit-link').value = res.path;
        $('edit-local-private').checked = true;
        const titleInput = $('edit-title');
        if (!titleInput.value.trim() || titleInput.value.trim() === '새 메모') {
          titleInput.value = res.name || res.path.split(/[\\/]/).pop();
        }
        const iconInput = $('edit-icon');
        if (!iconInput.value.trim() || iconInput.value.trim() === '📝' || iconInput.value.trim() === '📄') {
          iconInput.value = LocalBridge.guessIconForPath(res.path);
        }
        showToast(`📂 파일 선택됨: ${res.name || res.path}`);
      }
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  $('btn-test-bridge').addEventListener('click', async () => {
    const testUrl = $('local-bridge-url').value.trim() || LocalBridge.DEFAULT_URL;
    const health = await LocalBridge.checkHealth(testUrl);
    if (health && health.ok) {
      if (!health.firebaseConfigured) {
        showToast('⚠️ 연결됨 — local-bridge/bridge-config.json에 firebaseApiKey를 입력해 주세요.');
      } else if (!health.allowedEmailConfigured) {
        showToast('🟢 연결 성공! Google 로그인 후 첫 로컬 실행 시 본인 계정이 자동 등록됩니다.');
      } else {
        showToast('🟢 연결 성공! Firebase Google 로그인 후 로컬 프로그램을 실행할 수 있습니다.');
      }
    } else {
      showToast('⚪ 연결 실패: local-bridge/로컬연결_실행.bat 실행 여부를 확인해 주세요.');
    }
  });

  // ================= Offline Local Folder Auto-Save & Sync =================
  function isLocalhostOrigin() {
    try {
      const h = String(window.location.hostname || '').toLowerCase();
      return (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
        (h === 'localhost' || h === '127.0.0.1');
    } catch (_) {
      return false;
    }
  }

  function getActiveLocalBridgeUrl() {
    if (isLocalhostOrigin()) return window.location.origin;
    return getBridgeUrl();
  }

  function getLocalFileNameForItem(item) {
    if (!item) return 'memo.md';
    if (item.type === 'folder') return item.name || '새 폴더';
    if (isSpreadsheetItem(item)) {
      const n = String(item.name || 'sheet.xlsx').trim();
      if (/\.(xlsx|csv)$/i.test(n)) return n;
      return `${n.replace(/\.xls$/i, '')}.xlsx`;
    }
    return resolveVirtualFileName(item);
  }

  async function serializeItemForLocalFile(item) {
    if (!item || item.type !== 'doc') return null;
    if (isSpreadsheetItem(item) && item.sheetData) {
      const lower = String(item.name || '').toLowerCase();
      if (lower.endsWith('.csv')) {
        return {
          fileName: item.name,
          type: 'text',
          mimeType: 'text/csv;charset=utf-8',
          text: BrainSheet.exportSheetToCsv(item.sheetData, item.sheetData.activeSheet || 0)
        };
      }
      const xlsxName = getLocalFileNameForItem(item);
      const blob = await BrainSheet.exportWorkbookToXlsxBlob(item.sheetData);
      return {
        fileName: xlsxName,
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        blob
      };
    }

    if (item.uploadedBlobBase64) {
      const cleanB64 = String(item.uploadedBlobBase64).replace(/^data:[^;]+;base64,/, '');
      const buf = base64ToArrayBuffer(cleanB64);
      return {
        fileName: getLocalFileNameForItem(item),
        type: 'blob',
        mimeType: item.uploadedMime || 'application/octet-stream',
        blob: new Blob([buf], { type: item.uploadedMime || 'application/octet-stream' })
      };
    }

    if (!isBinaryFileName(item.name)) {
      const fileName = getLocalFileNameForItem(item);
      return {
        fileName,
        type: 'text',
        mimeType: /\.html?$/i.test(fileName) ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8',
        text: String(item.summary || '')
      };
    }
    return null;
  }

  function scheduleLocalWorkspaceMetaSave() {
    if (!BrainLocalFolder || !BrainLocalFolder.isConnected()) return;
    if (localMetaSaveTimer) clearTimeout(localMetaSaveTimer);
    localMetaSaveTimer = setTimeout(() => {
      localMetaSaveTimer = null;
      BrainLocalFolder.saveWorkspaceMeta(state.fileSystem).catch(() => {});
    }, 900);
  }

  async function syncItemToLocalFolderNow(item, opts = {}) {
    if (!BrainLocalFolder || !item || item.id === 'root') return { ok: false };

    if (item.type === 'folder') {
      if (!BrainLocalFolder.isConnected()) return { ok: false };
      const segs = getFolderPathSegments(item);
      const ok = await BrainLocalFolder.ensureSubfolder(segs);
      if (ok) scheduleLocalWorkspaceMetaSave();
      return { ok };
    }

    if (BrainLocalFolder.isConnected()) {
      const serialized = await serializeItemForLocalFile(item);
      if (!serialized) return { ok: false };
      const folderSegs = getRelativeFolderPathForItem(item.id);
      const res = serialized.type === 'blob'
        ? await BrainLocalFolder.writeBlobFile(folderSegs, serialized.fileName, serialized.blob, opts)
        : await BrainLocalFolder.writeTextFile(folderSegs, serialized.fileName, serialized.text, opts);
      if (res?.ok && !opts.skipMeta) scheduleLocalWorkspaceMetaSave();
      return res;
    }

    // Fallback: auto-download when offline & user enabled autoDownload
    const status = BrainLocalFolder.getStatus();
    if (opts.allowAutoDownload && status.autoDownload && (isGuestMode || !isOwnerAuthenticated())) {
      const serialized = await serializeItemForLocalFile(item);
      if (!serialized) return { ok: false };
      if (serialized.type === 'blob') BrainLocalFolder.downloadBlobToPC(serialized.blob, serialized.fileName);
      else BrainLocalFolder.downloadTextToPC(serialized.text, serialized.fileName, serialized.mimeType);
      return { ok: true, downloaded: true, fileName: serialized.fileName };
    }

    return { ok: false };
  }

  function scheduleItemSyncToLocalFolder(item, immediate = false, opts = {}) {
    if (!BrainLocalFolder || !item) return;
    if (!BrainLocalFolder.isConnected() && !(opts.allowAutoDownload && BrainLocalFolder.getStatus().autoDownload)) return;

    const prev = localFolderTimers.get(item.id);
    if (prev) {
      clearTimeout(prev);
      localFolderTimers.delete(item.id);
    }
    if (immediate) {
      syncItemToLocalFolderNow(item, opts).catch(() => {});
      return;
    }
    const t = setTimeout(() => {
      localFolderTimers.delete(item.id);
      syncItemToLocalFolderNow(item, opts).catch(() => {});
    }, 650);
    localFolderTimers.set(item.id, t);
  }

  async function syncSubtreeToLocalFolder(node, opts = {}) {
    if (!BrainLocalFolder || !BrainLocalFolder.isConnected() || !node) return 0;
    let savedCount = 0;

    async function walk(curr) {
      if (!curr || !isItemVisible(curr)) return;
      if (curr.id !== 'root') {
        if (curr.type === 'folder') {
          await BrainLocalFolder.ensureSubfolder(getFolderPathSegments(curr));
        } else {
          const res = await syncItemToLocalFolderNow(curr, { ...opts, skipMeta: true, silent: true });
          if (res?.ok && !res.skipped) savedCount++;
        }
      }
      if (Array.isArray(curr.children)) {
        for (const child of curr.children) {
          await walk(child);
        }
      }
    }

    await walk(node);
    await BrainLocalFolder.saveWorkspaceMeta(state.fileSystem);
    if (BrainSbMirror) {
      await BrainSbMirror.syncAllSbMirrors(getSbMirrorHooks(), { force: true }).catch(() => {});
    }
    return savedCount;
  }

  async function saveItemsToPC(items) {
    const list = (items || []).filter((it) => it && it.id !== 'root');
    if (list.length === 0) return;

    const connected = Boolean(BrainLocalFolder && BrainLocalFolder.isConnected());
    let savedCount = 0;
    let lastFile = '';

    for (const item of list) {
      if (item.type === 'folder') {
        if (connected) {
          savedCount += await syncSubtreeToLocalFolder(item);
          lastFile = item.name;
        }
        continue;
      }
      const serialized = await serializeItemForLocalFile(item);
      if (!serialized) continue;
      if (connected) {
        const res = await syncItemToLocalFolderNow(item);
        if (res?.ok) {
          savedCount++;
          lastFile = serialized.fileName;
        }
      } else {
        if (serialized.type === 'blob') BrainLocalFolder.downloadBlobToPC(serialized.blob, serialized.fileName);
        else BrainLocalFolder.downloadTextToPC(serialized.text, serialized.fileName, serialized.mimeType);
        savedCount++;
        lastFile = serialized.fileName;
      }
    }

    if (savedCount === 0) {
      showToast('⚠️ 저장할 수 있는 문서나 시트 파일이 없습니다.');
      return;
    }
    const st = BrainLocalFolder.getStatus();
    if (connected) {
      showToast(
        savedCount === 1
          ? `📂 로컬 폴더(${st.folderName})에 "${lastFile}" 저장 완료`
          : `📂 로컬 폴더(${st.folderName})에 파일 ${savedCount}개 저장 완료`
      );
    } else {
      showToast(
        savedCount === 1
          ? `💾 "${lastFile}" PC 파일로 다운로드되었습니다.`
          : `💾 파일 ${savedCount}개가 PC로 다운로드되었습니다.`
      );
    }
  }

  function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function importFromLocalFolder() {
    if (!BrainLocalFolder || !BrainLocalFolder.isConnected()) {
      showToast('먼저 로컬 폴더를 연결해 주세요.');
      return 0;
    }
    const scan = await BrainLocalFolder.scanFolderFiles();
    if (!scan.ok) {
      showToast(`⚠️ 로컬 폴더 스캔 실패: ${scan.error || '권한을 확인해 주세요.'}`);
      return 0;
    }

    let imported = 0;
    let updated = 0;
    saveStateForUndo();

    for (const segs of scan.folders || []) {
      const r = ensureLocalFolderByPath(segs);
      if (r.createdAny) imported++;
    }

    for (const f of scan.files || []) {
      const { ext, icon, tag } = getFileMetaByExt(f.name);
      const { folder: targetFolder } = ensureLocalFolderByPath(f.folderPath || []);
      if (!targetFolder.children) targetFolder.children = [];

      const existing = targetFolder.children.find(
        (c) => c.type === 'doc' && String(c.name || '').toLowerCase() === String(f.name || '').toLowerCase()
      );

      if (ext === 'xlsx' || ext === 'xls') {
        try {
          let buf = null;
          if (f.file) buf = await f.file.arrayBuffer();
          else if (f.base64Content) buf = base64ToArrayBuffer(f.base64Content);
          if (!buf) continue;
          const wb = await BrainSheet.parseArrayBufferToWorkbook(buf, f.name);
          const mdSum = BrainSheet.workbookToMarkdownSummary(wb);
          if (existing) {
            existing.sheetData = wb;
            existing.summary = mdSum;
            updated++;
          } else {
            targetFolder.children.push({
              id: genId(),
              type: 'doc',
              name: f.name,
              icon: '📊',
              tag: '#Excel #로컬폴더',
              summary: mdSum,
              link: '',
              sheetData: wb
            });
            imported++;
          }
        } catch (_) {}
      } else if (TEXT_EDITABLE_EXTS.has(ext) && (!f.size || f.size <= 512 * 1024)) {
        let txt = '';
        if (f.file) txt = await readFileAsTextAsync(f.file);
        else if (typeof f.textContent === 'string') txt = f.textContent;
        const csvWb = ext === 'csv'
          ? BrainSheet.parseCsvToWorkbook(txt || '', f.name.replace(/\.csv$/i, '') || 'Sheet1')
          : null;
        if (existing) {
          existing.summary = csvWb ? BrainSheet.workbookToMarkdownSummary(csvWb) : txt;
          if (csvWb) existing.sheetData = csvWb;
          syncOpenWindowsForItem(existing);
          updated++;
        } else {
          targetFolder.children.push({
            id: genId(),
            type: 'doc',
            name: f.name,
            icon: ext === 'csv' ? '📊' : icon,
            tag: ext === 'csv' ? '#CSV #로컬폴더' : `${tag} #로컬폴더`,
            summary: csvWb ? BrainSheet.workbookToMarkdownSummary(csvWb) : txt,
            link: '',
            ...(csvWb ? { sheetData: csvWb } : {})
          });
          imported++;
        }
      }
    }

    if (imported > 0 || updated > 0) {
      saveAndRender();
      showToast(`📥 로컬 폴더에서 새 항목 ${imported}개 가져오기 · ${updated}개 갱신 완료`);
    } else {
      showToast('📂 로컬 폴더에 새로 불러올 파일이 없습니다.');
    }
    return imported + updated;
  }

  function updateLocalFolderUI(statusArg) {
    if (!BrainLocalFolder) return;
    const st = statusArg || BrainLocalFolder.getStatus();

    const btn = $('btn-local-folder');
    const dot = $('local-folder-dot');
    const txt = $('local-folder-text');
    const moreBadge = $('more-local-folder-badge');
    if (btn && dot && txt) {
      dot.classList.remove('connected', 'pending');
      btn.classList.toggle('active', st.connected);
      if (st.connected) {
        dot.classList.add('connected');
        const shortName = st.folderName.length > 14 ? st.folderName.slice(0, 14) + '…' : st.folderName;
        txt.textContent = `📂 ${shortName}`;
        btn.title = `로컬 폴더 자동 저장 연결됨: ${st.folderPath || st.folderName}`;
        if (moreBadge) moreBadge.textContent = shortName;
      } else if (st.hasSavedHandle) {
        dot.classList.add('pending');
        txt.textContent = '로컬 폴더 재연결';
        btn.title = `이전에 연결한 로컬 폴더("${st.savedFolderName}")에 다시 연결하려면 클릭하세요.`;
        if (moreBadge) moreBadge.textContent = '재연결 필요';
      } else if (st.autoDownload) {
        dot.classList.add('pending');
        txt.textContent = '자동 다운로드 ON';
        btn.title = '오프라인 파일 생성/저장 시 PC로 자동 다운로드됩니다.';
        if (moreBadge) moreBadge.textContent = '자동다운';
      } else {
        txt.textContent = '로컬 폴더';
        btn.title = '클릭하여 오프라인 파일을 저장할 PC 로컬 폴더를 연결하세요.';
        if (moreBadge) moreBadge.textContent = '미연결';
      }
    }

    // Offline banner inside #main
    const banner = $('offline-folder-banner');
    const bannerText = $('offline-folder-banner-text');
    const bannerPickBtn = $('btn-banner-pick-folder');
    if (banner && bannerText && bannerPickBtn) {
      const shouldShowBanner =
        isGuestMode &&
        !offlineBannerDismissed &&
        !st.connected;
      banner.style.display = shouldShowBanner ? 'flex' : 'none';
      if (shouldShowBanner) {
        if (st.hasSavedHandle) {
          bannerText.textContent = `📂 이전에 연결한 로컬 폴더("${st.savedFolderName}")에 다시 연결하면 오프라인 파일이 자동 저장됩니다.`;
          bannerPickBtn.textContent = `🔄 "${st.savedFolderName}" 다시 연결`;
        } else if (st.autoDownload) {
          bannerText.textContent = '⚡ 오프라인 자동 다운로드 백업 ON — 파일을 만들거나 저장(Ctrl+S)하면 PC로 자동 저장됩니다.';
          bannerPickBtn.textContent = '📂 로컬 폴더 직접 연결';
        } else {
          bannerText.textContent = '📂 오프라인에서 생성한 메모·엑셀 파일을 PC 로컬 폴더에 자동 저장하려면 폴더를 연결하세요.';
          bannerPickBtn.textContent = '📂 로컬 폴더 연결';
        }
      }
    }

    // Sidebar hint in guest mode
    if (isGuestMode && elApiStatusSummary) {
      if (st.connected) {
        elApiStatusSummary.textContent = `📂 로컬 저장됨: ${st.folderName}`;
      } else if (st.autoDownload) {
        elApiStatusSummary.textContent = '📴 오프라인 · PC 자동 다운로드 ON';
      } else {
        elApiStatusSummary.textContent = '📴 오프라인 게스트 모드 (로컬 저장)';
      }
    }

    if (elLocalFolderModal && elLocalFolderModal.style.display === 'flex') {
      renderLocalFolderModal();
    }
  }

  let bridgeOfflineFsAvailable = false;

  async function renderLocalFolderModal() {
    if (!BrainLocalFolder) return;
    const st = BrainLocalFolder.getStatus();
    const card = $('lf-status-card');
    const titleEl = $('lf-status-title');
    const subEl = $('lf-status-sub');
    const noticeBox = $('lf-notice-box');
    const btnPickFsa = $('btn-lf-pick-fsa');
    const btnReconnect = $('btn-lf-reconnect');
    const bridgeRow = $('lf-bridge-row');
    const connectedRow = $('lf-connected-actions');
    const chkAutoDl = $('chk-lf-auto-download');

    if (card) card.classList.toggle('unlocked', st.connected);
    if (chkAutoDl) chkAutoDl.checked = Boolean(st.autoDownload);

    if (st.connected) {
      const modeLabel = st.mode === 'bridge' ? '로컬 브릿지 폴더' : '브라우저 로컬 폴더(직접 연결)';
      const timeStr = st.lastSavedAt
        ? ` · 최근 저장: ${st.lastSavedFile || ''} (${new Date(st.lastSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
        : '';
      if (titleEl) titleEl.textContent = `🟢 연결됨: ${st.folderName}`;
      if (subEl) subEl.textContent = `${modeLabel} (${st.folderPath || st.folderName})에 메모(.md)·엑셀(.xlsx)·폴더 변경사항이 실시간 자동 저장됩니다.${timeStr}`;
    } else if (st.hasSavedHandle) {
      if (titleEl) titleEl.textContent = `🟡 재연결 필요: ${st.savedFolderName}`;
      if (subEl) subEl.textContent = '브라우저 보안 정책상 새 세션에서 1회 권한 확인이 필요합니다. 아래 [이전 폴더 다시 연결]을 눌러 주세요.';
    } else {
      if (titleEl) titleEl.textContent = '⚪ 로컬 폴더 미연결';
      if (subEl) subEl.textContent = 'PC의 원하는 폴더를 연결하면 오프라인에서 생성·수정한 메모(.md), 엑셀(.xlsx), 폴더 구조가 실시간으로 자동 저장됩니다.';
    }

    if (btnReconnect) btnReconnect.style.display = (!st.connected && st.hasSavedHandle) ? 'inline-flex' : 'none';
    if (connectedRow) connectedRow.style.display = st.connected ? 'flex' : 'none';
    if (bridgeRow) bridgeRow.style.display = (bridgeOfflineFsAvailable || st.mode === 'bridge') ? 'flex' : 'none';

    if (noticeBox) {
      if (!st.supported && !bridgeOfflineFsAvailable) {
        noticeBox.innerHTML = 'ℹ️ 현재 브라우저(또는 <code>file://</code> 보안 정책)에서는 직접 폴더 선택이 제한될 수 있습니다. 아래 <b>⚡ 자동 다운로드</b>를 켜거나 <code>local-bridge/로컬연결_실행.bat</code>으로 열면 PC 폴더 직접 저장이 가능합니다.';
        noticeBox.style.display = 'block';
      } else {
        noticeBox.style.display = 'none';
      }
    }
    if (btnPickFsa) {
      btnPickFsa.textContent = st.connected ? '🔄 다른 PC 폴더 선택' : '📂 PC 로컬 폴더 선택';
    }
  }

  async function openLocalFolderModal() {
    if (!elLocalFolderModal) return;
    if (isLocalhostOrigin() && BrainLocalFolder) {
      const probe = await BrainLocalFolder.tryConnectBridgeFolder(getActiveLocalBridgeUrl(), { probeOnly: true });
      bridgeOfflineFsAvailable = Boolean(probe.ok);
    }
    elLocalFolderModal.style.display = 'flex';
    renderLocalFolderModal();
  }

  function closeLocalFolderModal() {
    if (elLocalFolderModal) elLocalFolderModal.style.display = 'none';
  }

  async function connectLocalFolderQuick() {
    if (!BrainLocalFolder) return;
    const st = BrainLocalFolder.getStatus();

    // 1. If there is a saved FSA handle waiting for 1-click reconnect, try that first
    if (!st.connected && st.hasSavedHandle) {
      const res = await BrainLocalFolder.reconnectSavedFolder();
      if (res.ok) {
        const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
        showToast(`📂 "${res.folderName}" 폴더에 다시 연결되었습니다${count > 0 ? ` (${count}개 파일 저장)` : ''}.`);
        return;
      }
      if (res.cancelled) return;
    }

    // 2. Try Browser File System Access API (showDirectoryPicker)
    if (BrainLocalFolder.isFsaSupported()) {
      const res = await BrainLocalFolder.pickFolderFSA();
      if (res.ok) {
        const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
        showToast(`📂 "${res.folderName}" 로컬 폴더 연결 완료! (기존 미저장 파일 ${count}개 저장됨)`);
        return;
      }
      if (res.cancelled) return;
    }

    // 3. Fallback: try Bridge local folder if running on localhost
    if (isLocalhostOrigin()) {
      const bRes = await BrainLocalFolder.tryConnectBridgeFolder(getActiveLocalBridgeUrl());
      if (bRes.ok) {
        bridgeOfflineFsAvailable = true;
        const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
        showToast(`📂 로컬 브릿지 폴더(${bRes.folderName}) 연결 완료! (${count}개 파일 저장됨)`);
        return;
      }
    }

    // 4. Otherwise open modal explaining auto-download / options
    openLocalFolderModal();
  }

  async function initLocalFolderSyncForWorkspace() {
    if (!BrainLocalFolder) return { connected: false };
    const canProbeBridge = isLocalhostOrigin();
    const st = await BrainLocalFolder.init({
      bridgeUrl: canProbeBridge ? getActiveLocalBridgeUrl() : '',
      checkBridge: canProbeBridge
    });
    if (st.mode === 'bridge') bridgeOfflineFsAvailable = true;
    updateLocalFolderUI(st);
    if (st.connected) {
      triggerSbMirrorSync({ immediate: true });
    }
    return st;
  }

  if (BrainLocalFolder) {
    BrainLocalFolder.onStatusChange(updateLocalFolderUI);
  }

  $('btn-local-folder')?.addEventListener('click', openLocalFolderModal);
  $('btn-close-local-folder')?.addEventListener('click', closeLocalFolderModal);
  $('btn-cancel-local-folder')?.addEventListener('click', closeLocalFolderModal);
  elLocalFolderModal?.addEventListener('click', (e) => {
    if (e.target === elLocalFolderModal) closeLocalFolderModal();
  });

  $('btn-banner-pick-folder')?.addEventListener('click', () => connectLocalFolderQuick());
  $('btn-banner-folder-settings')?.addEventListener('click', openLocalFolderModal);
  $('btn-banner-dismiss-folder')?.addEventListener('click', () => {
    offlineBannerDismissed = true;
    updateLocalFolderUI();
  });

  $('btn-lf-pick-fsa')?.addEventListener('click', async () => {
    if (!BrainLocalFolder) return;
    const res = await BrainLocalFolder.pickFolderFSA();
    if (res.ok) {
      const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
      renderLocalFolderModal();
      showToast(`📂 "${res.folderName}" 연결 완료 (${count}개 파일 저장됨)`);
    } else if (!res.cancelled) {
      showToast(`⚠️ ${res.message || '브라우저 보안 정책으로 폴더 선택이 제한되었습니다. 아래 자동 다운로드를 이용해 보세요.'}`);
    }
  });

  $('btn-lf-reconnect')?.addEventListener('click', async () => {
    if (!BrainLocalFolder) return;
    const res = await BrainLocalFolder.reconnectSavedFolder();
    if (res.ok) {
      const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
      renderLocalFolderModal();
      showToast(`📂 "${res.folderName}" 다시 연결됨${count > 0 ? ` (${count}개 파일 저장)` : ''}`);
    } else if (!res.cancelled && res.message) {
      showToast(`⚠️ ${res.message}`);
    }
  });

  $('btn-lf-use-bridge')?.addEventListener('click', async () => {
    if (!BrainLocalFolder) return;
    const res = await BrainLocalFolder.tryConnectBridgeFolder(getActiveLocalBridgeUrl());
    if (res.ok) {
      const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
      renderLocalFolderModal();
      showToast(`📂 로컬 브릿지 폴더(${res.folderPath || res.folderName}) 연결 완료 (${count}개 파일 저장됨)`);
    } else {
      showToast('⚠️ 로컬 브릿지에 연결할 수 없습니다.');
    }
  });

  $('btn-lf-pick-bridge')?.addEventListener('click', async () => {
    if (!BrainLocalFolder) return;
    const res = await BrainLocalFolder.pickFolderViaBridge(getActiveLocalBridgeUrl());
    if (res.ok) {
      const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: true });
      renderLocalFolderModal();
      showToast(`📂 저장 폴더 변경됨: ${res.folderPath} (${count}개 파일 저장)`);
    } else if (!res.cancelled) {
      showToast(`⚠️ ${res.message || '폴더 변경에 실패했습니다.'}`);
    }
  });

  $('btn-lf-sync-export')?.addEventListener('click', async () => {
    if (!BrainLocalFolder?.isConnected()) return;
    const count = await syncSubtreeToLocalFolder(state.fileSystem, { onlyIfMissing: false });
    renderLocalFolderModal();
    showToast(`⬆️ 전체 파일 ${count}개를 로컬 폴더에 저장했습니다.`);
  });

  $('btn-lf-sync-import')?.addEventListener('click', async () => {
    await importFromLocalFolder();
    renderLocalFolderModal();
  });

  $('btn-lf-disconnect')?.addEventListener('click', async () => {
    if (!BrainLocalFolder) return;
    await BrainLocalFolder.disconnect();
    renderLocalFolderModal();
    showToast('🔌 로컬 폴더 연결이 해제되었습니다.');
  });

  $('chk-lf-auto-download')?.addEventListener('change', (e) => {
    if (!BrainLocalFolder) return;
    BrainLocalFolder.setAutoDownload(e.target.checked);
    showToast(e.target.checked
      ? '⚡ 오프라인 파일 생성·저장 시 PC 자동 다운로드가 켜졌습니다.'
      : '자동 다운로드가 꺼졌습니다.');
  });

  // ================= Google Drive Sync & File Viewer =================
  function updateDriveStatusUI(customLabel = '') {
    const btn = $('btn-drive-sync');
    const dot = $('drive-status-dot');
    const text = $('drive-status-text');
    const moreBadge = $('more-drive-badge');
    if (!btn || !dot || !text) return;

    dot.classList.remove('synced', 'syncing', 'error');
    const unlocked = isOwnerAuthenticated();
    const hasToken = BrainAuth.hasDriveAccess();

    if (isDriveSyncing || driveSyncStatus === 'syncing') {
      dot.classList.add('syncing');
      text.textContent = customLabel || '동기화 중...';
      btn.title = 'Google Drive (SecondBrainOS) 동기화 진행 중...';
      if (moreBadge) moreBadge.textContent = '동기화 중';
      return;
    }

    if (!unlocked) {
      text.textContent = customLabel || '드라이브 미연결';
      btn.title = 'Google 로그인 후 내 드라이브(SecondBrainOS 폴더)에 자동 동기화됩니다.';
      if (moreBadge) moreBadge.textContent = '미연결';
      return;
    }

    if (!hasToken || driveSyncStatus === 'expired') {
      dot.classList.add('error');
      text.textContent = customLabel || '드라이브 재연결';
      btn.title = 'Google Drive 토큰이 만료되었거나 연결되지 않았습니다. 클릭하여 재연결하세요.';
      if (moreBadge) moreBadge.textContent = '재연결 필요';
      return;
    }

    if (driveSyncStatus === 'error') {
      dot.classList.add('error');
      text.textContent = customLabel || '동기화 오류';
      btn.title = '동기화 중 오류가 발생했습니다. 클릭하여 다시 시도하세요.';
      if (moreBadge) moreBadge.textContent = '오류';
      return;
    }

    dot.classList.add('synced');
    const meta = getSyncMeta();
    const timeStr = meta.lastSyncedAt
      ? new Date(meta.lastSyncedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '';
    text.textContent = customLabel || '드라이브 연결됨';
    if (moreBadge) moreBadge.textContent = timeStr ? `동기화 ${timeStr}` : '연결됨';
    btn.title = timeStr
      ? `내 드라이브 / SecondBrainOS 동기화됨 (${timeStr}) — 클릭하여 수동 동기화`
      : '내 드라이브 / SecondBrainOS 연결됨 — 클릭하여 수동 동기화';
  }

  function handleDriveError(err) {
    if (!err) return;
    lastDriveErrorMessage = err.message || '알 수 없는 Google Drive 오류';
    lastDriveErrorCode = err.code || '';
    if (
      err.code === 'AUTH_EXPIRED' ||
      err.code === 'INSUFFICIENT_SCOPE' ||
      err.code === 'NO_TOKEN' ||
      err.status === 401
    ) {
      BrainAuth.clearDriveAccessToken();
      driveSyncStatus = 'expired';
    } else {
      driveSyncStatus = 'error';
    }
    updateDriveStatusUI();
    if (elAuthModal.style.display === 'flex') {
      renderAuthModalContent();
    }
  }

  async function ensureDriveToken(interactive = false) {
    let token = BrainAuth.getDriveAccessToken();
    if (token && isOwnerAuthenticated()) return token;
    if (!interactive) return null;

    const prevEmail = getActiveUserEmail();
    const user = await BrainAuth.reconnectDrive(state.settings.firebaseConfig);
    if (!user || !user.email) {
      throw new Error('Google 계정 로그인을 완료해 주세요.');
    }
    if (prevEmail && prevEmail !== user.email) {
      WinManager.closeAll();
      openMdWindows.clear();
      BrainDrive.clearCache();
      hasSyncedDriveThisSession = false;
      switchUser(user.email);
    }
    onAuthStateChanged();
    token = BrainAuth.getDriveAccessToken();
    if (!token) {
      throw new Error('Google Drive 접근 토큰을 받지 못했습니다. 로그인 시 드라이브 권한을 허용해 주세요.');
    }
    return token;
  }

  function buildCloudPayload() {
    const meta = getSyncMeta();
    return {
      version: '9.0',
      updatedAt: meta.updatedAt || Date.now(),
      fileSystem: state.fileSystem,
      chatHistory: state.chatHistory,
      relations: state.relations || [],
      paraEntities: state.paraEntities || [],
      pinnedAppIds: state.pinnedAppIds || []
    };
  }

  function applyCloudPayload(data, driveFileId) {
    if (!data || !data.fileSystem || !data.fileSystem.id) return false;
    const prevFolderId = state.currentFolder?.id;
    const prevSelectedId = state.selectedItem?.id;

    state.fileSystem = data.fileSystem;
    if (Array.isArray(data.paraEntities)) {
      state.paraEntities = data.paraEntities;
    }
    if (Array.isArray(data.relations)) {
      state.relations = data.relations;
    }
    normalizeParaWorkspace();
    persistParaEntities({ silent: true });
    persistRelations({ silent: true });

    const foundFolder = prevFolderId ? findNodeAndParent(prevFolderId) : null;
    state.currentFolder = foundFolder && foundFolder.node.type === 'folder' ? foundFolder.node : state.fileSystem;

    const foundSelected = prevSelectedId ? findNodeAndParent(prevSelectedId) : null;
    state.selectedItem = foundSelected ? foundSelected.node : null;

    if (Array.isArray(data.chatHistory)) {
      state.chatHistory = data.chatHistory;
      persistChat({ silent: true });
      renderChatMessages();
    }
    if (typeof renderRelationsDbPanel === 'function') renderRelationsDbPanel();
    if (Array.isArray(data.pinnedAppIds)) {
      state.pinnedAppIds = data.pinnedAppIds;
      persistPinnedApps({ silent: true });
    }

    persistFS({ silent: true });
    setSyncMeta({
      updatedAt: Number(data.updatedAt) || Date.now(),
      lastSyncedAt: Date.now(),
      driveDbFileId: driveFileId || '',
      hasUserEdits: true
    });

    renderParaTree();
    renderTree(state.fileSystem, elTreeRoot, true);
    if (searchQuery) renderSearchResults(searchQuery);
    else openFolder(state.currentFolder);
    renderContextChips();
    updateLocalLockBanner();

    if (state.selectedItem && isItemVisible(state.selectedItem)) {
      selectItem(state.selectedItem);
    } else {
      clearSelectionView();
    }
    return true;
  }

  async function syncWithDrive({ mode = 'manual', interactive = false, showSuccessToast = false } = {}) {
    if (isDriveSyncing) return false;
    if (!isOwnerAuthenticated() && !interactive) {
      updateDriveStatusUI();
      return false;
    }

    let token;
    try {
      token = await ensureDriveToken(interactive);
    } catch (err) {
      handleDriveError(err);
      if (interactive || showSuccessToast) showToast(`⚠️ ${err.message}`);
      return false;
    }

    if (!token) {
      driveSyncStatus = 'expired';
      updateDriveStatusUI();
      return false;
    }

    const userEmail = BrainAuth.getUser()?.email || '';
    const localMeta = getSyncMeta();

    isDriveSyncing = true;
    driveSyncStatus = 'syncing';
    lastDriveErrorMessage = '';
    lastDriveErrorCode = '';
    updateDriveStatusUI();

    try {
      if (mode === 'push') {
        const payload = buildCloudPayload();
        const uploaded = await BrainDrive.uploadDatabase(token, payload, localMeta.driveDbFileId, userEmail);
        setSyncMeta({
          updatedAt: payload.updatedAt,
          lastSyncedAt: Date.now(),
          driveDbFileId: uploaded.fileId,
          hasUserEdits: true
        });
        hasSyncedDriveThisSession = true;
        driveSyncStatus = 'synced';
        if (showSuccessToast) showToast('☁️ Google Drive(SecondBrainOS)에 저장되었습니다.');
        return true;
      }

      // 'initial' 또는 'manual': 클라우드 DB 확인 + 실제 SecondBrainOS 폴더 내 파일 스캔·병합
      const cloud = await BrainDrive.downloadDatabase(token, userEmail);
      let dbFileId = cloud.fileId || '';
      let hadPriorCloudDb = false;
      let loadedFromCloudDb = false;
      let needPushDb = false;

      if (cloud.exists && cloud.data && cloud.data.fileSystem) {
        hadPriorCloudDb = true;
        const cloudUpdatedAt =
          Number(cloud.data.updatedAt) ||
          (cloud.modifiedTime ? Date.parse(cloud.modifiedTime) : 0) ||
          0;
        const localUpdatedAt = Number(localMeta.updatedAt) || 0;

        if (!localMeta.hasUserEdits || cloudUpdatedAt > localUpdatedAt) {
          applyCloudPayload(cloud.data, cloud.fileId);
          loadedFromCloudDb = true;
        } else if (cloudUpdatedAt === localUpdatedAt && localMeta.lastSyncedAt > 0) {
          setSyncMeta({ lastSyncedAt: Date.now(), driveDbFileId: cloud.fileId });
        } else {
          // 로컬이 더 최신인 경우: 최초 연결 충돌이면 사용자 확인
          if (mode === 'initial' && localMeta.lastSyncedAt === 0 && localMeta.hasUserEdits) {
            const loadCloud = confirm(
              'Google Drive(SecondBrainOS 폴더)에 저장된 백업이 있습니다.\n\n' +
              '[확인] Google Drive 데이터 불러오기 (권장)\n' +
              '[취소] 현재 PC 데이터로 Google Drive 덮어쓰기'
            );
            if (loadCloud) {
              applyCloudPayload(cloud.data, cloud.fileId);
              loadedFromCloudDb = true;
            } else {
              needPushDb = true;
            }
          } else {
            needPushDb = true;
          }
        }
      } else {
        needPushDb = true;
      }

      // 실제 Google Drive SecondBrainOS 폴더 안의 모든 파일·하위폴더 스캔 및 병합
      const scanResult = await syncDriveFolderContents(token, userEmail, {
        removeDefaultWelcomeIfImported: !hadPriorCloudDb && !localMeta.hasUserEdits
      });
      if (scanResult.changed) {
        needPushDb = true;
      }

      if (needPushDb) {
        const payload = buildCloudPayload();
        const uploaded = await BrainDrive.uploadDatabase(token, payload, dbFileId, userEmail);
        setSyncMeta({
          updatedAt: payload.updatedAt,
          lastSyncedAt: Date.now(),
          driveDbFileId: uploaded.fileId,
          hasUserEdits: true
        });
      }

      hasSyncedDriveThisSession = true;
      driveSyncStatus = 'synced';

      if (scanResult.importedCount > 0 || scanResult.updatedCount > 0) {
        const parts = [];
        if (scanResult.importedCount > 0) parts.push(`새 파일 ${scanResult.importedCount}개 가져옴`);
        if (scanResult.updatedCount > 0) parts.push(`${scanResult.updatedCount}개 최신 반영`);
        showToast(`☁️ SecondBrainOS 드라이브 폴더 동기화 완료 (${parts.join(', ')})`);
      } else if (loadedFromCloudDb) {
        showToast('☁️ Google Drive(SecondBrainOS)에서 최신 데이터를 불러왔습니다.');
      } else if (!hadPriorCloudDb) {
        showToast('☁️ 내 드라이브 [SecondBrainOS] 폴더에 첫 백업을 완료했습니다.');
      } else if (showSuccessToast) {
        showToast('☁️ Google Drive(SecondBrainOS)와 동기화되었습니다.');
      }
      return true;
    } catch (err) {
      handleDriveError(err);
      showToast(`⚠️ Drive 동기화 실패: ${err.message}`);
      if (err?.code === 'API_DISABLED' || err?.code === 'INSUFFICIENT_SCOPE') {
        openAuthModal();
      }
      return false;
    } finally {
      isDriveSyncing = false;
      updateDriveStatusUI();
      if (driveSyncStatus === 'synced' && state.selectedItem?.driveFile && !isEditing) {
        renderDrivePreviewBox(state.selectedItem, ++previewRenderSeq);
      }
      if (elAuthModal.style.display === 'flex') {
        renderAuthModalContent();
      }
    }
  }

  function ensureLocalFolderByPath(folderSegments) {
    let curr = state.fileSystem;
    let createdAny = false;
    for (const seg of folderSegments || []) {
      const name = String(seg || '').trim();
      if (!name) continue;
      if (!curr.children) curr.children = [];
      let next = curr.children.find((c) => c.type === 'folder' && String(c.name || '').toLowerCase() === name.toLowerCase());
      if (!next) {
        next = {
          id: genId(),
          type: 'folder',
          name,
          icon: '📁',
          tag: '',
          summary: '',
          link: '',
          children: []
        };
        curr.children.push(next);
        createdAny = true;
      }
      curr = next;
    }
    return { folder: curr, createdAny };
  }

  function indexExistingDriveNodes(node, byDocId, byFileId) {
    if (!node) return;
    if (node.driveDocId) byDocId.set(node.driveDocId, node);
    if (node.driveFile && node.driveFile.id) byFileId.set(node.driveFile.id, node);
    if (Array.isArray(node.children)) {
      node.children.forEach((c) => indexExistingDriveNodes(c, byDocId, byFileId));
    }
  }

  async function syncDriveFolderContents(token, userEmail, options = {}) {
    const scan = await BrainDrive.scanAppFolder(token, userEmail);
    const byDocId = new Map();
    const byFileId = new Map();
    indexExistingDriveNodes(state.fileSystem, byDocId, byFileId);

    let importedCount = 0;
    let updatedCount = 0;
    let changed = false;

    // 1. 드라이브에 있는 하위 폴더 반영
    for (const folderPath of scan.folders || []) {
      const res = ensureLocalFolderByPath(folderPath);
      if (res.createdAny) changed = true;
    }

    // 2. 드라이브 SecondBrainOS 폴더 안의 모든 파일 반영
    for (const f of scan.files || []) {
      const { ext, icon, tag } = getFileMetaByExt(f.name);
      const isTextFile = TEXT_EDITABLE_EXTS.has(ext) && (!f.size || f.size <= 500 * 1024);

      // 이미 연결된 텍스트/MD 문서: 드라이브 수정 시각이 더 최신이면 본문 갱신
      if (byDocId.has(f.id)) {
        const existingNode = byDocId.get(f.id);
        const driveMs = f.modifiedTime ? Date.parse(f.modifiedTime) : 0;
        const localMs = existingNode.driveModifiedTime ? Date.parse(existingNode.driveModifiedTime) : 0;
        if (isTextFile && driveMs > localMs + 1500) {
          try {
            const text = await BrainDrive.downloadTextFile(token, f.id);
            existingNode.summary = text;
            existingNode.name = f.name;
            existingNode.driveModifiedTime = f.modifiedTime;
            syncOpenWindowsForItem(existingNode);
            updatedCount++;
            changed = true;
          } catch (_) {}
        }
        continue;
      }

      // 이미 연결된 바이너리 파일
      if (byFileId.has(f.id)) {
        const existingNode = byFileId.get(f.id);
        if (existingNode.driveFile) {
          existingNode.driveFile.webViewLink = f.webViewLink || existingNode.driveFile.webViewLink;
          if (f.size) existingNode.driveFile.size = f.size;
        }
        continue;
      }

      // 해당 폴더 확보
      const { folder: targetFolder, createdAny } = ensureLocalFolderByPath(f.folderPath || []);
      if (createdAny) changed = true;
      if (!targetFolder.children) targetFolder.children = [];

      // 같은 폴더에 같은 이름의 미연결 문서가 있으면 중복 생성 대신 연결
      const sameNameDoc = targetFolder.children.find(
        (c) =>
          c.type === 'doc' &&
          !c.driveDocId &&
          !(c.driveFile && c.driveFile.id) &&
          String(c.name || '').toLowerCase() === String(f.name || '').toLowerCase()
      );

      if (sameNameDoc) {
        if (isTextFile) {
          sameNameDoc.driveDocId = f.id;
          sameNameDoc.driveModifiedTime = f.modifiedTime;
          if (!String(sameNameDoc.summary || '').trim()) {
            try {
              sameNameDoc.summary = await BrainDrive.downloadTextFile(token, f.id);
              updatedCount++;
            } catch (_) {}
          }
          byDocId.set(f.id, sameNameDoc);
        } else {
          sameNameDoc.driveFile = {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            webViewLink: f.webViewLink,
            uploadedAt: f.modifiedTime
          };
          byFileId.set(f.id, sameNameDoc);
          updatedCount++;
        }
        changed = true;
        continue;
      }

      // 신규 파일 카드 생성
      if (isTextFile) {
        let textContent = '';
        try {
          textContent = await BrainDrive.downloadTextFile(token, f.id);
        } catch (_) {}
        const newDoc = {
          id: genId(),
          type: 'doc',
          name: f.name,
          icon,
          tag,
          link: '',
          summary: textContent,
          driveDocId: f.id,
          driveModifiedTime: f.modifiedTime
        };
        targetFolder.children.push(newDoc);
        byDocId.set(f.id, newDoc);
        importedCount++;
        changed = true;
      } else {
        const newBin = {
          id: genId(),
          type: 'doc',
          name: f.name,
          icon,
          tag,
          link: '',
          summary: '',
          driveFile: {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            webViewLink: f.webViewLink,
            uploadedAt: f.modifiedTime
          }
        };
        targetFolder.children.push(newBin);
        byFileId.set(f.id, newBin);
        importedCount++;
        changed = true;
      }
    }

    // 최초 로그인 계정에 실제 드라이브 파일이 있었다면 기본 '시작 가이드' 제거
    if (options.removeDefaultWelcomeIfImported && (importedCount > 0 || (scan.folders && scan.folders.length > 0))) {
      state.fileSystem.children = (state.fileSystem.children || []).filter((c) => c.id !== 'welcome-folder');
    }

    if (changed) {
      persistFS({ silent: true });
      setSyncMeta({ updatedAt: Date.now(), hasUserEdits: true });
      renderTree(state.fileSystem, elTreeRoot, true);
      if (searchQuery) renderSearchResults(searchQuery);
      else openFolder(state.currentFolder);
      renderContextChips();
      if (state.selectedItem && isItemVisible(state.selectedItem) && !isEditing) {
        selectItem(state.selectedItem);
      }
    }

    return { importedCount, updatedCount, changed };
  }

  // 실시간 .md / 텍스트 문서를 실제 파일로 Google Drive(SecondBrainOS/)에 저장
  function isRealTimeDriveTextDoc(item) {
    if (!item || item.type !== 'doc') return false;
    if (item.driveFile && item.driveFile.id) return false;
    if (item.link && LocalBridge.isLocalPath(item.link)) return false;
    if (isBinaryFileName(item.name)) return false;
    return true;
  }

  function getRelativeFolderPathForItem(itemId) {
    const pathNodes = getPathToNode(itemId) || [];
    // [root, ...folders, item] -> 중간 폴더 이름만 추출
    if (pathNodes.length <= 2) return [];
    return pathNodes.slice(1, -1).map((n) => n.name);
  }

  async function syncDocFileToDriveNow(item) {
    if (!isRealTimeDriveTextDoc(item)) return;
    if (!isOwnerAuthenticated()) return;
    const token = BrainAuth.getDriveAccessToken();
    if (!token) return;

    const userEmail = BrainAuth.getUser()?.email || '';
    const fileName = resolveVirtualFileName(item);
    const folderPath = getRelativeFolderPathForItem(item.id);

    try {
      const saved = await BrainDrive.upsertTextFile(token, {
        fileId: item.driveDocId || '',
        name: fileName,
        content: String(item.summary || ''),
        folderPath,
        userEmail
      });
      if (saved && saved.id) {
        item.driveDocId = saved.id;
        item.driveModifiedTime = saved.modifiedTime || new Date().toISOString();
        persistFS({ silent: true });
      }
    } catch (err) {
      handleDriveError(err);
    }
  }

  function scheduleDocFileSyncToDrive(item, immediate = false) {
    if (!isRealTimeDriveTextDoc(item)) return;
    if (!isOwnerAuthenticated() || !BrainAuth.hasDriveAccess()) return;

    const prevTimer = mdDriveSyncTimers.get(item.id);
    if (prevTimer) {
      clearTimeout(prevTimer);
      mdDriveSyncTimers.delete(item.id);
    }

    if (immediate) {
      syncDocFileToDriveNow(item);
      return;
    }

    const timer = setTimeout(() => {
      mdDriveSyncTimers.delete(item.id);
      syncDocFileToDriveNow(item);
    }, 1500);
    mdDriveSyncTimers.set(item.id, timer);
  }

  function scheduleDriveSync() {
    if (!isOwnerAuthenticated() || !BrainAuth.hasDriveAccess()) return;
    if (driveSyncTimer) clearTimeout(driveSyncTimer);
    driveSyncTimer = setTimeout(() => {
      driveSyncTimer = null;
      syncWithDrive({ mode: 'push', interactive: false, showSuccessToast: false });
    }, 2200);
  }

  // ================= OS Floating Windows: MD Viewer, HTML & Drive Files =================
  function isMarkdownDocItem(item) {
    if (!item || item.type !== 'doc') return false;
    if (item.driveFile && item.driveFile.id) return false;
    if (item.link && (LocalBridge.isLocalPath(item.link) || LocalBridge.isWebUrl(item.link))) return false;
    if (isHtmlContentItem(item)) return false;
    if (isBinaryFileName(item.name)) return false;
    const name = String(item.name || '').trim().toLowerCase();
    // .md 확장자이거나 확장자가 없는 일반 메모는 내장 MD 뷰어 대상
    return /\.md$/.test(name) || !/\.[a-z0-9]{1,8}$/.test(name);
  }

  function toggleCheckboxInMarkdown(mdText, targetIndex) {
    let idx = 0;
    return String(mdText || '').replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/gm, (match, prefix, mark, suffix) => {
      if (idx++ === targetIndex) {
        return `${prefix}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}`;
      }
      return match;
    });
  }

  function openMarkdownWindow(item, initialMode = 'split') {
    if (!item || item.type !== 'doc') return;
    const winId = `md-${item.id}`;
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      const entry = openMdWindows.get(item.id);
      if (entry && initialMode && entry.setMode) entry.setMode(initialMode);
      return;
    }

    const hostEl = document.createElement('div');
    hostEl.style.width = '100%';
    hostEl.style.height = '100%';

    const controller = window.BrainMathMarkdown.mountMathMarkdownEditor(hostEl, {
      initialContent: item.summary || '',
      initialMode,
      fileName: item.name,
      onToast: showToast,
      onSave(newVal, silent) {
        if (newVal === (item.summary || '') && silent) return;
        saveStateForUndo();
        item.summary = newVal;
        touchNode(item);
        saveAndRender();
        scheduleDocFileSyncToDrive(item, true);
        scheduleItemSyncToLocalFolder(item, !silent, { allowAutoDownload: !silent });
        if (state.selectedItem && state.selectedItem.id === item.id && !isEditing) {
          selectItem(item);
        }
        if (!silent) {
          const lf = BrainLocalFolder?.getStatus();
          if (lf?.connected) showToast(`📂 "${item.name}" 로컬 폴더(${lf.folderName})에 저장됨`);
          else if (isGuestMode) showToast(`💾 "${item.name}" 저장되었습니다.`);
          else showToast(`💾 "${item.name}" 저장 및 Google Drive 동기화됨`);
        }
      }
    });

    const win = WinManager.openWindow({
      id: winId,
      title: item.name,
      icon: item.icon || '📝',
      meta: 'Math · Engineering MD',
      width: 1120,
      height: 700,
      bodyClass: 'mmd-win-body',
      contentEl: hostEl,
      headerActions: [
        {
          label: '✏️ 이름 변경',
          title: '파일 이름 바꾸기',
          onClick: () => {
            const next = prompt('새 파일 이름을 입력하세요:', item.name || '');
            if (next !== null) applyItemRename(item, next);
          }
        }
      ],
      onClose: () => {
        if (controller.isDirty()) {
          controller.save(true);
        }
        controller.destroy();
        openMdWindows.delete(item.id);
      }
    });

    openMdWindows.set(item.id, {
      win,
      setMode: controller.setMode,
      syncFromItem: () => {
        win.setTitle(item.name);
        controller.setContent(item.summary || '');
      }
    });
  }

  function openHtmlWindow(item) {
    const content = String(item?.summary || '');
    if (!content.trim()) {
      showToast('실행할 HTML 내용이 비어 있습니다.');
      return;
    }

    const winId = `html-${item.id}`;
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      return;
    }

    if (!Array.isArray(item.aiMarkers)) item.aiMarkers = [];

    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    let highlighterOn = false;
    let selectedColor = 'yellow';

    const root = document.createElement('div');
    root.className = 'html-app';
    root.innerHTML =
      `<div class="html-marker-toolbar">` +
      `  <div class="html-marker-toolbar-left">` +
      `    <button type="button" class="btn-marker-toggle" title="켜면 텍스트를 드래그하자마자 형광펜 AI 마커가 표시됩니다">🖍️ 형광펜 OFF</button>` +
      `    <div class="marker-palette" title="형광펜 색상 선택">` +
      `      <button type="button" class="marker-color-dot active" data-color="yellow" title="노랑"></button>` +
      `      <button type="button" class="marker-color-dot" data-color="green" title="민트"></button>` +
      `      <button type="button" class="marker-color-dot" data-color="pink" title="핑크"></button>` +
      `      <button type="button" class="marker-color-dot" data-color="blue" title="블루"></button>` +
      `    </div>` +
      `    <button type="button" class="btn-sm html-btn-mark-sel" title="선택한 텍스트에 AI 마커 추가">➕ 선택영역 마커</button>` +
      `  </div>` +
      `  <div class="html-marker-toolbar-right">` +
      `    <button type="button" class="btn-sm btn-primary-soft html-btn-link-ai" title="마커가 표시된 문서를 AI 대화 컨텍스트에 연결 (자동 질문 안 함)">🤖 AI에 마커 연결</button>` +
      `    <button type="button" class="btn-sm html-btn-clear-markers" title="모든 마커 지우기">🗑️ 초기화</button>` +
      `  </div>` +
      `</div>` +
      `<div class="html-iframe-wrap">` +
      `  <iframe title="${escapeHtml(item.name || 'HTML 미리보기')}"></iframe>` +
      `</div>` +
      `<div class="html-marker-tray" style="display:none;"></div>`;

    const btnToggle = root.querySelector('.btn-marker-toggle');
    const colorBtns = root.querySelectorAll('.marker-color-dot');
    const btnMarkSel = root.querySelector('.html-btn-mark-sel');
    const btnLinkAi = root.querySelector('.html-btn-link-ai');
    const btnClearMarkers = root.querySelector('.html-btn-clear-markers');
    const iframe = root.querySelector('iframe');
    const trayEl = root.querySelector('.html-marker-tray');

    function renumberMarkers() {
      item.aiMarkers.forEach((m, idx) => {
        m.number = idx + 1;
      });
    }

    function persistMarkers() {
      renumberMarkers();
      persistFS();
      scheduleDriveSync();
      renderContextChips();
      renderMarkerTray();
      refreshMarkerBadgesInDoc();
    }

    function injectMarkerStyles(doc) {
      if (!doc || doc.getElementById('sb-ai-marker-style')) return;
      const style = doc.createElement('style');
      style.id = 'sb-ai-marker-style';
      style.textContent = `
        mark.sb-ai-marker {
          padding: 1px 3px;
          border-radius: 4px;
          cursor: pointer;
          color: inherit;
          transition: box-shadow 0.2s ease;
          position: relative;
        }
        mark.sb-ai-marker.sb-marker-yellow { background: rgba(254, 240, 138, 0.92); color: #111827; }
        mark.sb-ai-marker.sb-marker-green  { background: rgba(167, 243, 208, 0.92); color: #064e3b; }
        mark.sb-ai-marker.sb-marker-pink   { background: rgba(251, 207, 232, 0.92); color: #831843; }
        mark.sb-ai-marker.sb-marker-blue   { background: rgba(191, 219, 254, 0.92); color: #1e3a8a; }
        mark.sb-ai-marker[data-marker-num]::before {
          content: "#" attr(data-marker-num);
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          line-height: 1;
          padding: 2px 4px;
          margin-right: 3px;
          border-radius: 99px;
          background: #111827;
          color: #ffffff;
          vertical-align: middle;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        mark.sb-ai-marker.sb-marker-pulse {
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.65);
        }
        body.sb-highlighter-cursor {
          cursor: text;
        }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    function createMarkElement(doc, marker) {
      const mark = doc.createElement('mark');
      mark.className = `sb-ai-marker sb-marker-${marker.color || 'yellow'}`;
      mark.dataset.markerId = marker.id;
      mark.dataset.markerNum = String(marker.number || 1);
      mark.title = marker.note
        ? `[AI 마커 #${marker.number}] ${marker.note} (클릭하여 메모 수정)`
        : `[AI 마커 #${marker.number}] 클릭하여 메모 추가/수정`;
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextNote = prompt(
          `[AI 마커 #${marker.number}] 이 부분에 대한 짧은 메모를 입력하세요 (비워두면 메모 없음):\n"${marker.text.slice(0, 80)}"`,
          marker.note || ''
        );
        if (nextNote !== null) {
          marker.note = nextNote.trim();
          persistMarkers();
          showToast(`🖍️ 마커 #${marker.number} 메모가 저장되었습니다.`);
        }
      });
      return mark;
    }

    function wrapRangeWithMarker(doc, range, marker) {
      // 단일 텍스트 노드 내부인 경우 빠르게 감싸기
      if (
        range.startContainer === range.endContainer &&
        range.startContainer.nodeType === Node.TEXT_NODE
      ) {
        const mark = createMarkElement(doc, marker);
        range.surroundContents(mark);
        return true;
      }

      // 여러 노드/태그를 걸친 선택인 경우: 범위 안의 텍스트 노드만 안전하게 분리해 감싸기
      const textNodes = [];
      const walker = doc.createTreeWalker(
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentNode
          : range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        if (node.parentElement && node.parentElement.closest('script, style, mark.sb-ai-marker')) continue;
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      }
      if (textNodes.length === 0) return false;

      let wrappedFirst = false;
      textNodes.forEach((tn) => {
        let start = 0;
        let end = tn.nodeValue.length;
        if (tn === range.startContainer) start = range.startOffset;
        if (tn === range.endContainer) end = range.endOffset;
        if (end <= start) return;

        const targetNode = start > 0 ? tn.splitText(start) : tn;
        if (end - start < targetNode.nodeValue.length) {
          targetNode.splitText(end - start);
        }

        const mark = createMarkElement(doc, marker);
        if (wrappedFirst) {
          // 이어지는 조각은 번호 배지 중복 숨김
          mark.removeAttribute('data-marker-num');
          mark.style.setProperty('--hide-badge', '1');
        }
        targetNode.parentNode.insertBefore(mark, targetNode);
        mark.appendChild(targetNode);
        wrappedFirst = true;
      });
      return wrappedFirst;
    }

    function unwrapMarkerFromDoc(doc, markerId) {
      if (!doc) return;
      const marks = doc.querySelectorAll(`mark.sb-ai-marker[data-marker-id="${CSS.escape(markerId)}"]`);
      marks.forEach((mark) => {
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        parent.normalize();
      });
    }

    function refreshMarkerBadgesInDoc() {
      const doc = iframe.contentDocument;
      if (!doc) return;
      item.aiMarkers.forEach((m) => {
        const marks = doc.querySelectorAll(`mark.sb-ai-marker[data-marker-id="${CSS.escape(m.id)}"]`);
        marks.forEach((mark, idx) => {
          if (idx === 0) mark.dataset.markerNum = String(m.number);
          mark.title = m.note
            ? `[AI 마커 #${m.number}] ${m.note} (클릭하여 메모 수정)`
            : `[AI 마커 #${m.number}] 클릭하여 메모 추가/수정`;
        });
      });
    }

    function applySavedMarkersToDoc(doc) {
      if (!doc || !doc.body || !Array.isArray(item.aiMarkers) || item.aiMarkers.length === 0) return;
      renumberMarkers();

      item.aiMarkers.forEach((marker) => {
        const needle = String(marker.text || '').trim();
        if (!needle) return;
        if (doc.querySelector(`mark.sb-ai-marker[data-marker-id="${CSS.escape(marker.id)}"]`)) return;

        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
        let node;
        let bestMatch = null;

        while ((node = walker.nextNode())) {
          if (!node.nodeValue || node.parentElement?.closest('script, style, mark.sb-ai-marker')) continue;
          const idx = node.nodeValue.indexOf(needle);
          if (idx !== -1) {
            bestMatch = { node, idx };
            if (!marker.context || node.nodeValue.includes(marker.context.slice(0, 24))) {
              break;
            }
          }
        }

        if (bestMatch) {
          try {
            const range = doc.createRange();
            range.setStart(bestMatch.node, bestMatch.idx);
            range.setEnd(bestMatch.node, bestMatch.idx + needle.length);
            wrapRangeWithMarker(doc, range, marker);
          } catch (_) {}
        }
      });
    }

    function addMarkerFromSelection() {
      const doc = iframe.contentDocument;
      const winObj = iframe.contentWindow;
      if (!doc || !winObj) return false;

      const sel = winObj.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

      const rawText = sel.toString().replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length < 1) return false;

      const range = sel.getRangeAt(0);
      const containerText = String(range.commonAncestorContainer?.textContent || '').replace(/\s+/g, ' ').trim();
      const contextSnippet = containerText.length > 220 ? containerText.slice(0, 220) + '…' : containerText;

      const marker = {
        id: `mk-${genId()}`,
        number: item.aiMarkers.length + 1,
        color: selectedColor,
        text: rawText.slice(0, 600),
        context: contextSnippet,
        note: '',
        createdAt: new Date().toISOString()
      };

      try {
        wrapRangeWithMarker(doc, range, marker);
      } catch (_) {}

      sel.removeAllRanges();
      item.aiMarkers.push(marker);
      persistMarkers();
      showToast(`🖍️ AI 마커 #${marker.number} 표시됨 — 나중에 AI에게 "마커 쳐놓은 거 어떻게 생각해?"라고 물어보세요!`);
      return true;
    }

    function scrollToMarker(markerId) {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const target = doc.querySelector(`mark.sb-ai-marker[data-marker-id="${CSS.escape(markerId)}"]`);
      if (!target) {
        showToast('해당 마커 위치를 화면에서 찾지 못했습니다.');
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('sb-marker-pulse');
      setTimeout(() => target.classList.remove('sb-marker-pulse'), 1300);
    }

    function renderMarkerTray() {
      trayEl.innerHTML = '';
      if (!item.aiMarkers || item.aiMarkers.length === 0) {
        trayEl.style.display = 'none';
        return;
      }
      trayEl.style.display = 'flex';
      const label = document.createElement('span');
      label.className = 'html-marker-tray-label';
      label.textContent = `🖍️ AI 마커 (${item.aiMarkers.length}):`;
      trayEl.appendChild(label);

      item.aiMarkers.forEach((m) => {
        const chip = document.createElement('div');
        chip.className = 'html-marker-chip';
        chip.title = m.note ? `#${m.number} ${m.text}\n메모: ${m.note}` : `#${m.number} ${m.text} (클릭하여 이동)`;
        chip.innerHTML =
          `<span class="html-marker-chip-dot ${escapeHtml(m.color || 'yellow')}"></span>` +
          `<span class="html-marker-chip-text">#${m.number} ${escapeHtml(m.text.slice(0, 28))}${m.note ? ` · 💬` : ''}</span>` +
          `<button type="button" class="html-marker-chip-del" title="마커 삭제">✕</button>`;

        chip.addEventListener('click', () => scrollToMarker(m.id));
        chip.querySelector('.html-marker-chip-del').addEventListener('click', (e) => {
          e.stopPropagation();
          unwrapMarkerFromDoc(iframe.contentDocument, m.id);
          item.aiMarkers = item.aiMarkers.filter((x) => x.id !== m.id);
          persistMarkers();
        });
        trayEl.appendChild(chip);
      });
    }

    // Toolbar interactions
    btnToggle.addEventListener('click', () => {
      highlighterOn = !highlighterOn;
      btnToggle.classList.toggle('active', highlighterOn);
      btnToggle.textContent = highlighterOn ? '🖍️ 형광펜 ON' : '🖍️ 형광펜 OFF';
      if (iframe.contentDocument?.body) {
        iframe.contentDocument.body.classList.toggle('sb-highlighter-cursor', highlighterOn);
      }
      if (highlighterOn) {
        showToast('🖍️ 형광펜 ON: HTML 안의 텍스트를 드래그하면 AI 마커가 표시됩니다.');
      }
    });

    colorBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedColor = btn.dataset.color || 'yellow';
        colorBtns.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    btnMarkSel.addEventListener('click', () => {
      if (!addMarkerFromSelection()) {
        showToast('먼저 HTML 화면에서 표시할 텍스트를 드래그해 선택해 주세요.');
      }
    });

    btnLinkAi.addEventListener('click', () => {
      attachNodeToContext(item);
      switchRightTab('chat');
      const count = item.aiMarkers.length;
      showToast(
        count > 0
          ? `🤖 AI 대화에 마커 ${count}개가 연결되었습니다. "거기 마커 쳐놓은 거 어떻게 생각해?"처럼 편하게 물어보세요!`
          : '🤖 이 HTML 문서가 AI 대화에 연결되었습니다.'
      );
    });

    btnClearMarkers.addEventListener('click', () => {
      if (!item.aiMarkers.length) return;
      if (!confirm(`표시된 AI 마커 ${item.aiMarkers.length}개를 모두 지울까요?`)) return;
      const doc = iframe.contentDocument;
      item.aiMarkers.forEach((m) => unwrapMarkerFromDoc(doc, m.id));
      item.aiMarkers = [];
      persistMarkers();
      showToast('모든 AI 마커가 초기화되었습니다.');
    });

    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        injectMarkerStyles(doc);
        applySavedMarkersToDoc(doc);
        renderMarkerTray();
        doc.addEventListener('mouseup', () => {
          if (!highlighterOn) return;
          setTimeout(() => addMarkerFromSelection(), 10);
        });
      } catch (err) {
        console.warn('HTML 마커 초기화 실패:', err);
      }
    });

    iframe.src = blobUrl;

    WinManager.openWindow({
      id: winId,
      title: item.name || 'HTML 미리보기',
      icon: item.icon || '🌐',
      meta: 'HTML',
      width: 980,
      height: 700,
      contentEl: root,
      headerActions: [
        {
          label: '↗ 새 탭',
          title: '브라우저 새 탭으로 열기',
          onClick: () => runHtmlContent(item)
        },
        {
          label: '🖥️ PC 브라우저',
          title: 'PC 기본 브라우저로 열기',
          onClick: () => openMemoInLocalApp(item)
        }
      ],
      onClose: () => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (_) {}
        renderContextChips();
      }
    });

    renderContextChips();
  }

  async function openDriveFileViewer(item) {
    const df = item?.driveFile;
    if (!df || !df.id) return;

    const winId = `file-${item.id}`;
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      return;
    }

    const cat = BrainDrive.getFileCategory(df);
    const sizeText = BrainDrive.formatFileSize(df.size);
    let currentBlobUrl = '';

    const win = WinManager.openWindow({
      id: winId,
      title: df.name || item.name,
      icon: item.icon || '📄',
      meta: sizeText ? `(${sizeText})` : '',
      width: 940,
      height: 660,
      bodyClass: 'media-viewer-body',
      contentHtml: `<div class="drive-preview-loading" style="color:#e5e7eb;">☁️ 파일 불러오는 중...</div>`,
      headerActions: [
        {
          label: '↗ 새 탭',
          title: '새 탭에서 열기',
          onClick: () => {
            if (currentBlobUrl) window.open(currentBlobUrl, '_blank');
            else window.open(BrainDrive.getWebViewUrl(df), '_blank', 'noopener,noreferrer');
          }
        },
        {
          label: '🖥️ PC앱',
          title: 'PC 연결 프로그램으로 바로 열기',
          onClick: () => openMemoInLocalApp(item)
        },
        {
          label: '⬇️ 저장',
          title: '파일 다운로드',
          onClick: () => downloadDriveFile(item)
        }
      ]
    });
    if (!win) return;

    // 이미지 / PDF / 동영상 / 오디오 → 인증된 Blob URL로 창 내부에 바로 표시
    if (['image', 'pdf', 'video', 'audio'].includes(cat)) {
      let token;
      try {
        token = await ensureDriveToken(true);
      } catch (err) {
        win.close();
        showToast(`⚠️ ${err.message}`);
        return;
      }

      try {
        const entry = await BrainDrive.getFileBlobUrl(token, df.id, df.mimeType);
        if (!WinManager.getWindow(winId)) return; // 로드 중 창 닫힘
        currentBlobUrl = entry.url;

        if (cat === 'image') {
          const img = document.createElement('img');
          img.src = entry.url;
          img.alt = df.name || item.name;
          win.setBody(img);
        } else if (cat === 'pdf') {
          const iframe = document.createElement('iframe');
          iframe.src = entry.url;
          iframe.title = df.name || item.name;
          win.setBody(iframe);
        } else if (cat === 'video') {
          const video = document.createElement('video');
          video.src = entry.url;
          video.controls = true;
          video.autoplay = true;
          win.setBody(video);
        } else if (cat === 'audio') {
          const audio = document.createElement('audio');
          audio.src = entry.url;
          audio.controls = true;
          audio.autoplay = true;
          win.setBody(audio);
        }
      } catch (err) {
        if (!WinManager.getWindow(winId)) return;
        handleDriveError(err);
        win.setBody(
          `<div class="viewer-fallback">` +
          `  <div class="viewer-fallback-icon">⚠️</div>` +
          `  <div>파일을 불러오지 못했습니다.</div>` +
          `  <p>${escapeHtml(err.message)}</p>` +
          `  <button type="button" class="btn btn-drive btn-win-retry-web">☁️ Google Drive에서 직접 열기</button>` +
          `</div>`
        );
        const retryBtn = win.bodyEl.querySelector('.btn-win-retry-web');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            window.open(BrainDrive.getWebViewUrl(df), '_blank', 'noopener,noreferrer');
          });
        }
      }
      return;
    }

    // PowerPoint(PPT/PPTX) / Word / Excel / 기타 → Google Drive 내장 뷰어 iframe
    const previewUrl = BrainDrive.getPreviewEmbedUrl(df.id);
    win.setBody(
      `<div class="viewer-notice-bar">` +
      `  <span>☁️ Google Drive 뷰어로 표시 중입니다. 화면이 비어 보이면 상단 <b>[↗ 새 탭]</b> 또는 <b>[🖥️ PC앱]</b>을 눌러주세요.</span>` +
      `</div>` +
      `<iframe src="${escapeHtml(previewUrl)}" allow="autoplay; fullscreen" title="${escapeHtml(df.name || item.name)}"></iframe>`
    );
  }

  async function downloadDriveFile(item) {
    const df = item?.driveFile;
    if (!df || !df.id) return;

    let token;
    try {
      token = await ensureDriveToken(true);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
      return;
    }

    showToast(`⬇️ "${df.name || item.name}" 다운로드 준비 중...`);
    try {
      const entry = await BrainDrive.getFileBlobUrl(token, df.id, df.mimeType);
      const a = document.createElement('a');
      a.href = entry.url;
      a.download = df.name || item.name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      handleDriveError(err);
      showToast(`⚠️ 다운로드 실패: ${err.message}`);
    }
  }

  // ================= OS Floating Windows: Built-in Excel Spreadsheet =================
  function isSpreadsheetItem(item) {
    if (!item || item.type !== 'doc') return false;
    if (item.sheetData && Array.isArray(item.sheetData.sheets)) return true;
    const name = String(item.name || '').trim().toLowerCase();
    if (/\.(xlsx|xls|csv)$/.test(name)) return true;
    const mime = String(item.driveFile?.mimeType || '').toLowerCase();
    return mime.includes('spreadsheet') || mime.includes('excel');
  }

  async function syncSpreadsheetToDriveNow(item) {
    if (!item || !item.sheetData || !isOwnerAuthenticated()) return;
    const token = BrainAuth.getDriveAccessToken();
    if (!token) return;

    const userEmail = BrainAuth.getUser()?.email || '';
    const folderPath = getRelativeFolderPathForItem(item.id);
    const lowerName = String(item.name || '').toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const csvText = BrainSheet.exportSheetToCsv(item.sheetData, item.sheetData.activeSheet || 0);
      const res = await BrainDrive.upsertTextFile(token, {
        fileId: item.driveFile?.id || item.driveDocId || '',
        name: item.name,
        content: csvText,
        mimeType: 'text/csv',
        folderPath,
        userEmail
      });
      if (res && res.id) {
        item.driveDocId = res.id;
        item.driveFile = {
          id: res.id,
          name: res.name || item.name,
          mimeType: 'text/csv',
          size: Number(res.size || csvText.length),
          webViewLink: res.webViewLink || `https://drive.google.com/file/d/${res.id}/view`,
          uploadedAt: res.modifiedTime || new Date().toISOString()
        };
        persistFS({ silent: true });
      }
      return;
    }

    const xlsxName = /\.xlsx$/i.test(item.name) ? item.name : `${item.name.replace(/\.xls$/i, '')}.xlsx`;
    const blob = await BrainSheet.exportWorkbookToXlsxBlob(item.sheetData);
    const uploaded = await BrainDrive.upsertBinaryFile(token, {
      fileId: item.driveFile?.id || '',
      name: xlsxName,
      blob,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      folderPath,
      userEmail
    });
    if (uploaded && uploaded.id) {
      item.driveFile = uploaded;
      persistFS({ silent: true });
    }
  }

  const openSheetViews = new Map(); // itemId -> Set<{ winId, win, controller }>
  let sheetViewSeq = 0;

  function updateSheetWindowTitles(item) {
    const views = openSheetViews.get(item.id);
    if (!views) return;
    const arr = Array.from(views);
    arr.forEach((v, idx) => {
      const suffix = arr.length > 1 ? `:${idx + 1}` : '';
      v.win.setTitle(`${item.name}${suffix}`);
    });
  }

  async function openSpreadsheetWindow(item, opts = {}) {
    if (!item || item.type !== 'doc') return;
    const allowMultiple = Boolean(opts.allowMultiple);
    const existingViews = openSheetViews.get(item.id);
    if (!allowMultiple && existingViews && existingViews.size > 0) {
      const firstView = Array.from(existingViews)[0];
      if (firstView?.win) {
        firstView.win.restore();
        return;
      }
    }

    const winId = allowMultiple ? `sheet-${item.id}-${++sheetViewSeq}` : `sheet-${item.id}`;
    if (!allowMultiple) {
      const existing = WinManager.getWindow(winId);
      if (existing) {
        existing.restore();
        return;
      }
    }

    let sheetController = null;
    let viewEntry = null;
    const win = WinManager.openWindow({
      id: winId,
      title: item.name,
      icon: item.icon || '📊',
      meta: 'Excel · Origin 분석기',
      width: 1180,
      height: 720,
      bodyClass: 'sb-sheet-win-body',
      contentHtml: `<div class="drive-preview-loading">📊 스프레드시트 불러오는 중...</div>`,
      onClose() {
        if (sheetController && typeof sheetController.destroy === 'function') {
          sheetController.destroy();
          sheetController = null;
        }
        const set = openSheetViews.get(item.id);
        if (set && viewEntry) {
          set.delete(viewEntry);
          if (set.size === 0) openSheetViews.delete(item.id);
          else updateSheetWindowTitles(item);
        }
      }
    });
    if (!win) return;

    let workbook = null;
    try {
      if (item.sheetData && Array.isArray(item.sheetData.sheets)) {
        workbook = BrainSheet.normalizeWorkbook(item.sheetData);
      } else if (item.driveFile && item.driveFile.id) {
        const token = await ensureDriveToken(true);
        const buf = await BrainDrive.getFileArrayBuffer(token, item.driveFile.id);
        workbook = await BrainSheet.parseArrayBufferToWorkbook(buf, item.driveFile.name || item.name);
        item.sheetData = workbook;
        item.summary = BrainSheet.workbookToMarkdownSummary(workbook);
        persistFS({ silent: true });
        if (state.selectedItem && state.selectedItem.id === item.id) {
          $('p-summary').innerHTML = renderMarkdown(item.summary);
        }
      } else if (/\.csv$/i.test(String(item.name || '')) && item.summary) {
        workbook = BrainSheet.parseCsvToWorkbook(item.summary, item.name.replace(/\.csv$/i, '') || 'Sheet1');
        item.sheetData = workbook;
      } else {
        workbook = BrainSheet.createEmptyWorkbook('Sheet1');
        item.sheetData = workbook;
      }
    } catch (err) {
      handleDriveError(err);
      win.setBody(
        `<div class="drive-preview-loading" style="flex-direction:column; gap:10px; padding:24px; text-align:center;">` +
        `<div>⚠️ 스프레드시트를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>` +
        `<button type="button" class="btn btn-sheet" id="btn-sheet-fallback-new">📊 빈 시트로 새로 열기</button>` +
        `</div>`
      );
      const fbBtn = win.bodyEl.querySelector('#btn-sheet-fallback-new');
      if (fbBtn) {
        fbBtn.addEventListener('click', () => {
          item.sheetData = BrainSheet.createEmptyWorkbook('Sheet1');
          win.close();
          openSpreadsheetWindow(item);
        });
      }
      return;
    }

    sheetController = BrainSheet.mountSpreadsheetUI(win.bodyEl, {
      workbook,
      fileName: item.name,
      initialAppMode: opts.initialAppMode || 'excel',
      hideAI: isGuestMode,
      onToast: showToast,
      onDirtyChange(dirty) {
        win.setMeta(dirty ? '● 수정됨' : 'Excel · Origin 분석기');
      },
      onWorkbookMutate(updatedWb) {
        item.sheetData = updatedWb;
        const siblings = openSheetViews.get(item.id);
        if (siblings && siblings.size > 1) {
          siblings.forEach((v) => {
            if (v !== viewEntry && v.controller && typeof v.controller.syncWorkbook === 'function') {
              v.controller.syncWorkbook(updatedWb);
            }
          });
        }
      },
      onNewWindow(latestWb, currentMode) {
        item.sheetData = latestWb;
        openSpreadsheetWindow(item, { allowMultiple: true, initialAppMode: currentMode });
        setTimeout(() => {
          const views = openSheetViews.get(item.id);
          if (views && views.size >= 2 && typeof WinManager.tileWindows === 'function') {
            WinManager.tileWindows(Array.from(views).map((v) => v.winId), 'horizontal');
          }
        }, 60);
        showToast(`🪟 "${item.name}" 새 창이 열렸습니다 (두 창이 실시간 동기화됩니다).`);
      },
      onArrangeWindows() {
        const sameFileViews = openSheetViews.get(item.id);
        const ids = sameFileViews && sameFileViews.size >= 2
          ? Array.from(sameFileViews).map((v) => v.winId)
          : (WinManager.listOpenWindowIds ? WinManager.listOpenWindowIds() : []);
        if (ids.length >= 2 && typeof WinManager.tileWindows === 'function') {
          WinManager.tileWindows(ids, 'horizontal');
          showToast(`◫ 열려 있는 창 ${ids.length}개를 나란히 정렬했습니다.`);
        } else {
          showToast('💡 먼저 [새 창]을 눌러 창을 2개 이상 열어주세요.');
        }
      },
      onAutoSave(updatedWb, mdSummary) {
        item.sheetData = updatedWb;
        item.summary = mdSummary;
        touchNode(item);
        persistFS();
        scheduleItemSyncToLocalFolder(item, false);
        if (state.selectedItem && state.selectedItem.id === item.id) {
          $('p-summary').innerHTML = renderMarkdown(item.summary);
        }
      },
      async onSave(updatedWb, mdSummary) {
        saveStateForUndo();
        item.sheetData = updatedWb;
        item.summary = mdSummary;
        touchNode(item);
        saveAndRender();
        if (state.selectedItem && state.selectedItem.id === item.id) {
          $('p-summary').innerHTML = renderMarkdown(item.summary);
        }
        win.setMeta('저장됨');

        let syncedDrive = false;
        if (BrainAuth.getDriveAccessToken() && isOwnerAuthenticated()) {
          try {
            await syncSpreadsheetToDriveNow(item);
            syncedDrive = true;
          } catch (err) {
            handleDriveError(err);
          }
        }
        const lfRes = await syncItemToLocalFolderNow(item, { allowAutoDownload: true });
        const lf = BrainLocalFolder?.getStatus();
        if (syncedDrive && lf?.connected && lfRes?.ok) {
          showToast(`☁️ "${item.name}" Google Drive 및 로컬 폴더(${lf.folderName}) 저장 완료`);
        } else if (syncedDrive) {
          showToast(`☁️ "${item.name}" 저장 및 Google Drive 동기화 완료`);
        } else if (lf?.connected && lfRes?.ok) {
          showToast(`📂 "${item.name}" 로컬 폴더(${lf.folderName})에 저장 완료`);
        } else if (lfRes?.downloaded) {
          showToast(`💾 "${item.name}" 저장 및 PC 다운로드 완료`);
        } else {
          showToast(`💾 "${item.name}" 저장되었습니다.`);
        }
      },
      onAskAI(updatedWb, mdSummary) {
        item.sheetData = updatedWb;
        item.summary = mdSummary;
        persistFS();
        attachNodeToContext(item);
        switchRightTab('chat');
        const rightPanel = $('right-panel');
        if (rightPanel && rightPanel.classList.contains('collapsed')) {
          togglePanel('right-panel', 'btn-right-panel', 'resizer-right');
        }
        elChatInput.focus();
        showToast(`🤖 "${item.name}" 시트가 AI 컨텍스트에 첨부되었습니다.`);
      }
    });

    viewEntry = { winId, win, controller: sheetController };
    if (!openSheetViews.has(item.id)) openSheetViews.set(item.id, new Set());
    openSheetViews.get(item.id).add(viewEntry);
    updateSheetWindowTitles(item);
  }

  $('btn-open-sheet').addEventListener('click', () => {
    if (state.selectedItem) openSpreadsheetWindow(state.selectedItem);
  });

  $('btn-open-md-viewer').addEventListener('click', () => {
    if (state.selectedItem) openMarkdownWindow(state.selectedItem, 'view');
  });

  $('btn-open-md-split').addEventListener('click', () => {
    if (state.selectedItem) openMarkdownWindow(state.selectedItem, 'split');
  });

  $('btn-drive-sync').addEventListener('click', () => {
    if (!BrainAuth.isConfigComplete(state.settings.firebaseConfig) || !isOwnerAuthenticated()) {
      openAuthModal();
      return;
    }
    if (driveSyncStatus === 'error' && lastDriveErrorCode === 'API_DISABLED') {
      openAuthModal();
      return;
    }
    syncWithDrive({ mode: 'manual', interactive: true, showSuccessToast: true });
  });

  $('btn-reset-firebase-default').addEventListener('click', async () => {
    state.settings.firebaseConfig = { ...DEFAULT_FIREBASE_CONFIG };
    persistSettings();
    $('auth-fb-apikey').value = DEFAULT_FIREBASE_CONFIG.apiKey;
    $('auth-fb-authdomain').value = DEFAULT_FIREBASE_CONFIG.authDomain;
    $('auth-fb-projectid').value = DEFAULT_FIREBASE_CONFIG.projectId;
    lastDriveErrorMessage = '';
    lastDriveErrorCode = '';
    try {
      await BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged);
    } catch (_) {}
    onAuthStateChanged();
    renderAuthModalContent();
    showToast('🧹 Firebase 설정이 초기화되었습니다. 본인 Firebase 프로젝트 정보를 입력해 주세요.');
  });

  $('btn-auth-drive-sync').addEventListener('click', () => {
    syncWithDrive({ mode: 'manual', interactive: true, showSuccessToast: true });
  });

  $('btn-auth-open-drive-folder').addEventListener('click', async () => {
    try {
      const token = BrainAuth.getDriveAccessToken();
      if (token) {
        await BrainDrive.ensureAppFolders(token, BrainAuth.getUser()?.email || '');
      }
    } catch (_) {}
    window.open(BrainDrive.getRootFolderUrl(), '_blank', 'noopener,noreferrer');
  });

  $('btn-drive-open').addEventListener('click', () => {
    if (!state.selectedItem) return;
    if (isSpreadsheetItem(state.selectedItem)) openSpreadsheetWindow(state.selectedItem);
    else if (state.selectedItem.driveFile) openDriveFileViewer(state.selectedItem);
  });

  $('btn-drive-open-pc').addEventListener('click', () => {
    if (state.selectedItem?.driveFile) openMemoInLocalApp(state.selectedItem);
  });

  $('btn-drive-webview').addEventListener('click', () => {
    const df = state.selectedItem?.driveFile;
    if (df) window.open(BrainDrive.getWebViewUrl(df), '_blank', 'noopener,noreferrer');
  });

  $('btn-drive-download').addEventListener('click', () => {
    if (state.selectedItem?.driveFile) downloadDriveFile(state.selectedItem);
  });

  $('reattach-file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !state.selectedItem) return;

    let driveToken;
    try {
      driveToken = await ensureDriveToken(true);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
      openAuthModal();
      return;
    }

    showToast(`☁️ "${file.name}" Google Drive 업로드 중...`);
    try {
      const folderPath = getRelativeFolderPathForItem(state.selectedItem.id);
      const uploaded = await BrainDrive.uploadFile(driveToken, file, BrainAuth.getUser()?.email || '', folderPath);
      saveStateForUndo();
      state.selectedItem.driveFile = uploaded;
      if (!state.selectedItem.name || state.selectedItem.name === '새 메모' || state.selectedItem.name === '새 메모.md') {
        state.selectedItem.name = file.name;
      }
      saveAndRender();
      selectItem(state.selectedItem);
      showToast(`✅ "${file.name}" 원본 파일이 연결되었습니다.`);
    } catch (err) {
      handleDriveError(err);
      showToast(`⚠️ 업로드 실패: ${err.message}`);
      if (err?.code === 'API_DISABLED' || err?.code === 'INSUFFICIENT_SCOPE') {
        openAuthModal();
      }
    }
  });

  window.addEventListener('focus', () => {
    if (!isGuestMode && !BrainAuth.isFileProtocol() && navigator.onLine !== false) {
      refreshBridgeStatus(false);
    }
    updateDriveStatusUI();
  });

  // ================= Sort Control =================
  const elSortSelect = $('sort-select');
  if (elSortSelect) {
    elSortSelect.value = currentSortMode || 'default';
    elSortSelect.addEventListener('change', (e) => {
      currentSortMode = e.target.value || 'default';
      setSortMode(currentSortMode);
      renderTree(state.fileSystem, elTreeRoot, true);
      if (searchQuery) renderSearchResults(searchQuery);
      else openFolder(state.currentFolder);
    });
  }

  // ================= File Relations & Hierarchy Graph (DB-Style) =================
  const elRelationModal = $('relation-modal');
  let relationSourceItem = null;

  function navigateToNode(node) {
    if (!node || !isItemVisible(node)) return;
    if (isHomeMode) setHomeMode(false);
    const paraEnt = (node.isVirtual || node.type === 'para-entity') ? node : findParaEntity(node.id);
    if (paraEnt) {
      clearSearch(false);
      openParaVirtualView({ mode: 'entity', entityId: paraEnt.id });
      return;
    }
    const found = findNodeAndParent(node.id);
    if (!found) return;
    clearSearch(false);
    if (found.node.type === 'folder') {
      openFolder(found.node);
    } else if (found.parent) {
      openFolder(found.parent);
    }
    renderTree(state.fileSystem, elTreeRoot, true);
    selectedItemIds = new Set([found.node.id]);
    lastClickedItemId = found.node.id;
    selectItem(found.node);
    updateCardSelectionClasses();
  }

  function launchItemDirectly(item) {
    if (!item || !isItemVisible(item)) return;
    const paraEnt = (item.isVirtual || item.type === 'para-entity') ? item : findParaEntity(item.id);
    if (paraEnt) {
      if (isHomeMode) setHomeMode(false);
      clearSearch(false);
      openParaVirtualView({ mode: 'entity', entityId: paraEnt.id });
      return;
    }
    if (item.type === 'folder') {
      if (isHomeMode) setHomeMode(false);
      clearSearch(false);
      openFolder(item);
      renderTree(state.fileSystem, elTreeRoot, true);
    } else if (isSpreadsheetItem(item)) {
      openSpreadsheetWindow(item);
    } else if (item.driveFile && item.driveFile.id) {
      openDriveFileViewer(item);
    } else if (item.link && LocalBridge.isWebUrl(item.link)) {
      window.open(item.link, '_blank', 'noopener,noreferrer');
    } else if (item.link && LocalBridge.isLocalPath(item.link)) {
      launchLocalItem(item.link, 'open');
    } else if (isHtmlContentItem(item)) {
      openHtmlWindow(item);
    } else if (isMarkdownDocItem(item)) {
      openMarkdownWindow(item, 'view');
    } else {
      navigateToNode(item);
    }
  }

  function renderDetailRelations(item) {
    const listEl = $('detail-relations-list');
    const badgeEl = $('relations-count-badge');
    if (!listEl || !item) return;

    const rels = getRelationsForNode(item.id);
    const allGroups = [
      ...(rels.projects || []).map((x) => ({ ...x, badge: '🚀 프로젝트', cls: 'rel-project' })),
      ...(rels.areas || []).map((x) => ({ ...x, badge: '🧭 영역', cls: 'rel-area' })),
      ...(rels.resources || []).map((x) => ({ ...x, badge: '📚 리소스', cls: 'rel-resource' })),
      ...rels.parents.map((x) => ({ ...x, badge: '⬆️ 상위', cls: 'rel-parent' })),
      ...rels.children.map((x) => ({ ...x, badge: '⬇️ 하위', cls: 'rel-child' })),
      ...rels.related.map((x) => ({ ...x, badge: '🔗 연관', cls: 'rel-related' })),
      ...rels.references.map((x) => ({ ...x, badge: '📎 참조', cls: 'rel-ref' })),
      ...rels.referencedBy.map((x) => ({ ...x, badge: '↩️ 피참조', cls: 'rel-ref' }))
    ];

    if (badgeEl) badgeEl.textContent = allGroups.length > 0 ? `(${allGroups.length})` : '';
    listEl.innerHTML = '';

    if (allGroups.length === 0) {
      listEl.innerHTML = `<span class="relation-empty-hint">연결된 파일이 없습니다. [＋ 연결]로 상하/연관 관계를 지정하세요.</span>`;
      return;
    }

    allGroups.forEach(({ rel, node, badge, cls }) => {
      const chip = document.createElement('span');
      chip.className = `relation-chip ${cls}`;
      chip.title = `${badge}: ${node.name}${rel.label ? ` (${rel.label})` : ''} — 클릭하여 이동 · 더블클릭하여 열기`;
      chip.innerHTML =
        `<span>${badge}</span>` +
        `<span>${escapeHtml(node.icon || (node.type === 'folder' ? '📁' : '📄'))} ${escapeHtml(node.name)}</span>` +
        (rel.label ? `<span class="relation-chip-label">· ${escapeHtml(rel.label)}</span>` : '') +
        `<button type="button" class="relation-chip-del" title="연결 해제">✕</button>`;

      chip.addEventListener('click', () => navigateToNode(node));
      chip.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        launchItemDirectly(node);
      });
      chip.querySelector('.relation-chip-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (removeRelation(rel.id)) {
          scheduleDriveSync();
          renderDetailRelations(item);
          renderRelationsDbPanel();
          showToast('연결 관계가 해제되었습니다.');
        }
      });
      listEl.appendChild(chip);
    });
  }

  function renderRelationTargetPicker(query = '') {
    const listEl = $('relation-target-list');
    if (!listEl || !relationSourceItem) return;
    const q = String(query || '').trim().toLowerCase();
    const mode = $('relation-type-select')?.value || 'project';
    const isParaMode = mode === 'project' || mode === 'area' || mode === 'resource';
    const basePool = isParaMode ? getParaEntities(mode) : collectAllNodes(state.fileSystem);
    const candidates = basePool.filter((n) => {
      if (n.id === relationSourceItem.id || !isItemVisible(n)) return false;
      if (!q) return true;
      return `${n.name || ''} ${n.tag || ''}`.toLowerCase().includes(q);
    });

    listEl.innerHTML = '';
    if (candidates.length === 0) {
      const msg = isParaMode
        ? '선언된 항목이 없습니다. 우측 [🗃️ 연결 DB] 상단에서 프로젝트·영역·리소스를 먼저 선언해 주세요.'
        : '연결할 수 있는 항목이 없습니다.';
      listEl.innerHTML = `<div style="padding:14px; text-align:center; font-size:0.78rem; color:var(--text-muted);">${msg}</div>`;
      return;
    }

    candidates.slice(0, 80).forEach((node) => {
      const pathNodes = getPathToNode(node.id) || [];
      const folderText = pathNodes.length > 2 ? pathNodes.slice(1, -1).map((p) => p.name).join(' / ') : '루트';
      const row = document.createElement('div');
      row.className = 'picker-item';
      row.innerHTML =
        `<div class="picker-item-main">` +
        `  <span>${escapeHtml(node.icon || (node.type === 'folder' ? '📁' : '📄'))}</span>` +
        `  <div style="min-width:0;">` +
        `    <div class="picker-item-name">${escapeHtml(node.name)}</div>` +
        `    <div class="picker-item-path">${escapeHtml(folderText)}</div>` +
        `  </div>` +
        `</div>` +
        `<span class="picker-item-badge">＋ 연결</span>`;

      row.addEventListener('click', () => {
        const mode = $('relation-type-select').value;
        const label = $('relation-label-input').value.trim();
        let res = null;
        if (mode === 'project' || mode === 'area' || mode === 'resource') {
          res = addRelation({ sourceId: relationSourceItem.id, targetId: node.id, type: mode, label });
        } else if (mode === 'child') {
          res = addRelation({ sourceId: relationSourceItem.id, targetId: node.id, type: 'parent', label });
        } else if (mode === 'parent') {
          res = addRelation({ sourceId: node.id, targetId: relationSourceItem.id, type: 'parent', label });
        } else if (mode === 'reference') {
          res = addRelation({ sourceId: relationSourceItem.id, targetId: node.id, type: 'reference', label });
        } else {
          res = addRelation({ sourceId: relationSourceItem.id, targetId: node.id, type: 'related', label });
        }
        if (res) {
          scheduleDriveSync();
          triggerSbMirrorSync();
          if (state.selectedItem) renderDetailRelations(state.selectedItem);
          renderRelationsDbPanel();
          showToast(`🔗 "${relationSourceItem.name}" ↔ "${node.name}" 연결되었습니다.`);
          elRelationModal.style.display = 'none';
        }
      });
      listEl.appendChild(row);
    });
  }

  function openRelationModal(item) {
    if (!item || item.id === 'root') return;
    relationSourceItem = item;
    $('relation-source-label').textContent = `기준: ${item.icon || '📄'} ${item.name}`;
    $('relation-label-input').value = '';
    $('relation-target-search').value = '';
    renderRelationTargetPicker('');
    elRelationModal.style.display = 'flex';
    $('relation-target-search').focus();
  }

  $('btn-open-relation-modal')?.addEventListener('click', () => {
    if (state.selectedItem) openRelationModal(state.selectedItem);
  });
  $('btn-goto-relation-db')?.addEventListener('click', () => {
    switchRightTab('relations');
  });
  $('btn-close-relation-modal')?.addEventListener('click', () => { elRelationModal.style.display = 'none'; });
  $('btn-cancel-relation-modal')?.addEventListener('click', () => { elRelationModal.style.display = 'none'; });
  elRelationModal?.addEventListener('click', (e) => { if (e.target === elRelationModal) elRelationModal.style.display = 'none'; });
  $('relation-target-search')?.addEventListener('input', (e) => renderRelationTargetPicker(e.target.value));
  $('relation-type-select')?.addEventListener('change', () => renderRelationTargetPicker($('relation-target-search')?.value || ''));

  // ================= Notion-Style Right-Panel Relation DB =================
  let reldbFilterType = 'all';
  let reldbPickerMode = null; // 'project' | 'area' | 'resource' | 'parent' | 'child' | 'related' | 'reference'

  const RELDB_PROP_META = {
    project: { title: '🚀 프로젝트', chipCls: 'rel-project', pickerTitle: '🚀 프로젝트 연관 지정', keywords: ['프로젝트', 'project', 'projects'] },
    area: { title: '🧭 영역', chipCls: 'rel-area', pickerTitle: '🧭 영역 연관 지정', keywords: ['영역', 'area', 'areas'] },
    resource: { title: '📚 리소스', chipCls: 'rel-resource', pickerTitle: '📚 리소스 연관 지정', keywords: ['리소스', '자료', 'resource', 'resources'] },
    parent: { title: '⬆️ 상위', chipCls: 'rel-parent', pickerTitle: '⬆️ 상위 파일 지정', keywords: [] },
    child: { title: '⬇️ 하위', chipCls: 'rel-child', pickerTitle: '⬇️ 하위 파일 지정', keywords: [] },
    related: { title: '🔗 일반 연관', chipCls: 'rel-related', pickerTitle: '🔗 일반 연관 파일 지정', keywords: [] },
    reference: { title: '📎 참조', chipCls: 'rel-ref', pickerTitle: '📎 참조 파일 지정', keywords: [] }
  };

  function findMatchingRelationForMode(baseId, targetId, mode) {
    return (state.relations || []).find((r) => {
      if (mode === 'project' || mode === 'area' || mode === 'resource' || mode === 'related') {
        return r.type === mode &&
          ((r.sourceId === baseId && r.targetId === targetId) || (r.sourceId === targetId && r.targetId === baseId));
      }
      if (mode === 'parent') return r.type === 'parent' && r.sourceId === targetId && r.targetId === baseId;
      if (mode === 'child') return r.type === 'parent' && r.sourceId === baseId && r.targetId === targetId;
      if (mode === 'reference') return r.type === 'reference' && r.sourceId === baseId && r.targetId === targetId;
      return false;
    });
  }

  function closeInlineRelationPicker() {
    reldbPickerMode = null;
    const picker = $('reldb-inline-picker');
    if (picker) picker.style.display = 'none';
  }

  function renderInlineRelationPickerList() {
    const listEl = $('reldb-picker-list');
    const item = state.selectedItem;
    if (!listEl || !item || !reldbPickerMode) return;

    const q = String($('reldb-picker-search')?.value || '').trim().toLowerCase();
    const isParaMode = reldbPickerMode === 'project' || reldbPickerMode === 'area' || reldbPickerMode === 'resource';

    let basePool = [];
    if (isParaMode) {
      // 프로젝트·영역·리소스 연결은 PARA로 선언된 해당 카테고리 항목으로만 제한
      const poolMap = new Map();
      getParaEntities(reldbPickerMode).forEach((ent) => poolMap.set(ent.id, ent));
      // 기존에 이미 연결돼 있던 항목이 있다면 해제할 수 있도록 표시 유지
      (state.relations || []).forEach((r) => {
        if (r.type === reldbPickerMode && (r.sourceId === item.id || r.targetId === item.id)) {
          const otherId = r.sourceId === item.id ? r.targetId : r.sourceId;
          const found = resolveAnyNode(otherId);
          if (found) poolMap.set(found.id, found);
        }
      });
      basePool = Array.from(poolMap.values());
    } else {
      basePool = collectAllNodes(state.fileSystem);
    }

    const candidates = basePool.filter((n) => {
      if (n.id === item.id || !isItemVisible(n)) return false;
      if (!q) return true;
      return `${n.name || ''} ${n.tag || ''}`.toLowerCase().includes(q);
    });

    // 이미 연결된 항목 → 이름순 정렬
    candidates.sort((a, b) => {
      const aLinked = findMatchingRelationForMode(item.id, a.id, reldbPickerMode) ? 0 : 1;
      const bLinked = findMatchingRelationForMode(item.id, b.id, reldbPickerMode) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });

    listEl.innerHTML = '';

    // 프로젝트·영역·리소스 피커에서 새 이름을 입력하면 즉시 선언(폴더 자동 생성) + 연결
    const rawSearch = String($('reldb-picker-search')?.value || '').trim();
    if (isParaMode && rawSearch) {
      const exactExists = candidates.some((n) => String(n.name || '').trim().toLowerCase() === rawSearch.toLowerCase());
      if (!exactExists) {
        const rootNameMap = { project: '🧭 1. 프로젝트', area: '🧭 2. 영역', resource: '🧭 3. 리소스' };
        const labelMap = { project: '🚀 프로젝트', area: '🧭 영역', resource: '📚 리소스' };
        const createRow = document.createElement('div');
        createRow.className = 'reldb-picker-create';
        createRow.innerHTML =
          `<span>✨ "${escapeHtml(rawSearch)}" ${labelMap[reldbPickerMode]} 선언 &amp; 바로 연결</span>` +
          `<span style="font-size:0.68rem; opacity:0.8;">${rootNameMap[reldbPickerMode]} 가상 트리</span>`;
        createRow.addEventListener('click', () => {
          saveStateForUndo();
          const created = declareParaEntity({ paraType: reldbPickerMode, name: rawSearch });
          if (created) {
            const label = String($('reldb-picker-label')?.value || '').trim();
            addRelation({ sourceId: item.id, targetId: created.id, type: reldbPickerMode, label });
            saveAndRender();
            renderDetailRelations(item);
            renderRelationsDbPanel();
            if ($('reldb-picker-search')) $('reldb-picker-search').value = '';
            renderInlineRelationPickerList();
            showToast(`${labelMap[reldbPickerMode]} "${created.name}" 선언 및 가상 연결 완료!`);
          }
        });
        listEl.appendChild(createRow);
      }
    }

    if (candidates.length === 0 && listEl.children.length === 0) {
      const labelMap = { project: '🚀 프로젝트', area: '🧭 영역', resource: '📚 리소스' };
      listEl.innerHTML = `<div class="reldb-empty-card-msg">${isParaMode ? `선언된 ${labelMap[reldbPickerMode]} 항목이 아직 없습니다.<br>위 검색창에 새 이름을 입력하면 바로 선언·연결됩니다.` : '연결할 수 있는 파일이 없습니다.'}</div>`;
      return;
    }

    candidates.slice(0, 80).forEach((node) => {
      const existingRel = findMatchingRelationForMode(item.id, node.id, reldbPickerMode);
      const isVirtualEnt = Boolean(node.isVirtual || node.type === 'para-entity');
      const pathNodes = isVirtualEnt ? [] : (getPathToNode(node.id) || []);
      const folderText = isVirtualEnt
        ? `🧭 PARA 가상 트리 (${node.tag || node.paraType})`
        : (pathNodes.length > 2 ? pathNodes.slice(1, -1).map((p) => p.name).join(' / ') : '💾 물리 보관소 루트');

      const row = document.createElement('div');
      row.className = `reldb-picker-row${existingRel ? ' linked' : ''}`;
      row.innerHTML =
        `<div class="reldb-picker-left">` +
        `  <span class="reldb-check">${existingRel ? '✓' : ''}</span>` +
        `  <span>${escapeHtml(node.icon || (node.type === 'folder' ? '📁' : '📄'))}</span>` +
        `  <div style="min-width:0; flex:1;">` +
        `    <div class="reldb-picker-name">${escapeHtml(node.name)}</div>` +
        `    <div class="reldb-picker-path">${escapeHtml(folderText)}</div>` +
        `  </div>` +
        `</div>` +
        `<span class="reldb-picker-state">${existingRel ? '연결됨' : '＋ 선택'}</span>`;

      row.addEventListener('click', () => {
        const curRel = findMatchingRelationForMode(item.id, node.id, reldbPickerMode);
        if (curRel) {
          if (removeRelation(curRel.id)) {
            scheduleDriveSync();
            renderDetailRelations(item);
            renderRelationsDbPanel();
            renderInlineRelationPickerList();
          }
          return;
        }
        const label = String($('reldb-picker-label')?.value || '').trim();
        let res = null;
        if (reldbPickerMode === 'project' || reldbPickerMode === 'area' || reldbPickerMode === 'resource') {
          res = addRelation({ sourceId: item.id, targetId: node.id, type: reldbPickerMode, label });
        } else if (reldbPickerMode === 'parent') {
          res = addRelation({ sourceId: node.id, targetId: item.id, type: 'parent', label });
        } else if (reldbPickerMode === 'child') {
          res = addRelation({ sourceId: item.id, targetId: node.id, type: 'parent', label });
        } else if (reldbPickerMode === 'reference') {
          res = addRelation({ sourceId: item.id, targetId: node.id, type: 'reference', label });
        } else {
          res = addRelation({ sourceId: item.id, targetId: node.id, type: 'related', label });
        }
        if (res) {
          scheduleDriveSync();
          triggerSbMirrorSync();
          renderDetailRelations(item);
          renderRelationsDbPanel();
          renderInlineRelationPickerList();
        }
      });

      listEl.appendChild(row);
    });
  }

  function openInlineRelationPicker(mode) {
    const item = state.selectedItem;
    const picker = $('reldb-inline-picker');
    if (!item || !picker || !RELDB_PROP_META[mode]) return;
    if (reldbPickerMode === mode && picker.style.display !== 'none') {
      closeInlineRelationPicker();
      return;
    }
    reldbPickerMode = mode;
    const titleEl = $('reldb-picker-title');
    if (titleEl) titleEl.textContent = `${RELDB_PROP_META[mode].pickerTitle} — ${item.name}`;
    if ($('reldb-picker-search')) $('reldb-picker-search').value = '';
    if ($('reldb-picker-label')) $('reldb-picker-label').value = '';
    picker.style.display = 'flex';
    renderInlineRelationPickerList();
    $('reldb-picker-search')?.focus();
  }

  function renderRelationsDbTable(validRels) {
    const bodyEl = $('reldb-table-body');
    if (!bodyEl) return;

    const q = String($('reldb-table-search')?.value || '').trim().toLowerCase();
    const unassignedNodes = getUnassignedNodes(isItemVisible);
    const unassignedBadge = $('reldb-unassigned-count');
    if (unassignedBadge) {
      unassignedBadge.textContent = unassignedNodes.length > 0 ? `(${unassignedNodes.length})` : '';
    }

    const filteredUnassigned = unassignedNodes.filter((n) => {
      if (!q) return true;
      return `${n.name || ''} ${n.tag || ''}`.toLowerCase().includes(q);
    });

    const mkUnassignedRow = (node) => {
      const row = document.createElement('div');
      row.className = 'reldb-table-row is-unassigned';

      const mainLine = document.createElement('div');
      mainLine.className = 'reldb-row-main';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reldb-node-btn';
      btn.title = `${node.name} — 클릭하여 이동 · 더블클릭하여 열기`;
      btn.textContent = `${node.icon || '📄'} ${node.name}`;
      btn.addEventListener('click', () => navigateToNode(node));
      btn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        launchItemDirectly(node);
      });

      const badge = document.createElement('span');
      badge.className = 'reldb-rel-badge type-unassigned';
      badge.textContent = '📥 미분류';

      mainLine.appendChild(btn);
      mainLine.appendChild(badge);

      const metaLine = document.createElement('div');
      metaLine.className = 'reldb-row-meta';
      const quickWrap = document.createElement('div');
      quickWrap.className = 'reldb-quick-assign';

      [
        { mode: 'project', label: '＋ 프로젝트' },
        { mode: 'area', label: '＋ 영역' },
        { mode: 'resource', label: '＋ 자료' }
      ].forEach(({ mode, label }) => {
        const qBtn = document.createElement('button');
        qBtn.type = 'button';
        qBtn.className = 'reldb-quick-btn';
        qBtn.textContent = label;
        qBtn.addEventListener('click', () => {
          navigateToNode(node);
          switchRightTab('relations');
          openInlineRelationPicker(mode);
        });
        quickWrap.appendChild(qBtn);
      });

      metaLine.appendChild(quickWrap);
      row.appendChild(mainLine);
      row.appendChild(metaLine);
      return row;
    };

    bodyEl.innerHTML = '';

    // 수신함(미분류) 전용 필터 뷰
    if (reldbFilterType === 'unassigned') {
      if (filteredUnassigned.length === 0) {
        bodyEl.innerHTML = `<div class="reldb-empty-card-msg">미분류 파일이 없습니다.</div>`;
        return;
      }
      filteredUnassigned.forEach((n) => bodyEl.appendChild(mkUnassignedRow(n)));
      return;
    }

    // 보관(Archives) 전용 필터 뷰
    if (reldbFilterType === 'archive') {
      const archivedEntities = getParaEntities('archive').filter((e) => {
        if (!q) return true;
        return `${e.name || ''} ${e.tag || ''}`.toLowerCase().includes(q);
      });
      if (archivedEntities.length === 0) {
        bodyEl.innerHTML = `<div class="reldb-empty-card-msg">보관된 PARA 항목이 없습니다. 상단 [＋ 보관] 또는 프로젝트 완료 시 여기에 보관됩니다.</div>`;
        return;
      }
      const pTypeLabel = { project: '프로젝트', area: '영역', resource: '자료' };
      archivedEntities.forEach((ent) => {
        const row = document.createElement('div');
        row.className = 'reldb-table-row';
        row.innerHTML =
          `<div class="reldb-row-main">` +
          `  <button type="button" class="reldb-node-btn" data-arch-open="1">${escapeHtml(ent.icon || '📦')} ${escapeHtml(ent.name)}</button>` +
          `  <span class="reldb-rel-badge type-archive">보관 · ${escapeHtml(pTypeLabel[ent.paraType] || '항목')}</span>` +
          `</div>` +
          `<div class="reldb-row-meta">` +
          `  <span>연결 ${getVirtualFilesForParaEntity(ent).length}건</span>` +
          `  <button type="button" class="reldb-quick-btn" data-arch-restore="1">↩️ 복원</button>` +
          `</div>`;
        row.querySelector('[data-arch-open]')?.addEventListener('click', () => {
          openParaVirtualView({ mode: 'entity', entityId: ent.id });
        });
        row.querySelector('[data-arch-restore]')?.addEventListener('click', () => {
          if (archiveParaEntity(ent.id, false)) {
            saveAndRender();
            if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
            showToast(`↩️ "${ent.name}"을(를) 활성 목록으로 복원했습니다.`);
          }
        });
        bodyEl.appendChild(row);
      });
      return;
    }

    const filtered = validRels.filter(({ rel, source, target }) => {
      if (reldbFilterType !== 'all' && rel.type !== reldbFilterType) return false;
      if (!q) return true;
      const hay = `${source.name || ''} ${target.name || ''} ${rel.label || ''}`.toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0 && !(reldbFilterType === 'all' && filteredUnassigned.length > 0)) {
      bodyEl.innerHTML = `<div class="reldb-empty-card-msg">${validRels.length === 0 ? '아직 등록된 연결 관계가 없습니다.<br>상단 <b>PARA 선언</b>으로 프로젝트·영역·자료·보관을 만든 뒤 연결해 보세요.' : '필터 조건에 맞는 연결이 없습니다.'}</div>`;
      return;
    }

    const typeInfo = {
      project: { text: '🚀 프로젝트', cls: 'type-project' },
      area: { text: '🧭 영역', cls: 'type-area' },
      resource: { text: '📚 자료', cls: 'type-resource' },
      archive: { text: '📦 보관', cls: 'type-archive' },
      parent: { text: '상위 → 하위', cls: 'type-parent' },
      related: { text: '↔ 일반연관', cls: 'type-related' },
      reference: { text: '📎 참조 →', cls: 'type-reference' }
    };

    filtered.forEach(({ rel, source, target }) => {
      const info = typeInfo[rel.type] || typeInfo.related;
      const row = document.createElement('div');
      row.className = 'reldb-table-row';

      const mainLine = document.createElement('div');
      mainLine.className = 'reldb-row-main';

      const mkNodeBtn = (node) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reldb-node-btn';
        btn.title = `${node.name} — 클릭하여 이동 · 더블클릭하여 열기`;
        btn.textContent = `${node.icon || (node.type === 'folder' ? '📁' : '📄')} ${node.name}`;
        btn.addEventListener('click', () => navigateToNode(node));
        btn.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          launchItemDirectly(node);
        });
        return btn;
      };

      const badge = document.createElement('span');
      badge.className = `reldb-rel-badge ${info.cls}`;
      badge.textContent = info.text;

      mainLine.appendChild(mkNodeBtn(source));
      mainLine.appendChild(badge);
      mainLine.appendChild(mkNodeBtn(target));

      const metaLine = document.createElement('div');
      metaLine.className = 'reldb-row-meta';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = rel.label ? `🏷️ ${rel.label}` : '라벨 없음';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'reldb-row-del';
      delBtn.title = '연결 삭제';
      delBtn.textContent = '✕ 삭제';
      delBtn.addEventListener('click', () => {
        if (removeRelation(rel.id)) {
          scheduleDriveSync();
          if (state.selectedItem) renderDetailRelations(state.selectedItem);
          renderRelationsDbPanel();
          if (reldbPickerMode) renderInlineRelationPickerList();
          showToast('연결 관계가 해제되었습니다.');
        }
      });

      metaLine.appendChild(labelSpan);
      metaLine.appendChild(delBtn);

      row.appendChild(mainLine);
      row.appendChild(metaLine);
      bodyEl.appendChild(row);
    });

    // '전체' 필터에서는 하단에 ⚠️ 지정필요 미분류 파일도 함께 분류 표시
    if (reldbFilterType === 'all' && filteredUnassigned.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText = 'font-size:0.72rem; font-weight:700; color:#e11d48; margin:8px 2px 2px;';
      divider.textContent = `⚠️ 지정필요 · 미분류 파일 (${filteredUnassigned.length})`;
      bodyEl.appendChild(divider);
      filteredUnassigned.forEach((n) => bodyEl.appendChild(mkUnassignedRow(n)));
    }
  }

  function renderRelationsDbPanel() {
    const validRels = [];
    (state.relations || []).forEach((rel) => {
      const s = resolveAnyNode(rel.sourceId);
      const t = resolveAnyNode(rel.targetId);
      if (s && t && isItemVisible(s) && isItemVisible(t)) {
        validRels.push({ rel, source: s, target: t });
      }
    });
    renderParaTree();

    const tabBadge = $('relations-tab-badge');
    if (tabBadge) {
      if (validRels.length > 0) {
        tabBadge.textContent = String(validRels.length);
        tabBadge.style.display = 'inline-flex';
      } else {
        tabBadge.style.display = 'none';
      }
    }

    const titleEl = $('reldb-current-title');
    const propsEl = $('reldb-props-body');
    if (!titleEl || !propsEl) return;

    const item = state.selectedItem;
    if (!item || item.id === 'root') {
      titleEl.textContent = '파일을 선택해 PARA 관계를 지정하세요';
      propsEl.innerHTML = `<div class="reldb-empty-card-msg">중앙 탐색기에서 파일이나 폴더를 클릭하면 <b>🚀 프로젝트 · 🧭 영역 · 📚 리소스</b> 및 상하 관계를 노션 DB처럼 지정할 수 있습니다.</div>`;
      closeInlineRelationPicker();
    } else {
      titleEl.textContent = `${item.icon || (item.type === 'folder' ? '📁' : '📄')} ${item.name}`;
      const rels = getRelationsForNode(item.id);
      const propRows = [
        { mode: 'project', label: '🚀 프로젝트', items: rels.projects || [], cls: 'rel-project', canAdd: true },
        { mode: 'area', label: '🧭 영역', items: rels.areas || [], cls: 'rel-area', canAdd: true },
        { mode: 'resource', label: '📚 리소스', items: rels.resources || [], cls: 'rel-resource', canAdd: true },
        { mode: 'parent', label: '⬆️ 상위', items: rels.parents || [], cls: 'rel-parent', canAdd: true },
        { mode: 'child', label: '⬇️ 하위', items: rels.children || [], cls: 'rel-child', canAdd: true }
      ];

      propsEl.innerHTML = '';

      // 자료형태 (T: 할일 / S: 자료 / R: 산출물) — SB 폴더 파일명 규칙(P-01-T-파일명)에 자동 반영
      if (item.type === 'doc') {
        const roleRow = document.createElement('div');
        roleRow.className = 'reldb-prop-row';
        const curRole = window.BrainStore.getCardRole(item);
        roleRow.innerHTML =
          `<div class="reldb-prop-key">🏷️ 자료형태</div>` +
          `<div class="reldb-prop-val sb-reldb-role-btns">` +
          `  <button type="button" class="reldb-quick-btn${curRole === 'T' ? ' active' : ''}" data-set-role="T">T 할일</button>` +
          `  <button type="button" class="reldb-quick-btn${curRole === 'S' ? ' active' : ''}" data-set-role="S">S 자료</button>` +
          `  <button type="button" class="reldb-quick-btn${curRole === 'R' ? ' active' : ''}" data-set-role="R">R 산출물</button>` +
          `</div>`;
        roleRow.querySelectorAll('[data-set-role]').forEach((rb) => {
          rb.addEventListener('click', () => {
            window.BrainStore.setCardRole(item, rb.dataset.setRole);
            saveAndRender();
            showToast(`자료형태가 ${rb.dataset.setRole}로 변경되었습니다. (SB 폴더명 자동 동기화)`);
          });
        });
        propsEl.appendChild(roleRow);
      }

      propRows.forEach((rowDef) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'reldb-prop-row';

        const keyEl = document.createElement('div');
        keyEl.className = 'reldb-prop-key';
        keyEl.textContent = rowDef.label;

        const valEl = document.createElement('div');
        valEl.className = 'reldb-prop-val';

        rowDef.items.forEach(({ rel, node }) => {
          const chip = document.createElement('span');
          chip.className = `relation-chip ${rowDef.cls}`;
          chip.title = `${node.name}${rel.label ? ` (${rel.label})` : ''} — 클릭하여 이동 · 더블클릭하여 열기`;
          chip.innerHTML =
            `<span>${escapeHtml(node.icon || (node.type === 'folder' ? '📁' : '📄'))} ${escapeHtml(node.name)}</span>` +
            (rel.label ? `<span class="relation-chip-label">· ${escapeHtml(rel.label)}</span>` : '') +
            `<button type="button" class="relation-chip-del" title="연결 해제">✕</button>`;

          chip.addEventListener('click', () => navigateToNode(node));
          chip.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            launchItemDirectly(node);
          });
          chip.querySelector('.relation-chip-del').addEventListener('click', (e) => {
            e.stopPropagation();
            if (removeRelation(rel.id)) {
              scheduleDriveSync();
              triggerSbMirrorSync();
              renderDetailRelations(item);
              renderRelationsDbPanel();
              if (reldbPickerMode) renderInlineRelationPickerList();
              showToast('연결 관계가 해제되었습니다.');
            }
          });
          valEl.appendChild(chip);
        });

        if (rowDef.canAdd) {
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'reldb-add-btn';
          addBtn.textContent = '＋ 추가';
          addBtn.addEventListener('click', () => openInlineRelationPicker(rowDef.mode));
          valEl.appendChild(addBtn);
        }

        rowEl.appendChild(keyEl);
        rowEl.appendChild(valEl);
        propsEl.appendChild(rowEl);
      });
    }

    renderRelationsDbTable(validRels);
  }

  $('btn-reldb-open-map')?.addEventListener('click', openRelationMapWindow);
  $('btn-reldb-close-picker')?.addEventListener('click', closeInlineRelationPicker);
  $('reldb-picker-search')?.addEventListener('input', () => renderInlineRelationPickerList());
  $('reldb-table-search')?.addEventListener('input', () => renderRelationsDbPanel());
  $('reldb-filter-pills')?.querySelectorAll('.reldb-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      reldbFilterType = btn.dataset.filter || 'all';
      $('reldb-filter-pills').querySelectorAll('.reldb-pill').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderRelationsDbPanel();
    });
  });

  // PARA Quick-Declare Bar (프로젝트 · 영역 · 리소스 선언 → 해당 기본 폴더에 자동 폴더 생성)
  let pendingDeclareType = null;
  const elDeclareForm = $('reldb-declare-form');
  const elDeclareInput = $('reldb-declare-input');

  function openDeclareForm(paraType) {
    pendingDeclareType = paraType;
    const phMap = {
      project: '새 프로젝트 이름 (PARA 트리에 추가)...',
      area: '새 영역 이름 (PARA 트리에 추가)...',
      resource: '새 자료 이름 (PARA 트리에 추가)...',
      archive: '새 보관 항목 이름 (보관함에 추가)...'
    };
    if (elDeclareInput) {
      elDeclareInput.value = '';
      elDeclareInput.placeholder = phMap[paraType] || '이름 입력...';
    }
    if (elDeclareForm) elDeclareForm.style.display = 'flex';
    elDeclareInput?.focus();
  }

  function closeDeclareForm() {
    pendingDeclareType = null;
    if (elDeclareForm) elDeclareForm.style.display = 'none';
    if (elDeclareInput) elDeclareInput.value = '';
  }

  function commitDeclareForm() {
    if (!pendingDeclareType || !elDeclareInput) return;
    const name = elDeclareInput.value.trim();
    if (!name) {
      elDeclareInput.focus();
      return;
    }
    saveStateForUndo();
    const created = declareParaEntity({ paraType: pendingDeclareType, name });
    if (created) {
      const rootNameMap = { project: '1. 프로젝트', area: '2. 영역', resource: '3. 자료', archive: '4. 보관' };
      const iconMap = { project: '🚀', area: '🧭', resource: '📚', archive: '📦' };
      // 현재 파일이 선택된 상태라면 방금 선언한 PARA 항목과 연결
      if (state.selectedItem && state.selectedItem.id !== 'root' && state.selectedItem.id !== created.id) {
        addRelation({ sourceId: state.selectedItem.id, targetId: created.id, type: pendingDeclareType === 'archive' ? created.paraType : pendingDeclareType, label: '' });
      }
      saveAndRender();
      if (state.selectedItem) renderDetailRelations(state.selectedItem);
      renderRelationsDbPanel();
      if (typeof refreshHomeDashboard === 'function') refreshHomeDashboard();
      showToast(`${iconMap[pendingDeclareType]} "${created.name}" 추가 완료! (${rootNameMap[pendingDeclareType]})`);
      closeDeclareForm();
    }
  }

  $('btn-declare-project')?.addEventListener('click', () => openDeclareForm('project'));
  $('btn-declare-area')?.addEventListener('click', () => openDeclareForm('area'));
  $('btn-declare-resource')?.addEventListener('click', () => openDeclareForm('resource'));
  $('btn-declare-archive')?.addEventListener('click', () => openDeclareForm('archive'));
  $('btn-declare-confirm')?.addEventListener('click', commitDeclareForm);
  $('btn-declare-cancel')?.addEventListener('click', closeDeclareForm);
  elDeclareInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDeclareForm();
    } else if (e.key === 'Escape') {
      closeDeclareForm();
    }
  });

  // 시각적 관계 맵 OS 창 (Obsidian 스타일 열매 방사형 그래프)
  function openRelationMapWindow() {
    const winId = 'app-relation-map';
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'relmap-wrap';
    wrap.innerHTML =
      `<div class="relmap-toolbar">` +
      `  <div class="relmap-toolbar-group">` +
      `    <div class="relmap-mode-pills" data-role="mode">` +
      `      <button type="button" class="relmap-pill active" data-mode="fruit">🍇 열매 방사형</button>` +
      `      <button type="button" class="relmap-pill" data-mode="obsidian">🕸️ 전체 옵시디언</button>` +
      `    </div>` +
      `    <div class="relmap-mode-pills" data-role="cat">` +
      `      <button type="button" class="relmap-pill active" data-cat="all">전체</button>` +
      `      <button type="button" class="relmap-pill" data-cat="project">🚀 프로젝트</button>` +
      `      <button type="button" class="relmap-pill" data-cat="area">🧭 영역</button>` +
      `      <button type="button" class="relmap-pill" data-cat="resource">📚 리소스</button>` +
      `      <button type="button" class="relmap-pill" data-cat="unassigned">⚠️ 미분류</button>` +
      `      <button type="button" class="relmap-pill" data-cat="parent">⬆️ 상하</button>` +
      `    </div>` +
      `  </div>` +
      `  <div class="relmap-toolbar-group">` +
      `    <input type="text" class="relmap-search" placeholder="🔍 노드 검색..." autocomplete="off">` +
      `    <button type="button" class="relmap-action-btn" data-act="collapse" title="열매 허브만 남기고 접기">🌱 접기</button>` +
      `    <button type="button" class="relmap-action-btn" data-act="expand-all" title="연결된 모든 열매 펼치기">🌸 전체 펼치기</button>` +
      `    <button type="button" class="relmap-action-btn" data-act="reset" title="화면 중앙 정렬">🎯 중앙</button>` +
      `    <button type="button" class="relmap-action-btn" data-act="refresh" title="관계 데이터 새로고침">🔄</button>` +
      `  </div>` +
      `</div>` +
      `<div class="relmap-stage">` +
      `  <canvas class="relmap-canvas-el"></canvas>` +
      `  <div class="relmap-hud-hint">클릭: 열매 방사형 펼치기/접기 · 더블클릭: 파일 열기 · 드래그: 이동 · 휠: 확대/축소</div>` +
      `  <div class="relmap-inspector" style="display:none;">` +
      `    <div class="relmap-insp-info">` +
      `      <span class="relmap-insp-title"></span>` +
      `      <span class="relmap-insp-sub"></span>` +
      `    </div>` +
      `    <div class="relmap-insp-actions">` +
      `      <button type="button" class="relmap-action-btn" data-insp="navigate">📂 이동</button>` +
      `      <button type="button" class="relmap-action-btn" data-insp="open">🚀 열기</button>` +
      `      <button type="button" class="relmap-action-btn" data-insp="link">🔗 관계 추가</button>` +
      `    </div>` +
      `  </div>` +
      `</div>`;

    const stage = wrap.querySelector('.relmap-stage');
    const canvas = wrap.querySelector('.relmap-canvas-el');
    const ctx = canvas.getContext('2d');
    const searchInput = wrap.querySelector('.relmap-search');
    const inspector = wrap.querySelector('.relmap-inspector');
    const inspTitle = wrap.querySelector('.relmap-insp-title');
    const inspSub = wrap.querySelector('.relmap-insp-sub');

    const HUB_DEFS = [
      { id: 'hub:project', type: 'project', icon: '🚀', name: '프로젝트', color: '#818cf8', glow: 'rgba(129,140,248,0.42)' },
      { id: 'hub:area', type: 'area', icon: '🧭', name: '영역', color: '#34d399', glow: 'rgba(52,211,153,0.40)' },
      { id: 'hub:resource', type: 'resource', icon: '📚', name: '리소스', color: '#fbbf24', glow: 'rgba(251,191,36,0.40)' },
      { id: 'hub:unassigned', type: 'unassigned', icon: '⚠️', name: '미분류', color: '#fb7185', glow: 'rgba(251,113,133,0.42)' }
    ];

    const EDGE_COLORS = {
      project: '#818cf8',
      area: '#34d399',
      resource: '#fbbf24',
      unassigned: '#fb7185',
      parent: '#c084fc',
      related: '#38bdf8',
      reference: '#fb923c'
    };

    let viewMode = 'fruit'; // 'fruit' | 'obsidian'
    let catFilter = 'all';  // 'all' | 'project' | 'area' | 'resource' | 'parent'
    let searchText = '';
    let expandedIds = new Set(); // 현재 방사형으로 펼쳐진 허브/노드 ID
    let cam = { x: 0, y: 0, zoom: 1 };
    let hoveredId = null;
    let selectedId = null;
    let dragNodeId = null;
    let isPanning = false;
    let pointerDownPos = { x: 0, y: 0 };
    let pointerMoved = false;
    let lastPanPos = { x: 0, y: 0 };
    let rafId = 0;

    // 그래프 물리/렌더 노드 상태 (위치 보존하여 부드러운 스프링 애니메이션)
    const nodeState = new Map(); // id -> { id, isHub, hubType, icon, name, color, glow, r, x, y, tx, ty, scale, alpha, pinned, fsNode, parentId, hiddenCount }
    let visibleNodeIds = new Set();
    let visibleEdges = []; // { from, to, type, label, isHubEdge }
    let allValidRels = [];
    let adjMap = new Map(); // nodeId -> Array<{ neighborId, rel }>
    let hubMembers = { project: [], area: [], resource: [], unassigned: [] };

    function getFilteredRels() {
      if (catFilter === 'unassigned') return [];
      const valid = (state.relations || []).filter((r) => {
        const s = resolveAnyNode(r.sourceId);
        const t = resolveAnyNode(r.targetId);
        if (!s || !t || !isItemVisible(s) || !isItemVisible(t)) return false;
        if (catFilter !== 'all' && r.type !== catFilter) return false;
        return true;
      });
      return valid;
    }

    function getPrimaryColorForNode(nodeId) {
      if ((hubMembers.unassigned || []).includes(nodeId)) {
        return { color: '#fb7185', glow: 'rgba(251,113,133,0.36)' };
      }
      const links = adjMap.get(nodeId) || [];
      if (links.some((l) => l.rel.type === 'project')) return { color: '#818cf8', glow: 'rgba(129,140,248,0.36)' };
      if (links.some((l) => l.rel.type === 'area')) return { color: '#34d399', glow: 'rgba(52,211,153,0.34)' };
      if (links.some((l) => l.rel.type === 'resource')) return { color: '#fbbf24', glow: 'rgba(251,191,36,0.34)' };
      if (links.some((l) => l.rel.type === 'parent')) return { color: '#c084fc', glow: 'rgba(192,132,252,0.34)' };
      return { color: '#38bdf8', glow: 'rgba(56,189,248,0.34)' };
    }

    function rebuildGraphData(spawnFromId = null) {
      allValidRels = getFilteredRels();
      adjMap = new Map();
      const memberSets = { project: new Set(), area: new Set(), resource: new Set(), unassigned: new Set() };

      const pushAdj = (aId, bId, relObj) => {
        if (!aId || !bId || aId === bId) return;
        if (!adjMap.has(aId)) adjMap.set(aId, []);
        if (!adjMap.has(bId)) adjMap.set(bId, []);
        if (!adjMap.get(aId).some((x) => x.neighborId === bId && x.rel.type === relObj.type)) {
          adjMap.get(aId).push({ neighborId: bId, rel: relObj });
        }
        if (!adjMap.get(bId).some((x) => x.neighborId === aId && x.rel.type === relObj.type)) {
          adjMap.get(bId).push({ neighborId: aId, rel: relObj });
        }
      };

      // 1) 프로젝트 · 영역 · 리소스 허브 하위에는 PARA로 선언된 엔티티 폴더만 직접 연결
      ['project', 'area', 'resource'].forEach((pType) => {
        if (catFilter !== 'all' && catFilter !== pType) return;
        const entities = getParaEntities(pType).filter((n) => isItemVisible(n));
        entities.forEach((ent) => {
          memberSets[pType].add(ent.id);
          // 선언된 프로젝트/영역/리소스 폴더 안의 자식 파일·폴더는 해당 엔티티를 눌렀을 때 2차 방사형으로 펼쳐짐
          if (Array.isArray(ent.children)) {
            ent.children.forEach((child) => {
              if (child && isItemVisible(child)) {
                pushAdj(ent.id, child.id, { id: `folder:${ent.id}:${child.id}`, sourceId: ent.id, targetId: child.id, type: pType, label: '' });
              }
            });
          }
        });
      });

      // 2) 미분류(지정필요) 허브에는 PARA에 아직 연결/배치되지 않은 파일들을 표시
      if (catFilter === 'all' || catFilter === 'unassigned') {
        getUnassignedNodes(isItemVisible).forEach((n) => {
          memberSets.unassigned.add(n.id);
        });
      }

      // 3) DB에 저장된 명시적 연결 관계는 각 엔티티/파일 간 2차·3차 연쇄 연결로만 반영 (허브에 일반 파일을 직접 붙이지 않음)
      allValidRels.forEach((rel) => {
        pushAdj(rel.sourceId, rel.targetId, rel);
      });

      hubMembers = {
        project: Array.from(memberSets.project),
        area: Array.from(memberSets.area),
        resource: Array.from(memberSets.resource),
        unassigned: Array.from(memberSets.unassigned)
      };

      const nextVisible = new Set();
      const nextEdges = [];
      const edgeKeySet = new Set();

      const addEdgeUnique = (from, to, type, label, isHubEdge = false) => {
        const key = isHubEdge ? `h:${from}->${to}` : `${type}:${[from, to].sort().join('::')}`;
        if (edgeKeySet.has(key)) return;
        edgeKeySet.add(key);
        nextEdges.push({ from, to, type, label: label || '', isHubEdge });
      };

      const ensureFileNode = (id, parentId, tx, ty) => {
        const fsNode = resolveAnyNode(id);
        if (!fsNode) return null;
        const deg = (adjMap.get(id) || []).length;
        const palette = getPrimaryColorForNode(id);
        const radius = Math.min(25, 16 + Math.min(6, deg) * 1.4);
        let st = nodeState.get(id);
        if (!st) {
          const spawnParent = (spawnFromId && nodeState.get(spawnFromId)) || (parentId && nodeState.get(parentId));
          const sx = spawnParent ? spawnParent.x : 0;
          const sy = spawnParent ? spawnParent.y : 0;
          st = {
            id,
            isHub: false,
            icon: fsNode.icon || (fsNode.type === 'folder' ? '📁' : '📄'),
            name: fsNode.name,
            color: palette.color,
            glow: palette.glow,
            r: radius,
            x: sx,
            y: sy,
            tx,
            ty,
            scale: 0.15,
            alpha: 0,
            pinned: false,
            fsNode,
            parentId,
            hiddenCount: 0
          };
          nodeState.set(id, st);
        } else {
          st.icon = fsNode.icon || (fsNode.type === 'folder' ? '📁' : '📄');
          st.name = fsNode.name;
          st.color = palette.color;
          st.glow = palette.glow;
          st.r = radius;
          st.fsNode = fsNode;
          if (!st.pinned) {
            st.tx = tx;
            st.ty = ty;
          }
        }
        nextVisible.add(id);
        return st;
      };

      if (viewMode === 'fruit') {
        // 1. 3개 PARA 열매 허브 배치 (필터에 맞게 표시)
        const activeHubs = HUB_DEFS.filter((h) => catFilter === 'all' || catFilter === h.type);
        const hubSpread = activeHubs.length === 1 ? 0 : 128;

        activeHubs.forEach((h, idx) => {
          const angle = activeHubs.length === 1 ? 0 : -Math.PI / 2 + (idx * 2 * Math.PI) / activeHubs.length;
          const hx = Math.cos(angle) * hubSpread;
          const hy = Math.sin(angle) * hubSpread;
          let st = nodeState.get(h.id);
          if (!st) {
            st = {
              id: h.id,
              isHub: true,
              hubType: h.type,
              icon: h.icon,
              name: h.name,
              color: h.color,
              glow: h.glow,
              r: 34,
              x: hx,
              y: hy,
              tx: hx,
              ty: hy,
              scale: 0.4,
              alpha: 0,
              pinned: false,
              fsNode: null,
              parentId: null,
              hiddenCount: 0
            };
            nodeState.set(h.id, st);
          } else if (!st.pinned) {
            st.tx = hx;
            st.ty = hy;
          }
          nextVisible.add(h.id);
        });

        // 상하(parent) 필터 전용일 때는 루트 노드들을 초기 열매로 노출
        if (catFilter === 'parent') {
          const allIds = Array.from(adjMap.keys());
          const radius = Math.max(110, allIds.length * 16);
          allIds.forEach((nid, idx) => {
            const ang = (idx * 2 * Math.PI) / Math.max(1, allIds.length) - Math.PI / 2;
            ensureFileNode(nid, null, Math.cos(ang) * radius, Math.sin(ang) * radius);
          });
        }

        // 2. 펼쳐진 허브 → 1차 방사형 열매 펼치기
        activeHubs.forEach((h) => {
          if (!expandedIds.has(h.id)) return;
          const hubSt = nodeState.get(h.id);
          const members = hubMembers[h.type] || [];
          const count = members.length;
          const ringR = Math.max(145, Math.min(240, 115 + count * 13));
          const baseAng = activeHubs.length > 1 ? Math.atan2(hubSt.ty, hubSt.tx) : -Math.PI / 2;
          const arcSpan = activeHubs.length > 1 ? Math.min(Math.PI * 1.55, Math.max(Math.PI * 0.85, count * 0.42)) : Math.PI * 2;

          members.forEach((mid, i) => {
            const ang = activeHubs.length > 1
              ? baseAng - arcSpan / 2 + (count === 1 ? arcSpan / 2 : (i * arcSpan) / (count - 1))
              : (i * 2 * Math.PI) / Math.max(1, count) - Math.PI / 2;
            const tx = hubSt.tx + Math.cos(ang) * ringR;
            const ty = hubSt.ty + Math.sin(ang) * ringR;
            ensureFileNode(mid, h.id, tx, ty);
            addEdgeUnique(h.id, mid, h.type, '', true);
          });
        });

        // 3. 펼쳐진 파일/폴더 노드 → 2차·3차 연쇄 방사형 펼치기 (BFS)
        const queue = Array.from(expandedIds).filter((id) => !id.startsWith('hub:') && nextVisible.has(id));
        const visitedExpand = new Set(queue);
        let guard = 0;
        while (queue.length > 0 && guard < 120) {
          guard++;
          const curId = queue.shift();
          const curSt = nodeState.get(curId);
          if (!curSt) continue;
          const neighbors = adjMap.get(curId) || [];
          const fresh = [];
          neighbors.forEach(({ neighborId, rel }) => {
            if (!nextVisible.has(neighborId)) {
              fresh.push({ neighborId, rel });
            }
          });

          const parentSt = curSt.parentId ? nodeState.get(curSt.parentId) : null;
          const outAngle = parentSt ? Math.atan2(curSt.ty - parentSt.ty, curSt.tx - parentSt.tx) : Math.atan2(curSt.ty, curSt.tx);
          const count = fresh.length;
          const ringR = Math.max(125, Math.min(200, 105 + count * 11));
          const span = Math.min(Math.PI * 1.45, Math.max(Math.PI * 0.65, count * 0.48));

          fresh.forEach(({ neighborId }, idx) => {
            const ang = count === 1
              ? outAngle
              : outAngle - span / 2 + (idx * span) / (count - 1);
            const tx = curSt.tx + Math.cos(ang) * ringR;
            const ty = curSt.ty + Math.sin(ang) * ringR;
            ensureFileNode(neighborId, curId, tx, ty);
            if (expandedIds.has(neighborId) && !visitedExpand.has(neighborId)) {
              visitedExpand.add(neighborId);
              queue.push(neighborId);
            }
          });
        }

        // 4. 현재 화면에 떠 있는 노드들 사이의 모든 DB 관계 및 선언 폴더-하위파일 엣지 연결
        adjMap.forEach((links, nodeId) => {
          if (!nextVisible.has(nodeId)) return;
          links.forEach(({ neighborId, rel }) => {
            if (nextVisible.has(neighborId)) {
              addEdgeUnique(rel.sourceId, rel.targetId, rel.type, rel.label, false);
            }
          });
        });
      } else {
        // 전체 옵시디언 모드: 선언된 PARA 엔티티 + 미분류 파일 + 연결된 모든 노드를 방사형 별자리로 배치
        const allIdSet = new Set(adjMap.keys());
        ['project', 'area', 'resource', 'unassigned'].forEach((pType) => {
          (hubMembers[pType] || []).forEach((id) => allIdSet.add(id));
        });
        const allIds = Array.from(allIdSet);
        // 연결 수(degree) 높은 허브 노드를 안쪽 링에 배치
        allIds.sort((a, b) => (adjMap.get(b)?.length || 0) - (adjMap.get(a)?.length || 0));
        allIds.forEach((nid, idx) => {
          const ring = idx === 0 && allIds.length > 4 ? 0 : (idx < 7 ? 1 : (idx < 20 ? 2 : 3));
          const ringR = ring === 0 ? 0 : ring === 1 ? 140 : ring === 2 ? 255 : 365;
          const ang = idx * 2.3999632; // 황금각 방사형 분포
          ensureFileNode(nid, null, Math.cos(ang) * ringR, Math.sin(ang) * ringR);
        });
        adjMap.forEach((links, nodeId) => {
          if (!nextVisible.has(nodeId)) return;
          links.forEach(({ neighborId, rel }) => {
            if (nextVisible.has(neighborId)) {
              addEdgeUnique(rel.sourceId, rel.targetId, rel.type, rel.label, false);
            }
          });
        });
      }

      // 5. 각 노드의 미펼침(숨겨진) 연결 개수 계산 (+N 열매 배지용)
      nextVisible.forEach((id) => {
        const st = nodeState.get(id);
        if (!st) return;
        if (st.isHub) {
          const members = hubMembers[st.hubType] || [];
          st.hiddenCount = expandedIds.has(id) ? 0 : members.length;
        } else {
          const neighbors = adjMap.get(id) || [];
          const uniqHidden = new Set();
          neighbors.forEach(({ neighborId }) => {
            if (!nextVisible.has(neighborId)) uniqHidden.add(neighborId);
          });
          st.hiddenCount = uniqHidden.size;
        }
      });

      // 사라진 노드는 상태 정리
      Array.from(nodeState.keys()).forEach((id) => {
        if (!nextVisible.has(id)) nodeState.delete(id);
      });

      visibleNodeIds = nextVisible;
      visibleEdges = nextEdges;
      updateInspector();
    }

    function updateInspector() {
      if (!selectedId || selectedId.startsWith('hub:') || !nodeState.has(selectedId)) {
        inspector.style.display = 'none';
        return;
      }
      const st = nodeState.get(selectedId);
      if (!st || !st.fsNode) {
        inspector.style.display = 'none';
        return;
      }
      const rels = getRelationsForNode(st.fsNode.id);
      const pCnt = (rels.projects || []).length;
      const aCnt = (rels.areas || []).length;
      const rCnt = (rels.resources || []).length;
      const hCnt = (rels.parents || []).length + (rels.children || []).length;
      inspTitle.textContent = `${st.icon} ${st.name}`;
      inspSub.textContent = `🚀 프로젝트 ${pCnt} · 🧭 영역 ${aCnt} · 📚 리소스 ${rCnt}` + (hCnt ? ` · ⬆️⬇️ 상하 ${hCnt}` : '');
      inspector.style.display = 'flex';
    }

    function screenToWorld(sx, sy) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (sx - rect.width / 2 - cam.x) / cam.zoom,
        y: (sy - rect.height / 2 - cam.y) / cam.zoom
      };
    }

    function hitTestNode(wx, wy) {
      const ids = Array.from(visibleNodeIds).reverse();
      for (const id of ids) {
        const st = nodeState.get(id);
        if (!st) continue;
        const dx = wx - st.x;
        const dy = wy - st.y;
        const hitR = st.r + 7;
        if (dx * dx + dy * dy <= hitR * hitR) return st;
      }
      return null;
    }

    function resizeCanvas() {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }

    function stepPhysics() {
      const arr = Array.from(visibleNodeIds).map((id) => nodeState.get(id)).filter(Boolean);
      // 1. 부드러운 타겟 스프링 이동
      for (const n of arr) {
        n.scale += (1 - n.scale) * 0.16;
        n.alpha += (1 - n.alpha) * 0.16;
        if (n.id === dragNodeId || n.pinned) continue;
        n.x += (n.tx - n.x) * 0.13;
        n.y += (n.ty - n.y) * 0.13;
      }
      // 2. 가벼운 노드 간 반발력 (겹침 방지)
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = a.r + b.r + 42;
          if (dist < minDist) {
            const push = (minDist - dist) * 0.045;
            const ux = dx / dist;
            const uy = dy / dist;
            if (!a.pinned && a.id !== dragNodeId && !a.isHub) {
              a.x -= ux * push;
              a.y -= uy * push;
              a.tx -= ux * push * 0.4;
              a.ty -= uy * push * 0.4;
            }
            if (!b.pinned && b.id !== dragNodeId && !b.isHub) {
              b.x += ux * push;
              b.y += uy * push;
              b.tx += ux * push * 0.4;
              b.ty += uy * push * 0.4;
            }
          }
        }
      }
    }

    function drawFrame() {
      if (!document.body.contains(wrap)) {
        cancelAnimationFrame(rafId);
        return;
      }
      const { w, h } = resizeCanvas();
      stepPhysics();

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const q = searchText.trim().toLowerCase();
      const focusId = hoveredId || selectedId;
      const connectedToFocus = new Set();
      if (focusId) {
        connectedToFocus.add(focusId);
        visibleEdges.forEach((e) => {
          if (e.from === focusId) connectedToFocus.add(e.to);
          if (e.to === focusId) connectedToFocus.add(e.from);
        });
      }

      // 1. Draw curved glowing edges
      visibleEdges.forEach((e) => {
        const a = nodeState.get(e.from);
        const b = nodeState.get(e.to);
        if (!a || !b) return;
        const isHi = !focusId || e.from === focusId || e.to === focusId;
        const col = EDGE_COLORS[e.type] || '#64748b';
        ctx.save();
        ctx.globalAlpha = Math.min(a.alpha, b.alpha) * (isHi ? (e.isHubEdge ? 0.55 : 0.78) : 0.14);
        ctx.strokeStyle = col;
        ctx.lineWidth = isHi ? (e.isHubEdge ? 2.2 : 1.9) : 1.1;
        if (e.type === 'related' || e.type === 'reference') {
          ctx.setLineDash([5, 4]);
        }

        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const curve = e.isHubEdge ? 0.08 : 0.12;
        const cx = mx - dy * curve;
        const cy = my + dx * curve;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();

        if (e.label && isHi && cam.zoom >= 0.7) {
          ctx.setLineDash([]);
          ctx.font = '600 10px Pretendard, system-ui, sans-serif';
          ctx.fillStyle = '#cbd5e1';
          ctx.textAlign = 'center';
          ctx.fillText(e.label, cx, cy - 4);
        }
        ctx.restore();
      });

      // 2. Draw nodes (Fruit Hubs & File Orbs)
      visibleNodeIds.forEach((id) => {
        const n = nodeState.get(id);
        if (!n) return;
        const isMatched = q ? n.name.toLowerCase().includes(q) : false;
        const isHi = (!focusId || connectedToFocus.has(id)) && (!q || isMatched);
        const isExpanded = expandedIds.has(id);
        const r = n.r * n.scale;

        ctx.save();
        ctx.globalAlpha = n.alpha * (isHi ? 1 : 0.22);

        // Outer Obsidian / Fruit Glow
        if (n.isHub || isExpanded || id === hoveredId || id === selectedId || isMatched) {
          const grad = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * (n.isHub ? 2.1 : 1.9));
          grad.addColorStop(0, n.glow);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * (n.isHub ? 2.1 : 1.9), 0, Math.PI * 2);
          ctx.fill();
        }

        // Main orb body
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.isHub ? '#111827' : '#0f172a';
        ctx.fill();

        // Colored rim
        ctx.lineWidth = id === selectedId || isMatched ? 3 : (n.isHub || isExpanded ? 2.4 : 1.6);
        ctx.strokeStyle = isMatched ? '#f43f5e' : n.color;
        ctx.stroke();

        // Inner icon
        ctx.font = `${n.isHub ? 20 : 14}px system-ui, "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(n.icon, n.x, n.y + 1);

        // Unexpanded fruit count badge (+N)
        if (n.hiddenCount > 0) {
          const bx = n.x + r * 0.76;
          const by = n.y - r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 10, 0, Math.PI * 2);
          ctx.fillStyle = n.color;
          ctx.fill();
          ctx.font = '800 9.5px Pretendard, system-ui, sans-serif';
          ctx.fillStyle = '#090d1a';
          ctx.fillText(`+${n.hiddenCount}`, bx, by + 0.5);
        } else if (isExpanded && viewMode === 'fruit') {
          // Expanded indicator dot
          const bx = n.x + r * 0.76;
          const by = n.y - r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }

        // Label below orb
        const shortName = n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name;
        const labelText = n.isHub ? `${shortName} (${(hubMembers[n.hubType] || []).length})` : shortName;
        ctx.font = `${n.isHub ? '700 12px' : '600 11px'} Pretendard, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(labelText).width;
        const lx = n.x;
        const ly = n.y + r + 6;
        ctx.fillStyle = 'rgba(9, 13, 26, 0.78)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(lx - tw / 2 - 6, ly - 2, tw + 12, 17, 6);
        } else {
          ctx.rect(lx - tw / 2 - 6, ly - 2, tw + 12, 17);
        }
        ctx.fill();
        ctx.fillStyle = isHi ? '#f8fafc' : '#94a3b8';
        ctx.fillText(labelText, lx, ly + 1);

        ctx.restore();
      });

      ctx.restore();
      rafId = requestAnimationFrame(drawFrame);
    }

    // Pointer Events (Click Bloom · Double-Click Open · Drag Node/Pan · Wheel Zoom)
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      pointerDownPos = { x: sx, y: sy };
      pointerMoved = false;
      const wPos = screenToWorld(sx, sy);
      const hit = hitTestNode(wPos.x, wPos.y);
      if (hit) {
        dragNodeId = hit.id;
        canvas.classList.add('dragging');
      } else {
        isPanning = true;
        lastPanPos = { x: e.clientX, y: e.clientY };
        canvas.classList.add('dragging');
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (Math.hypot(sx - pointerDownPos.x, sy - pointerDownPos.y) > 4) {
        pointerMoved = true;
      }
      if (dragNodeId) {
        const st = nodeState.get(dragNodeId);
        if (st) {
          const wPos = screenToWorld(sx, sy);
          st.x = wPos.x;
          st.y = wPos.y;
          st.tx = wPos.x;
          st.ty = wPos.y;
          st.pinned = true;
        }
        return;
      }
      if (isPanning) {
        cam.x += e.clientX - lastPanPos.x;
        cam.y += e.clientY - lastPanPos.y;
        lastPanPos = { x: e.clientX, y: e.clientY };
        return;
      }
      const wPos = screenToWorld(sx, sy);
      const hit = hitTestNode(wPos.x, wPos.y);
      hoveredId = hit ? hit.id : null;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    });

    const endDrag = (e) => {
      const wasDraggingNode = dragNodeId;
      dragNodeId = null;
      isPanning = false;
      canvas.classList.remove('dragging');
      if (pointerMoved) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wPos = screenToWorld(sx, sy);
      const hit = hitTestNode(wPos.x, wPos.y);

      if (!hit) {
        selectedId = null;
        updateInspector();
        return;
      }

      selectedId = hit.id;
      if (viewMode === 'fruit') {
        if (hit.isHub) {
          const members = hubMembers[hit.hubType] || [];
          if (members.length === 0) {
            showToast(`아직 ${hit.icon} ${hit.name} 연관으로 연결된 파일이 없습니다. 우측 [🗃️ 연결 DB] 탭에서 연결해 보세요.`);
            return;
          }
        }
        if (expandedIds.has(hit.id)) {
          expandedIds.delete(hit.id);
        } else {
          expandedIds.add(hit.id);
        }
        rebuildGraphData(hit.id);
      } else {
        updateInspector();
      }
    };

    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      dragNodeId = null;
      isPanning = false;
      hoveredId = null;
      canvas.classList.remove('dragging');
    });

    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect();
      const wPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const hit = hitTestNode(wPos.x, wPos.y);
      if (hit && !hit.isHub && hit.fsNode) {
        launchItemDirectly(hit.fsNode);
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextZoom = Math.max(0.35, Math.min(2.4, cam.zoom * factor));
      const ratio = nextZoom / cam.zoom;
      cam.x = mx - (mx - cam.x) * ratio;
      cam.y = my - (my - cam.y) * ratio;
      cam.zoom = nextZoom;
    }, { passive: false });

    // Toolbar Controls
    wrap.querySelectorAll('[data-role="mode"] .relmap-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.mode || 'fruit';
        wrap.querySelectorAll('[data-role="mode"] .relmap-pill').forEach((b) => b.classList.toggle('active', b === btn));
        nodeState.clear();
        cam = { x: 0, y: 0, zoom: 1 };
        rebuildGraphData();
      });
    });

    wrap.querySelectorAll('[data-role="cat"] .relmap-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        catFilter = btn.dataset.cat || 'all';
        wrap.querySelectorAll('[data-role="cat"] .relmap-pill').forEach((b) => b.classList.toggle('active', b === btn));
        nodeState.clear();
        if (catFilter !== 'all' && catFilter !== 'parent') {
          expandedIds = new Set([`hub:${catFilter}`]);
        }
        cam = { x: 0, y: 0, zoom: 1 };
        rebuildGraphData();
      });
    });

    searchInput.addEventListener('input', (e) => {
      searchText = e.target.value || '';
      const q = searchText.trim().toLowerCase();
      if (!q) return;
      for (const id of visibleNodeIds) {
        const st = nodeState.get(id);
        if (st && st.name.toLowerCase().includes(q)) {
          cam.x = -st.x * cam.zoom;
          cam.y = -st.y * cam.zoom;
          break;
        }
      }
    });

    wrap.querySelector('[data-act="collapse"]').addEventListener('click', () => {
      expandedIds.clear();
      selectedId = null;
      rebuildGraphData();
    });

    wrap.querySelector('[data-act="expand-all"]').addEventListener('click', () => {
      HUB_DEFS.forEach((h) => expandedIds.add(h.id));
      allValidRels.forEach((r) => {
        expandedIds.add(r.sourceId);
        expandedIds.add(r.targetId);
      });
      rebuildGraphData();
    });

    wrap.querySelector('[data-act="reset"]').addEventListener('click', () => {
      cam = { x: 0, y: 0, zoom: 1 };
      nodeState.forEach((st) => { st.pinned = false; });
      rebuildGraphData();
    });

    wrap.querySelector('[data-act="refresh"]').addEventListener('click', () => {
      rebuildGraphData();
      showToast('관계 맵이 최신 DB 상태로 갱신되었습니다.');
    });

    wrap.querySelector('[data-insp="navigate"]').addEventListener('click', () => {
      const st = selectedId ? nodeState.get(selectedId) : null;
      if (st?.fsNode) navigateToNode(st.fsNode);
    });
    wrap.querySelector('[data-insp="open"]').addEventListener('click', () => {
      const st = selectedId ? nodeState.get(selectedId) : null;
      if (st?.fsNode) launchItemDirectly(st.fsNode);
    });
    wrap.querySelector('[data-insp="link"]').addEventListener('click', () => {
      const st = selectedId ? nodeState.get(selectedId) : null;
      if (st?.fsNode) openRelationModal(st.fsNode);
    });

    WinManager.openWindow({
      id: winId,
      title: 'PARA 관계 맵 (열매 방사형 · 옵시디언)',
      icon: '🕸️',
      meta: 'Radial Graph',
      width: 960,
      height: 640,
      contentEl: wrap
    });

    rebuildGraphData();
    rafId = requestAnimationFrame(drawFrame);
  }

  $('btn-open-relation-map')?.addEventListener('click', openRelationMapWindow);

  // ================= Smartphone / Launchpad Home Screen =================
  const elHomeScreen = $('home-screen');
  const elAppBody = $('app-body');
  const elBtnHomeMode = $('btn-home-mode');
  const elPinAppModal = $('pin-app-modal');

  function updateHomeClock() {
    const clockEl = $('home-clock');
    const dateEl = $('home-date');
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
    }
  }

  function getAppTileVisual(item) {
    const name = String(item?.name || '').toLowerCase();
    if (item.type === 'folder') return { icon: item.icon || '📁', grad: 'tile-grad-blue', badge: 'DIR' };
    if (/\.html?$/.test(name) || isHtmlContentItem(item)) return { icon: item.icon || '🌐', grad: 'tile-grad-cyan', badge: 'APP' };
    if (isSpreadsheetItem(item)) return { icon: item.icon || '📊', grad: 'tile-grad-emerald', badge: 'XLS' };
    if (/\.md$/.test(name)) return { icon: item.icon || '📝', grad: 'tile-grad-indigo', badge: 'MD' };
    if (/\.pdf$/.test(name)) return { icon: item.icon || '📕', grad: 'tile-grad-rose', badge: 'PDF' };
    if (/\.pptx?$/.test(name)) return { icon: item.icon || '📙', grad: 'tile-grad-amber', badge: 'PPT' };
    return { icon: item.icon || '📄', grad: 'tile-grad-slate', badge: '' };
  }

  function togglePinAppToHome(item) {
    if (!item || item.id === 'root') return;
    const idx = state.pinnedAppIds.indexOf(item.id);
    if (idx >= 0) {
      state.pinnedAppIds.splice(idx, 1);
      persistPinnedApps();
      scheduleDriveSync();
      renderHomePinnedApps();
      showToast(`📱 "${item.name}" 홈 화면 고정이 해제되었습니다.`);
    } else {
      state.pinnedAppIds.push(item.id);
      persistPinnedApps();
      scheduleDriveSync();
      renderHomePinnedApps();
      showToast(`📱 "${item.name}"이(가) 홈 화면 앱으로 등록되었습니다.`);
    }
  }

  function renderHomePinnedApps() {
    const grid = $('home-pinned-grid');
    if (!grid) return;

    const validPinned = [];
    const seen = new Set();
    state.pinnedAppIds = (state.pinnedAppIds || []).filter((id) => {
      const node = findNodeAndParent(id)?.node;
      if (node && isItemVisible(node) && !seen.has(id)) {
        seen.add(id);
        validPinned.push(node);
        return true;
      }
      return false;
    });

    grid.innerHTML = '';
    validPinned.forEach((item) => {
      const vis = getAppTileVisual(item);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'os-nav-subitem';
      row.title = item.name;
      row.innerHTML =
        `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(vis.icon)} ${escapeHtml(item.name.replace(/\.(html?|md|xlsx)$/i, ''))}</span>` +
        `<span class="para-entity-del" style="opacity:0.7;" title="고정 해제">✕</span>`;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.para-entity-del')) return;
        closeOsNavMenu();
        launchItemDirectly(item);
      });
      row.querySelector('.para-entity-del').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePinAppToHome(item);
      });
      grid.appendChild(row);
    });
  }

  function closeOsNavMenu() {
    const menu = $('os-nav-menu');
    if (menu) menu.style.display = 'none';
  }

  function launchBuiltinApp(app) {
    if (app === 'explorer') {
      setHomeMode(false);
    } else if (app === 'markdown') {
      createNew('doc');
    } else if (app === 'spreadsheet' || app === 'origin') {
      createNew('sheet');
    } else if (app === 'relation-map') {
      openRelationMapWindow();
    } else if (app === 'ai-chat') {
      setHomeMode(false);
      switchRightTab('chat');
    }
  }

  function openScheduleModal() {
    const modal = $('dfp-schedule-modal');
    if (!modal) return;
    if ($('dfp-sched-date') && !$('dfp-sched-date').value) $('dfp-sched-date').value = getTodayYMD();
    if ($('dfp-sched-time-once') && !$('dfp-sched-time-once').value) $('dfp-sched-time-once').value = '09:00';
    if ($('dfp-sched-time-rec') && !$('dfp-sched-time-rec').value) $('dfp-sched-time-rec').value = '09:00';
    updateScheduleReversePreview();
    renderScheduleModalList();
    modal.style.display = 'flex';
  }

  function openPinAppModal() {
    if ($('pin-app-search')) $('pin-app-search').value = '';
    renderPinAppPicker('');
    if (elPinAppModal) elPinAppModal.style.display = 'flex';
    $('pin-app-search')?.focus();
  }

  function ensureParaDashboardMounted() {
    if (paraDashboard || !window.BrainParaDashboard) return paraDashboard;
    paraDashboard = window.BrainParaDashboard.mountParaDashboard({
      loadDfpState,
      saveDfpState,
      getTodayYMD,
      getOrCreateDailyMemoFolder,
      getUniqueNameInFolder,
      isItemVisible,
      isSpreadsheetItem,
      computeNextScheduleInstance,
      formatHHMM,
      renderDfpTrafficLight,
      saveAndRender,
      showToast,
      setHomeMode,
      createNew,
      openScheduleModal,
      openSettingsModal,
      openPinAppModal,
      launchBuiltinApp,
      launchItemDirectly,
      navigateToNode,
      openParaVirtualView,
      openPhysicalFolder(folder) {
        clearSearch(false);
        setHomeMode(false);
        openFolder(folder);
      },
      syncDocAfterSave(doc) {
        if (!doc) return;
        touchNode(doc);
        scheduleDocFileSyncToDrive(doc, true);
        scheduleItemSyncToLocalFolder(doc, false, { allowAutoDownload: false });
      },
      getSidebarStatusText() {
        if (isGuestMode) {
          const lf = BrainLocalFolder?.getStatus();
          return lf?.connected ? `오프라인 · ${lf.folderName}` : '오프라인 게스트 모드';
        }
        if (BrainSecurity?.isVaultLocked()) return 'API 금고 잠김 · 해제하기';
        const configured = Object.keys(PROVIDERS).filter((id) => Boolean(state.settings.keys[id]?.trim()));
        if (configured.length === 0) return 'API 키를 설정해 주세요';
        return `AI 연결됨 · ${configured.map((id) => PROVIDERS[id].label).join(', ')}`;
      }
    });
    return paraDashboard;
  }

  function setHomeMode(enable) {
    isHomeMode = Boolean(enable);
    if (elHomeScreen) elHomeScreen.style.display = isHomeMode ? 'flex' : 'none';
    if (elAppBody) elAppBody.style.display = isHomeMode ? 'none' : 'flex';
    $('btn-mode-home')?.classList.toggle('active', isHomeMode);
    $('btn-mode-explorer')?.classList.toggle('active', !isHomeMode);
    document.querySelectorAll('#os-nav-menu .os-nav-item[data-nav]').forEach((btn) => {
      const nav = btn.dataset.nav;
      btn.classList.toggle('active', (nav === 'dashboard' && isHomeMode) || (nav === 'explorer' && !isHomeMode));
    });
    if (isHomeMode) {
      ensureParaDashboardMounted();
      updateHomeClock();
      renderHomePinnedApps();
      refreshHomeDashboard();
    }
  }

  // 좌측 상단 앱 드롭다운 메뉴 (대시보드 · 탐색기 · 앱)
  elBtnHomeMode?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMoreMenu();
    const menu = $('os-nav-menu');
    if (!menu) {
      setHomeMode(!isHomeMode);
      return;
    }
    const willOpen = menu.style.display === 'none';
    if (willOpen) {
      renderHomePinnedApps();
      menu.style.display = 'flex';
    } else {
      menu.style.display = 'none';
    }
  });

  $('os-nav-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const navBtn = e.target.closest('.os-nav-item[data-nav]');
    if (navBtn) {
      const target = navBtn.dataset.nav;
      if (target === 'dashboard') setHomeMode(true);
      else if (target === 'explorer') setHomeMode(false);
      closeOsNavMenu();
    }
  });

  $('btn-nav-apps-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = $('os-nav-apps-list');
    const arrow = $('nav-apps-arrow');
    if (!list) return;
    const hidden = list.style.display === 'none';
    list.style.display = hidden ? 'flex' : 'none';
    if (arrow) arrow.textContent = hidden ? '▾' : '▸';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#os-nav-dropdown-wrap')) {
      closeOsNavMenu();
    }
    if (!e.target.closest('#sb-more-wrap')) {
      closeMoreMenu();
    }
    if (!e.target.closest('#global-search-wrap')) {
      closeGlobalSearchPopover();
    }
    if (!e.target.closest('#dfp-composer-para-wrap')) {
      const pop = $('dfp-composer-para-popover');
      if (pop) pop.style.display = 'none';
    }
    if (!e.target.closest('.dfp-card-para-wrap')) {
      document.querySelectorAll('.dfp-card-para-popover').forEach((p) => { p.style.display = 'none'; });
    }
  });

  $('home-builtin-grid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.home-app-tile');
    if (!tile) return;
    closeOsNavMenu();
    launchBuiltinApp(tile.dataset.builtin);
  });

  // ================= Home Dashboard: Daily Focus Planner + Reverse Schedule + Daily MD Memo Bin =================
  let dfpSelectedMemoCat = 'todo'; // 'todo' | 'knowledge' | 'thinking'
  let dfpMemoScope = 'today';      // 'today' | 'all'
  let dfpActiveBinTab = 'all';     // 'all' | 'todo' | 'knowledge' | 'thinking' | 'unassigned'
  let dfpActiveTaskTab = 'backlog'; // 'backlog' | 'archive'
  let dfpSchedFormMode = 'once';   // 'once' | 'recurring'
  const dfpComposerParaSet = new Set(); // 다중 선택된 'type::entityId'

  function getTodayYMD(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getDfpStorageKey() {
    const email = String(getActiveUserEmail() || 'guest').trim().toLowerCase();
    return `brainOS_dfp_${encodeURIComponent(email)}`;
  }

  function loadDfpState() {
    const defaults = {
      top3: [], // [{ id, title, docId }]
      backlog: [], // [{ id, title, docId }]
      archive: [], // [{ id, title, completedAt, docId }]
      completedDates: {}, // { 'YYYY-MM-DD': count }
      schedules: [], // [{ id, type: 'once'|'recurring', date, weekdays, time, title, travelMins, prepMins, bufferMins, completedInstances: [] }]
      checklist: [
        { id: 'c1', text: '스마트폰·지갑', checked: false },
        { id: 'c2', text: '노트북·충전기', checked: false },
        { id: 'c3', text: '차키·교통카드', checked: false }
      ]
    };
    try {
      const raw = localStorage.getItem(getDfpStorageKey());
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        top3: Array.isArray(parsed.top3) ? parsed.top3 : [],
        backlog: Array.isArray(parsed.backlog) ? parsed.backlog : [],
        archive: Array.isArray(parsed.archive) ? parsed.archive : [],
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        checklist: Array.isArray(parsed.checklist) ? parsed.checklist : defaults.checklist
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveDfpState(st) {
    try {
      localStorage.setItem(getDfpStorageKey(), JSON.stringify(st));
    } catch (_) {}
  }

  function getOrCreateDailyMemoFolder() {
    if (!state.fileSystem.children) state.fileSystem.children = [];
    let folder = state.fileSystem.children.find(
      (c) => c.type === 'folder' && (c.id === 'daily-memo-inbox' || c.name === '일일 메모함')
    );
    if (!folder) {
      folder = {
        id: 'daily-memo-inbox',
        name: '일일 메모함',
        type: 'folder',
        icon: '🗂️',
        tag: '#일일메모',
        children: []
      };
      state.fileSystem.children.unshift(folder);
    }
    return folder;
  }

  function inferMemoCategory(doc) {
    if (doc.memoCategory && ['todo', 'knowledge', 'thinking'].includes(doc.memoCategory)) {
      return doc.memoCategory;
    }
    const hay = `${doc.tag || ''} ${doc.name || ''}`.toLowerCase();
    if (hay.includes('#todo') || hay.includes('할일')) return 'todo';
    if (hay.includes('#thinking') || hay.includes('생각')) return 'thinking';
    return 'knowledge';
  }

  function setDocMemoCategory(doc, newCat) {
    if (!doc || !['todo', 'knowledge', 'thinking'].includes(newCat)) return;
    doc.memoCategory = newCat;
    const tagMap = { todo: '#Todo', knowledge: '#Knowledge', thinking: '#Thinking' };
    const cleanTags = String(doc.tag || '')
      .replace(/#(todo|knowledge|thinking)\b/gi, '')
      .trim();
    doc.tag = `${tagMap[newCat]}${cleanTags ? ' ' + cleanTags : ''}`;
    if (newCat === 'todo') {
      const dfp = loadDfpState();
      const alreadyInTodo =
        dfp.top3.some((t) => t.docId === doc.id) ||
        dfp.backlog.some((t) => t.docId === doc.id);
      if (!alreadyInTodo) {
        const cleanTitle = String(doc.name || '').replace(/\.md$/i, '');
        dfp.backlog.unshift({ id: `t-${genId()}`, title: cleanTitle, docId: doc.id });
        saveDfpState(dfp);
      }
    }
    saveAndRender();
    scheduleDocFileSyncToDrive(doc, true);
    refreshHomeDashboard();
  }

  function isDocParaUnassigned(doc) {
    if (!doc) return true;
    const rels = getRelationsForNode(doc.id);
    const total = (rels.projects?.length || 0) + (rels.areas?.length || 0) + (rels.resources?.length || 0);
    return total === 0;
  }

  function renderComposerParaUI() {
    const btn = $('dfp-composer-para-btn');
    const pop = $('dfp-composer-para-popover');
    const chipsEl = $('dfp-composer-para-chips');
    if (!btn || !pop || !chipsEl) return;

    // 유효하지 않은 엔티티 정리
    Array.from(dfpComposerParaSet).forEach((val) => {
      const [, eid] = val.split('::');
      if (!findParaEntity(eid)) dfpComposerParaSet.delete(val);
    });

    const cnt = dfpComposerParaSet.size;
    btn.textContent = cnt > 0 ? `🧭 PARA (${cnt}) ▾` : '🧭 PARA ▾';

    chipsEl.innerHTML = '';
    dfpComposerParaSet.forEach((val) => {
      const [, eid] = val.split('::');
      const ent = findParaEntity(eid);
      if (!ent) return;
      const chip = document.createElement('span');
      chip.className = 'dfp-para-chip-mini';
      chip.innerHTML = `${escapeHtml(ent.icon)} ${escapeHtml(ent.name)} <span style="cursor:pointer; margin-left:2px;">✕</span>`;
      chip.querySelector('span').addEventListener('click', () => {
        dfpComposerParaSet.delete(val);
        renderComposerParaUI();
      });
      chipsEl.appendChild(chip);
    });

    pop.innerHTML = '';
    const groups = [
      { type: 'project', label: '🚀 1. 프로젝트' },
      { type: 'area', label: '🧭 2. 영역' },
      { type: 'resource', label: '📚 3. 리소스' }
    ];
    let hasAny = false;
    groups.forEach((g) => {
      const ents = getParaEntities(g.type, { onlyActive: true });
      if (ents.length === 0) return;
      hasAny = true;
      const title = document.createElement('div');
      title.className = 'dfp-para-group-title';
      title.textContent = g.label;
      pop.appendChild(title);

      ents.forEach((ent) => {
        const key = `${g.type}::${ent.id}`;
        const checked = dfpComposerParaSet.has(key);
        const row = document.createElement('div');
        row.className = 'dfp-para-check-row' + (checked ? ' checked' : '');
        row.innerHTML =
          `<span>${checked ? '☑' : '☐'}</span>` +
          `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ent.icon)} ${escapeHtml(ent.name)}</span>`;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dfpComposerParaSet.has(key)) dfpComposerParaSet.delete(key);
          else dfpComposerParaSet.add(key);
          renderComposerParaUI();
        });
        pop.appendChild(row);
      });
    });

    if (!hasAny) {
      pop.innerHTML = `<div style="padding:8px; font-size:0.73rem; color:var(--text-muted); text-align:center;">선언된 PARA 항목 없음</div>`;
    }
  }

  $('dfp-composer-para-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('dfp-composer-para-popover');
    if (!pop) return;
    const willOpen = pop.style.display === 'none';
    renderComposerParaUI();
    pop.style.display = willOpen ? 'flex' : 'none';
  });

  function populateDashboardParaSelect() {
    renderComposerParaUI();
  }

  function saveQuickMemoToPhysicalStorage() {
    const titleEl = $('dfp-memo-title-input');
    const bodyEl = $('dfp-memo-body-input');
    if (!bodyEl) return;

    const rawTitle = String(titleEl?.value || '').trim();
    const rawBody = String(bodyEl.value || '').trim();
    if (!rawTitle && !rawBody) {
      bodyEl.focus();
      return;
    }

    saveStateForUndo();
    const todayStr = getTodayYMD();
    const inboxFolder = getOrCreateDailyMemoFolder();
    const firstLine = (rawTitle || rawBody.split('\n')[0] || '메모')
      .replace(/^[#\-*\s]+/, '')
      .slice(0, 42)
      .trim() || '메모';
    const fileName = getUniqueNameInFolder(inboxFolder, firstLine, '.md');
    const tagMap = { todo: '#Todo', knowledge: '#Knowledge', thinking: '#Thinking' };
    const iconMap = { todo: '✅', knowledge: '💡', thinking: '💭' };

    const newDoc = {
      id: genId(),
      type: 'doc',
      name: fileName,
      icon: iconMap[dfpSelectedMemoCat] || '📝',
      tag: `${tagMap[dfpSelectedMemoCat]} #${todayStr}`,
      summary: rawBody ? (rawTitle ? `# ${rawTitle}\n\n${rawBody}` : rawBody) : `# ${firstLine}`,
      link: '',
      dailyDate: todayStr,
      memoCategory: dfpSelectedMemoCat,
      createdAt: Date.now()
    };

    inboxFolder.children.unshift(newDoc);

    // 중복 체크된 모든 PARA 영역을 동시에 연결
    dfpComposerParaSet.forEach((paraVal) => {
      if (paraVal.includes('::')) {
        const [pType, pId] = paraVal.split('::');
        addRelation({ sourceId: newDoc.id, targetId: pId, type: pType });
      }
    });
    dfpComposerParaSet.clear();

    if (dfpSelectedMemoCat === 'todo') {
      const dfp = loadDfpState();
      if (dfp.top3.length < 3) {
        dfp.top3.push({ id: `t-${genId()}`, title: firstLine, docId: newDoc.id });
      } else {
        dfp.backlog.unshift({ id: `t-${genId()}`, title: firstLine, docId: newDoc.id });
      }
      saveDfpState(dfp);
    }

    if (titleEl) titleEl.value = '';
    bodyEl.value = '';

    saveAndRender();
    scheduleDocFileSyncToDrive(newDoc, true);
    syncItemToLocalFolderNow(newDoc, { allowAutoDownload: true }).catch(() => {});
    refreshHomeDashboard();
    showToast(`저장됨: ${fileName}`);
  }

  function renderDailyMemoBin() {
    const listEl = $('dfp-memo-bin-list');
    if (!listEl) return;
    const todayStr = getTodayYMD();

    const allDocs = collectAllNodes(state.fileSystem).filter((n) => {
      if (!n || n.type !== 'doc' || !isItemVisible(n) || isSpreadsheetItem(n)) return false;
      if (dfpMemoScope === 'today') {
        return n.dailyDate === todayStr || String(n.tag || '').includes(todayStr);
      }
      return true;
    });

    const counts = { all: allDocs.length, todo: 0, knowledge: 0, thinking: 0, unassigned: 0 };
    allDocs.forEach((d) => {
      const c = inferMemoCategory(d);
      counts[c] = (counts[c] || 0) + 1;
      if (isDocParaUnassigned(d)) counts.unassigned++;
    });

    if ($('dfp-bin-count-all')) $('dfp-bin-count-all').textContent = String(counts.all);
    if ($('dfp-bin-count-todo')) $('dfp-bin-count-todo').textContent = String(counts.todo);
    if ($('dfp-bin-count-knowledge')) $('dfp-bin-count-knowledge').textContent = String(counts.knowledge);
    if ($('dfp-bin-count-thinking')) $('dfp-bin-count-thinking').textContent = String(counts.thinking);
    if ($('dfp-bin-count-unassigned')) $('dfp-bin-count-unassigned').textContent = String(counts.unassigned);

    const filtered = allDocs.filter((d) => {
      if (dfpActiveBinTab === 'all') return true;
      if (dfpActiveBinTab === 'unassigned') return isDocParaUnassigned(d);
      return inferMemoCategory(d) === dfpActiveBinTab;
    });
    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="reldb-empty-card-msg" style="padding:16px 8px;">메모 없음</div>`;
      return;
    }

    const paraGroups = [
      { type: 'project', label: '🚀 1. 프로젝트' },
      { type: 'area', label: '🧭 2. 영역' },
      { type: 'resource', label: '📚 3. 리소스' }
    ];

    filtered.slice(0, 60).forEach((doc) => {
      const cat = inferMemoCategory(doc);
      const rels = getRelationsForNode(doc.id);
      const currentParaLinks = [...(rels.projects || []), ...(rels.areas || []), ...(rels.resources || [])];
      const linkedIdSet = new Set(currentParaLinks.map((x) => x.node.id));

      const card = document.createElement('div');
      card.className = 'dfp-memo-card';
      card.draggable = true;
      card.dataset.docId = doc.id;

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging-card');
        e.dataTransfer.setData('application/x-dfp-memo-id', doc.id);
        e.dataTransfer.setData('text/plain', doc.id);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging-card');
        document.querySelectorAll('.drag-over-tab').forEach((el) => el.classList.remove('drag-over-tab'));
      });

      const cleanSnippet = String(doc.summary || '').replace(/^#+\s*/gm, '').trim();

      card.innerHTML =
        `<div class="dfp-memo-card-top">` +
        `  <span class="dfp-memo-card-title">${escapeHtml(doc.icon || '📝')} ${escapeHtml(doc.name.replace(/\.md$/i, ''))}</span>` +
        `  <div style="display:flex; gap:4px; flex-shrink:0;">` +
        (cat === 'todo' ? `<button type="button" class="dfp-mini-btn" data-act="to-top3" title="핵심 3가지로">★</button>` : '') +
        `    <button type="button" class="dfp-mini-btn" data-act="open-md">MD</button>` +
        `    <button type="button" class="dfp-mini-btn" data-act="locate">🗂️</button>` +
        `  </div>` +
        `</div>` +
        (cleanSnippet ? `<div class="dfp-memo-card-body">${escapeHtml(cleanSnippet)}</div>` : '') +
        `<div class="dfp-memo-card-foot">` +
        `  <div class="dfp-cat-switch-group">` +
        `    <button type="button" class="dfp-cat-mini ${cat === 'todo' ? 'active' : ''}" data-cat="todo">Todo</button>` +
        `    <button type="button" class="dfp-cat-mini ${cat === 'knowledge' ? 'active' : ''}" data-cat="knowledge">Knowledge</button>` +
        `    <button type="button" class="dfp-cat-mini ${cat === 'thinking' ? 'active' : ''}" data-cat="thinking">Thinking</button>` +
        `  </div>` +
        `  <div class="dfp-card-para-chips">` +
        currentParaLinks.map(({ rel, node }) =>
          `<span class="dfp-para-chip-mini" data-rel-id="${escapeHtml(rel.id)}">${escapeHtml(node.icon)} ${escapeHtml(node.name)} <span class="del-para" style="cursor:pointer;">✕</span></span>`
        ).join('') +
        `    <div class="dfp-multi-para-wrap dfp-card-para-wrap">` +
        `      <button type="button" class="dfp-mini-btn dfp-card-para-btn">${currentParaLinks.length === 0 ? '⚠️ PARA＋' : '＋'}</button>` +
        `      <div class="dfp-multi-para-popover dfp-card-para-popover" style="display:none;"></div>` +
        `    </div>` +
        `  </div>` +
        `</div>`;

      card.querySelector('.dfp-memo-card-title').addEventListener('click', () => openMarkdownWindow(doc, 'split'));
      card.querySelector('[data-act="open-md"]').addEventListener('click', () => openMarkdownWindow(doc, 'split'));
      card.querySelector('[data-act="locate"]').addEventListener('click', () => navigateToNode(doc));

      card.querySelector('[data-act="to-top3"]')?.addEventListener('click', () => {
        const dfp = loadDfpState();
        if (dfp.top3.length >= 3) {
          showToast('핵심 3가지가 모두 찼습니다.');
          return;
        }
        const title = String(doc.name || '').replace(/\.md$/i, '');
        dfp.backlog = dfp.backlog.filter((t) => t.docId !== doc.id);
        if (!dfp.top3.some((t) => t.docId === doc.id)) {
          dfp.top3.push({ id: `t-${genId()}`, title, docId: doc.id });
          saveDfpState(dfp);
          renderDfpTodos();
        }
      });

      card.querySelectorAll('.dfp-cat-mini').forEach((btn) => {
        btn.addEventListener('click', () => {
          setDocMemoCategory(doc, btn.dataset.cat);
        });
      });

      card.querySelectorAll('.dfp-para-chip-mini .del-para').forEach((delEl) => {
        delEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const relId = delEl.closest('.dfp-para-chip-mini')?.dataset.relId;
          if (relId && removeRelation(relId)) {
            saveAndRender();
            refreshHomeDashboard();
          }
        });
      });

      const paraBtn = card.querySelector('.dfp-card-para-btn');
      const paraPop = card.querySelector('.dfp-card-para-popover');
      paraBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dfp-card-para-popover').forEach((p) => {
          if (p !== paraPop) p.style.display = 'none';
        });
        const willOpen = paraPop.style.display === 'none';
        if (!willOpen) {
          paraPop.style.display = 'none';
          return;
        }
        paraPop.innerHTML = '';
        let anyEnt = false;
        paraGroups.forEach((g) => {
          const ents = getParaEntities(g.type, { onlyActive: true });
          if (ents.length === 0) return;
          anyEnt = true;
          const gt = document.createElement('div');
          gt.className = 'dfp-para-group-title';
          gt.textContent = g.label;
          paraPop.appendChild(gt);

          ents.forEach((ent) => {
            const isChecked = linkedIdSet.has(ent.id);
            const rEl = document.createElement('div');
            rEl.className = 'dfp-para-check-row' + (isChecked ? ' checked' : '');
            rEl.innerHTML = `<span>${isChecked ? '☑' : '☐'}</span><span>${escapeHtml(ent.icon)} ${escapeHtml(ent.name)}</span>`;
            rEl.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const existing = currentParaLinks.find((x) => x.node.id === ent.id);
              if (existing) {
                removeRelation(existing.rel.id);
              } else {
                addRelation({ sourceId: doc.id, targetId: ent.id, type: g.type });
              }
              saveAndRender();
              refreshHomeDashboard();
            });
            paraPop.appendChild(rEl);
          });
        });
        if (!anyEnt) {
          paraPop.innerHTML = `<div style="padding:8px; font-size:0.72rem; color:var(--text-muted); text-align:center;">PARA 항목 없음</div>`;
        }
        paraPop.style.display = 'flex';
      });

      listEl.appendChild(card);
    });
  }

  // Todo Planner (오늘의 핵심 3가지 + 할 일 보관함 + 완료 아카이브)
  function renderDfpTodos() {
    const dfp = loadDfpState();
    const todayStr = getTodayYMD();
    const doneToday = Number(dfp.completedDates?.[todayStr] || 0);
    const clampedDone = Math.min(3, doneToday);

    const badge = $('dfp-completion-badge');
    if (badge) badge.textContent = `${clampedDone} / 3`;
    for (let i = 1; i <= 3; i++) {
      const slotEl = $(`dfp-slot-${i}`);
      if (slotEl) slotEl.classList.toggle('filled', i <= clampedDone);
    }

    const top3El = $('dfp-top3-list');
    if (top3El) {
      top3El.innerHTML = '';
      for (let idx = 0; idx < 3; idx++) {
        const task = dfp.top3[idx];
        if (task) {
          const row = document.createElement('div');
          row.className = 'dfp-task-card';
          row.innerHTML =
            `<div class="dfp-task-left">` +
            `  <span class="dfp-task-num">${idx + 1}</span>` +
            `  <div class="dfp-task-title" contenteditable="true" spellcheck="false">${escapeHtml(task.title)}</div>` +
            `</div>` +
            `<div class="dfp-task-btns">` +
            (task.docId ? `<button type="button" class="dfp-mini-btn" data-act="md">MD</button>` : '') +
            `  <button type="button" class="dfp-mini-btn btn-done" data-act="done">✓</button>` +
            `  <button type="button" class="dfp-mini-btn" data-act="down">↓</button>` +
            `</div>`;

          const titleDiv = row.querySelector('.dfp-task-title');
          titleDiv.addEventListener('blur', () => {
            const nextTitle = titleDiv.textContent.trim();
            if (nextTitle && nextTitle !== task.title) {
              const cur = loadDfpState();
              if (cur.top3[idx]) {
                cur.top3[idx].title = nextTitle;
                saveDfpState(cur);
              }
            }
          });
          titleDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              titleDiv.blur();
            }
          });

          row.querySelector('[data-act="md"]')?.addEventListener('click', () => {
            const doc = findNodeAndParent(task.docId)?.node;
            if (doc) openMarkdownWindow(doc, 'split');
          });

          row.querySelector('[data-act="done"]').addEventListener('click', () => {
            const cur = loadDfpState();
            const removed = cur.top3.splice(idx, 1)[0];
            if (removed) {
              cur.archive.unshift({ ...removed, completedAt: todayStr });
              if (!cur.completedDates) cur.completedDates = {};
              cur.completedDates[todayStr] = Number(cur.completedDates[todayStr] || 0) + 1;
              saveDfpState(cur);
              renderDfpTodos();
            }
          });

          row.querySelector('[data-act="down"]').addEventListener('click', () => {
            const cur = loadDfpState();
            const removed = cur.top3.splice(idx, 1)[0];
            if (removed) {
              cur.backlog.unshift(removed);
              saveDfpState(cur);
              renderDfpTodos();
            }
          });

          top3El.appendChild(row);
        } else {
          const empty = document.createElement('div');
          empty.className = 'dfp-empty-slot';
          empty.innerHTML =
            `<span>#${idx + 1}</span>` +
            `<button type="button" class="dfp-mini-btn">＋ 추가</button>`;
          empty.querySelector('button').addEventListener('click', () => {
            const cur = loadDfpState();
            if (cur.backlog.length > 0) {
              cur.top3.push(cur.backlog.shift());
              saveDfpState(cur);
              renderDfpTodos();
            } else {
              $('dfp-new-task-input')?.focus();
            }
          });
          top3El.appendChild(empty);
        }
      }
    }

    if ($('dfp-backlog-count')) $('dfp-backlog-count').textContent = String(dfp.backlog.length);
    if ($('dfp-archive-count')) $('dfp-archive-count').textContent = String(dfp.archive.length);

    const backlogEl = $('dfp-backlog-list');
    if (backlogEl) {
      backlogEl.innerHTML = '';
      if (dfp.backlog.length === 0) {
        backlogEl.innerHTML = `<div class="reldb-empty-card-msg">할 일 없음</div>`;
      } else {
        dfp.backlog.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'dfp-task-card';
          row.style.padding = '8px 10px';
          row.innerHTML =
            `<span style="font-size:0.81rem; font-weight:650; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.title)}</span>` +
            `<div class="dfp-task-btns">` +
            `  <button type="button" class="dfp-mini-btn" data-act="up">★</button>` +
            `  <button type="button" class="dfp-mini-btn btn-done" data-act="done">✓</button>` +
            `  <button type="button" class="dfp-mini-btn" data-act="del">✕</button>` +
            `</div>`;
          row.querySelector('[data-act="up"]').addEventListener('click', () => {
            const cur = loadDfpState();
            if (cur.top3.length >= 3) {
              showToast('핵심 3가지가 모두 차 있습니다.');
              return;
            }
            const picked = cur.backlog.splice(i, 1)[0];
            if (picked) {
              cur.top3.push(picked);
              saveDfpState(cur);
              renderDfpTodos();
            }
          });
          row.querySelector('[data-act="done"]').addEventListener('click', () => {
            const cur = loadDfpState();
            const picked = cur.backlog.splice(i, 1)[0];
            if (picked) {
              cur.archive.unshift({ ...picked, completedAt: todayStr });
              saveDfpState(cur);
              renderDfpTodos();
            }
          });
          row.querySelector('[data-act="del"]').addEventListener('click', () => {
            const cur = loadDfpState();
            cur.backlog.splice(i, 1);
            saveDfpState(cur);
            renderDfpTodos();
          });
          backlogEl.appendChild(row);
        });
      }
    }

    const archEl = $('dfp-archive-list');
    if (archEl) {
      archEl.innerHTML = '';
      if (dfp.archive.length === 0) {
        archEl.innerHTML = `<div class="reldb-empty-card-msg">완료 항목 없음</div>`;
      } else {
        dfp.archive.slice(0, 50).forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'dfp-task-card';
          row.style.padding = '7px 10px';
          row.innerHTML =
            `<span style="font-size:0.78rem; color:var(--text-muted); text-decoration:line-through; flex:1;">${escapeHtml(item.title)} <small>(${escapeHtml(item.completedAt || '')})</small></span>` +
            `<button type="button" class="dfp-mini-btn">↩️</button>`;
          row.querySelector('button').addEventListener('click', () => {
            const cur = loadDfpState();
            const restored = cur.archive.splice(i, 1)[0];
            if (restored) {
              cur.backlog.unshift(restored);
              saveDfpState(cur);
              renderDfpTodos();
            }
          });
          archEl.appendChild(row);
        });
      }
    }
  }

  // 다음 일정 안 늦게 역산하는 신호등 엔진
  function formatHHMM(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function computeNextScheduleInstance(dfp, now = new Date()) {
    const candidates = [];
    (dfp.schedules || []).forEach((s) => {
      const [hh, mm] = String(s.time || '09:00').split(':').map(Number);
      const travel = Number(s.travelMins || 0);
      const prep = Number(s.prepMins || 0);
      const buffer = Number(s.bufferMins || 0);

      if (s.type === 'recurring') {
        const days = Array.isArray(s.weekdays) ? s.weekdays.map(Number) : [1, 2, 3, 4, 5];
        for (let offset = 0; offset <= 7; offset++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hh || 0, mm || 0, 0, 0);
          if (!days.includes(d.getDay())) continue;
          const instKey = `${s.id}@${getTodayYMD(d)}`;
          if ((s.completedInstances || []).includes(instKey)) continue;
          if (d.getTime() + 15 * 60000 < now.getTime()) continue;
          candidates.push({ sched: s, arrival: d, instKey, travel, prep, buffer });
          break;
        }
      } else if (s.date) {
        const [y, m, day] = s.date.split('-').map(Number);
        const d = new Date(y, (m || 1) - 1, day || 1, hh || 0, mm || 0, 0, 0);
        const instKey = `${s.id}@${s.date}`;
        if ((s.completedInstances || []).includes(instKey)) return;
        if (d.getTime() + 15 * 60000 < now.getTime()) return;
        candidates.push({ sched: s, arrival: d, instKey, travel, prep, buffer });
      }
    });

    candidates.sort((a, b) => a.arrival.getTime() - b.arrival.getTime());
    return candidates[0] || null;
  }

  function renderDfpTrafficLight() {
    const dfp = loadDfpState();
    const now = new Date();
    const next = computeNextScheduleInstance(dfp, now);

    const bar = $('dfp-traffic-bar');
    const bGreen = $('dfp-bulb-green');
    const bYellow = $('dfp-bulb-yellow');
    const bRed = $('dfp-bulb-red');
    const badge = $('dfp-traffic-badge');
    const hint = $('dfp-traffic-hint');
    const headline = $('dfp-countdown-headline');
    const progress = $('dfp-schedule-progress');
    const timeline = $('dfp-timeline-summary');
    const headerBadge = $('dfp-next-schedule-badge');
    const departBtn = $('dfp-complete-schedule-btn');

    // 외출 체크리스트 렌더
    const checkWrap = $('dfp-checklist-items');
    if (checkWrap) {
      checkWrap.innerHTML = '';
      (dfp.checklist || []).forEach((c, idx) => {
        const chip = document.createElement('span');
        chip.className = `dfp-outing-chip${c.checked ? ' checked' : ''}`;
        chip.textContent = `${c.checked ? '✓ ' : ''}${c.text}`;
        chip.addEventListener('click', () => {
          const cur = loadDfpState();
          if (cur.checklist[idx]) {
            cur.checklist[idx].checked = !cur.checklist[idx].checked;
            saveDfpState(cur);
            renderDfpTrafficLight();
          }
        });
        checkWrap.appendChild(chip);
      });
    }

    if (!bar) return;

    if (!next) {
      bar.className = 'dfp-traffic-banner bar-safe';
      if (bGreen) bGreen.className = 'dfp-bulb bulb-green-on';
      if (bYellow) bYellow.className = 'dfp-bulb bulb-yellow-off';
      if (bRed) bRed.className = 'dfp-bulb bulb-red-off';
      if (badge) { badge.textContent = '여유'; badge.style.background = '#d1fae5'; badge.style.color = '#065f46'; }
      if (headline) headline.textContent = '예정된 일정 없음';
      if (progress) { progress.style.width = '100%'; progress.style.background = '#10b981'; }
      if (timeline) timeline.textContent = '';
      if (headerBadge) headerBadge.textContent = '일정 없음';
      if (departBtn) {
        departBtn.classList.add('is-hidden');
        departBtn.style.display = 'none';
      }
      return;
    }

    const departTime = new Date(next.arrival.getTime() - (next.travel + next.buffer) * 60000);
    const prepStartTime = new Date(departTime.getTime() - next.prep * 60000);
    const minsToDepart = Math.round((departTime.getTime() - now.getTime()) / 60000);
    const minsToPrep = Math.round((prepStartTime.getTime() - now.getTime()) / 60000);

    if (headerBadge) {
      headerBadge.textContent = `${next.sched.title} · ${formatHHMM(departTime)} 출발`;
    }
    if (departBtn) {
      departBtn.classList.remove('is-hidden');
      departBtn.style.display = 'inline-flex';
      departBtn.onclick = () => {
        const cur = loadDfpState();
        const target = cur.schedules.find((s) => s.id === next.sched.id);
        if (target) {
          if (!Array.isArray(target.completedInstances)) target.completedInstances = [];
          target.completedInstances.push(next.instKey);
          saveDfpState(cur);
          if (paraDashboard) paraDashboard.renderAll();
          else renderDfpTrafficLight();
        }
      };
    }

    if (timeline) {
      timeline.innerHTML =
        `<span>준비 <b>${formatHHMM(prepStartTime)}</b></span>` +
        `<span>· 출발 <b>${formatHHMM(departTime)}</b></span>` +
        `<span>· 도착 <b>${formatHHMM(next.arrival)}</b></span>`;
    }

    if (minsToDepart <= 0) {
      bar.className = 'dfp-traffic-banner bar-urgent';
      if (bGreen) bGreen.className = 'dfp-bulb bulb-green-off';
      if (bYellow) bYellow.className = 'dfp-bulb bulb-yellow-off';
      if (bRed) bRed.className = 'dfp-bulb bulb-red-on';
      if (badge) { badge.textContent = '즉시 출발'; badge.style.background = '#ffffff'; badge.style.color = '#b91c1c'; }
      if (headline) headline.textContent = `🚨 ${next.sched.title} · 출발 ${Math.abs(minsToDepart)}분 초과`;
      if (progress) { progress.style.width = '100%'; progress.style.background = '#fef2f2'; }
    } else if (minsToPrep <= 0) {
      bar.className = 'dfp-traffic-banner bar-warning';
      if (bGreen) bGreen.className = 'dfp-bulb bulb-green-off';
      if (bYellow) bYellow.className = 'dfp-bulb bulb-yellow-on';
      if (bRed) bRed.className = 'dfp-bulb bulb-red-off';
      if (badge) { badge.textContent = '준비 중'; badge.style.background = '#fde68a'; badge.style.color = '#78350f'; }
      if (headline) headline.textContent = `⏳ ${next.sched.title} · 출발까지 ${minsToDepart}분`;
      const pct = Math.max(8, Math.min(100, Math.round((minsToDepart / Math.max(1, next.prep)) * 100)));
      if (progress) { progress.style.width = `${pct}%`; progress.style.background = '#f59e0b'; }
    } else {
      bar.className = 'dfp-traffic-banner bar-safe';
      if (bGreen) bGreen.className = 'dfp-bulb bulb-green-on';
      if (bYellow) bYellow.className = 'dfp-bulb bulb-yellow-off';
      if (bRed) bRed.className = 'dfp-bulb bulb-red-off';
      if (badge) { badge.textContent = '여유'; badge.style.background = '#d1fae5'; badge.style.color = '#065f46'; }
      const h = Math.floor(minsToDepart / 60);
      const m = minsToDepart % 60;
      if (headline) headline.textContent = `${next.sched.title} · 출발까지 ${h > 0 ? `${h}시간 ` : ''}${m}분`;
      if (progress) { progress.style.width = '100%'; progress.style.background = '#10b981'; }
    }
  }

  function updateScheduleReversePreview() {
    const prevEl = $('dfp-reverse-preview');
    if (!prevEl) return;
    const timeVal = dfpSchedFormMode === 'once' ? $('dfp-sched-time-once')?.value : $('dfp-sched-time-rec')?.value;
    const travel = Number($('dfp-sched-travel')?.value || 0);
    const prep = Number($('dfp-sched-prep')?.value || 0);
    const buffer = Number($('dfp-sched-buffer')?.value || 0);
    if (!timeVal) {
      prevEl.textContent = '';
      return;
    }
    const [hh, mm] = timeVal.split(':').map(Number);
    const base = new Date(2026, 0, 1, hh || 0, mm || 0, 0, 0);
    const depart = new Date(base.getTime() - (travel + buffer) * 60000);
    const prepStart = new Date(depart.getTime() - prep * 60000);
    prevEl.innerHTML =
      `준비 <b>${formatHHMM(prepStart)}</b> → 출발 <b>${formatHHMM(depart)}</b> → 도착 <b>${timeVal}</b>`;
  }

  function renderScheduleModalList() {
    const listEl = $('dfp-schedule-list');
    if (!listEl) return;
    const dfp = loadDfpState();
    listEl.innerHTML = '';
    if (!dfp.schedules || dfp.schedules.length === 0) {
      listEl.innerHTML = `<div class="reldb-empty-card-msg">등록된 주요 일정이 없습니다.</div>`;
      return;
    }
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    dfp.schedules.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'dfp-task-card';
      row.style.padding = '8px 10px';
      const whenLabel = s.type === 'recurring'
        ? `🔁 ${(s.weekdays || []).map((d) => dayNames[d]).join('·')} ${s.time}`
        : `📌 ${s.date} ${s.time}`;
      row.innerHTML =
        `<div style="flex:1; min-width:0;">` +
        `  <div style="font-size:0.8rem; font-weight:750;">${escapeHtml(s.title)} <small style="color:#4f46e5;">(${escapeHtml(whenLabel)})</small></div>` +
        `  <div style="font-size:0.7rem; color:var(--text-muted);">준비 ${s.prepMins}분 · 이동 ${s.travelMins}분 · 버퍼 ${s.bufferMins}분</div>` +
        `</div>` +
        `<button type="button" class="dfp-mini-btn">✕ 삭제</button>`;
      row.querySelector('button').addEventListener('click', () => {
        const cur = loadDfpState();
        cur.schedules.splice(idx, 1);
        saveDfpState(cur);
        renderScheduleModalList();
        if (isHomeMode && paraDashboard) paraDashboard.renderAll();
        else renderDfpTrafficLight();
      });
      listEl.appendChild(row);
    });
  }

  function refreshHomeDashboard() {
    ensureParaDashboardMounted();
    if (paraDashboard) {
      paraDashboard.renderAll();
    } else {
      renderDfpTrafficLight();
    }
  }

  // Dashboard Event Listeners
  $('dfp-memo-cat-group')?.querySelectorAll('.dfp-cat-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      dfpSelectedMemoCat = btn.dataset.memoCat || 'todo';
      $('dfp-memo-cat-group').querySelectorAll('.dfp-cat-pill').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  $('dfp-save-memo-btn')?.addEventListener('click', saveQuickMemoToPhysicalStorage);
  $('dfp-memo-body-input')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveQuickMemoToPhysicalStorage();
    }
  });

  $('dfp-memo-scope-today')?.addEventListener('click', () => {
    dfpMemoScope = 'today';
    $('dfp-memo-scope-today').classList.add('active');
    $('dfp-memo-scope-all')?.classList.remove('active');
    renderDailyMemoBin();
  });
  $('dfp-memo-scope-all')?.addEventListener('click', () => {
    dfpMemoScope = 'all';
    $('dfp-memo-scope-all').classList.add('active');
    $('dfp-memo-scope-today')?.classList.remove('active');
    renderDailyMemoBin();
  });

  $('dfp-bin-tabs')?.querySelectorAll('.dfp-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      dfpActiveBinTab = btn.dataset.binTab || 'all';
      $('dfp-bin-tabs').querySelectorAll('.dfp-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderDailyMemoBin();
    });

    // 드래그한 메모 카드를 Todo / Knowledge / Thinking 탭 위에 놓아 다른 통으로 이동
    const dropCat = btn.dataset.dropCat;
    if (dropCat) {
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        btn.classList.add('drag-over-tab');
      });
      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-over-tab');
      });
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over-tab');
        const docId = e.dataTransfer.getData('application/x-dfp-memo-id') || e.dataTransfer.getData('text/plain');
        const doc = findNodeAndParent(docId)?.node;
        if (doc && doc.type === 'doc') {
          setDocMemoCategory(doc, dropCat);
          showToast(`"${doc.name.replace(/\.md$/i, '')}" → ${dropCat.toUpperCase()}`);
        }
      });
    }
  });

  // 메모 카드를 좌측 [오늘의 핵심 3가지] 영역으로 드래그 앤 드롭해 바로 등록
  $('dfp-top3-list')?.addEventListener('dragover', (e) => e.preventDefault());
  $('dfp-top3-list')?.addEventListener('drop', (e) => {
    e.preventDefault();
    const docId = e.dataTransfer.getData('application/x-dfp-memo-id') || e.dataTransfer.getData('text/plain');
    const doc = findNodeAndParent(docId)?.node;
    if (!doc || doc.type !== 'doc') return;
    setDocMemoCategory(doc, 'todo');
    const dfp = loadDfpState();
    const title = String(doc.name || '').replace(/\.md$/i, '');
    if (dfp.top3.length < 3 && !dfp.top3.some((t) => t.docId === doc.id)) {
      dfp.backlog = dfp.backlog.filter((t) => t.docId !== doc.id);
      dfp.top3.push({ id: `t-${genId()}`, title, docId: doc.id });
      saveDfpState(dfp);
      renderDfpTodos();
    }
  });

  $('dfp-tab-backlog')?.addEventListener('click', () => {
    dfpActiveTaskTab = 'backlog';
    $('dfp-tab-backlog').classList.add('active');
    $('dfp-tab-archive')?.classList.remove('active');
    if ($('dfp-backlog-panel')) $('dfp-backlog-panel').style.display = 'block';
    if ($('dfp-archive-panel')) $('dfp-archive-panel').style.display = 'none';
  });
  $('dfp-tab-archive')?.addEventListener('click', () => {
    dfpActiveTaskTab = 'archive';
    $('dfp-tab-archive').classList.add('active');
    $('dfp-tab-backlog')?.classList.remove('active');
    if ($('dfp-backlog-panel')) $('dfp-backlog-panel').style.display = 'none';
    if ($('dfp-archive-panel')) $('dfp-archive-panel').style.display = 'block';
  });

  $('dfp-add-task-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('dfp-new-task-input');
    const title = String(inp?.value || '').trim();
    if (!title) return;
    const cur = loadDfpState();
    if (cur.top3.length < 3) {
      cur.top3.push({ id: `t-${genId()}`, title });
    } else {
      cur.backlog.unshift({ id: `t-${genId()}`, title });
    }
    saveDfpState(cur);
    if (inp) inp.value = '';
    renderDfpTodos();
  });

  $('dfp-clear-archive-btn')?.addEventListener('click', () => {
    const cur = loadDfpState();
    cur.archive = [];
    saveDfpState(cur);
    renderDfpTodos();
  });

  $('dfp-toggle-checklist-add')?.addEventListener('click', () => {
    const f = $('dfp-checklist-form');
    if (f) {
      f.style.display = f.style.display === 'none' ? 'flex' : 'none';
      $('dfp-checklist-input')?.focus();
    }
  });
  $('dfp-reset-checklist')?.addEventListener('click', () => {
    const cur = loadDfpState();
    (cur.checklist || []).forEach((c) => { c.checked = false; });
    saveDfpState(cur);
    renderDfpTrafficLight();
  });
  $('dfp-checklist-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('dfp-checklist-input');
    const txt = String(inp?.value || '').trim();
    if (!txt) return;
    const cur = loadDfpState();
    cur.checklist.push({ id: `c-${genId()}`, text: txt, checked: false });
    saveDfpState(cur);
    if (inp) inp.value = '';
    renderDfpTrafficLight();
  });

  // Schedule Modal Events
  $('dfp-open-schedule-btn')?.addEventListener('click', openScheduleModal);
  $('dfp-close-schedule-modal')?.addEventListener('click', () => {
    if ($('dfp-schedule-modal')) $('dfp-schedule-modal').style.display = 'none';
  });

  $('dfp-sched-type-group')?.querySelectorAll('.dfp-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      dfpSchedFormMode = btn.dataset.schedType || 'once';
      $('dfp-sched-type-group').querySelectorAll('.dfp-seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      if ($('dfp-sched-once-fields')) $('dfp-sched-once-fields').style.display = dfpSchedFormMode === 'once' ? 'grid' : 'none';
      if ($('dfp-sched-rec-fields')) $('dfp-sched-rec-fields').style.display = dfpSchedFormMode === 'recurring' ? 'flex' : 'none';
      updateScheduleReversePreview();
    });
  });

  $('dfp-weekday-group')?.querySelectorAll('.dfp-day-chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  ['dfp-sched-time-once', 'dfp-sched-time-rec', 'dfp-sched-travel', 'dfp-sched-prep', 'dfp-sched-buffer'].forEach((id) => {
    $(id)?.addEventListener('input', updateScheduleReversePreview);
  });

  $('dfp-add-schedule-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const travelMins = Math.max(0, Number($('dfp-sched-travel')?.value || 0));
    const prepMins = Math.max(0, Number($('dfp-sched-prep')?.value || 0));
    const bufferMins = Math.max(0, Number($('dfp-sched-buffer')?.value || 0));

    const cur = loadDfpState();
    if (dfpSchedFormMode === 'once') {
      const date = $('dfp-sched-date')?.value || getTodayYMD();
      const time = $('dfp-sched-time-once')?.value || '09:00';
      const title = String($('dfp-sched-title-once')?.value || '').trim() || '주요 일정';
      cur.schedules.push({ id: `sch-${genId()}`, type: 'once', date, time, title, travelMins, prepMins, bufferMins, completedInstances: [] });
      if ($('dfp-sched-title-once')) $('dfp-sched-title-once').value = '';
    } else {
      const time = $('dfp-sched-time-rec')?.value || '09:00';
      const title = String($('dfp-sched-title-rec')?.value || '').trim() || '반복 루틴';
      const weekdays = Array.from($('dfp-weekday-group')?.querySelectorAll('.dfp-day-chip.active') || []).map((c) => Number(c.dataset.weekday));
      if (weekdays.length === 0) {
        showToast('반복할 요일을 하나 이상 선택해 주세요.');
        return;
      }
      cur.schedules.push({ id: `sch-${genId()}`, type: 'recurring', weekdays, time, title, travelMins, prepMins, bufferMins, completedInstances: [] });
      if ($('dfp-sched-title-rec')) $('dfp-sched-title-rec').value = '';
    }
    saveDfpState(cur);
    renderScheduleModalList();
    renderDfpTrafficLight();
    if (isHomeMode && paraDashboard) paraDashboard.renderAll();
    showToast('📅 일정이 등록되고 역산 신호등에 반영되었습니다.');
  });

  function renderPinAppPicker(query = '') {
    const listEl = $('pin-app-list');
    if (!listEl) return;
    const q = String(query || '').trim().toLowerCase();
    const allNodes = collectAllNodes(state.fileSystem).filter((n) => {
      if (!isItemVisible(n)) return false;
      if (!q) return true;
      return `${n.name || ''} ${n.tag || ''}`.toLowerCase().includes(q);
    });

    // HTML, 엑셀, MD 파일을 상단에 우선 정렬
    allNodes.sort((a, b) => {
      const score = (n) => {
        if (isHtmlContentItem(n)) return 0;
        if (isSpreadsheetItem(n)) return 1;
        if (/\.md$/i.test(n.name || '')) return 2;
        if (n.type === 'doc') return 3;
        return 4;
      };
      return score(a) - score(b);
    });

    listEl.innerHTML = '';
    if (allNodes.length === 0) {
      listEl.innerHTML = `<div style="padding:14px; text-align:center; font-size:0.78rem; color:var(--text-muted);">추가할 파일이 없습니다.</div>`;
      return;
    }

    allNodes.slice(0, 80).forEach((node) => {
      const pinned = state.pinnedAppIds.includes(node.id);
      const pathNodes = getPathToNode(node.id) || [];
      const folderText = pathNodes.length > 2 ? pathNodes.slice(1, -1).map((p) => p.name).join(' / ') : '루트';
      const row = document.createElement('div');
      row.className = 'picker-item';
      row.innerHTML =
        `<div class="picker-item-main">` +
        `  <span>${escapeHtml(node.icon || (node.type === 'folder' ? '📁' : '📄'))}</span>` +
        `  <div style="min-width:0;">` +
        `    <div class="picker-item-name">${escapeHtml(node.name)}</div>` +
        `    <div class="picker-item-path">${escapeHtml(folderText)}</div>` +
        `  </div>` +
        `</div>` +
        `<span class="picker-item-badge">${pinned ? '✅ 고정됨 (해제)' : '＋ 홈에 추가'}</span>`;

      row.addEventListener('click', () => {
        togglePinAppToHome(node);
        renderPinAppPicker($('pin-app-search')?.value || '');
      });
      listEl.appendChild(row);
    });
  }

  $('btn-home-add-app')?.addEventListener('click', openPinAppModal);
  $('btn-close-pin-modal')?.addEventListener('click', () => { elPinAppModal.style.display = 'none'; });
  $('btn-cancel-pin-modal')?.addEventListener('click', () => { elPinAppModal.style.display = 'none'; });
  elPinAppModal?.addEventListener('click', (e) => { if (e.target === elPinAppModal) elPinAppModal.style.display = 'none'; });
  $('pin-app-search')?.addEventListener('input', (e) => renderPinAppPicker(e.target.value));

  // ================= Initialize =================
  initTheme();
  elChatProvider.value = state.settings.lastProvider || 'gemini';
  populateModels(elChatProvider.value);
  updateApiStatusSummary();
  updateLoginClock();
  updateHomeClock();
  setInterval(() => {
    updateLoginClock();
    if (isHomeMode) {
      updateHomeClock();
      if (paraDashboard) paraDashboard.refreshTrafficLightVisuals();
      else renderDfpTrafficLight();
    }
  }, 15000);

  // 5분 주기 자동 백업 스냅샷 (변경 발생 시 IndexedDB에 롤링 저장)
  setInterval(() => {
    if (!autoBackupDirty || !BrainBackup) return;
    if (elOsWindow?.classList.contains('os-locked')) return;
    autoBackupDirty = false;
    BrainBackup.saveSnapshot({
      kind: 'auto',
      label: '정기 자동 백업',
      userEmail: getActiveUserEmail() || 'guest',
      payload: buildFullBackupPayload()
    }).catch(() => {});
  }, 5 * 60 * 1000);

  // 온라인(http/https) 환경일 때만 웹 폰트 비동기 로드 (오프라인/file:// 즉시 실행 보장)
  if (!BrainAuth.isFileProtocol() && navigator.onLine !== false) {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(fontLink);
  }

  // 시작 시 항상 Windows 스타일 로그인 잠금 화면으로 진입 (목록 비노출)
  const canTryOnlineAuth =
    BrainAuth.isConfigComplete(state.settings.firebaseConfig) &&
    !BrainAuth.isFileProtocol() &&
    navigator.onLine !== false;

  showLoginScreen(canTryOnlineAuth ? '🔐 로그인 상태 확인 중...' : '');

  if (canTryOnlineAuth) {
    BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged)
      .then(() => {
        if (!BrainAuth.getUser() && !isAuthBusy && elLoginStatusText) {
          elLoginStatusText.textContent = '';
        }
      })
      .catch((err) => {
        if (!isGuestMode) {
          setLoginScreenError(`오프라인 상태이거나 Firebase에 연결할 수 없습니다 (${err.message}). 아래 [게스트로 시작]으로 오프라인 작업을 진행하세요.`);
        }
        if (elLoginStatusText) elLoginStatusText.textContent = '';
      });
    refreshBridgeStatus(false);
  }
})();
