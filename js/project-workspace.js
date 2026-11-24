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

  function formatShortDate(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${Number(m[2])}/${Number(m[3])}`;
  }

  function parseYmdToDayMs(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatDayMsToYmd(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function addDaysYmd(ymd, deltaDays) {
    const base = parseYmdToDayMs(ymd) ?? parseYmdToDayMs(getTodayYmd());
    return formatDayMsToYmd(base + deltaDays * 86400000);
  }

  function getTodayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getRoleMeta(role) {
    if (role === 'T') return { code: 'T', label: '할일', cls: 'is-role-t', title: '할일 (Todo) — 클릭하여 자료형태 변경 (T → S → R)' };
    if (role === 'R') return { code: 'R', label: '산출물', cls: 'is-role-r', title: '산출물 (Result) — 클릭하여 자료형태 변경 (R → T → S)' };
    return { code: 'S', label: '자료', cls: 'is-role-s', title: '자료 (Source) — 클릭하여 자료형태 변경 (S → R → T)' };
  }

  function nextRoleCode(role) {
    if (role === 'T') return 'S';
    if (role === 'S') return 'R';
    return 'T';
  }

  function isCardDelayed(doc) {
    if (!doc || doc.completed) return false;
    const todayMs = parseYmdToDayMs(getTodayYmd());
    const endMs = parseYmdToDayMs(doc.endDate);
    if (endMs !== null && endMs < todayMs) return true;
    return false;
  }

  function isCardExtended(doc) {
    if (!doc || !doc.plannedEndDate || !doc.endDate) return false;
    const plannedMs = parseYmdToDayMs(doc.plannedEndDate);
    const endMs = parseYmdToDayMs(doc.endDate);
    return plannedMs !== null && endMs !== null && endMs > plannedMs;
  }

  function createProjectWorkspace(hooks) {
    const Store = global.BrainStore;
    const $ = (id) => document.getElementById(id);

    // State inside Project Detail Workspace
    let detailTab = 'cards'; // 'cards' | 'gantt' | 'risks' | 'templates'
    let cardRoleFilter = 'all'; // 'all' | 'T' | 'S' | 'R' | 'open' | 'done'
    let cardTagFilter = '';
    let riskLevelFilter = 'all'; // 'all' | 'A' | 'B' | 'C'
    let editingGanttDocId = null;
    let inlineSubParentId = null;
    const expandedCardIds = new Set();

    // Completion Modal state
    let completionTargetDoc = null;
    let completionProjectId = null;
    let completionMode = 'internal'; // 'internal' | 'external'
    let stagedFiles = []; // File[]

    function getPrimaryProjectForDoc(doc) {
      if (!doc) return null;
      const rels = Store.getRelationsForNode(doc.id);
      const proj = (rels.projects || []).find((x) => x.node?.type === 'para-entity')?.node;
      return proj || null;
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          const idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
        reader.readAsDataURL(file);
      });
    }

    function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('텍스트 읽기 실패'));
        reader.readAsText(file, 'utf-8');
      });
    }

    // ---- Sync Project Risks -> Real Markdown File linked to Project ----
    function syncProjectRiskMarkdownDoc(projectEntity) {
      if (!projectEntity) return null;
      Store.normalizeParaEntityFields(projectEntity);
      const mdText = Store.renderRisksToMarkdown(projectEntity);
      const folder = hooks.getOrCreateDailyMemoFolder();
      let doc = projectEntity.riskDocId ? Store.findNodeAndParent(projectEntity.riskDocId)?.node : null;

      if (!doc) {
        const fileName = hooks.getUniqueNameInFolder(folder, `${projectEntity.name} - 리스크 관리`, '.md');
        doc = Store.touchNode({
          id: Store.genId(),
          type: 'doc',
          name: fileName,
          icon: '⚠️',
          tag: '#리스크 #시나리오',
          customTags: ['리스크', '시나리오'],
          cardRole: 'S',
          cardKind: 'note',
          summary: mdText,
          link: ''
        });
        if (!Array.isArray(folder.children)) folder.children = [];
        folder.children.unshift(doc);
        projectEntity.riskDocId = doc.id;
        Store.persistParaEntities();
        Store.addRelation({ sourceId: doc.id, targetId: projectEntity.id, type: 'project', label: '리스크 관리' });
      } else {
        doc.summary = mdText;
        if (!doc.cardRole) doc.cardRole = 'S';
        Store.touchNode(doc);
      }
      Store.persistFS();
      hooks.syncDocAfterSave?.(doc);
      return doc;
    }

    // ---- Task Completion Modal (Internal Multi-Upload vs External Template MD) ----
    function applyTemplateVars(tplText, doc, projectEntity) {
      const today = hooks.getTodayYMD();
      const title = String(doc?.name || '').replace(/\.md$/i, '');
      const projName = projectEntity ? `${Store.getParaCode(projectEntity)} ${projectEntity.name}` : '미지정';
      return String(tplText || '')
        .replace(/\{\{제목\}\}/g, title)
        .replace(/\{\{날짜\}\}/g, today)
        .replace(/\{\{프로젝트\}\}/g, projName);
    }

    function populateCompletionTemplates(projectEntity) {
      const sel = $('tcm-template-select');
      if (!sel) return;
      const globals = Store.getGlobalTemplates();
      const projTpls = Array.isArray(projectEntity?.templates) ? projectEntity.templates : [];
      let html = `<option value="">-- MD 템플릿 선택 (글로벌 / 프로젝트) --</option>`;
      if (projTpls.length > 0) {
        html += `<optgroup label="프로젝트 전용 (${esc(projectEntity.name)})">`;
        projTpls.forEach((t) => {
          html += `<option value="project::${esc(t.id)}">${esc(t.name)}</option>`;
        });
        html += `</optgroup>`;
      }
      if (globals.length > 0) {
        html += `<optgroup label="글로벌 템플릿">`;
        globals.forEach((t) => {
          html += `<option value="global::${esc(t.id)}">${esc(t.name)}</option>`;
        });
        html += `</optgroup>`;
      }
      sel.innerHTML = html;
    }

    function renderStagedFilesList() {
      const wrap = $('tcm-staged-list');
      if (!wrap) return;
      if (stagedFiles.length === 0) {
        wrap.innerHTML = `<div class="sb-tcm-empty">아직 선택된 산출물 파일이 없습니다. 여러 파일을 한 번에 추가할 수 있습니다.</div>`;
        return;
      }
      wrap.innerHTML = stagedFiles.map((f, idx) => {
        const kb = Math.max(1, Math.round((f.size || 0) / 1024));
        return (
          `<div class="sb-tcm-file-row">` +
          `  <span class="sb-tcm-file-name">${svg('doc', 14)} ${esc(f.name)}</span>` +
          `  <span class="sb-tcm-file-size">${kb} KB</span>` +
          `  <button type="button" class="sb-icon-btn-xs" data-rm-file="${idx}" title="제거">✕</button>` +
          `</div>`
        );
      }).join('');
      wrap.querySelectorAll('[data-rm-file]').forEach((btn) => {
        btn.addEventListener('click', () => {
          stagedFiles.splice(Number(btn.dataset.rmFile), 1);
          renderStagedFilesList();
        });
      });
    }

    function switchCompletionMode(mode) {
      completionMode = mode === 'external' ? 'external' : 'internal';
      $('tcm-tab-internal')?.classList.toggle('active', completionMode === 'internal');
      $('tcm-tab-external')?.classList.toggle('active', completionMode === 'external');
      $('tcm-panel-internal')?.classList.toggle('is-hidden', completionMode !== 'internal');
      $('tcm-panel-external')?.classList.toggle('is-hidden', completionMode !== 'external');
    }

    function bindCompletionModalOnce() {
      const modal = $('task-completion-modal');
      if (!modal || modal.dataset.bound === '1') return;
      modal.dataset.bound = '1';

      const close = () => {
        modal.style.display = 'none';
        completionTargetDoc = null;
        stagedFiles = [];
      };
      $('tcm-close-btn')?.addEventListener('click', close);
      $('tcm-cancel-btn')?.addEventListener('click', close);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      $('tcm-tab-internal')?.addEventListener('click', () => switchCompletionMode('internal'));
      $('tcm-tab-external')?.addEventListener('click', () => switchCompletionMode('external'));

      const fileInp = $('tcm-file-input');
      const dropzone = $('tcm-dropzone');
      $('tcm-pick-files-btn')?.addEventListener('click', () => fileInp?.click());
      fileInp?.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach((f) => stagedFiles.push(f));
        fileInp.value = '';
        renderStagedFilesList();
      });
      dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
      dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const files = Array.from(e.dataTransfer?.files || []);
        files.forEach((f) => stagedFiles.push(f));
        renderStagedFilesList();
      });

      $('tcm-template-select')?.addEventListener('change', (e) => {
        const val = String(e.target.value || '');
        if (!val) return;
        const [scope, tid] = val.split('::');
        const proj = completionProjectId ? Store.findParaEntity(completionProjectId) : getPrimaryProjectForDoc(completionTargetDoc);
        let tpl = null;
        if (scope === 'project' && proj) {
          tpl = (proj.templates || []).find((t) => t.id === tid);
        } else {
          tpl = Store.getGlobalTemplates().find((t) => t.id === tid);
        }
        if (tpl && $('tcm-ext-editor')) {
          $('tcm-ext-editor').value = applyTemplateVars(tpl.content, completionTargetDoc, proj);
          $('tcm-ext-editor').focus();
        }
      });

      $('tcm-save-tpl-btn')?.addEventListener('click', () => {
        const content = String($('tcm-ext-editor')?.value || '').trim();
        if (!content) {
          hooks.showToast('템플릿으로 저장할 마크다운 내용을 먼저 입력해 주세요.');
          return;
        }
        const name = prompt('새 템플릿 이름을 입력하세요:');
        if (!name || !name.trim()) return;
        const proj = completionProjectId ? Store.findParaEntity(completionProjectId) : getPrimaryProjectForDoc(completionTargetDoc);
        const scope = (proj && confirm(`"${proj.name}" 프로젝트 전용 템플릿으로 저장할까요?\n(취소를 누르면 글로벌 템플릿으로 저장됩니다)`))
          ? 'project'
          : 'global';
        if (scope === 'project' && proj) {
          Store.saveProjectTemplate(proj.id, { name: name.trim(), content });
        } else {
          Store.saveGlobalTemplate({ name: name.trim(), content });
        }
        populateCompletionTemplates(proj);
        hooks.showToast(`📝 ${scope === 'project' ? '프로젝트' : '글로벌'} 템플릿 "${name.trim()}" 저장됨`);
      });

      $('tcm-quick-done-btn')?.addEventListener('click', () => {
        if (!completionTargetDoc) return;
        Store.saveStateForUndo();
        completionTargetDoc.completed = true;
        completionTargetDoc.completedAt = Date.now();
        completionTargetDoc.completionMode = 'quick';
        Store.touchNode(completionTargetDoc);
        close();
        hooks.saveAndRender();
        hooks.showToast('✅ 할일이 완료 처리되었습니다.');
      });

      $('tcm-confirm-btn')?.addEventListener('click', async () => {
        if (!completionTargetDoc) return;
        const taskDoc = completionTargetDoc;
        const proj = completionProjectId ? Store.findParaEntity(completionProjectId) : getPrimaryProjectForDoc(taskDoc);
        const folder = hooks.getOrCreateDailyMemoFolder();
        if (!Array.isArray(folder.children)) folder.children = [];

        Store.saveStateForUndo();

        if (completionMode === 'internal') {
          const noteText = String($('tcm-int-note')?.value || '').trim();
          if (stagedFiles.length === 0 && !noteText) {
            hooks.showToast('내부처리 산출물 파일을 1개 이상 업로드하거나 처리 메모를 입력해 주세요.');
            return;
          }

          let createdCnt = 0;
          for (const file of stagedFiles) {
            const lower = String(file.name || '').toLowerCase();
            const isText = /\.(md|txt|csv|json|html?|xml|yml|yaml|js|ts|py|css)$/i.test(lower);
            const isXlsx = /\.(xlsx|xls)$/i.test(lower);
            let summary = `내부처리 산출물 파일: **${file.name}** (${Math.max(1, Math.round((file.size || 0) / 1024))} KB)`;
            let uploadedBlobBase64 = '';
            let sheetData = null;

            try {
              if (isText) {
                summary = await readFileAsText(file);
              } else if (isXlsx && global.BrainSpreadsheet?.importXlsxFileToWorkbook) {
                const wb = await global.BrainSpreadsheet.importXlsxFileToWorkbook(file);
                if (wb) {
                  sheetData = wb;
                  summary = global.BrainSpreadsheet.workbookToMarkdownSummary(wb);
                } else {
                  uploadedBlobBase64 = await readFileAsBase64(file);
                }
              } else {
                uploadedBlobBase64 = await readFileAsBase64(file);
              }
            } catch (_) {
              try { uploadedBlobBase64 = await readFileAsBase64(file); } catch (__) {}
            }

            const dot = file.name.lastIndexOf('.');
            const base = dot > 0 ? file.name.slice(0, dot) : file.name;
            const ext = dot > 0 ? file.name.slice(dot) : '';
            const uniqueName = hooks.getUniqueNameInFolder(folder, base, ext);

            const delivDoc = Store.touchNode({
              id: Store.genId(),
              type: 'doc',
              name: uniqueName,
              icon: isXlsx ? '📊' : (isText ? '📄' : '📎'),
              tag: '#산출물 #내부처리',
              customTags: ['산출물', '내부처리'],
              cardRole: 'R',
              cardKind: 'deliverable',
              parentCardId: taskDoc.id,
              summary,
              link: '',
              sheetData: sheetData || undefined,
              uploadedBlobBase64: uploadedBlobBase64 || undefined,
              uploadedMime: file.type || 'application/octet-stream',
              uploadedSize: file.size || 0
            });
            folder.children.unshift(delivDoc);
            Store.linkSubCard(taskDoc, delivDoc, { inheritPara: true });
            if (proj) {
              Store.addRelation({ sourceId: delivDoc.id, targetId: proj.id, type: 'project', label: '산출물' });
            }
            hooks.syncDocAfterSave?.(delivDoc);
            createdCnt++;
          }

          if (noteText) {
            const cleanTaskTitle = String(taskDoc.name || '할일').replace(/\.md$/i, '');
            const noteFileName = hooks.getUniqueNameInFolder(folder, `${cleanTaskTitle} - 내부처리 기록`, '.md');
            const noteDoc = Store.touchNode({
              id: Store.genId(),
              type: 'doc',
              name: noteFileName,
              icon: '📋',
              tag: '#산출물 #내부처리',
              customTags: ['산출물', '내부처리'],
              cardRole: 'R',
              cardKind: 'deliverable',
              parentCardId: taskDoc.id,
              summary: `# ${cleanTaskTitle} — 내부처리 기록\n\n${noteText}`,
              link: ''
            });
            folder.children.unshift(noteDoc);
            Store.linkSubCard(taskDoc, noteDoc, { inheritPara: true });
            if (proj) {
              Store.addRelation({ sourceId: noteDoc.id, targetId: proj.id, type: 'project', label: '산출물' });
            }
            hooks.syncDocAfterSave?.(noteDoc);
            createdCnt++;
          }

          taskDoc.completed = true;
          taskDoc.completedAt = Date.now();
          taskDoc.completionMode = 'internal';
          expandedCardIds.add(taskDoc.id);
          Store.touchNode(taskDoc);
          close();
          hooks.saveAndRender();
          hooks.showToast(`📦 내부처리 완료! 산출물 ${createdCnt}건이 하위로 연결되었습니다.`);
          return;
        }

        // External processing (Large MD Template Editor)
        const extBody = String($('tcm-ext-editor')?.value || '').trim();
        if (!extBody) {
          hooks.showToast('외부처리 결과 마크다운 내용을 입력해 주세요.');
          $('tcm-ext-editor')?.focus();
          return;
        }
        const cleanTaskTitle = String(taskDoc.name || '할일').replace(/\.md$/i, '');
        const extTitle = String($('tcm-ext-title')?.value || '').trim() || `${cleanTaskTitle} - 외부처리 결과`;
        const fileName = hooks.getUniqueNameInFolder(folder, extTitle, '.md');
        const extDoc = Store.touchNode({
          id: Store.genId(),
          type: 'doc',
          name: fileName,
          icon: '📝',
          tag: '#산출물 #외부처리',
          customTags: ['산출물', '외부처리'],
          cardRole: 'R',
          cardKind: 'deliverable',
          parentCardId: taskDoc.id,
          summary: extBody,
          link: ''
        });
        folder.children.unshift(extDoc);
        Store.linkSubCard(taskDoc, extDoc, { inheritPara: true });
        if (proj) {
          Store.addRelation({ sourceId: extDoc.id, targetId: proj.id, type: 'project', label: '외부처리 결과' });
        }
        hooks.syncDocAfterSave?.(extDoc);

        taskDoc.completed = true;
        taskDoc.completedAt = Date.now();
        taskDoc.completionMode = 'external';
        expandedCardIds.add(taskDoc.id);
        Store.touchNode(taskDoc);
        close();
        hooks.saveAndRender();
        hooks.showToast(`📝 외부처리 완료! 결과 문서("${fileName}")가 하위로 연결되었습니다.`);
      });
    }

    function openTaskCompletionModal(doc, projectId = null) {
      if (!doc) return;
      bindCompletionModalOnce();
      const modal = $('task-completion-modal');
      if (!modal) return;
      completionTargetDoc = doc;
      completionProjectId = projectId || getPrimaryProjectForDoc(doc)?.id || null;
      stagedFiles = [];
      const proj = completionProjectId ? Store.findParaEntity(completionProjectId) : null;
      const cleanName = String(doc.name || '').replace(/\.md$/i, '');

      if ($('tcm-task-title')) $('tcm-task-title').textContent = cleanName;
      if ($('tcm-task-project-badge')) {
        $('tcm-task-project-badge').textContent = proj ? `${Store.getParaCode(proj)} ${proj.name}` : '수신함 (미분류)';
      }
      if ($('tcm-int-note')) $('tcm-int-note').value = '';
      if ($('tcm-ext-title')) $('tcm-ext-title').value = `${cleanName} - 외부처리 결과`;
      if ($('tcm-ext-editor')) {
        const firstTpl = (proj?.templates?.[0]) || Store.getGlobalTemplates()[0];
        $('tcm-ext-editor').value = firstTpl ? applyTemplateVars(firstTpl.content, doc, proj) : `# ${cleanName} 외부처리 결과\n\n`;
      }
      populateCompletionTemplates(proj);
      renderStagedFilesList();
      switchCompletionMode('internal');
      modal.style.display = 'flex';
    }

    // ---- Helper: Create Card / Event inside Project (or as Sub-Card) ----
    function createProjectCard(projectEntity, {
      title = '',
      role = 'T',
      tagsRaw = '',
      startDate = '',
      endDate = '',
      isTodayCore = false,
      parentDoc = null
    }) {
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return null;
      Store.saveStateForUndo();
      const folder = hooks.getOrCreateDailyMemoFolder();
      if (!Array.isArray(folder.children)) folder.children = [];
      const fileName = hooks.getUniqueNameInFolder(folder, cleanTitle, '.md');
      const parsedTags = String(tagsRaw || '')
        .split(/[,\s]+/)
        .map((t) => t.trim().replace(/^#+/, ''))
        .filter(Boolean);
      const roleVal = ['T', 'S', 'R'].includes(role) ? role : 'T';
      const kindVal = roleVal === 'R' ? 'deliverable' : (startDate || endDate ? 'event' : (roleVal === 'T' ? 'task' : 'note'));

      const doc = Store.touchNode({
        id: Store.genId(),
        type: 'doc',
        name: fileName,
        icon: roleVal === 'T' ? '☑️' : (roleVal === 'R' ? '📦' : '📄'),
        tag: parsedTags.map((t) => `#${t}`).join(' ') || (roleVal === 'T' ? '#할일' : (roleVal === 'R' ? '#산출물' : '#자료')),
        customTags: parsedTags,
        cardRole: roleVal,
        cardKind: kindVal,
        isTodayCore: Boolean(isTodayCore),
        completed: false,
        startDate: String(startDate || '').trim(),
        endDate: String(endDate || '').trim(),
        plannedEndDate: String(endDate || '').trim(),
        parentCardId: parentDoc ? parentDoc.id : '',
        summary: `# ${cleanTitle}\n\n`,
        link: ''
      });
      folder.children.unshift(doc);
      if (projectEntity) {
        Store.addRelation({ sourceId: doc.id, targetId: projectEntity.id, type: 'project' });
      }
      if (parentDoc) {
        Store.linkSubCard(parentDoc, doc, { inheritPara: true });
        expandedCardIds.add(parentDoc.id);
      }
      hooks.syncDocAfterSave?.(doc);
      hooks.saveAndRender();
      return doc;
    }

    // ---- Project Detail Workspace Main Renderer ----
    function renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal }) {
      const proj = Store.findParaEntity(projectId);
      if (!proj) {
        onBack?.();
        return;
      }
      Store.normalizeParaEntityFields(proj);
      const code = Store.getParaCode(proj);
      const linkedDocs = Store.getProjectLinkedDocs(proj.id, hooks.isItemVisible);
      const totalTasks = linkedDocs.filter((d) => Store.getCardRole(d) === 'T').length;
      const doneTasks = linkedDocs.filter((d) => Store.getCardRole(d) === 'T' && d.completed).length;
      const datedCount = linkedDocs.filter((d) => d.startDate && d.endDate).length;
      const riskA = (proj.risks || []).filter((r) => r.level === 'A' && r.status !== 'resolved').length;
      const isHold = proj.status === 'hold';

      canvas.innerHTML = `
        <header class="sb-pd-header">
          <div class="sb-pd-header-left">
            <button type="button" class="sb-btn-subtle" id="sb-pd-back-btn">← 프로젝트 목록</button>
            <div class="sb-pd-title-row">
              <span class="sb-code-pill">${esc(code)}</span>
              <h1 class="sb-page-title">${esc(proj.name)}</h1>
              <span class="sb-status-pill ${isHold ? 'is-hold' : 'is-active'}">${proj.archived ? '보관됨' : (isHold ? '보류' : '진행')}</span>
              ${proj.dueDate ? `<span class="sb-dday-pill">마감 ${esc(proj.dueDate)}</span>` : ''}
            </div>
            <p class="sb-page-sub">
              ${esc(proj.summary || '프로젝트 내부 카드(상위/하위 계층 · 할일/자료/산출물), 간트차트, 리스크(A/B/C), 템플릿을 한 곳에서 관리합니다.')}
              · 로컬 미러 폴더: <code>SB/${esc(Store.getSbFolderName(proj))}/</code>
            </p>
          </div>
          <div class="sb-pd-header-actions">
            <button type="button" class="sb-btn-subtle" id="sb-pd-edit-btn">속성 편집</button>
            ${!proj.archived ? `<button type="button" class="sb-btn-primary-sm" id="sb-pd-archive-btn">완료 → 보관</button>` : ''}
          </div>
        </header>

        <div class="sb-pd-summary-strip">
          <div class="sb-pd-mini-stat"><span>전체 카드</span><strong>${linkedDocs.length}</strong></div>
          <div class="sb-pd-mini-stat"><span>할일 완료</span><strong>${doneTasks} / ${totalTasks}</strong></div>
          <div class="sb-pd-mini-stat"><span>일정 이벤트</span><strong>${datedCount}건</strong></div>
          <div class="sb-pd-mini-stat ${riskA > 0 ? 'is-danger' : ''}"><span>고위험(A) 리스크</span><strong>${riskA}건</strong></div>
          <div class="sb-pd-mini-stat sb-pd-prog-stat">
            <span>진행도 ${proj.progress}%</span>
            <div class="sb-prog-track"><div class="sb-prog-fill" style="width:${proj.progress}%"></div></div>
          </div>
        </div>

        <section class="sb-card sb-pd-main-card">
          <div class="sb-subtabs" id="sb-pd-tabs">
            <button type="button" class="sb-subtab${detailTab === 'cards' ? ' active' : ''}" data-pd-tab="cards">구성 · 카드 트리 (${linkedDocs.length})</button>
            <button type="button" class="sb-subtab${detailTab === 'gantt' ? ' active' : ''}" data-pd-tab="gantt">간트차트 (${datedCount})</button>
            <button type="button" class="sb-subtab${detailTab === 'risks' ? ' active' : ''}" data-pd-tab="risks">리스크 관리 A/B/C (${(proj.risks || []).length})</button>
            <button type="button" class="sb-subtab${detailTab === 'templates' ? ' active' : ''}" data-pd-tab="templates">MD 템플릿 (${(proj.templates || []).length + Store.getGlobalTemplates().length})</button>
          </div>
          <div id="sb-pd-tab-body"></div>
        </section>
      `;

      $('sb-pd-back-btn')?.addEventListener('click', () => onBack?.());
      $('sb-pd-edit-btn')?.addEventListener('click', () => onOpenProjectModal?.(proj));
      $('sb-pd-archive-btn')?.addEventListener('click', () => {
        Store.completeAndArchiveProject(proj.id);
        hooks.saveAndRender();
        hooks.showToast(`"${proj.name}" 완료 후 보관함으로 이동했습니다.`);
        onBack?.();
      });

      canvas.querySelectorAll('[data-pd-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          detailTab = btn.dataset.pdTab || 'cards';
          renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal });
        });
      });

      const body = $('sb-pd-tab-body');
      if (detailTab === 'cards') {
        renderProjectCardsTab(body, proj, linkedDocs, () => renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal }));
      } else if (detailTab === 'gantt') {
        renderProjectGanttTab(body, proj, linkedDocs, () => renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal }));
      } else if (detailTab === 'risks') {
        renderProjectRisksTab(body, proj, () => renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal }));
      } else {
        renderProjectTemplatesTab(body, proj, () => renderProjectDetailView(canvas, projectId, { onBack, onOpenProjectModal }));
      }
    }

    // ---- Tab 1: Project Structure & Hierarchical Cards Tree ----
    function renderProjectCardsTab(container, proj, linkedDocs, rerender) {
      // Collect all custom tags inside this project
      const allTagsSet = new Set();
      linkedDocs.forEach((d) => Store.getCardTags(d).forEach((t) => allTagsSet.add(t)));
      const allTags = Array.from(allTagsSet);

      const matchesFilter = (doc) => {
        const role = Store.getCardRole(doc);
        if (cardRoleFilter === 'T' && role !== 'T') return false;
        if (cardRoleFilter === 'S' && role !== 'S') return false;
        if (cardRoleFilter === 'R' && role !== 'R') return false;
        if (cardRoleFilter === 'open' && doc.completed) return false;
        if (cardRoleFilter === 'done' && !doc.completed) return false;
        if (cardTagFilter && !Store.getCardTags(doc).includes(cardTagFilter)) return false;
        return true;
      };

      const linkedIdSet = new Set(linkedDocs.map((d) => d.id));
      // Build parent -> children map among project docs
      const childrenByParent = new Map();
      const hasParentInProject = new Set();

      linkedDocs.forEach((d) => {
        const kids = Store.getSubCards(d.id, hooks.isItemVisible).filter((k) => linkedIdSet.has(k.id));
        if (kids.length > 0) {
          childrenByParent.set(d.id, kids);
          kids.forEach((k) => hasParentInProject.add(k.id));
        }
      });

      const hasMatchingDescendant = (docId, visited = new Set()) => {
        if (visited.has(docId)) return false;
        visited.add(docId);
        const kids = childrenByParent.get(docId) || [];
        return kids.some((k) => matchesFilter(k) || hasMatchingDescendant(k.id, visited));
      };

      const rootDocs = linkedDocs.filter((d) => !hasParentInProject.has(d.id));
      const visibleRoots = rootDocs.filter((d) => matchesFilter(d) || hasMatchingDescendant(d.id));

      const renderNodeRecursive = (doc, depth = 0, visited = new Set()) => {
        if (visited.has(doc.id)) return '';
        const nextVisited = new Set(visited);
        nextVisited.add(doc.id);

        const role = Store.getCardRole(doc);
        const rMeta = getRoleMeta(role);
        const kids = (childrenByParent.get(doc.id) || []).filter((k) => matchesFilter(k) || hasMatchingDescendant(k.id));
        const allKids = childrenByParent.get(doc.id) || [];
        const hasKids = allKids.length > 0;
        const isExpanded = expandedCardIds.has(doc.id) || Boolean(cardTagFilter) || cardRoleFilter !== 'all';
        const tags = Store.getCardTags(doc);
        const delayed = isCardDelayed(doc);
        const extended = isCardExtended(doc);
        const cleanTitle = String(doc.name || '').replace(/\.md$/i, '');
        const periodHtml = (doc.startDate && doc.endDate)
          ? `<span class="sb-period-pill${delayed ? ' is-delayed' : (extended ? ' is-extended' : '')}">${formatShortDate(doc.startDate)}~${formatShortDate(doc.endDate)}${delayed ? ' 지연' : ''}</span>`
          : '';
        const compBadge = doc.completed
          ? `<span class="sb-comp-badge">${doc.completionMode === 'internal' ? '내부완료' : (doc.completionMode === 'external' ? '외부완료' : '완료')}</span>`
          : '';

        let html = `
          <div class="sb-tree-card-row${depth > 0 ? ' is-subcard' : ''}${doc.completed ? ' is-done' : ''}" data-doc-id="${esc(doc.id)}" style="margin-left:${Math.min(depth, 4) * 24}px">
            <div class="sb-tc-left">
              ${depth > 0 ? `<span class="sb-sub-arrow">↳</span>` : ''}
              ${hasKids
                ? `<button type="button" class="sb-tree-toggle" data-act="toggle-sub" title="${isExpanded ? '하위 접기' : '하위 펼치기'}">${isExpanded ? '−' : '+'}</button>`
                : `<span class="sb-tree-toggle-spacer"></span>`}
              <button type="button" class="sb-checkbox-box${doc.completed ? ' is-checked' : ''}" data-act="complete" title="${doc.completed ? '완료 취소' : '완료 처리 (내부/외부처리)'}">${doc.completed ? svg('check', 11) : ''}</button>
              <button type="button" class="sb-role-pill ${rMeta.cls}" data-act="cycle-role" title="${esc(rMeta.title)}">${rMeta.code} ${rMeta.label}</button>
              <button type="button" class="sb-tc-title" data-act="open">${esc(cleanTitle)}</button>
              ${compBadge}
              ${periodHtml}
              ${tags.slice(0, 4).map((t) => `<span class="sb-tag-chip" data-tag-click="${esc(t)}">#${esc(t)}</span>`).join('')}
            </div>
            <div class="sb-tc-actions">
              <button type="button" class="sb-core-star-btn${doc.isTodayCore ? ' is-active' : ''}" data-act="toggle-core" title="오늘의 핵심에 올리기/빼기">${doc.isTodayCore ? '★ 핵심' : '☆ 핵심'}</button>
              <button type="button" class="sb-mini-ghost" data-act="add-sub" title="하위 카드 추가">+ 하위</button>
              <button type="button" class="sb-mini-ghost" data-act="edit-tags" title="태그 편집">#태그</button>
              ${role === 'T' && !doc.completed ? `<button type="button" class="sb-mini-accent" data-act="complete">완료처리</button>` : ''}
            </div>
          </div>
        `;

        if (inlineSubParentId === doc.id) {
          html += `
            <form class="sb-inline-sub-form" data-sub-parent="${esc(doc.id)}" style="margin-left:${(Math.min(depth, 4) + 1) * 24}px">
              <span class="sb-sub-arrow">↳</span>
              <input type="text" class="sb-field-input sb-sub-title-inp" placeholder="하위 카드 이름 입력..." required>
              <select class="sb-field-select sb-sub-role-sel">
                <option value="T">T 할일</option>
                <option value="S">S 자료</option>
                <option value="R">R 산출물</option>
              </select>
              <label class="sb-check-inline"><input type="checkbox" class="sb-sub-core-chk"><span>핵심</span></label>
              <button type="submit" class="sb-btn-primary-sm">추가</button>
              <button type="button" class="sb-btn-subtle" data-cancel-sub="1">취소</button>
            </form>
          `;
        }

        if (hasKids && isExpanded) {
          const toShow = (cardTagFilter || cardRoleFilter !== 'all') ? kids : allKids;
          toShow.forEach((child) => {
            html += renderNodeRecursive(child, depth + 1, nextVisited);
          });
        }
        return html;
      };

      container.innerHTML = `
        <div class="sb-pd-filter-bar">
          <div class="sb-filter-group">
            ${[
              { k: 'all', lbl: '전체' },
              { k: 'T', lbl: 'T 할일' },
              { k: 'S', lbl: 'S 자료' },
              { k: 'R', lbl: 'R 산출물' },
              { k: 'open', lbl: '미완료' },
              { k: 'done', lbl: '완료' }
            ].map((f) => `<button type="button" class="sb-filter-chip${cardRoleFilter === f.k ? ' active' : ''}" data-role-filter="${f.k}">${f.lbl}</button>`).join('')}
          </div>
          ${allTags.length > 0 ? `
            <div class="sb-filter-group sb-tag-filter-row">
              <span class="sb-filter-lbl">태그:</span>
              <button type="button" class="sb-filter-chip${!cardTagFilter ? ' active' : ''}" data-tag-filter="">전체</button>
              ${allTags.map((t) => `<button type="button" class="sb-filter-chip${cardTagFilter === t ? ' active' : ''}" data-tag-filter="${esc(t)}">#${esc(t)}</button>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="sb-pd-tree-list">
          ${visibleRoots.length > 0
            ? visibleRoots.map((d) => renderNodeRecursive(d, 0)).join('')
            : `<div class="sb-empty-line"><span>조건에 맞는 프로젝트 카드가 없어요. 아래 입력란에서 첫 할일·자료·이벤트를 추가해 보세요.</span></div>`}
        </div>

        <!-- Bottom Quick Add Event / Task / Source with Optional Duration -->
        <form class="sb-pd-add-event-box" id="sb-pd-add-card-form">
          <div class="sb-pd-add-head">＋ 프로젝트 세부 이벤트 · 할일 · 자료 추가 (기간 입력 시 간트차트에 자동 반영)</div>
          <div class="sb-pd-add-grid">
            <input type="text" id="sb-pd-new-title" class="sb-field-input" placeholder="제목 (예: 와이어프레임 설계, API 연동 테스트...)" required>
            <select id="sb-pd-new-role" class="sb-field-select">
              <option value="T">T 할일 (Todo)</option>
              <option value="S">S 자료 (Source)</option>
              <option value="R">R 산출물 (Result)</option>
            </select>
            <input type="text" id="sb-pd-new-tags" class="sb-field-input" placeholder="태그 (예: 설계, 절차, 검토)">
          </div>
          <div class="sb-pd-add-grid-2">
            <label class="sb-date-field"><span>시작일</span><input type="date" id="sb-pd-new-start" class="sb-field-input"></label>
            <label class="sb-date-field"><span>종료일</span><input type="date" id="sb-pd-new-end" class="sb-field-input"></label>
            <label class="sb-check-inline"><input type="checkbox" id="sb-pd-new-core"><span>오늘의 핵심에 올리기</span></label>
            <button type="submit" class="sb-btn-primary-sm">＋ 카드/이벤트 추가</button>
          </div>
        </form>
      `;

      // Bind Filters
      container.querySelectorAll('[data-role-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          cardRoleFilter = btn.dataset.roleFilter || 'all';
          rerender();
        });
      });
      container.querySelectorAll('[data-tag-filter], [data-tag-click]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          cardTagFilter = btn.dataset.tagFilter ?? btn.dataset.tagClick ?? '';
          rerender();
        });
      });

      // Bind Card Row Actions
      container.querySelectorAll('.sb-tree-card-row[data-doc-id]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.docId)?.node;
        if (!doc) return;

        row.querySelector('[data-act="toggle-sub"]')?.addEventListener('click', () => {
          if (expandedCardIds.has(doc.id)) expandedCardIds.delete(doc.id);
          else expandedCardIds.add(doc.id);
          rerender();
        });

        row.querySelector('[data-act="open"]')?.addEventListener('click', () => hooks.launchItemDirectly(doc));

        row.querySelector('[data-act="cycle-role"]')?.addEventListener('click', () => {
          const next = nextRoleCode(Store.getCardRole(doc));
          Store.setCardRole(doc, next);
          hooks.saveAndRender();
          hooks.showToast(`자료형태가 ${next}(${getRoleMeta(next).label})로 변경되었습니다. (SB 폴더명 자동 갱신)`);
          rerender();
        });

        row.querySelector('[data-act="toggle-core"]')?.addEventListener('click', () => {
          const next = !doc.isTodayCore;
          Store.setCardTodayCore(doc, next);
          hooks.saveAndRender();
          hooks.showToast(next ? '★ 오늘의 핵심에 올렸습니다.' : '오늘의 핵심에서 내렸습니다. (완료 처리 안 됨)');
          rerender();
        });

        row.querySelector('[data-act="add-sub"]')?.addEventListener('click', () => {
          inlineSubParentId = inlineSubParentId === doc.id ? null : doc.id;
          expandedCardIds.add(doc.id);
          rerender();
          container.querySelector('.sb-sub-title-inp')?.focus();
        });

        row.querySelector('[data-act="edit-tags"]')?.addEventListener('click', () => {
          const cur = Store.getCardTags(doc).join(', ');
          const next = prompt('쉼표 또는 공백으로 구분된 태그를 입력하세요 (예: 절차, 설계, 검토):', cur);
          if (next === null) return;
          Store.setCardTags(doc, next);
          hooks.saveAndRender();
          rerender();
        });

        row.querySelectorAll('[data-act="complete"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (doc.completed) {
              doc.completed = false;
              doc.completedAt = 0;
              Store.touchNode(doc);
              hooks.saveAndRender();
              rerender();
            } else if (Store.getCardRole(doc) === 'T') {
              openTaskCompletionModal(doc, proj.id);
            } else {
              doc.completed = true;
              doc.completedAt = Date.now();
              Store.touchNode(doc);
              hooks.saveAndRender();
              rerender();
            }
          });
        });
      });

      // Bind inline sub-card form
      container.querySelector('.sb-inline-sub-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const parentDoc = Store.findNodeAndParent(form.dataset.subParent)?.node;
        const title = form.querySelector('.sb-sub-title-inp')?.value || '';
        const role = form.querySelector('.sb-sub-role-sel')?.value || 'T';
        const isCore = Boolean(form.querySelector('.sb-sub-core-chk')?.checked);
        if (!parentDoc || !title.trim()) return;
        inlineSubParentId = null;
        createProjectCard(proj, { title, role, isTodayCore: isCore, parentDoc });
        hooks.showToast(`↳ 하위 카드 "${title.trim()}" 추가됨`);
        rerender();
      });
      container.querySelector('[data-cancel-sub]')?.addEventListener('click', () => {
        inlineSubParentId = null;
        rerender();
      });

      // Bind bottom quick-add card/event form
      $('sb-pd-add-card-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = $('sb-pd-new-title')?.value || '';
        const role = $('sb-pd-new-role')?.value || 'T';
        const tagsRaw = $('sb-pd-new-tags')?.value || '';
        const startDate = $('sb-pd-new-start')?.value || '';
        const endDate = $('sb-pd-new-end')?.value || '';
        const isTodayCore = Boolean($('sb-pd-new-core')?.checked);
        if (!title.trim()) return;
        if (startDate && endDate && endDate < startDate) {
          hooks.showToast('종료일은 시작일 이후여야 합니다.');
          return;
        }
        createProjectCard(proj, { title, role, tagsRaw, startDate, endDate, isTodayCore });
        hooks.showToast(`"${title.trim()}" 추가되었습니다.`);
        rerender();
      });
    }

    // ---- Tab 2: Interactive Gantt Chart + Delay Color & Period Reschedule ----
    function renderProjectGanttTab(container, proj, linkedDocs, rerender) {
      const todayYmd = getTodayYmd();
      const todayMs = parseYmdToDayMs(todayYmd);
      const datedDocs = linkedDocs
        .filter((d) => d.startDate && d.endDate && parseYmdToDayMs(d.startDate) !== null && parseYmdToDayMs(d.endDate) !== null)
        .sort((a, b) => parseYmdToDayMs(a.startDate) - parseYmdToDayMs(b.startDate));

      let minMs = todayMs - 2 * 86400000;
      let maxMs = todayMs + 14 * 86400000;
      datedDocs.forEach((d) => {
        const s = parseYmdToDayMs(d.startDate);
        const e = parseYmdToDayMs(d.endDate);
        const pe = parseYmdToDayMs(d.plannedEndDate);
        if (s < minMs) minMs = s - 86400000;
        if (e > maxMs) maxMs = e + 2 * 86400000;
        if (pe && pe > maxMs) maxMs = pe + 2 * 86400000;
      });
      const totalDays = Math.max(10, Math.round((maxMs - minMs) / 86400000) + 1);
      const todayPct = Math.max(0, Math.min(100, ((todayMs - minMs) / (totalDays * 86400000)) * 100));

      // Generate ~6 evenly spaced axis labels
      const tickCount = Math.min(8, totalDays);
      const ticksHtml = Array.from({ length: tickCount }).map((_, i) => {
        const ratio = i / Math.max(1, tickCount - 1);
        const tickMs = minMs + Math.round(ratio * (totalDays - 1)) * 86400000;
        return `<span class="sb-gantt-tick">${formatShortDate(formatDayMsToYmd(tickMs))}</span>`;
      }).join('');

      const rowsHtml = datedDocs.map((d) => {
        const sMs = parseYmdToDayMs(d.startDate);
        const eMs = parseYmdToDayMs(d.endDate);
        const leftPct = Math.max(0, ((sMs - minMs) / (totalDays * 86400000)) * 100);
        const widthPct = Math.max(3, (((eMs - sMs) + 86400000) / (totalDays * 86400000)) * 100);
        const delayed = isCardDelayed(d);
        const extended = isCardExtended(d);
        const barCls = d.completed
          ? 'is-done'
          : (delayed ? 'is-delayed' : (extended ? 'is-extended' : 'is-normal'));
        const statusTag = d.completed
          ? '완료'
          : (delayed ? '지연됨' : (extended ? '기간 연장됨' : '정상'));
        const cleanTitle = String(d.name || '').replace(/\.md$/i, '');
        const isEditing = editingGanttDocId === d.id;

        let plannedMarkerHtml = '';
        if (extended && d.plannedEndDate) {
          const pMs = parseYmdToDayMs(d.plannedEndDate);
          const pPct = Math.max(0, Math.min(100, (((pMs - minMs) + 86400000) / (totalDays * 86400000)) * 100));
          plannedMarkerHtml = `<div class="sb-gantt-planned-mark" style="left:${pPct}%" title="원래 계획 종료일: ${esc(d.plannedEndDate)}"></div>`;
        }

        return `
          <div class="sb-gantt-row" data-gdoc-id="${esc(d.id)}">
            <div class="sb-gantt-label">
              <div class="sb-gantt-label-top">
                <button type="button" class="sb-tc-title" data-gact="open">${esc(cleanTitle)}</button>
                <span class="sb-gantt-status-pill ${barCls}">${statusTag}</span>
              </div>
              <div class="sb-gantt-label-sub">
                <span>${esc(d.startDate)} ~ ${esc(d.endDate)}</span>
                <button type="button" class="sb-empty-cta" data-gact="edit-period">기간 수정</button>
              </div>
            </div>
            <div class="sb-gantt-track" data-gact="edit-period" title="클릭하여 기간 수정">
              <div class="sb-gantt-today-line" style="left:${todayPct}%"></div>
              ${plannedMarkerHtml}
              <div class="sb-gantt-bar ${barCls}" style="left:${leftPct}%; width:${Math.min(100 - leftPct, widthPct)}%;">
                <span>${formatShortDate(d.startDate)}~${formatShortDate(d.endDate)}</span>
              </div>
            </div>
          </div>
          ${isEditing ? `
            <form class="sb-gantt-edit-strip" data-gedit-id="${esc(d.id)}">
              <span class="sb-gantt-edit-name">${esc(cleanTitle)} 기간 조정:</span>
              <input type="date" class="sb-field-input sb-ge-start" value="${esc(d.startDate)}" required>
              <span>~</span>
              <input type="date" class="sb-field-input sb-ge-end" value="${esc(d.endDate)}" required>
              <button type="button" class="sb-btn-subtle" data-ge-extend="3">+3일 연장</button>
              <button type="button" class="sb-btn-subtle" data-ge-extend="7">+7일 연장</button>
              <button type="submit" class="sb-btn-primary-sm">저장</button>
              <button type="button" class="sb-btn-subtle" data-ge-cancel="1">취소</button>
            </form>
          ` : ''}
        `;
      }).join('');

      container.innerHTML = `
        <div class="sb-gantt-legend">
          <span class="sb-legend-item"><i class="sb-lg-dot is-normal"></i>정상 진행</span>
          <span class="sb-legend-item"><i class="sb-lg-dot is-delayed"></i>마감 지연 (기간 수정 필요)</span>
          <span class="sb-legend-item"><i class="sb-lg-dot is-extended"></i>기간 연장됨 (원래 계획 대비)</span>
          <span class="sb-legend-item"><i class="sb-lg-dot is-done"></i>완료</span>
          <span class="sb-legend-item"><i class="sb-lg-today"></i>오늘 (${todayYmd})</span>
        </div>

        ${datedDocs.length > 0 ? `
          <div class="sb-gantt-board">
            <div class="sb-gantt-head">
              <div class="sb-gantt-head-left">세부 이벤트 / 할일</div>
              <div class="sb-gantt-head-axis">${ticksHtml}</div>
            </div>
            ${rowsHtml}
          </div>
        ` : `<div class="sb-empty-line"><span>아직 기간이 입력된 세부 이벤트가 없습니다. 아래에서 기간과 함께 이벤트를 등록하면 간트차트가 표시됩니다.</span></div>`}

        <form class="sb-pd-add-event-box" id="sb-gantt-add-form">
          <div class="sb-pd-add-head">＋ 간트차트 세부 이벤트 / 일정 추가</div>
          <div class="sb-pd-add-grid-2">
            <input type="text" id="sb-ge-new-title" class="sb-field-input" placeholder="세부 이벤트 / 할일 이름" required>
            <label class="sb-date-field"><span>시작일</span><input type="date" id="sb-ge-new-start" class="sb-field-input" value="${todayYmd}" required></label>
            <label class="sb-date-field"><span>종료일</span><input type="date" id="sb-ge-new-end" class="sb-field-input" value="${addDaysYmd(todayYmd, 5)}" required></label>
            <button type="submit" class="sb-btn-primary-sm">＋ 일정 등록</button>
          </div>
        </form>
      `;

      container.querySelectorAll('.sb-gantt-row[data-gdoc-id]').forEach((row) => {
        const doc = Store.findNodeAndParent(row.dataset.gdocId)?.node;
        if (!doc) return;
        row.querySelector('[data-gact="open"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          hooks.launchItemDirectly(doc);
        });
        row.querySelectorAll('[data-gact="edit-period"]').forEach((el) => {
          el.addEventListener('click', () => {
            editingGanttDocId = editingGanttDocId === doc.id ? null : doc.id;
            rerender();
          });
        });
      });

      const editForm = container.querySelector('.sb-gantt-edit-strip');
      if (editForm) {
        const doc = Store.findNodeAndParent(editForm.dataset.geditId)?.node;
        editForm.querySelectorAll('[data-ge-extend]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const days = Number(btn.dataset.geExtend || 3);
            const endInp = editForm.querySelector('.sb-ge-end');
            if (endInp) endInp.value = addDaysYmd(endInp.value || todayYmd, days);
          });
        });
        editForm.querySelector('[data-ge-cancel]')?.addEventListener('click', () => {
          editingGanttDocId = null;
          rerender();
        });
        editForm.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!doc) return;
          const s = editForm.querySelector('.sb-ge-start')?.value || '';
          const en = editForm.querySelector('.sb-ge-end')?.value || '';
          if (!s || !en || en < s) {
            hooks.showToast('종료일은 시작일 이후여야 합니다.');
            return;
          }
          Store.updateCardSchedule(doc, { startDate: s, endDate: en, preservePlannedEnd: true });
          editingGanttDocId = null;
          hooks.saveAndRender();
          hooks.showToast('📅 기간이 수정되어 간트차트에 반영되었습니다.');
          rerender();
        });
      }

      $('sb-gantt-add-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = $('sb-ge-new-title')?.value || '';
        const startDate = $('sb-ge-new-start')?.value || '';
        const endDate = $('sb-ge-new-end')?.value || '';
        if (!title.trim() || !startDate || !endDate || endDate < startDate) {
          hooks.showToast('제목과 올바른 시작일~종료일을 입력해 주세요.');
          return;
        }
        createProjectCard(proj, { title, role: 'T', tagsRaw: '일정', startDate, endDate });
        hooks.showToast(`📅 이벤트 "${title.trim()}" 간트차트에 추가됨`);
        rerender();
      });
    }

    // ---- Tab 3: Project Risk Management (A/B/C Scenarios + Auto MD File) ----
    function renderProjectRisksTab(container, proj, rerender) {
      const risks = Array.isArray(proj.risks) ? proj.risks : [];
      const cntA = risks.filter((r) => r.level === 'A').length;
      const cntB = risks.filter((r) => r.level === 'B').length;
      const cntC = risks.filter((r) => r.level === 'C').length;
      const filtered = riskLevelFilter === 'all' ? risks : risks.filter((r) => r.level === riskLevelFilter);
      const sorted = [...filtered].sort((a, b) => 'ABC'.indexOf(a.level) - 'ABC'.indexOf(b.level));

      container.innerHTML = `
        <div class="sb-risk-topbar">
          <div class="sb-filter-group">
            <button type="button" class="sb-filter-chip${riskLevelFilter === 'all' ? ' active' : ''}" data-rlv="all">전체 (${risks.length})</button>
            <button type="button" class="sb-filter-chip is-risk-a${riskLevelFilter === 'A' ? ' active' : ''}" data-rlv="A">A등급 고위험 (${cntA})</button>
            <button type="button" class="sb-filter-chip is-risk-b${riskLevelFilter === 'B' ? ' active' : ''}" data-rlv="B">B등급 중위험 (${cntB})</button>
            <button type="button" class="sb-filter-chip is-risk-c${riskLevelFilter === 'C' ? ' active' : ''}" data-rlv="C">C등급 저위험 (${cntC})</button>
          </div>
          <button type="button" class="sb-btn-subtle" id="sb-open-risk-md-btn">${svg('doc', 14)} 리스크 MD 문서 열기</button>
        </div>

        <form class="sb-risk-form" id="sb-add-risk-form">
          <div class="sb-risk-form-grid">
            <input type="text" id="sb-risk-scenario" class="sb-field-input" placeholder="예상 시나리오 (예: 외부 API 응답 지연)" required>
            <select id="sb-risk-level" class="sb-field-select">
              <option value="A">A등급 — 고위험 (즉시 대응)</option>
              <option value="B" selected>B등급 — 중위험 (계획 필요)</option>
              <option value="C">C등급 — 저위험 (모니터링)</option>
            </select>
          </div>
          <div class="sb-risk-form-grid-2">
            <input type="text" id="sb-risk-desc" class="sb-field-input" placeholder="예상되는 리스크 영향 (예: 배포 일정 3일 이상 지연)" required>
            <input type="text" id="sb-risk-mitigation" class="sb-field-input" placeholder="대응 방안 / 플랜 B (예: 로컬 캐시 폴백 전환)">
            <button type="submit" class="sb-btn-primary-sm">＋ 리스크 등록 (MD 반영)</button>
          </div>
        </form>

        <div class="sb-risk-list">
          ${sorted.length > 0 ? sorted.map((r) => `
            <div class="sb-risk-card is-lv-${esc(r.level.toLowerCase())}" data-risk-id="${esc(r.id)}">
              <div class="sb-risk-card-head">
                <span class="sb-risk-grade-badge is-lv-${esc(r.level.toLowerCase())}">${esc(r.level)}등급</span>
                <strong class="sb-risk-scenario">${esc(r.scenario)}</strong>
                <div class="sb-risk-card-controls">
                  <select class="sb-field-select sb-risk-lv-sel" title="리스크 등급 변경">
                    <option value="A"${r.level === 'A' ? ' selected' : ''}>A등급</option>
                    <option value="B"${r.level === 'B' ? ' selected' : ''}>B등급</option>
                    <option value="C"${r.level === 'C' ? ' selected' : ''}>C등급</option>
                  </select>
                  <select class="sb-field-select sb-risk-st-sel" title="대응 상태 변경">
                    <option value="monitoring"${r.status === 'monitoring' ? ' selected' : ''}>모니터링</option>
                    <option value="mitigating"${r.status === 'mitigating' ? ' selected' : ''}>대응 중</option>
                    <option value="resolved"${r.status === 'resolved' ? ' selected' : ''}>해소됨</option>
                  </select>
                  <button type="button" class="sb-icon-btn-xs" data-risk-del="1" title="삭제">✕</button>
                </div>
              </div>
              <div class="sb-risk-body">
                <div><span class="sb-risk-lbl">예상 리스크:</span> ${esc(r.risk)}</div>
                ${r.mitigation ? `<div><span class="sb-risk-lbl">대응 방안:</span> ${esc(r.mitigation)}</div>` : ''}
              </div>
            </div>
          `).join('') : `<div class="sb-empty-line"><span>등록된 예상 리스크가 없습니다. 시나리오별 리스크를 A/B/C 등급으로 등록하면 마크다운(.md)으로 자동 관리됩니다.</span></div>`}
        </div>
      `;

      container.querySelectorAll('[data-rlv]').forEach((btn) => {
        btn.addEventListener('click', () => {
          riskLevelFilter = btn.dataset.rlv || 'all';
          rerender();
        });
      });

      $('sb-open-risk-md-btn')?.addEventListener('click', () => {
        const doc = syncProjectRiskMarkdownDoc(proj);
        hooks.saveAndRender();
        if (doc) hooks.launchItemDirectly(doc);
      });

      $('sb-add-risk-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const scenario = $('sb-risk-scenario')?.value || '';
        const risk = $('sb-risk-desc')?.value || '';
        const level = $('sb-risk-level')?.value || 'B';
        const mitigation = $('sb-risk-mitigation')?.value || '';
        if (!scenario.trim() || !risk.trim()) return;
        Store.addProjectRisk(proj.id, { scenario, risk, level, mitigation });
        syncProjectRiskMarkdownDoc(proj);
        hooks.saveAndRender();
        hooks.showToast(`⚠️ ${level}등급 리스크가 등록되고 MD 문서에 동기화되었습니다.`);
        rerender();
      });

      container.querySelectorAll('.sb-risk-card[data-risk-id]').forEach((card) => {
        const rid = card.dataset.riskId;
        card.querySelector('.sb-risk-lv-sel')?.addEventListener('change', (e) => {
          Store.updateProjectRisk(proj.id, rid, { level: e.target.value });
          syncProjectRiskMarkdownDoc(proj);
          hooks.saveAndRender();
          rerender();
        });
        card.querySelector('.sb-risk-st-sel')?.addEventListener('change', (e) => {
          Store.updateProjectRisk(proj.id, rid, { status: e.target.value });
          syncProjectRiskMarkdownDoc(proj);
          hooks.saveAndRender();
          rerender();
        });
        card.querySelector('[data-risk-del]')?.addEventListener('click', () => {
          Store.deleteProjectRisk(proj.id, rid);
          syncProjectRiskMarkdownDoc(proj);
          hooks.saveAndRender();
          rerender();
        });
      });
    }

    // ---- Tab 4: Global & Project MD Template Manager ----
    function renderProjectTemplatesTab(container, proj, rerender) {
      const globals = Store.getGlobalTemplates();
      const projTpls = Array.isArray(proj.templates) ? proj.templates : [];

      const renderTplList = (list, scope) => {
        if (list.length === 0) {
          return `<div class="sb-empty-line"><span>등록된 ${scope === 'project' ? '프로젝트 전용' : '글로벌'} 템플릿이 없습니다.</span></div>`;
        }
        return list.map((t) => `
          <div class="sb-tpl-card" data-tpl-scope="${scope}" data-tpl-id="${esc(t.id)}">
            <div class="sb-tpl-card-head">
              <strong>${esc(t.name)}</strong>
              <button type="button" class="sb-icon-btn-xs" data-tpl-del="1" title="삭제">✕</button>
            </div>
            <pre class="sb-tpl-preview">${esc(String(t.content || '').slice(0, 220))}</pre>
          </div>
        `).join('');
      };

      container.innerHTML = `
        <form class="sb-tpl-form" id="sb-add-tpl-form">
          <div class="sb-pd-add-head">＋ 새 외부처리 MD 템플릿 추가 (변수: <code>{{제목}}</code>, <code>{{날짜}}</code>, <code>{{프로젝트}}</code>)</div>
          <div class="sb-risk-form-grid">
            <input type="text" id="sb-tpl-name" class="sb-field-input" placeholder="템플릿 이름 (예: 주간 고객사 메일 회신 양식)" required>
            <select id="sb-tpl-scope" class="sb-field-select">
              <option value="project">이 프로젝트 전용 (${esc(proj.name)})</option>
              <option value="global">글로벌 템플릿 (모든 프로젝트 공용)</option>
            </select>
          </div>
          <textarea id="sb-tpl-content" rows="5" class="sb-field-textarea" placeholder="# {{제목}}&#10;&#10;- 날짜: {{날짜}}&#10;- 프로젝트: {{프로젝트}}&#10;&#10;## 처리 내용&#10;- " required></textarea>
          <div class="sb-qm-foot">
            <span class="sb-page-sub" style="margin:0;">할일 완료 시 [외부처리] 메모장에서 바로 선택해 사용할 수 있습니다.</span>
            <button type="submit" class="sb-btn-primary-sm">＋ 템플릿 저장</button>
          </div>
        </form>

        <div class="sb-tpl-columns">
          <div>
            <h3 class="sb-tpl-col-title">프로젝트 전용 템플릿 (${projTpls.length})</h3>
            ${renderTplList(projTpls, 'project')}
          </div>
          <div>
            <h3 class="sb-tpl-col-title">글로벌 템플릿 (${globals.length})</h3>
            ${renderTplList(globals, 'global')}
          </div>
        </div>
      `;

      $('sb-add-tpl-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('sb-tpl-name')?.value || '';
        const scope = $('sb-tpl-scope')?.value || 'project';
        const content = $('sb-tpl-content')?.value || '';
        if (!name.trim() || !content.trim()) return;
        if (scope === 'project') {
          Store.saveProjectTemplate(proj.id, { name, content });
        } else {
          Store.saveGlobalTemplate({ name, content });
        }
        hooks.saveAndRender();
        hooks.showToast(`📝 "${name.trim()}" 템플릿이 저장되었습니다.`);
        rerender();
      });

      container.querySelectorAll('.sb-tpl-card').forEach((card) => {
        card.querySelector('[data-tpl-del]')?.addEventListener('click', () => {
          const scope = card.dataset.tplScope;
          const tid = card.dataset.tplId;
          if (scope === 'project') Store.deleteProjectTemplate(proj.id, tid);
          else Store.deleteGlobalTemplate(tid);
          hooks.saveAndRender();
          rerender();
        });
      });
    }

    return {
      renderProjectDetailView,
      openTaskCompletionModal,
      syncProjectRiskMarkdownDoc,
      getRoleMeta,
      nextRoleCode,
      isCardDelayed,
      isCardExtended,
      setDetailTab(tab) {
        detailTab = tab || 'cards';
      }
    };
  }

  global.BrainProjectWorkspace = {
    createProjectWorkspace
  };
})(window);
