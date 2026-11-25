(function (global) {
  'use strict';

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let jsZipPromise = null;
  function ensureJSZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (jsZipPromise) return jsZipPromise;
    jsZipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'apps/ocr-extractor/libs/jszip.min.js';
      s.onload = () => (global.JSZip ? resolve(global.JSZip) : reject(new Error('JSZip 로드 실패')));
      s.onerror = () => reject(new Error('오프라인 JSZip 번들을 불러올 수 없습니다.'));
      document.head.appendChild(s);
    });
    return jsZipPromise;
  }

  // ---- Pure-JS Offline Binary PDF Generator (JPEG-encoded high-DPI pages -> real valid .pdf Blob) ----
  function buildPdfBlobFromCanvases(canvases, quality = 0.9) {
    const encoder = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offsets = [0]; // 1-indexed PDF objects

    const pushBytes = (uint8) => {
      chunks.push(uint8);
      offset += uint8.length;
    };
    const pushStr = (str) => pushBytes(encoder.encode(str));

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const pageCount = canvases.length;
    // Object allocation:
    // 1: Catalog, 2: Pages
    // For each page i (0..N-1):
    //   imgObj = 3 + i*3
    //   contentObj = 4 + i*3
    //   pageObj = 5 + i*3
    const startObj = (objNum) => { offsets[objNum] = offset; pushStr(`${objNum} 0 obj\n`); };

    // 1: Catalog
    startObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2: Pages
    const kidsRefs = [];
    for (let i = 0; i < pageCount; i++) kidsRefs.push(`${5 + i * 3} 0 R`);
    startObj(2);
    pushStr(`<< /Type /Pages /Kids [${kidsRefs.join(' ')}] /Count ${pageCount} >>\nendobj\n`);

    for (let i = 0; i < pageCount; i++) {
      const c = canvases[i];
      const dataUrl = c.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.split(',')[1] || '';
      const binStr = atob(b64);
      const imgBytes = new Uint8Array(binStr.length);
      for (let k = 0; k < binStr.length; k++) imgBytes[k] = binStr.charCodeAt(k);

      // Fit into PDF points (72pt/inch); canvas is rendered at 2x of target pt size
      const ptW = Math.round(c.width / 2);
      const ptH = Math.round(c.height / 2);
      const imgObjNum = 3 + i * 3;
      const contentObjNum = 4 + i * 3;
      const pageObjNum = 5 + i * 3;

      // Image XObject
      startObj(imgObjNum);
      pushStr(
        `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`
      );
      pushBytes(imgBytes);
      pushStr('\nendstream\nendobj\n');

      // Page Content Stream
      const streamStr = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im${i} Do\nQ\n`;
      const streamBytes = encoder.encode(streamStr);
      startObj(contentObjNum);
      pushStr(`<< /Length ${streamBytes.length} >>\nstream\n`);
      pushBytes(streamBytes);
      pushStr('endstream\nendobj\n');

      // Page Object
      startObj(pageObjNum);
      pushStr(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}]` +
        ` /Resources << /XObject << /Im${i} ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
      );
    }

    const xrefOffset = offset;
    const totalObjs = 2 + pageCount * 3;
    pushStr(`xref\n0 ${totalObjs + 1}\n`);
    pushStr('0000000000 65535 f \n');
    for (let id = 1; id <= totalObjs; id++) {
      pushStr(`${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`);
    }
    pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  function getPageDimensions(pagePreset) {
    // 2x DPI (144 DPI) pixel sizes so PDF pt = px/2
    if (pagePreset === 'a4-landscape') return { w: 1684, h: 1190 };
    if (pagePreset === 'slide-16-9') return { w: 1600, h: 900 };
    return { w: 1190, h: 1684 }; // A4 portrait (595x842 pt * 2)
  }

  // ---- Rich Text/Paragraph Canvas Paginator (100% Korean Font Crispness, Zero ForeignObject Taint) ----
  function renderBlocksToCanvases(blocks, { title = '', pagePreset = 'a4-portrait' } = {}) {
    const { w, h } = getPageDimensions(pagePreset);
    const padX = 88;
    const padTop = 92;
    const padBot = 92;
    const maxW = w - padX * 2;
    const canvases = [];

    const createPage = (pageNo) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      // Subtle top/bottom header/footer
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 18px "Pretendard", "Malgun Gothic", sans-serif';
      if (title) ctx.fillText(title.slice(0, 64), padX, 46);
      ctx.textAlign = 'right';
      ctx.fillText(`- ${pageNo} -`, w - padX, h - 38);
      ctx.textAlign = 'left';
      canvases.push(c);
      return { c, ctx, y: padTop };
    };

    const wrapTextLines = (ctx, text, maxWidth) => {
      const lines = [];
      const rawParas = String(text || '').replace(/\r\n/g, '\n').split('\n');
      for (const para of rawParas) {
        if (!para.trim()) { lines.push(''); continue; }
        let line = '';
        for (const ch of para) {
          const test = line + ch;
          if (ctx.measureText(test).width > maxWidth && line.length > 0) {
            lines.push(line);
            line = ch === ' ' ? '' : ch;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
      }
      return lines;
    };

    let cur = createPage(1);

    for (const blk of blocks) {
      if (blk.type === 'page-break') {
        cur = createPage(canvases.length + 1);
        continue;
      }
      if (blk.type === 'slide-header') {
        if (canvases.length > 1 || cur.y > padTop + 10) {
          cur = createPage(canvases.length + 1);
        }
        const ctx = cur.ctx;
        ctx.fillStyle = '#eef2ff';
        ctx.fillRect(padX - 18, cur.y - 36, maxW + 36, 62);
        ctx.fillStyle = '#3730a3';
        ctx.font = '700 32px "Pretendard", "Malgun Gothic", sans-serif';
        ctx.fillText(blk.text || '', padX, cur.y + 6);
        cur.y += 56;
        continue;
      }
      if (blk.type === 'heading') {
        const size = blk.level === 1 ? 36 : (blk.level === 2 ? 29 : 24);
        cur.ctx.font = `700 ${size}px "Pretendard", "Malgun Gothic", sans-serif`;
        const lines = wrapTextLines(cur.ctx, blk.text, maxW);
        const lh = size * 1.45;
        if (cur.y + lines.length * lh + 20 > h - padBot) cur = createPage(canvases.length + 1);
        cur.ctx.fillStyle = '#0f172a';
        cur.ctx.font = `700 ${size}px "Pretendard", "Malgun Gothic", sans-serif`;
        lines.forEach((ln) => {
          cur.ctx.fillText(ln, padX, cur.y);
          cur.y += lh;
        });
        if (blk.level === 1) {
          cur.ctx.strokeStyle = '#cbd5e1';
          cur.ctx.lineWidth = 2;
          cur.ctx.beginPath();
          cur.ctx.moveTo(padX, cur.y - 6);
          cur.ctx.lineTo(w - padX, cur.y - 6);
          cur.ctx.stroke();
        }
        cur.y += 14;
        continue;
      }
      if (blk.type === 'table' && Array.isArray(blk.rows) && blk.rows.length > 0) {
        const colCount = Math.max(1, ...blk.rows.map((r) => r.length));
        const colW = maxW / colCount;
        const rowH = 42;
        for (let rIdx = 0; rIdx < blk.rows.length; rIdx++) {
          if (cur.y + rowH > h - padBot) cur = createPage(canvases.length + 1);
          const row = blk.rows[rIdx];
          for (let cIdx = 0; cIdx < colCount; cIdx++) {
            const x = padX + cIdx * colW;
            cur.ctx.fillStyle = rIdx === 0 ? '#f1f5f9' : '#ffffff';
            cur.ctx.fillRect(x, cur.y, colW, rowH);
            cur.ctx.strokeStyle = '#cbd5e1';
            cur.ctx.lineWidth = 1.5;
            cur.ctx.strokeRect(x, cur.y, colW, rowH);
            cur.ctx.fillStyle = '#0f172a';
            cur.ctx.font = `${rIdx === 0 ? '700' : '400'} 20px "Pretendard", "Malgun Gothic", sans-serif`;
            const cellTxt = String(row[cIdx] || '').replace(/\s+/g, ' ').trim();
            cur.ctx.fillText(cellTxt.slice(0, Math.max(6, Math.floor(colW / 14))), x + 10, cur.y + 27);
          }
          cur.y += rowH;
        }
        cur.y += 18;
        continue;
      }
      // Normal paragraph / bullet
      const isBullet = blk.type === 'bullet';
      const indent = isBullet ? 26 : 0;
      const fontSize = blk.fontSize || 23;
      const lh = fontSize * 1.62;
      cur.ctx.font = `${blk.bold ? '700' : '400'} ${fontSize}px "Pretendard", "Malgun Gothic", sans-serif`;
      const lines = wrapTextLines(cur.ctx, (isBullet ? '• ' : '') + (blk.text || ''), maxW - indent);
      for (const ln of lines) {
        if (cur.y + lh > h - padBot) cur = createPage(canvases.length + 1);
        cur.ctx.fillStyle = blk.color || '#1e293b';
        cur.ctx.font = `${blk.bold ? '700' : '400'} ${fontSize}px "Pretendard", "Malgun Gothic", sans-serif`;
        cur.ctx.fillText(ln, padX + indent, cur.y);
        cur.y += lh;
      }
      cur.y += 10;
    }

    return canvases;
  }

  // ---- File Parsers (Image, TXT/MD, HTML, DOCX, PPTX, HWPX/HWP) ----
  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 디코딩 실패')); };
      img.src = url;
    });
  }

  async function convertImageFileToCanvases(file, pagePreset) {
    const img = await loadImageFromBlob(file);
    const { w, h } = getPageDimensions(pagePreset);
    const pad = 48;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min((w - pad * 2) / img.width, (h - pad * 2) / img.height);
    const dw = Math.round(img.width * scale);
    const dh = Math.round(img.height * scale);
    ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
    return [c];
  }

  async function convertTextOrMdToCanvases(file, pagePreset) {
    const raw = await file.text();
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    for (const ln of lines) {
      const hm = ln.match(/^(#{1,3})\s+(.+)$/);
      if (hm) blocks.push({ type: 'heading', level: hm[1].length, text: hm[2].trim() });
      else if (/^\s*[-*•]\s+/.test(ln)) blocks.push({ type: 'bullet', text: ln.replace(/^\s*[-*•]\s+/, '') });
      else blocks.push({ type: 'p', text: ln });
    }
    return renderBlocksToCanvases(blocks, { title: file.name, pagePreset });
  }

  async function convertHtmlFileToCanvases(file, pagePreset) {
    const raw = await file.text();
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
    const blocks = [];
    const walk = (el) => {
      if (!el) return;
      const tag = (el.tagName || '').toUpperCase();
      if (/^H[1-6]$/.test(tag)) {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'heading', level: Math.min(3, Number(tag[1])), text: t });
        return;
      }
      if (tag === 'TABLE') {
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.querySelectorAll('th, td')).map((td) => td.textContent.trim())
        ).filter((r) => r.length > 0);
        if (rows.length) blocks.push({ type: 'table', rows });
        return;
      }
      if (tag === 'LI') {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'bullet', text: t });
        return;
      }
      if (tag === 'P' || tag === 'PRE' || tag === 'BLOCKQUOTE') {
        const t = el.textContent.trim();
        if (t) blocks.push({ type: 'p', text: t });
        return;
      }
      if (el.children && el.children.length > 0) {
        Array.from(el.children).forEach(walk);
      } else {
        const t = (el.textContent || '').trim();
        if (t) blocks.push({ type: 'p', text: t });
      }
    };
    walk(doc.body);
    if (blocks.length === 0) blocks.push({ type: 'p', text: doc.body?.textContent?.trim() || raw.slice(0, 4000) });
    return renderBlocksToCanvases(blocks, { title: doc.title || file.name, pagePreset });
  }

  async function convertDocxToCanvases(file, pagePreset) {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xmlStr = await zip.file('word/document.xml')?.async('string');
    if (!xmlStr) throw new Error('word/document.xml을 찾을 수 없는 DOCX 파일입니다.');
    const xml = new DOMParser().parseFromString(xmlStr, 'application/xml');
    const blocks = [];
    const body = xml.getElementsByTagNameNS('*', 'body')[0] || xml.documentElement;
    Array.from(body.childNodes || []).forEach((node) => {
      const local = node.localName;
      if (local === 'p') {
        const texts = Array.from(node.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join('');
        if (!texts.trim()) return;
        const pStyle = node.getElementsByTagNameNS('*', 'pStyle')[0]?.getAttribute('w:val') || '';
        if (/Heading1|제목1/i.test(pStyle)) blocks.push({ type: 'heading', level: 1, text: texts.trim() });
        else if (/Heading2|제목2/i.test(pStyle)) blocks.push({ type: 'heading', level: 2, text: texts.trim() });
        else if (/Heading|제목/i.test(pStyle)) blocks.push({ type: 'heading', level: 3, text: texts.trim() });
        else blocks.push({ type: 'p', text: texts.trim() });
      } else if (local === 'tbl') {
        const rows = Array.from(node.getElementsByTagNameNS('*', 'tr')).map((tr) =>
          Array.from(tr.getElementsByTagNameNS('*', 'tc')).map((tc) =>
            Array.from(tc.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join('').trim()
          )
        ).filter((r) => r.some(Boolean));
        if (rows.length) blocks.push({ type: 'table', rows });
      }
    });
    if (!blocks.length) blocks.push({ type: 'p', text: '(텍스트가 비어 있는 Word 문서)' });
    return renderBlocksToCanvases(blocks, { title: file.name, pagePreset });
  }

  async function convertPptxToCanvases(file, pagePreset) {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const slideFiles = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
    if (!slideFiles.length) throw new Error('슬라이드를 찾을 수 없는 PPTX 파일입니다.');

    const blocks = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xmlStr = await zip.file(slideFiles[i]).async('string');
      const xml = new DOMParser().parseFromString(xmlStr, 'application/xml');
      blocks.push({ type: 'slide-header', text: `슬라이드 ${i + 1} / ${slideFiles.length}` });
      const paras = Array.from(xml.getElementsByTagNameNS('*', 'p'));
      paras.forEach((p, pIdx) => {
        const txt = Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join('').trim();
        if (!txt) return;
        if (pIdx === 0) blocks.push({ type: 'heading', level: 2, text: txt });
        else blocks.push({ type: 'bullet', text: txt, fontSize: 25 });
      });
    }
    return renderBlocksToCanvases(blocks, { title: file.name, pagePreset: pagePreset === 'a4-portrait' ? 'slide-16-9' : pagePreset });
  }

  async function convertHwpOrHwpxToCanvases(file, pagePreset) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    const blocks = [];

    if (isZip) {
      // HWPX (ZIP XML)
      const JSZip = await ensureJSZip();
      const zip = await JSZip.loadAsync(buf);
      const sections = Object.keys(zip.files)
        .filter((k) => /^Contents\/section\d+\.xml$/i.test(k))
        .sort();
      for (const sec of sections) {
        const xmlStr = await zip.file(sec).async('string');
        const xml = new DOMParser().parseFromString(xmlStr, 'application/xml');
        const paras = Array.from(xml.getElementsByTagNameNS('*', 'p'));
        paras.forEach((p) => {
          const txt = Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join('').trim();
          if (txt) blocks.push({ type: 'p', text: txt });
        });
      }
    } else {
      // HWP 5.0 binary fallback: extract readable UTF-16LE Korean/ASCII text runs
      const decoded = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
      const runs = decoded.match(/[가-힣A-Za-z0-9\s.,:;()\-?!%+/[\]]{6,}/g) || [];
      const cleaned = runs
        .map((r) => r.replace(/\s+/g, ' ').trim())
        .filter((r) => /[가-힣A-Za-z]{2,}/.test(r) && !/^Root Entry|FileHeader|DocInfo|BodyText|PrvText/i.test(r));
      if (cleaned.length > 0) {
        blocks.push({ type: 'heading', level: 2, text: file.name });
        cleaned.slice(0, 200).forEach((line) => blocks.push({ type: 'p', text: line }));
      } else {
        blocks.push({ type: 'heading', level: 2, text: file.name });
        blocks.push({ type: 'p', text: '압축된 구형 HWP 5.0 파일입니다. 더 정확한 서식 변환을 위해 한글에서 .hwpx로 저장하거나 내장 OCR 추출기를 함께 활용해 주세요.' });
      }
    }

    if (!blocks.length) blocks.push({ type: 'p', text: '(추출된 본문 텍스트가 없습니다)' });
    return renderBlocksToCanvases(blocks, { title: file.name, pagePreset });
  }

  async function convertSingleFile(file, pagePreset) {
    const ext = String(file.name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
      return convertImageFileToCanvases(file, pagePreset);
    }
    if (['txt', 'md', 'markdown', 'csv', 'json', 'log'].includes(ext)) {
      return convertTextOrMdToCanvases(file, pagePreset);
    }
    if (['html', 'htm'].includes(ext)) {
      return convertHtmlFileToCanvases(file, pagePreset);
    }
    if (ext === 'docx') {
      return convertDocxToCanvases(file, pagePreset);
    }
    if (ext === 'pptx') {
      return convertPptxToCanvases(file, pagePreset);
    }
    if (ext === 'hwpx' || ext === 'hwp') {
      return convertHwpOrHwpxToCanvases(file, pagePreset);
    }
    throw new Error(`지원하지 않는 형식(.${ext})입니다.`);
  }

  function mountPdfConverterApp(container, hooks = {}) {
    let queuedFiles = [];
    let lastCanvases = [];
    let lastPdfBlob = null;
    let lastPdfName = 'converted.pdf';

    container.innerHTML = `
      <div class="sb-tool-app">
        <div class="sb-tool-head">
          <div>
            <h3 style="margin:0; font-size:1rem;">📑 오프라인 만능 PDF 변환기</h3>
            <p class="sb-muted-sm" style="margin:3px 0 0;">PPTX · HWP/HWPX · Word(.docx) · HTML · TXT/MD · 이미지를 즉시 PDF로 변환합니다 (100% 오프라인)</p>
          </div>
          <div class="sb-tool-opts">
            <select id="pdfc-page-size" class="sb-select-sm" title="출력 페이지 크기">
              <option value="a4-portrait" selected>A4 세로</option>
              <option value="a4-landscape">A4 가로</option>
              <option value="slide-16-9">슬라이드 16:9</option>
            </select>
            <label class="sb-check-inline" style="font-size:0.76rem;">
              <input type="checkbox" id="pdfc-merge" checked>
              <span>1개 PDF로 병합</span>
            </label>
          </div>
        </div>

        <div class="sb-tool-dropzone" id="pdfc-dropzone">
          <div class="sb-tool-drop-ico">📄 → 📕</div>
          <div class="sb-tool-drop-title">파일을 여기로 드래그하거나 클릭해서 선택하세요</div>
          <div class="sb-muted-sm">지원 형식: PPTX · HWP / HWPX · DOCX(Word) · HTML · TXT · MD · PNG / JPG / WEBP</div>
          <input type="file" id="pdfc-file-input" multiple accept=".pptx,.hwp,.hwpx,.docx,.html,.htm,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.bmp" style="display:none;">
        </div>

        <div class="sb-tool-queue" id="pdfc-queue"></div>

        <div class="sb-tool-actions">
          <button type="button" class="sb-btn-primary" id="pdfc-btn-convert" disabled>⚡ PDF 즉시 변환</button>
          <button type="button" class="sb-btn-subtle" id="pdfc-btn-download" disabled>⬇️ PDF 다운로드</button>
          <button type="button" class="sb-btn-subtle" id="pdfc-btn-save-local" disabled>📂 로컬 폴더·워크스페이스에 PDF 저장</button>
          <button type="button" class="sb-btn-subtle" id="pdfc-btn-clear">초기화</button>
          <span class="sb-muted-sm" id="pdfc-status" style="margin-left:auto;"></span>
        </div>

        <div class="sb-tool-preview-strip" id="pdfc-preview"></div>
      </div>
    `;

    const dropzone = container.querySelector('#pdfc-dropzone');
    const fileInput = container.querySelector('#pdfc-file-input');
    const queueEl = container.querySelector('#pdfc-queue');
    const previewEl = container.querySelector('#pdfc-preview');
    const statusEl = container.querySelector('#pdfc-status');
    const btnConvert = container.querySelector('#pdfc-btn-convert');
    const btnDownload = container.querySelector('#pdfc-btn-download');
    const btnSaveLocal = container.querySelector('#pdfc-btn-save-local');
    const btnClear = container.querySelector('#pdfc-btn-clear');

    function renderQueue() {
      btnConvert.disabled = queuedFiles.length === 0;
      if (queuedFiles.length === 0) {
        queueEl.innerHTML = '';
        return;
      }
      queueEl.innerHTML = queuedFiles.map((f, idx) => `
        <div class="sb-tool-qitem">
          <span>📎 <strong>${esc(f.name)}</strong> <small class="sb-muted-sm">(${(f.size / 1024).toFixed(1)} KB)</small></span>
          <button type="button" class="sb-card-del-btn" data-qdel="${idx}">✕</button>
        </div>
      `).join('');
      queueEl.querySelectorAll('[data-qdel]').forEach((b) => {
        b.addEventListener('click', () => {
          queuedFiles.splice(Number(b.dataset.qdel), 1);
          renderQueue();
        });
      });
    }

    function addFiles(fileList) {
      Array.from(fileList || []).forEach((f) => queuedFiles.push(f));
      renderQueue();
      if (queuedFiles.length > 0) statusEl.textContent = `${queuedFiles.length}개 파일 대기 중`;
    }

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-over');
      addFiles(e.dataTransfer?.files);
    });

    btnClear.addEventListener('click', () => {
      queuedFiles = [];
      lastCanvases = [];
      lastPdfBlob = null;
      previewEl.innerHTML = '';
      statusEl.textContent = '';
      btnDownload.disabled = true;
      btnSaveLocal.disabled = true;
      renderQueue();
    });

    btnConvert.addEventListener('click', async () => {
      if (!queuedFiles.length) return;
      const preset = container.querySelector('#pdfc-page-size')?.value || 'a4-portrait';
      const mergeAll = Boolean(container.querySelector('#pdfc-merge')?.checked);
      btnConvert.disabled = true;
      statusEl.textContent = '변환 중...';
      previewEl.innerHTML = '';
      try {
        const allCanvases = [];
        for (let i = 0; i < queuedFiles.length; i++) {
          const f = queuedFiles[i];
          statusEl.textContent = `변환 중 (${i + 1}/${queuedFiles.length}): ${f.name}`;
          const canvases = await convertSingleFile(f, preset);
          if (!mergeAll && queuedFiles.length > 1) {
            const singleBlob = buildPdfBlobFromCanvases(canvases);
            const base = f.name.replace(/\.[^.]+$/, '');
            triggerBlobDownload(singleBlob, `${base}.pdf`);
          }
          allCanvases.push(...canvases);
        }
        lastCanvases = allCanvases;
        lastPdfBlob = buildPdfBlobFromCanvases(allCanvases);
        const firstBase = queuedFiles[0].name.replace(/\.[^.]+$/, '');
        lastPdfName = queuedFiles.length === 1 ? `${firstBase}.pdf` : `${firstBase}_외${queuedFiles.length - 1}건_통합.pdf`;

        previewEl.innerHTML = allCanvases.slice(0, 12).map((c, idx) => `
          <div class="sb-tool-thumb">
            <img src="${c.toDataURL('image/jpeg', 0.65)}" alt="Page ${idx + 1}">
            <span>p.${idx + 1}</span>
          </div>
        `).join('');

        btnDownload.disabled = false;
        btnSaveLocal.disabled = false;
        statusEl.textContent = `✅ 변환 완료! 총 ${allCanvases.length}페이지 (${(lastPdfBlob.size / 1024).toFixed(1)} KB)`;
        hooks.showToast?.(`📕 PDF 변환 완료 (${allCanvases.length}페이지)`);
      } catch (err) {
        statusEl.textContent = `⚠️ 오류: ${err.message}`;
        hooks.showToast?.(`⚠️ PDF 변환 실패: ${err.message}`);
      } finally {
        btnConvert.disabled = queuedFiles.length === 0;
      }
    });

    function triggerBlobDownload(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    btnDownload.addEventListener('click', () => {
      if (!lastPdfBlob) return;
      triggerBlobDownload(lastPdfBlob, lastPdfName);
      hooks.showToast?.(`⬇️ "${lastPdfName}" 다운로드됨`);
    });

    btnSaveLocal.addEventListener('click', async () => {
      if (!lastPdfBlob) return;
      if (typeof hooks.onSavePdfToWorkspace === 'function') {
        await hooks.onSavePdfToWorkspace(lastPdfBlob, lastPdfName);
      } else {
        triggerBlobDownload(lastPdfBlob, lastPdfName);
      }
    });
  }

  global.BrainPdfConverter = {
    mountPdfConverterApp,
    buildPdfBlobFromCanvases
  };
})(window);
