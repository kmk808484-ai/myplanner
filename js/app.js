(function () {
  'use strict';

  const { state, genId, regenerateIds, persistFS, persistSettings, persistChat, saveStateForUndo, findNodeAndParent, isDescendant, getPathToNode, searchNodes, collectDocsInFolder, getTheme, setTheme } = window.BrainStore;
  const { PROVIDERS, sendChat } = window.BrainAI;
  const { render: renderMarkdown, escapeHtml } = window.BrainMarkdown;
  const BrainAuth = window.BrainAuth;
  const LocalBridge = window.BrainLocalBridge;

  let isEditing = false;
  let isSendingChat = false;
  let searchQuery = '';

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
  function showToast(msg) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, 2400);
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
  function saveAndRender() {
    persistFS();
    renderTree(state.fileSystem, elTreeRoot, true);
    if (searchQuery) renderSearchResults(searchQuery);
    else openFolder(state.currentFolder);
    renderContextChips();
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
      card.draggable = true;
      card.innerHTML =
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

      card.addEventListener('dblclick', () => {
        if (item.type === 'folder') {
          clearSearch(false);
          openFolder(item);
          renderTree(state.fileSystem, elTreeRoot, true);
        } else if (item.link && LocalBridge.isWebUrl(item.link)) {
          window.open(item.link, '_blank', 'noopener,noreferrer');
        } else if (item.link && LocalBridge.isLocalPath(item.link)) {
          launchLocalItem(item.link, 'open');
        } else if (isHtmlContentItem(item)) {
          runHtmlContent(item);
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

  // ================= CRUD, Clipboard & Undo =================
  function createNew(type) {
    saveStateForUndo();
    const newItem = {
      id: genId(),
      type,
      name: type === 'folder' ? '새 폴더' : '새 메모',
      icon: type === 'folder' ? '📁' : '📝',
      tag: type === 'folder' ? '' : '#메모',
      summary: '',
      link: '',
      children: type === 'folder' ? [] : undefined
    };
    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newItem);
    saveAndRender();
    selectItem(newItem);
    toggleEditMode(true);
    showToast(type === 'folder' ? '새 폴더를 만들었습니다.' : '새 메모를 만들었습니다.');
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

    if (state.clipboard.action === 'cut') {
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
      regenerateIds(newItem);
    }

    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newItem);
    saveAndRender();
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
    const found = findNodeAndParent(state.selectedItem.id);
    if (found && found.parent) {
      found.parent.children = found.parent.children.filter((c) => c.id !== state.selectedItem.id);
    }
    state.attachedContextIds = state.attachedContextIds.filter((id) => id !== state.selectedItem.id);
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

  elContentArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elContentArea.classList.remove('drag-over');
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    saveStateForUndo();
    const file = e.dataTransfer.files[0];
    const fileName = file.name;
    const ext = fileName.split('.').pop().toLowerCase();

    let fileIcon = '📄';
    let fileTag = '#Doc';
    if (['md', 'txt'].includes(ext)) { fileIcon = '📝'; fileTag = '#Note'; }
    else if (['html', 'htm', 'js', 'ts', 'py', 'css', 'json'].includes(ext)) { fileIcon = '💻'; fileTag = '#Code'; }
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) { fileIcon = '🖼️'; fileTag = '#Image'; }
    else if (ext === 'pdf') { fileIcon = '📕'; fileTag = '#Book'; }

    const textReadable = ['md', 'txt', 'json', 'csv', 'js', 'ts', 'py', 'html', 'htm', 'css', 'xml', 'yml', 'yaml'];

    const createDroppedItem = (contentText) => {
      const newItem = {
        id: genId(),
        type: 'doc',
        name: fileName,
        icon: fileIcon,
        tag: fileTag,
        summary: contentText || '',
        link: ''
      };
      if (!state.currentFolder.children) state.currentFolder.children = [];
      state.currentFolder.children.push(newItem);
      saveAndRender();
      selectItem(newItem);
      showToast(`"${fileName}" 파일이 추가되었습니다.`);
    };

    if (textReadable.includes(ext) && file.size <= 500 * 1024) {
      const reader = new FileReader();
      reader.onload = () => createDroppedItem(String(reader.result || ''));
      reader.onerror = () => createDroppedItem('');
      reader.readAsText(file, 'utf-8');
    } else {
      createDroppedItem('');
    }
  });

  // ================= Detail Preview & Edit =================
  function clearSelectionView() {
    state.selectedItem = null;
    isEditing = false;
    elDetailState.style.display = 'none';
    elEmptyState.style.display = 'flex';
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
    const btnOpenLocal = $('btn-open-local');
    const btnRevealLocal = $('btn-reveal-local');
    if (item.link && LocalBridge.isLocalPath(item.link)) {
      linkBadge.style.display = 'inline-block';
      linkBadge.href = '#';
      linkBadge.removeAttribute('target');
      linkBadge.dataset.localPath = item.link;
      linkBadge.textContent = `🖥️ ${item.link.length > 28 ? item.link.slice(0, 28) + '…' : item.link}`;
      btnOpenLocal.textContent = '🚀 로컬에서 실행';
      btnRevealLocal.style.display = '';
      localActionRow.style.display = 'flex';
    } else if (item.link) {
      linkBadge.style.display = 'inline-block';
      linkBadge.href = item.link;
      linkBadge.setAttribute('target', '_blank');
      delete linkBadge.dataset.localPath;
      linkBadge.textContent = `🔗 ${item.link.length > 28 ? item.link.slice(0, 28) + '…' : item.link}`;
      localActionRow.style.display = 'none';
    } else if (isHtmlContentItem(item)) {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      btnOpenLocal.textContent = '🌐 HTML 바로 실행';
      btnRevealLocal.style.display = 'none';
      localActionRow.style.display = 'flex';
    } else {
      linkBadge.style.display = 'none';
      delete linkBadge.dataset.localPath;
      localActionRow.style.display = 'none';
    }

    $('p-summary').innerHTML = renderMarkdown(item.summary);
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
    else if (action === 'open-local') {
      if (state.selectedItem && state.selectedItem.link && LocalBridge.isLocalPath(state.selectedItem.link)) {
        launchLocalItem(state.selectedItem.link, 'open');
      } else if (state.selectedItem && state.selectedItem.link && LocalBridge.isWebUrl(state.selectedItem.link)) {
        window.open(state.selectedItem.link, '_blank', 'noopener,noreferrer');
      } else if (isHtmlContentItem(state.selectedItem)) {
        runHtmlContent(state.selectedItem);
      } else {
        showToast('실행할 로컬 경로가 없습니다. 메모 수정에서 경로를 입력해 주세요.');
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

  function renderContextChips() {
    const docs = getAttachedDocs();
    elContextChips.innerHTML = '';

    if (docs.length === 0) {
      elContextBar.style.display = 'none';
      elContextCountBadge.style.display = 'none';
      return;
    }

    elContextBar.style.display = 'flex';
    elContextCountBadge.style.display = 'inline-block';
    elContextCountBadge.textContent = String(docs.length);

    docs.forEach((doc) => {
      const chip = document.createElement('span');
      chip.className = 'context-chip';
      chip.innerHTML = `<span>${escapeHtml(doc.icon || '📄')} ${escapeHtml(doc.name)}</span><button title="제거">✕</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.attachedContextIds = state.attachedContextIds.filter((id) => id !== doc.id);
        renderContextChips();
      });
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
    const cleanTitle = firstLine.replace(/^[#*\-\s]+/, '').slice(0, 36);
    const provLabel = PROVIDERS[msg.provider]?.label || 'AI';

    const newNote = {
      id: genId(),
      type: 'doc',
      name: cleanTitle || `${provLabel} 답변`,
      icon: '🤖',
      tag: `#AI #${provLabel}`,
      link: '',
      summary: msg.content
    };
    if (!state.currentFolder.children) state.currentFolder.children = [];
    state.currentFolder.children.push(newNote);
    saveAndRender();
    showToast(`"${state.currentFolder.name}" 폴더에 메모로 저장되었습니다.`);
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
        contextDocs: getAttachedDocs()
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

  // ================= Google Auth & Local Lock =================
  const elAuthModal = $('auth-modal');

  function isOwnerAuthenticated() {
    return BrainAuth.isOwner(state.settings.ownerEmail);
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
    const ownerEmail = (state.settings.ownerEmail || '').trim();
    const hasConfig = BrainAuth.isConfigComplete(state.settings.firebaseConfig);
    const isFile = BrainAuth.isFileProtocol();
    const card = $('auth-status-card');
    const titleEl = $('auth-status-title');
    const subEl = $('auth-status-sub');
    const btnSignIn = $('btn-firebase-google-login');
    const btnSignOut = $('btn-google-signout');
    const fileWarn = $('auth-file-warning');

    card.classList.remove('unlocked', 'denied');
    fileWarn.style.display = isFile ? 'block' : 'none';

    if (unlocked && user) {
      card.classList.add('unlocked');
      titleEl.textContent = `🔓 본인 인증 완료 (${user.email})`;
      subEl.textContent = '저장한 로컬 항목을 보고 Windows 연결 프로그램으로 실행할 수 있습니다. (브라우저를 닫으면 자동으로 다시 잠깁니다.)';
      btnSignIn.style.display = 'none';
      btnSignOut.style.display = 'block';
    } else if (user) {
      card.classList.add('denied');
      titleEl.textContent = `🚫 접근 거부됨 (${user.email})`;
      subEl.textContent = ownerEmail
        ? `허용된 내 구글 이메일(${ownerEmail})과 다른 계정입니다. 본인 계정으로 다시 로그인해 주세요.`
        : '아래에 허용할 내 구글 이메일을 입력하고 저장해 주세요.';
      btnSignIn.style.display = isFile ? 'none' : 'flex';
      btnSignIn.disabled = !hasConfig;
      btnSignOut.style.display = 'block';
    } else {
      titleEl.textContent = '🔒 잠김 상태 (로컬 항목 숨김)';
      subEl.textContent = hasConfig
        ? (ownerEmail
          ? `허용된 계정(${ownerEmail})으로 Firebase Google 로그인하면 저장한 로컬 파일과 실행 기능이 열립니다.`
          : '아래에 허용할 내 구글 이메일을 입력한 뒤 Google 로그인을 눌러 주세요.')
        : '아래에 Firebase 설정(firebaseConfig)과 내 구글 이메일을 입력한 뒤 로그인해 주세요.';
      btnSignIn.style.display = isFile ? 'none' : 'flex';
      btnSignIn.disabled = !hasConfig;
      btnSignOut.style.display = 'none';
    }
  }

  function handleAuthUserChanged() {
    onAuthStateChanged();
    if (elAuthModal.style.display === 'flex') {
      renderAuthModalContent();
    }
  }

  function onAuthStateChanged() {
    updateAuthButtonUI();

    if (!isOwnerAuthenticated()) {
      if (state.selectedItem && !isItemVisible(state.selectedItem)) {
        clearSelectionView();
      }
      const curPath = getPathToNode(state.currentFolder?.id) || [];
      if (curPath.some((n) => !isItemVisible(n))) {
        state.currentFolder = state.fileSystem;
      }
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

  $('btn-firebase-google-login').addEventListener('click', async () => {
    saveAuthFormToState();
    const btn = $('btn-firebase-google-login');
    btn.disabled = true;
    try {
      const user = await BrainAuth.signInWithGoogle(state.settings.firebaseConfig);
      if (user) {
        if (!state.settings.ownerEmail) {
          state.settings.ownerEmail = user.email;
          persistSettings();
          $('auth-owner-email').value = user.email;
        }
        onAuthStateChanged();
        if (isOwnerAuthenticated()) {
          closeAuthModal();
          showToast(`🔓 ${user.email} 로그인 완료! 저장된 로컬 항목이 열렸습니다.`);
        } else {
          renderAuthModalContent();
          showToast(`🚫 허용된 계정(${state.settings.ownerEmail})이 아닙니다. 로컬 항목은 잠금 유지됩니다.`);
        }
      }
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
      renderAuthModalContent();
    }
  });

  $('btn-google-signout').addEventListener('click', async () => {
    await BrainAuth.signOut();
    onAuthStateChanged();
    renderAuthModalContent();
    showToast('🔒 로그아웃되었습니다. 저장된 로컬 항목이 다시 숨겨졌습니다.');
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
      if (ok && (!health.allowedEmailConfigured || !health.firebaseConfigured)) {
        showToast('⚠️ 로컬 브릿지 연결됨 — local-bridge/bridge-config.json에 firebaseApiKey와 allowedEmail을 설정해 주세요.');
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

  $('btn-open-local').addEventListener('click', () => {
    if (state.selectedItem?.link && LocalBridge.isLocalPath(state.selectedItem.link)) {
      launchLocalItem(state.selectedItem.link, 'open');
    } else if (isHtmlContentItem(state.selectedItem)) {
      runHtmlContent(state.selectedItem);
    }
  });

  $('btn-reveal-local').addEventListener('click', () => {
    if (state.selectedItem?.link) launchLocalItem(state.selectedItem.link, 'reveal');
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
      if (!health.allowedEmailConfigured || !health.firebaseConfigured) {
        showToast('⚠️ 연결됨 — local-bridge/bridge-config.json에 firebaseApiKey와 allowedEmail을 입력해 주세요.');
      } else {
        showToast('🟢 연결 성공! Firebase Google 로그인 후 로컬 프로그램을 실행할 수 있습니다.');
      }
    } else {
      showToast('⚪ 연결 실패: local-bridge/로컬연결_실행.bat 실행 여부를 확인해 주세요.');
    }
  });

  window.addEventListener('focus', () => {
    refreshBridgeStatus(false);
  });

  // ================= Initialize =================
  initTheme();
  elChatProvider.value = state.settings.lastProvider || 'gemini';
  populateModels(elChatProvider.value);
  updateApiStatusSummary();
  updateAuthButtonUI();
  renderTree(state.fileSystem, elTreeRoot, true);
  openFolder(state.currentFolder);
  renderChatMessages();
  renderContextChips();
  updateLocalLockBanner();
  if (BrainAuth.isConfigComplete(state.settings.firebaseConfig)) {
    BrainAuth.init(state.settings.firebaseConfig, handleAuthUserChanged).catch(() => {});
  }
  refreshBridgeStatus(false);
})();
