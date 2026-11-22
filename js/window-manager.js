(function (global) {
  'use strict';

  const MIN_WIDTH = 380;
  const MIN_HEIGHT = 280;
  const HEADER_TOP_SAFE = 48; // keep below top title-bar when possible

  const windows = new Map(); // id -> winState
  let topZ = 2100;
  let cascadeCount = 0;
  let taskbarHideTimer = null;
  let taskbarHoverBound = false;

  function getLayer() {
    return document.getElementById('os-window-layer');
  }

  function getTaskbar() {
    return document.getElementById('os-taskbar');
  }

  function ensureTaskbarAutoHide() {
    if (taskbarHoverBound) return;
    const taskbar = getTaskbar();
    if (!taskbar) return;
    taskbarHoverBound = true;

    let hotzone = document.getElementById('os-taskbar-hotzone');
    if (!hotzone) {
      hotzone = document.createElement('div');
      hotzone.id = 'os-taskbar-hotzone';
      hotzone.className = 'os-taskbar-hotzone';
      hotzone.innerHTML = '<span class="os-taskbar-pill"></span>';
      document.body.appendChild(hotzone);
    }

    const showDock = () => {
      if (windows.size === 0) return;
      if (taskbarHideTimer) { clearTimeout(taskbarHideTimer); taskbarHideTimer = null; }
      taskbar.classList.add('visible');
    };

    const scheduleHideDock = (delay = 320) => {
      if (taskbarHideTimer) clearTimeout(taskbarHideTimer);
      taskbarHideTimer = setTimeout(() => {
        taskbarHideTimer = null;
        if (!taskbar.matches(':hover') && !hotzone.matches(':hover')) {
          taskbar.classList.remove('visible');
        }
      }, delay);
    };

    hotzone.addEventListener('mouseenter', showDock);
    hotzone.addEventListener('mouseleave', () => scheduleHideDock(360));
    taskbar.addEventListener('mouseenter', showDock);
    taskbar.addEventListener('mouseleave', () => scheduleHideDock(320));
  }

  function peekTaskbar(durationMs = 1400) {
    const taskbar = getTaskbar();
    if (!taskbar || windows.size === 0) return;
    ensureTaskbarAutoHide();
    taskbar.classList.add('visible');
    if (taskbarHideTimer) clearTimeout(taskbarHideTimer);
    taskbarHideTimer = setTimeout(() => {
      taskbarHideTimer = null;
      const hotzone = document.getElementById('os-taskbar-hotzone');
      if (!taskbar.matches(':hover') && !(hotzone && hotzone.matches(':hover'))) {
        taskbar.classList.remove('visible');
      }
    }, durationMs);
  }

  function renderTaskbar() {
    const taskbar = getTaskbar();
    if (!taskbar) return;
    ensureTaskbarAutoHide();
    const hotzone = document.getElementById('os-taskbar-hotzone');

    if (windows.size === 0) {
      taskbar.style.display = 'none';
      taskbar.classList.remove('visible');
      taskbar.innerHTML = '';
      if (hotzone) hotzone.style.display = 'none';
      return;
    }

    taskbar.style.display = 'flex';
    if (hotzone) hotzone.style.display = 'flex';
    taskbar.innerHTML = '';

    // Determine highest z-index visible window
    let focusedId = null;
    let highestZ = -1;
    for (const [id, w] of windows.entries()) {
      if (!w.minimized && w.z > highestZ) {
        highestZ = w.z;
        focusedId = id;
      }
    }

    for (const [id, w] of windows.entries()) {
      const isFocused = id === focusedId && !w.minimized;
      w.el.classList.toggle('focused', isFocused);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'taskbar-item' + (isFocused ? ' active' : '') + (w.minimized ? ' minimized' : '');
      btn.title = w.minimized ? `${w.title} 복원` : (isFocused ? `${w.title} 최소화` : `${w.title} 앞으로 가져오기`);

      const iconSpan = document.createElement('span');
      iconSpan.className = 'taskbar-item-icon';
      iconSpan.textContent = w.icon || '📄';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'taskbar-item-title';
      titleSpan.textContent = w.title;

      const closeMini = document.createElement('span');
      closeMini.className = 'taskbar-item-close';
      closeMini.textContent = '✕';
      closeMini.title = '닫기';
      closeMini.addEventListener('click', (e) => {
        e.stopPropagation();
        w.handle.close();
      });

      btn.appendChild(iconSpan);
      btn.appendChild(titleSpan);
      btn.appendChild(closeMini);

      btn.addEventListener('click', () => {
        if (w.minimized) {
          w.handle.restore();
        } else if (isFocused) {
          w.handle.minimize();
        } else {
          w.handle.focus();
        }
      });

      taskbar.appendChild(btn);
    }
  }

  function clampPosition(left, top, width) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minVisibleX = 120;
    const clampedLeft = Math.max(-width + minVisibleX, Math.min(vw - minVisibleX, left));
    const clampedTop = Math.max(0, Math.min(vh - 64, top));
    return { left: clampedLeft, top: clampedTop };
  }

  function attachDrag(winState, headerEl) {
    headerEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, a, .os-win-actions, .os-win-controls')) return;

      winState.handle.focus();

      // If maximized, restore smoothly on drag start
      if (winState.maximized) {
        const ratioX = e.clientX / Math.max(1, window.innerWidth);
        winState.handle.toggleMaximize();
        const rect = winState.el.getBoundingClientRect();
        const newLeft = Math.round(e.clientX - rect.width * ratioX);
        const newTop = Math.max(0, e.clientY - 18);
        winState.el.style.left = `${newLeft}px`;
        winState.el.style.top = `${newTop}px`;
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = winState.el.getBoundingClientRect();
      const layer = getLayer();
      if (layer) layer.classList.add('is-interacting');
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const pos = clampPosition(startRect.left + dx, startRect.top + dy, startRect.width);
        winState.el.style.left = `${pos.left}px`;
        winState.el.style.top = `${pos.top}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (layer) layer.classList.remove('is-interacting');
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    headerEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a, .os-win-actions, .os-win-controls')) return;
      winState.handle.toggleMaximize();
    });
  }

  function attachResizeHandles(winState) {
    const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    dirs.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `os-resize-handle os-resize-${dir}`;
      handle.dataset.dir = dir;

      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || winState.maximized) return;
        e.preventDefault();
        e.stopPropagation();
        winState.handle.focus();

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = winState.el.getBoundingClientRect();
        const layer = getLayer();
        if (layer) layer.classList.add('is-interacting');
        document.body.style.userSelect = 'none';

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let newLeft = rect.left;
          let newTop = rect.top;
          let newWidth = rect.width;
          let newHeight = rect.height;

          if (dir.includes('e')) {
            newWidth = Math.max(MIN_WIDTH, rect.width + dx);
          }
          if (dir.includes('s')) {
            newHeight = Math.max(MIN_HEIGHT, rect.height + dy);
          }
          if (dir.includes('w')) {
            const candidateW = rect.width - dx;
            if (candidateW >= MIN_WIDTH) {
              newWidth = candidateW;
              newLeft = rect.left + dx;
            } else {
              newWidth = MIN_WIDTH;
              newLeft = rect.right - MIN_WIDTH;
            }
          }
          if (dir.includes('n')) {
            const candidateH = rect.height - dy;
            const maxTopShift = rect.top; // don't push above viewport top
            const effectiveDy = Math.max(-maxTopShift, dy);
            if (rect.height - effectiveDy >= MIN_HEIGHT) {
              newHeight = rect.height - effectiveDy;
              newTop = rect.top + effectiveDy;
            } else {
              newHeight = MIN_HEIGHT;
              newTop = rect.bottom - MIN_HEIGHT;
            }
          }

          winState.el.style.left = `${Math.round(newLeft)}px`;
          winState.el.style.top = `${Math.max(0, Math.round(newTop))}px`;
          winState.el.style.width = `${Math.round(newWidth)}px`;
          winState.el.style.height = `${Math.round(newHeight)}px`;
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (layer) layer.classList.remove('is-interacting');
          document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      winState.el.appendChild(handle);
    });
  }

  function openWindow(options) {
    const id = String(options.id || `win-${Date.now()}`);
    if (windows.has(id)) {
      const existing = windows.get(id);
      if (existing.minimized) existing.handle.restore();
      else existing.handle.focus();
      return existing.handle;
    }

    const layer = getLayer();
    if (!layer) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const taskbarSpace = 44;
    const width = Math.min(options.width || 860, Math.max(MIN_WIDTH, vw - 40));
    const height = Math.min(options.height || 620, Math.max(MIN_HEIGHT, vh - HEADER_TOP_SAFE - taskbarSpace - 24));

    const offset = (cascadeCount % 6) * 26;
    cascadeCount++;
    const initLeft = Math.max(16, Math.min(vw - width - 16, Math.round((vw - width) / 2) + offset - 40));
    const initTop = Math.max(HEADER_TOP_SAFE + 8, Math.min(vh - height - taskbarSpace - 12, HEADER_TOP_SAFE + 20 + offset));

    const winEl = document.createElement('div');
    winEl.className = 'os-win';
    winEl.dataset.winId = id;
    winEl.style.width = `${width}px`;
    winEl.style.height = `${height}px`;
    winEl.style.left = `${initLeft}px`;
    winEl.style.top = `${initTop}px`;
    winEl.style.zIndex = String(++topZ);

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'os-win-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'os-win-title-group';

    const iconEl = document.createElement('span');
    iconEl.className = 'os-win-icon';
    iconEl.textContent = options.icon || '📄';

    const titleEl = document.createElement('span');
    titleEl.className = 'os-win-title';
    titleEl.textContent = options.title || '창';

    const metaEl = document.createElement('span');
    metaEl.className = 'os-win-meta';
    metaEl.textContent = options.meta || '';

    titleGroup.appendChild(iconEl);
    titleGroup.appendChild(titleEl);
    titleGroup.appendChild(metaEl);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'os-win-right';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'os-win-actions';
    if (Array.isArray(options.headerActions)) {
      options.headerActions.forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'os-win-action-btn';
        b.textContent = act.label;
        if (act.title) b.title = act.title;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof act.onClick === 'function') act.onClick();
        });
        actionsEl.appendChild(b);
      });
    }

    // Windows-style Right-Aligned Larger Controls (최소화 · 최대화 · 닫기)
    const SVG_MIN = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    const SVG_MAX = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2.2" y="2.2" width="9.6" height="9.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    const SVG_RESTORE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="4.2" width="7.4" height="7.4" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.6 4.2V2.2h7.2v7.2H9.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    const SVG_CLOSE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><line x1="2.4" y1="2.4" x2="11.6" y2="11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="11.6" y1="2.4" x2="2.4" y2="11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    const controlsEl = document.createElement('div');
    controlsEl.className = 'os-win-controls win-controls-right';

    const btnMin = document.createElement('button');
    btnMin.type = 'button';
    btnMin.className = 'os-win-ctrl-btn win-btn-min';
    btnMin.innerHTML = SVG_MIN;
    btnMin.title = '최소화';

    const btnMax = document.createElement('button');
    btnMax.type = 'button';
    btnMax.className = 'os-win-ctrl-btn win-btn-max';
    btnMax.innerHTML = SVG_MAX;
    btnMax.title = '최대화 / 원래 크기';

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'os-win-ctrl-btn win-btn-close';
    btnClose.innerHTML = SVG_CLOSE;
    btnClose.title = '닫기';

    controlsEl.appendChild(btnMin);
    controlsEl.appendChild(btnMax);
    controlsEl.appendChild(btnClose);

    rightGroup.appendChild(actionsEl);
    rightGroup.appendChild(controlsEl);

    headerEl.appendChild(titleGroup);
    headerEl.appendChild(rightGroup);

    // Body
    const bodyEl = document.createElement('div');
    bodyEl.className = 'os-win-body' + (options.bodyClass ? ` ${options.bodyClass}` : '');
    if (options.contentEl instanceof Node) {
      bodyEl.appendChild(options.contentEl);
    } else if (typeof options.contentHtml === 'string') {
      bodyEl.innerHTML = options.contentHtml;
    }

    winEl.appendChild(headerEl);
    winEl.appendChild(bodyEl);

    const winState = {
      id,
      title: options.title || '창',
      icon: options.icon || '📄',
      el: winEl,
      titleEl,
      iconEl,
      metaEl,
      bodyEl,
      btnMax,
      z: topZ,
      minimized: false,
      maximized: false,
      prevRect: null,
      onClose: options.onClose || null,
      handle: null
    };

    const handle = {
      id,
      el: winEl,
      bodyEl,
      focus() {
        winState.z = ++topZ;
        winEl.style.zIndex = String(winState.z);
        renderTaskbar();
      },
      minimize() {
        winState.minimized = true;
        winEl.style.display = 'none';
        renderTaskbar();
        peekTaskbar(1400);
      },
      restore() {
        winState.minimized = false;
        winEl.style.display = 'flex';
        handle.focus();
      },
      toggleMaximize() {
        if (!winState.maximized) {
          winState.prevRect = {
            left: winEl.style.left,
            top: winEl.style.top,
            width: winEl.style.width,
            height: winEl.style.height
          };
          winState.maximized = true;
          winEl.classList.add('maximized');
          btnMax.innerHTML = SVG_RESTORE;
        } else {
          winState.maximized = false;
          winEl.classList.remove('maximized');
          if (winState.prevRect) {
            winEl.style.left = winState.prevRect.left;
            winEl.style.top = winState.prevRect.top;
            winEl.style.width = winState.prevRect.width;
            winEl.style.height = winState.prevRect.height;
          }
          btnMax.innerHTML = SVG_MAX;
        }
        handle.focus();
      },
      setTitle(newTitle) {
        winState.title = newTitle || '창';
        titleEl.textContent = winState.title;
        renderTaskbar();
      },
      setIcon(newIcon) {
        winState.icon = newIcon || '📄';
        iconEl.textContent = winState.icon;
        renderTaskbar();
      },
      setMeta(newMeta) {
        metaEl.textContent = newMeta || '';
      },
      setBody(content) {
        bodyEl.innerHTML = '';
        if (content instanceof Node) bodyEl.appendChild(content);
        else if (typeof content === 'string') bodyEl.innerHTML = content;
      },
      close() {
        if (!windows.has(id)) return;
        windows.delete(id);
        winEl.remove();
        renderTaskbar();
        if (typeof winState.onClose === 'function') {
          try {
            winState.onClose();
          } catch (_) {}
        }
      }
    };

    winState.handle = handle;

    winEl.addEventListener('mousedown', () => handle.focus());
    btnMin.addEventListener('click', (e) => { e.stopPropagation(); handle.minimize(); });
    btnMax.addEventListener('click', (e) => { e.stopPropagation(); handle.toggleMaximize(); });
    btnClose.addEventListener('click', (e) => { e.stopPropagation(); handle.close(); });

    attachDrag(winState, headerEl);
    attachResizeHandles(winState);

    windows.set(id, winState);
    layer.appendChild(winEl);
    renderTaskbar();
    return handle;
  }

  function getWindow(id) {
    return windows.get(String(id))?.handle || null;
  }

  function closeAll() {
    for (const w of Array.from(windows.values())) {
      w.handle.close();
    }
  }

  function listOpenWindowIds() {
    return Array.from(windows.keys());
  }

  function tileWindows(ids = null, direction = 'vertical') {
    const targetIds = Array.isArray(ids) && ids.length > 0 ? ids : Array.from(windows.keys());
    const list = targetIds.map((id) => windows.get(String(id))).filter(Boolean);
    if (list.length === 0) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const topPad = 4;

    list.forEach((w, idx) => {
      if (w.minimized) {
        w.minimized = false;
        w.el.style.display = 'flex';
      }
      if (w.maximized) {
        w.maximized = false;
        w.el.classList.remove('maximized');
        w.btnMax.innerHTML = '<span>+</span>';
      }
      if (direction === 'horizontal') {
        const h = Math.max(MIN_HEIGHT, Math.floor((vh - topPad * 2 - gap * (list.length - 1)) / list.length));
        w.el.style.left = `${gap}px`;
        w.el.style.top = `${topPad + idx * (h + gap)}px`;
        w.el.style.width = `${Math.max(MIN_WIDTH, vw - gap * 2)}px`;
        w.el.style.height = `${h}px`;
      } else {
        const widthEach = Math.max(MIN_WIDTH, Math.floor((vw - gap * (list.length + 1)) / list.length));
        w.el.style.left = `${gap + idx * (widthEach + gap)}px`;
        w.el.style.top = `${topPad}px`;
        w.el.style.width = `${widthEach}px`;
        w.el.style.height = `${Math.max(MIN_HEIGHT, vh - topPad * 2 - 8)}px`;
      }
      w.z = ++topZ;
      w.el.style.zIndex = String(w.z);
    });
    renderTaskbar();
  }

  global.BrainWindowManager = {
    openWindow,
    getWindow,
    listOpenWindowIds,
    tileWindows,
    closeAll
  };
})(window);
