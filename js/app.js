(function () {
  'use strict';

  const { DEFAULT_FIREBASE_CONFIG, state, getActiveUserEmail, switchUser, clearActiveWorkspace, genId, regenerateIds, persistFS, persistSettings, persistChat, getSyncMeta, setSyncMeta, saveStateForUndo, findNodeAndParent, isDescendant, getPathToNode, searchNodes, collectDocsInFolder, getTheme, setTheme } = window.BrainStore;
  const { PROVIDERS, sendChat } = window.BrainAI;
  const { render: renderMarkdown, escapeHtml } = window.BrainMarkdown;
  const BrainAuth = window.BrainAuth;
  const BrainDrive = window.BrainDrive;
  const LocalBridge = window.BrainLocalBridge;
  const WinManager = window.BrainWindowManager;
  const BrainSheet = window.BrainSpreadsheet;

  let isEditing = false;
  let isSendingChat = false;
  let isBridgeConnected = false;
  let searchQuery = '';

  // Google Drive sync & OS window state
  let driveSyncTimer = null;
  let isDriveSyncing = false;
  let driveSyncStatus = 'disconnected'; // 'disconnected' | 'syncing' | 'synced' | 'expired' | 'error'
  let lastDriveErrorMessage = '';
  let lastDriveErrorCode = '';
  let hasSyncedDriveThisSession = false;
  let previewRenderSeq = 0;
  const openMdWindows = new Map(); // itemId -> { win, syncFromItem }
  const mdDriveSyncTimers = new Map(); // itemId -> timerId

  // ================= DOM References =================
  const $ = (id) => document.getElementById(id);

  const elTreeRoot = $('tree-root');
  const elBreadcrumb = $('breadcrumb');
  const elContentArea = $('content-area');
  const elContextMenu = $('context-menu');
  const elGlobalSearch = $('global-search');
  const elBtnClearSearch = $('btn-clear-search');
  const elApiStatusSummary = $('api-status-summary');

  // Preview panel
  const elEmptyState = $('empty-state');
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

  // Settings modal
  const elSettingsModal = $('settings-modal');

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

  // ================= Theme =================
  function initTheme() {
    const current = getTheme();
    setTheme(current);
    $('btn-theme').textContent = current === 'dark' ? '☀️' : '🌙';
  }

  $('btn-theme').addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    $('btn-theme').textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // ================= Panel Toggle & Resizers =================
  function togglePanel(panelId, btnId, resizerId) {
    const panel = $(panelId);
    const btn = $(btnId);
    const resizer = $(resizerId);
    const hidden = panel.style.display === 'none';
    panel.style.display = hidden ? 'flex' : 'none';
    resizer.style.display = hidden ? 'block' : 'none';
    btn.classList.toggle('active', hidden);
  }

  $('btn-sidebar').addEventListener('click', () => togglePanel('sidebar', 'btn-sidebar', 'resizer-left'));
  $('btn-right-panel').addEventListener('click', () => togglePanel('right-panel', 'btn-right-panel', 'resizer-right'));

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
    document.querySelectorAll('.panel-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    $('panel-preview').classList.toggle('active', tabName === 'preview');
    $('panel-chat').classList.toggle('active', tabName === 'chat');
    if (tabName === 'chat') {
      elChatMessages.scrollTop = elChatMessages.scrollHeight;
      elChatInput.focus();
    }
  }

  $('tab-preview').addEventListener('click', () => switchRightTab('preview'));
  $('tab-chat').addEventListener('click', () => switchRightTab('chat'));

  // ================= File System Rendering =================
  function saveAndRender(options = {}) {
    persistFS(options);
    renderTree(state.fileSystem, elTreeRoot, true);
    if (searchQuery) renderSearchResults(searchQuery);
    else openFolder(state.currentFolder);
    renderContextChips();
    if (!options.skipDriveSync) {
      scheduleDriveSync();
    }
  }

  function renderTree(node, container, isRoot = false) {
    if (isRoot) container.innerHTML = '';
    const li = document.createElement('li');
    const div = document.createElement('div');
    div.className = 'tree-node' + (state.currentFolder && state.currentFolder.id === node.id && !searchQuery ? ' active' : '');
    div.innerHTML = `<span>${node.icon || '📁'}</span> <span>${escapeHtml(node.name)}</span>`;

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

    li.appendChild(div);
    if (node.children) {
      const subFolders = node.children.filter((c) => c.type === 'folder' && isItemVisible(c));
      if (subFolders.length > 0) {
        const ul = document.createElement('ul');
        subFolders.forEach((child) => renderTree(child, ul));
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

  function renderItemsGrid(items, emptyMessage) {
    elContentArea.innerHTML = '';
    updateLocalLockBanner();

    const visibleItems = (items || []).filter((item) => isItemVisible(item));
    if (visibleItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-folder-hint';
      empty.textContent = emptyMessage || '이 폴더는 비어 있습니다. 우클릭하거나 상단 버튼으로 폴더/메모를 만들어 보세요.';
      elContentArea.appendChild(empty);
      return;
    }

    // 폴더 먼저, 그 다음 문서
    const sorted = [...visibleItems].sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === 'folder' ? -1 : 1;
    });

    sorted.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'item-card' + (state.selectedItem && state.selectedItem.id === item.id ? ' selected' : '');
      card.dataset.itemId = item.id;
      card.draggable = true;
      card.innerHTML =
        (item.driveFile ? `<span class="item-cloud-badge" title="Google Drive 동기화 파일">☁️</span>` : '') +
        `<div class="item-icon">${escapeHtml(item.icon || (item.type === 'folder' ? '📁' : '📄'))}</div>` +
        `<div class="item-name">${escapeHtml(item.name)}</div>` +
        (item.tag ? `<div class="item-tag-mini">${escapeHtml(item.tag)}</div>` : '');

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.id);
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
        document.querySelectorAll('.item-card').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
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
        document.querySelectorAll('.item-card').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
        selectItem(item);
        showContextMenu(e);
      });

      elContentArea.appendChild(card);
    });
  }

  function openFolder(folder) {
    state.currentFolder = folder;
    renderBreadcrumb(folder);
    renderItemsGrid(folder.children || []);
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
    if (rerender) openFolder(state.currentFolder);
  }

  elGlobalSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    elBtnClearSearch.style.display = searchQuery ? 'inline-block' : 'none';
    if (searchQuery) renderSearchResults(searchQuery);
    else openFolder(state.currentFolder);
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
    saveStateForUndo();
    item.name = trimmed;
    if (item.driveFile) item.driveFile.name = trimmed;
    saveAndRender();
    if (state.selectedItem && state.selectedItem.id === item.id) {
      selectItem(item);
    }
    syncOpenWindowsForItem(item);

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
    if (type === 'sheet') {
      const newName = getUniqueNameInFolder(state.currentFolder, '새 스프레드시트', '.xlsx');
      const starterWb = BrainSheet.createStarterWorkbook();
      const newItem = {
        id: genId(),
        type: 'doc',
        name: newName,
        icon: '📊',
        tag: '#Excel #시트',
        summary: BrainSheet.workbookToMarkdownSummary(starterWb),
        link: '',
        sheetData: starterWb
      };
      if (!state.currentFolder.children) state.currentFolder.children = [];
      state.currentFolder.children.push(newItem);
      saveAndRender();
      selectItem(newItem);
      syncSpreadsheetToDriveNow(newItem).catch(() => {});
      openSpreadsheetWindow(newItem);
      showToast(`📊 새 엑셀 시트(${newName})를 만들었습니다.`);
      return;
    }

    const newName = type === 'folder'
      ? getUniqueNameInFolder(state.currentFolder, '새 폴더')
      : getUniqueNameInFolder(state.currentFolder, '새 메모', '.md');
    const newItem = {
      id: genId(),
      type,
      name: newName,
      icon: type === 'folder' ? '📁' : '📝',
      tag: type === 'folder' ? '' : '#MD',
      summary: '',
      link: '',
      children: type === 'folder' ? [] : undefined
    };
    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newItem);
    saveAndRender();
    selectItem(newItem);
    if (type === 'folder') {
      const driveToken = BrainAuth.getDriveAccessToken();
      if (driveToken && isOwnerAuthenticated()) {
        const folderSegs = getFolderPathSegments(newItem);
        BrainDrive.ensureFolderPath(driveToken, folderSegs, BrainAuth.getUser()?.email || '').catch(() => {});
      }
      startRenameItem(newItem);
    } else {
      scheduleDocFileSyncToDrive(newItem, true);
      openMarkdownWindow(newItem, 'split');
    }
    showToast(type === 'folder' ? '새 폴더를 만들었습니다.' : `새 마크다운 메모(${newName})를 만들었습니다.`);
  }

  function execCopy() {
    if (!state.selectedItem || state.selectedItem.id === 'root') return;
    state.clipboard = { action: 'copy', itemData: JSON.parse(JSON.stringify(state.selectedItem)) };
    showToast(`복사됨: ${state.selectedItem.name}`);
  }

  function execCut() {
    if (!state.selectedItem || state.selectedItem.id === 'root') return;
    state.clipboard = { action: 'cut', itemData: JSON.parse(JSON.stringify(state.selectedItem)) };
    showToast(`잘라내기됨: ${state.selectedItem.name}`);
  }

  function execPaste() {
    if (!state.clipboard) return;
    saveStateForUndo();
    const newItem = JSON.parse(JSON.stringify(state.clipboard.itemData));

    const wasCut = state.clipboard.action === 'cut';
    if (wasCut) {
      if (isDescendant(newItem.id, state.currentFolder.id)) {
        showToast('폴더를 자기 자신의 하위 폴더로 이동할 수 없습니다.');
        return;
      }
      const original = findNodeAndParent(newItem.id);
      if (original && original.parent) {
        original.parent.children = original.parent.children.filter((c) => c.id !== newItem.id);
      }
      state.clipboard = null;
    } else {
      newItem.name += ' - 복사본';
      delete newItem.driveDocId;
      regenerateIds(newItem);
    }

    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newItem);
    saveAndRender();
    if (wasCut) {
      syncMovedNodeToDrive(newItem);
    }
    showToast(`붙여넣기 완료: ${newItem.name}`);
  }

  function execUndo() {
    if (state.undoStack.length === 0) {
      showToast('되돌릴 작업이 없습니다.');
      return;
    }
    state.fileSystem = JSON.parse(state.undoStack.pop());
    const found = findNodeAndParent(state.currentFolder.id);
    state.currentFolder = found ? found.node : state.fileSystem;
    state.selectedItem = null;
    elEmptyState.style.display = 'block';
    elDetailState.style.display = 'none';
    saveAndRender();
    showToast('실행 취소되었습니다.');
  }

  function execDelete(askConfirm = false) {
    if (!state.selectedItem || state.selectedItem.id === 'root') return;
    if (askConfirm && !confirm(`"${state.selectedItem.name}" 항목을 삭제할까요?`)) return;

    saveStateForUndo();
    const deletedId = state.selectedItem.id;
    const found = findNodeAndParent(deletedId);
    if (found && found.parent) {
      found.parent.children = found.parent.children.filter((c) => c.id !== deletedId);
    }
    WinManager.getWindow(`md-${deletedId}`)?.close();
    WinManager.getWindow(`file-${deletedId}`)?.close();
    WinManager.getWindow(`html-${deletedId}`)?.close();
    state.attachedContextIds = state.attachedContextIds.filter((id) => id !== deletedId);
    state.selectedItem = null;
    elEmptyState.style.display = 'block';
    elDetailState.style.display = 'none';
    saveAndRender();
    showToast('삭제되었습니다. (Ctrl+Z로 복구 가능)');
  }

  // ================= Drag & Drop =================
  function handleInternalDrop(e, targetFolder) {
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetFolder.id) return;
    if (isDescendant(draggedId, targetFolder.id)) {
      showToast('상위 폴더를 하위 폴더 안으로 이동할 수 없습니다.');
      return;
    }
    const original = findNodeAndParent(draggedId);
    if (original && original.parent && original.parent.id !== targetFolder.id) {
      saveStateForUndo();
      original.parent.children = original.parent.children.filter((c) => c.id !== draggedId);
      if (!targetFolder.children) targetFolder.children = [];
      targetFolder.children.push(original.node);
      saveAndRender();
      syncMovedNodeToDrive(original.node);
      showToast(`"${original.node.name}" 이동 완료`);
    }
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

    // 이미지/PDF/PPT 등 바이너리 파일이 있으면 Google Drive 토큰 확보
    let driveToken = BrainAuth.getDriveAccessToken();
    if (binaryFiles.length > 0 && (!driveToken || !isOwnerAuthenticated())) {
      if (!BrainAuth.isConfigComplete(state.settings.firebaseConfig)) {
        showToast('☁️ 이미지·PDF·PPT 파일 저장은 Google 로그인(Firebase 설정) 후 이용할 수 있습니다.');
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
        scheduleDocFileSyncToDrive(newItem, true);
        lastAdded = newItem;
        addedCount++;
      } else {
        showToast(`☁️ "${file.name}" Google Drive 업로드 중...`);
        try {
          const folderPath = getFolderPathSegments(state.currentFolder);
          const uploaded = await BrainDrive.uploadFile(driveToken, file, userEmail, folderPath);
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
    elEmptyState.style.display = 'flex';
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

  function selectItem(item) {
    if (!item || !isItemVisible(item)) {
      clearSelectionView();
      return;
    }
    state.selectedItem = item;
    isEditing = false;
    elEmptyState.style.display = 'none';
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
    const iconVal = $('edit-icon').value.trim();
    if (iconVal) state.selectedItem.icon = iconVal;
    state.selectedItem.name = $('edit-title').value.trim() || '제목 없음';
    state.selectedItem.tag = $('edit-tag').value.trim();
    state.selectedItem.link = linkVal;
    state.selectedItem.isLocalPrivate = isProtected;
    state.selectedItem.summary = $('edit-summary').value;
    saveAndRender();
    selectItem(state.selectedItem);
    syncOpenWindowsForItem(state.selectedItem);
    if (state.selectedItem.type === 'doc') {
      scheduleDocFileSyncToDrive(state.selectedItem, true);
    }
    showToast('저장되었습니다.');
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
    const rect = $('main').getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    elContextMenu.style.display = 'block';
    if (x + elContextMenu.offsetWidth > rect.width) x = rect.width - elContextMenu.offsetWidth - 8;
    if (y + elContextMenu.offsetHeight > rect.height) y = rect.height - elContextMenu.offsetHeight - 8;
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
    else if (action === 'rename') startRenameItem(state.selectedItem);
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
      if (state.selectedItem) {
        attachNodeToContext(state.selectedItem);
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
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);

    // Ctrl+K: 검색 포커스
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      elGlobalSearch.focus();
      elGlobalSearch.select();
      return;
    }

    // Ctrl+S: 편집 중 저장
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && isEditing) {
      e.preventDefault();
      saveEdits();
      return;
    }

    if (isInput) return;

    if (e.key === 'F2') {
      e.preventDefault();
      startRenameItem(state.selectedItem);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') { e.preventDefault(); execCopy(); }
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

  // ================= Settings Modal & Export/Import =================
  function openSettingsModal() {
    $('key-gemini').value = state.settings.keys.gemini || '';
    $('key-openai').value = state.settings.keys.openai || '';
    $('key-anthropic').value = state.settings.keys.anthropic || '';
    $('key-grok').value = state.settings.keys.grok || '';

    $('custom-model-gemini').value = state.settings.customModels.gemini || '';
    $('custom-model-openai').value = state.settings.customModels.openai || '';
    $('custom-model-anthropic').value = state.settings.customModels.anthropic || '';
    $('custom-model-grok').value = state.settings.customModels.grok || '';
    $('local-bridge-url').value = state.settings.localBridgeUrl || LocalBridge.DEFAULT_URL;

    elSettingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    elSettingsModal.style.display = 'none';
  }

  $('btn-settings').addEventListener('click', openSettingsModal);
  $('btn-close-settings').addEventListener('click', closeSettingsModal);
  $('btn-cancel-settings').addEventListener('click', closeSettingsModal);
  elSettingsModal.addEventListener('click', (e) => {
    if (e.target === elSettingsModal) closeSettingsModal();
  });

  $('btn-save-settings').addEventListener('click', () => {
    state.settings.keys.gemini = $('key-gemini').value.trim();
    state.settings.keys.openai = $('key-openai').value.trim();
    state.settings.keys.anthropic = $('key-anthropic').value.trim();
    state.settings.keys.grok = $('key-grok').value.trim();

    state.settings.customModels.gemini = $('custom-model-gemini').value.trim().replace(/^models\//i, '');
    state.settings.customModels.openai = $('custom-model-openai').value.trim();
    state.settings.customModels.anthropic = $('custom-model-anthropic').value.trim();
    state.settings.customModels.grok = $('custom-model-grok').value.trim();
    state.settings.localBridgeUrl = $('local-bridge-url').value.trim() || LocalBridge.DEFAULT_URL;

    persistSettings();
    populateModels(elChatProvider.value);
    updateApiStatusSummary();
    refreshBridgeStatus(false);
    closeSettingsModal();
    showToast('✅ API 설정이 브라우저에 저장되었습니다.');
  });

  $('btn-export-json').addEventListener('click', () => {
    const exportFs = isOwnerAuthenticated() ? state.fileSystem : stripLocalItemsForExport(state.fileSystem);
    const payload = {
      exportedAt: new Date().toISOString(),
      version: '6.0',
      fileSystem: exportFs,
      chatHistory: state.chatHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `second-brain-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('⬇️ JSON 백업 파일이 다운로드되었습니다.');
  });

  $('btn-import-json').addEventListener('click', () => $('import-file-input').click());
  $('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const fs = parsed.fileSystem || (parsed.id === 'root' ? parsed : null);
        if (!fs || !fs.id) throw new Error('올바른 세컨드 브레인 백업 파일이 아닙니다.');
        saveStateForUndo();
        state.fileSystem = fs;
        state.currentFolder = state.fileSystem;
        state.selectedItem = null;
        if (Array.isArray(parsed.chatHistory)) {
          state.chatHistory = parsed.chatHistory;
          persistChat();
          renderChatMessages();
        }
        saveAndRender();
        closeSettingsModal();
        showToast('⬆️ 데이터를 성공적으로 복원했습니다.');
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

  function showLoginScreen(statusText = '', errorMsg = '') {
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
    clearSelectionView();

    if (elOsWindow) elOsWindow.classList.add('os-locked');
    if (elLoginScreen) elLoginScreen.classList.remove('hidden');

    const isFile = BrainAuth.isFileProtocol();
    if (elLoginFileWarning) elLoginFileWarning.style.display = isFile ? 'block' : 'none';
    if (elBtnOsGoogleLogin) elBtnOsGoogleLogin.disabled = isFile;
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

    if (!waitForSyncBeforeReveal && shouldSync) {
      syncWithDrive({ mode: 'initial', interactive: false, showSuccessToast: true });
    }
  }

  async function logoutAndLockOS(reasonMsg = '로그아웃되었습니다. 다른 Google 계정으로 로그인할 수 있습니다.') {
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
    await BrainAuth.signOut();
    showLoginScreen(reasonMsg);
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

    const user = BrainAuth.getUser();
    const unlocked = isOwnerAuthenticated();

    if (unlocked && user) {
      btn.classList.add('active');
      iconEl.innerHTML = user.picture
        ? `<img src="${escapeHtml(user.picture)}" alt="" class="auth-avatar-mini" referrerpolicy="no-referrer">`
        : '🔓';
      textEl.textContent = user.email.split('@')[0];
      btn.title = `인증됨 (${user.email}) — 클릭하여 로그아웃/잠금`;
    } else if (user) {
      btn.classList.remove('active');
      iconEl.textContent = '🚫';
      textEl.textContent = '권한 없음';
      btn.title = `${user.email} 계정은 허용된 소유자 이메일과 다릅니다.`;
    } else {
      btn.classList.remove('active');
      iconEl.textContent = '🔒';
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
    } else {
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
    if (dot) dot.classList.toggle('connected', ok);
    if (text) text.textContent = ok ? '로컬 연결됨' : '로컬 미연결';

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

  // ================= Google Drive Sync & File Viewer =================
  function updateDriveStatusUI(customLabel = '') {
    const btn = $('btn-drive-sync');
    const dot = $('drive-status-dot');
    const text = $('drive-status-text');
    if (!btn || !dot || !text) return;

    dot.classList.remove('synced', 'syncing', 'error');
    const unlocked = isOwnerAuthenticated();
    const hasToken = BrainAuth.hasDriveAccess();

    if (isDriveSyncing || driveSyncStatus === 'syncing') {
      dot.classList.add('syncing');
      text.textContent = customLabel || '동기화 중...';
      btn.title = 'Google Drive (SecondBrainOS) 동기화 진행 중...';
      return;
    }

    if (!unlocked) {
      text.textContent = customLabel || '드라이브 미연결';
      btn.title = 'Google 로그인 후 내 드라이브(SecondBrainOS 폴더)에 자동 동기화됩니다.';
      return;
    }

    if (!hasToken || driveSyncStatus === 'expired') {
      dot.classList.add('error');
      text.textContent = customLabel || '드라이브 재연결';
      btn.title = 'Google Drive 토큰이 만료되었거나 연결되지 않았습니다. 클릭하여 재연결하세요.';
      return;
    }

    if (driveSyncStatus === 'error') {
      dot.classList.add('error');
      text.textContent = customLabel || '동기화 오류';
      btn.title = '동기화 중 오류가 발생했습니다. 클릭하여 다시 시도하세요.';
      return;
    }

    dot.classList.add('synced');
    const meta = getSyncMeta();
    const timeStr = meta.lastSyncedAt
      ? new Date(meta.lastSyncedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '';
    text.textContent = customLabel || '드라이브 연결됨';
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
      version: '7.0',
      updatedAt: meta.updatedAt || Date.now(),
      fileSystem: state.fileSystem,
      chatHistory: state.chatHistory
    };
  }

  function applyCloudPayload(data, driveFileId) {
    if (!data || !data.fileSystem || !data.fileSystem.id) return false;
    const prevFolderId = state.currentFolder?.id;
    const prevSelectedId = state.selectedItem?.id;

    state.fileSystem = data.fileSystem;
    const foundFolder = prevFolderId ? findNodeAndParent(prevFolderId) : null;
    state.currentFolder = foundFolder && foundFolder.node.type === 'folder' ? foundFolder.node : state.fileSystem;

    const foundSelected = prevSelectedId ? findNodeAndParent(prevSelectedId) : null;
    state.selectedItem = foundSelected ? foundSelected.node : null;

    if (Array.isArray(data.chatHistory)) {
      state.chatHistory = data.chatHistory;
      persistChat({ silent: true });
      renderChatMessages();
    }

    persistFS({ silent: true });
    setSyncMeta({
      updatedAt: Number(data.updatedAt) || Date.now(),
      lastSyncedAt: Date.now(),
      driveDbFileId: driveFileId || '',
      hasUserEdits: true
    });

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

  function openMarkdownWindow(item, initialMode = 'view') {
    if (!item || item.type !== 'doc') return;
    const winId = `md-${item.id}`;
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      const entry = openMdWindows.get(item.id);
      if (entry && initialMode && entry.setMode) entry.setMode(initialMode);
      return;
    }

    const root = document.createElement('div');
    root.className = 'md-app';
    root.innerHTML =
      `<div class="md-toolbar">` +
      `  <div class="md-toolbar-left">` +
      `    <div class="md-mode-tabs">` +
      `      <button type="button" class="md-mode-btn" data-mode="view">📖 보기</button>` +
      `      <button type="button" class="md-mode-btn" data-mode="split">⚡ 분할</button>` +
      `      <button type="button" class="md-mode-btn" data-mode="edit">✏️ 편집</button>` +
      `    </div>` +
      `    <div class="md-format-bar">` +
      `      <button type="button" class="md-fmt-btn" data-fmt="h1" title="제목 1">H1</button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="h2" title="제목 2">H2</button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="bold" title="굵게"><b>B</b></button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="italic" title="기울임"><i>I</i></button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="code" title="코드 블록">&lt;/&gt;</button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="check" title="체크리스트">☑️</button>` +
      `      <button type="button" class="md-fmt-btn" data-fmt="table" title="표 삽입">표</button>` +
      `    </div>` +
      `  </div>` +
      `  <div class="md-toolbar-right">` +
      `    <span class="md-save-indicator">저장됨</span>` +
      `    <button type="button" class="btn-sm btn-primary-soft md-btn-save">💾 저장</button>` +
      `    <button type="button" class="btn-sm md-btn-copy">📋 복사</button>` +
      `  </div>` +
      `</div>` +
      `<div class="md-workspace" data-mode="${initialMode}">` +
      `  <div class="md-editor-pane">` +
      `    <textarea class="md-editor-textarea" placeholder="# 제목을 입력하고 마크다운으로 자유롭게 작성하세요..."></textarea>` +
      `  </div>` +
      `  <div class="md-viewer-pane">` +
      `    <div class="md-viewer-inner markdown-body"></div>` +
      `  </div>` +
      `</div>` +
      `<div class="md-statusbar">` +
      `  <span class="md-stat-left">Markdown Viewer</span>` +
      `  <span class="md-stat-right">0자 · 0줄</span>` +
      `</div>`;

    const workspace = root.querySelector('.md-workspace');
    const formatBar = root.querySelector('.md-format-bar');
    const textarea = root.querySelector('.md-editor-textarea');
    const viewerInner = root.querySelector('.md-viewer-inner');
    const saveIndicator = root.querySelector('.md-save-indicator');
    const btnSave = root.querySelector('.md-btn-save');
    const btnCopy = root.querySelector('.md-btn-copy');
    const statRight = root.querySelector('.md-stat-right');
    const modeButtons = root.querySelectorAll('.md-mode-btn');

    let isDirty = false;
    let currentMode = initialMode;
    let mdAutoSaveTimer = null;

    const updateStats = () => {
      const val = textarea.value || '';
      const chars = val.length;
      const lines = val ? val.split('\n').length : 0;
      statRight.textContent = `${chars.toLocaleString()}자 · ${lines.toLocaleString()}줄`;
    };

    const renderPreview = () => {
      viewerInner.innerHTML = renderMarkdown(textarea.value);
      updateStats();
    };

    const setDirty = (dirty) => {
      isDirty = dirty;
      saveIndicator.textContent = dirty ? '저장 중...' : '☁️ 저장됨';
      saveIndicator.classList.toggle('dirty', dirty);
    };

    const saveMdContent = (silent = false) => {
      if (mdAutoSaveTimer) {
        clearTimeout(mdAutoSaveTimer);
        mdAutoSaveTimer = null;
      }
      const val = textarea.value;
      if (val === (item.summary || '') && !isDirty) return;
      saveStateForUndo();
      item.summary = val;
      saveAndRender();
      scheduleDocFileSyncToDrive(item, true);
      if (state.selectedItem && state.selectedItem.id === item.id && !isEditing) {
        selectItem(item);
      }
      setDirty(false);
      if (!silent) showToast(`💾 "${item.name}" 저장 및 Google Drive 동기화됨`);
    };

    const triggerRealtimeAutoSave = () => {
      setDirty(true);
      renderPreview();
      if (mdAutoSaveTimer) clearTimeout(mdAutoSaveTimer);
      mdAutoSaveTimer = setTimeout(() => {
        mdAutoSaveTimer = null;
        saveMdContent(true);
      }, 1600);
    };

    const setMode = (mode) => {
      currentMode = mode;
      workspace.dataset.mode = mode;
      modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      formatBar.style.display = mode === 'view' ? 'none' : 'inline-flex';
      if (mode !== 'view') textarea.focus();
      renderPreview();
    };

    const insertFormat = (fmt) => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.slice(start, end);
      let replacement = '';
      let cursorOffset = 0;

      if (fmt === 'h1') { replacement = `# ${selected || '제목'}`; cursorOffset = replacement.length; }
      else if (fmt === 'h2') { replacement = `## ${selected || '소제목'}`; cursorOffset = replacement.length; }
      else if (fmt === 'bold') { replacement = `**${selected || '굵은 텍스트'}**`; cursorOffset = replacement.length - 2; }
      else if (fmt === 'italic') { replacement = `*${selected || '기울임'}*`; cursorOffset = replacement.length - 1; }
      else if (fmt === 'code') { replacement = `\n\`\`\`\n${selected || '코드 입력'}\n\`\`\`\n`; cursorOffset = replacement.length - 5; }
      else if (fmt === 'check') { replacement = `\n- [ ] ${selected || '할 일 항목'}`; cursorOffset = replacement.length; }
      else if (fmt === 'table') {
        replacement = `\n| 항목 | 내용 |\n| --- | --- |\n| 예시 1 | 설명 1 |\n`;
        cursorOffset = replacement.length;
      }

      textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);
      textarea.focus();
      textarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
      triggerRealtimeAutoSave();
    };

    // Init content
    textarea.value = item.summary || '';
    setMode(initialMode);

    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    root.querySelectorAll('.md-fmt-btn').forEach((btn) => {
      btn.addEventListener('click', () => insertFormat(btn.dataset.fmt));
    });

    textarea.addEventListener('input', () => {
      triggerRealtimeAutoSave();
    });

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        saveMdContent(false);
      }
    });

    // Interactive checkboxes directly inside MD viewer!
    viewerInner.addEventListener('change', (e) => {
      const chk = e.target.closest('.md-task-checkbox');
      if (!chk) return;
      const idx = Number(chk.dataset.checkboxIndex);
      if (Number.isNaN(idx)) return;
      textarea.value = toggleCheckboxInMarkdown(textarea.value, idx);
      renderPreview();
      saveMdContent(true);
    });

    btnSave.addEventListener('click', () => saveMdContent(false));
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(textarea.value || '').then(() => showToast('📋 마크다운 본문을 복사했습니다.'));
    });

    const win = WinManager.openWindow({
      id: winId,
      title: item.name,
      icon: item.icon || '📝',
      meta: 'MD Viewer',
      width: 860,
      height: 620,
      contentEl: root,
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
        if (isDirty) {
          saveMdContent(true);
        }
        openMdWindows.delete(item.id);
      }
    });

    openMdWindows.set(item.id, {
      win,
      setMode,
      syncFromItem: () => {
        win.setTitle(item.name);
        if (!isDirty) {
          textarea.value = item.summary || '';
          renderPreview();
        }
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

  async function openSpreadsheetWindow(item) {
    if (!item || item.type !== 'doc') return;
    const winId = `sheet-${item.id}`;
    const existing = WinManager.getWindow(winId);
    if (existing) {
      existing.restore();
      return;
    }

    let sheetController = null;
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
      initialViewMode: 'split',
      onToast: showToast,
      onDirtyChange(dirty) {
        win.setMeta(dirty ? '● 수정됨' : 'Excel · Origin 분석기');
      },
      onAutoSave(updatedWb, mdSummary) {
        item.sheetData = updatedWb;
        item.summary = mdSummary;
        persistFS();
        if (state.selectedItem && state.selectedItem.id === item.id) {
          $('p-summary').innerHTML = renderMarkdown(item.summary);
        }
      },
      async onSave(updatedWb, mdSummary) {
        saveStateForUndo();
        item.sheetData = updatedWb;
        item.summary = mdSummary;
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
        showToast(syncedDrive ? `☁️ "${item.name}" 저장 및 Google Drive 동기화 완료` : `💾 "${item.name}" 저장되었습니다.`);
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
    showToast('✅ 기본 Firebase 프로젝트(gen-lang-client-0519883143)로 복원되었습니다.');
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
    refreshBridgeStatus(false);
    updateDriveStatusUI();
  });

  // ================= Initialize =================
  initTheme();
  elChatProvider.value = state.settings.lastProvider || 'gemini';
  populateModels(elChatProvider.value);
  updateApiStatusSummary();
  updateLoginClock();
  setInterval(updateLoginClock, 15000);

  // 시작 시 항상 Windows 스타일 로그인 잠금 화면으로 진입 (목록 비노출)
  showLoginScreen(
    BrainAuth.isConfigComplete(state.settings.firebaseConfig) && !BrainAuth.isFileProtocol()
      ? '🔐 로그인 상태 확인 중...'
      : ''
  );

  if (BrainAuth.isConfigComplete(state.settings.firebaseConfig) && !BrainAuth.isFileProtocol()) {
    BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged)
      .then(() => {
        // 기존 세션이 없으면 안내 문구 정리
        if (!BrainAuth.getUser() && !isAuthBusy && elLoginStatusText) {
          elLoginStatusText.textContent = '';
        }
      })
      .catch((err) => {
        setLoginScreenError(`Firebase 초기화 실패: ${err.message}`);
        if (elLoginStatusText) elLoginStatusText.textContent = '';
      });
  }
  refreshBridgeStatus(false);
})();
