(function (global) {
  'use strict';

  const Icons = global.BrainIcons;
  const svg = (name, size = 16, cls = '') => (Icons ? Icons.svg(name, size, cls) : '');

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRelativeTime(ts) {
    const n = Number(ts || 0);
    if (!n) return '방금 전';
    const diffSec = Math.max(0, Math.floor((Date.now() - n) / 1000));
    if (diffSec < 60) return '방금 전';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}일 전`;
    const d = new Date(n);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function getGreeting(now = new Date()) {
    const h = now.getHours();
    if (h >= 5 && h < 12) return '좋은 아침이에요';
    if (h >= 12 && h < 18) return '좋은 오후예요';
    return '좋은 저녁이에요';
  }

  function getKoreanFullDate(now = new Date()) {
    return now.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  }

  function computeDdayInfo(dueDateStr) {
    if (!dueDateStr) return { text: '미지정', days: null, urgent: false, overdue: false };
    const m = String(dueDateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { text: '미지정', days: null, urgent: false, overdue: false };
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const days = Math.round((target - t0) / 86400000);
    if (days < 0) return { text: `D+${Math.abs(days)}`, days, urgent: true, overdue: true };
    if (days === 0) return { text: 'D-Day', days: 0, urgent: true, overdue: false };
    return { text: `D-${days}`, days, urgent: days <= 7, overdue: false };
  }

  function isThisMonth(ts) {
    if (!ts) return false;
    const d = new Date(Number(ts));
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function mountParaDashboard(hooks) {
    const Store = global.BrainStore;
    let activeView = 'home'; // 'home' | 'inbox' | 'project' | 'area' | 'resource' | 'archive' | 'review'
    let inboxTab = 'all';    // 'all' | 'memos' | 'files' | 'tasks' | 'done'
    let projectFilter = 'all'; // 'all' | 'active' | 'hold'
    let archiveFilter = 'all'; // 'all' | 'project' | 'area' | 'resource'
    let showInlineComposer = false;
    let showLifeExpanded = true;
    let lifeUserToggled = false;
    let sidebarAppsOpen = false;
    let openClassifyPopover = null; // { itemId, paraType }

    const $ = (id) => document.getElementById(id);

    // ---- Data Helpers ----
    function getAllVisibleDocs() {
      return Store.collectAllNodes(Store.state.fileSystem)
        .filter((n) => n && n.type === 'doc' && hooks.isItemVisible(n));
    }

    function getActiveProjects() {
      return Store.getParaEntities('project', { onlyActive: true })
        .sort((a, b) => {
          const da = computeDdayInfo(a.dueDate).days;
          const db = computeDdayInfo(b.dueDate).days;
          if (da !== null && db !== null && da !== db) return da - db;
          if (da !== null) return -1;
          if (db !== null) return 1;
          return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        });
    }

    function getUnifiedInboxData() {
      const unassignedDocs = Store.getUnassignedNodes(hooks.isItemVisible)
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      const dfp = hooks.loadDfpState();
      const memos = unassignedDocs.filter((d) => !hooks.isSpreadsheetItem(d) && (!d.driveFile || /\.md$/i.test(d.name || '')));
      const files = unassignedDocs.filter((d) => !memos.includes(d));
      const backlogTasks = (dfp.backlog || []).filter((t) => !t.docId || !unassignedDocs.some((d) => d.id === t.docId));
      return {
        unassignedDocs,
        memos,
        files,
        backlogTasks,
        doneTasks: dfp.archive || [],
        totalCount: unassignedDocs.length + backlogTasks.length
      };
    }

    function getLinkedCount(entityId) {
      const seen = new Set();
      (Store.state.relations || []).forEach((r) => {
        if (r.sourceId === entityId || r.targetId === entityId) {
          const otherId = r.sourceId === entityId ? r.targetId : r.sourceId;
          const n = Store.findNodeAndParent(otherId)?.node;
          if (n && hooks.isItemVisible(n)) seen.add(n.id);
        }
      });
      return seen.size;
    }

    function getDocPrimaryParaLabel(doc) {
      const rels = Store.getRelationsForNode(doc.id);
      if (rels.projects?.length) return '프로젝트';
      if (rels.areas?.length) return '영역';
      if (rels.resources?.length) return '자료';
      if (rels.archives?.length) return '보관';
      return '수신함';
    }

    function computeKpis() {
      const projects = getActiveProjects();
      const dueThisWeek = projects.filter((p) => {
        const d = computeDdayInfo(p.dueDate).days;
        return d !== null && d <= 7;
      }).length;
      const inbox = getUnifiedInboxData();
      const archivedThisMonth = Store.getParaEntities('archive').filter((e) => isThisMonth(e.archivedAt || e.updatedAt)).length;
      return {
        activeProjects: projects.length,
        dueThisWeek,
        inboxCount: inbox.totalCount,
        archivedThisMonth
      };
    }

    // ---- Project Edit / Create Modal ----
    function openProjectModal(entity = null, defaultType = 'project') {
      const modal = $('para-entity-modal');
      if (!modal) return;
      const isEdit = Boolean(entity);
      const pType = entity?.paraType || defaultType;
      const typeLabelMap = { project: '프로젝트', area: '영역', resource: '자료', archive: '보관 항목' };

      $('pem-title').textContent = isEdit
        ? `${typeLabelMap[pType] || '항목'} 편집`
        : `새 ${typeLabelMap[pType] || '프로젝트'} 만들기`;
      $('pem-id').value = entity?.id || '';
      $('pem-type').value = pType;
      $('pem-name').value = entity?.name || '';
      $('pem-summary').value = entity?.summary || '';

      const projFields = $('pem-project-fields');
      if (projFields) projFields.style.display = pType === 'project' ? 'grid' : 'none';
      if (pType === 'project') {
        $('pem-due').value = entity?.dueDate || '';
        $('pem-status').value = entity?.status || 'active';
        $('pem-progress').value = String(entity?.progress ?? 0);
        $('pem-progress-val').textContent = `${entity?.progress ?? 0}%`;
      }

      const completeBtn = $('pem-complete-archive-btn');
      if (completeBtn) {
        completeBtn.style.display = (isEdit && pType === 'project' && !entity.archived) ? 'inline-flex' : 'none';
      }
      const delBtn = $('pem-delete-btn');
      if (delBtn) delBtn.style.display = isEdit ? 'inline-flex' : 'none';

      modal.style.display = 'flex';
      setTimeout(() => $('pem-name')?.focus(), 20);
    }

    function bindProjectModalOnce() {
      const modal = $('para-entity-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';

      const close = () => { modal.style.display = 'none'; };
      $('pem-close-btn')?.addEventListener('click', close);
      $('pem-cancel-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      $('pem-progress')?.addEventListener('input', (e) => {
        if ($('pem-progress-val')) $('pem-progress-val').textContent = `${e.target.value}%`;
      });

      $('pem-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = $('pem-id').value.trim();
        const pType = $('pem-type').value || 'project';
        const name = $('pem-name').value.trim();
        const summary = $('pem-summary').value.trim();
        if (!name) {
          $('pem-name').focus();
          return;
        }
        Store.saveStateForUndo();
        if (id) {
          const patch = { name, summary };
          if (pType === 'project') {
            patch.dueDate = $('pem-due').value.trim();
            patch.status = $('pem-status').value || 'active';
            patch.progress = Number($('pem-progress').value || 0);
            if (patch.status === 'completed') {
              patch.archived = true;
              patch.progress = 100;
            }
          }
          Store.updateParaEntity(id, patch);
          hooks.showToast(`"${name}" 수정되었습니다.`);
        } else {
          const created = Store.declareParaEntity({
            paraType: pType,
            name,
            summary,
            archived: pType === 'archive',
            dueDate: pType === 'project' ? $('pem-due').value.trim() : '',
            status: pType === 'project' ? ($('pem-status').value || 'active') : '',
            progress: pType === 'project' ? Number($('pem-progress').value || 0) : 0
          });
          if (created) hooks.showToast(`"${created.name}" 생성되었습니다.`);
        }
        close();
        hooks.saveAndRender();
        renderAll();
      });

      $('pem-complete-archive-btn')?.addEventListener('click', () => {
        const id = $('pem-id').value.trim();
        if (!id) return;
        const ent = Store.completeAndArchiveProject(id);
        if (ent) {
          close();
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`"${ent.name}" 완료 처리 후 보관함(Archives)으로 이동했습니다.`);
        }
      });

      $('pem-delete-btn')?.addEventListener('click', () => {
        const id = $('pem-id').value.trim();
        const ent = Store.findParaEntity(id);
        if (!ent || !confirm(`"${ent.name}" 선언을 삭제할까요? (연결된 물리 파일은 삭제되지 않습니다)`)) return;
        Store.removeParaEntity(id);
        close();
        hooks.saveAndRender();
        renderAll();
        hooks.showToast(`"${ent.name}" 삭제되었습니다.`);
      });
    }

    // ---- Quick Classify Popover ([P] [A] [R] buttons) ----
    function openQuickClassifyMenu(anchorEl, doc, paraType) {
      closeQuickClassifyMenu();
      const pop = document.createElement('div');
      pop.className = 'sb-quick-classify-pop';
      pop.id = 'sb-quick-classify-pop';

      const typeNames = { project: '프로젝트', area: '영역', resource: '자료' };
      const entities = Store.getParaEntities(paraType, { onlyActive: true });

      pop.innerHTML =
        `<div class="sb-qcp-head">` +
        `  <span>${typeNames[paraType]}에 연결</span>` +
        `  <button type="button" class="sb-icon-btn-xs" data-qcp-close="1">${svg('close', 12)}</button>` +
        `</div>` +
        `<div class="sb-qcp-list">` +
        (entities.length > 0
          ? entities.map((e) =>
              `<button type="button" class="sb-qcp-item" data-eid="${esc(e.id)}">` +
              `  ${svg(paraType, 14)}` +
              `  <span>${esc(e.name)}</span>` +
              `</button>`
            ).join('')
          : `<div class="sb-qcp-empty">아직 ${typeNames[paraType]}가 없어요</div>`) +
        `</div>` +
        `<form class="sb-qcp-create">` +
        `  <input type="text" class="sb-qcp-input" placeholder="새 ${typeNames[paraType]} 만들고 연결...">` +
        `  <button type="submit" class="sb-qcp-submit">추가</button>` +
        `</form>`;

      document.body.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      const popW = 228;
      const left = Math.max(8, Math.min(window.innerWidth - popW - 10, rect.right - popW));
      const top = Math.min(window.innerHeight - 240, rect.bottom + 6);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;

      pop.addEventListener('click', (e) => e.stopPropagation());
      pop.querySelector('[data-qcp-close]')?.addEventListener('click', closeQuickClassifyMenu);

      pop.querySelectorAll('.sb-qcp-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const eid = btn.dataset.eid;
          const ent = Store.findParaEntity(eid);
          if (ent) {
            Store.addRelation({ sourceId: doc.id, targetId: ent.id, type: paraType });
            Store.touchNode(doc);
            hooks.saveAndRender();
            renderAll();
            hooks.showToast(`"${doc.name.replace(/\.md$/i, '')}" → ${typeNames[paraType]} [${ent.name}] 연결됨`);
          }
          closeQuickClassifyMenu();
        });
      });

      pop.querySelector('.sb-qcp-create')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = pop.querySelector('.sb-qcp-input');
        const newName = String(inp?.value || '').trim();
        if (!newName) return;
        const created = Store.declareParaEntity({ paraType, name: newName });
        if (created) {
          Store.addRelation({ sourceId: doc.id, targetId: created.id, type: paraType });
          Store.touchNode(doc);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`새 ${typeNames[paraType]} "${created.name}" 생성 및 연결 완료`);
        }
        closeQuickClassifyMenu();
      });

      openClassifyPopover = pop;
    }

    function closeQuickClassifyMenu() {
      if (openClassifyPopover) {
        openClassifyPopover.remove();
        openClassifyPopover = null;
      }
    }

    // ---- Quick Memo Capture (Auto-routes to Inbox when no PARA picked) ----
    function captureQuickMemo({ title = '', body = '', addToTodo = false, paraType = '', paraId = '' }) {
      const rawTitle = String(title || '').trim();
      const rawBody = String(body || '').trim();
      if (!rawTitle && !rawBody) return null;

      Store.saveStateForUndo();
      const todayStr = hooks.getTodayYMD();
      const inboxFolder = hooks.getOrCreateDailyMemoFolder();
      const firstLine = (rawTitle || rawBody.split('\n')[0] || '메모')
        .replace(/^[#\-*\s]+/, '')
        .slice(0, 44)
        .trim() || '메모';
      const fileName = hooks.getUniqueNameInFolder(inboxFolder, firstLine, '.md');
      const now = Date.now();
      const newDoc = {
        id: Store.genId(),
        type: 'doc',
        name: fileName,
        icon: '📝',
        tag: paraId ? `#메모 #${todayStr}` : `#수신함 #${todayStr}`,
        summary: rawBody ? (rawTitle ? `# ${rawTitle}\n\n${rawBody}` : rawBody) : `# ${firstLine}`,
        link: '',
        dailyDate: todayStr,
        createdAt: now,
        updatedAt: now
      };
      inboxFolder.children.unshift(newDoc);

      if (paraType && paraId && Store.findParaEntity(paraId)) {
        Store.addRelation({ sourceId: newDoc.id, targetId: paraId, type: paraType });
      }

      if (addToTodo) {
        const dfp = hooks.loadDfpState();
        if (dfp.top3.length < 3) {
          dfp.top3.push({ id: `t-${Store.genId()}`, title: firstLine, docId: newDoc.id, time: '' });
        } else {
          dfp.backlog.unshift({ id: `t-${Store.genId()}`, title: firstLine, docId: newDoc.id });
        }
        hooks.saveDfpState(dfp);
      }

      hooks.saveAndRender();
      hooks.syncDocAfterSave(newDoc);
      renderAll();
      hooks.showToast(
        paraId
          ? `저장됨: ${fileName}`
          : `수신함(Inbox)에 자동 저장됨: ${fileName}`
      );
      return newDoc;
    }

    // ---- Render Left Sidebar inside Home Shell ----
    function renderSidebar() {
      const navEl = $('para-nav-list');
      const miniTreeEl = $('para-home-mini-tree');
      const foldersEl = $('para-home-folders');
      const footerEl = $('para-sidebar-status');
      if (!navEl) return;

      const kpis = computeKpis();
      const areaCnt = Store.getParaEntities('area', { onlyActive: true }).length;
      const resCnt = Store.getParaEntities('resource', { onlyActive: true }).length;
      const archCnt = Store.getParaEntities('archive').length;
      const reviewAlertCnt = getReviewAlerts().totalAlerts;

      const items = [
        { id: 'home', label: '홈', icon: 'home', badge: 0 },
        { id: 'inbox', label: '수신함', icon: 'inbox', badge: kpis.inboxCount },
        { id: 'project', label: '프로젝트', icon: 'project', badge: kpis.activeProjects, subtle: true },
        { id: 'area', label: '영역', icon: 'area', badge: areaCnt, subtle: true },
        { id: 'resource', label: '자료', icon: 'resource', badge: resCnt, subtle: true },
        { id: 'archive', label: '보관', icon: 'archive', badge: archCnt, subtle: true }
      ];

      navEl.innerHTML =
        items.map((it) => `
          <button type="button" class="sb-nav-item${activeView === it.id ? ' active' : ''}" data-pnav="${it.id}">
            <span class="sb-nav-ico">${svg(it.icon, 16)}</span>
            <span class="sb-nav-lbl">${it.label}</span>
            ${it.badge > 0 ? `<span class="sb-nav-badge${it.subtle ? ' subtle' : ''}">${it.badge}</span>` : ''}
          </button>
        `).join('') +
        `<div class="sb-nav-sep"></div>` +
        `<button type="button" class="sb-nav-item${activeView === 'review' ? ' active' : ''}" data-pnav="review">` +
        `  <span class="sb-nav-ico">${svg('review', 16)}</span>` +
        `  <span class="sb-nav-lbl">주간 리뷰</span>` +
        (reviewAlertCnt > 0 ? `<span class="sb-nav-dot" title="정리가 필요한 항목 ${reviewAlertCnt}건"></span>` : '') +
        `</button>` +
        `<button type="button" class="sb-nav-item" data-paction="explorer">` +
        `  <span class="sb-nav-ico">${svg('explorer', 16)}</span>` +
        `  <span class="sb-nav-lbl">탐색기</span>` +
        `</button>` +
        `<button type="button" class="sb-nav-item" data-paction="toggle-apps">` +
        `  <span class="sb-nav-ico">${svg('apps', 16)}</span>` +
        `  <span class="sb-nav-lbl">앱</span>` +
        `  <span class="sb-nav-chev">${svg(sidebarAppsOpen ? 'chevronDown' : 'chevronRight', 13)}</span>` +
        `</button>` +
        (sidebarAppsOpen ? renderSidebarAppsHtml() : '');

      navEl.querySelectorAll('[data-pnav]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeView = btn.dataset.pnav;
          renderAll();
        });
      });

      navEl.querySelector('[data-paction="explorer"]')?.addEventListener('click', () => {
        hooks.setHomeMode(false);
      });
      navEl.querySelector('[data-paction="toggle-apps"]')?.addEventListener('click', () => {
        sidebarAppsOpen = !sidebarAppsOpen;
        renderSidebar();
      });
      navEl.querySelectorAll('[data-builtin-app]').forEach((btn) => {
        btn.addEventListener('click', () => hooks.launchBuiltinApp(btn.dataset.builtinApp));
      });
      navEl.querySelectorAll('[data-pinned-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const node = Store.findNodeAndParent(btn.dataset.pinnedId)?.node;
          if (node) hooks.launchItemDirectly(node);
        });
      });
      navEl.querySelector('[data-paction="add-app"]')?.addEventListener('click', () => {
        hooks.openPinAppModal();
      });

      // Mini PARA Tree
      if (miniTreeEl) {
        const proj = getActiveProjects().slice(0, 4);
        const areas = Store.getParaEntities('area', { onlyActive: true }).slice(0, 3);
        const res = Store.getParaEntities('resource', { onlyActive: true }).slice(0, 3);
        const allMini = [...proj, ...areas, ...res];
        if (allMini.length === 0) {
          miniTreeEl.innerHTML =
            `<button type="button" class="sb-empty-inline-btn" id="sb-sidebar-empty-proj">` +
            `아직 프로젝트가 없어요 · <b>만들기</b>` +
            `</button>`;
          $('sb-sidebar-empty-proj')?.addEventListener('click', () => openProjectModal(null, 'project'));
        } else {
          miniTreeEl.innerHTML = allMini.map((ent) => `
            <button type="button" class="sb-mini-tree-row" data-open-ent="${esc(ent.id)}" title="${esc(ent.name)}">
              <span class="sb-dot-ind type-${ent.paraType}"></span>
              <span class="sb-mini-tree-name">${esc(ent.name)}</span>
              <span class="sb-mini-tree-cnt">${getLinkedCount(ent.id)}</span>
            </button>
          `).join('');
          miniTreeEl.querySelectorAll('[data-open-ent]').forEach((b) => {
            b.addEventListener('click', () => {
              const ent = Store.findParaEntity(b.dataset.openEnt);
              if (ent) {
                hooks.setHomeMode(false);
                hooks.openParaVirtualView({ mode: 'entity', entityId: ent.id });
              }
            });
          });
        }
      }

      // Physical Folders ("내 폴더")
      if (foldersEl) {
        const topFolders = (Store.state.fileSystem?.children || [])
          .filter((c) => c && c.type === 'folder' && hooks.isItemVisible(c));
        if (topFolders.length === 0) {
          foldersEl.innerHTML =
            `<button type="button" class="sb-empty-inline-btn" id="sb-sidebar-empty-folder">` +
            `아직 폴더가 없어요 · <b>만들기</b>` +
            `</button>`;
          $('sb-sidebar-empty-folder')?.addEventListener('click', () => {
            hooks.setHomeMode(false);
            hooks.createNew('folder');
          });
        } else {
          foldersEl.innerHTML = topFolders.map((f) => `
            <button type="button" class="sb-mini-tree-row" data-open-folder="${esc(f.id)}">
              <span class="sb-nav-ico">${svg('folder', 14)}</span>
              <span class="sb-mini-tree-name">${esc(f.name)}</span>
            </button>
          `).join('');
          foldersEl.querySelectorAll('[data-open-folder]').forEach((b) => {
            b.addEventListener('click', () => {
              const found = Store.findNodeAndParent(b.dataset.openFolder)?.node;
              if (found) {
                hooks.setHomeMode(false);
                hooks.openPhysicalFolder(found);
              }
            });
          });
        }
      }

      if (footerEl) {
        footerEl.textContent = hooks.getSidebarStatusText();
      }
    }

    function renderSidebarAppsHtml() {
      const pinned = (Store.state.pinnedAppIds || [])
        .map((id) => Store.findNodeAndParent(id)?.node)
        .filter((n) => n && hooks.isItemVisible(n));
      return `
        <div class="sb-nav-subapps">
          <button type="button" class="sb-nav-subitem" data-builtin-app="relation-map">${svg('graph', 14)}<span>관계 맵</span></button>
          <button type="button" class="sb-nav-subitem" data-builtin-app="spreadsheet">${svg('sheet', 14)}<span>엑셀 시트</span></button>
          <button type="button" class="sb-nav-subitem" data-builtin-app="origin">${svg('chart', 14)}<span>Origin 그래프</span></button>
          <button type="button" class="sb-nav-subitem" data-builtin-app="markdown">${svg('doc', 14)}<span>새 마크다운</span></button>
          ${pinned.map((it) => `
            <button type="button" class="sb-nav-subitem" data-pinned-id="${esc(it.id)}">
              ${svg('apps', 13)}<span>${esc(it.name.replace(/\.(html?|md|xlsx)$/i, ''))}</span>
            </button>
          `).join('')}
          <button type="button" class="sb-nav-subitem sb-nav-subadd" data-paction="add-app">${svg('plus', 13)}<span>앱 추가</span></button>
        </div>
      `;
    }

    // ---- Render Home Dashboard Main View (Image-Faithful Layout) ----
    function renderHomeView(canvas) {
      const now = new Date();
      const kpis = computeKpis();
      const projects = getActiveProjects();
      const dfp = hooks.loadDfpState();
      const todayStr = hooks.getTodayYMD();
      const doneToday = Math.min(3, Number(dfp.completedDates?.[todayStr] || 0));
      const inbox = getUnifiedInboxData();
      const recentDocs = getAllVisibleDocs()
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .slice(0, 4);

      const nextSched = hooks.computeNextScheduleInstance(dfp, now);
      const clockStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      let schedPillText = '일정 없음';
      let lifeAutoExpand = false;
      if (nextSched) {
        const departTime = new Date(nextSched.arrival.getTime() - (nextSched.travel + nextSched.buffer) * 60000);
        const prepTime = new Date(departTime.getTime() - nextSched.prep * 60000);
        const minsToPrep = Math.round((prepTime.getTime() - now.getTime()) / 60000);
        const minsToDepart = Math.round((departTime.getTime() - now.getTime()) / 60000);
        schedPillText = `${nextSched.sched.title} · ${hooks.formatHHMM(departTime)} 출발`;
        if (minsToPrep <= 0 || minsToDepart <= 90) lifeAutoExpand = true;
      }
      if (!lifeUserToggled) {
        showLifeExpanded = Boolean(nextSched || lifeAutoExpand);
      }

      canvas.innerHTML = `
        <!-- Greeting & Clock/Schedule Header -->
        <header class="sb-home-header">
          <div>
            <h1 class="sb-greeting-title">${getGreeting(now)}</h1>
            <p class="sb-greeting-date">${getKoreanFullDate(now)}</p>
          </div>
          <div class="sb-home-header-pills">
            <span class="sb-meta-pill sb-clock-pill" id="home-clock">${clockStr}</span>
            <button type="button" class="sb-meta-pill sb-sched-pill" id="sb-open-schedule-btn">
              ${svg('calendar', 14)}
              <span id="dfp-next-schedule-badge">${esc(schedPillText)}</span>
            </button>
          </div>
        </header>

        <!-- 4 KPI Cards -->
        <section class="sb-kpi-grid">
          <button type="button" class="sb-kpi-card" data-jump-view="project">
            <div class="sb-kpi-icon">${svg('project', 17)}</div>
            <div class="sb-kpi-label">진행 중 프로젝트</div>
            <div class="sb-kpi-val">${kpis.activeProjects}</div>
          </button>
          <button type="button" class="sb-kpi-card" data-jump-view="project">
            <div class="sb-kpi-icon">${svg('clock', 17)}</div>
            <div class="sb-kpi-label">이번 주 마감</div>
            <div class="sb-kpi-val">${kpis.dueThisWeek}</div>
          </button>
          <button type="button" class="sb-kpi-card" data-jump-view="inbox">
            <div class="sb-kpi-icon">${svg('inbox', 17)}</div>
            <div class="sb-kpi-label">수신함 미분류</div>
            <div class="sb-kpi-val">${kpis.inboxCount}</div>
          </button>
          <button type="button" class="sb-kpi-card" data-jump-view="archive">
            <div class="sb-kpi-icon">${svg('archive', 17)}</div>
            <div class="sb-kpi-label">이번 달 보관</div>
            <div class="sb-kpi-val">${kpis.archivedThisMonth}</div>
          </button>
        </section>

        <!-- Main 2-Column Workspace Grid -->
        <section class="sb-home-grid">
          <!-- Left: Active Projects Table -->
          <div class="sb-card sb-projects-card">
            <div class="sb-card-head">
              <div class="sb-card-title-wrap">
                <span class="sb-card-ico">${svg('project', 16)}</span>
                <h2 class="sb-card-title">진행 중 프로젝트</h2>
              </div>
              <div class="sb-card-head-actions">
                <button type="button" class="sb-link-btn" id="sb-btn-new-proj-inline">＋ 추가</button>
                <button type="button" class="sb-link-btn" data-jump-view="project">모든 프로젝트 보기 ${svg('arrowRight', 13)}</button>
              </div>
            </div>
            <div id="sb-home-projects-body"></div>
          </div>

          <!-- Right Column: Top 3 + Inbox -->
          <div class="sb-home-right-col">
            <!-- Today's Top 3 -->
            <div class="sb-card sb-top3-card">
              <div class="sb-card-head">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('star', 16)}</span>
                  <h2 class="sb-card-title">오늘의 핵심 3가지</h2>
                </div>
                <span class="sb-pill-counter" id="dfp-completion-badge">${doneToday} / 3</span>
              </div>
              <div class="sb-top3-list" id="sb-home-top3-list"></div>
              <form class="sb-top3-quick-form" id="sb-top3-quick-form">
                <input type="text" id="sb-top3-quick-input" class="sb-inline-input" placeholder="핵심 할 일 입력 후 Enter...">
                <input type="time" id="sb-top3-quick-time" class="sb-time-mini-input" title="목표 시각 (선택)">
                <button type="submit" class="sb-btn-subtle">추가</button>
              </form>
              <div class="sb-card-foot-right">
                <button type="button" class="sb-link-btn" data-jump-inbox-tab="tasks">전체 보기 ${svg('arrowRight', 13)}</button>
              </div>
            </div>

            <!-- Unified Inbox Preview Card -->
            <div class="sb-card sb-inbox-card">
              <div class="sb-card-head">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('inbox', 16)}</span>
                  <h2 class="sb-card-title">수신함 (Inbox)</h2>
                </div>
                <div class="sb-card-head-actions">
                  <button type="button" class="sb-link-btn" id="sb-toggle-quick-memo">＋ 빠른 메모</button>
                  <button type="button" class="sb-link-btn" data-jump-view="inbox">모든 수신함 보기 ${svg('arrowRight', 13)}</button>
                </div>
              </div>
              <div class="sb-inbox-sub">분류되지 않은 항목 · ${inbox.totalCount}건</div>

              <div class="sb-quick-composer${showInlineComposer ? '' : ' is-hidden'}" id="sb-inline-composer">
                <input type="text" id="sb-qm-title" class="sb-field-input" placeholder="제목 (비워두면 첫 줄 사용)">
                <textarea id="sb-qm-body" rows="3" class="sb-field-textarea" placeholder="빠르게 기록하세요... PARA를 고르지 않으면 자동으로 수신함에 쌓입니다 (Ctrl+Enter)"></textarea>
                <div class="sb-qm-foot">
                  <label class="sb-check-inline">
                    <input type="checkbox" id="sb-qm-todo">
                    <span>오늘 할 일에도 추가</span>
                  </label>
                  <button type="button" class="sb-btn-primary-sm" id="sb-qm-save">저장</button>
                </div>
              </div>

              <div class="sb-inbox-preview-list" id="sb-home-inbox-list"></div>
            </div>
          </div>
        </section>

        <!-- Recent Materials 4-Card Strip -->
        <section class="sb-card sb-recent-card">
          <div class="sb-card-head">
            <div class="sb-card-title-wrap">
              <span class="sb-card-ico">${svg('doc', 16)}</span>
              <h2 class="sb-card-title">최근 자료</h2>
            </div>
            <button type="button" class="sb-link-btn" id="sb-open-explorer-from-recent">탐색기에서 전체 보기 ${svg('arrowRight', 13)}</button>
          </div>
          <div class="sb-recent-grid" id="sb-home-recent-grid"></div>
        </section>

        <!-- Reverse-Time Schedule Traffic Light & Outing Checklist (Preserved Core Life Feature!) -->
        <section class="sb-card sb-life-card" id="sb-life-card">
          <div class="sb-life-bar-head" id="sb-life-toggle-bar">
            <div class="sb-life-bar-left">
              <span class="sb-life-live-dot" id="sb-life-live-dot"></span>
              <span class="sb-life-bar-title">일정 신호등 · 외출 체크</span>
              <span class="sb-life-bar-summary" id="sb-life-bar-summary"></span>
            </div>
            <div class="sb-life-bar-right">
              <button type="button" class="sb-btn-subtle" id="sb-life-open-sched">일정 설정</button>
              <span class="sb-life-chev">${svg(showLifeExpanded ? 'chevronDown' : 'chevronRight', 15)}</span>
            </div>
          </div>
          <div class="sb-life-body${showLifeExpanded ? '' : ' is-hidden'}" id="sb-life-body">
            <div id="dfp-traffic-bar" class="dfp-traffic-banner bar-safe">
              <div class="dfp-traffic-inner">
                <div class="dfp-traffic-signal-col">
                  <div class="dfp-traffic-housing" aria-label="다음 일정 신호등">
                    <div id="dfp-bulb-green" class="dfp-bulb bulb-green-off"></div>
                    <div id="dfp-bulb-yellow" class="dfp-bulb bulb-yellow-off"></div>
                    <div id="dfp-bulb-red" class="dfp-bulb bulb-red-off"></div>
                  </div>
                  <span id="dfp-traffic-badge" class="dfp-traffic-badge">여유</span>
                </div>
                <div class="dfp-traffic-center">
                  <div class="dfp-countdown-row">
                    <h3 id="dfp-countdown-headline" class="dfp-countdown-headline">예정된 일정 없음</h3>
                  </div>
                  <div class="dfp-progress-track">
                    <div id="dfp-schedule-progress" class="dfp-progress-fill"></div>
                  </div>
                  <div id="dfp-timeline-summary" class="dfp-timeline-summary"></div>
                </div>
                <div class="dfp-traffic-right">
                  <div class="dfp-outing-box">
                    <div class="dfp-outing-head">
                      <span>외출 체크</span>
                      <div class="sb-flex-gap-xs">
                        <button type="button" id="dfp-toggle-checklist-add" class="dfp-mini-icon-btn" title="체크 항목 추가">＋</button>
                        <button type="button" id="dfp-reset-checklist" class="dfp-mini-icon-btn" title="체크 초기화">↺</button>
                      </div>
                    </div>
                    <div id="dfp-checklist-items" class="dfp-outing-chips"></div>
                    <form id="dfp-checklist-form" class="dfp-checklist-form is-hidden">
                      <input type="text" id="dfp-checklist-input" placeholder="항목 추가..." maxlength="15" class="dfp-input-sm">
                      <button type="submit" class="dfp-btn-dark-sm">추가</button>
                    </form>
                  </div>
                  <button type="button" id="dfp-complete-schedule-btn" class="dfp-depart-btn is-hidden">✓ 출발 완료</button>
                </div>
              </div>
            </div>
          </div>
        </section>
      `;

      // Bind view jumps
      canvas.querySelectorAll('[data-jump-view]').forEach((el) => {
        el.addEventListener('click', () => {
          activeView = el.dataset.jumpView;
          renderAll();
        });
      });
      canvas.querySelectorAll('[data-jump-inbox-tab]').forEach((el) => {
        el.addEventListener('click', () => {
          activeView = 'inbox';
          inboxTab = el.dataset.jumpInboxTab || 'tasks';
          renderAll();
        });
      });
      $('sb-open-schedule-btn')?.addEventListener('click', () => hooks.openScheduleModal());
      $('sb-life-open-sched')?.addEventListener('click', (e) => {
        e.stopPropagation();
        hooks.openScheduleModal();
      });
      $('sb-life-toggle-bar')?.addEventListener('click', () => {
        lifeUserToggled = true;
        showLifeExpanded = !showLifeExpanded;
        $('sb-life-body')?.classList.toggle('is-hidden', !showLifeExpanded);
        const chev = $('sb-life-toggle-bar')?.querySelector('.sb-life-chev');
        if (chev) chev.innerHTML = svg(showLifeExpanded ? 'chevronDown' : 'chevronRight', 15);
      });
      $('sb-btn-new-proj-inline')?.addEventListener('click', () => openProjectModal(null, 'project'));
      $('sb-open-explorer-from-recent')?.addEventListener('click', () => hooks.setHomeMode(false));

      // Fill Projects Table
      renderProjectsTableInto($('sb-home-projects-body'), projects.slice(0, 6), true);

      // Fill Top 3
      renderHomeTop3Into($('sb-home-top3-list'), dfp);
      $('sb-top3-quick-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('sb-top3-quick-input');
        const timeInp = $('sb-top3-quick-time');
        const title = String(inp?.value || '').trim();
        if (!title) return;
        const cur = hooks.loadDfpState();
        const item = { id: `t-${Store.genId()}`, title, time: String(timeInp?.value || '').trim() };
        if (cur.top3.length < 3) cur.top3.push(item);
        else cur.backlog.unshift(item);
        hooks.saveDfpState(cur);
        if (inp) inp.value = '';
        if (timeInp) timeInp.value = '';
        renderAll();
      });

      // Fill Quick Memo Composer
      $('sb-toggle-quick-memo')?.addEventListener('click', () => {
        showInlineComposer = !showInlineComposer;
        $('sb-inline-composer')?.classList.toggle('is-hidden', !showInlineComposer);
        if (showInlineComposer) $('sb-qm-body')?.focus();
      });
      const doQuickSave = () => {
        const title = $('sb-qm-title')?.value || '';
        const body = $('sb-qm-body')?.value || '';
        if (!String(title).trim() && !String(body).trim()) return;
        showInlineComposer = false;
        captureQuickMemo({
          title,
          body,
          addToTodo: Boolean($('sb-qm-todo')?.checked)
        });
      };
      $('sb-qm-save')?.addEventListener('click', doQuickSave);
      $('sb-qm-body')?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          doQuickSave();
        }
      });

      // Fill Inbox Preview List
      renderInboxPreviewInto($('sb-home-inbox-list'), inbox);

      // Fill Recent Materials
      renderRecentDocsInto($('sb-home-recent-grid'), recentDocs);

      // Bind & render live Reverse-Time Traffic Light & Outing Checklist
      bindLifeTrafficControls();
      refreshTrafficLightVisuals();
    }

    function renderProjectsTableInto(container, projects, compact = false) {
      if (!container) return;
      if (projects.length === 0) {
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>아직 진행 중인 프로젝트가 없어요</span>
            <button type="button" class="sb-empty-cta" data-empty-create-proj="1">· 새 프로젝트 만들기</button>
          </div>
        `;
        container.querySelector('[data-empty-create-proj]')?.addEventListener('click', () => openProjectModal(null, 'project'));
        return;
      }

      container.innerHTML = `
        <div class="sb-proj-table">
          <div class="sb-proj-thead">
            <span>프로젝트</span>
            <span>진행도</span>
            <span>마감까지</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          ${projects.map((p) => {
            const dday = computeDdayInfo(p.dueDate);
            const isHold = p.status === 'hold';
            const statusText = isHold ? '보류' : '진행';
            const prog = Math.max(0, Math.min(100, Number(p.progress || 0)));
            const linkedCnt = getLinkedCount(p.id);
            return `
              <div class="sb-proj-row" data-pid="${esc(p.id)}">
                <button type="button" class="sb-proj-name-btn" data-pact="edit" title="클릭하여 편집 · 연결 자료 ${linkedCnt}건">
                  <span class="sb-proj-dot ${isHold ? 'is-hold' : 'is-active'}"></span>
                  <span class="sb-proj-name">${esc(p.name)}</span>
                  ${!compact && linkedCnt > 0 ? `<span class="sb-proj-linked-mini">${linkedCnt}</span>` : ''}
                </button>
                <div class="sb-proj-prog-cell" data-pact="step-prog" title="클릭하여 진행도 +10% 조절">
                  <div class="sb-prog-track"><div class="sb-prog-fill" style="width:${prog}%"></div></div>
                  <span class="sb-prog-pct">${prog}%</span>
                </div>
                <div>
                  <button type="button" class="sb-dday-pill${dday.urgent ? ' is-urgent' : ''}${dday.days === null ? ' is-empty' : ''}" data-pact="edit" title="마감일 설정">${esc(dday.text)}</button>
                </div>
                <div>
                  <button type="button" class="sb-status-pill ${isHold ? 'is-hold' : 'is-active'}" data-pact="toggle-status" title="클릭하여 진행/보류 전환">${statusText}</button>
                </div>
                <div class="sb-proj-act-cell">
                  <button type="button" class="sb-complete-link" data-pact="complete">완료 → 보관</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      container.querySelectorAll('.sb-proj-row').forEach((row) => {
        const pid = row.dataset.pid;
        const ent = Store.findParaEntity(pid);
        if (!ent) return;

        row.querySelectorAll('[data-pact="edit"]').forEach((b) => {
          b.addEventListener('click', () => openProjectModal(ent, 'project'));
        });
        row.querySelector('[data-pact="step-prog"]')?.addEventListener('click', () => {
          const next = ent.progress >= 100 ? 0 : Math.min(100, Math.round((ent.progress || 0) / 10) * 10 + 10);
          Store.updateParaEntity(ent.id, { progress: next });
          renderAll();
        });
        row.querySelector('[data-pact="toggle-status"]')?.addEventListener('click', () => {
          const nextStatus = ent.status === 'hold' ? 'active' : 'hold';
          Store.updateParaEntity(ent.id, { status: nextStatus });
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`"${ent.name}" 상태: ${nextStatus === 'hold' ? '보류' : '진행'}`);
        });
        row.querySelector('[data-pact="complete"]')?.addEventListener('click', () => {
          Store.completeAndArchiveProject(ent.id);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`"${ent.name}" 완료 후 보관함(Archives)으로 보냈습니다.`);
        });
      });
    }

    function renderHomeTop3Into(container, dfp) {
      if (!container) return;
      const tasks = dfp.top3 || [];
      if (tasks.length === 0) {
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>아직 오늘의 핵심 3가지가 없어요</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-focus-top3">· 아래에서 추가하기</button>
          </div>
        `;
        $('sb-empty-focus-top3')?.addEventListener('click', () => $('sb-top3-quick-input')?.focus());
        return;
      }

      container.innerHTML = tasks.map((t, idx) => `
        <div class="sb-top3-row" data-tidx="${idx}">
          <button type="button" class="sb-checkbox-box" data-tact="done" title="완료 처리" aria-label="완료">${svg('check', 12)}</button>
          <span class="sb-top3-title" contenteditable="true" spellcheck="false">${esc(t.title)}</span>
          ${t.time ? `<span class="sb-top3-time">${esc(formatKoreanTime(t.time))}</span>` : ''}
          ${t.docId ? `<button type="button" class="sb-mini-ghost" data-tact="open-doc" title="연결 메모 열기">${svg('doc', 13)}</button>` : ''}
        </div>
      `).join('');

      container.querySelectorAll('.sb-top3-row').forEach((row) => {
        const idx = Number(row.dataset.tidx);
        const task = tasks[idx];
        row.querySelector('[data-tact="done"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          const removed = cur.top3.splice(idx, 1)[0];
          if (removed) {
            const todayStr = hooks.getTodayYMD();
            cur.archive.unshift({ ...removed, completedAt: todayStr });
            if (!cur.completedDates) cur.completedDates = {};
            cur.completedDates[todayStr] = Number(cur.completedDates[todayStr] || 0) + 1;
            hooks.saveDfpState(cur);
            renderAll();
            hooks.showToast(`완료됨: ${removed.title}`);
          }
        });
        row.querySelector('[data-tact="open-doc"]')?.addEventListener('click', () => {
          const doc = Store.findNodeAndParent(task?.docId)?.node;
          if (doc) hooks.launchItemDirectly(doc);
        });
        const titleEl = row.querySelector('.sb-top3-title');
        titleEl?.addEventListener('blur', () => {
          const next = titleEl.textContent.trim();
          if (next && next !== task?.title) {
            const cur = hooks.loadDfpState();
            if (cur.top3[idx]) {
              cur.top3[idx].title = next;
              hooks.saveDfpState(cur);
            }
          }
        });
        titleEl?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
        });
      });
    }

    function formatKoreanTime(hhmm) {
      const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return hhmm;
      const h = Number(m[1]);
      const mm = m[2];
      const ampm = h < 12 ? '오전' : '오후';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${ampm} ${h12}:${mm}`;
    }

    function renderInboxPreviewInto(container, inbox) {
      if (!container) return;
      const docs = inbox.unassignedDocs.slice(0, 3);
      if (docs.length === 0 && inbox.backlogTasks.length === 0) {
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>수신함이 비어 있어요</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-new-memo">· 빠른 메모 남기기</button>
          </div>
        `;
        $('sb-empty-new-memo')?.addEventListener('click', () => {
          showInlineComposer = true;
          $('sb-inline-composer')?.classList.remove('is-hidden');
          $('sb-qm-body')?.focus();
        });
        return;
      }

      const rowsHtml = docs.map((doc) => {
        const snippet = String(doc.summary || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
        return `
          <div class="sb-inbox-item" data-doc-id="${esc(doc.id)}">
            <span class="sb-inbox-item-ico">${svg(hooks.isSpreadsheetItem(doc) ? 'sheet' : 'doc', 15)}</span>
            <div class="sb-inbox-item-text" data-open-doc="1">
              <div class="sb-inbox-item-title">${esc(doc.name.replace(/\.md$/i, ''))}</div>
              <div class="sb-inbox-item-snippet">${esc(snippet || '내용 없음')}</div>
            </div>
            <div class="sb-par-btns">
              <button type="button" class="sb-par-btn" data-par="project" title="프로젝트로 분류">P</button>
              <button type="button" class="sb-par-btn" data-par="area" title="영역으로 분류">A</button>
              <button type="button" class="sb-par-btn" data-par="resource" title="자료로 분류">R</button>
            </div>
          </div>
        `;
      }).join('');

      const taskPreviewHtml = docs.length < 3
        ? inbox.backlogTasks.slice(0, 3 - docs.length).map((t) => `
            <div class="sb-inbox-item is-task">
              <span class="sb-inbox-item-ico">${svg('star', 14)}</span>
              <div class="sb-inbox-item-text">
                <div class="sb-inbox-item-title">${esc(t.title)}</div>
                <div class="sb-inbox-item-snippet">할 일 대기 목록</div>
              </div>
              <button type="button" class="sb-mini-ghost" data-promote-task="${esc(t.id)}" title="오늘의 핵심 3가지로 올리기">핵심</button>
            </div>
          `).join('')
        : '';

      container.innerHTML = rowsHtml + taskPreviewHtml;

      container.querySelectorAll('.sb-inbox-item[data-doc-id]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.docId)?.node;
        if (!doc) return;
        row.querySelector('[data-open-doc]')?.addEventListener('click', () => hooks.launchItemDirectly(doc));
        row.querySelectorAll('[data-par]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openQuickClassifyMenu(btn, doc, btn.dataset.par);
          });
        });
      });

      container.querySelectorAll('[data-promote-task]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          if (cur.top3.length >= 3) {
            hooks.showToast('오늘의 핵심 3가지가 모두 찼습니다.');
            return;
          }
          const idx = cur.backlog.findIndex((x) => x.id === btn.dataset.promoteTask);
          if (idx >= 0) {
            const [picked] = cur.backlog.splice(idx, 1);
            cur.top3.push(picked);
            hooks.saveDfpState(cur);
            renderAll();
          }
        });
      });
    }

    function renderRecentDocsInto(container, docs) {
      if (!container) return;
      if (docs.length === 0) {
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>아직 최근 자료가 없어요</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-create-doc">· 새 메모 만들기</button>
          </div>
        `;
        $('sb-empty-create-doc')?.addEventListener('click', () => hooks.createNew('doc'));
        return;
      }

      container.innerHTML = docs.map((doc) => `
        <button type="button" class="sb-recent-item" data-rdoc="${esc(doc.id)}">
          <span class="sb-recent-ico">${svg(hooks.isSpreadsheetItem(doc) ? 'sheet' : 'doc', 16)}</span>
          <div class="sb-recent-meta">
            <div class="sb-recent-name">${esc(doc.name.replace(/\.md$/i, ''))}</div>
            <div class="sb-recent-sub">${esc(getDocPrimaryParaLabel(doc))} · ${esc(formatRelativeTime(doc.updatedAt || doc.createdAt))}</div>
          </div>
        </button>
      `).join('');

      container.querySelectorAll('[data-rdoc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const doc = Store.findNodeAndParent(btn.dataset.rdoc)?.node;
          if (doc) hooks.launchItemDirectly(doc);
        });
      });
    }

    function bindLifeTrafficControls() {
      $('dfp-toggle-checklist-add')?.addEventListener('click', () => {
        const f = $('dfp-checklist-form');
        if (f) {
          f.classList.toggle('is-hidden');
          if (!f.classList.contains('is-hidden')) $('dfp-checklist-input')?.focus();
        }
      });
      $('dfp-reset-checklist')?.addEventListener('click', () => {
        const cur = hooks.loadDfpState();
        (cur.checklist || []).forEach((c) => { c.checked = false; });
        hooks.saveDfpState(cur);
        refreshTrafficLightVisuals();
      });
      $('dfp-checklist-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('dfp-checklist-input');
        const txt = String(inp?.value || '').trim();
        if (!txt) return;
        const cur = hooks.loadDfpState();
        cur.checklist.push({ id: `c-${Store.genId()}`, text: txt, checked: false });
        hooks.saveDfpState(cur);
        if (inp) inp.value = '';
        refreshTrafficLightVisuals();
      });
    }

    function refreshTrafficLightVisuals() {
      if (typeof hooks.renderDfpTrafficLight === 'function') {
        hooks.renderDfpTrafficLight();
      }
      const dfp = hooks.loadDfpState();
      const now = new Date();
      const next = hooks.computeNextScheduleInstance(dfp, now);
      const sumEl = $('sb-life-bar-summary');
      const dotEl = $('sb-life-live-dot');
      if (!sumEl || !dotEl) return;

      dotEl.classList.remove('is-safe', 'is-warn', 'is-urgent');
      if (!next) {
        dotEl.classList.add('is-safe');
        sumEl.textContent = '예정된 일정 없음 · 여유';
        return;
      }
      const departTime = new Date(next.arrival.getTime() - (next.travel + next.buffer) * 60000);
      const prepTime = new Date(departTime.getTime() - next.prep * 60000);
      const minsToDepart = Math.round((departTime.getTime() - now.getTime()) / 60000);
      const minsToPrep = Math.round((prepTime.getTime() - now.getTime()) / 60000);
      if (minsToDepart <= 0) {
        dotEl.classList.add('is-urgent');
        sumEl.textContent = `${next.sched.title} · 즉시 출발 (${Math.abs(minsToDepart)}분 초과)`;
      } else if (minsToPrep <= 0) {
        dotEl.classList.add('is-warn');
        sumEl.textContent = `${next.sched.title} · 준비 중 (출발까지 ${minsToDepart}분 · ${hooks.formatHHMM(departTime)} 출발)`;
      } else {
        dotEl.classList.add('is-safe');
        sumEl.textContent = `${next.sched.title} · 준비 ${hooks.formatHHMM(prepTime)} → 출발 ${hooks.formatHHMM(departTime)}`;
      }
    }

    // ---- Render Unified Inbox View ----
    function renderInboxView(canvas) {
      const inbox = getUnifiedInboxData();
      const projects = Store.getParaEntities('project', { onlyActive: true });
      const areas = Store.getParaEntities('area', { onlyActive: true });
      const resources = Store.getParaEntities('resource', { onlyActive: true });

      const paraOptionsHtml =
        `<option value="">PARA 미선택 (수신함에 자동 저장)</option>` +
        (projects.length ? `<optgroup label="프로젝트">${projects.map((e) => `<option value="project::${esc(e.id)}">${esc(e.name)}</option>`).join('')}</optgroup>` : '') +
        (areas.length ? `<optgroup label="영역">${areas.map((e) => `<option value="area::${esc(e.id)}">${esc(e.name)}</option>`).join('')}</optgroup>` : '') +
        (resources.length ? `<optgroup label="자료">${resources.map((e) => `<option value="resource::${esc(e.id)}">${esc(e.name)}</option>`).join('')}</optgroup>` : '');

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">수신함 (Inbox)</h1>
            <p class="sb-page-sub">미분류 메모, 지정되지 않은 파일, 대기 중인 할 일을 한 곳에서 정리하고 P·A·R로 분류하세요.</p>
          </div>
        </header>

        <section class="sb-card sb-inbox-composer-card">
          <div class="sb-composer-grid">
            <input type="text" id="sb-inbox-title" class="sb-field-input" placeholder="메모 제목 (선택)">
            <select id="sb-inbox-para-select" class="sb-field-select">${paraOptionsHtml}</select>
          </div>
          <textarea id="sb-inbox-body" rows="4" class="sb-field-textarea" placeholder="떠오르는 아이디어, 회의 메모, 할 일을 빠르게 기록하세요... (Ctrl+Enter 저장)"></textarea>
          <div class="sb-qm-foot">
            <label class="sb-check-inline">
              <input type="checkbox" id="sb-inbox-add-todo">
              <span>오늘의 핵심/할 일 대기에도 추가</span>
            </label>
            <button type="button" class="sb-btn-primary" id="sb-inbox-save-btn">수신함에 저장</button>
          </div>
        </section>

        <section class="sb-card">
          <div class="sb-subtabs">
            <button type="button" class="sb-subtab${inboxTab === 'all' ? ' active' : ''}" data-itab="all">전체 <span>${inbox.totalCount}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'memos' ? ' active' : ''}" data-itab="memos">미분류 메모 <span>${inbox.memos.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'files' ? ' active' : ''}" data-itab="files">미분류 파일 <span>${inbox.files.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'tasks' ? ' active' : ''}" data-itab="tasks">할 일 대기 <span>${inbox.backlogTasks.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'done' ? ' active' : ''}" data-itab="done">완료된 할 일 <span>${inbox.doneTasks.length}</span></button>
          </div>
          <div class="sb-inbox-full-list" id="sb-inbox-full-list"></div>
        </section>
      `;

      const doInboxSave = () => {
        const paraVal = $('sb-inbox-para-select')?.value || '';
        const [pType, pId] = paraVal.includes('::') ? paraVal.split('::') : ['', ''];
        captureQuickMemo({
          title: $('sb-inbox-title')?.value || '',
          body: $('sb-inbox-body')?.value || '',
          addToTodo: Boolean($('sb-inbox-add-todo')?.checked),
          paraType: pType,
          paraId: pId
        });
      };
      $('sb-inbox-save-btn')?.addEventListener('click', doInboxSave);
      $('sb-inbox-body')?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doInboxSave(); }
      });

      canvas.querySelectorAll('[data-itab]').forEach((b) => {
        b.addEventListener('click', () => {
          inboxTab = b.dataset.itab;
          renderInboxView(canvas);
        });
      });

      const listEl = $('sb-inbox-full-list');
      if (!listEl) return;

      if (inboxTab === 'done') {
        if (inbox.doneTasks.length === 0) {
          listEl.innerHTML = `<div class="sb-empty-line"><span>완료된 할 일이 아직 없어요</span></div>`;
          return;
        }
        listEl.innerHTML =
          `<div class="sb-list-toolbar"><button type="button" class="sb-link-btn" id="sb-clear-done-tasks">완료 기록 비우기</button></div>` +
          inbox.doneTasks.slice(0, 50).map((t, idx) => `
            <div class="sb-inbox-full-row is-done">
              <div class="sb-inbox-item-text">
                <div class="sb-inbox-item-title">${esc(t.title)}</div>
                <div class="sb-inbox-item-snippet">완료일 · ${esc(t.completedAt || '')}</div>
              </div>
              <button type="button" class="sb-btn-subtle" data-restore-task="${idx}">대기로 복원</button>
            </div>
          `).join('');
        $('sb-clear-done-tasks')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          cur.archive = [];
          hooks.saveDfpState(cur);
          renderAll();
        });
        listEl.querySelectorAll('[data-restore-task]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const cur = hooks.loadDfpState();
            const [item] = cur.archive.splice(Number(btn.dataset.restoreTask), 1);
            if (item) {
              cur.backlog.unshift(item);
              hooks.saveDfpState(cur);
              renderAll();
            }
          });
        });
        return;
      }

      const docsToShow = inboxTab === 'memos'
        ? inbox.memos
        : (inboxTab === 'files' ? inbox.files : (inboxTab === 'all' ? inbox.unassignedDocs : []));
      const tasksToShow = (inboxTab === 'tasks' || inboxTab === 'all') ? inbox.backlogTasks : [];

      if (docsToShow.length === 0 && tasksToShow.length === 0) {
        listEl.innerHTML = `<div class="sb-empty-line"><span>정리할 항목이 없어요 · 완벽해요!</span></div>`;
        return;
      }

      let html = '';
      if (inboxTab === 'tasks') {
        html += `
          <form class="sb-top3-quick-form sb-mb-sm" id="sb-backlog-add-form">
            <input type="text" id="sb-backlog-add-input" class="sb-inline-input" placeholder="대기 할 일 추가 후 Enter...">
            <button type="submit" class="sb-btn-primary-sm">추가</button>
          </form>
        `;
      }

      html += docsToShow.map((doc) => {
        const snippet = String(doc.summary || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
        return `
          <div class="sb-inbox-full-row" data-doc-id="${esc(doc.id)}">
            <span class="sb-inbox-item-ico">${svg(hooks.isSpreadsheetItem(doc) ? 'sheet' : 'doc', 16)}</span>
            <div class="sb-inbox-item-text" data-open-doc="1">
              <div class="sb-inbox-item-title">${esc(doc.name.replace(/\.md$/i, ''))}</div>
              <div class="sb-inbox-item-snippet">${esc(snippet || '내용 없음')} · ${esc(formatRelativeTime(doc.updatedAt || doc.createdAt))}</div>
            </div>
            <div class="sb-par-btns">
              <button type="button" class="sb-par-btn" data-par="project" title="프로젝트 연결">P</button>
              <button type="button" class="sb-par-btn" data-par="area" title="영역 연결">A</button>
              <button type="button" class="sb-par-btn" data-par="resource" title="자료 연결">R</button>
              <button type="button" class="sb-mini-ghost" data-locate-doc="1" title="탐색기에서 보기">${svg('explorer', 13)}</button>
            </div>
          </div>
        `;
      }).join('');

      html += tasksToShow.map((t) => `
        <div class="sb-inbox-full-row" data-task-id="${esc(t.id)}">
          <span class="sb-inbox-item-ico">${svg('star', 15)}</span>
          <div class="sb-inbox-item-text">
            <div class="sb-inbox-item-title">${esc(t.title)}</div>
            <div class="sb-inbox-item-snippet">할 일 대기 목록</div>
          </div>
          <div class="sb-par-btns">
            <button type="button" class="sb-btn-subtle" data-tact="up">핵심 3가지로</button>
            <button type="button" class="sb-btn-subtle" data-tact="done">완료</button>
            <button type="button" class="sb-mini-ghost" data-tact="del" title="삭제">${svg('trash', 13)}</button>
          </div>
        </div>
      `).join('');

      listEl.innerHTML = html;

      $('sb-backlog-add-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('sb-backlog-add-input');
        const title = String(inp?.value || '').trim();
        if (!title) return;
        const cur = hooks.loadDfpState();
        cur.backlog.unshift({ id: `t-${Store.genId()}`, title });
        hooks.saveDfpState(cur);
        renderAll();
      });

      listEl.querySelectorAll('[data-doc-id]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.docId)?.node;
        if (!doc) return;
        row.querySelector('[data-open-doc]')?.addEventListener('click', () => hooks.launchItemDirectly(doc));
        row.querySelector('[data-locate-doc]')?.addEventListener('click', () => hooks.navigateToNode(doc));
        row.querySelectorAll('[data-par]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openQuickClassifyMenu(btn, doc, btn.dataset.par);
          });
        });
      });

      listEl.querySelectorAll('[data-task-id]').forEach((row) => {
        const tid = row.dataset.taskId;
        row.querySelector('[data-tact="up"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          if (cur.top3.length >= 3) { hooks.showToast('오늘의 핵심 3가지가 모두 찼습니다.'); return; }
          const idx = cur.backlog.findIndex((x) => x.id === tid);
          if (idx >= 0) { cur.top3.push(cur.backlog.splice(idx, 1)[0]); hooks.saveDfpState(cur); renderAll(); }
        });
        row.querySelector('[data-tact="done"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          const idx = cur.backlog.findIndex((x) => x.id === tid);
          if (idx >= 0) {
            cur.archive.unshift({ ...cur.backlog.splice(idx, 1)[0], completedAt: hooks.getTodayYMD() });
            hooks.saveDfpState(cur);
            renderAll();
          }
        });
        row.querySelector('[data-tact="del"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          cur.backlog = cur.backlog.filter((x) => x.id !== tid);
          hooks.saveDfpState(cur);
          renderAll();
        });
      });
    }

    // ---- Render PARA Stage Views (Project / Area / Resource / Archive) ----
    function renderParaStageView(canvas, stageType) {
      const meta = {
        project: { title: '프로젝트', sub: '마감일과 명확한 완료 기준이 있는 목표를 관리하고, 완료되면 보관소로 보내세요.' },
        area: { title: '영역', sub: '건강, 재무, 업무 등 지속적으로 기준을 유지해야 하는 책임 영역입니다.' },
        resource: { title: '자료', sub: '향후 참고할 지식, 가이드, 레퍼런스 주제를 모아 두는 공간입니다.' },
        archive: { title: '보관 (Archives)', sub: '완료된 프로젝트와 더 이상 활성 상태가 아닌 영역·자료를 안전하게 보관합니다.' }
      }[stageType];

      if (stageType === 'project') {
        const allActive = getActiveProjects();
        const filtered = allActive.filter((p) => {
          if (projectFilter === 'active') return p.status !== 'hold';
          if (projectFilter === 'hold') return p.status === 'hold';
          return true;
        });
        canvas.innerHTML = `
          <header class="sb-page-header">
            <div>
              <h1 class="sb-page-title">${meta.title}</h1>
              <p class="sb-page-sub">${meta.sub}</p>
            </div>
            <button type="button" class="sb-btn-primary" id="sb-stage-add-btn">＋ 새 프로젝트</button>
          </header>
          <section class="sb-card">
            <div class="sb-subtabs">
              <button type="button" class="sb-subtab${projectFilter === 'all' ? ' active' : ''}" data-pf="all">전체 <span>${allActive.length}</span></button>
              <button type="button" class="sb-subtab${projectFilter === 'active' ? ' active' : ''}" data-pf="active">진행 <span>${allActive.filter((p) => p.status !== 'hold').length}</span></button>
              <button type="button" class="sb-subtab${projectFilter === 'hold' ? ' active' : ''}" data-pf="hold">보류 <span>${allActive.filter((p) => p.status === 'hold').length}</span></button>
            </div>
            <div id="sb-stage-proj-table"></div>
          </section>
        `;
        $('sb-stage-add-btn')?.addEventListener('click', () => openProjectModal(null, 'project'));
        canvas.querySelectorAll('[data-pf]').forEach((b) => {
          b.addEventListener('click', () => { projectFilter = b.dataset.pf; renderParaStageView(canvas, 'project'); });
        });
        renderProjectsTableInto($('sb-stage-proj-table'), filtered, false);
        return;
      }

      if (stageType === 'archive') {
        const allArchived = Store.getParaEntities('archive').sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        const filtered = archiveFilter === 'all' ? allArchived : allArchived.filter((e) => e.paraType === archiveFilter);
        const typeKo = { project: '프로젝트', area: '영역', resource: '자료' };

        canvas.innerHTML = `
          <header class="sb-page-header">
            <div>
              <h1 class="sb-page-title">${meta.title}</h1>
              <p class="sb-page-sub">${meta.sub}</p>
            </div>
          </header>
          <section class="sb-card">
            <div class="sb-subtabs">
              <button type="button" class="sb-subtab${archiveFilter === 'all' ? ' active' : ''}" data-af="all">전체 <span>${allArchived.length}</span></button>
              <button type="button" class="sb-subtab${archiveFilter === 'project' ? ' active' : ''}" data-af="project">완료 프로젝트 <span>${allArchived.filter((e) => e.paraType === 'project').length}</span></button>
              <button type="button" class="sb-subtab${archiveFilter === 'area' ? ' active' : ''}" data-af="area">보관 영역 <span>${allArchived.filter((e) => e.paraType === 'area').length}</span></button>
              <button type="button" class="sb-subtab${archiveFilter === 'resource' ? ' active' : ''}" data-af="resource">보관 자료 <span>${allArchived.filter((e) => e.paraType === 'resource').length}</span></button>
            </div>
            <div class="sb-entity-grid" id="sb-archive-grid"></div>
          </section>
        `;
        canvas.querySelectorAll('[data-af]').forEach((b) => {
          b.addEventListener('click', () => { archiveFilter = b.dataset.af; renderParaStageView(canvas, 'archive'); });
        });
        const grid = $('sb-archive-grid');
        if (filtered.length === 0) {
          grid.innerHTML = `<div class="sb-empty-line"><span>보관된 항목이 아직 없어요 · 프로젝트를 완료하면 이곳에 차곡차곡 쌓입니다.</span></div>`;
          return;
        }
        grid.innerHTML = filtered.map((ent) => `
          <div class="sb-entity-card" data-eid="${esc(ent.id)}">
            <div class="sb-entity-card-top">
              <span class="sb-status-pill is-done">${typeKo[ent.paraType] || '보관'} · 완료</span>
              <span class="sb-entity-date">보관 · ${esc(formatRelativeTime(ent.archivedAt || ent.updatedAt))}</span>
            </div>
            <div class="sb-entity-card-title">${esc(ent.name)}</div>
            <div class="sb-entity-card-desc">${esc(ent.summary || `연결된 자료 ${getLinkedCount(ent.id)}건`)}</div>
            <div class="sb-entity-card-foot">
              <button type="button" class="sb-link-btn" data-eact="open">자료 보기 (${getLinkedCount(ent.id)})</button>
              <button type="button" class="sb-btn-subtle" data-eact="restore">활성으로 복원</button>
            </div>
          </div>
        `).join('');
        grid.querySelectorAll('.sb-entity-card').forEach((card) => {
          const ent = Store.findParaEntity(card.dataset.eid);
          if (!ent) return;
          card.querySelector('[data-eact="open"]')?.addEventListener('click', () => {
            hooks.setHomeMode(false);
            hooks.openParaVirtualView({ mode: 'entity', entityId: ent.id });
          });
          card.querySelector('[data-eact="restore"]')?.addEventListener('click', () => {
            Store.archiveParaEntity(ent.id, false);
            hooks.saveAndRender();
            renderAll();
            hooks.showToast(`"${ent.name}" 활성 목록으로 복원했습니다.`);
          });
        });
        return;
      }

      // Area or Resource view
      const list = Store.getParaEntities(stageType, { onlyActive: true });
      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">${meta.title}</h1>
            <p class="sb-page-sub">${meta.sub}</p>
          </div>
          <button type="button" class="sb-btn-primary" id="sb-stage-add-btn">＋ 새 ${meta.title}</button>
        </header>
        <section class="sb-card">
          <div class="sb-entity-grid" id="sb-stage-entity-grid"></div>
        </section>
      `;
      $('sb-stage-add-btn')?.addEventListener('click', () => openProjectModal(null, stageType));
      const grid = $('sb-stage-entity-grid');
      if (list.length === 0) {
        grid.innerHTML = `
          <div class="sb-empty-line">
            <span>아직 등록된 ${meta.title}가 없어요</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-stage-add">· 새 ${meta.title} 만들기</button>
          </div>
        `;
        $('sb-empty-stage-add')?.addEventListener('click', () => openProjectModal(null, stageType));
        return;
      }
      grid.innerHTML = list.map((ent) => `
        <div class="sb-entity-card" data-eid="${esc(ent.id)}">
          <div class="sb-entity-card-top">
            <span class="sb-card-ico">${svg(stageType, 15)}</span>
            <span class="sb-entity-date">연결 자료 ${getLinkedCount(ent.id)}건</span>
          </div>
          <div class="sb-entity-card-title">${esc(ent.name)}</div>
          <div class="sb-entity-card-desc">${esc(ent.summary || '설명 없음 · 클릭하여 편집')}</div>
          <div class="sb-entity-card-foot">
            <button type="button" class="sb-link-btn" data-eact="open">탐색기에서 열기</button>
            <div class="sb-flex-gap-xs">
              <button type="button" class="sb-btn-subtle" data-eact="edit">편집</button>
              <button type="button" class="sb-btn-subtle" data-eact="archive">보관</button>
            </div>
          </div>
        </div>
      `).join('');

      grid.querySelectorAll('.sb-entity-card').forEach((card) => {
        const ent = Store.findParaEntity(card.dataset.eid);
        if (!ent) return;
        card.querySelector('[data-eact="open"]')?.addEventListener('click', () => {
          hooks.setHomeMode(false);
          hooks.openParaVirtualView({ mode: 'entity', entityId: ent.id });
        });
        card.querySelector('[data-eact="edit"]')?.addEventListener('click', () => openProjectModal(ent, stageType));
        card.querySelector('[data-eact="archive"]')?.addEventListener('click', () => {
          Store.archiveParaEntity(ent.id, true);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`"${ent.name}" 보관소로 이동했습니다.`);
        });
      });
    }

    // ---- Weekly Review View (오래된 프로젝트 · 미분류 알림 · 단계별 요약) ----
    function getReviewAlerts() {
      const projects = getActiveProjects();
      const now = Date.now();
      const STALE_MS = 14 * 86400000;
      const staleOrOverdue = projects.filter((p) => {
        const dday = computeDdayInfo(p.dueDate);
        const untouched = now - (p.updatedAt || p.createdAt || now) >= STALE_MS;
        return dday.overdue || (dday.days !== null && dday.days <= 7) || p.status === 'hold' || untouched;
      });
      const inbox = getUnifiedInboxData();
      return {
        staleOrOverdue,
        inbox,
        totalAlerts: staleOrOverdue.length + (inbox.totalCount > 0 ? 1 : 0)
      };
    }

    function renderWeeklyReviewView(canvas) {
      const { staleOrOverdue, inbox } = getReviewAlerts();
      const pCount = Store.getParaEntities('project', { onlyActive: true }).length;
      const aCount = Store.getParaEntities('area', { onlyActive: true }).length;
      const rCount = Store.getParaEntities('resource', { onlyActive: true }).length;
      const archCount = Store.getParaEntities('archive').length;
      const allDocs = getAllVisibleDocs();
      const classifiedPct = allDocs.length > 0
        ? Math.round(((allDocs.length - inbox.unassignedDocs.length) / allDocs.length) * 100)
        : 100;

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">주간 리뷰</h1>
            <p class="sb-page-sub">오래된 프로젝트와 미분류 수신함을 점검하고, 완료된 프로젝트를 보관소로 정리하세요.</p>
          </div>
          <button type="button" class="sb-btn-primary" id="sb-save-weekly-note">주간 리뷰 요약 메모 저장</button>
        </header>

        <!-- 단계별 PARA 요약 -->
        <section class="sb-kpi-grid">
          <div class="sb-kpi-card is-static">
            <div class="sb-kpi-icon">${svg('project', 16)}</div>
            <div class="sb-kpi-label">프로젝트 (진행/보류)</div>
            <div class="sb-kpi-val">${pCount}</div>
          </div>
          <div class="sb-kpi-card is-static">
            <div class="sb-kpi-icon">${svg('area', 16)}</div>
            <div class="sb-kpi-label">영역</div>
            <div class="sb-kpi-val">${aCount}</div>
          </div>
          <div class="sb-kpi-card is-static">
            <div class="sb-kpi-icon">${svg('resource', 16)}</div>
            <div class="sb-kpi-label">자료</div>
            <div class="sb-kpi-val">${rCount}</div>
          </div>
          <div class="sb-kpi-card is-static">
            <div class="sb-kpi-icon">${svg('archive', 16)}</div>
            <div class="sb-kpi-label">보관 · 분류율 ${classifiedPct}%</div>
            <div class="sb-kpi-val">${archCount}</div>
          </div>
        </section>

        <section class="sb-home-grid">
          <div class="sb-card">
            <div class="sb-card-head">
              <div class="sb-card-title-wrap">
                <span class="sb-card-ico">${svg('alert', 16)}</span>
                <h2 class="sb-card-title">점검이 필요한 프로젝트 (${staleOrOverdue.length})</h2>
              </div>
            </div>
            <div id="sb-review-projects"></div>
          </div>

          <div class="sb-card">
            <div class="sb-card-head">
              <div class="sb-card-title-wrap">
                <span class="sb-card-ico">${svg('inbox', 16)}</span>
                <h2 class="sb-card-title">미분류 수신함 정리 (${inbox.totalCount})</h2>
              </div>
              <button type="button" class="sb-link-btn" id="sb-review-goto-inbox">전체 정리 ${svg('arrowRight', 13)}</button>
            </div>
            <div id="sb-review-inbox"></div>
          </div>
        </section>
      `;

      $('sb-review-goto-inbox')?.addEventListener('click', () => {
        activeView = 'inbox';
        renderAll();
      });

      const projWrap = $('sb-review-projects');
      if (staleOrOverdue.length === 0) {
        projWrap.innerHTML = `<div class="sb-empty-line"><span>지연되거나 오래된 프로젝트가 없어요 · 순조롭게 진행 중입니다.</span></div>`;
      } else {
        renderProjectsTableInto(projWrap, staleOrOverdue, true);
      }

      renderInboxPreviewInto($('sb-review-inbox'), inbox);

      $('sb-save-weekly-note')?.addEventListener('click', () => {
        const today = hooks.getTodayYMD();
        const summaryBody =
          `## ${today} PARA 주간 리뷰\n\n` +
          `### 단계별 요약\n` +
          `- **프로젝트**: ${pCount}건 (점검 필요 ${staleOrOverdue.length}건)\n` +
          `- **영역**: ${aCount}건\n` +
          `- **자료**: ${rCount}건\n` +
          `- **보관**: ${archCount}건\n` +
          `- **수신함 미분류**: ${inbox.totalCount}건 (전체 분류율 ${classifiedPct}%)\n\n` +
          `### 점검 프로젝트\n` +
          (staleOrOverdue.length
            ? staleOrOverdue.map((p) => `- [${p.status === 'hold' ? '보류' : '진행'}] **${p.name}** (${p.progress}% · ${computeDdayInfo(p.dueDate).text})`).join('\n')
            : '- 없음') +
          `\n\n### 다음 주 핵심 목표\n- \n`;
        const doc = captureQuickMemo({ title: `${today} 주간 리뷰`, body: summaryBody });
        if (doc) hooks.launchItemDirectly(doc);
      });
    }

    // ---- Main Render Dispatcher ----
    function renderAll() {
      bindProjectModalOnce();
      renderSidebar();
      const canvas = $('para-main-canvas');
      if (!canvas) return;
      if (activeView === 'home') renderHomeView(canvas);
      else if (activeView === 'inbox') renderInboxView(canvas);
      else if (activeView === 'review') renderWeeklyReviewView(canvas);
      else renderParaStageView(canvas, activeView);
    }

    // Bind sidebar "+ 새 폴더" button & footer settings click
    $('para-btn-add-folder')?.addEventListener('click', () => {
      hooks.setHomeMode(false);
      hooks.createNew('folder');
    });
    $('para-btn-add-para')?.addEventListener('click', () => openProjectModal(null, 'project'));
    $('para-sidebar-status')?.addEventListener('click', () => hooks.openSettingsModal());
    document.addEventListener('click', () => closeQuickClassifyMenu());

    return {
      renderAll,
      refreshTrafficLightVisuals,
      setActiveView(v) {
        activeView = v || 'home';
        renderAll();
      },
      openProjectModal,
      captureQuickMemo,
      computeKpis
    };
  }

  global.BrainParaDashboard = {
    mountParaDashboard
  };
})(window);
