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
    const gtd = global.BrainGtdSecondBrain
      ? global.BrainGtdSecondBrain.createGtdSecondBrain(hooks)
      : null;
    const projectWorkspace = global.BrainProjectWorkspace
      ? global.BrainProjectWorkspace.createProjectWorkspace({
          ...hooks,
          openExtractModal: (doc) => gtd?.openExtractModal(doc),
          openCardPropertiesModal: (doc, cb) => gtd?.openCardPropertiesModal(doc, cb || renderAll)
        })
      : null;

    let googleCalendarInstance = null;
    function getGoogleCalendar() {
      if (!googleCalendarInstance && global.BrainGoogleCalendar) {
        googleCalendarInstance = global.BrainGoogleCalendar.createGoogleCalendar({
          ...hooks,
          openCardProps: (doc) => openCardProps(doc),
          onDataChanged: () => renderAll(),
          getAllVisibleDocs: () => getAllVisibleDocs(),
          openProjectDetail
        });
      }
      return googleCalendarInstance;
    }

    function computeInboxPeriodBuckets() {
      const todayYmd = hooks.getTodayYMD();
      const [ty, tm, td] = todayYmd.split('-').map(Number);
      const tMs = Date.UTC(ty, tm - 1, td);
      const toYmd = (ms) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      };
      const tomorrowYmd = toYmd(tMs + 86400000);
      const weekEndYmd = toYmd(tMs + 7 * 86400000);
      const openDocs = getAllVisibleDocs().filter((d) => !d.completed);

      const overdueDocs = openDocs
        .filter((d) => Boolean(d.endDate && d.endDate < todayYmd))
        .sort((a, b) => String(a.endDate || '').localeCompare(String(b.endDate || '')));

      const todayDocs = openDocs.filter((d) => {
        const s = d.startDate || '';
        const e = d.endDate || '';
        if (s && e) return todayYmd >= s && todayYmd <= e;
        return s === todayYmd || e === todayYmd;
      });

      const tomorrowDocs = openDocs.filter((d) => {
        const s = d.startDate || '';
        const e = d.endDate || '';
        if (s && e) return tomorrowYmd >= s && tomorrowYmd <= e;
        return s === tomorrowYmd || e === tomorrowYmd;
      });

      const weekDocs = openDocs.filter((d) => {
        const s = d.startDate || '';
        const e = d.endDate || '';
        if (s && e) return s <= weekEndYmd && e >= todayYmd;
        const single = e || s;
        return Boolean(single && single >= todayYmd && single <= weekEndYmd);
      });

      return { todayYmd, tomorrowYmd, weekEndYmd, overdueDocs, todayDocs, tomorrowDocs, weekDocs };
    }

    function formatPeriodBadgeHtml(doc, todayYmd) {
      const s = doc.startDate || '';
      const e = doc.endDate || '';
      if (!s && !e) return '';
      const fmt = (ymd) => ymd.slice(5).replace('-', '/');
      if (!doc.completed && e && e < todayYmd) {
        return `<span class="sb-period-pill is-overdue">⚠️ 기간지남 · ${esc(fmt(e))}</span>`;
      }
      if (s && e && s !== e) {
        return `<span class="sb-period-pill">📅 ${esc(fmt(s))} ~ ${esc(fmt(e))}</span>`;
      }
      return `<span class="sb-period-pill">📅 ${esc(fmt(e || s))}</span>`;
    }

    function openCardProps(doc) {
      if (!doc) return;
      if (gtd && typeof gtd.openCardPropertiesModal === 'function') {
        gtd.openCardPropertiesModal(doc, renderAll);
      } else {
        hooks.launchItemDirectly(doc);
      }
    }

    let activeView = 'home'; // 'home' | 'inbox' | 'next-actions' | 'calendar' | 'project' | 'project-detail' | 'master-gantt' | 'area' | 'resource' | 'archive' | 'review' | 'history'
    let activeProjectId = null;
    let inboxTab = 'all';    // 'all' | 'overdue' | 'today' | 'tomorrow' | 'week' | 'memos' | 'files' | 'tasks' | 'done'
    let homeInboxTab = 'all'; // 'all' | 'overdue' | 'today' | 'tomorrow' | 'week'
    let dragProjectId = null;
    let projectFilter = 'all'; // 'all' | 'active' | 'hold'
    let archiveFilter = 'all'; // 'all' | 'project' | 'area' | 'resource'
    let showInlineComposer = false;
    let showLifeExpanded = true;
    let lifeUserToggled = false;
    let sidebarAppsOpen = false;
    let openClassifyPopover = null; // { itemId, paraType }
    let inlineSubTargetId = null;
    const expandedDashIds = new Set();

    const $ = (id) => document.getElementById(id);

    function openProjectDetail(projectId, initialTab = 'cards') {
      if (!projectId || !Store.findParaEntity(projectId)) return;
      activeProjectId = projectId;
      activeView = 'project-detail';
      if (projectWorkspace && initialTab) projectWorkspace.setDetailTab(initialTab);
      renderAll();
    }

    function deleteCardNode(doc) {
      if (!doc || doc.id === 'root') return false;
      const found = Store.findNodeAndParent(doc.id);
      if (!found || !found.parent || !Array.isArray(found.parent.children)) return false;
      Store.saveStateForUndo();
      found.parent.children = found.parent.children.filter((c) => c.id !== doc.id);
      Store.state.relations = (Store.state.relations || []).filter((r) => r.sourceId !== doc.id && r.targetId !== doc.id);
      Store.persistRelations();
      hooks.saveAndRender();
      renderAll();
      return true;
    }

    function getTodayCoreCards() {
      return getAllVisibleDocs()
        .filter((d) => Boolean(d.isTodayCore) && !d.completed)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    function getDoneCoreTodayCount() {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const t0 = todayStart.getTime();
      return getAllVisibleDocs().filter((d) => d.completed && Number(d.completedAt || 0) >= t0 && (d.isTodayCore || Store.getCardRole(d) === 'T')).length;
    }

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

    // ---- Project Edit / Create Modal (with Life Goal, Hierarchy Parent, Past R-Card Reuse, 5-Why Link) ----
    function renderPemReuseRecommendations() {
      const box = $('pem-reuse-box');
      const listEl = $('pem-reuse-list');
      if (!box || !listEl) return;
      const pType = $('pem-type')?.value || 'project';
      const isEdit = Boolean($('pem-id')?.value?.trim());
      if (pType !== 'project' || isEdit) {
        box.style.display = 'none';
        return;
      }
      const q = `${$('pem-name')?.value || ''} ${$('pem-summary')?.value || ''}`.trim();
      const recs = Store.getRecommendedDeliverables(q).slice(0, 5);
      if (recs.length === 0) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      listEl.innerHTML = recs.map(({ doc, project }) => `
        <label class="sb-pem-reuse-row">
          <input type="checkbox" class="sb-pem-reuse-chk" value="${esc(doc.id)}">
          <span>
            <strong>${esc(doc.name.replace(/\.md$/i, ''))}</strong>
            <small>${esc(Store.getParaCode(project))} ${esc(project.name)} · ♻️ ${Number(doc.reuseCount || 0)}회</small>
          </span>
        </label>
      `).join('');
    }

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

        // Populate Life Goal 5 selector
        const lgSel = $('pem-life-goal');
        if (lgSel) {
          const goals = (Store.state.lifeGoals || []).filter((g) => g.title);
          lgSel.innerHTML = `<option value="">연결 안 함</option>` +
            goals.map((g, i) => `<option value="${esc(g.id)}"${entity?.lifeGoalId === g.id ? ' selected' : ''}>목표 ${i + 1}: ${esc(g.title)}</option>`).join('');
        }
        // Populate Parent Project (Hierarchy Level) selector
        const ppSel = $('pem-parent-proj');
        if (ppSel) {
          const projs = Store.getParaEntities('project', { onlyActive: true }).filter((p) => p.id !== entity?.id);
          ppSel.innerHTML = `<option value="">최상위 프로젝트 (Lv.1)</option>` +
            projs.map((p) => `<option value="${esc(p.id)}"${entity?.parentProjectId === p.id ? ' selected' : ''}>Lv.${Store.getProjectLevel(p.id)} · ${esc(Store.getParaCode(p))} ${esc(p.name)}</option>`).join('');
        }
      }

      const reqBtn = $('pem-open-req-btn');
      if (reqBtn) reqBtn.style.display = pType === 'project' ? 'inline-flex' : 'none';

      const completeBtn = $('pem-complete-archive-btn');
      if (completeBtn) {
        completeBtn.style.display = (isEdit && pType === 'project' && !entity.archived) ? 'inline-flex' : 'none';
      }
      const delBtn = $('pem-delete-btn');
      if (delBtn) delBtn.style.display = isEdit ? 'inline-flex' : 'none';

      renderPemReuseRecommendations();
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
      $('pem-name')?.addEventListener('input', renderPemReuseRecommendations);
      $('pem-summary')?.addEventListener('input', renderPemReuseRecommendations);

      $('pem-open-req-btn')?.addEventListener('click', () => {
        let id = $('pem-id').value.trim();
        if (!id) {
          const name = $('pem-name').value.trim();
          if (!name) {
            hooks.showToast('요구사항 분석을 열기 전에 프로젝트 이름을 먼저 입력해 주세요.');
            $('pem-name').focus();
            return;
          }
          const created = Store.declareParaEntity({
            paraType: 'project',
            name,
            summary: $('pem-summary').value.trim(),
            dueDate: $('pem-due').value.trim(),
            status: $('pem-status').value || 'active',
            progress: Number($('pem-progress').value || 0),
            lifeGoalId: $('pem-life-goal')?.value || '',
            parentProjectId: $('pem-parent-proj')?.value || ''
          });
          if (!created) return;
          id = created.id;
          $('pem-id').value = id;
          hooks.saveAndRender();
        }
        close();
        openProjectDetail(id, 'requirements');
        projectWorkspace?.openRequirementEditorModal(id, null, () => renderAll());
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
            patch.lifeGoalId = $('pem-life-goal')?.value || '';
            if (patch.status === 'completed') {
              patch.archived = true;
              patch.progress = 100;
            }
          }
          Store.updateParaEntity(id, patch);
          if (pType === 'project') {
            Store.setProjectParent(id, $('pem-parent-proj')?.value || '');
          }
          hooks.showToast(`"${name}" 수정되었습니다.`);
        } else {
          const created = Store.declareParaEntity({
            paraType: pType,
            name,
            summary,
            archived: pType === 'archive',
            dueDate: pType === 'project' ? $('pem-due').value.trim() : '',
            status: pType === 'project' ? ($('pem-status').value || 'active') : '',
            progress: pType === 'project' ? Number($('pem-progress').value || 0) : 0,
            lifeGoalId: pType === 'project' ? ($('pem-life-goal')?.value || '') : '',
            parentProjectId: pType === 'project' ? ($('pem-parent-proj')?.value || '') : ''
          });
          if (created && pType === 'project') {
            // Pull checked recommended past R-cards & increment reuseCount!
            let reused = 0;
            modal.querySelectorAll('.sb-pem-reuse-chk:checked').forEach((chk) => {
              const rdoc = Store.findNodeAndParent(chk.value)?.node;
              if (rdoc) {
                Store.addRelation({ sourceId: rdoc.id, targetId: created.id, type: 'project', label: '재사용 인용' });
                Store.incrementCardReuse(rdoc.id);
                reused++;
              }
            });
            hooks.showToast(
              reused > 0
                ? `"${created.name}" 생성 완료! (과거 산출물 ${reused}건 불러오기·재사용 반영)`
                : `"${created.name}" 생성되었습니다.`
            );
          } else if (created) {
            hooks.showToast(`"${created.name}" 생성되었습니다.`);
          }
        }
        close();
        hooks.saveAndRender();
        renderAll();
      });

      $('pem-complete-archive-btn')?.addEventListener('click', () => {
        const id = $('pem-id').value.trim();
        const ent = Store.findParaEntity(id);
        if (!ent) return;
        close();
        if (projectWorkspace) {
          projectWorkspace.openProjectCompleteModal(ent, () => renderAll());
        } else {
          Store.completeAndArchiveProject(id);
          hooks.saveAndRender();
          renderAll();
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

    // ---- Quick Classify Popover ([P] [A] [R] buttons — Multi-Select Supported!) ----
    function openQuickClassifyMenu(anchorEl, doc, paraType) {
      closeQuickClassifyMenu();
      const pop = document.createElement('div');
      pop.className = 'sb-quick-classify-pop';
      pop.id = 'sb-quick-classify-pop';

      const typeNames = { project: '프로젝트', area: '영역', resource: '자료' };

      const getConnectedSet = () => {
        const rels = Store.getRelationsForNode(doc.id);
        const list = paraType === 'project' ? rels.projects : (paraType === 'area' ? rels.areas : rels.resources);
        return new Set((list || []).map((x) => x.node?.id).filter(Boolean));
      };

      const renderPopContent = () => {
        const entities = Store.getParaEntities(paraType, { onlyActive: true });
        const connectedSet = getConnectedSet();
        pop.innerHTML =
          `<div class="sb-qcp-head">` +
          `  <span>${typeNames[paraType]} 연결 <small style="opacity:0.7;">(중복 선택)</small></span>` +
          `  <button type="button" class="sb-icon-btn-xs" data-qcp-close="1">${svg('close', 12)}</button>` +
          `</div>` +
          `<div class="sb-qcp-list">` +
          (entities.length > 0
            ? entities.map((e) => {
                const isOn = connectedSet.has(e.id);
                return (
                  `<button type="button" class="sb-qcp-item ${isOn ? 'is-selected' : ''}" data-eid="${esc(e.id)}">` +
                  `  <span class="sb-qcp-chk">${isOn ? '☑' : '☐'}</span>` +
                  `  <span class="sb-code-pill-xs">${esc(Store.getParaCode(e))}</span>` +
                  `  <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${esc(e.name)}</span>` +
                  `</button>`
                );
              }).join('')
            : `<div class="sb-qcp-empty">아직 ${typeNames[paraType]}가 없어요</div>`) +
          `</div>` +
          `<form class="sb-qcp-create">` +
          `  <input type="text" class="sb-qcp-input" placeholder="새 ${typeNames[paraType]} 만들고 연결...">` +
          `  <button type="submit" class="sb-qcp-submit">추가</button>` +
          `</form>` +
          `<div class="sb-qcp-foot">` +
          `  <span class="sb-muted-sm">${connectedSet.size}개 연결됨</span>` +
          `  <button type="button" class="sb-btn-primary-xs" data-qcp-done="1">완료</button>` +
          `</div>`;

        pop.querySelector('[data-qcp-close]')?.addEventListener('click', closeQuickClassifyMenu);
        pop.querySelector('[data-qcp-done]')?.addEventListener('click', () => {
          closeQuickClassifyMenu();
          renderAll();
        });

        pop.querySelectorAll('.sb-qcp-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            const eid = btn.dataset.eid;
            const ent = Store.findParaEntity(eid);
            if (!ent) return;
            const existing = (Store.state.relations || []).find(
              (r) => r.type === paraType && (
                (r.sourceId === doc.id && r.targetId === ent.id) ||
                (r.sourceId === ent.id && r.targetId === doc.id)
              )
            );
            if (existing) {
              Store.removeRelation(existing.id);
              hooks.showToast(`"${doc.name.replace(/\.md$/i, '')}" ↔ ${typeNames[paraType]} [${ent.name}] 연결 해제`);
            } else {
              Store.addRelation({ sourceId: doc.id, targetId: ent.id, type: paraType });
              const subCnt = Store.getAllDescendantCards(doc.id).length;
              const subNote = subCnt > 0 && (paraType === 'project' || paraType === 'area') ? ` (하위 ${subCnt}건 자동 상속)` : '';
              hooks.showToast(`"${doc.name.replace(/\.md$/i, '')}" → ${typeNames[paraType]} [${ent.name}] 연결됨${subNote}`);
            }
            Store.touchNode(doc);
            hooks.saveAndRender();
            renderPopContent();
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
            hooks.showToast(`새 ${typeNames[paraType]} "${created.name}" 생성 및 연결 완료`);
            renderPopContent();
          }
        });
      };

      document.body.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      const popW = 248;
      const left = Math.max(8, Math.min(window.innerWidth - popW - 10, rect.right - popW));
      const top = Math.min(window.innerHeight - 290, rect.bottom + 6);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;

      pop.addEventListener('click', (e) => e.stopPropagation());
      renderPopContent();
      openClassifyPopover = pop;
    }

    function closeQuickClassifyMenu() {
      if (openClassifyPopover) {
        openClassifyPopover.remove();
        openClassifyPopover = null;
      }
    }

    // ---- Quick Memo Capture (Unified MD Card: Inbox / Core / Sub-Card) ----
    function captureQuickMemo({
      title = '',
      body = '',
      addToTodo = false,
      isTodayCore = false,
      cardRole = '',
      coreTime = '',
      customTags = [],
      paraType = '',
      paraId = '',
      parentDoc = null
    }) {
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
      const coreFlag = Boolean(isTodayCore || addToTodo);
      const roleVal = ['T', 'S', 'R'].includes(cardRole) ? cardRole : (coreFlag ? 'T' : 'S');
      const cleanTags = Array.isArray(customTags)
        ? customTags.map((t) => String(t).trim().replace(/^#+/, '')).filter(Boolean)
        : String(customTags || '').split(/[,\s]+/).map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);

      const newDoc = {
        id: Store.genId(),
        type: 'doc',
        name: fileName,
        icon: roleVal === 'T' ? '☑️' : (roleVal === 'R' ? '📦' : '📝'),
        tag: cleanTags.length
          ? cleanTags.map((t) => `#${t}`).join(' ')
          : (paraId ? `#메모 #${todayStr}` : `#수신함 #${todayStr}`),
        customTags: cleanTags,
        cardRole: roleVal,
        cardKind: roleVal === 'T' ? 'task' : (roleVal === 'R' ? 'deliverable' : 'note'),
        isTodayCore: coreFlag,
        coreTime: String(coreTime || '').trim(),
        completed: false,
        parentCardId: parentDoc ? parentDoc.id : '',
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
      if (parentDoc) {
        Store.linkSubCard(parentDoc, newDoc, { inheritPara: true });
        expandedDashIds.add(parentDoc.id);
      }

      hooks.saveAndRender();
      hooks.syncDocAfterSave(newDoc);
      renderAll();
      hooks.showToast(
        parentDoc
          ? `↳ 하위 카드 저장됨: ${firstLine}`
          : (coreFlag
            ? `★ 오늘의 핵심 + 수신함에 저장됨: ${firstLine}`
            : (paraId ? `저장됨: ${fileName}` : `수신함(Inbox)에 자동 저장됨: ${fileName}`))
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

      const nextActCnt = Store.getProjectNextActionEntries(null, hooks.isItemVisible).length;
      const items = [
        { id: 'home', label: '홈', icon: 'home', badge: 0 },
        { id: 'inbox', label: '수신함', icon: 'inbox', badge: kpis.inboxCount },
        { id: 'next-actions', label: '다음 행동', icon: 'check', badge: nextActCnt },
        { id: 'calendar', label: '캘린더', icon: 'calendar', badge: 0 },
        { id: 'project', label: '프로젝트', icon: 'project', badge: kpis.activeProjects, subtle: true },
        { id: 'master-gantt', label: '전체 간트', icon: 'chart', badge: 0 },
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
        `<button type="button" class="sb-nav-item${activeView === 'history' ? ' active' : ''}" data-pnav="history">` +
        `  <span class="sb-nav-ico">${svg('clock', 16)}</span>` +
        `  <span class="sb-nav-lbl">변경 이력</span>` +
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
            <button type="button" class="sb-mini-tree-row${activeView === 'project-detail' && activeProjectId === ent.id ? ' active' : ''}" data-open-ent="${esc(ent.id)}" title="${esc(Store.getParaCode(ent))} ${esc(ent.name)}">
              <span class="sb-dot-ind type-${ent.paraType}"></span>
              <span class="sb-mini-tree-code">${esc(Store.getParaCode(ent))}</span>
              <span class="sb-mini-tree-name">${esc(ent.name)}</span>
              <span class="sb-mini-tree-cnt">${getLinkedCount(ent.id)}</span>
            </button>
          `).join('');
          miniTreeEl.querySelectorAll('[data-open-ent]').forEach((b) => {
            b.addEventListener('click', () => {
              const ent = Store.findParaEntity(b.dataset.openEnt);
              if (!ent) return;
              if (ent.paraType === 'project') {
                openProjectDetail(ent.id, 'cards');
              } else {
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
          <button type="button" class="sb-nav-subitem" data-builtin-app="ocr-extractor">${svg('scan', 14)}<span>OCR 추출기</span></button>
          <button type="button" class="sb-nav-subitem" data-builtin-app="pdf-converter">${svg('doc', 14)}<span>PDF 변환기</span></button>
          <button type="button" class="sb-nav-subitem" data-builtin-app="screen-capture">${svg('sparkle', 14)}<span>화면 캡처</span></button>
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

    // ---- Collapsible Left Sidebar Toggle ----
    const SIDEBAR_HIDDEN_KEY = 'brainOS_home_sidebar_hidden_v1';
    function applySidebarCollapsed(hidden) {
      const shell = $('home-screen');
      if (shell) shell.classList.toggle('is-sidebar-hidden', Boolean(hidden));
      try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0'); } catch (_) {}
    }
    try {
      if (localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1') applySidebarCollapsed(true);
    } catch (_) {}
    $('btn-collapse-home-sidebar')?.addEventListener('click', () => applySidebarCollapsed(true));
    $('btn-expand-home-sidebar')?.addEventListener('click', () => applySidebarCollapsed(false));

    // ---- Customizable Drag-and-Drop & Drag-Resizable Dashboard Widget & App Layout (12-col grid) ----
    const DASH_LAYOUT_KEY = 'brainOS_dash_layout_v3';
    const DEFAULT_DASH_LAYOUT = [
      { id: 'projects', cols: 6, heightPx: 0 },
      { id: 'calendar-widget', cols: 6, heightPx: 360 },
      { id: 'top3', cols: 6, heightPx: 0 },
      { id: 'inbox', cols: 6, heightPx: 0 },
      { id: 'life', cols: 12, heightPx: 0 },
      { id: 'apps-dock', cols: 6, heightPx: 0 },
      { id: 'recent', cols: 6, heightPx: 0 }
    ];
    const DASH_APP_CARDS = [
      { id: 'app:ocr-extractor', app: 'ocr-extractor', icon: '📄', name: 'OCR 추출기', desc: 'HWP · PPTX · PDF 텍스트/OCR 전처리' },
      { id: 'app:pdf-converter', app: 'pdf-converter', icon: '📕', name: 'PDF 변환기', desc: 'PPTX · HWP · Word · HTML · 이미지 → PDF' },
      { id: 'app:screen-capture', app: 'screen-capture', icon: '📸', name: '화면 캡처', desc: 'PrintScreen 영역 지정 → 로컬 폴더 저장' },
      { id: 'app:spreadsheet', app: 'spreadsheet', icon: '📊', name: '엑셀 시트', desc: '빈 시트 초안 열기 · 수식 · 표 분석' },
      { id: 'app:origin', app: 'origin', icon: '📈', name: 'Origin 그래프', desc: '과학/공학 논문용 그래프 플로팅' },
      { id: 'app:relation-map', app: 'relation-map', icon: '🕸️', name: 'PARA 관계 맵', desc: '프로젝트별 카드유형 클러스터 그래프' },
      { id: 'app:markdown', app: 'markdown', icon: '📝', name: '새 마크다운', desc: '실시간 수식(e^5, a/b, int) MD 스튜디오' },
      { id: 'app:calendar', view: 'calendar', icon: '📅', name: '구글 캘린더', desc: '일 · 주 · 월 블럭 일정 및 인박스 드래그 배치' }
    ];
    let dashWidgetPickerOpen = false;
    let dragDashWidgetId = null;

    function normalizeDashItem(x) {
      const cols = Number.isFinite(Number(x?.cols))
        ? Math.max(4, Math.min(12, Math.round(Number(x.cols))))
        : (Number(x?.span || 1) >= 2 ? 12 : 6);
      const heightPx = Number.isFinite(Number(x?.heightPx)) && Number(x.heightPx) >= 160
        ? Math.min(920, Math.round(Number(x.heightPx)))
        : 0;
      return { id: String(x?.id || ''), cols, heightPx };
    }

    function loadDashLayout() {
      try {
        const raw = localStorage.getItem(DASH_LAYOUT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map(normalizeDashItem).filter((x) => x.id);
          }
        }
      } catch (_) {}
      return DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }));
    }

    function saveDashLayout(list) {
      try { localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify(list)); } catch (_) {}
    }

    // ---- Render Home Dashboard Main View (Customizable Drag-and-Drop Widget Grid) ----
    function renderHomeView(canvas) {
      Store.syncOverdueTasksToWaiting();
      const now = new Date();
      const kpis = computeKpis();
      const projects = getActiveProjects();
      const dfp = hooks.loadDfpState();
      const todayStr = hooks.getTodayYMD();
      const doneToday = Math.min(3, getDoneCoreTodayCount() + Number(dfp.completedDates?.[todayStr] || 0));
      const inbox = getUnifiedInboxData();
      const periodBuckets = computeInboxPeriodBuckets();
      const recentDocs = getAllVisibleDocs()
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .slice(0, 4);
      const wrCfg = Store.state.weeklyReviewConfig || { reviewWeekday: 0, lastReviewedDate: '' };
      const isWeeklyReviewDay = Number(wrCfg.reviewWeekday) === now.getDay() && wrCfg.lastReviewedDate !== todayStr;
      const dayKoNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
      const activeLifeGoals = (Store.state.lifeGoals || []).filter((g) => g.title);

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
        ${isWeeklyReviewDay ? `
          <div class="sb-review-alarm-banner">
            <span>🗓️ 오늘은 매주 설정하신 <b>주간 리뷰할 시간 (${dayKoNames[wrCfg.reviewWeekday]})</b>입니다! 수신함 · 대기 목록 · 언젠가 목록을 점검해 보세요.</span>
            <button type="button" class="sb-btn-primary-sm" data-jump-view="review">주간 리뷰 시작 →</button>
          </div>
        ` : ''}

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

        <!-- Life Goals 5 Strip -->
        <section class="sb-goals-strip">
          <div class="sb-goals-strip-left">
            <span class="sb-goals-strip-title">🎯 인생 중요 목표</span>
            ${activeLifeGoals.length > 0
              ? activeLifeGoals.map((g) => {
                  const pCnt = projects.filter((p) => p.lifeGoalId === g.id).length;
                  return `<span class="sb-goal-chip" style="--gcol:${esc(g.color || '#4f46e5')}" title="${esc(g.desc || g.title)}">${esc(g.title)}${pCnt > 0 ? ` · ${pCnt}` : ''}</span>`;
                }).join('')
              : `<span class="sb-goals-empty">아직 인생 중요 목표 5가지를 설정하지 않았습니다</span>`}
          </div>
          <button type="button" class="sb-link-btn" id="sb-btn-edit-life-goals">목표 5가지 설정 →</button>
        </section>

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

        <!-- Dashboard Layout Customization Toolbar -->
        <div class="sb-dash-design-bar">
          <span class="sb-muted-sm">⋮⋮ 상단 드래그로 위치 이동 · ↘ 우하단 모서리 드래그로 위젯 가로·세로 크기 자유 조절</span>
          <div class="sb-dash-design-acts">
            <button type="button" class="sb-btn-subtle" id="sb-toggle-widget-picker">🧩 위젯 · 앱 배치</button>
            <button type="button" class="sb-link-btn" id="sb-reset-dash-layout">↺ 기본 배치</button>
          </div>
        </div>

        <section class="sb-card sb-widget-picker${dashWidgetPickerOpen ? '' : ' is-hidden'}" id="sb-widget-picker">
          <div class="sb-wp-title">대시보드에 배치할 위젯 및 내장 앱을 선택하세요 (드래그로 위치 이동 · 모서리 드래그로 크기 조절)</div>
          <div class="sb-wp-grid" id="sb-wp-grid"></div>
        </section>

        <!-- Drag-and-Drop & Drag-Resizable 12-Column Widget Grid -->
        <section class="sb-dash-grid" id="sb-dash-grid"></section>
      `;

      const dashLayout = loadDashLayout();
      const dashGridEl = $('sb-dash-grid');

      const buildWidgetHtml = (w) => {
        const cols = Math.max(4, Math.min(12, Number(w.cols || 6)));
        const hStyle = w.heightPx >= 160 ? `height:${w.heightPx}px;` : '';
        const wrap = (id, innerHtml, removable = false) => `
          <div class="sb-dash-widget${w.heightPx >= 160 ? ' has-custom-h' : ''}" draggable="true" data-wid="${esc(id)}" data-cols="${cols}" style="grid-column: span ${cols}; ${hStyle}">
            <div class="sb-dash-wbar">
              <span class="sb-dash-drag-grip" title="드래그하여 위치 이동">⋮⋮ 이동</span>
              <div class="sb-dash-wctrls">
                <button type="button" class="sb-dash-wbtn" data-wspan="${esc(id)}" title="가로 폭 빠른 전환 (${cols}/12칸)">${cols >= 10 ? '◫ 반폭' : '⬌ 전체폭'}</button>
                ${removable ? `<button type="button" class="sb-dash-wbtn is-del" data-wrem="${esc(id)}" title="대시보드에서 제거">✕</button>` : ''}
              </div>
            </div>
            <div class="sb-dash-wbody">${innerHtml}</div>
            <div class="sb-dash-resize-handle" data-wresize="${esc(id)}" title="드래그하여 위젯 가로·세로 크기 조절">↘</div>
          </div>
        `;

        if (w.id === 'calendar-widget') {
          return wrap('calendar-widget', `
            <div class="sb-card sb-gcal-home-card">
              <div class="sb-card-head" style="margin-bottom:8px;">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('calendar', 16)}</span>
                  <h2 class="sb-card-title">구글 캘린더 · 실시간 일정표</h2>
                </div>
              </div>
              <div id="sb-home-gcal-widget" class="sb-home-gcal-widget"></div>
            </div>
          `, true);
        }

        if (w.id === 'projects') {
          return wrap('projects', `
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
          `);
        }
        if (w.id === 'top3') {
          return wrap('top3', `
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
          `);
        }
        if (w.id === 'inbox') {
          return wrap('inbox', `
            <div class="sb-card sb-inbox-card">
              <div class="sb-card-head">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('inbox', 16)}</span>
                  <h2 class="sb-card-title">수신함 (Inbox)</h2>
                </div>
                <div class="sb-card-head-actions">
                  <button type="button" class="sb-link-btn" id="sb-toggle-quick-memo">＋ 빠른 메모</button>
                  <button type="button" class="sb-link-btn" data-jump-view="calendar">📅 캘린더</button>
                </div>
              </div>
              <div class="sb-home-inbox-tabs" id="sb-home-inbox-tabs">
                <button type="button" class="sb-hi-tab${homeInboxTab === 'all' ? ' active' : ''}" data-hitab="all">전체 <span>${inbox.totalCount}</span></button>
                <button type="button" class="sb-hi-tab${homeInboxTab === 'overdue' ? ' active' : ''}${periodBuckets.overdueDocs.length > 0 ? ' is-danger' : ''}" data-hitab="overdue">기간지남 <span>${periodBuckets.overdueDocs.length}</span></button>
                <button type="button" class="sb-hi-tab${homeInboxTab === 'today' ? ' active' : ''}" data-hitab="today">오늘 할일 <span>${periodBuckets.todayDocs.length}</span></button>
                <button type="button" class="sb-hi-tab${homeInboxTab === 'tomorrow' ? ' active' : ''}" data-hitab="tomorrow">내일 할일 <span>${periodBuckets.tomorrowDocs.length}</span></button>
                <button type="button" class="sb-hi-tab${homeInboxTab === 'week' ? ' active' : ''}" data-hitab="week">이번 주 <span>${periodBuckets.weekDocs.length}</span></button>
              </div>
              <div class="sb-quick-composer${showInlineComposer ? '' : ' is-hidden'}" id="sb-inline-composer">
                <div class="sb-qm-top-row">
                  <input type="text" id="sb-qm-title" class="sb-field-input" placeholder="제목 (비워두면 첫 줄 사용)">
                  <select id="sb-qm-role" class="sb-field-select" title="자료형태">
                    <option value="T">T 할일</option>
                    <option value="S" selected>S 자료</option>
                    <option value="R">R 산출물</option>
                    <option value="M">◆ M 마일스톤</option>
                  </select>
                </div>
                <div class="sb-qm-period-row">
                  <input type="date" id="sb-qm-start" class="sb-field-input" title="시작일">
                  <span style="color:var(--text-muted); font-size:0.75rem;">~</span>
                  <input type="date" id="sb-qm-end" class="sb-field-input" title="종료/마감일">
                  <input type="time" id="sb-qm-stime" class="sb-field-input" style="max-width:102px;" title="시작 시간 (선택)">
                  <button type="button" class="sb-mini-ghost" data-qm-preset="today">오늘</button>
                  <button type="button" class="sb-mini-ghost" data-qm-preset="tomorrow">내일</button>
                  <button type="button" class="sb-mini-ghost" data-qm-preset="week">이번주</button>
                </div>
                <textarea id="sb-qm-body" rows="2" class="sb-field-textarea" placeholder="빠르게 기록하세요... (Ctrl+Enter)"></textarea>
                <div class="sb-qm-foot">
                  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <label class="sb-check-inline">
                      <input type="checkbox" id="sb-qm-todo">
                      <span>★ 오늘의 핵심</span>
                    </label>
                    <label class="sb-check-inline">
                      <input type="checkbox" id="sb-qm-sched">
                      <span>📅 일정(스케줄) 태그</span>
                    </label>
                  </div>
                  <button type="button" class="sb-btn-primary-sm" id="sb-qm-save">저장</button>
                </div>
              </div>
              <div class="sb-inbox-preview-list" id="sb-home-inbox-list"></div>
            </div>
          `);
        }
        if (w.id === 'apps-dock') {
          return wrap('apps-dock', `
            <div class="sb-card sb-apps-dock-card">
              <div class="sb-card-head">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('apps', 16)}</span>
                  <h2 class="sb-card-title">내장 앱 빠른 실행</h2>
                </div>
                <button type="button" class="sb-link-btn" id="sb-dock-add-pinned">＋ 앱 고정</button>
              </div>
              <div class="sb-apps-dock-grid">
                ${DASH_APP_CARDS.map((ac) => `
                  <button type="button" class="sb-dock-tile" ${ac.app ? `data-dock-app="${esc(ac.app)}"` : `data-jump-view="${esc(ac.view)}"`} title="${esc(ac.desc)}">
                    <span class="sb-dock-ico">${ac.icon}</span>
                    <span class="sb-dock-name">${esc(ac.name)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `, true);
        }
        if (w.id === 'recent') {
          return wrap('recent', `
            <div class="sb-card sb-recent-card">
              <div class="sb-card-head">
                <div class="sb-card-title-wrap">
                  <span class="sb-card-ico">${svg('doc', 16)}</span>
                  <h2 class="sb-card-title">최근 자료</h2>
                </div>
                <button type="button" class="sb-link-btn" id="sb-open-explorer-from-recent">탐색기에서 전체 보기 ${svg('arrowRight', 13)}</button>
              </div>
              <div class="sb-recent-grid" id="sb-home-recent-grid"></div>
            </div>
          `, true);
        }
        if (w.id === 'life') {
          return wrap('life', `
            <div class="sb-card sb-life-card" id="sb-life-card">
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
                      <div id="dfp-live-calc-row" class="dfp-live-calc-row is-hidden">
                        <label class="dfp-live-field">🚌 이동 <input type="number" id="dfp-live-travel" min="0" max="300" step="5" value="30">분</label>
                        <label class="dfp-live-field">☕ 여유 <input type="number" id="dfp-live-buffer" min="0" max="180" step="5" value="10">분</label>
                        <span class="dfp-live-depart-pill">→ 출발 시작 <strong id="dfp-live-depart-time">--:--</strong></span>
                      </div>
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
            </div>
          `, true);
        }
        const appDef = DASH_APP_CARDS.find((a) => a.id === w.id);
        if (appDef) {
          return wrap(w.id, `
            <div class="sb-card sb-app-widget-card">
              <div class="sb-app-widget-body">
                <div class="sb-app-widget-ico">${appDef.icon}</div>
                <div class="sb-app-widget-info">
                  <div class="sb-app-widget-name">${esc(appDef.name)}</div>
                  <div class="sb-muted-sm">${esc(appDef.desc)}</div>
                </div>
                <button type="button" class="sb-btn-primary-sm" ${appDef.app ? `data-dock-app="${esc(appDef.app)}"` : `data-jump-view="${esc(appDef.view)}"`}>열기 →</button>
              </div>
            </div>
          `, true);
        }
        return '';
      };

      if (dashGridEl) dashGridEl.innerHTML = dashLayout.map(buildWidgetHtml).join('');

      const wpGrid = $('sb-wp-grid');
      if (wpGrid) {
        const activeIds = new Set(dashLayout.map((x) => x.id));
        const catalog = [
          { id: 'projects', icon: '🚀', name: '진행 중 프로젝트' },
          { id: 'calendar-widget', icon: '📅', name: '구글 캘린더 (실시간 시간표)' },
          { id: 'top3', icon: '⭐', name: '오늘의 핵심 3가지' },
          { id: 'inbox', icon: '📥', name: '수신함 (기간별 탭)' },
          { id: 'apps-dock', icon: '⚡', name: '내장 앱 빠른 실행 보드' },
          { id: 'recent', icon: '📄', name: '최근 자료' },
          { id: 'life', icon: '🚦', name: '일정 신호등 · 외출 체크' },
          ...DASH_APP_CARDS.map((a) => ({ id: a.id, icon: a.icon, name: `${a.name} 앱 카드` }))
        ];
        wpGrid.innerHTML = catalog.map((c) => `
          <label class="sb-wp-item${activeIds.has(c.id) ? ' active' : ''}">
            <input type="checkbox" data-wp-toggle="${esc(c.id)}" ${activeIds.has(c.id) ? 'checked' : ''}>
            <span>${c.icon} ${esc(c.name)}</span>
          </label>
        `).join('');
        wpGrid.querySelectorAll('[data-wp-toggle]').forEach((chk) => {
          chk.addEventListener('change', () => {
            const wid = chk.dataset.wpToggle;
            const cur = loadDashLayout();
            if (chk.checked) {
              if (!cur.some((x) => x.id === wid)) {
                cur.push({
                  id: wid,
                  cols: wid === 'life' ? 12 : 6,
                  heightPx: wid === 'calendar-widget' ? 360 : 0
                });
              }
            } else {
              const idx = cur.findIndex((x) => x.id === wid);
              if (idx >= 0) cur.splice(idx, 1);
            }
            saveDashLayout(cur);
            renderAll();
          });
        });
      }

      $('sb-toggle-widget-picker')?.addEventListener('click', () => {
        dashWidgetPickerOpen = !dashWidgetPickerOpen;
        $('sb-widget-picker')?.classList.toggle('is-hidden', !dashWidgetPickerOpen);
      });
      $('sb-reset-dash-layout')?.addEventListener('click', () => {
        saveDashLayout(DEFAULT_DASH_LAYOUT.map((x) => ({ ...x })));
        hooks.showToast('↺ 대시보드 기본 배치로 복원되었습니다.');
        renderAll();
      });
      $('sb-dock-add-pinned')?.addEventListener('click', () => hooks.openPinAppModal?.());
      canvas.querySelectorAll('[data-dock-app]').forEach((b) => {
        b.addEventListener('click', () => hooks.launchBuiltinApp?.(b.dataset.dockApp));
      });
      canvas.querySelectorAll('[data-wspan]').forEach((b) => {
        b.addEventListener('click', () => {
          const cur = loadDashLayout();
          const item = cur.find((x) => x.id === b.dataset.wspan);
          if (item) {
            item.cols = Number(item.cols || 6) >= 10 ? 6 : 12;
            saveDashLayout(cur);
            renderAll();
          }
        });
      });
      canvas.querySelectorAll('[data-wrem]').forEach((b) => {
        b.addEventListener('click', () => {
          const cur = loadDashLayout().filter((x) => x.id !== b.dataset.wrem);
          saveDashLayout(cur);
          renderAll();
        });
      });

      // Drag-Resize Dashboard Widgets (Width in 12-col steps + Height in px)!
      canvas.querySelectorAll('[data-wresize]').forEach((handle) => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const wid = handle.dataset.wresize;
          const wEl = handle.closest('.sb-dash-widget');
          if (!wEl || !dashGridEl) return;

          const gridRect = dashGridEl.getBoundingClientRect();
          const startRect = wEl.getBoundingClientRect();
          const startX = e.clientX;
          const startY = e.clientY;
          const origW = startRect.width;
          const origH = startRect.height;
          let latestCols = Number(wEl.dataset.cols || 6);
          let latestH = Math.round(origH);
          const colUnit = Math.max(40, gridRect.width / 12);

          wEl.setAttribute('draggable', 'false');
          wEl.classList.add('is-resizing', 'has-custom-h');

          const pill = document.createElement('div');
          pill.className = 'sb-dash-resize-pill';
          wEl.appendChild(pill);

          const updatePill = () => {
            pill.textContent = `${latestCols}/12폭 · ${latestH}px`;
          };
          updatePill();

          const onMove = (mv) => {
            const dx = mv.clientX - startX;
            const dy = mv.clientY - startY;
            const targetW = Math.max(colUnit * 4, Math.min(gridRect.width, origW + dx));
            latestCols = Math.max(4, Math.min(12, Math.round(targetW / colUnit)));
            latestH = Math.max(180, Math.min(900, Math.round(origH + dy)));
            wEl.style.gridColumn = `span ${latestCols}`;
            wEl.style.height = `${latestH}px`;
            wEl.dataset.cols = String(latestCols);
            updatePill();
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            wEl.setAttribute('draggable', 'true');
            wEl.classList.remove('is-resizing');
            pill.remove();
            const cur = loadDashLayout();
            const item = cur.find((x) => x.id === wid);
            if (item) {
              item.cols = latestCols;
              item.heightPx = latestH;
              saveDashLayout(cur);
            }
            hooks.showToast(`📐 위젯 크기 저장 (${latestCols}/12폭 · ${latestH}px)`);
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      // Drag-and-Drop Widget Swapping & Pushing!
      canvas.querySelectorAll('.sb-dash-widget[data-wid]').forEach((wEl) => {
        wEl.addEventListener('dragstart', (e) => {
          if (e.target.closest('input, textarea, select, button, .sb-dash-resize-handle')) {
            e.preventDefault();
            return;
          }
          dragDashWidgetId = wEl.dataset.wid;
          wEl.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', dragDashWidgetId); } catch (_) {}
        });
        wEl.addEventListener('dragend', () => {
          dragDashWidgetId = null;
          canvas.querySelectorAll('.sb-dash-widget').forEach((x) => x.classList.remove('is-dragging', 'is-drop-target'));
        });
        wEl.addEventListener('dragover', (e) => {
          if (!dragDashWidgetId || dragDashWidgetId === wEl.dataset.wid) return;
          e.preventDefault();
          wEl.classList.add('is-drop-target');
        });
        wEl.addEventListener('dragleave', () => wEl.classList.remove('is-drop-target'));
        wEl.addEventListener('drop', (e) => {
          e.preventDefault();
          wEl.classList.remove('is-drop-target');
          const targetId = wEl.dataset.wid;
          if (!dragDashWidgetId || !targetId || dragDashWidgetId === targetId) return;
          const cur = loadDashLayout();
          const fromIdx = cur.findIndex((x) => x.id === dragDashWidgetId);
          const toIdx = cur.findIndex((x) => x.id === targetId);
          if (fromIdx < 0 || toIdx < 0) return;
          const [moved] = cur.splice(fromIdx, 1);
          cur.splice(toIdx, 0, moved);
          saveDashLayout(cur);
          hooks.showToast('🧩 대시보드 위젯 배치가 변경되었습니다.');
          renderAll();
        });
      });

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
      $('sb-btn-edit-life-goals')?.addEventListener('click', () => gtd?.openLifeGoalsModal());
      $('sb-open-explorer-from-recent')?.addEventListener('click', () => hooks.setHomeMode(false));

      // Fill Projects Table
      renderProjectsTableInto($('sb-home-projects-body'), projects.slice(0, 6), true);

      // Fill Top 3 (Unified Inbox/Project MD Cards with isTodayCore: true)
      renderHomeTop3Into($('sb-home-top3-list'), dfp);
      $('sb-top3-quick-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('sb-top3-quick-input');
        const timeInp = $('sb-top3-quick-time');
        const title = String(inp?.value || '').trim();
        if (!title) return;
        const coreTime = String(timeInp?.value || '').trim();
        if (inp) inp.value = '';
        if (timeInp) timeInp.value = '';
        captureQuickMemo({
          title,
          body: `# ${title}\n\n`,
          cardRole: 'T',
          isTodayCore: true,
          coreTime
        });
      });

      // Fill Quick Memo Composer
      $('sb-toggle-quick-memo')?.addEventListener('click', () => {
        showInlineComposer = !showInlineComposer;
        $('sb-inline-composer')?.classList.toggle('is-hidden', !showInlineComposer);
        if (showInlineComposer) $('sb-qm-body')?.focus();
      });
      // Home Inbox Direct Tabs
      canvas.querySelectorAll('[data-hitab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          homeInboxTab = btn.dataset.hitab || 'all';
          renderAll();
        });
      });

      // Home Quick Memo Period Presets
      canvas.querySelectorAll('[data-qm-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.qmPreset;
          if ($('sb-qm-role')) $('sb-qm-role').value = 'T';
          if (p === 'today') {
            if ($('sb-qm-start')) $('sb-qm-start').value = periodBuckets.todayYmd;
            if ($('sb-qm-end')) $('sb-qm-end').value = periodBuckets.todayYmd;
          } else if (p === 'tomorrow') {
            if ($('sb-qm-start')) $('sb-qm-start').value = periodBuckets.tomorrowYmd;
            if ($('sb-qm-end')) $('sb-qm-end').value = periodBuckets.tomorrowYmd;
          } else if (p === 'week') {
            if ($('sb-qm-start')) $('sb-qm-start').value = periodBuckets.todayYmd;
            if ($('sb-qm-end')) $('sb-qm-end').value = periodBuckets.weekEndYmd;
          }
        });
      });

      const doQuickSave = () => {
        const title = $('sb-qm-title')?.value || '';
        const body = $('sb-qm-body')?.value || '';
        const role = $('sb-qm-role')?.value || 'S';
        const isCore = Boolean($('sb-qm-todo')?.checked);
        const isSched = Boolean($('sb-qm-sched')?.checked);
        const startDate = String($('sb-qm-start')?.value || '').trim();
        const endDate = String($('sb-qm-end')?.value || '').trim();
        const startTime = String($('sb-qm-stime')?.value || '').trim();
        if (!String(title).trim() && !String(body).trim()) return;
        showInlineComposer = false;
        const created = captureQuickMemo({
          title,
          body,
          cardRole: (isCore || isSched || startDate || endDate) && role === 'S' ? 'T' : role,
          isTodayCore: isCore,
          coreTime: startTime
        });
        if (created) {
          const finalStart = startDate || endDate || (isSched ? hooks.getTodayYMD() : '');
          const finalEnd = endDate || finalStart;
          if (finalStart) {
            Store.updateCardSchedule(created, { startDate: finalStart, endDate: finalEnd });
          }
          if (startTime) {
            created.startTime = startTime;
            created.coreTime = startTime;
            const [sh, sm] = startTime.split(':').map(Number);
            const endM = Math.min(23 * 60 + 55, (sh || 0) * 60 + (sm || 0) + 60);
            created.endTime = `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
          }
          if (isSched) {
            created.isSchedule = true;
            created.travelMins = 30;
            created.bufferMins = 10;
            const curTags = Store.getCardTags(created);
            if (!curTags.includes('일정')) Store.setCardTags(created, ['일정', ...curTags]);
          }
          Store.touchNode(created);
          hooks.saveAndRender();
          renderAll();
        }
      };
      $('sb-qm-save')?.addEventListener('click', doQuickSave);
      $('sb-qm-body')?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          doQuickSave();
        }
      });

      // Fill Live Google Calendar Widget if placed on Dashboard
      const gcalWidgetHost = $('sb-home-gcal-widget');
      if (gcalWidgetHost) {
        getGoogleCalendar()?.renderDashboardCalendarWidget(gcalWidgetHost, {
          onOpenFullCalendar: () => {
            activeView = 'calendar';
            renderAll();
          }
        });
      }

      // Fill Inbox Preview List (filtered by active Home Inbox Tab)
      renderInboxPreviewInto($('sb-home-inbox-list'), inbox, periodBuckets);

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

      // Sort hierarchically (Lv.1 parent followed immediately by Lv.2/Lv.3 children)
      const projMap = new Map(projects.map((p) => [p.id, p]));
      const childrenByParent = new Map();
      const roots = [];
      projects.forEach((p) => {
        if (p.parentProjectId && projMap.has(p.parentProjectId)) {
          if (!childrenByParent.has(p.parentProjectId)) childrenByParent.set(p.parentProjectId, []);
          childrenByParent.get(p.parentProjectId).push(p);
        } else {
          roots.push(p);
        }
      });
      const flatHierarchy = [];
      const walkH = (list, visited = new Set()) => {
        list.forEach((p) => {
          if (visited.has(p.id)) return;
          visited.add(p.id);
          flatHierarchy.push(p);
          if (childrenByParent.has(p.id)) walkH(childrenByParent.get(p.id), visited);
        });
      };
      walkH(roots);

      container.innerHTML = `
        <div class="sb-proj-table">
          <div class="sb-proj-thead">
            <span>프로젝트 (드래그로 상하관계 설정)</span>
            <span>진행도</span>
            <span>마감까지</span>
            <span>상태</span>
            <span>작업</span>
          </div>
          ${flatHierarchy.map((p) => {
            const dday = computeDdayInfo(p.dueDate);
            const isHold = p.status === 'hold';
            const statusText = isHold ? '보류' : '진행';
            const prog = Math.max(0, Math.min(100, Number(p.progress || 0)));
            const linkedCnt = getLinkedCount(p.id);
            const code = Store.getParaCode(p);
            const lv = Store.getProjectLevel(p.id);
            const missedCnt = Store.getProjectOverdueMissedTasks(p.id, hooks.isItemVisible).length;
            const indentPx = Math.min(lv - 1, 3) * 18;
            return `
              <div class="sb-proj-row${missedCnt > 0 ? ' is-overdue-row' : ''}" draggable="true" data-pid="${esc(p.id)}">
                <div class="sb-proj-name-wrap" style="padding-left:${indentPx}px">
                  ${lv > 1 ? `<span class="sb-sub-arrow">↳</span>` : ''}
                  <button type="button" class="sb-proj-name-btn" data-pact="detail" title="클릭하여 프로젝트 상세 열기 · 드래그하여 다른 프로젝트 하위로 이동">
                    <span class="sb-proj-dot ${missedCnt > 0 ? 'is-overdue' : (isHold ? 'is-hold' : 'is-active')}"></span>
                    <span class="sb-lv-badge">Lv.${lv}</span>
                    <span class="sb-code-pill-xs">${esc(code)}</span>
                    <span class="sb-proj-name">${esc(p.name)}</span>
                    ${missedCnt > 0 ? `<span class="sb-overdue-badge">누락 ${missedCnt}</span>` : ''}
                    ${linkedCnt > 0 ? `<span class="sb-proj-linked-mini">${linkedCnt}</span>` : ''}
                  </button>
                  ${lv > 1 ? `<button type="button" class="sb-mini-icon-act" data-pact="unnest" title="상하관계 해제 (Lv.1)">⤴</button>` : ''}
                </div>
                <div class="sb-proj-prog-cell" data-pact="step-prog" title="클릭하여 진행도 +10% 조절">
                  <div class="sb-prog-track"><div class="sb-prog-fill" style="width:${prog}%"></div></div>
                  <span class="sb-prog-pct">${prog}%</span>
                </div>
                <div>
                  <button type="button" class="sb-dday-pill${dday.urgent ? ' is-urgent' : ''}${dday.days === null ? ' is-empty' : ''}" data-pact="edit" title="마감일·속성 편집">${esc(dday.text)}</button>
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

        row.addEventListener('dragstart', (e) => {
          dragProjectId = pid;
          row.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          dragProjectId = null;
          row.classList.remove('is-dragging');
          container.querySelectorAll('.sb-proj-row').forEach((r) => r.classList.remove('is-drag-over'));
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (dragProjectId && dragProjectId !== pid) row.classList.add('is-drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('is-drag-over');
          if (!dragProjectId || dragProjectId === pid) return;
          if (Store.setProjectParent(dragProjectId, pid)) {
            const childEnt = Store.findParaEntity(dragProjectId);
            hooks.saveAndRender();
            renderAll();
            hooks.showToast(`📂 "${childEnt?.name || ''}" → "${ent.name}" 하위(Lv.${Store.getProjectLevel(dragProjectId)})로 편입됨`);
          }
        });

        row.querySelector('[data-pact="detail"]')?.addEventListener('click', () => {
          openProjectDetail(ent.id, 'cards');
        });
        row.querySelector('[data-pact="unnest"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          Store.setProjectParent(ent.id, '');
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`⤴ "${ent.name}" 상하관계가 해제되어 Lv.1이 되었습니다.`);
        });
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
          if (projectWorkspace) {
            projectWorkspace.openProjectCompleteModal(ent, () => renderAll());
          } else {
            Store.completeAndArchiveProject(ent.id);
            hooks.saveAndRender();
            renderAll();
            hooks.showToast(`"${ent.name}" 완료 후 보관함(Archives)으로 보냈습니다.`);
          }
        });
      });
    }

    // Shared recursive sub-card renderer for Dashboard Top 3 & Inbox
    function renderSubCardsTreeHtml(parentDocId, depth = 1, visited = new Set()) {
      if (visited.has(parentDocId) || depth > 4) return '';
      const nextVis = new Set(visited);
      nextVis.add(parentDocId);
      const kids = Store.getSubCards(parentDocId, hooks.isItemVisible);
      if (kids.length === 0) return '';

      return kids.map((child) => {
        const subKids = Store.getSubCards(child.id, hooks.isItemVisible);
        const hasSub = subKids.length > 0;
        const isExp = expandedDashIds.has(child.id);
        const role = Store.getCardRole(child);
        const cleanTitle = String(child.name || '').replace(/\.md$/i, '');
        return `
          <div class="sb-dash-subcard-row${child.completed ? ' is-done' : ''}" data-subdoc-id="${esc(child.id)}" style="padding-left:${depth * 18}px">
            <span class="sb-sub-arrow">↳</span>
            ${hasSub
              ? `<button type="button" class="sb-tree-toggle sb-tree-toggle-xs" data-sact="toggle-sub" title="${isExp ? '하위 접기' : '하위 펼치기'}">${isExp ? '−' : '+'}</button>`
              : ''}
            <button type="button" class="sb-checkbox-box sb-checkbox-xs${child.completed ? ' is-checked' : ''}" data-sact="complete" title="${child.completed ? '완료 취소' : '완료 처리'}">${child.completed ? svg('check', 10) : ''}</button>
            <span class="sb-role-pill-xs is-role-${role.toLowerCase()}" data-sact="cycle-role" title="클릭하여 자료형태 변경">${role}</span>
            <button type="button" class="sb-subcard-title" data-sact="open">${esc(cleanTitle)}</button>
            <div class="sb-subcard-acts">
              <button type="button" class="sb-mini-icon-act${child.isTodayCore ? ' is-star-on' : ''}" data-sact="toggle-core" title="오늘의 핵심 토글">${child.isTodayCore ? '★' : '☆'}</button>
              <button type="button" class="sb-mini-icon-act" data-sact="add-sub" title="하위 카드 추가">+</button>
              <button type="button" class="sb-mini-icon-act is-del" data-sact="del" title="카드 삭제">✕</button>
            </div>
          </div>
          ${inlineSubTargetId === child.id ? renderInlineDashSubFormHtml(child.id, depth + 1) : ''}
          ${hasSub && isExp ? renderSubCardsTreeHtml(child.id, depth + 1, nextVis) : ''}
        `;
      }).join('');
    }

    function renderInlineDashSubFormHtml(parentId, depth = 1) {
      return `
        <form class="sb-inline-sub-form sb-inline-sub-compact" data-dash-sub-parent="${esc(parentId)}" style="margin-left:${depth * 18}px">
          <span class="sb-sub-arrow">↳</span>
          <input type="text" class="sb-field-input sb-sub-title-inp" placeholder="하위 카드 제목..." required>
          <select class="sb-field-select sb-sub-role-sel">
            <option value="T">T</option>
            <option value="S">S</option>
            <option value="R">R</option>
          </select>
          <button type="submit" class="sb-btn-primary-sm">추가</button>
          <button type="button" class="sb-btn-subtle" data-cancel-dash-sub="1">취소</button>
        </form>
      `;
    }

    function bindSubCardEvents(container) {
      container.querySelectorAll('.sb-dash-subcard-row[data-subdoc-id]').forEach((row) => {
        const child = Store.findNodeAndParent(row.dataset.subdocId)?.node;
        if (!child) return;
        row.querySelector('[data-sact="toggle-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedDashIds.has(child.id)) expandedDashIds.delete(child.id);
          else expandedDashIds.add(child.id);
          renderAll();
        });
        row.querySelector('[data-sact="open"]')?.addEventListener('click', () => openCardProps(child));
        row.querySelector('[data-sact="cycle-role"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = Store.getCardRole(child);
          const next = cur === 'T' ? 'S' : (cur === 'S' ? 'R' : 'T');
          Store.setCardRole(child, next);
          hooks.saveAndRender();
          renderAll();
        });
        row.querySelector('[data-sact="toggle-core"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          Store.setCardTodayCore(child, !child.isTodayCore);
          hooks.saveAndRender();
          renderAll();
        });
        row.querySelector('[data-sact="add-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          inlineSubTargetId = inlineSubTargetId === child.id ? null : child.id;
          expandedDashIds.add(child.id);
          renderAll();
          container.querySelector('.sb-sub-title-inp')?.focus();
        });
        row.querySelector('[data-sact="complete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (child.completed) {
            child.completed = false;
            child.completedAt = 0;
            Store.touchNode(child);
            hooks.saveAndRender();
            renderAll();
          } else if (Store.getCardRole(child) === 'T' && projectWorkspace) {
            projectWorkspace.openTaskCompletionModal(child);
          } else {
            child.completed = true;
            child.completedAt = Date.now();
            Store.touchNode(child);
            hooks.saveAndRender();
            renderAll();
          }
        });
        row.querySelector('[data-sact="del"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (deleteCardNode(child)) hooks.showToast('하위 카드가 삭제되었습니다.');
        });
      });

      container.querySelectorAll('.sb-inline-sub-form[data-dash-sub-parent]').forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const pDoc = Store.findNodeAndParent(form.dataset.dashSubParent)?.node;
          const title = form.querySelector('.sb-sub-title-inp')?.value || '';
          const role = form.querySelector('.sb-sub-role-sel')?.value || 'T';
          if (!pDoc || !title.trim()) return;
          inlineSubTargetId = null;
          captureQuickMemo({ title, body: `# ${title.trim()}\n\n`, cardRole: role, parentDoc: pDoc });
        });
        form.querySelector('[data-cancel-dash-sub]')?.addEventListener('click', () => {
          inlineSubTargetId = null;
          renderAll();
        });
      });
    }

    function renderHomeTop3Into(container, dfp) {
      if (!container) return;
      const coreDocs = getTodayCoreCards();
      const legacyTasks = (dfp.top3 || []).filter((t) => !t.docId || !coreDocs.some((d) => d.id === t.docId));

      if (coreDocs.length === 0 && legacyTasks.length === 0) {
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>오늘의 핵심으로 지정된 카드가 없어요</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-focus-top3">· 아래에서 추가하거나 수신함에서 ★ 체크</button>
          </div>
        `;
        $('sb-empty-focus-top3')?.addEventListener('click', () => $('sb-top3-quick-input')?.focus());
        return;
      }

      const docsHtml = coreDocs.map((doc) => {
        const subKids = Store.getSubCards(doc.id, hooks.isItemVisible);
        const hasSub = subKids.length > 0;
        const isExp = expandedDashIds.has(doc.id);
        const rels = Store.getRelationsForNode(doc.id);
        const proj = (rels.projects || []).find((x) => x.node?.type === 'para-entity')?.node;
        const cleanTitle = String(doc.name || '').replace(/\.md$/i, '');
        return `
          <div class="sb-top3-card-block" data-core-doc="${esc(doc.id)}">
            <div class="sb-top3-row">
              ${hasSub
                ? `<button type="button" class="sb-tree-toggle" data-cact="toggle-sub" title="${isExp ? '하위 접기' : '하위 펼치기'}">${isExp ? '−' : '+'}</button>`
                : ''}
              <button type="button" class="sb-checkbox-box" data-cact="complete" title="완료 처리 (내부/외부처리)" aria-label="완료">${svg('check', 12)}</button>
              <button type="button" class="sb-top3-title sb-top3-title-btn" data-cact="open" title="클릭하여 카드 열기">${esc(cleanTitle)}</button>
              ${proj ? `<span class="sb-code-pill-xs" title="${esc(proj.name)}">${esc(Store.getParaCode(proj))}</span>` : ''}
              ${doc.coreTime ? `<span class="sb-top3-time">${esc(formatKoreanTime(doc.coreTime))}</span>` : ''}
              <div class="sb-top3-row-acts">
                <button type="button" class="sb-mini-icon-act" data-cact="add-sub" title="하위 카드 추가">+</button>
                <button type="button" class="sb-mini-icon-act" data-cact="unpin" title="완료하지 않고 오늘의 핵심에서 내리기">−</button>
                <button type="button" class="sb-mini-icon-act is-del" data-cact="delete" title="완료하지 않고 카드 삭제">${svg('trash', 12)}</button>
              </div>
            </div>
            ${inlineSubTargetId === doc.id ? renderInlineDashSubFormHtml(doc.id, 1) : ''}
            ${hasSub && isExp ? renderSubCardsTreeHtml(doc.id, 1) : ''}
          </div>
        `;
      }).join('');

      const legacyHtml = legacyTasks.map((t, idx) => `
        <div class="sb-top3-row" data-tidx="${idx}">
          <button type="button" class="sb-checkbox-box" data-tact="done" title="완료 처리" aria-label="완료">${svg('check', 12)}</button>
          <span class="sb-top3-title" contenteditable="true" spellcheck="false">${esc(t.title)}</span>
          ${t.time ? `<span class="sb-top3-time">${esc(formatKoreanTime(t.time))}</span>` : ''}
          <button type="button" class="sb-mini-icon-act is-del" data-tact="remove" title="완료 없이 목록에서 삭제">✕</button>
        </div>
      `).join('');

      container.innerHTML = docsHtml + legacyHtml;

      container.querySelectorAll('.sb-top3-card-block[data-core-doc]').forEach((block) => {
        const doc = Store.findNodeAndParent(block.dataset.coreDoc)?.node;
        if (!doc) return;
        block.querySelector('[data-cact="toggle-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedDashIds.has(doc.id)) expandedDashIds.delete(doc.id);
          else expandedDashIds.add(doc.id);
          renderAll();
        });
        block.querySelector('[data-cact="open"]')?.addEventListener('click', () => openCardProps(doc));
        block.querySelector('[data-cact="complete"]')?.addEventListener('click', () => {
          if (projectWorkspace) projectWorkspace.openTaskCompletionModal(doc);
          else {
            doc.completed = true;
            doc.completedAt = Date.now();
            Store.touchNode(doc);
            hooks.saveAndRender();
            renderAll();
          }
        });
        block.querySelector('[data-cact="add-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          inlineSubTargetId = inlineSubTargetId === doc.id ? null : doc.id;
          expandedDashIds.add(doc.id);
          renderAll();
          container.querySelector('.sb-sub-title-inp')?.focus();
        });
        block.querySelector('[data-cact="unpin"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          Store.setCardTodayCore(doc, false);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(`"${doc.name.replace(/\.md$/i, '')}" 오늘의 핵심에서 내렸습니다. (완료 안 함 · 수신함/프로젝트 유지)`);
        });
        block.querySelector('[data-cact="delete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const name = doc.name.replace(/\.md$/i, '');
          if (deleteCardNode(doc)) {
            hooks.showToast(`"${name}" 카드를 삭제했습니다.`);
          }
        });
      });

      bindSubCardEvents(container);

      container.querySelectorAll('.sb-top3-row[data-tidx]').forEach((row) => {
        const idx = Number(row.dataset.tidx);
        const task = legacyTasks[idx];
        row.querySelector('[data-tact="done"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          const rIdx = cur.top3.findIndex((x) => x.id === task?.id);
          if (rIdx >= 0) {
            const removed = cur.top3.splice(rIdx, 1)[0];
            const todayStr = hooks.getTodayYMD();
            cur.archive.unshift({ ...removed, completedAt: todayStr });
            if (!cur.completedDates) cur.completedDates = {};
            cur.completedDates[todayStr] = Number(cur.completedDates[todayStr] || 0) + 1;
            hooks.saveDfpState(cur);
            renderAll();
            hooks.showToast(`완료됨: ${removed.title}`);
          }
        });
        row.querySelector('[data-tact="remove"]')?.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          cur.top3 = (cur.top3 || []).filter((x) => x.id !== task?.id);
          hooks.saveDfpState(cur);
          renderAll();
          hooks.showToast('완료하지 않고 오늘의 핵심에서 삭제했습니다.');
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

    function renderInboxPreviewInto(container, inbox, buckets = null) {
      if (!container) return;
      const b = buckets || computeInboxPeriodBuckets();
      let listSource = inbox.unassignedDocs;
      if (homeInboxTab === 'overdue') listSource = b.overdueDocs;
      else if (homeInboxTab === 'today') listSource = b.todayDocs;
      else if (homeInboxTab === 'tomorrow') listSource = b.tomorrowDocs;
      else if (homeInboxTab === 'week') listSource = b.weekDocs;

      const sourceIdSet = new Set(listSource.map((d) => d.id));
      const rootDocs = (homeInboxTab === 'all'
        ? listSource.filter((d) => !d.parentCardId || !sourceIdSet.has(d.parentCardId))
        : listSource
      ).slice(0, 8);

      if (rootDocs.length === 0 && (homeInboxTab !== 'all' || inbox.backlogTasks.length === 0)) {
        const emptyMsgs = {
          all: '수신함이 비어 있어요',
          overdue: '기간이 지난 미완료 할일이 없어요 👍',
          today: '오늘 예정된 할일이 없어요',
          tomorrow: '내일 예정된 할일이 없어요',
          week: '이번 주 예정된 할일이 없어요'
        };
        container.innerHTML = `
          <div class="sb-empty-line">
            <span>${emptyMsgs[homeInboxTab] || '항목이 비어 있어요'}</span>
            <button type="button" class="sb-empty-cta" id="sb-empty-new-memo">· 빠른 메모/할일 추가</button>
          </div>
        `;
        $('sb-empty-new-memo')?.addEventListener('click', () => {
          showInlineComposer = true;
          $('sb-inline-composer')?.classList.remove('is-hidden');
          $('sb-qm-body')?.focus();
        });
        return;
      }

      const rowsHtml = rootDocs.map((doc) => {
        const snippet = String(doc.summary || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
        const role = Store.getCardRole(doc);
        const subKids = Store.getSubCards(doc.id, hooks.isItemVisible);
        const hasSub = subKids.length > 0;
        const isExp = expandedDashIds.has(doc.id);
        const periodBadge = formatPeriodBadgeHtml(doc, b.todayYmd);
        return `
          <div class="sb-inbox-item-wrap" data-doc-id="${esc(doc.id)}">
            <div class="sb-inbox-item${!doc.completed && doc.endDate && doc.endDate < b.todayYmd ? ' is-overdue-row' : ''}">
              ${hasSub
                ? `<button type="button" class="sb-tree-toggle" data-iact="toggle-sub" title="${isExp ? '하위 접기' : '하위 펼치기'}">${isExp ? '−' : '+'}</button>`
                : `<button type="button" class="sb-checkbox-sm${doc.completed ? ' checked' : ''}" data-iact="complete" title="완료 처리">${doc.completed ? '✓' : ''}</button>`}
              <div class="sb-inbox-item-text" data-open-doc="1">
                <div class="sb-inbox-item-title-row">
                  <span class="sb-role-pill-xs is-role-${role.toLowerCase()}" data-iact="cycle-role" title="자료형태 클릭 전환 (T/S/R)">${role}</span>
                  <span class="sb-inbox-item-title">${esc(doc.name.replace(/\.md$/i, ''))}</span>
                  ${periodBadge}
                </div>
                <div class="sb-inbox-item-snippet">${esc(snippet || '내용 없음')}</div>
              </div>
              <div class="sb-par-btns">
                <button type="button" class="sb-mini-ghost" data-iact="clarify" title="GTD 명확화 (행동 필요? 2분규칙 · 위임 · 다음행동 · 버림/참고/언젠가)">명확화</button>
                ${role === 'S' ? `<button type="button" class="sb-extract-pill is-ex-${Number(doc.extractStage || 1)}" data-iact="extract" title="점진적 요약 (추출 1~4단계)">추출${Number(doc.extractStage || 1)}</button>` : ''}
                <button type="button" class="sb-mini-icon-act${doc.isTodayCore ? ' is-star-on' : ''}" data-iact="toggle-core" title="오늘의 핵심에 올리기/빼기">${doc.isTodayCore ? '★' : '☆'}</button>
                <button type="button" class="sb-mini-icon-act" data-iact="add-sub" title="하위 카드 추가">+</button>
                <button type="button" class="sb-par-btn" data-par="project" title="프로젝트로 분류">P</button>
                <button type="button" class="sb-par-btn" data-par="area" title="영역으로 분류">A</button>
                <button type="button" class="sb-par-btn" data-par="resource" title="자료로 분류">R</button>
              </div>
            </div>
            ${inlineSubTargetId === doc.id ? renderInlineDashSubFormHtml(doc.id, 1) : ''}
            ${hasSub && isExp ? renderSubCardsTreeHtml(doc.id, 1) : ''}
          </div>
        `;
      }).join('');

      const taskPreviewHtml = homeInboxTab === 'all' && rootDocs.length < 3
        ? inbox.backlogTasks.slice(0, 3 - rootDocs.length).map((t) => `
            <div class="sb-inbox-item is-task">
              <span class="sb-inbox-item-ico">${svg('star', 14)}</span>
              <div class="sb-inbox-item-text">
                <div class="sb-inbox-item-title">${esc(t.title)}</div>
                <div class="sb-inbox-item-snippet">할 일 대기 목록</div>
              </div>
              <button type="button" class="sb-mini-ghost" data-promote-task="${esc(t.id)}" title="오늘의 핵심으로 올리기">핵심</button>
            </div>
          `).join('')
        : '';

      container.innerHTML = rowsHtml + taskPreviewHtml;

      container.querySelectorAll('.sb-inbox-item-wrap[data-doc-id]').forEach((wrap) => {
        const doc = Store.findNodeAndParent(wrap.dataset.docId)?.node;
        if (!doc) return;
        wrap.querySelector('[data-iact="complete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          doc.completed = !doc.completed;
          doc.completedAt = doc.completed ? Date.now() : 0;
          Store.touchNode(doc);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(doc.completed ? `✅ "${doc.name.replace(/\.md$/i, '')}" 완료 처리됨` : '미완료로 복원됨');
        });
        wrap.querySelector('[data-iact="toggle-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedDashIds.has(doc.id)) expandedDashIds.delete(doc.id);
          else expandedDashIds.add(doc.id);
          renderAll();
        });
        wrap.querySelector('[data-iact="cycle-role"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = Store.getCardRole(doc);
          const next = cur === 'T' ? 'S' : (cur === 'S' ? 'R' : 'T');
          Store.setCardRole(doc, next);
          hooks.saveAndRender();
          renderAll();
        });
        wrap.querySelector('[data-iact="clarify"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          gtd?.openClarifyModal(doc);
        });
        wrap.querySelector('[data-iact="extract"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          gtd?.openExtractModal(doc);
        });
        wrap.querySelector('[data-iact="toggle-core"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = !doc.isTodayCore;
          Store.setCardTodayCore(doc, next);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(next ? '★ 오늘의 핵심에 올렸습니다.' : '오늘의 핵심에서 내렸습니다.');
        });
        wrap.querySelector('[data-iact="add-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          inlineSubTargetId = inlineSubTargetId === doc.id ? null : doc.id;
          expandedDashIds.add(doc.id);
          renderAll();
          container.querySelector('.sb-sub-title-inp')?.focus();
        });
        wrap.querySelector('[data-open-doc]')?.addEventListener('click', () => openCardProps(doc));
        wrap.querySelectorAll('[data-par]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openQuickClassifyMenu(btn, doc, btn.dataset.par);
          });
        });
      });

      bindSubCardEvents(container);

      container.querySelectorAll('[data-promote-task]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cur = hooks.loadDfpState();
          const idx = cur.backlog.findIndex((x) => x.id === btn.dataset.promoteTask);
          if (idx >= 0) {
            const [picked] = cur.backlog.splice(idx, 1);
            hooks.saveDfpState(cur);
            captureQuickMemo({ title: picked.title, cardRole: 'T', isTodayCore: true });
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

      const buckets = computeInboxPeriodBuckets();
      const { todayYmd, tomorrowYmd, weekEndYmd, overdueDocs, todayDocs: todayTaskDocs, tomorrowDocs: tomorrowTaskDocs, weekDocs: weekTaskDocs } = buckets;

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">수신함 (Inbox)</h1>
            <p class="sb-page-sub">기간별(기간지남 · 오늘 · 내일 · 이번 주)로 할일을 바로 관리하고, 카드를 눌러 기간·소속 프로젝트·다음 행동을 설정하세요.</p>
          </div>
          <button type="button" class="sb-btn-subtle" id="sb-inbox-open-cal">📅 구글 캘린더 보기</button>
        </header>

        <section class="sb-card sb-inbox-composer-card">
          <div class="sb-composer-grid sb-composer-grid-4">
            <input type="text" id="sb-inbox-title" class="sb-field-input" placeholder="메모 / 할일 / 마일스톤 제목 (선택)">
            <select id="sb-inbox-role-select" class="sb-field-select" title="카드 유형">
              <option value="T">T 할일 (Todo)</option>
              <option value="S" selected>S 자료 (Source)</option>
              <option value="R">R 산출물 (Result)</option>
              <option value="M">◆ M 마일스톤</option>
            </select>
            <select id="sb-inbox-para-select" class="sb-field-select">${paraOptionsHtml}</select>
            <div class="sb-qm-period-row">
              <input type="date" id="sb-inbox-start" class="sb-field-input" title="시작일">
              <span style="color:var(--text-muted); font-size:0.75rem;">~</span>
              <input type="date" id="sb-inbox-date" class="sb-field-input" title="종료 / 마감일">
            </div>
          </div>
          <div class="sb-qm-preset-strip">
            <span class="sb-muted-sm">기간 빠른 설정:</span>
            <button type="button" class="sb-mini-ghost" data-ipreset="today">오늘 할일</button>
            <button type="button" class="sb-mini-ghost" data-ipreset="tomorrow">내일 할일</button>
            <button type="button" class="sb-mini-ghost" data-ipreset="week">이번 주</button>
            <button type="button" class="sb-mini-ghost" data-ipreset="clear">기간 초기화</button>
          </div>
          <textarea id="sb-inbox-body" rows="2" class="sb-field-textarea" placeholder="떠오르는 아이디어, 회의 메모, 할 일을 빠르게 기록하세요... (Ctrl+Enter 저장)"></textarea>
          <div class="sb-qm-foot">
            <label class="sb-check-inline">
              <input type="checkbox" id="sb-inbox-add-todo">
              <span>★ 오늘의 핵심에 올리기 (체크 시 대시보드 오늘의 핵심에 표시)</span>
            </label>
            <button type="button" class="sb-btn-primary" id="sb-inbox-save-btn">수신함에 저장</button>
          </div>
        </section>

        <section class="sb-card">
          <div class="sb-subtabs">
            <button type="button" class="sb-subtab${inboxTab === 'all' ? ' active' : ''}" data-itab="all">전체 <span>${inbox.totalCount}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'overdue' ? ' active' : ''}${overdueDocs.length > 0 ? ' is-danger' : ''}" data-itab="overdue">⚠️ 기간지남 <span>${overdueDocs.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'today' ? ' active' : ''}" data-itab="today">오늘 할일 <span>${todayTaskDocs.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'tomorrow' ? ' active' : ''}" data-itab="tomorrow">내일 할일 <span>${tomorrowTaskDocs.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'week' ? ' active' : ''}" data-itab="week">이번 주 할일 <span>${weekTaskDocs.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'memos' ? ' active' : ''}" data-itab="memos">미분류 메모 <span>${inbox.memos.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'files' ? ' active' : ''}" data-itab="files">미분류 파일 <span>${inbox.files.length}</span></button>
            <button type="button" class="sb-subtab${inboxTab === 'done' ? ' active' : ''}" data-itab="done">완료된 할 일 <span>${inbox.doneTasks.length}</span></button>
          </div>
          <div class="sb-inbox-full-list" id="sb-inbox-full-list"></div>
        </section>
      `;

      $('sb-inbox-open-cal')?.addEventListener('click', () => {
        activeView = 'calendar';
        renderAll();
      });

      canvas.querySelectorAll('[data-ipreset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.ipreset;
          if (p === 'clear') {
            if ($('sb-inbox-start')) $('sb-inbox-start').value = '';
            if ($('sb-inbox-date')) $('sb-inbox-date').value = '';
            return;
          }
          if ($('sb-inbox-role-select')) $('sb-inbox-role-select').value = 'T';
          if (p === 'today') {
            if ($('sb-inbox-start')) $('sb-inbox-start').value = todayYmd;
            if ($('sb-inbox-date')) $('sb-inbox-date').value = todayYmd;
          } else if (p === 'tomorrow') {
            if ($('sb-inbox-start')) $('sb-inbox-start').value = tomorrowYmd;
            if ($('sb-inbox-date')) $('sb-inbox-date').value = tomorrowYmd;
          } else if (p === 'week') {
            if ($('sb-inbox-start')) $('sb-inbox-start').value = todayYmd;
            if ($('sb-inbox-date')) $('sb-inbox-date').value = weekEndYmd;
          }
        });
      });

      const doInboxSave = () => {
        const paraVal = $('sb-inbox-para-select')?.value || '';
        const [pType, pId] = paraVal.includes('::') ? paraVal.split('::') : ['', ''];
        const role = $('sb-inbox-role-select')?.value || 'S';
        const isCore = Boolean($('sb-inbox-add-todo')?.checked);
        const startVal = String($('sb-inbox-start')?.value || '').trim();
        const dateVal = String($('sb-inbox-date')?.value || '').trim();
        const created = captureQuickMemo({
          title: $('sb-inbox-title')?.value || '',
          body: $('sb-inbox-body')?.value || '',
          cardRole: (isCore || startVal || dateVal) && role === 'S' ? 'T' : role,
          isTodayCore: isCore,
          paraType: pType,
          paraId: pId
        });
        if (created && (startVal || dateVal)) {
          Store.updateCardSchedule(created, {
            startDate: startVal || dateVal,
            endDate: dateVal || startVal
          });
          hooks.saveAndRender();
          renderAll();
        }
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

      const docsToShow = inboxTab === 'overdue'
        ? overdueDocs
        : (inboxTab === 'today'
          ? todayTaskDocs
          : (inboxTab === 'tomorrow'
            ? tomorrowTaskDocs
            : (inboxTab === 'week'
              ? weekTaskDocs
              : (inboxTab === 'memos'
                ? inbox.memos
                : (inboxTab === 'files' ? inbox.files : (inboxTab === 'all' ? inbox.unassignedDocs : []))))));
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
        const role = Store.getCardRole(doc);
        const subKids = Store.getSubCards(doc.id, hooks.isItemVisible);
        const hasSub = subKids.length > 0;
        const isExp = expandedDashIds.has(doc.id);
        const periodBadge = formatPeriodBadgeHtml(doc, todayYmd);
        const isOverdue = !doc.completed && doc.endDate && doc.endDate < todayYmd;
        return `
          <div class="sb-inbox-item-wrap" data-doc-id="${esc(doc.id)}">
            <div class="sb-inbox-full-row${isOverdue ? ' is-overdue-row' : ''}">
              ${hasSub
                ? `<button type="button" class="sb-tree-toggle" data-iact="toggle-sub" title="${isExp ? '하위 접기' : '하위 펼치기'}">${isExp ? '−' : '+'}</button>`
                : `<button type="button" class="sb-checkbox-sm${doc.completed ? ' checked' : ''}" data-iact="complete" title="완료 처리">${doc.completed ? '✓' : ''}</button>`}
              <div class="sb-inbox-item-text" data-open-doc="1">
                <div class="sb-inbox-item-title-row">
                  <span class="sb-role-pill-xs is-role-${role.toLowerCase()}" data-iact="cycle-role" title="자료형태 클릭 전환">${role}</span>
                  <span class="sb-inbox-item-title">${esc(doc.name.replace(/\.md$/i, ''))}</span>
                  ${periodBadge}
                </div>
                <div class="sb-inbox-item-snippet">${esc(snippet || '내용 없음')} · ${esc(formatRelativeTime(doc.updatedAt || doc.createdAt))}</div>
              </div>
              <div class="sb-par-btns">
                <button type="button" class="sb-mini-ghost" data-iact="clarify" title="GTD 명확화 위자드">명확화</button>
                ${role === 'S' ? `<button type="button" class="sb-extract-pill is-ex-${Number(doc.extractStage || 1)}" data-iact="extract" title="점진적 요약 (추출 1~4단계)">추출 ${Number(doc.extractStage || 1)}단계</button>` : ''}
                <button type="button" class="sb-mini-icon-act${doc.isTodayCore ? ' is-star-on' : ''}" data-iact="toggle-core" title="오늘의 핵심 토글">${doc.isTodayCore ? '★' : '☆'}</button>
                <button type="button" class="sb-mini-icon-act" data-iact="add-sub" title="하위 카드 추가">+</button>
                <button type="button" class="sb-par-btn" data-par="project" title="프로젝트 연결">P</button>
                <button type="button" class="sb-par-btn" data-par="area" title="영역 연결">A</button>
                <button type="button" class="sb-par-btn" data-par="resource" title="자료 연결">R</button>
                <button type="button" class="sb-mini-ghost" data-locate-doc="1" title="탐색기에서 보기">${svg('explorer', 13)}</button>
                <button type="button" class="sb-mini-icon-act is-del" data-iact="del" title="삭제">${svg('trash', 12)}</button>
              </div>
            </div>
            ${inlineSubTargetId === doc.id ? renderInlineDashSubFormHtml(doc.id, 1) : ''}
            ${hasSub && isExp ? renderSubCardsTreeHtml(doc.id, 1) : ''}
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

      listEl.querySelectorAll('.sb-inbox-item-wrap[data-doc-id]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.docId)?.node;
        if (!doc) return;
        row.querySelector('[data-iact="complete"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          doc.completed = !doc.completed;
          doc.completedAt = doc.completed ? Date.now() : 0;
          Store.touchNode(doc);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(doc.completed ? `✅ "${doc.name.replace(/\.md$/i, '')}" 완료 처리됨` : '미완료로 복원됨');
        });
        row.querySelector('[data-iact="toggle-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedDashIds.has(doc.id)) expandedDashIds.delete(doc.id);
          else expandedDashIds.add(doc.id);
          renderAll();
        });
        row.querySelector('[data-iact="cycle-role"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = Store.getCardRole(doc);
          const next = cur === 'T' ? 'S' : (cur === 'S' ? 'R' : 'T');
          Store.setCardRole(doc, next);
          hooks.saveAndRender();
          renderAll();
        });
        row.querySelector('[data-iact="clarify"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          gtd?.openClarifyModal(doc);
        });
        row.querySelector('[data-iact="extract"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          gtd?.openExtractModal(doc);
        });
        row.querySelector('[data-iact="toggle-core"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = !doc.isTodayCore;
          Store.setCardTodayCore(doc, next);
          hooks.saveAndRender();
          renderAll();
          hooks.showToast(next ? '★ 오늘의 핵심에 올렸습니다.' : '오늘의 핵심에서 내렸습니다.');
        });
        row.querySelector('[data-iact="add-sub"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          inlineSubTargetId = inlineSubTargetId === doc.id ? null : doc.id;
          expandedDashIds.add(doc.id);
          renderAll();
          listEl.querySelector('.sb-sub-title-inp')?.focus();
        });
        row.querySelector('[data-iact="del"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (deleteCardNode(doc)) hooks.showToast('카드가 삭제되었습니다.');
        });
        row.querySelector('[data-open-doc]')?.addEventListener('click', () => openCardProps(doc));
        row.querySelector('[data-locate-doc]')?.addEventListener('click', () => hooks.navigateToNode(doc));
        row.querySelectorAll('[data-par]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openQuickClassifyMenu(btn, doc, btn.dataset.par);
          });
        });
      });

      bindSubCardEvents(listEl);

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
      Store.syncOverdueTasksToWaiting();
      const { staleOrOverdue, inbox } = getReviewAlerts();
      const activeProjs = getActiveProjects();
      const projsWithoutNextAction = activeProjs.filter((p) => Store.getProjectNextActionEntries(p.id, hooks.isItemVisible).length === 0);
      const allDocs = getAllVisibleDocs();
      const waitingDocs = allDocs.filter((d) => !d.completed && d.gtdStatus === 'waiting');
      const somedayDocs = allDocs.filter((d) => !d.completed && d.gtdStatus === 'someday');
      const wrCfg = Store.state.weeklyReviewConfig || { reviewWeekday: 0, checklist: { inbox: false, waiting: false, someday: false }, lastReviewedDate: '' };
      const dayKo = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

      const pCount = activeProjs.length;
      const aCount = Store.getParaEntities('area', { onlyActive: true }).length;
      const rCount = Store.getParaEntities('resource', { onlyActive: true }).length;
      const archCount = Store.getParaEntities('archive').length;
      const classifiedPct = allDocs.length > 0
        ? Math.round(((allDocs.length - inbox.unassignedDocs.length) / allDocs.length) * 100)
        : 100;

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">주간 리뷰 (GTD + PARA)</h1>
            <p class="sb-page-sub">수신함 비우기 → 대기/누락 목록 확인 → 언젠가 목록 훑기 → 다음 행동 없는 프로젝트 점검까지 한 번에 완료하세요.</p>
          </div>
          <div class="sb-flex-gap-xs">
            <label class="sb-date-field">
              <span>매주 알림 요일</span>
              <select id="sb-wr-weekday" class="sb-field-select">
                ${dayKo.map((d, i) => `<option value="${i}"${Number(wrCfg.reviewWeekday) === i ? ' selected' : ''}>매주 ${d}</option>`).join('')}
              </select>
            </label>
            <button type="button" class="sb-btn-subtle" id="sb-wr-mark-done">✓ 이번 주 리뷰 완료</button>
            <button type="button" class="sb-btn-primary" id="sb-save-weekly-note">주간 리뷰 MD 저장</button>
          </div>
        </header>

        <!-- GTD 3단계 주간 리뷰 체크리스트 -->
        <section class="sb-card sb-wr-checklist-card">
          <div class="sb-card-head">
            <h2 class="sb-card-title">📋 GTD 주간 리뷰 체크리스트</h2>
            <span class="sb-page-sub" style="margin:0;">${wrCfg.lastReviewedDate ? `최근 완료일: ${esc(wrCfg.lastReviewedDate)}` : '아직 완료 기록 없음'}</span>
          </div>
          <div class="sb-wr-steps">
            <label class="sb-wr-step-row">
              <input type="checkbox" data-wr-chk="inbox"${wrCfg.checklist?.inbox ? ' checked' : ''}>
              <span><b>1. 수신함 비우기</b> (현재 미분류 ${inbox.totalCount}건)</span>
              <button type="button" class="sb-link-btn" id="sb-review-goto-inbox">수신함 열기 →</button>
            </label>
            <label class="sb-wr-step-row">
              <input type="checkbox" data-wr-chk="waiting"${wrCfg.checklist?.waiting ? ' checked' : ''}>
              <span><b>2. 프로젝트 대기 · 누락 목록 확인</b> (위임·기간누락 ${waitingDocs.length}건)</span>
              <button type="button" class="sb-link-btn" data-jump-na="1">다음 행동/대기 열기 →</button>
            </label>
            <label class="sb-wr-step-row">
              <input type="checkbox" data-wr-chk="someday"${wrCfg.checklist?.someday ? ' checked' : ''}>
              <span><b>3. 언젠가(Someday) 목록 훑기</b> (현재 ${somedayDocs.length}건)</span>
            </label>
          </div>
        </section>

        <!-- 단계별 PARA 요약 -->
        <section class="sb-kpi-grid">
          <div class="sb-kpi-card is-static">
            <div class="sb-kpi-icon">${svg('project', 16)}</div>
            <div class="sb-kpi-label">프로젝트 (다음행동 없음 ${projsWithoutNextAction.length})</div>
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

        <!-- 다음 행동 없는 프로젝트 점검 -->
        <section class="sb-card">
          <div class="sb-card-head">
            <div class="sb-card-title-wrap">
              <span class="sb-card-ico">${svg('alert', 16)}</span>
              <h2 class="sb-card-title">다음 행동이 없는 프로젝트 점검 (${projsWithoutNextAction.length})</h2>
            </div>
          </div>
          ${projsWithoutNextAction.length === 0
            ? `<div class="sb-empty-line"><span>모든 활성 프로젝트에 다음 행동이 정의되어 있어요 · 완벽해요!</span></div>`
            : `<div class="sb-req-list">
                ${projsWithoutNextAction.map((p) => `
                  <div class="sb-req-row is-overdue-row">
                    <span><span class="sb-code-pill-xs">${esc(Store.getParaCode(p))}</span> <strong>${esc(p.name)}</strong> <small style="color:var(--danger);">다음 행동 0건</small></span>
                    <button type="button" class="sb-mini-accent" data-wr-add-na="${esc(p.id)}">＋ 다음 행동 정의</button>
                  </div>
                `).join('')}
              </div>`}
        </section>

        <section class="sb-home-grid">
          <div class="sb-card">
            <div class="sb-card-head">
              <div class="sb-card-title-wrap">
                <span class="sb-card-ico">${svg('alert', 16)}</span>
                <h2 class="sb-card-title">오래되거나 마감 임박 프로젝트 (${staleOrOverdue.length})</h2>
              </div>
            </div>
            <div id="sb-review-projects"></div>
          </div>

          <div class="sb-card">
            <div class="sb-card-head">
              <div class="sb-card-title-wrap">
                <span class="sb-card-ico">${svg('clock', 16)}</span>
                <h2 class="sb-card-title">대기 · 누락 (${waitingDocs.length}) & 언젠가 (${somedayDocs.length})</h2>
              </div>
            </div>
            <div class="sb-inbox-full-list">
              ${waitingDocs.slice(0, 4).map((d) => `
                <div class="sb-inbox-full-row is-overdue-row">
                  <div class="sb-inbox-item-text">
                    <div class="sb-inbox-item-title">${d.missedToWaiting ? '🔴 기간누락' : '⏳ 위임대기'} · ${esc(d.name.replace(/\.md$/i, ''))}</div>
                  </div>
                  <button type="button" class="sb-btn-subtle" data-wr-clarify="${esc(d.id)}">명확화</button>
                </div>
              `).join('')}
              ${somedayDocs.slice(0, 4).map((d) => `
                <div class="sb-inbox-full-row">
                  <div class="sb-inbox-item-text">
                    <div class="sb-inbox-item-title">☁️ 언젠가 · ${esc(d.name.replace(/\.md$/i, ''))}</div>
                  </div>
                  <button type="button" class="sb-btn-subtle" data-wr-clarify="${esc(d.id)}">활성화</button>
                </div>
              `).join('')}
              ${waitingDocs.length === 0 && somedayDocs.length === 0 ? `<div class="sb-empty-line"><span>대기 목록과 언젠가 목록이 깔끔합니다.</span></div>` : ''}
            </div>
          </div>
        </section>
      `;

      $('sb-wr-weekday')?.addEventListener('change', (e) => {
        Store.updateWeeklyReviewConfig({ reviewWeekday: Number(e.target.value) });
        hooks.showToast(`🗓️ 매주 ${dayKo[Number(e.target.value)]}에 주간 리뷰 알림이 표시됩니다.`);
      });
      $('sb-wr-mark-done')?.addEventListener('click', () => {
        const today = hooks.getTodayYMD();
        Store.updateWeeklyReviewConfig({ lastReviewedDate: today, checklist: { inbox: true, waiting: true, someday: true } });
        Store.logChange({ category: 'general', message: `주간 리뷰 완료 (${today})` });
        hooks.showToast('✅ 이번 주 주간 리뷰를 완료 표시했습니다!');
        renderWeeklyReviewView(canvas);
      });
      canvas.querySelectorAll('[data-wr-chk]').forEach((chk) => {
        chk.addEventListener('change', () => {
          Store.updateWeeklyReviewConfig({ checklist: { [chk.dataset.wrChk]: Boolean(chk.checked) } });
        });
      });
      canvas.querySelector('[data-jump-na]')?.addEventListener('click', () => {
        activeView = 'next-actions';
        renderAll();
      });
      canvas.querySelectorAll('[data-wr-add-na]').forEach((b) => {
        b.addEventListener('click', () => openProjectDetail(b.dataset.wrAddNa, 'next-actions'));
      });
      canvas.querySelectorAll('[data-wr-clarify]').forEach((b) => {
        b.addEventListener('click', () => {
          const doc = Store.findNodeAndParent(b.dataset.wrClarify)?.node;
          if (doc) gtd?.openClarifyModal(doc);
        });
      });

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

      $('sb-save-weekly-note')?.addEventListener('click', () => {
        const today = hooks.getTodayYMD();
        const summaryBody =
          `## ${today} GTD + PARA 주간 리뷰\n\n` +
          `### 단계별 요약\n` +
          `- **프로젝트**: ${pCount}건 (다음 행동 없음 ${projsWithoutNextAction.length}건 · 점검 필요 ${staleOrOverdue.length}건)\n` +
          `- **영역**: ${aCount}건 · **자료**: ${rCount}건 · **보관**: ${archCount}건\n` +
          `- **수신함 미분류**: ${inbox.totalCount}건 (전체 분류율 ${classifiedPct}%)\n` +
          `- **대기/누락**: ${waitingDocs.length}건 · **언젠가**: ${somedayDocs.length}건\n\n` +
          `### 다음 행동 없는 프로젝트\n` +
          (projsWithoutNextAction.length ? projsWithoutNextAction.map((p) => `- ${Store.getParaCode(p)} ${p.name}`).join('\n') : '- 없음') +
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
      else if (activeView === 'calendar') {
        const cal = getGoogleCalendar();
        if (cal) cal.renderCalendarView(canvas);
      }
      else if (activeView === 'next-actions' && gtd) gtd.renderNextActionsView(canvas, { onOpenProjectDetail: openProjectDetail });
      else if (activeView === 'master-gantt' && gtd) gtd.renderMasterGanttView(canvas, { onOpenProjectDetail: openProjectDetail });
      else if (activeView === 'history' && gtd) gtd.renderChangeHistoryView(canvas);
      else if (activeView === 'review') renderWeeklyReviewView(canvas);
      else if (activeView === 'project-detail' && projectWorkspace && activeProjectId) {
        projectWorkspace.renderProjectDetailView(canvas, activeProjectId, {
          onBack: () => {
            activeView = 'project';
            activeProjectId = null;
            renderAll();
          },
          onOpenProjectModal: (ent) => openProjectModal(ent, 'project')
        });
      } else {
        renderParaStageView(canvas, activeView === 'project-detail' ? 'project' : activeView);
      }
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
      openProjectDetail,
      openTaskCompletionModal(doc, projectId) {
        projectWorkspace?.openTaskCompletionModal(doc, projectId);
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
