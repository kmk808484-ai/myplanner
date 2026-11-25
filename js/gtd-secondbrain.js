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

  function parseYmdMs(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatShortDate(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${Number(m[2])}/${Number(m[3])}`;
  }

  function formatDayMsYmd(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function createGtdSecondBrain(hooks) {
    const Store = global.BrainStore;
    const $ = (id) => document.getElementById(id);

    // Next Actions filter state
    let naFilterContext = 'all';
    let naFilterTime = 'all';
    let naFilterEnergy = 'all';
    let naFilterProject = 'all';
    let naOnlyRunning = false;
    let naViewTab = 'actions'; // 'actions' | 'waiting' | 'someday'

    // Master Gantt filter state
    let mgFilter = 'all'; // 'all' | 'has-next' | 'overdue' | 'active'
    let mgGoalFilter = 'all';
    let mgDragProjId = null;

    // History filter state
    let histCatFilter = 'all';
    let histSearch = '';

    // Clarify Modal state
    let clarifyDoc = null;
    let clarifyTimerId = null;
    let clarifySecondsLeft = 120;
    let clarifyActionRows = [];

    // Extract Modal state
    let extractDoc = null;
    let extractStageCur = 1;

    // ==================== 1. GTD CLARIFY WIZARD ====================
    function stopClarifyTimer() {
      if (clarifyTimerId) {
        clearInterval(clarifyTimerId);
        clarifyTimerId = null;
      }
    }

    function renderClarifyActionRows() {
      const wrap = $('gcm-actions-list');
      const projBox = $('gcm-multi-project-box');
      if (!wrap) return;
      const opts = Store.state.gtdTagOptions || {};
      const ctxOpts = opts.contexts || ['@PC', '@폰', '@외출', '@집'];
      const timeOpts = opts.times || ['@15분', '@30분', '@1시간', '@2시간'];
      const enOpts = opts.energies || ['@높음', '@중간', '@낮음'];

      wrap.innerHTML = clarifyActionRows.map((row, idx) => `
        <div class="sb-gcm-action-row" data-ridx="${idx}">
          <input type="text" class="sb-field-input sb-gcm-act-text" value="${esc(row.text)}" placeholder="구체적 다음 행동 ${idx + 1} (예: 치과 예약 전화하기)">
          <select class="sb-field-select sb-gcm-act-ctx">${ctxOpts.map((c) => `<option value="${esc(c)}"${row.context === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select class="sb-field-select sb-gcm-act-time">${timeOpts.map((t) => `<option value="${esc(t)}"${row.time === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select class="sb-field-select sb-gcm-act-en">${enOpts.map((e) => `<option value="${esc(e)}"${row.energy === e ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>
          ${clarifyActionRows.length > 1 ? `<button type="button" class="sb-icon-btn-xs" data-rm-row="${idx}">✕</button>` : ''}
        </div>
      `).join('');

      wrap.querySelectorAll('.sb-gcm-action-row').forEach((el) => {
        const idx = Number(el.dataset.ridx);
        el.querySelector('.sb-gcm-act-text')?.addEventListener('input', (e) => { clarifyActionRows[idx].text = e.target.value; });
        el.querySelector('.sb-gcm-act-ctx')?.addEventListener('change', (e) => { clarifyActionRows[idx].context = e.target.value; });
        el.querySelector('.sb-gcm-act-time')?.addEventListener('change', (e) => { clarifyActionRows[idx].time = e.target.value; });
        el.querySelector('.sb-gcm-act-en')?.addEventListener('change', (e) => { clarifyActionRows[idx].energy = e.target.value; });
        el.querySelector('[data-rm-row]')?.addEventListener('click', () => {
          clarifyActionRows.splice(idx, 1);
          renderClarifyActionRows();
        });
      });

      const isMulti = clarifyActionRows.length >= 2;
      if (projBox) {
        projBox.classList.toggle('is-multi-active', isMulti);
        const hint = $('gcm-multi-project-hint');
        if (hint) {
          hint.textContent = isMulti
            ? '🚀 다음 행동이 2개 이상입니다! 새 프로젝트(P)를 자동 생성하고 이 할일과 다음 행동들을 프로젝트 안에 등록합니다.'
            : '기존 프로젝트에 연결하거나, 단독 다음 행동으로 둘 수 있습니다.';
        }
        const newProjInp = $('gcm-new-proj-name');
        if (isMulti && newProjInp && !newProjInp.value.trim() && clarifyDoc) {
          newProjInp.value = String(clarifyDoc.name || '').replace(/\.md$/i, '');
        }
      }
    }

    function bindClarifyModalOnce() {
      const modal = $('gtd-clarify-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';

      const close = () => {
        stopClarifyTimer();
        modal.style.display = 'none';
        clarifyDoc = null;
      };
      $('gcm-close-btn')?.addEventListener('click', close);
      $('gcm-cancel-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      // Step 1: 행동 필요 없음 vs 행동 필요
      $('gcm-btn-no-action')?.addEventListener('click', () => {
        $('gcm-btn-no-action')?.classList.add('active');
        $('gcm-btn-yes-action')?.classList.remove('active');
        $('gcm-branch-no')?.classList.remove('is-hidden');
        $('gcm-branch-yes')?.classList.add('is-hidden');
      });
      $('gcm-btn-yes-action')?.addEventListener('click', () => {
        $('gcm-btn-yes-action')?.classList.add('active');
        $('gcm-btn-no-action')?.classList.remove('active');
        $('gcm-branch-yes')?.classList.remove('is-hidden');
        $('gcm-branch-no')?.classList.add('is-hidden');
      });

      // Branch NO: 버림 / 참고(R) / 언젠가
      $('gcm-act-trash')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        const name = clarifyDoc.name.replace(/\.md$/i, '');
        const found = Store.findNodeAndParent(clarifyDoc.id);
        if (found?.parent?.children) {
          Store.saveStateForUndo();
          found.parent.children = found.parent.children.filter((c) => c.id !== clarifyDoc.id);
          Store.state.relations = (Store.state.relations || []).filter((r) => r.sourceId !== clarifyDoc.id && r.targetId !== clarifyDoc.id);
          Store.persistRelations();
          Store.logChange({ category: 'task', message: `GTD 명확화 [버림]: "${name}" 삭제` });
        }
        close();
        hooks.saveAndRender();
        hooks.showToast(`🗑️ "${name}" 버림 처리(삭제)되었습니다.`);
      });

      $('gcm-act-ref')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        const selId = $('gcm-ref-resource-sel')?.value || '';
        const newResName = String($('gcm-ref-new-name')?.value || '').trim();
        let targetEnt = selId ? Store.findParaEntity(selId) : null;
        if (!targetEnt && newResName) {
          targetEnt = Store.declareParaEntity({ paraType: 'resource', name: newResName });
        }
        if (!targetEnt) {
          targetEnt = Store.declareParaEntity({ paraType: 'resource', name: '일반 참고 자료' });
        }
        Store.setCardRole(clarifyDoc, 'S');
        clarifyDoc.extractStage = clarifyDoc.extractStage || 1;
        clarifyDoc.gtdStatus = 'active';
        Store.addRelation({ sourceId: clarifyDoc.id, targetId: targetEnt.id, type: 'resource', label: '참고 자료' });
        Store.logChange({ category: 'task', message: `GTD 명확화 [참고 자료]: "${clarifyDoc.name}" → ${targetEnt.name}` });
        close();
        hooks.saveAndRender();
        hooks.showToast(`📚 참고 자료("${targetEnt.name}")로 분류되었습니다.`);
      });

      $('gcm-act-someday')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        clarifyDoc.gtdStatus = 'someday';
        clarifyDoc.isTodayCore = false;
        Store.touchNode(clarifyDoc);
        Store.logChange({ category: 'task', message: `GTD 명확화 [언젠가]: "${clarifyDoc.name}" 언젠가 목록 이동` });
        close();
        hooks.saveAndRender();
        hooks.showToast(`☁️ "${clarifyDoc.name.replace(/\.md$/i, '')}" 언젠가(Someday) 목록으로 보냈습니다.`);
      });

      // Branch YES: 2분 규칙 / 위임 / 다음 행동 정의
      $('gcm-2min-start')?.addEventListener('click', () => {
        stopClarifyTimer();
        clarifySecondsLeft = 120;
        const disp = $('gcm-2min-clock');
        const tick = () => {
          const m = Math.floor(clarifySecondsLeft / 60);
          const s = clarifySecondsLeft % 60;
          if (disp) disp.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          if (clarifySecondsLeft <= 0) {
            stopClarifyTimer();
            hooks.showToast('⏰ 2분이 지났습니다! 완료하거나 다음 행동으로 등록하세요.');
          } else {
            clarifySecondsLeft--;
          }
        };
        tick();
        clarifyTimerId = setInterval(tick, 1000);
      });

      $('gcm-2min-done')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        Store.setCardRole(clarifyDoc, 'T');
        clarifyDoc.completed = true;
        clarifyDoc.completedAt = Date.now();
        clarifyDoc.completionMode = '2min';
        clarifyDoc.gtdStatus = 'done';
        Store.touchNode(clarifyDoc);
        Store.logChange({ category: 'task', message: `GTD 2분 규칙 즉시 완료: "${clarifyDoc.name}"` });
        close();
        hooks.saveAndRender();
        hooks.showToast('⚡ 2분 규칙으로 즉시 완료했습니다!');
      });

      $('gcm-act-delegate')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        const who = String($('gcm-delegate-who')?.value || '').trim() || '담당자';
        Store.setCardRole(clarifyDoc, 'T');
        clarifyDoc.gtdStatus = 'waiting';
        clarifyDoc.delegatedTo = who;
        Store.touchNode(clarifyDoc);
        Store.logChange({ category: 'task', message: `GTD 위임(대기): "${clarifyDoc.name}" → ${who}` });
        close();
        hooks.saveAndRender();
        hooks.showToast(`🤝 "${who}"님께 위임하고 대기 목록으로 이동했습니다.`);
      });

      $('gcm-add-action-row')?.addEventListener('click', () => {
        clarifyActionRows.push({ text: '', context: '@PC', time: '@30분', energy: '@중간' });
        renderClarifyActionRows();
      });

      $('gcm-commit-next-actions')?.addEventListener('click', () => {
        if (!clarifyDoc) return;
        const validRows = clarifyActionRows.filter((r) => String(r.text || '').trim());
        if (validRows.length === 0) {
          hooks.showToast('구체적인 다음 행동을 1개 이상 입력해 주세요. (예: 치과 예약 전화하기)');
          return;
        }

        const existingProjId = $('gcm-existing-proj-sel')?.value || '';
        const newProjName = String($('gcm-new-proj-name')?.value || '').trim();
        let targetProj = existingProjId ? Store.findParaEntity(existingProjId) : null;

        // 2개 이상의 다음 행동이면 프로젝트 자동 생성!
        if (validRows.length >= 2 && !targetProj) {
          const pName = newProjName || String(clarifyDoc.name || '새 프로젝트').replace(/\.md$/i, '');
          targetProj = Store.declareParaEntity({ paraType: 'project', name: pName, status: 'active' });
        } else if (newProjName && !targetProj) {
          targetProj = Store.declareParaEntity({ paraType: 'project', name: newProjName, status: 'active' });
        }

        Store.setCardRole(clarifyDoc, 'T');
        const todayYmd = Store.getLocalYmd();
        if (!clarifyDoc.startDate) clarifyDoc.startDate = todayYmd;
        if (!clarifyDoc.endDate) clarifyDoc.endDate = formatDayMsYmd(parseYmdMs(todayYmd) + 7 * 86400000);
        clarifyDoc.gtdStatus = 'next';
        clarifyDoc.gtdContext = validRows[0].context;
        clarifyDoc.gtdTime = validRows[0].time;
        clarifyDoc.gtdEnergy = validRows[0].energy;

        if (targetProj) {
          Store.addRelation({ sourceId: clarifyDoc.id, targetId: targetProj.id, type: 'project', label: 'GTD 명확화' });
        }
        validRows.forEach((r) => {
          Store.addNextActionToDoc(clarifyDoc, r);
        });
        Store.touchNode(clarifyDoc);
        close();
        hooks.saveAndRender();
        hooks.showToast(
          targetProj
            ? `🎯 프로젝트 "${targetProj.name}"에 할일 및 다음 행동 ${validRows.length}건이 등록되었습니다!`
            : `🎯 다음 행동 "${validRows[0].text}" 등록 완료!`
        );
      });
    }

    function openClarifyModal(doc) {
      if (!doc) return;
      bindClarifyModalOnce();
      const modal = $('gtd-clarify-modal');
      if (!modal) return;
      clarifyDoc = doc;
      stopClarifyTimer();
      clarifySecondsLeft = 120;
      const cleanName = String(doc.name || '').replace(/\.md$/i, '');
      clarifyActionRows = [{ text: cleanName, context: doc.gtdContext || '@PC', time: doc.gtdTime || '@30분', energy: doc.gtdEnergy || '@중간' }];

      if ($('gcm-doc-title')) $('gcm-doc-title').textContent = cleanName;
      if ($('gcm-2min-clock')) $('gcm-2min-clock').textContent = '02:00';
      if ($('gcm-delegate-who')) $('gcm-delegate-who').value = doc.delegatedTo || '';
      if ($('gcm-ref-new-name')) $('gcm-ref-new-name').value = '';
      if ($('gcm-new-proj-name')) $('gcm-new-proj-name').value = '';

      const resSel = $('gcm-ref-resource-sel');
      if (resSel) {
        const resources = Store.getParaEntities('resource', { onlyActive: true });
        resSel.innerHTML = `<option value="">-- 기존 자료(R) 선택 --</option>` +
          resources.map((r) => `<option value="${esc(r.id)}">${esc(Store.getParaCode(r))} ${esc(r.name)}</option>`).join('');
      }
      const projSel = $('gcm-existing-proj-sel');
      if (projSel) {
        const projects = Store.getParaEntities('project', { onlyActive: true });
        projSel.innerHTML = `<option value="">(선택 안 함 / 2개 이상 시 새 프로젝트 자동 생성)</option>` +
          projects.map((p) => `<option value="${esc(p.id)}">${esc(Store.getParaCode(p))} ${esc(p.name)}</option>`).join('');
      }

      $('gcm-btn-yes-action')?.classList.add('active');
      $('gcm-btn-no-action')?.classList.remove('active');
      $('gcm-branch-yes')?.classList.remove('is-hidden');
      $('gcm-branch-no')?.classList.add('is-hidden');

      renderClarifyActionRows();
      modal.style.display = 'flex';
    }

    // ==================== 2. ALL NEXT ACTIONS VIEW (GTD + CONTEXT/TIME/ENERGY) ====================
    function renderNextActionsView(canvas, { onOpenProjectDetail }) {
      Store.syncOverdueTasksToWaiting();
      const opts = Store.state.gtdTagOptions || { contexts: [], times: [], energies: [] };
      const allProjects = Store.getParaEntities('project', { onlyActive: true });
      const allEntries = Store.getProjectNextActionEntries(null, hooks.isItemVisible);

      const filteredEntries = allEntries.filter((e) => {
        if (naFilterContext !== 'all' && e.context !== naFilterContext) return false;
        if (naFilterTime !== 'all' && e.time !== naFilterTime) return false;
        if (naFilterEnergy !== 'all' && e.energy !== naFilterEnergy) return false;
        if (naFilterProject !== 'all') {
          if (naFilterProject === 'none' && e.project) return false;
          if (naFilterProject !== 'none' && e.project?.id !== naFilterProject) return false;
        }
        if (naOnlyRunning && !e.isRunningTask) return false;
        return true;
      });

      const allDocs = Store.collectAllNodes(Store.state.fileSystem).filter((n) => n && n.type === 'doc' && hooks.isItemVisible(n));
      const waitingDocs = allDocs.filter((d) => !d.completed && d.gtdStatus === 'waiting');
      const somedayDocs = allDocs.filter((d) => !d.completed && d.gtdStatus === 'someday');

      // Group entries by project
      const grouped = new Map();
      filteredEntries.forEach((e) => {
        const key = e.project ? e.project.id : '__standalone__';
        if (!grouped.has(key)) grouped.set(key, { project: e.project, items: [] });
        grouped.get(key).items.push(e);
      });

      const renderTagGroup = (label, groupKey, list, activeVal, dataAttr) => `
        <div class="sb-gtd-filter-row">
          <span class="sb-gtd-flbl">${label}</span>
          <div class="sb-filter-group">
            <button type="button" class="sb-filter-chip${activeVal === 'all' ? ' active' : ''}" ${dataAttr}="all">전체</button>
            ${list.map((tag) => `<button type="button" class="sb-filter-chip${activeVal === tag ? ' active' : ''}" ${dataAttr}="${esc(tag)}">${esc(tag)}</button>`).join('')}
            <button type="button" class="sb-filter-chip sb-add-tag-chip" data-add-gtd-tag="${groupKey}">＋ 태그 추가</button>
          </div>
        </div>
      `;

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">다음 행동 (GTD)</h1>
            <p class="sb-page-sub">현재 상황 · 허용 시간 · 인지적 부하(에너지)에 맞춰 지금 바로 실행할 다음 행동을 고르세요.</p>
          </div>
          <div class="sb-flex-gap-xs">
            <select id="sb-na-proj-filter" class="sb-field-select">
              <option value="all">모든 프로젝트</option>
              <option value="none"${naFilterProject === 'none' ? ' selected' : ''}>단독 행동 (프로젝트 없음)</option>
              ${allProjects.map((p) => `<option value="${esc(p.id)}"${naFilterProject === p.id ? ' selected' : ''}>${esc(Store.getParaCode(p))} ${esc(p.name)}</option>`).join('')}
            </select>
            <label class="sb-check-inline">
              <input type="checkbox" id="sb-na-only-running"${naOnlyRunning ? ' checked' : ''}>
              <span>현재 수행 중인 할일만</span>
            </label>
          </div>
        </header>

        <section class="sb-card">
          <div class="sb-subtabs">
            <button type="button" class="sb-subtab${naViewTab === 'actions' ? ' active' : ''}" data-natab="actions">다음 행동 <span>${filteredEntries.length}</span></button>
            <button type="button" class="sb-subtab${naViewTab === 'waiting' ? ' active' : ''}" data-natab="waiting">위임 · 누락 대기 <span>${waitingDocs.length}</span></button>
            <button type="button" class="sb-subtab${naViewTab === 'someday' ? ' active' : ''}" data-natab="someday">언젠가 (Someday) <span>${somedayDocs.length}</span></button>
          </div>

          ${naViewTab === 'actions' ? `
            <div class="sb-gtd-filter-box">
              ${renderTagGroup('상황 (Context)', 'contexts', opts.contexts || [], naFilterContext, 'data-fctx')}
              ${renderTagGroup('허용 시간 (Time)', 'times', opts.times || [], naFilterTime, 'data-ftime')}
              ${renderTagGroup('인지적 부하 (Energy)', 'energies', opts.energies || [], naFilterEnergy, 'data-fenergy')}
            </div>

            <div class="sb-na-groups" id="sb-na-groups">
              ${grouped.size === 0 ? `<div class="sb-empty-line"><span>조건에 맞는 다음 행동이 없어요. 수신함 카드의 [명확화] 또는 프로젝트 상세에서 다음 행동을 추가해 보세요.</span></div>` : Array.from(grouped.values()).map(({ project, items }) => {
                const missedCnt = project ? Store.getProjectOverdueMissedTasks(project.id, hooks.isItemVisible).length : 0;
                return `
                  <div class="sb-na-group-card${missedCnt > 0 ? ' is-overdue-proj' : ''}">
                    <div class="sb-na-group-head">
                      ${project
                        ? `<button type="button" class="sb-proj-name-btn" data-open-proj="${esc(project.id)}"><span class="sb-code-pill-xs">${esc(Store.getParaCode(project))}</span><strong>${esc(project.name)}</strong></button>`
                        : `<strong>단독 다음 행동 (프로젝트 미지정)</strong>`}
                      ${missedCnt > 0 ? `<span class="sb-overdue-badge">⚠️ 수행일 누락 ${missedCnt}건 (대기 이동됨)</span>` : ''}
                    </div>
                    <div class="sb-na-item-list">
                      ${items.map((it) => `
                        <div class="sb-na-row" data-doc-id="${esc(it.doc.id)}" data-na-id="${esc(it.id)}" data-kind="${it.kind}">
                          <button type="button" class="sb-checkbox-box" data-naact="done" title="다음 행동 완료">${svg('check', 11)}</button>
                          <div class="sb-na-row-main">
                            <div class="sb-na-text">${esc(it.text)} ${it.isRunningTask ? `<span class="sb-running-pill">현재 수행중</span>` : ''}</div>
                            <div class="sb-na-meta">원본 할일: <button type="button" class="sb-empty-cta" data-naact="open-doc">${esc(it.doc.name.replace(/\.md$/i, ''))}</button></div>
                          </div>
                          <div class="sb-na-tags">
                            <span class="sb-gtd-tag is-ctx">${esc(it.context)}</span>
                            <span class="sb-gtd-tag is-time">${esc(it.time)}</span>
                            <span class="sb-gtd-tag is-en">${esc(it.energy)}</span>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}

          ${naViewTab === 'waiting' ? `
            <div class="sb-inbox-full-list">
              ${waitingDocs.length === 0 ? `<div class="sb-empty-line"><span>위임 대기 중이거나 기간이 누락된 할일이 없습니다.</span></div>` : waitingDocs.map((d) => `
                <div class="sb-inbox-full-row${d.missedToWaiting ? ' is-overdue-row' : ''}" data-wdoc="${esc(d.id)}">
                  <div class="sb-inbox-item-text" data-wact="open">
                    <div class="sb-inbox-item-title">
                      ${d.missedToWaiting ? `<span class="sb-overdue-badge">기간 누락</span>` : `<span class="sb-status-pill is-hold">위임 대기</span>`}
                      ${esc(d.name.replace(/\.md$/i, ''))}
                    </div>
                    <div class="sb-inbox-item-snippet">
                      ${d.delegatedTo ? `위임 대상: ${esc(d.delegatedTo)}` : ''}
                      ${d.endDate ? ` · 마감 ${esc(d.endDate)}` : ''}
                    </div>
                  </div>
                  <div class="sb-flex-gap-xs">
                    <button type="button" class="sb-btn-subtle" data-wact="resume">다음 행동으로 복귀</button>
                    <button type="button" class="sb-btn-primary-sm" data-wact="done">완료</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${naViewTab === 'someday' ? `
            <div class="sb-inbox-full-list">
              ${somedayDocs.length === 0 ? `<div class="sb-empty-line"><span>언젠가(Someday) 목록이 비어 있습니다.</span></div>` : somedayDocs.map((d) => `
                <div class="sb-inbox-full-row" data-sdoc="${esc(d.id)}">
                  <div class="sb-inbox-item-text" data-sdact="open">
                    <div class="sb-inbox-item-title">☁️ ${esc(d.name.replace(/\.md$/i, ''))}</div>
                    <div class="sb-inbox-item-snippet">${esc(String(d.summary || '').slice(0, 90))}</div>
                  </div>
                  <div class="sb-flex-gap-xs">
                    <button type="button" class="sb-btn-subtle" data-sdact="clarify">명확화(활성화)</button>
                    <button type="button" class="sb-mini-icon-act is-del" data-sdact="del">${svg('trash', 12)}</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </section>
      `;

      // Bind subtabs & filters
      canvas.querySelectorAll('[data-natab]').forEach((b) => b.addEventListener('click', () => {
        naViewTab = b.dataset.natab;
        renderNextActionsView(canvas, { onOpenProjectDetail });
      }));
      $('sb-na-proj-filter')?.addEventListener('change', (e) => {
        naFilterProject = e.target.value;
        renderNextActionsView(canvas, { onOpenProjectDetail });
      });
      $('sb-na-only-running')?.addEventListener('change', (e) => {
        naOnlyRunning = e.target.checked;
        renderNextActionsView(canvas, { onOpenProjectDetail });
      });
      canvas.querySelectorAll('[data-fctx]').forEach((b) => b.addEventListener('click', () => { naFilterContext = b.dataset.fctx; renderNextActionsView(canvas, { onOpenProjectDetail }); }));
      canvas.querySelectorAll('[data-ftime]').forEach((b) => b.addEventListener('click', () => { naFilterTime = b.dataset.ftime; renderNextActionsView(canvas, { onOpenProjectDetail }); }));
      canvas.querySelectorAll('[data-fenergy]').forEach((b) => b.addEventListener('click', () => { naFilterEnergy = b.dataset.fenergy; renderNextActionsView(canvas, { onOpenProjectDetail }); }));
      canvas.querySelectorAll('[data-add-gtd-tag]').forEach((b) => {
        b.addEventListener('click', () => {
          const grp = b.dataset.addGtdTag;
          const labelMap = { contexts: '상황 (예: @카페)', times: '허용 시간 (예: @45분)', energies: '에너지 (예: @최상)' };
          const val = prompt(`새 ${labelMap[grp]} 태그를 입력하세요:`);
          if (!val || !val.trim()) return;
          Store.addCustomGtdTag(grp, val);
          hooks.showToast(`태그 추가됨: ${val.startsWith('@') ? val : '@' + val}`);
          renderNextActionsView(canvas, { onOpenProjectDetail });
        });
      });

      canvas.querySelectorAll('[data-open-proj]').forEach((b) => b.addEventListener('click', () => onOpenProjectDetail?.(b.dataset.openProj)));

      canvas.querySelectorAll('.sb-na-row').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.docId)?.node;
        if (!doc) return;
        row.querySelector('[data-naact="open-doc"]')?.addEventListener('click', () => openCardPropertiesModal(doc, () => renderNextActionsView(canvas, opts)));
        row.querySelector('[data-naact="done"]')?.addEventListener('click', () => {
          if (row.dataset.kind === 'sub-action') {
            Store.toggleNextActionOnDoc(doc, row.dataset.naId);
            hooks.saveAndRender();
            hooks.showToast('✅ 다음 행동을 완료했습니다.');
          } else {
            doc.completed = true;
            doc.completedAt = Date.now();
            doc.gtdStatus = 'done';
            Store.touchNode(doc);
            hooks.saveAndRender();
            hooks.showToast('✅ 할일 완료됨');
          }
          renderNextActionsView(canvas, { onOpenProjectDetail });
        });
      });

      canvas.querySelectorAll('[data-wdoc]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.wdoc)?.node;
        if (!doc) return;
        row.querySelector('[data-wact="open"]')?.addEventListener('click', () => openCardPropertiesModal(doc, () => renderNextActionsView(canvas, opts)));
        row.querySelector('[data-wact="resume"]')?.addEventListener('click', () => {
          doc.gtdStatus = 'next';
          doc.missedToWaiting = false;
          doc.endDate = formatDayMsYmd(parseYmdMs(Store.getLocalYmd()) + 3 * 86400000);
          Store.touchNode(doc);
          hooks.saveAndRender();
          hooks.showToast('🔄 다음 행동으로 복귀하고 마감일을 +3일 재조정했습니다.');
          renderNextActionsView(canvas, { onOpenProjectDetail });
        });
        row.querySelector('[data-wact="done"]')?.addEventListener('click', () => {
          doc.completed = true;
          doc.completedAt = Date.now();
          doc.gtdStatus = 'done';
          doc.missedToWaiting = false;
          Store.touchNode(doc);
          hooks.saveAndRender();
          renderNextActionsView(canvas, { onOpenProjectDetail });
        });
      });

      canvas.querySelectorAll('[data-sdoc]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.sdoc)?.node;
        if (!doc) return;
        row.querySelector('[data-sdact="open"]')?.addEventListener('click', () => openCardPropertiesModal(doc, () => renderNextActionsView(canvas, opts)));
        row.querySelector('[data-sdact="clarify"]')?.addEventListener('click', () => openClarifyModal(doc));
        row.querySelector('[data-sdact="del"]')?.addEventListener('click', () => {
          const found = Store.findNodeAndParent(doc.id);
          if (found?.parent?.children) {
            found.parent.children = found.parent.children.filter((c) => c.id !== doc.id);
            hooks.saveAndRender();
            renderNextActionsView(canvas, { onOpenProjectDetail });
          }
        });
      });
    }

    // ==================== 3. PROGRESSIVE SUMMARIZATION 4-STAGE READER (추출) ====================
    function wrapSelectionInReader(tagName, className) {
      const reader = $('exm-reader-body');
      const sel = window.getSelection();
      if (!reader || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
      const range = sel.getRangeAt(0);
      if (!reader.contains(range.commonAncestorContainer)) return false;
      const text = range.toString();
      if (!text.trim()) return false;
      const wrapper = document.createElement(tagName);
      wrapper.className = className;
      try {
        range.surroundContents(wrapper);
      } catch (_) {
        const frag = range.extractContents();
        wrapper.appendChild(frag);
        range.insertNode(wrapper);
      }
      sel.removeAllRanges();
      return true;
    }

    function saveExtractStateFromDom() {
      if (!extractDoc) return;
      const reader = $('exm-reader-body');
      if (reader) extractDoc.extractHtml = reader.innerHTML;
      extractDoc.extractStage = extractStageCur;
      const s1 = String($('exm-sum-1')?.value || '').trim();
      const s2 = String($('exm-sum-2')?.value || '').trim();
      const s3 = String($('exm-sum-3')?.value || '').trim();
      extractDoc.extractSummaryLines = [s1, s2, s3];
      if (extractStageCur >= 4 && (s1 || s2 || s3)) {
        const cleanBody = String(extractDoc.summary || '').replace(/^> \[3줄 요약\][\s\S]*?\n---\n\n/, '');
        const summaryBlock =
          `> [3줄 요약]\n` +
          (s1 ? `> 1. ${s1}\n` : '') +
          (s2 ? `> 2. ${s2}\n` : '') +
          (s3 ? `> 3. ${s3}\n` : '') +
          `---\n\n`;
        extractDoc.summary = summaryBlock + cleanBody;
      }
      Store.touchNode(extractDoc);
      Store.persistFS();
    }

    function updateExtractStageUI() {
      const stageLabels = {
        1: '1단계 · 원본 읽기 — [2단계 시작]을 눌러 중요한 문장을 드래그해 굵게 표시하세요.',
        2: '2단계 · 굵게 전처리 — 본문에서 중요한 문장을 마우스로 드래그하면 자동으로 굵게 표시됩니다.',
        3: '3단계 · 형광펜 전처리 — 굵은 문장 중 핵심 구절을 드래그하면 형광펜으로 강조됩니다. (부족하면 2단계 복귀 가능)',
        4: '4단계 · 내 말로 3줄 요약 — 맨 위 3줄 요약 칸에 핵심 내용을 내 언어로 정리하고 완료하세요.'
      };
      document.querySelectorAll('#exm-stepper .sb-ex-step').forEach((el) => {
        const st = Number(el.dataset.exstep);
        el.classList.toggle('active', st === extractStageCur);
        el.classList.toggle('done', st < extractStageCur);
      });
      if ($('exm-stage-guide')) $('exm-stage-guide').textContent = stageLabels[extractStageCur] || '';
      $('exm-summary-box')?.classList.toggle('is-hidden', extractStageCur < 4);
      $('exm-back-stage2')?.classList.toggle('is-hidden', extractStageCur !== 3);
      $('exm-btn-apply-bold')?.classList.toggle('is-hidden', extractStageCur !== 2);
      $('exm-btn-apply-hl')?.classList.toggle('is-hidden', extractStageCur !== 3);
      const nextBtn = $('exm-next-stage-btn');
      if (nextBtn) {
        if (extractStageCur === 1) nextBtn.textContent = '2단계(굵게) 시작 →';
        else if (extractStageCur === 2) nextBtn.textContent = '2단계 완료 → 3단계(형광펜)';
        else if (extractStageCur === 3) nextBtn.textContent = '3단계 완료 → 4단계(3줄 요약)';
        else nextBtn.textContent = '✓ 4단계(추출 완료) 저장';
      }
    }

    function bindExtractModalOnce() {
      const modal = $('extract-reader-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';

      const close = () => {
        saveExtractStateFromDom();
        modal.style.display = 'none';
        extractDoc = null;
        hooks.saveAndRender();
      };
      $('exm-close-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      // Auto-format on mouse drag selection in Stage 2 (Bold) & Stage 3 (Highlight)!
      $('exm-reader-body')?.addEventListener('mouseup', () => {
        if (extractStageCur === 2) {
          if (wrapSelectionInReader('strong', 'sb-ex-bold')) saveExtractStateFromDom();
        } else if (extractStageCur === 3) {
          if (wrapSelectionInReader('mark', 'sb-ex-hl')) saveExtractStateFromDom();
        }
      });

      $('exm-btn-apply-bold')?.addEventListener('click', () => {
        if (wrapSelectionInReader('strong', 'sb-ex-bold')) saveExtractStateFromDom();
        else hooks.showToast('본문에서 굵게 만들 문장을 먼저 드래그 선택해 주세요.');
      });
      $('exm-btn-apply-hl')?.addEventListener('click', () => {
        if (wrapSelectionInReader('mark', 'sb-ex-hl')) saveExtractStateFromDom();
        else hooks.showToast('본문에서 형광펜으로 강조할 구절을 먼저 드래그 선택해 주세요.');
      });

      $('exm-back-stage2')?.addEventListener('click', () => {
        extractStageCur = 2;
        saveExtractStateFromDom();
        updateExtractStageUI();
        hooks.showToast('↩️ 2단계(굵게)로 돌아왔습니다. 부족한 문장을 추가로 굵게 표시하세요.');
      });

      $('exm-next-stage-btn')?.addEventListener('click', () => {
        if (extractStageCur < 4) {
          extractStageCur++;
          saveExtractStateFromDom();
          updateExtractStageUI();
          Store.logChange({ category: 'task', message: `자료 추출 ${extractStageCur}단계 진행: "${extractDoc?.name || ''}"` });
        } else {
          saveExtractStateFromDom();
          Store.logChange({ category: 'task', message: `자료 추출 4단계(3줄 요약) 완료: "${extractDoc?.name || ''}"` });
          modal.style.display = 'none';
          extractDoc = null;
          hooks.saveAndRender();
          hooks.showToast('✨ 4단계 점진적 요약(추출)이 완료되었습니다!');
        }
      });
    }

    function openExtractModal(doc) {
      if (!doc) return;
      bindExtractModalOnce();
      const modal = $('extract-reader-modal');
      if (!modal) return;
      extractDoc = doc;
      extractStageCur = Math.max(1, Math.min(4, Number(doc.extractStage || 2)));
      if ($('exm-doc-title')) $('exm-doc-title').textContent = String(doc.name || '').replace(/\.md$/i, '');

      const reader = $('exm-reader-body');
      if (reader) {
        if (doc.extractHtml) {
          reader.innerHTML = doc.extractHtml;
        } else {
          const raw = String(doc.summary || '내용이 없습니다. 마크다운 편집기에서 본문을 먼저 작성해 주세요.');
          reader.innerHTML = raw
            .split(/\n{2,}/)
            .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
            .join('');
        }
      }
      const lines = Array.isArray(doc.extractSummaryLines) ? doc.extractSummaryLines : ['', '', ''];
      if ($('exm-sum-1')) $('exm-sum-1').value = lines[0] || '';
      if ($('exm-sum-2')) $('exm-sum-2').value = lines[1] || '';
      if ($('exm-sum-3')) $('exm-sum-3').value = lines[2] || '';

      updateExtractStageUI();
      modal.style.display = 'flex';
    }

    // ==================== 4. MASTER GANTT CHART (ALL PROJECTS + DnD ORDER + FILTER) ====================
    function renderMasterGanttView(canvas, { onOpenProjectDetail }) {
      Store.syncOverdueTasksToWaiting();
      const todayYmd = Store.getLocalYmd();
      const todayMs = parseYmdMs(todayYmd);
      const goals = (Store.state.lifeGoals || []).filter((g) => g.title);

      let projects = Store.getParaEntities('project', { onlyActive: true });
      projects.sort((a, b) => (Number(a.ganttOrder || 0) - Number(b.ganttOrder || 0)) || (a.paraNumber - b.paraNumber));

      projects = projects.filter((p) => {
        if (mgGoalFilter !== 'all' && p.lifeGoalId !== mgGoalFilter) return false;
        const naCnt = Store.getProjectNextActionEntries(p.id, hooks.isItemVisible).length;
        const overdueCnt = Store.getProjectOverdueMissedTasks(p.id, hooks.isItemVisible).length;
        if (mgFilter === 'has-next' && naCnt === 0) return false;
        if (mgFilter === 'overdue' && overdueCnt === 0) return false;
        if (mgFilter === 'active' && p.status === 'hold') return false;
        return true;
      });

      // Compute timeline range across all projects and their dated cards
      let minMs = todayMs - 3 * 86400000;
      let maxMs = todayMs + 28 * 86400000;
      const projMeta = projects.map((p) => {
        const docs = Store.getProjectLinkedDocs(p.id, hooks.isItemVisible);
        const dated = docs.filter((d) => d.startDate && d.endDate);
        const milestones = docs.filter((d) => Store.getCardRole(d) === 'M' && (d.endDate || d.startDate));
        const naCnt = Store.getProjectNextActionEntries(p.id, hooks.isItemVisible).length;
        const overdueCnt = Store.getProjectOverdueMissedTasks(p.id, hooks.isItemVisible).length;
        let pStart = parseYmdMs(p.createdAt ? formatDayMsYmd(p.createdAt) : todayYmd);
        let pEnd = parseYmdMs(p.dueDate) || (todayMs + 14 * 86400000);
        dated.forEach((d) => {
          const s = parseYmdMs(d.startDate);
          const e = parseYmdMs(d.endDate);
          if (s && s < pStart) pStart = s;
          if (e && e > pEnd) pEnd = e;
        });
        if (pStart < minMs) minMs = pStart - 86400000;
        if (pEnd > maxMs) maxMs = pEnd + 2 * 86400000;
        return { p, dated, milestones, naCnt, overdueCnt, pStart, pEnd };
      });

      const totalDays = Math.max(14, Math.round((maxMs - minMs) / 86400000) + 1);
      const todayPct = Math.max(0, Math.min(100, ((todayMs - minMs) / (totalDays * 86400000)) * 100));
      const tickCount = 8;
      const ticksHtml = Array.from({ length: tickCount }).map((_, i) => {
        const tickMs = minMs + Math.round((i / (tickCount - 1)) * (totalDays - 1)) * 86400000;
        return `<span class="sb-gantt-tick">${formatShortDate(formatDayMsYmd(tickMs))}</span>`;
      }).join('');

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">전체 프로젝트 간트차트</h1>
            <p class="sb-page-sub">모든 프로젝트와 마일스톤(◆)을 한눈에 조망합니다. 프로젝트 행을 드래그앤드롭하여 순서를 변경할 수 있습니다.</p>
          </div>
          <div class="sb-flex-gap-xs">
            <select id="sb-mg-goal-filter" class="sb-field-select">
              <option value="all">모든 인생 목표</option>
              ${goals.map((g) => `<option value="${esc(g.id)}"${mgGoalFilter === g.id ? ' selected' : ''}>🎯 ${esc(g.title)}</option>`).join('')}
            </select>
          </div>
        </header>

        <section class="sb-card">
          <div class="sb-pd-filter-bar">
            <div class="sb-filter-group">
              <button type="button" class="sb-filter-chip${mgFilter === 'all' ? ' active' : ''}" data-mgf="all">전체 프로젝트</button>
              <button type="button" class="sb-filter-chip${mgFilter === 'has-next' ? ' active' : ''}" data-mgf="has-next">다음 행동 있는 프로젝트만</button>
              <button type="button" class="sb-filter-chip${mgFilter === 'active' ? ' active' : ''}" data-mgf="active">진행 중만</button>
              <button type="button" class="sb-filter-chip is-risk-a${mgFilter === 'overdue' ? ' active' : ''}" data-mgf="overdue">누락/지연 프로젝트만</button>
            </div>
          </div>

          ${projMeta.length === 0 ? `<div class="sb-empty-line"><span>필터 조건에 맞는 프로젝트가 없습니다.</span></div>` : `
            <div class="sb-gantt-board">
              <div class="sb-gantt-head">
                <div class="sb-gantt-head-left">프로젝트 (드래그로 순서 변경)</div>
                <div class="sb-gantt-head-axis">${ticksHtml}</div>
              </div>
              ${projMeta.map(({ p, dated, milestones, naCnt, overdueCnt, pStart, pEnd }) => {
                const lv = Store.getProjectLevel(p.id);
                const leftPct = Math.max(0, ((pStart - minMs) / (totalDays * 86400000)) * 100);
                const widthPct = Math.max(4, (((pEnd - pStart) + 86400000) / (totalDays * 86400000)) * 100);
                const barCls = overdueCnt > 0 ? 'is-delayed' : (p.status === 'hold' ? 'is-extended' : 'is-normal');
                const goal = Store.getLifeGoalById(p.lifeGoalId);
                return `
                  <div class="sb-gantt-row sb-mg-proj-row${overdueCnt > 0 ? ' is-overdue-row' : ''}" draggable="true" data-mg-pid="${esc(p.id)}">
                    <div class="sb-gantt-label">
                      <div class="sb-gantt-label-top">
                        <span class="sb-drag-handle" title="드래그하여 순서 변경">⋮⋮</span>
                        <span class="sb-lv-badge">Lv.${lv}</span>
                        <button type="button" class="sb-tc-title" data-mg-open="${esc(p.id)}">${esc(Store.getParaCode(p))} ${esc(p.name)}</button>
                      </div>
                      <div class="sb-gantt-label-sub">
                        <span>다음행동 ${naCnt} · 일정 ${dated.length}${goal ? ` · 🎯${esc(goal.title)}` : ''}</span>
                        ${overdueCnt > 0 ? `<span class="sb-overdue-badge">누락 ${overdueCnt}</span>` : ''}
                      </div>
                    </div>
                    <div class="sb-gantt-track" data-mg-open="${esc(p.id)}">
                      <div class="sb-gantt-today-line" style="left:${todayPct}%"></div>
                      <div class="sb-gantt-bar ${barCls}" style="left:${leftPct}%; width:${Math.min(100 - leftPct, widthPct)}%;">
                        <span>${p.progress}% · ${p.dueDate ? `~${formatShortDate(p.dueDate)}` : '진행중'}</span>
                      </div>
                      ${milestones.map((m) => {
                        const msDay = parseYmdMs(m.endDate || m.startDate);
                        if (!msDay) return '';
                        const mPct = Math.max(1, Math.min(98, ((msDay - minMs) / (totalDays * 86400000)) * 100));
                        return `<span class="sb-gantt-milestone" style="left:${mPct}%" title="◆ 마일스톤: ${esc(m.name.replace(/\.md$/i, ''))} (${esc(m.endDate || m.startDate)})">◆</span>`;
                      }).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </section>
      `;

      $('sb-mg-goal-filter')?.addEventListener('change', (e) => { mgGoalFilter = e.target.value; renderMasterGanttView(canvas, { onOpenProjectDetail }); });
      canvas.querySelectorAll('[data-mgf]').forEach((b) => b.addEventListener('click', () => { mgFilter = b.dataset.mgf; renderMasterGanttView(canvas, { onOpenProjectDetail }); }));
      canvas.querySelectorAll('[data-mg-open]').forEach((b) => b.addEventListener('click', () => onOpenProjectDetail?.(b.dataset.mgOpen, 'gantt')));

      // Drag and drop reordering of projects in Master Gantt
      canvas.querySelectorAll('.sb-mg-proj-row[data-mg-pid]').forEach((row) => {
        row.addEventListener('dragstart', (e) => {
          mgDragProjId = row.dataset.mgPid;
          row.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          mgDragProjId = null;
          row.classList.remove('is-dragging');
          canvas.querySelectorAll('.sb-mg-proj-row').forEach((r) => r.classList.remove('is-drag-over'));
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (mgDragProjId && mgDragProjId !== row.dataset.mgPid) row.classList.add('is-drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('is-drag-over');
          const targetId = row.dataset.mgPid;
          if (!mgDragProjId || !targetId || mgDragProjId === targetId) return;
          const ordered = Store.getParaEntities('project', { onlyActive: true })
            .sort((a, b) => (Number(a.ganttOrder || 0) - Number(b.ganttOrder || 0)) || (a.paraNumber - b.paraNumber));
          const fromIdx = ordered.findIndex((p) => p.id === mgDragProjId);
          const toIdx = ordered.findIndex((p) => p.id === targetId);
          if (fromIdx < 0 || toIdx < 0) return;
          const [moved] = ordered.splice(fromIdx, 1);
          ordered.splice(toIdx, 0, moved);
          ordered.forEach((p, idx) => { p.ganttOrder = idx + 1; });
          Store.persistParaEntities();
          hooks.showToast('↕️ 전체 간트차트 프로젝트 순서가 변경되었습니다.');
          renderMasterGanttView(canvas, { onOpenProjectDetail });
        });
      });
    }

    // ==================== 5. LIFE GOALS 5 MODAL ====================
    function bindLifeGoalsModalOnce() {
      const modal = $('life-goals-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';
      const close = () => { modal.style.display = 'none'; };
      $('lgm-close-btn')?.addEventListener('click', close);
      $('lgm-cancel-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      $('lgm-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const goals = [0, 1, 2, 3, 4].map((i) => ({
          id: `lg-${i + 1}`,
          title: $(`lgm-title-${i}`)?.value || '',
          desc: $(`lgm-desc-${i}`)?.value || '',
          color: $(`lgm-color-${i}`)?.value || '#4f46e5'
        }));
        Store.saveLifeGoals(goals);
        close();
        hooks.saveAndRender();
        hooks.showToast('🎯 인생 중요 목표 5가지가 저장되었습니다.');
      });
    }

    function openLifeGoalsModal() {
      bindLifeGoalsModalOnce();
      const modal = $('life-goals-modal');
      if (!modal) return;
      const goals = Store.state.lifeGoals || [];
      [0, 1, 2, 3, 4].forEach((i) => {
        const g = goals[i] || {};
        if ($(`lgm-title-${i}`)) $(`lgm-title-${i}`).value = g.title || '';
        if ($(`lgm-desc-${i}`)) $(`lgm-desc-${i}`).value = g.desc || '';
        if ($(`lgm-color-${i}`)) $(`lgm-color-${i}`).value = g.color || ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#e11d48'][i];
      });
      modal.style.display = 'flex';
    }

    // ==================== 6. DAILY CHANGE HISTORY VIEW (일별 변경 이력) ====================
    function renderChangeHistoryView(canvas) {
      const grouped = Store.getChangeLogsGroupedByDate(histCatFilter, histSearch);
      const catLabel = {
        project: '프로젝트',
        task: '할일·행동',
        relation: '관계 DB',
        requirement: '요구·평가',
        archive: '아카이브',
        goal: '인생목표',
        general: '일반'
      };

      canvas.innerHTML = `
        <header class="sb-page-header">
          <div>
            <h1 class="sb-page-title">일별 변경 이력</h1>
            <p class="sb-page-sub">하루하루 어떤 데이터베이스 관계가 변경되었고, 어떤 프로젝트에 어떤 일을 추가·완료했는지 날짜별로 추적합니다.</p>
          </div>
          <button type="button" class="sb-btn-primary" id="sb-export-today-log-md">오늘 이력 MD 저장</button>
        </header>

        <section class="sb-card">
          <div class="sb-pd-filter-bar">
            <div class="sb-filter-group">
              ${[
                { k: 'all', lbl: '전체' },
                { k: 'project', lbl: '프로젝트' },
                { k: 'task', lbl: '할일·다음행동' },
                { k: 'relation', lbl: '관계 DB' },
                { k: 'requirement', lbl: '요구·평가' },
                { k: 'archive', lbl: '아카이브' }
              ].map((c) => `<button type="button" class="sb-filter-chip${histCatFilter === c.k ? ' active' : ''}" data-hcat="${c.k}">${c.lbl}</button>`).join('')}
              <input type="text" id="sb-hist-search" class="sb-field-input" value="${esc(histSearch)}" placeholder="이력 검색..." style="margin-left:auto; max-width:220px;">
            </div>
          </div>

          ${grouped.length === 0 ? `<div class="sb-empty-line"><span>기록된 변경 이력이 아직 없습니다. 프로젝트를 만들거나 관계를 연결하면 자동으로 날짜별 기록이 쌓입니다.</span></div>` : grouped.map(([dateStr, logs]) => `
            <div class="sb-hist-day-group">
              <div class="sb-hist-day-head">
                <strong>${esc(dateStr)}</strong>
                <span>${logs.length}건</span>
              </div>
              <div class="sb-hist-list">
                ${logs.map((l) => `
                  <div class="sb-hist-row">
                    <span class="sb-hist-time">${esc(l.time)}</span>
                    <span class="sb-hist-cat is-cat-${esc(l.category)}">${esc(catLabel[l.category] || '변경')}</span>
                    ${l.projectName ? `<span class="sb-code-pill-xs">${esc(l.projectName)}</span>` : ''}
                    <span class="sb-hist-msg">${esc(l.message)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </section>
      `;

      canvas.querySelectorAll('[data-hcat]').forEach((b) => b.addEventListener('click', () => { histCatFilter = b.dataset.hcat; renderChangeHistoryView(canvas); }));
      $('sb-hist-search')?.addEventListener('input', (e) => { histSearch = e.target.value; renderChangeHistoryView(canvas); });
      $('sb-export-today-log-md')?.addEventListener('click', () => {
        const today = Store.getLocalYmd();
        const todayLogs = (Store.state.changeLogs || []).filter((l) => l.date === today);
        const md = `# ${today} 세컨드 브레인 일일 변경 이력\n\n` +
          (todayLogs.length
            ? todayLogs.map((l) => `- **${l.time}** [${catLabel[l.category] || l.category}] ${l.projectName ? `(${l.projectName}) ` : ''}${l.message}`).join('\n')
            : '- 기록된 변경 없음');
        const folder = hooks.getOrCreateDailyMemoFolder();
        const name = hooks.getUniqueNameInFolder(folder, `${today} 변경 이력`, '.md');
        const doc = Store.touchNode({
          id: Store.genId(),
          type: 'doc',
          name,
          icon: '📜',
          tag: '#변경이력 #일일기록',
          cardRole: 'S',
          summary: md,
          link: ''
        });
        folder.children.unshift(doc);
        hooks.syncDocAfterSave?.(doc);
        hooks.saveAndRender();
        hooks.launchItemDirectly(doc);
        hooks.showToast(`📜 "${name}" 저장되었습니다.`);
      });
    }

    // ==================== 7. CARD PROPERTIES & MEMBERSHIP MODAL (카드 속성 · 소속 · 다음행동 · 명확화) ====================
    let cpmCurrentDocId = null;
    let cpmOnUpdated = null;
    let cpmSelectedProjects = new Set();
    let cpmSelectedAreas = new Set();
    let cpmSelectedResources = new Set();
    let cpmSelectedRole = 'T';

    function renderCardPropsBody(doc) {
      const bodyEl = $('cpm-body');
      if (!bodyEl || !doc) return;
      const role = cpmSelectedRole || Store.getCardRole(doc);
      const subtype = doc.resultSubtype || 'output';
      const parentDoc = doc.parentCardId ? Store.findNodeAndParent(doc.parentCardId)?.node : null;
      const descendants = Store.getAllDescendantCards(doc.id, hooks.isItemVisible);
      const projects = Store.getParaEntities('project', { onlyActive: true });
      const areas = Store.getParaEntities('area', { onlyActive: true });
      const resources = Store.getParaEntities('resource', { onlyActive: true });
      const opts = Store.state.gtdTagOptions || { context: [], time: [], energy: [] };
      const actions = Array.isArray(doc.nextActions) ? doc.nextActions : [];
      const tagsStr = Store.getCardTags(doc).join(', ');
      const displayName = String(doc.name || '').replace(/\.md$/i, '');

      const renderMultiChips = (list, selectedSet, groupKey) => {
        if (!list.length) return `<span class="sb-muted-sm">등록된 항목이 없습니다. 아래에서 바로 추가할 수 있어요.</span>`;
        return list.map((ent) => {
          const active = selectedSet.has(ent.id);
          return `
            <button type="button" class="sb-cpm-para-chip ${active ? 'active' : ''}" data-cpm-para-group="${groupKey}" data-eid="${esc(ent.id)}">
              <span class="sb-cpm-chk">${active ? '✓' : '+'}</span>
              <span class="sb-code-pill-xs">${esc(Store.getParaCode(ent))}</span>
              <span>${esc(ent.name)}</span>
            </button>
          `;
        }).join('');
      };

      bodyEl.innerHTML = `
        ${parentDoc || descendants.length > 0 ? `
          <div class="sb-cpm-hierarchy-banner">
            ${parentDoc ? `<button type="button" class="sb-cpm-parent-link" data-cpm-jump-doc="${esc(parentDoc.id)}">⬆️ 상위 일: <strong>${esc(parentDoc.name.replace(/\.md$/i, ''))}</strong></button>` : ''}
            ${descendants.length > 0 ? `<span class="sb-cpm-inherit-note">↳ 하위 일 <strong>${descendants.length}건</strong>도 선택한 프로젝트·영역에 자동 소속됩니다.</span>` : ''}
          </div>
        ` : ''}

        <div class="sb-cpm-section">
          <div class="sb-cpm-row-2">
            <label class="sb-cpm-field" style="flex:1;">
              <span>카드 이름</span>
              <input type="text" id="cpm-name" class="edit-input" value="${esc(displayName)}">
            </label>
            <label class="sb-cpm-field" style="width:185px;">
              <span>태그 (쉼표 구분)</span>
              <input type="text" id="cpm-tags" class="edit-input" value="${esc(tagsStr)}" placeholder="설계, 검토, 자료">
            </label>
          </div>

          <div class="sb-cpm-role-row">
            <span class="sb-cpm-label">카드 유형</span>
            <div class="sb-cpm-role-pills">
              ${[
                { code: 'T', lbl: 'T 할일' },
                { code: 'S', lbl: 'S 자료' },
                { code: 'R', lbl: 'R 산출물' },
                { code: 'M', lbl: '◆ M 마일스톤' }
              ].map((r) => `
                <button type="button" class="sb-cpm-role-pill ${role === r.code ? 'active' : ''}" data-cpm-role="${r.code}">${r.lbl}</button>
              `).join('')}
            </div>
            ${role === 'R' ? `
              <select id="cpm-subtype" class="sb-select-sm">
                <option value="output" ${subtype === 'output' ? 'selected' : ''}>산출물</option>
                <option value="trial_error" ${subtype === 'trial_error' ? 'selected' : ''}>시행착오</option>
                <option value="mistake" ${subtype === 'mistake' ? 'selected' : ''}>실수유형</option>
              </select>
            ` : ''}
          </div>

          <div class="sb-cpm-check-row">
            <label class="sb-check-inline">
              <input type="checkbox" id="cpm-core" ${doc.isTodayCore ? 'checked' : ''}>
              <span>⭐ 오늘의 핵심에 표시</span>
            </label>
            <input type="text" id="cpm-core-time" class="edit-input input-sm" style="width:110px;" value="${esc(doc.coreTime || '')}" placeholder="시간 (예: 14:00)">
            <label class="sb-check-inline sb-cpm-sched-pill">
              <input type="checkbox" id="cpm-is-schedule" ${(doc.isSchedule || Store.getCardTags(doc).some((t) => /^(일정|스케줄|schedule)$/i.test(t))) ? 'checked' : ''}>
              <span>📅 일정(스케줄) 태그</span>
            </label>
            <label class="sb-check-inline">
              <input type="checkbox" id="cpm-completed" ${doc.completed ? 'checked' : ''}>
              <span>☑️ 완료 처리</span>
            </label>
          </div>
          <div class="sb-cpm-sched-extra" id="cpm-sched-extra" style="display:${(doc.isSchedule || Store.getCardTags(doc).some((t) => /^(일정|스케줄|schedule)$/i.test(t))) ? 'flex' : 'none'};">
            <span class="sb-muted-sm">🚦 5시간 이내 시작 시 일정 신호등 자동 연동:</span>
            <label class="sb-cpm-mini-num">이동 <input type="number" id="cpm-travel-mins" min="0" max="300" step="5" value="${Number.isFinite(Number(doc.travelMins)) ? Number(doc.travelMins) : 30}">분</label>
            <label class="sb-cpm-mini-num">여유 <input type="number" id="cpm-buffer-mins" min="0" max="180" step="5" value="${Number.isFinite(Number(doc.bufferMins)) ? Number(doc.bufferMins) : 10}">분</label>
          </div>
        </div>

        <div class="sb-cpm-section">
          <div class="sb-cpm-sec-title">📅 설정 기간 · 시간 블록 <span class="sb-muted-sm">(구글 캘린더 · 수신함 기간 탭 연동)</span></div>
          <div class="sb-cpm-row-2">
            <label class="sb-cpm-field">
              <span>시작일</span>
              <input type="date" id="cpm-start" class="edit-input" value="${esc(doc.startDate || '')}">
            </label>
            <label class="sb-cpm-field">
              <span>종료 / 마일스톤일</span>
              <input type="date" id="cpm-end" class="edit-input" value="${esc(doc.endDate || '')}">
            </label>
            <label class="sb-cpm-field" style="max-width:125px;">
              <span>시작 시간 (선택)</span>
              <input type="time" id="cpm-start-time" class="edit-input" value="${esc(doc.startTime || doc.coreTime || '')}">
            </label>
            <label class="sb-cpm-field" style="max-width:125px;">
              <span>종료 시간 (선택)</span>
              <input type="time" id="cpm-end-time" class="edit-input" value="${esc(doc.endTime || '')}">
            </label>
          </div>
        </div>

        <div class="sb-cpm-section">
          <div class="sb-cpm-sec-title">🔗 소속 프로젝트 · 영역 · 자료 <span class="sb-muted-sm">(여러 개 중복 선택 가능)</span></div>

          <div class="sb-cpm-para-block">
            <div class="sb-cpm-para-head">
              <span>🚀 프로젝트 (${cpmSelectedProjects.size}개 선택)</span>
              <div class="sb-cpm-quick-add">
                <input type="text" id="cpm-new-proj" class="edit-input input-sm" placeholder="새 프로젝트 바로 추가...">
                <button type="button" class="sb-btn-soft-sm" id="cpm-add-proj-btn">＋</button>
              </div>
            </div>
            <div class="sb-cpm-chip-list">${renderMultiChips(projects, cpmSelectedProjects, 'project')}</div>
          </div>

          <div class="sb-cpm-para-block">
            <div class="sb-cpm-para-head">
              <span>🧭 영역 Area (${cpmSelectedAreas.size}개 선택)</span>
              <div class="sb-cpm-quick-add">
                <input type="text" id="cpm-new-area" class="edit-input input-sm" placeholder="새 영역 바로 추가...">
                <button type="button" class="sb-btn-soft-sm" id="cpm-add-area-btn">＋</button>
              </div>
            </div>
            <div class="sb-cpm-chip-list">${renderMultiChips(areas, cpmSelectedAreas, 'area')}</div>
          </div>

          <div class="sb-cpm-para-block">
            <div class="sb-cpm-para-head">
              <span>📚 자료 Resource (${cpmSelectedResources.size}개 선택)</span>
            </div>
            <div class="sb-cpm-chip-list">${renderMultiChips(resources, cpmSelectedResources, 'resource')}</div>
          </div>
        </div>

        <div class="sb-cpm-section">
          <div class="sb-cpm-sec-title">⚡ 다음 행동 (GTD) <span class="sb-muted-sm">${actions.filter((a) => !a.done).length}건 대기</span></div>
          <div class="sb-cpm-na-list">
            ${actions.length === 0
              ? `<div class="sb-muted-sm">등록된 다음 행동이 없습니다. 아래에서 바로 추가하세요.</div>`
              : actions.map((a) => `
                <div class="sb-cpm-na-row ${a.done ? 'is-done' : ''}" data-na-id="${esc(a.id)}">
                  <button type="button" class="sb-checkbox-sm ${a.done ? 'checked' : ''}" data-cpm-na-toggle="${esc(a.id)}">${a.done ? '✓' : ''}</button>
                  <span class="sb-cpm-na-text">${esc(a.text)}</span>
                  <div class="sb-na-tags">
                    ${a.context ? `<span class="sb-gtd-tag ctx">${esc(a.context)}</span>` : ''}
                    ${a.time ? `<span class="sb-gtd-tag time">${esc(a.time)}</span>` : ''}
                    ${a.energy ? `<span class="sb-gtd-tag energy">${esc(a.energy)}</span>` : ''}
                  </div>
                  <button type="button" class="sb-card-del-btn" data-cpm-na-del="${esc(a.id)}" title="삭제">✕</button>
                </div>
              `).join('')}
          </div>
          <div class="sb-cpm-na-add">
            <input type="text" id="cpm-na-text" class="edit-input input-sm" placeholder="다음 행동 입력 (예: 치과 예약 전화하기)...">
            <select id="cpm-na-ctx" class="sb-select-sm">${(opts.context || ['@PC']).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
            <select id="cpm-na-time" class="sb-select-sm">${(opts.time || ['@30분']).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
            <select id="cpm-na-energy" class="sb-select-sm">${(opts.energy || ['@중간']).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
            <button type="button" class="sb-btn-primary-sm" id="cpm-na-add-btn">＋ 추가</button>
          </div>
        </div>

        <div class="sb-cpm-section">
          <div class="sb-cpm-sec-title">↳ 하위 카드 빠른 추가 <span class="sb-muted-sm">(현재 선택한 프로젝트·영역 자동 상속)</span></div>
          <div class="sb-cpm-sub-add">
            <input type="text" id="cpm-sub-title" class="edit-input input-sm" placeholder="하위 할일/자료 제목 입력...">
            <select id="cpm-sub-role" class="sb-select-sm">
              <option value="T">T 할일</option>
              <option value="S">S 자료</option>
              <option value="R">R 산출물</option>
              <option value="M">◆ M 마일스톤</option>
            </select>
            <button type="button" class="sb-btn-soft-sm" id="cpm-sub-add-btn">＋ 하위 추가</button>
          </div>
        </div>
      `;

      // Bind interactive controls inside body
      bodyEl.querySelector('[data-cpm-jump-doc]')?.addEventListener('click', (e) => {
        const pid = e.currentTarget.dataset.cpmJumpDoc;
        const pNode = Store.findNodeAndParent(pid)?.node;
        if (pNode) {
          saveCardPropsForm({ silent: true, closeAfter: false });
          openCardPropertiesModal(pNode, cpmOnUpdated);
        }
      });

      bodyEl.querySelector('#cpm-is-schedule')?.addEventListener('change', (e) => {
        const checked = Boolean(e.target.checked);
        const extraEl = bodyEl.querySelector('#cpm-sched-extra');
        if (extraEl) extraEl.style.display = checked ? 'flex' : 'none';
        const tagsEl = bodyEl.querySelector('#cpm-tags');
        if (tagsEl) {
          let list = String(tagsEl.value || '').split(/[,\s]+/).map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);
          if (checked && !list.some((t) => /^(일정|스케줄|schedule)$/i.test(t))) {
            list.unshift('일정');
          } else if (!checked) {
            list = list.filter((t) => !/^(일정|스케줄|schedule)$/i.test(t));
          }
          tagsEl.value = list.join(', ');
        }
        const stDateEl = bodyEl.querySelector('#cpm-start');
        if (checked && stDateEl && !stDateEl.value) {
          stDateEl.value = hooks.getTodayYMD();
        }
      });

      bodyEl.querySelectorAll('[data-cpm-role]').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftFieldsToDoc(doc);
          cpmSelectedRole = btn.dataset.cpmRole || 'T';
          renderCardPropsBody(doc);
        });
      });

      bodyEl.querySelectorAll('[data-cpm-para-group]').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftFieldsToDoc(doc);
          const group = btn.dataset.cpmParaGroup;
          const eid = btn.dataset.eid;
          const targetSet = group === 'project' ? cpmSelectedProjects : (group === 'area' ? cpmSelectedAreas : cpmSelectedResources);
          if (targetSet.has(eid)) targetSet.delete(eid);
          else targetSet.add(eid);
          renderCardPropsBody(doc);
        });
      });

      bodyEl.querySelector('#cpm-add-proj-btn')?.addEventListener('click', () => {
        const name = String(bodyEl.querySelector('#cpm-new-proj')?.value || '').trim();
        if (!name) return;
        syncDraftFieldsToDoc(doc);
        const created = Store.declareParaEntity({ paraType: 'project', name });
        if (created) {
          cpmSelectedProjects.add(created.id);
          hooks.showToast(`🚀 새 프로젝트 "${created.name}" 생성 및 선택됨`);
          renderCardPropsBody(doc);
        }
      });

      bodyEl.querySelector('#cpm-add-area-btn')?.addEventListener('click', () => {
        const name = String(bodyEl.querySelector('#cpm-new-area')?.value || '').trim();
        if (!name) return;
        syncDraftFieldsToDoc(doc);
        const created = Store.declareParaEntity({ paraType: 'area', name });
        if (created) {
          cpmSelectedAreas.add(created.id);
          hooks.showToast(`🧭 새 영역 "${created.name}" 생성 및 선택됨`);
          renderCardPropsBody(doc);
        }
      });

      bodyEl.querySelector('#cpm-na-add-btn')?.addEventListener('click', () => {
        const text = String(bodyEl.querySelector('#cpm-na-text')?.value || '').trim();
        if (!text) return;
        syncDraftFieldsToDoc(doc);
        Store.addNextActionToDoc(doc, {
          text,
          context: bodyEl.querySelector('#cpm-na-ctx')?.value || '@PC',
          time: bodyEl.querySelector('#cpm-na-time')?.value || '@30분',
          energy: bodyEl.querySelector('#cpm-na-energy')?.value || '@중간'
        });
        hooks.saveAndRender();
        if (cpmOnUpdated) cpmOnUpdated();
        renderCardPropsBody(doc);
      });

      bodyEl.querySelector('#cpm-na-text')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          bodyEl.querySelector('#cpm-na-add-btn')?.click();
        }
      });

      bodyEl.querySelectorAll('[data-cpm-na-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftFieldsToDoc(doc);
          Store.toggleNextActionOnDoc(doc, btn.dataset.cpmNaToggle);
          hooks.saveAndRender();
          if (cpmOnUpdated) cpmOnUpdated();
          renderCardPropsBody(doc);
        });
      });

      bodyEl.querySelectorAll('[data-cpm-na-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftFieldsToDoc(doc);
          Store.deleteNextActionOnDoc(doc, btn.dataset.cpmNaDel);
          hooks.saveAndRender();
          if (cpmOnUpdated) cpmOnUpdated();
          renderCardPropsBody(doc);
        });
      });

      bodyEl.querySelector('#cpm-sub-add-btn')?.addEventListener('click', () => {
        const title = String(bodyEl.querySelector('#cpm-sub-title')?.value || '').trim();
        if (!title) return;
        saveCardPropsForm({ silent: true, closeAfter: false });
        const subRole = bodyEl.querySelector('#cpm-sub-role')?.value || 'T';
        const folder = hooks.getOrCreateDailyMemoFolder();
        const fileName = hooks.getUniqueNameInFolder(folder, title, '.md');
        const subDoc = Store.touchNode({
          id: Store.genId(),
          type: 'doc',
          name: fileName,
          icon: subRole === 'T' ? '☑️' : (subRole === 'R' ? '📦' : (subRole === 'M' ? '◆' : '📄')),
          tag: `#${subRole}`,
          cardRole: subRole,
          isTodayCore: false,
          completed: false,
          parentCardId: doc.id,
          summary: `# ${title}\n\n`,
          link: '',
          dailyDate: hooks.getTodayYMD()
        });
        folder.children.unshift(subDoc);
        Store.linkSubCard(doc, subDoc, { inheritPara: true });
        hooks.syncDocAfterSave?.(subDoc);
        hooks.saveAndRender();
        if (cpmOnUpdated) cpmOnUpdated();
        hooks.showToast(`↳ 하위 카드 "${title}" 추가됨 (상위 프로젝트 자동 상속)`);
        renderCardPropsBody(doc);
      });
    }

    function syncDraftFieldsToDoc(doc) {
      if (!doc) return;
      const bodyEl = $('cpm-body');
      if (!bodyEl) return;
      const nameVal = String(bodyEl.querySelector('#cpm-name')?.value || '').trim();
      if (nameVal) {
        const hasExt = /\.[a-z0-9]{1,6}$/i.test(doc.name || '');
        const ext = hasExt ? (doc.name.match(/\.[a-z0-9]{1,6}$/i)?.[0] || '.md') : '.md';
        doc.name = nameVal.endsWith(ext) ? nameVal : `${nameVal}${ext}`;
      }
      const coreEl = bodyEl.querySelector('#cpm-core');
      if (coreEl) doc.isTodayCore = coreEl.checked;
      const timeEl = bodyEl.querySelector('#cpm-core-time');
      if (timeEl) doc.coreTime = String(timeEl.value || '').trim();
      const compEl = bodyEl.querySelector('#cpm-completed');
      if (compEl) {
        doc.completed = compEl.checked;
        if (doc.completed && !doc.completedAt) doc.completedAt = Date.now();
        if (!doc.completed) doc.completedAt = 0;
      }
      const startEl = bodyEl.querySelector('#cpm-start');
      const endEl = bodyEl.querySelector('#cpm-end');
      if (startEl || endEl) {
        Store.updateCardSchedule(doc, {
          startDate: startEl ? startEl.value : doc.startDate,
          endDate: endEl ? endEl.value : doc.endDate
        });
      }
      const stTimeEl = bodyEl.querySelector('#cpm-start-time');
      const enTimeEl = bodyEl.querySelector('#cpm-end-time');
      if (stTimeEl) doc.startTime = String(stTimeEl.value || '').trim();
      if (enTimeEl) doc.endTime = String(enTimeEl.value || '').trim();
      const tagsEl = bodyEl.querySelector('#cpm-tags');
      const schedChkEl = bodyEl.querySelector('#cpm-is-schedule');
      if (tagsEl) {
        let list = String(tagsEl.value || '').split(/[,\s]+/).map((t) => t.trim().replace(/^#+/, '')).filter(Boolean);
        const hasSchedTag = list.some((t) => /^(일정|스케줄|schedule)$/i.test(t));
        const isSchedChecked = schedChkEl ? schedChkEl.checked : hasSchedTag;
        if (isSchedChecked && !hasSchedTag) list.unshift('일정');
        if (schedChkEl && !isSchedChecked) list = list.filter((t) => !/^(일정|스케줄|schedule)$/i.test(t));
        doc.isSchedule = Boolean(isSchedChecked || list.some((t) => /^(일정|스케줄|schedule)$/i.test(t)));
        Store.setCardTags(doc, list);
      } else if (schedChkEl) {
        doc.isSchedule = Boolean(schedChkEl.checked);
      }
      const trvEl = bodyEl.querySelector('#cpm-travel-mins');
      const bufEl = bodyEl.querySelector('#cpm-buffer-mins');
      if (trvEl) doc.travelMins = Math.max(0, Math.min(300, Number(trvEl.value || 0)));
      if (bufEl) doc.bufferMins = Math.max(0, Math.min(180, Number(bufEl.value || 0)));
      const subEl = bodyEl.querySelector('#cpm-subtype');
      if (subEl && cpmSelectedRole === 'R') {
        Store.setCardResultSubtype(doc, subEl.value);
      }
    }

    function saveCardPropsForm({ silent = false, closeAfter = true } = {}) {
      const doc = Store.findNodeAndParent(cpmCurrentDocId)?.node;
      if (!doc) return null;
      syncDraftFieldsToDoc(doc);
      Store.setCardRole(doc, cpmSelectedRole || Store.getCardRole(doc));
      const syncRes = Store.syncCardParaRelations(doc.id, {
        projectIds: Array.from(cpmSelectedProjects),
        areaIds: Array.from(cpmSelectedAreas),
        resourceIds: Array.from(cpmSelectedResources)
      });
      Store.touchNode(doc);
      Store.persistFS();
      hooks.syncDocAfterSave?.(doc);
      hooks.saveAndRender();
      if (cpmOnUpdated) cpmOnUpdated();
      if (closeAfter) {
        const modal = $('card-props-modal');
        if (modal) modal.style.display = 'none';
      }
      if (!silent) {
        const subMsg = syncRes.propagatedSubCount > 0 && (cpmSelectedProjects.size > 0 || cpmSelectedAreas.size > 0)
          ? ` (하위 일 ${syncRes.propagatedSubCount}건 자동 상속)`
          : '';
        hooks.showToast(`💾 카드 속성 및 소속 정보가 저장되었습니다.${subMsg}`);
      }
      return doc;
    }

    function bindCardPropsModalOnce() {
      const modal = $('card-props-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';
      const close = () => { modal.style.display = 'none'; };

      $('cpm-close-btn')?.addEventListener('click', close);
      $('cpm-cancel-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      $('cpm-save-btn')?.addEventListener('click', () => {
        saveCardPropsForm({ silent: false, closeAfter: true });
      });

      $('cpm-open-content-top')?.addEventListener('click', () => {
        const doc = saveCardPropsForm({ silent: true, closeAfter: true });
        if (doc) hooks.launchItemDirectly(doc);
      });

      $('cpm-btn-clarify')?.addEventListener('click', () => {
        const doc = saveCardPropsForm({ silent: true, closeAfter: true });
        if (doc) openClarifyModal(doc, cpmOnUpdated);
      });

      $('cpm-btn-extract')?.addEventListener('click', () => {
        const doc = saveCardPropsForm({ silent: true, closeAfter: true });
        if (doc) openExtractModal(doc, cpmOnUpdated);
      });

      $('cpm-btn-delete')?.addEventListener('click', () => {
        const found = Store.findNodeAndParent(cpmCurrentDocId);
        const doc = found?.node;
        if (!doc) return;
        if (!confirm(`"${doc.name.replace(/\.md$/i, '')}" 카드를 삭제할까요?`)) return;
        Store.saveStateForUndo();
        if (found.parent && Array.isArray(found.parent.children)) {
          found.parent.children = found.parent.children.filter((c) => c.id !== doc.id);
        }
        Store.state.relations = (Store.state.relations || []).filter((r) => r.sourceId !== doc.id && r.targetId !== doc.id);
        Store.persistRelations();
        Store.persistFS();
        close();
        hooks.saveAndRender();
        if (cpmOnUpdated) cpmOnUpdated();
        hooks.showToast(`🗑️ "${doc.name.replace(/\.md$/i, '')}" 삭제되었습니다.`);
      });
    }

    function openCardPropertiesModal(doc, onUpdated = null) {
      if (!doc) return;
      bindCardPropsModalOnce();
      cpmCurrentDocId = doc.id;
      cpmOnUpdated = onUpdated;
      cpmSelectedRole = Store.getCardRole(doc);

      const rels = Store.getRelationsForNode(doc.id);
      cpmSelectedProjects = new Set((rels.projects || []).map((x) => x.node?.id).filter(Boolean));
      cpmSelectedAreas = new Set((rels.areas || []).map((x) => x.node?.id).filter(Boolean));
      cpmSelectedResources = new Set((rels.resources || []).map((x) => x.node?.id).filter(Boolean));

      renderCardPropsBody(doc);
      const modal = $('card-props-modal');
      if (modal) modal.style.display = 'flex';
    }

    return {
      openClarifyModal,
      openExtractModal,
      openLifeGoalsModal,
      openCardPropertiesModal,
      renderNextActionsView,
      renderMasterGanttView,
      renderChangeHistoryView
    };
  }

  global.BrainGtdSecondBrain = {
    createGtdSecondBrain
  };
})(window);
