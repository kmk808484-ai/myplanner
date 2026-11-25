(function (global) {
  'use strict';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(parts[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('캡처 이미지를 불러오지 못했습니다.'));
      img.src = src;
    });
  }

  // Fallback pure-canvas snapshot of current Second Brain workspace (used when OS GDI & getDisplayMedia are unavailable)
  function captureWorkspaceViewportFallback() {
    const w = Math.max(960, window.innerWidth || 1280);
    const h = Math.max(600, window.innerHeight || 720);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const isDark = document.body.classList.contains('dark-mode');

    ctx.fillStyle = isDark ? '#0f172a' : '#f4f6fb';
    ctx.fillRect(0, 0, w, h);

    // Paint topbar + visible main elements / canvases onto the snapshot
    const topbar = document.querySelector('.sb-topbar');
    if (topbar) {
      const r = topbar.getBoundingClientRect();
      ctx.fillStyle = isDark ? '#1e293b' : '#ffffff';
      ctx.fillRect(r.left, r.top, r.width, r.height);
      ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
      ctx.fillRect(r.left, r.bottom - 1, r.width, 1);
      ctx.fillStyle = '#4f46e5';
      ctx.font = 'bold 16px "Malgun Gothic", sans-serif';
      ctx.fillText('세컨드 브레인 OS · 화면 캡처', r.left + 20, r.top + 32);
    }

    // Snapshot visible widgets / cards / windows
    const cards = Array.from(document.querySelectorAll('.sb-card, .os-window, .sb-kpi-card')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 30 && r.bottom > 0 && r.top < h;
    });
    cards.forEach((el) => {
      const r = el.getBoundingClientRect();
      ctx.save();
      ctx.fillStyle = isDark ? '#1e293b' : '#ffffff';
      ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(r.left, r.top, r.width, r.height, 12);
      ctx.fill();
      ctx.stroke();

      const title = (el.querySelector('h2, h3, h4, .os-win-title, .sb-kpi-label')?.textContent || '').trim();
      const bodyTxt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      ctx.font = 'bold 14px "Malgun Gothic", sans-serif';
      if (title) ctx.fillText(title.slice(0, 46), r.left + 14, r.top + 26);
      ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
      ctx.font = '12px "Malgun Gothic", sans-serif';
      if (bodyTxt) ctx.fillText(bodyTxt.slice(0, 68), r.left + 14, r.top + 50);
      ctx.restore();
    });

    // Also copy any live <canvas> elements (e.g. Origin charts, PDFs) directly
    document.querySelectorAll('canvas').forEach((cv) => {
      if (cv.classList.contains('sb-cap-canvas')) return;
      const r = cv.getBoundingClientRect();
      if (r.width > 10 && r.height > 10 && cv.width > 0 && cv.height > 0) {
        try {
          ctx.drawImage(cv, r.left, r.top, r.width, r.height);
        } catch (_) {}
      }
    });

    return { dataUrl: c.toDataURL('image/png'), mode: 'workspace-fallback' };
  }

  // Capture via Windows Local Bridge (zero permission popup, full PC screen) OR Browser getDisplayMedia() OR Workspace fallback
  async function grabFullScreenDataUrl(hooks = {}) {
    // 1. Try Windows Local Bridge /capture-screen first if connected
    const bridge = global.BrainLocalBridge;
    const bridgeUrl = hooks.getBridgeBaseUrl?.() || (window.location.protocol.startsWith('http') ? window.location.origin : '');
    if (bridge && typeof bridge.captureDesktopScreen === 'function' && bridgeUrl) {
      try {
        const dataUrl = await bridge.captureDesktopScreen(bridgeUrl);
        if (dataUrl) return { dataUrl, mode: 'desktop-bridge' };
      } catch (_) {}
    }

    // 2. Browser Screen Capture API (getDisplayMedia)
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'never' },
          audio: false
        });
        try {
          const video = document.createElement('video');
          video.srcObject = stream;
          video.muted = true;
          await video.play();
          await new Promise((r) => setTimeout(r, 150));
          const c = document.createElement('canvas');
          c.width = video.videoWidth || window.innerWidth;
          c.height = video.videoHeight || window.innerHeight;
          c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
          return { dataUrl: c.toDataURL('image/png'), mode: 'display-media' };
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        // Respect explicit user cancellation in interactive browsers
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          throw err;
        }
      }
    }

    // 3. Resilient fallback (non-interactive / headless environment): capture current workspace canvas
    return captureWorkspaceViewportFallback();
  }

  // Full-screen interactive crosshair region selector overlay
  function openRegionSelectorOverlay(fullDataUrl, onRegionConfirmed) {
    loadImg(fullDataUrl).then((img) => {
      const overlay = document.createElement('div');
      overlay.className = 'sb-cap-overlay';
      overlay.innerHTML = `
        <canvas class="sb-cap-canvas"></canvas>
        <div class="sb-cap-hud">📸 드래그하여 캡처할 영역을 지정하세요 · <b>Esc</b> 취소</div>
        <div class="sb-cap-size-pill" style="display:none;"></div>
      `;
      document.body.appendChild(overlay);

      const canvas = overlay.querySelector('.sb-cap-canvas');
      const sizePill = overlay.querySelector('.sb-cap-size-pill');
      const ctx = canvas.getContext('2d');

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      canvas.width = vw;
      canvas.height = vh;

      const scale = Math.min(vw / img.width, vh / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const offX = (vw - drawW) / 2;
      const offY = (vh - drawH) / 2;

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let curX = 0;
      let curY = 0;

      const redraw = () => {
        ctx.clearRect(0, 0, vw, vh);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, vw, vh);
        ctx.drawImage(img, offX, offY, drawW, drawH);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.52)';
        ctx.fillRect(0, 0, vw, vh);

        if (dragging) {
          const rx = Math.min(startX, curX);
          const ry = Math.min(startY, curY);
          const rw = Math.abs(curX - startX);
          const rh = Math.abs(curY - startY);
          if (rw > 2 && rh > 2) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.clip();
            ctx.drawImage(img, offX, offY, drawW, drawH);
            ctx.restore();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.strokeRect(rx, ry, rw, rh);

            const realW = Math.round(rw / scale);
            const realH = Math.round(rh / scale);
            sizePill.textContent = `${realW} × ${realH} px`;
            sizePill.style.display = 'block';
            sizePill.style.left = `${Math.min(vw - 120, rx + 6)}px`;
            sizePill.style.top = `${Math.max(44, ry - 28)}px`;
          }
        }
      };
      redraw();

      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
      };

      const onKey = (e) => {
        if (e.key === 'Escape') cleanup();
      };
      document.addEventListener('keydown', onKey);

      canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        curX = e.clientX;
        curY = e.clientY;
        redraw();
      });

      canvas.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        curX = e.clientX;
        curY = e.clientY;
        redraw();
      });

      canvas.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        const rx = Math.min(startX, curX);
        const ry = Math.min(startY, curY);
        const rw = Math.abs(curX - startX);
        const rh = Math.abs(curY - startY);
        cleanup();
        if (rw < 6 || rh < 6) return;

        // Crop from original full-res image
        const sx = Math.max(0, Math.round((rx - offX) / scale));
        const sy = Math.max(0, Math.round((ry - offY) / scale));
        const sw = Math.max(1, Math.min(img.width - sx, Math.round(rw / scale)));
        const sh = Math.max(1, Math.min(img.height - sy, Math.round(rh / scale)));

        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const croppedUrl = out.toDataURL('image/png');
        if (typeof onRegionConfirmed === 'function') onRegionConfirmed(croppedUrl, sw, sh);
      });
    });
  }

  function mountScreenCaptureApp(container, hooks = {}) {
    const history = [];

    container.innerHTML = `
      <div class="sb-tool-app">
        <div class="sb-tool-head">
          <div>
            <h3 style="margin:0; font-size:1rem;">📸 화면 캡처 (PrintScreen 영역 지정)</h3>
            <p class="sb-muted-sm" style="margin:3px 0 0;">버튼 또는 <code>PrintScreen</code> / <code>Alt+Shift+S</code>를 눌러 영역을 드래그하면 로컬 폴더에 PNG 이미지가 바로 생성됩니다.</p>
          </div>
          <label class="sb-check-inline" style="font-size:0.76rem;">
            <input type="checkbox" id="cap-auto-clip" checked>
            <span>클립보드 자동 복사</span>
          </label>
        </div>

        <div class="sb-cap-launch-bar">
          <button type="button" class="sb-btn-primary sb-cap-big-btn" id="cap-btn-region">📸 프린트 스크린샷 (영역 지정 캡처)</button>
          <button type="button" class="sb-btn-subtle" id="cap-btn-full">🖥️ 전체 화면 즉시 저장</button>
          <label class="sb-btn-subtle" style="cursor:pointer;">
            🖼️ 이미지 불러와 영역 자르기
            <input type="file" id="cap-img-upload" accept="image/*" style="display:none;">
          </label>
        </div>

        <div class="sb-cap-status" id="cap-status">준비됨 — 캡처 후 지정된 로컬 폴더에 <code>캡처_YYYYMMDD_HHMMSS.png</code>로 자동 저장됩니다.</div>
        <div class="sb-cap-gallery" id="cap-gallery">
          <div class="sb-empty-line"><span>아직 캡처한 이미지가 없습니다. 위 [📸 프린트 스크린샷] 버튼을 눌러보세요!</span></div>
        </div>
      </div>
    `;

    const statusEl = container.querySelector('#cap-status');
    const galleryEl = container.querySelector('#cap-gallery');
    const chkClip = container.querySelector('#cap-auto-clip');

    async function saveCapturedImage(dataUrl, w, h) {
      const fileName = `캡처_${formatStamp()}.png`;
      const blob = dataUrlToBlob(dataUrl);
      history.unshift({ fileName, dataUrl, w, h, createdAt: new Date().toLocaleTimeString('ko-KR') });

      if (chkClip?.checked && navigator.clipboard && global.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch (_) {}
      }

      if (typeof hooks.onSaveCaptureToLocal === 'function') {
        await hooks.onSaveCaptureToLocal(blob, dataUrl, fileName);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }

      statusEl.textContent = `✅ "${fileName}" (${w}×${h}px) 로컬 폴더에 저장 완료!`;
      renderGallery();
    }

    function renderGallery() {
      if (!history.length) return;
      galleryEl.innerHTML = history.map((it, idx) => `
        <div class="sb-cap-card">
          <img src="${it.dataUrl}" alt="${esc(it.fileName)}">
          <div class="sb-cap-card-meta">
            <strong>${esc(it.fileName)}</strong>
            <span>${it.w}×${it.h} · ${esc(it.createdAt)}</span>
          </div>
          <div class="sb-cap-card-acts">
            <button type="button" class="sb-mini-ghost" data-cap-dl="${idx}">⬇️ 다운로드</button>
            <button type="button" class="sb-mini-ghost" data-cap-copy="${idx}">📋 복사</button>
          </div>
        </div>
      `).join('');

      galleryEl.querySelectorAll('[data-cap-dl]').forEach((b) => {
        b.addEventListener('click', () => {
          const it = history[Number(b.dataset.capDl)];
          if (!it) return;
          const a = document.createElement('a');
          a.href = it.dataUrl;
          a.download = it.fileName;
          a.click();
        });
      });

      galleryEl.querySelectorAll('[data-cap-copy]').forEach((b) => {
        b.addEventListener('click', async () => {
          const it = history[Number(b.dataset.capCopy)];
          if (!it) return;
          try {
            const blob = dataUrlToBlob(it.dataUrl);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            hooks.showToast?.('📋 캡처 이미지를 클립보드에 복사했습니다.');
          } catch (_) {
            hooks.showToast?.('⚠️ 클립보드 복사가 제한된 환경입니다.');
          }
        });
      });
    }

    async function startRegionCapture() {
      statusEl.textContent = '화면 캡처 준비 중...';
      try {
        const res = await grabFullScreenDataUrl(hooks);
        const fullUrl = typeof res === 'string' ? res : res.dataUrl;
        const isFallback = res && res.mode === 'workspace-fallback';
        statusEl.textContent = isFallback
          ? '드래그하여 영역을 지정하세요 (앱 화면 모드 · 로컬연결_실행.bat 실행 시 PC 전체 화면 캡처 지원)'
          : '드래그하여 저장할 영역을 지정하세요...';
        openRegionSelectorOverlay(fullUrl, (croppedUrl, w, h) => {
          saveCapturedImage(croppedUrl, w, h);
        });
      } catch (err) {
        statusEl.textContent = `⚠️ 캡처 취소 또는 오류: ${err.message}`;
      }
    }

    async function startFullCapture() {
      statusEl.textContent = '전체 화면 캡처 중...';
      try {
        const res = await grabFullScreenDataUrl(hooks);
        const fullUrl = typeof res === 'string' ? res : res.dataUrl;
        const img = await loadImg(fullUrl);
        await saveCapturedImage(fullUrl, img.width, img.height);
      } catch (err) {
        statusEl.textContent = `⚠️ 캡처 취소 또는 오류: ${err.message}`;
      }
    }

    container.querySelector('#cap-btn-region')?.addEventListener('click', startRegionCapture);
    container.querySelector('#cap-btn-full')?.addEventListener('click', startFullCapture);
    container.querySelector('#cap-img-upload')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        openRegionSelectorOverlay(String(reader.result || ''), (croppedUrl, w, h) => {
          saveCapturedImage(croppedUrl, w, h);
        });
      };
      reader.readAsDataURL(f);
    });

    const onKey = (e) => {
      if (!document.body.contains(container)) return;
      if (e.key === 'PrintScreen' || (e.altKey && e.shiftKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        startRegionCapture();
      }
    };
    document.addEventListener('keydown', onKey);

    return {
      startRegionCapture,
      destroy() {
        document.removeEventListener('keydown', onKey);
      }
    };
  }

  global.BrainScreenCapture = {
    mountScreenCaptureApp,
    openRegionSelectorOverlay,
    grabFullScreenDataUrl
  };
})(window);
