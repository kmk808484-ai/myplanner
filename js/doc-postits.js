(function (global) {
  'use strict';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const COLORS = [
    { id: 'yellow', label: '노랑', bg: '#fef9c3', border: '#eab308', accent: '#ca8a04', text: '#713f12' },
    { id: 'pink', label: '핑크', bg: '#fce7f3', border: '#ec4899', accent: '#db2777', text: '#831843' },
    { id: 'mint', label: '민트', bg: '#dcfce7', border: '#22c55e', accent: '#16a34a', text: '#14532d' },
    { id: 'blue', label: '하늘', bg: '#dbeafe', border: '#3b82f6', accent: '#2563eb', text: '#1e3a8a' },
    { id: 'purple', label: '보라', bg: '#f3e8ff', border: '#a855f7', accent: '#9333ea', text: '#581c87' }
  ];

  function genNoteId() {
    return 'pit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  let pdfJsPromise = null;
  function ensurePdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'apps/ocr-extractor/libs/pdf.min.js';
      s.onload = () => {
        if (global.pdfjsLib) {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'apps/ocr-extractor/libs/pdf.worker.min.js';
          resolve(global.pdfjsLib);
        } else {
          reject(new Error('PDF.js 로드 실패'));
        }
      };
      s.onerror = () => reject(new Error('오프라인 PDF.js 번들을 불러오지 못했습니다.'));
      document.head.appendChild(s);
    });
    return pdfJsPromise;
  }

  // ---- Unified Sticky Notes (Post-it) Sidebar Drawer for PDF / HTML / Markdown ----
  function mountPostitSidebar(hostEl, options = {}) {
    const item = options.item || {};
    if (!Array.isArray(item.postits)) item.postits = [];
    let selectedColor = 'yellow';
    let isOpen = Boolean(options.initialOpen);

    const drawer = document.createElement('aside');
    drawer.className = 'sb-postit-drawer';
    drawer.style.display = isOpen ? 'flex' : 'none';
    hostEl.appendChild(drawer);

    function persist() {
      if (typeof options.onPersist === 'function') options.onPersist(item);
      if (typeof options.onCountChange === 'function') options.onCountChange(item.postits.length);
    }

    function render() {
      const curAnchor = typeof options.getCurrentAnchor === 'function'
        ? options.getCurrentAnchor()
        : { label: '현재 위치', page: 1, line: 1, scrollTop: 0 };

      const list = Array.isArray(item.postits) ? item.postits : [];
      drawer.innerHTML = `
        <div class="sb-pi-head">
          <span>📌 포스트잇 노트 (${list.length})</span>
          <button type="button" class="sb-icon-btn-xs" data-pi-close="1" title="닫기">✕</button>
        </div>

        <form class="sb-pi-form" data-pi-form="1">
          <div class="sb-pi-form-top">
            <div class="sb-pi-colors">
              ${COLORS.map((c) => `
                <button type="button" class="sb-pi-cdot${selectedColor === c.id ? ' active' : ''}" data-pi-color="${c.id}" style="background:${c.bg}; border-color:${c.border};" title="${c.label}"></button>
              `).join('')}
            </div>
            <span class="sb-pi-loc-badge" title="포스트잇이 붙을 위치">${esc(curAnchor.label || '현재 위치')}</span>
          </div>
          <input type="text" class="sb-pi-title-inp" placeholder="메모 제목 (선택)...">
          <textarea class="sb-pi-body-inp" rows="2" placeholder="포스트잇 내용 입력... (Ctrl+Enter 붙이기)" required></textarea>
          <button type="submit" class="sb-btn-primary-sm" style="width:100%;">📌 현재 위치에 포스트잇 붙이기</button>
        </form>

        <div class="sb-pi-list">
          ${list.length === 0
            ? `<div class="sb-pi-empty">아직 붙인 포스트잇이 없어요.<br>페이지나 줄마다 메모를 붙여두면 화살표 클릭 한 번에 바로 이동합니다.</div>`
            : list.map((note) => {
                const col = COLORS.find((c) => c.id === note.color) || COLORS[0];
                return `
                  <div class="sb-pi-card has-arrow" data-pi-id="${esc(note.id)}" style="--pi-bg:${col.bg}; --pi-bd:${col.border}; --pi-acc:${col.accent}; --pi-tx:${col.text};">
                    <span class="sb-pi-left-arrow" aria-hidden="true">◀</span>
                    <div class="sb-pi-card-head">
                      <span class="sb-pi-jump-pill" data-pi-jump="${esc(note.id)}" title="클릭하면 화살표가 가리키는 위치로 바로 이동합니다">➜ 📍 ${esc(note.anchorLabel || '이동')}</span>
                      <button type="button" class="sb-pi-del-btn" data-pi-del="${esc(note.id)}" title="삭제">✕</button>
                    </div>
                    ${note.title ? `<div class="sb-pi-card-title" data-pi-jump="${esc(note.id)}">${esc(note.title)}</div>` : ''}
                    <div class="sb-pi-card-body" data-pi-jump="${esc(note.id)}">${esc(note.text)}</div>
                    <div class="sb-pi-card-foot">
                      <span class="sb-pi-color-lbl">색상:</span>
                      <div class="sb-pi-card-colors">
                        ${COLORS.map((c) => `
                          <button type="button" class="sb-pi-mini-dot${note.color === c.id ? ' active' : ''}" data-pi-recolor="${esc(note.id)}" data-pi-newcol="${c.id}" style="background:${c.bg}; border-color:${c.border};" title="${c.label}으로 색상 변경"></button>
                        `).join('')}
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
        </div>
      `;

      drawer.querySelector('[data-pi-close]')?.addEventListener('click', () => setOpen(false));
      drawer.querySelectorAll('[data-pi-color]').forEach((b) => {
        b.addEventListener('click', () => {
          selectedColor = b.dataset.piColor || 'yellow';
          render();
        });
      });

      const form = drawer.querySelector('[data-pi-form]');
      const bodyInp = drawer.querySelector('.sb-pi-body-inp');
      const titleInp = drawer.querySelector('.sb-pi-title-inp');

      const submitNote = () => {
        const text = String(bodyInp?.value || '').trim();
        if (!text) return;
        const anchor = typeof options.getCurrentAnchor === 'function'
          ? options.getCurrentAnchor()
          : { label: '현재 위치', page: 1, line: 1, scrollTop: 0 };
        item.postits.unshift({
          id: genNoteId(),
          color: selectedColor,
          title: String(titleInp?.value || '').trim(),
          text,
          page: anchor.page || 1,
          line: anchor.line || 1,
          scrollTop: anchor.scrollTop || 0,
          targetX: Number.isFinite(anchor.targetX) ? anchor.targetX : 0.35,
          targetY: Number.isFinite(anchor.targetY) ? anchor.targetY : 0.22,
          anchorLabel: anchor.label || (anchor.page ? `p.${anchor.page}` : `L.${anchor.line || 1}`),
          createdAt: Date.now()
        });
        persist();
        render();
        options.onToast?.(`📌 포스트잇을 [${anchor.label || '현재 위치'}]에 붙였습니다.`);
      };

      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        submitNote();
      });
      bodyInp?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submitNote();
        }
      });

      drawer.querySelectorAll('[data-pi-jump]').forEach((el) => {
        el.addEventListener('click', () => {
          const nid = el.dataset.piJump;
          const note = item.postits.find((n) => n.id === nid);
          if (note && typeof options.onJumpToAnchor === 'function') {
            options.onJumpToAnchor(note);
            options.onToast?.(`📍 [${note.anchorLabel || '위치'}]로 이동했습니다.`);
          }
        });
      });

      drawer.querySelectorAll('[data-pi-recolor]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.piRecolor;
          const nextCol = btn.dataset.piNewcol || 'yellow';
          const target = item.postits.find((n) => n.id === nid);
          if (target) {
            target.color = nextCol;
            persist();
            render();
            const colObj = COLORS.find((c) => c.id === nextCol);
            options.onToast?.(`🎨 포스트잇 색상을 [${colObj?.label || nextCol}]로 변경했습니다.`);
          }
        });
      });

      drawer.querySelectorAll('[data-pi-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nid = btn.dataset.piDel;
          item.postits = item.postits.filter((n) => n.id !== nid);
          persist();
          render();
        });
      });
    }

    function setOpen(flag) {
      isOpen = Boolean(flag);
      drawer.style.display = isOpen ? 'flex' : 'none';
      if (isOpen) render();
    }

    function toggle() {
      setOpen(!isOpen);
      return isOpen;
    }

    if (isOpen) render();

    return {
      setOpen,
      toggle,
      refresh: render,
      isOpen: () => isOpen,
      getCount: () => (item.postits || []).length
    };
  }

  // ---- Page-Aware PDF Viewer with Embedded Post-it Stickers & Jump-to-Page ----
  async function mountPdfViewerWithPostits(container, { pdfUrl, item, onPersist, onToast } = {}) {
    container.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'sb-pdfv-shell';
    shell.innerHTML = `
      <div class="sb-pdfv-toolbar">
        <div class="sb-pdfv-nav">
          <button type="button" class="sb-mini-ghost" data-pv="prev" title="이전 페이지">‹ 이전</button>
          <span class="sb-pdfv-page-info" data-pv="page-info">1 / 1</span>
          <button type="button" class="sb-mini-ghost" data-pv="next" title="다음 페이지">다음 ›</button>
        </div>
        <div class="sb-pdfv-nav">
          <button type="button" class="sb-mini-ghost" data-pv="zoom-out">−</button>
          <span class="sb-pdfv-zoom" data-pv="zoom-lbl">100%</span>
          <button type="button" class="sb-mini-ghost" data-pv="zoom-in">＋</button>
        </div>
        <button type="button" class="sb-btn-primary-sm" data-pv="toggle-postit">📌 포스트잇 (${(item?.postits || []).length})</button>
      </div>
      <div class="sb-pdfv-main">
        <div class="sb-pdfv-stage" data-pv="stage">
          <div class="sb-pdfv-canvas-wrap" data-pv="canvas-wrap">
            <canvas data-pv="canvas"></canvas>
            <div class="sb-pdfv-page-stickers" data-pv="stickers"></div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(shell);

    const mainEl = shell.querySelector('.sb-pdfv-main');
    const stageEl = shell.querySelector('[data-pv="stage"]');
    const canvas = shell.querySelector('[data-pv="canvas"]');
    const stickersEl = shell.querySelector('[data-pv="stickers"]');
    const pageInfoEl = shell.querySelector('[data-pv="page-info"]');
    const zoomLblEl = shell.querySelector('[data-pv="zoom-lbl"]');
    const btnPostit = shell.querySelector('[data-pv="toggle-postit"]');

    let pdfDoc = null;
    let curPage = 1;
    let totalPages = 1;
    let zoomScale = 1.15;
    let fallbackIframe = null;

    let lastClickRelX = 0.35;
    let lastClickRelY = 0.22;

    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        lastClickRelX = Math.max(0.06, Math.min(0.88, (e.clientX - r.left) / r.width));
        lastClickRelY = Math.max(0.06, Math.min(0.92, (e.clientY - r.top) / r.height));
        onToast?.(`🎯 화살표 지시 위치 지정됨 (p.${curPage} · ${Math.round(lastClickRelX * 100)}%, ${Math.round(lastClickRelY * 100)}%)`);
      }
    });

    function renderPageStickers() {
      const pageNotes = (item?.postits || []).filter((n) => Number(n.page || 1) === curPage);
      if (!pageNotes.length) {
        stickersEl.innerHTML = '';
        return;
      }
      const cw = canvas.width || 600;
      const ch = canvas.height || 800;

      const svgPaths = pageNotes.map((n, idx) => {
        const col = COLORS.find((c) => c.id === n.color) || COLORS[0];
        const tx = Math.round((Number.isFinite(n.targetX) ? n.targetX : 0.32) * cw);
        const ty = Math.round((Number.isFinite(n.targetY) ? n.targetY : (0.16 + idx * 0.16)) * ch);
        const sx = Math.max(cw - 210, Math.round(cw * 0.72));
        const sy = Math.min(ch - 40, 28 + idx * 78);
        const midX = Math.round((sx + tx) * 0.5);
        const midY = Math.round(Math.min(sy, ty) - 18);
        return `
          <defs>
            <marker id="pi-arr-${idx}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,1 L8,4.5 L0,8 Z" fill="${col.accent || col.border}" />
            </marker>
          </defs>
          <path d="M ${sx} ${sy} Q ${midX} ${midY} ${tx} ${ty}" fill="none" stroke="${col.accent || col.border}" stroke-width="2.4" stroke-dasharray="5 3" marker-end="url(#pi-arr-${idx})" />
          <circle cx="${tx}" cy="${ty}" r="5" fill="${col.bg}" stroke="${col.accent || col.border}" stroke-width="2.2" />
        `;
      }).join('');

      const cardsHtml = pageNotes.map((n) => {
        const col = COLORS.find((c) => c.id === n.color) || COLORS[0];
        return `
          <div class="sb-pdfv-sticker" style="background:${col.bg}; border-color:${col.border}; color:${col.text};">
            <div class="sb-pdfv-sticker-head">
              <span>⬅️ 📌 p.${curPage} ${esc(n.title || '')}</span>
              <span class="sb-pdfv-st-dots">
                ${COLORS.map((c) => `<button type="button" class="sb-pi-mini-dot${n.color === c.id ? ' active' : ''}" data-pv-recolor="${esc(n.id)}" data-pv-col="${c.id}" style="background:${c.bg}; border-color:${c.border};" title="${c.label}"></button>`).join('')}
              </span>
            </div>
            <div>${esc(n.text)}</div>
          </div>
        `;
      }).join('');

      stickersEl.innerHTML = `
        <svg class="sb-pdfv-arrow-svg" viewBox="0 0 ${cw} ${ch}" preserveAspectRatio="none">${svgPaths}</svg>
        <div class="sb-pdfv-sticker-col">${cardsHtml}</div>
      `;

      stickersEl.querySelectorAll('[data-pv-recolor]').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = (item?.postits || []).find((n) => n.id === b.dataset.pvRecolor);
          if (target) {
            target.color = b.dataset.pvCol || 'yellow';
            renderPageStickers();
            postitCtrl.refresh();
            if (typeof onPersist === 'function') onPersist(item);
          }
        });
      });
    }

    async function renderPdfPage(num) {
      curPage = Math.max(1, Math.min(totalPages, Number(num) || 1));
      pageInfoEl.textContent = `${curPage} / ${totalPages}`;
      zoomLblEl.textContent = `${Math.round(zoomScale * 100)}%`;

      if (fallbackIframe) {
        fallbackIframe.src = `${pdfUrl}#page=${curPage}`;
        renderPageStickers();
        postitCtrl.refresh();
        return;
      }
      if (!pdfDoc) return;
      const page = await pdfDoc.getPage(curPage);
      const viewport = page.getViewport({ scale: zoomScale });
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      stageEl.scrollTop = 0;
      renderPageStickers();
      postitCtrl.refresh();
    }

    const postitCtrl = mountPostitSidebar(mainEl, {
      item,
      viewerType: 'pdf',
      initialOpen: (item?.postits || []).length > 0,
      getCurrentAnchor: () => ({
        label: `p.${curPage}`,
        page: curPage,
        scrollTop: stageEl.scrollTop,
        targetX: lastClickRelX,
        targetY: lastClickRelY
      }),
      onJumpToAnchor: (note) => {
        renderPdfPage(note.page || 1);
      },
      onPersist: (it) => {
        renderPageStickers();
        if (typeof onPersist === 'function') onPersist(it);
      },
      onCountChange: (cnt) => {
        btnPostit.textContent = `📌 포스트잇 (${cnt})`;
      },
      onToast
    });

    shell.querySelector('[data-pv="prev"]')?.addEventListener('click', () => renderPdfPage(curPage - 1));
    shell.querySelector('[data-pv="next"]')?.addEventListener('click', () => renderPdfPage(curPage + 1));
    shell.querySelector('[data-pv="zoom-out"]')?.addEventListener('click', () => {
      zoomScale = Math.max(0.6, zoomScale - 0.15);
      renderPdfPage(curPage);
    });
    shell.querySelector('[data-pv="zoom-in"]')?.addEventListener('click', () => {
      zoomScale = Math.min(2.4, zoomScale + 0.15);
      renderPdfPage(curPage);
    });
    btnPostit?.addEventListener('click', () => postitCtrl.toggle());

    try {
      const pdfjsLib = await ensurePdfJs();
      pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
      totalPages = pdfDoc.numPages || 1;
      await renderPdfPage(1);
    } catch (_) {
      // Fallback to native PDF iframe while keeping Post-it sidebar & #page=N jump working!
      stageEl.innerHTML = '';
      fallbackIframe = document.createElement('iframe');
      fallbackIframe.src = pdfUrl;
      fallbackIframe.style.cssText = 'width:100%; height:100%; border:none;';
      stageEl.appendChild(fallbackIframe);
      totalPages = 999;
      pageInfoEl.textContent = 'PDF 뷰어';
    }

    return { renderPdfPage, postitCtrl };
  }

  global.BrainDocPostits = {
    COLORS,
    mountPostitSidebar,
    mountPdfViewerWithPostits
  };
})(window);
