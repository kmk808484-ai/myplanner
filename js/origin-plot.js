(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const SERIES_PALETTE = [
    '#1f2937', // Origin classic black/charcoal
    '#dc2626', // Crimson red
    '#2563eb', // Royal blue
    '#059669', // Emerald green
    '#7c3aed', // Violet
    '#d97706', // Amber
    '#0891b2', // Cyan
    '#db2777'  // Magenta
  ];

  const SYMBOL_CATALOG = [
    { value: 'circle',        label: '● 원 (채움)' },
    { value: 'square',        label: '■ 사각형 (채움)' },
    { value: 'triangle',      label: '▲ 삼각형 (채움)' },
    { value: 'diamond',       label: '◆ 마름모 (채움)' },
    { value: 'triangle-down', label: '▼ 역삼각형 (채움)' },
    { value: 'open-circle',   label: '○ 빈 원 (속 빔)' },
    { value: 'open-square',   label: '□ 빈 사각형 (속 빔)' },
    { value: 'open-triangle', label: '△ 빈 삼각형 (속 빔)' },
    { value: 'open-diamond',  label: '◇ 빈 마름모 (속 빔)' },
    { value: 'dot-circle',    label: '⊙ 점 원 (중심점)' },
    { value: 'dot-square',    label: '⊡ 점 사각형 (중심점)' },
    { value: 'dot-triangle',  label: '◬ 점 삼각형 (중심점)' },
    { value: 'cross',         label: '✕ X 표시' },
    { value: 'plus',          label: '✚ + 표시' },
    { value: 'asterisk',      label: '✳ 별표 (*)' }
  ];

  const SYMBOL_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'open-circle', 'open-square', 'dot-circle', 'cross'];

  const LATEX_SYMBOLS = {
    '\\Delta': 'Δ', '\\delta': 'δ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ',
    '\\Gamma': 'Γ', '\\theta': 'θ', '\\Theta': 'Θ', '\\lambda': 'λ', '\\Lambda': 'Λ',
    '\\mu': 'μ', '\\nu': 'ν', '\\pi': 'π', '\\Pi': 'Π', '\\rho': 'ρ', '\\sigma': 'σ',
    '\\Sigma': 'Σ', '\\tau': 'τ', '\\phi': 'φ', '\\Phi': 'Φ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Omega': 'Ω', '\\eta': 'η', '\\epsilon': 'ε', '\\varepsilon': 'ε', '\\kappa': 'κ',
    '\\pm': '±', '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\approx': '≈',
    '\\neq': '≠', '\\leq': '≤', '\\geq': '≥', '\\infty': '∞', '\\degree': '°',
    '\\circ': '°', '\\rightarrow': '→', '\\leftarrow': '←', '\\partial': '∂', '\\nabla': '∇'
  };

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildSymbolOptionsHtml(selectedVal) {
    return SYMBOL_CATALOG.map((opt) =>
      `<option value="${opt.value}" ${selectedVal === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
  }

  function createDefaultPlotConfig() {
    return {
      title: '',
      plotType: 'line-symbol', // 'scatter' | 'line' | 'line-symbol' | 'bar' | 'area'
      xCol: null,
      frameBox: true,
      inwardTicks: true,
      showGrid: false,
      showLegend: true,
      legendPos: { x: 0.04, y: 0.05 },
      legendStyle: {
        fontSize: 11,
        displayMode: 'both', // 'both' | 'symbol' | 'line' | 'text'
        showBorder: true
      },
      legendOrder: [], // array of keys: 's:<colIdx>' or 'fit:<id>'
      legendOverrides: {}, // key -> { label?: string, displayMode?: string, hidden?: boolean }
      inspectorWidth: 232,
      xAxis: { title: '', min: '', max: '', increment: '', minorCount: 4, scale: 'linear' },
      yAxis: { title: '', min: '', max: '', increment: '', minorCount: 4, scale: 'linear' },
      y2Axis: { enabled: false, title: '', min: '', max: '', increment: '', minorCount: 4, scale: 'linear' },
      seriesStyles: {}, // colIdx -> { color, symbol, symbolSize, lineWidth, lineStyle, yAxis, visible, plotType }
      pointOverrides: {}, // "colIdx:rowIdx" -> { symbol?, symbolSize?, color? }
      fitOverlays: [], // [{ id, label, eqText, r2, points, color, yAxis, showInLegend }]
      annotations: [] // [{ id, text, x, y, fontSize, color, bold, hasBox, bgColor }] (x,y normalized 0..1 of SVG)
    };
  }

  function mergePlotConfig(saved) {
    const def = createDefaultPlotConfig();
    if (!saved || typeof saved !== 'object') return def;
    const fits = Array.isArray(saved.fitOverlays)
      ? saved.fitOverlays.map((ov, i) => ({
          id: ov.id || `fit-${i}-${Date.now()}`,
          showInLegend: ov.showInLegend !== false,
          ...ov
        }))
      : [];
    return {
      ...def,
      ...saved,
      legendPos: { ...def.legendPos, ...(saved.legendPos || {}) },
      legendStyle: { ...def.legendStyle, ...(saved.legendStyle || {}) },
      legendOrder: Array.isArray(saved.legendOrder) ? [...saved.legendOrder] : [],
      legendOverrides: { ...(saved.legendOverrides || {}) },
      inspectorWidth: Math.max(190, Math.min(520, Number(saved.inspectorWidth) || def.inspectorWidth)),
      xAxis: { ...def.xAxis, ...(saved.xAxis || {}) },
      yAxis: { ...def.yAxis, ...(saved.yAxis || {}) },
      y2Axis: { ...def.y2Axis, ...(saved.y2Axis || {}) },
      seriesStyles: { ...(saved.seriesStyles || {}) },
      pointOverrides: { ...(saved.pointOverrides || {}) },
      fitOverlays: fits,
      annotations: Array.isArray(saved.annotations) ? saved.annotations.map((a) => ({ ...a })) : []
    };
  }

  // ================= Curve Fitting & Smoothing =================
  function formatCoef(n) {
    if (Math.abs(n) === 0 || Math.abs(n) < 1e-14) return '0';
    if (Math.abs(n) >= 10000 || Math.abs(n) < 0.001) return n.toExponential(3);
    return Number(n.toFixed(4)).toString();
  }

  function linearRegression(points) {
    const n = points.length;
    if (n < 2) throw new Error('선형 회귀에는 최소 2개의 유효한 (X, Y) 데이터 포인트가 필요합니다.');
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of points) {
      sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-15) throw new Error('X 값이 모두 동일하여 선형 회귀를 계산할 수 없습니다.');
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;

    const meanY = sy / n;
    let ssTot = 0, ssRes = 0;
    for (const p of points) {
      const pred = a * p.x + b;
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - pred) ** 2;
    }
    const r2 = ssTot < 1e-15 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    const predict = (x) => a * x + b;
    const sign = b >= 0 ? '+' : '-';
    const formulaOnly = `y = ${formatCoef(a)}x ${sign} ${formatCoef(Math.abs(b))}`;
    const eqText = `${formulaOnly} (R^2 = ${r2.toFixed(4)})`;
    return { type: 'linear', coeffs: [b, a], r2, predict, formulaOnly, eqText };
  }

  function polynomialRegression(points, degree = 2) {
    const deg = Math.max(1, Math.min(4, Math.trunc(degree)));
    const n = points.length;
    if (n < deg + 1) throw new Error(`${deg}차 다항식 피팅에는 최소 ${deg + 1}개의 데이터 포인트가 필요합니다.`);

    const m = deg + 1;
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const B = new Array(m).fill(0);

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        let sum = 0;
        for (const p of points) sum += Math.pow(p.x, i + j);
        A[i][j] = sum;
      }
      let sumY = 0;
      for (const p of points) sumY += p.y * Math.pow(p.x, i);
      B[i] = sumY;
    }

    for (let col = 0; col < m; col++) {
      let pivotRow = col;
      for (let r = col + 1; r < m; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivotRow][col])) pivotRow = r;
      }
      if (Math.abs(A[pivotRow][col]) < 1e-15) {
        throw new Error('다항식 피팅 행렬이 특이(Singular)하여 계산할 수 없습니다.');
      }
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [B[col], B[pivotRow]] = [B[pivotRow], B[col]];

      const pivotVal = A[col][col];
      for (let j = col; j < m; j++) A[col][j] /= pivotVal;
      B[col] /= pivotVal;

      for (let r = 0; r < m; r++) {
        if (r === col) continue;
        const factor = A[r][col];
        for (let j = col; j < m; j++) A[r][j] -= factor * A[col][j];
        B[r] -= factor * B[col];
      }
    }

    const coeffs = B;
    const predict = (x) => {
      let y = 0;
      for (let i = 0; i < coeffs.length; i++) y += coeffs[i] * Math.pow(x, i);
      return y;
    };

    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    let ssTot = 0, ssRes = 0;
    for (const p of points) {
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - predict(p.x)) ** 2;
    }
    const r2 = ssTot < 1e-15 ? 1 : Math.max(0, 1 - ssRes / ssTot);

    const terms = [];
    for (let i = coeffs.length - 1; i >= 0; i--) {
      const c = coeffs[i];
      const absC = formatCoef(Math.abs(c));
      const sign = c >= 0 ? (terms.length ? ' + ' : '') : (terms.length ? ' - ' : '-');
      if (i === 0) terms.push(`${sign}${absC}`);
      else if (i === 1) terms.push(`${sign}${absC}x`);
      else terms.push(`${sign}${absC}x^${i}`);
    }
    const formulaOnly = `y = ${terms.join('')}`;
    const eqText = `${formulaOnly} (R^2 = ${r2.toFixed(4)})`;
    return { type: `poly${deg}`, coeffs, r2, predict, formulaOnly, eqText };
  }

  function exponentialRegression(points) {
    const valid = points.filter((p) => p.y > 0);
    if (valid.length < 2) throw new Error('지수 피팅(y = a·e^{bx})에는 Y > 0 인 데이터가 최소 2개 필요합니다.');
    const linPts = valid.map((p) => ({ x: p.x, y: Math.log(p.y) }));
    const lin = linearRegression(linPts);
    const a = Math.exp(lin.coeffs[0]);
    const b = lin.coeffs[1];
    const predict = (x) => a * Math.exp(b * x);

    const meanY = valid.reduce((s, p) => s + p.y, 0) / valid.length;
    let ssTot = 0, ssRes = 0;
    for (const p of valid) {
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - predict(p.x)) ** 2;
    }
    const r2 = ssTot < 1e-15 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    const formulaOnly = `y = ${formatCoef(a)}·e^{${formatCoef(b)}x}`;
    const eqText = `${formulaOnly} (R^2 = ${r2.toFixed(4)})`;
    return { type: 'exp', coeffs: [a, b], r2, predict, formulaOnly, eqText };
  }

  function powerRegression(points) {
    const valid = points.filter((p) => p.x > 0 && p.y > 0);
    if (valid.length < 2) throw new Error('거듭제곱 피팅(y = a·x^b)에는 X > 0, Y > 0 인 데이터가 최소 2개 필요합니다.');
    const linPts = valid.map((p) => ({ x: Math.log(p.x), y: Math.log(p.y) }));
    const lin = linearRegression(linPts);
    const a = Math.exp(lin.coeffs[0]);
    const b = lin.coeffs[1];
    const predict = (x) => (x > 0 ? a * Math.pow(x, b) : NaN);

    const meanY = valid.reduce((s, p) => s + p.y, 0) / valid.length;
    let ssTot = 0, ssRes = 0;
    for (const p of valid) {
      ssTot += (p.y - meanY) ** 2;
      ssRes += (p.y - predict(p.x)) ** 2;
    }
    const r2 = ssTot < 1e-15 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    const formulaOnly = `y = ${formatCoef(a)}·x^{${formatCoef(b)}}`;
    const eqText = `${formulaOnly} (R^2 = ${r2.toFixed(4)})`;
    return { type: 'power', coeffs: [a, b], r2, predict, formulaOnly, eqText };
  }

  function movingAverage(points, windowSize = 3) {
    const k = Math.max(2, Math.trunc(windowSize));
    if (points.length < k) throw new Error(`이동평균(창 크기 ${k})에는 최소 ${k}개의 데이터가 필요합니다.`);
    const half = Math.floor(k / 2);
    const out = points.map((p, idx) => {
      const start = Math.max(0, idx - half);
      const end = Math.min(points.length - 1, start + k - 1);
      const realStart = Math.max(0, end - k + 1);
      let sum = 0;
      let cnt = 0;
      for (let i = realStart; i <= end; i++) {
        sum += points[i].y;
        cnt++;
      }
      return { x: p.x, y: sum / cnt, row: p.row };
    });
    return {
      type: 'moving-avg',
      windowSize: k,
      points: out,
      formulaOnly: `Moving Avg (k=${k})`,
      eqText: `Moving Avg (k=${k})`
    };
  }

  function computeFit(points, method) {
    const sortedX = [...points].sort((a, b) => a.x - b.x);
    const minX = sortedX[0]?.x ?? 0;
    const maxX = sortedX[sortedX.length - 1]?.x ?? 1;
    let fitRes;
    let curvePts = [];

    if (method === 'linear') {
      fitRes = linearRegression(points);
      curvePts = [{ x: minX, y: fitRes.predict(minX) }, { x: maxX, y: fitRes.predict(maxX) }];
    } else if (method.startsWith('poly')) {
      const deg = Number(method.slice(4));
      fitRes = polynomialRegression(points, deg);
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = minX + ((maxX - minX) * i) / steps;
        curvePts.push({ x, y: fitRes.predict(x) });
      }
    } else if (method === 'exp') {
      fitRes = exponentialRegression(points);
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = minX + ((maxX - minX) * i) / steps;
        const y = fitRes.predict(x);
        if (Number.isFinite(y)) curvePts.push({ x, y });
      }
    } else if (method === 'power') {
      fitRes = powerRegression(points);
      const posMinX = Math.max(1e-9, sortedX.find((p) => p.x > 0)?.x ?? minX);
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const x = posMinX + ((maxX - posMinX) * i) / steps;
        const y = fitRes.predict(x);
        if (Number.isFinite(y)) curvePts.push({ x, y });
      }
    } else {
      const k = Number(method.slice(2)) || 3;
      fitRes = movingAverage(points, k);
      curvePts = fitRes.points.map((p) => ({ x: p.x, y: p.y }));
    }

    return { fitRes, curvePts };
  }

  // ================= Offline LaTeX / Scientific Math SVG Renderer =================
  function parseRichMathSegments(rawText) {
    let text = String(rawText || '').trim();
    if (!text) return [];
    text = text.replace(/\$([^$]+)\$/g, '$1');
    text = text.replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1');
    Object.keys(LATEX_SYMBOLS).forEach((cmd) => {
      text = text.split(cmd).join(LATEX_SYMBOLS[cmd]);
    });

    const segments = [];
    let i = 0;
    while (i < text.length) {
      if ((text[i] === '^' || text[i] === '_') && i + 1 < text.length) {
        const mode = text[i] === '^' ? 'sup' : 'sub';
        i++;
        let content = '';
        if (text[i] === '{') {
          i++;
          let depth = 1;
          while (i < text.length && depth > 0) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            if (depth > 0) content += text[i++];
          }
        } else {
          content = text[i++];
        }
        segments.push({ mode, text: content });
        continue;
      }
      let plain = '';
      while (i < text.length && text[i] !== '^' && text[i] !== '_') {
        plain += text[i++];
      }
      if (plain) segments.push({ mode: 'normal', text: plain });
    }
    return segments;
  }

  function createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((k) => {
      if (attrs[k] !== undefined && attrs[k] !== null) {
        el.setAttribute(k, String(attrs[k]));
      }
    });
    return el;
  }

  function appendRichTextToSvgText(textEl, rawText, baseFontSize = 13) {
    const segs = parseRichMathSegments(rawText);
    if (segs.length === 0) return;
    let prevDy = 0;
    segs.forEach((seg) => {
      const tspan = createSvgEl('tspan');
      if (seg.mode === 'sup') {
        tspan.setAttribute('font-size', `${Math.round(baseFontSize * 0.74)}px`);
        tspan.setAttribute('dy', `${-Math.round(baseFontSize * 0.36) - prevDy}px`);
        prevDy = -Math.round(baseFontSize * 0.36);
      } else if (seg.mode === 'sub') {
        tspan.setAttribute('font-size', `${Math.round(baseFontSize * 0.74)}px`);
        tspan.setAttribute('dy', `${Math.round(baseFontSize * 0.28) - prevDy}px`);
        prevDy = Math.round(baseFontSize * 0.28);
      } else {
        if (prevDy !== 0) {
          tspan.setAttribute('dy', `${-prevDy}px`);
          prevDy = 0;
        }
      }
      tspan.textContent = seg.text;
      textEl.appendChild(tspan);
    });
  }

  // ================= Nice Axis Scale & Tick Calculator =================
  function niceStep(range, targetTicks = 6) {
    if (range <= 0 || !Number.isFinite(range)) return 1;
    const rough = range / Math.max(2, targetTicks);
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / pow10;
    let nice;
    if (norm <= 1.2) nice = 1;
    else if (norm <= 2.4) nice = 2;
    else if (norm <= 3.5) nice = 2.5;
    else if (norm <= 6.5) nice = 5;
    else nice = 10;
    return nice * pow10;
  }

  function formatTickNumber(v) {
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1).replace('+', '');
    return String(Math.round(v * 1e6) / 1e6);
  }

  function computeAxisScale(values, axisCfg, zoomRange = null) {
    const isLog = axisCfg.scale === 'log';
    const valid = values.filter((v) => Number.isFinite(v) && (!isLog || v > 0));

    let minVal = valid.length > 0 ? Math.min(...valid) : (isLog ? 1 : 0);
    let maxVal = valid.length > 0 ? Math.max(...valid) : (isLog ? 100 : 10);

    if (minVal === maxVal) {
      if (isLog) { minVal /= 10; maxVal *= 10; }
      else { const pad = minVal === 0 ? 1 : Math.abs(minVal) * 0.1; minVal -= pad; maxVal += pad; }
    } else if (!zoomRange) {
      if (isLog) {
        minVal = Math.pow(10, Math.floor(Math.log10(minVal)));
        maxVal = Math.pow(10, Math.ceil(Math.log10(maxVal)));
      } else {
        const span = maxVal - minVal;
        const step = niceStep(span, 5);
        minVal = Math.floor((minVal - span * 0.04) / step) * step;
        maxVal = Math.ceil((maxVal + span * 0.04) / step) * step;
      }
    }

    if (zoomRange) {
      minVal = zoomRange[0];
      maxVal = zoomRange[1];
    } else {
      const cfgMin = axisCfg.min !== '' && axisCfg.min !== null && axisCfg.min !== undefined ? Number(axisCfg.min) : NaN;
      const cfgMax = axisCfg.max !== '' && axisCfg.max !== null && axisCfg.max !== undefined ? Number(axisCfg.max) : NaN;
      if (Number.isFinite(cfgMin) && (!isLog || cfgMin > 0)) minVal = cfgMin;
      if (Number.isFinite(cfgMax) && (!isLog || cfgMax > 0)) maxVal = cfgMax;
    }

    if (minVal >= maxVal) maxVal = isLog ? minVal * 10 : minVal + 1;

    const majorTicks = [];
    const minorTicks = [];
    const minorCount = Math.max(0, Math.min(9, Math.trunc(Number(axisCfg.minorCount ?? 4))));

    if (isLog) {
      const loPow = Math.floor(Math.log10(minVal));
      const hiPow = Math.ceil(Math.log10(maxVal));
      for (let p = loPow; p <= hiPow; p++) {
        const v = Math.pow(10, p);
        if (v >= minVal * 0.9999 && v <= maxVal * 1.0001) {
          majorTicks.push({ val: v, label: `10^${p}` });
        }
        if (minorCount > 0) {
          for (let m = 2; m <= 9; m++) {
            const mv = m * Math.pow(10, p);
            if (mv > minVal && mv < maxVal) minorTicks.push(mv);
          }
        }
      }
    } else {
      const cfgInc = axisCfg.increment !== '' && axisCfg.increment !== null && axisCfg.increment !== undefined
        ? Number(axisCfg.increment) : NaN;
      let step = Number.isFinite(cfgInc) && cfgInc > 0 ? cfgInc : niceStep(maxVal - minVal, 6);
      if ((maxVal - minVal) / step > 40) step = niceStep(maxVal - minVal, 8);

      const first = Math.ceil((minVal - step * 1e-6) / step) * step;
      for (let v = first; v <= maxVal + step * 1e-6; v += step) {
        const cleanV = Math.abs(v) < step * 1e-9 ? 0 : Math.round(v * 1e10) / 1e10;
        majorTicks.push({ val: cleanV, label: formatTickNumber(cleanV) });
      }
      if (minorCount > 0) {
        const subStep = step / (minorCount + 1);
        const startM = first - step;
        for (let v = startM; v <= maxVal + subStep * 0.5; v += subStep) {
          if (v <= minVal + subStep * 0.05 || v >= maxVal - subStep * 0.05) continue;
          const isMaj = majorTicks.some((t) => Math.abs(t.val - v) < subStep * 0.15);
          if (!isMaj) minorTicks.push(v);
        }
      }
    }

    return { min: minVal, max: maxVal, isLog, majorTicks, minorTicks };
  }

  // ================= Expanded Origin Symbol Library =================
  function drawSymbol(shape, cx, cy, r, color, outlineColor = '#ffffff') {
    const sw = Math.max(1.4, r * 0.32);
    const dotR = Math.max(1.3, r * 0.34);

    // Filled symbols
    if (shape === 'square') {
      return createSvgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, fill: color, stroke: outlineColor, 'stroke-width': 1 });
    }
    if (shape === 'triangle') {
      const h = r * 1.18;
      return createSvgEl('polygon', { points: `${cx},${cy - h} ${cx - h},${cy + h * 0.85} ${cx + h},${cy + h * 0.85}`, fill: color, stroke: outlineColor, 'stroke-width': 1 });
    }
    if (shape === 'triangle-down') {
      const h = r * 1.18;
      return createSvgEl('polygon', { points: `${cx},${cy + h} ${cx - h},${cy - h * 0.85} ${cx + h},${cy - h * 0.85}`, fill: color, stroke: outlineColor, 'stroke-width': 1 });
    }
    if (shape === 'diamond') {
      const d = r * 1.26;
      return createSvgEl('polygon', { points: `${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`, fill: color, stroke: outlineColor, 'stroke-width': 1 });
    }

    // Hollow / Open symbols (안이 빈 심볼)
    if (shape === 'open-circle') {
      return createSvgEl('circle', { cx, cy, r, fill: '#ffffff', stroke: color, 'stroke-width': sw });
    }
    if (shape === 'open-square') {
      return createSvgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, fill: '#ffffff', stroke: color, 'stroke-width': sw });
    }
    if (shape === 'open-triangle') {
      const h = r * 1.18;
      return createSvgEl('polygon', { points: `${cx},${cy - h} ${cx - h},${cy + h * 0.85} ${cx + h},${cy + h * 0.85}`, fill: '#ffffff', stroke: color, 'stroke-width': sw });
    }
    if (shape === 'open-diamond') {
      const d = r * 1.26;
      return createSvgEl('polygon', { points: `${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`, fill: '#ffffff', stroke: color, 'stroke-width': sw });
    }

    // Dot-center symbols (중간에 점이 찍힌 심볼)
    if (shape === 'dot-circle') {
      const g = createSvgEl('g');
      g.appendChild(createSvgEl('circle', { cx, cy, r, fill: '#ffffff', stroke: color, 'stroke-width': sw }));
      g.appendChild(createSvgEl('circle', { cx, cy, r: dotR, fill: color }));
      return g;
    }
    if (shape === 'dot-square') {
      const g = createSvgEl('g');
      g.appendChild(createSvgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, fill: '#ffffff', stroke: color, 'stroke-width': sw }));
      g.appendChild(createSvgEl('circle', { cx, cy, r: dotR, fill: color }));
      return g;
    }
    if (shape === 'dot-triangle') {
      const h = r * 1.24;
      const g = createSvgEl('g');
      g.appendChild(createSvgEl('polygon', { points: `${cx},${cy - h} ${cx - h},${cy + h * 0.85} ${cx + h},${cy + h * 0.85}`, fill: '#ffffff', stroke: color, 'stroke-width': sw }));
      g.appendChild(createSvgEl('circle', { cx, cy: cy + h * 0.16, r: dotR * 0.9, fill: color }));
      return g;
    }

    // X / + / * Marks
    if (shape === 'cross') {
      const g = createSvgEl('g', { stroke: color, 'stroke-width': Math.max(1.8, sw), 'stroke-linecap': 'round' });
      g.appendChild(createSvgEl('circle', { cx, cy, r: r + 2, fill: 'transparent', stroke: 'none' }));
      g.appendChild(createSvgEl('line', { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r }));
      g.appendChild(createSvgEl('line', { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r }));
      return g;
    }
    if (shape === 'plus') {
      const d = r * 1.15;
      const g = createSvgEl('g', { stroke: color, 'stroke-width': Math.max(1.8, sw), 'stroke-linecap': 'round' });
      g.appendChild(createSvgEl('circle', { cx, cy, r: d + 2, fill: 'transparent', stroke: 'none' }));
      g.appendChild(createSvgEl('line', { x1: cx - d, y1: cy, x2: cx + d, y2: cy }));
      g.appendChild(createSvgEl('line', { x1: cx, y1: cy - d, x2: cx, y2: cy + d }));
      return g;
    }
    if (shape === 'asterisk') {
      const d = r * 1.12;
      const diag = r * 0.82;
      const g = createSvgEl('g', { stroke: color, 'stroke-width': Math.max(1.6, sw * 0.9), 'stroke-linecap': 'round' });
      g.appendChild(createSvgEl('circle', { cx, cy, r: d + 2, fill: 'transparent', stroke: 'none' }));
      g.appendChild(createSvgEl('line', { x1: cx - d, y1: cy, x2: cx + d, y2: cy }));
      g.appendChild(createSvgEl('line', { x1: cx, y1: cy - d, x2: cx, y2: cy + d }));
      g.appendChild(createSvgEl('line', { x1: cx - diag, y1: cy - diag, x2: cx + diag, y2: cy + diag }));
      g.appendChild(createSvgEl('line', { x1: cx - diag, y1: cy + diag, x2: cx + diag, y2: cy - diag }));
      return g;
    }

    // Default filled circle
    return createSvgEl('circle', { cx, cy, r, fill: color, stroke: outlineColor, 'stroke-width': 1 });
  }

  function getStrokeDash(lineStyle) {
    if (lineStyle === 'dashed') return '7,4';
    if (lineStyle === 'dotted') return '2,3';
    if (lineStyle === 'dashdot') return '8,3,2,3';
    return '';
  }

  // ================= Interactive Origin Plot Controller =================
  function mountOriginPlotPanel(canvasContainer, inspectorContainer, callbacks = {}) {
    let plotConfig = mergePlotConfig(callbacks.getPlotConfig ? callbacks.getPlotConfig() : null);
    let currentDataset = { xCol: 0, xTitle: 'X', series: [] };
    let interactionMode = 'select'; // 'select' | 'zoom' | 'reader'
    let zoomState = null;
    let lastRenderGeometry = null;
    let currentSvgEl = null;

    // Selection state: { type: 'series', colIdx } | { type: 'fit', fitId } | { type: 'annotation', id } | null
    let selectedObj = null;

    // Build Canvas DOM
    canvasContainer.innerHTML = '';
    const plotShell = document.createElement('div');
    plotShell.className = 'origin-plot-shell';
    plotShell.tabIndex = 0;

    const plotBar = document.createElement('div');
    plotBar.className = 'origin-plot-bar';
    plotBar.innerHTML = `
      <span class="origin-plot-bar-title">📈 Origin</span>
      <div class="origin-plot-bar-tools">
        <button type="button" class="sb-tb-btn active" data-tool="select" title="계열 선택(클릭), 삭제(Del), 점 심볼 편집(더블클릭), 커브 피팅(우클릭)">↖️ 선택</button>
        <button type="button" class="sb-tb-btn" data-tool="zoom" title="마우스 드래그로 영역 확대">🔍 줌</button>
        <button type="button" class="sb-tb-btn" data-tool="reader" title="데이터 포인트에 스냅하여 정확한 (X, Y) 좌표 읽기">🎯 리더</button>
        <button type="button" class="sb-tb-btn" data-tool="add-text" title="그래프에 자유 텍스트/수식 삽입 (드래그 이동 가능)">T 텍스트</button>
        <button type="button" class="sb-tb-btn" data-tool="fit-modal" title="커브 피팅 (미리보기 & 수식 박스)">📐 피팅</button>
        <button type="button" class="sb-tb-btn" data-tool="legend-props" title="범례 이름·표현방식·순서·크기 설정">🏷️ 범례</button>
        <button type="button" class="sb-tb-btn" data-tool="reset-zoom" title="축 범위 원래대로">↺</button>
        <button type="button" class="sb-tb-btn" data-tool="export-svg" title="논문·보고서용 벡터 SVG 저장">SVG</button>
        <button type="button" class="sb-tb-btn" data-tool="export-png" title="300 DPI 고해상도 PNG 저장">PNG</button>
        <button type="button" class="sb-tb-btn" data-tool="toggle-inspector" title="그래프 속성 인스펙터 열기/닫기">🎛️ 속성</button>
      </div>
    `;

    const svgStage = document.createElement('div');
    svgStage.className = 'origin-svg-stage';

    const readerHud = document.createElement('div');
    readerHud.className = 'origin-reader-hud';
    readerHud.style.display = 'none';

    const selectionHint = document.createElement('div');
    selectionHint.className = 'origin-sel-hud';
    selectionHint.style.display = 'none';

    // Floating Context Menu (right-click series/fit/annotation/canvas)
    const ctxMenu = document.createElement('div');
    ctxMenu.className = 'origin-plot-ctxmenu';
    ctxMenu.style.display = 'none';

    // Inline Popover (Single Point Editor / Text Editor)
    const floatPopover = document.createElement('div');
    floatPopover.className = 'origin-float-popover';
    floatPopover.style.display = 'none';

    // Modal Overlay inside plotShell (Curve Fitting Preview / Legend Properties)
    const plotModal = document.createElement('div');
    plotModal.className = 'origin-plot-modal-overlay';
    plotModal.style.display = 'none';

    plotShell.appendChild(plotBar);
    plotShell.appendChild(svgStage);
    plotShell.appendChild(readerHud);
    plotShell.appendChild(selectionHint);
    plotShell.appendChild(ctxMenu);
    plotShell.appendChild(floatPopover);
    plotShell.appendChild(plotModal);
    canvasContainer.appendChild(plotShell);

    // ---- Draggable Resizer for Plot Inspector ----
    let inspResizer = null;
    function setupInspectorResizer() {
      if (!inspectorContainer || !inspectorContainer.parentElement) return;
      const parent = inspectorContainer.parentElement;
      inspResizer = parent.querySelector('.origin-insp-resizer');
      if (!inspResizer) {
        inspResizer = document.createElement('div');
        inspResizer.className = 'origin-insp-resizer';
        inspResizer.title = '드래그하여 그래프 속성 패널 너비 조절';
        parent.insertBefore(inspResizer, inspectorContainer);
      }
      inspectorContainer.style.width = `${plotConfig.inspectorWidth || 232}px`;

      const syncResizerVisibility = () => {
        if (!inspResizer) return;
        const hidden = inspectorContainer.style.display === 'none';
        inspResizer.style.display = hidden ? 'none' : 'block';
      };
      syncResizerVisibility();

      inspResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = inspectorContainer.getBoundingClientRect().width || plotConfig.inspectorWidth || 232;
        inspResizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';

        const onMove = (ev) => {
          const delta = startX - ev.clientX;
          const nextW = Math.max(190, Math.min(520, Math.round(startW + delta)));
          plotConfig.inspectorWidth = nextW;
          inspectorContainer.style.width = `${nextW}px`;
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          inspResizer.classList.remove('dragging');
          document.body.style.cursor = '';
          notifyConfigChange();
          renderPlot();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      return syncResizerVisibility;
    }
    const syncResizerVis = setupInspectorResizer() || (() => {});

    function toast(msg) {
      if (typeof callbacks.onToast === 'function') callbacks.onToast(msg);
    }

    function notifyConfigChange() {
      if (typeof callbacks.onConfigChange === 'function') {
        callbacks.onConfigChange(JSON.parse(JSON.stringify(plotConfig)));
      }
    }

    function closePopups() {
      ctxMenu.style.display = 'none';
      floatPopover.style.display = 'none';
    }

    function getSeriesStyle(colIdx, seriesPos) {
      const saved = plotConfig.seriesStyles[colIdx] || {};
      return {
        color: saved.color || SERIES_PALETTE[seriesPos % SERIES_PALETTE.length],
        symbol: saved.symbol || SYMBOL_SHAPES[seriesPos % SYMBOL_SHAPES.length],
        symbolSize: Number(saved.symbolSize || 5),
        lineWidth: Number(saved.lineWidth ?? 1.8),
        lineStyle: saved.lineStyle || 'solid',
        yAxis: saved.yAxis || 'y1',
        visible: saved.visible !== false,
        plotType: saved.plotType || ''
      };
    }

    function updateSeriesStyle(colIdx, patch) {
      plotConfig.seriesStyles[colIdx] = {
        ...(plotConfig.seriesStyles[colIdx] || {}),
        ...patch
      };
      const hasY2 = currentDataset.series.some((s, idx) => getSeriesStyle(s.colIdx, idx).yAxis === 'y2' && getSeriesStyle(s.colIdx, idx).visible);
      if (hasY2) plotConfig.y2Axis.enabled = true;
      notifyConfigChange();
      renderPlot();
    }

    function updateSelectionHud() {
      if (!selectedObj) {
        selectionHint.style.display = 'none';
        return;
      }
      selectionHint.style.display = 'flex';
      if (selectedObj.type === 'series') {
        const s = currentDataset.series.find((x) => x.colIdx === selectedObj.colIdx);
        selectionHint.innerHTML = `<span>✓ 선택됨: <b>${escHtml(s ? s.name : '계열')}</b> · Del 삭제 · 점 더블클릭: 개별 심볼 · 우클릭: 커브 피팅</span>`;
      } else if (selectedObj.type === 'fit') {
        const ov = (plotConfig.fitOverlays || []).find((f) => f.id === selectedObj.fitId);
        selectionHint.innerHTML = `<span>✓ 선택됨: <b>${escHtml(ov ? ov.label : '피팅 선')}</b> · Del 키로 삭제</span>`;
      } else if (selectedObj.type === 'annotation') {
        selectionHint.innerHTML = `<span>✓ 텍스트 박스 선택됨 · 드래그 이동 · 더블클릭 편집 · Del 삭제</span>`;
      }
    }

    function deleteSelectedObject() {
      if (!selectedObj) return false;
      if (selectedObj.type === 'series') {
        const s = currentDataset.series.find((x) => x.colIdx === selectedObj.colIdx);
        updateSeriesStyle(selectedObj.colIdx, { visible: false });
        toast(`🗑️ "${s ? s.name : '계열'}" 숨김 처리됨 (우측 속성에서 다시 켤 수 있습니다)`);
        selectedObj = null;
        renderInspector();
        renderPlot();
        return true;
      }
      if (selectedObj.type === 'fit') {
        plotConfig.fitOverlays = (plotConfig.fitOverlays || []).filter((f) => f.id !== selectedObj.fitId);
        selectedObj = null;
        notifyConfigChange();
        renderInspector();
        renderPlot();
        toast('🗑️ 선택된 커브 피팅 선이 삭제되었습니다.');
        return true;
      }
      if (selectedObj.type === 'annotation') {
        plotConfig.annotations = (plotConfig.annotations || []).filter((a) => a.id !== selectedObj.id);
        selectedObj = null;
        notifyConfigChange();
        renderPlot();
        toast('🗑️ 선택된 텍스트 박스가 삭제되었습니다.');
        return true;
      }
      return false;
    }

    // ---- Build Ordered Legend Entries ----
    function buildLegendEntries(visibleSeries, hasY2) {
      const rawMap = new Map();
      visibleSeries.forEach((s) => {
        const key = `s:${s.colIdx}`;
        const pType = s.style.plotType || plotConfig.plotType;
        const ov = plotConfig.legendOverrides[key] || {};
        rawMap.set(key, {
          key,
          kind: 'series',
          colIdx: s.colIdx,
          defaultLabel: s.name + (hasY2 ? (s.style.yAxis === 'y2' ? ' [Y2]' : ' [Y1]') : ''),
          label: ov.label !== undefined && ov.label !== '' ? ov.label : (s.name + (hasY2 ? (s.style.yAxis === 'y2' ? ' [Y2]' : ' [Y1]') : '')),
          color: s.style.color,
          symbol: (pType === 'scatter' || pType === 'line-symbol') ? s.style.symbol : '',
          hasLine: pType !== 'scatter',
          dash: getStrokeDash(s.style.lineStyle),
          displayMode: ov.displayMode || plotConfig.legendStyle.displayMode || 'both',
          hidden: Boolean(ov.hidden)
        });
      });

      (plotConfig.fitOverlays || []).forEach((ovItem) => {
        if (ovItem.showInLegend === false) return;
        const key = `fit:${ovItem.id}`;
        const ov = plotConfig.legendOverrides[key] || {};
        rawMap.set(key, {
          key,
          kind: 'fit',
          fitId: ovItem.id,
          defaultLabel: ovItem.eqText || ovItem.label,
          label: ov.label !== undefined && ov.label !== '' ? ov.label : (ovItem.eqText || ovItem.label),
          color: ovItem.color || '#dc2626',
          symbol: '',
          hasLine: true,
          dash: '6,3',
          displayMode: ov.displayMode || plotConfig.legendStyle.displayMode || 'both',
          hidden: Boolean(ov.hidden)
        });
      });

      const ordered = [];
      const seen = new Set();
      (plotConfig.legendOrder || []).forEach((k) => {
        if (rawMap.has(k) && !seen.has(k)) {
          ordered.push(rawMap.get(k));
          seen.add(k);
        }
      });
      rawMap.forEach((val, k) => {
        if (!seen.has(k)) ordered.push(val);
      });
      return ordered;
    }

    // ---- Popover: Double-Click Single Data Point Symbol Editor ----
    function openPointSymbolEditor(clientX, clientY, colIdx, rowIdx, seriesStyle, ptData) {
      closePopups();
      const key = `${colIdx}:${rowIdx}`;
      const existing = plotConfig.pointOverrides[key] || {};
      const curSymbol = existing.symbol || seriesStyle.symbol;
      const curSize = existing.symbolSize ?? seriesStyle.symbolSize;
      const curColor = existing.color || seriesStyle.color;

      const shellRect = plotShell.getBoundingClientRect();
      const left = Math.max(8, Math.min(shellRect.width - 266, clientX - shellRect.left + 10));
      const top = Math.max(40, Math.min(shellRect.height - 230, clientY - shellRect.top + 10));

      floatPopover.innerHTML = `
        <div class="origin-pop-head">
          <span>🎯 개별 점 심볼 편집 (행 ${rowIdx + 1})</span>
          <button type="button" class="origin-pop-close" data-pclose="1">✕</button>
        </div>
        <div class="origin-pop-sub">X = ${ptData.x}, Y = ${ptData.y}</div>
        <label class="insp-field"><span>심볼 모양</span>
          <select data-pf="symbol">${buildSymbolOptionsHtml(curSymbol)}</select>
        </label>
        <div class="insp-grid-2">
          <label class="insp-field"><span>심볼 크기 (${curSize}px)</span>
            <input type="number" data-pf="symbolSize" value="${curSize}" min="2" max="18" step="0.5">
          </label>
          <label class="insp-field"><span>심볼 색상</span>
            <input type="color" data-pf="color" value="${escHtml(curColor)}" style="height:26px;padding:2px;">
          </label>
        </div>
        <div class="origin-pop-foot">
          <button type="button" class="sb-tb-btn" data-pact="reset">↺ 기본값</button>
          <button type="button" class="sb-tb-btn primary" data-pact="apply">적용</button>
        </div>
      `;
      floatPopover.style.left = `${left}px`;
      floatPopover.style.top = `${top}px`;
      floatPopover.style.display = 'flex';

      const applyNow = () => {
        plotConfig.pointOverrides[key] = {
          symbol: floatPopover.querySelector('[data-pf="symbol"]').value,
          symbolSize: Math.max(2, Math.min(20, Number(floatPopover.querySelector('[data-pf="symbolSize"]').value) || 5)),
          color: floatPopover.querySelector('[data-pf="color"]').value
        };
        notifyConfigChange();
        renderPlot();
      };

      floatPopover.querySelectorAll('[data-pf]').forEach((inp) => {
        inp.addEventListener('input', applyNow);
        inp.addEventListener('change', applyNow);
      });
      floatPopover.querySelector('[data-pact="apply"]').addEventListener('click', () => {
        applyNow();
        floatPopover.style.display = 'none';
        toast(`🎯 행 ${rowIdx + 1} 개별 데이터 점 심볼이 수정되었습니다.`);
      });
      floatPopover.querySelector('[data-pact="reset"]').addEventListener('click', () => {
        delete plotConfig.pointOverrides[key];
        notifyConfigChange();
        renderPlot();
        floatPopover.style.display = 'none';
        toast(`↺ 행 ${rowIdx + 1} 데이터 점 심볼을 계열 기본값으로 되돌렸습니다.`);
      });
      floatPopover.querySelector('[data-pclose]').addEventListener('click', () => {
        floatPopover.style.display = 'none';
      });
    }

    // ---- Popover: Free Text Annotation Editor ----
    function openTextAnnotationEditor(annot = null, clientX = null, clientY = null) {
      closePopups();
      const isNew = !annot;
      const target = annot || {
        id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: '텍스트 입력 (예: \\Delta P = 12.4 kPa)',
        x: 0.56,
        y: 0.16,
        fontSize: 12,
        color: '#111827',
        bold: false,
        hasBox: true
      };

      const shellRect = plotShell.getBoundingClientRect();
      const left = clientX !== null
        ? Math.max(8, Math.min(shellRect.width - 280, clientX - shellRect.left + 8))
        : Math.max(16, Math.round((shellRect.width - 270) / 2));
      const top = clientY !== null
        ? Math.max(42, Math.min(shellRect.height - 250, clientY - shellRect.top + 8))
        : 60;

      floatPopover.innerHTML = `
        <div class="origin-pop-head">
          <span>T ${isNew ? '그래프 텍스트 삽입' : '텍스트 편집'}</span>
          <button type="button" class="origin-pop-close" data-pclose="1">✕</button>
        </div>
        <label class="insp-field"><span>내용 (줄바꿈 · LaTeX 기호 지원: \\alpha, R^2, T_{in})</span>
          <textarea data-tf="text" rows="3" class="origin-pop-textarea">${escHtml(target.text)}</textarea>
        </label>
        <div class="insp-grid-2">
          <label class="insp-field"><span>글자 크기 (px)</span>
            <input type="number" data-tf="fontSize" value="${target.fontSize || 12}" min="8" max="32">
          </label>
          <label class="insp-field"><span>글자 색상</span>
            <input type="color" data-tf="color" value="${escHtml(target.color || '#111827')}" style="height:26px;padding:2px;">
          </label>
        </div>
        <div class="insp-checks-row">
          <label class="insp-check"><input type="checkbox" data-tf="bold" ${target.bold ? 'checked' : ''}> 굵게 (Bold)</label>
          <label class="insp-check"><input type="checkbox" data-tf="hasBox" ${target.hasBox !== false ? 'checked' : ''}> 테두리 박스</label>
        </div>
        <div class="origin-pop-foot">
          ${!isNew ? '<button type="button" class="sb-tb-btn danger" data-tact="delete">🗑️ 삭제</button>' : '<span></span>'}
          <button type="button" class="sb-tb-btn primary" data-tact="save">${isNew ? '삽입' : '저장'}</button>
        </div>
      `;
      floatPopover.style.left = `${left}px`;
      floatPopover.style.top = `${top}px`;
      floatPopover.style.display = 'flex';

      const ta = floatPopover.querySelector('[data-tf="text"]');
      ta.focus();
      ta.select();

      floatPopover.querySelector('[data-tact="save"]').addEventListener('click', () => {
        const txt = ta.value.trim();
        if (!txt) return;
        target.text = txt;
        target.fontSize = Math.max(8, Math.min(32, Number(floatPopover.querySelector('[data-tf="fontSize"]').value) || 12));
        target.color = floatPopover.querySelector('[data-tf="color"]').value || '#111827';
        target.bold = floatPopover.querySelector('[data-tf="bold"]').checked;
        target.hasBox = floatPopover.querySelector('[data-tf="hasBox"]').checked;

        if (isNew) {
          plotConfig.annotations = [...(plotConfig.annotations || []), target];
        }
        selectedObj = { type: 'annotation', id: target.id };
        notifyConfigChange();
        renderPlot();
        floatPopover.style.display = 'none';
        toast(isNew ? 'T 텍스트가 삽입되었습니다. 드래그하여 원하는 위치로 옮기세요.' : 'T 텍스트가 수정되었습니다.');
      });

      const delBtn = floatPopover.querySelector('[data-tact="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          plotConfig.annotations = (plotConfig.annotations || []).filter((a) => a.id !== target.id);
          if (selectedObj?.type === 'annotation' && selectedObj.id === target.id) selectedObj = null;
          notifyConfigChange();
          renderPlot();
          floatPopover.style.display = 'none';
          toast('🗑️ 텍스트 박스가 삭제되었습니다.');
        });
      }
      floatPopover.querySelector('[data-pclose]').addEventListener('click', () => {
        floatPopover.style.display = 'none';
      });
    }

    // ---- Modal: Legend Properties (Rename, Display Style, Reorder, Size) ----
    function openLegendPropertiesModal() {
      closePopups();
      if (typeof callbacks.extractDataset === 'function') {
        currentDataset = callbacks.extractDataset(plotConfig);
      }
      const visibleSeries = currentDataset.series
        .map((s, idx) => ({ ...s, style: getSeriesStyle(s.colIdx, idx) }))
        .filter((s) => s.style.visible && s.points.length > 0);
      const hasY2 = plotConfig.y2Axis.enabled || visibleSeries.some((s) => s.style.yAxis === 'y2');

      let items = buildLegendEntries(visibleSeries, hasY2).map((it) => ({
        key: it.key,
        label: it.label,
        defaultLabel: it.defaultLabel,
        color: it.color,
        displayMode: (plotConfig.legendOverrides[it.key]?.displayMode) || '',
        hidden: it.hidden
      }));

      let fontSize = Number(plotConfig.legendStyle.fontSize || 11);
      let globalMode = plotConfig.legendStyle.displayMode || 'both';
      let showBorder = plotConfig.legendStyle.showBorder !== false;

      function renderLegModal() {
        const rowsHtml = items.map((it, idx) => `
          <div class="origin-leg-row" data-idx="${idx}">
            <span class="origin-leg-swatch" style="background:${escHtml(it.color)};"></span>
            <input type="checkbox" data-lf="visible" ${!it.hidden ? 'checked' : ''} title="범례 표시">
            <input type="text" class="origin-leg-name" data-lf="label" value="${escHtml(it.label)}" placeholder="${escHtml(it.defaultLabel)}">
            <select class="insp-select-xs" data-lf="mode" title="표현 방식">
              <option value="" ${it.displayMode === '' ? 'selected' : ''}>기본</option>
              <option value="both" ${it.displayMode === 'both' ? 'selected' : ''}>심볼+선</option>
              <option value="symbol" ${it.displayMode === 'symbol' ? 'selected' : ''}>심볼만</option>
              <option value="line" ${it.displayMode === 'line' ? 'selected' : ''}>선만</option>
              <option value="text" ${it.displayMode === 'text' ? 'selected' : ''}>텍스트만</option>
            </select>
            <button type="button" class="sb-tb-btn" data-lmove="up" ${idx === 0 ? 'disabled' : ''} title="위로">▲</button>
            <button type="button" class="sb-tb-btn" data-lmove="down" ${idx === items.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
          </div>
        `).join('') || '<div class="insp-empty">표시 중인 데이터 계열이 없습니다.</div>';

        plotModal.innerHTML = `
          <div class="xl-submodal-card" style="max-width:480px;">
            <div class="xl-submodal-head">
              <span>🏷️ 범례 속성 (이름 · 표현방식 · 순서 · 크기)</span>
              <button type="button" class="sb-tb-btn" data-pmclose="1">✕</button>
            </div>
            <div class="xl-submodal-body">
              <div class="insp-grid-2">
                <label class="insp-field"><span>범례 글자 크기 (${fontSize}px)</span>
                  <input type="range" data-lg="fontSize" min="8" max="22" step="1" value="${fontSize}">
                </label>
                <label class="insp-field"><span>기본 표현 방식</span>
                  <select data-lg="displayMode">
                    <option value="both" ${globalMode === 'both' ? 'selected' : ''}>심볼 + 선</option>
                    <option value="symbol" ${globalMode === 'symbol' ? 'selected' : ''}>심볼만</option>
                    <option value="line" ${globalMode === 'line' ? 'selected' : ''}>선만</option>
                    <option value="text" ${globalMode === 'text' ? 'selected' : ''}>텍스트만</option>
                  </select>
                </label>
              </div>
              <label class="insp-check"><input type="checkbox" data-lg="showBorder" ${showBorder ? 'checked' : ''}> 범례 테두리 박스 표시</label>
              <div class="insp-sec-title" style="margin-top:4px;">항목 이름 · 개별 표현 · 순서 (▲/▼)</div>
              <div class="origin-leg-list">${rowsHtml}</div>
            </div>
            <div class="xl-submodal-foot">
              <button type="button" class="sb-tb-btn" data-pmclose="1">취소</button>
              <button type="button" class="sb-tb-btn primary" data-lgact="apply">✓ 범례 적용</button>
            </div>
          </div>
        `;
        plotModal.style.display = 'flex';

        plotModal.querySelector('[data-lg="fontSize"]').addEventListener('input', (e) => {
          fontSize = Number(e.target.value);
          e.target.previousElementSibling.textContent = `범례 글자 크기 (${fontSize}px)`;
        });
        plotModal.querySelector('[data-lg="displayMode"]').addEventListener('change', (e) => {
          globalMode = e.target.value;
        });
        plotModal.querySelector('[data-lg="showBorder"]').addEventListener('change', (e) => {
          showBorder = e.target.checked;
        });

        plotModal.querySelectorAll('.origin-leg-row').forEach((row) => {
          const idx = Number(row.dataset.idx);
          row.querySelector('[data-lf="label"]').addEventListener('input', (e) => { items[idx].label = e.target.value; });
          row.querySelector('[data-lf="mode"]').addEventListener('change', (e) => { items[idx].displayMode = e.target.value; });
          row.querySelector('[data-lf="visible"]').addEventListener('change', (e) => { items[idx].hidden = !e.target.checked; });
          row.querySelectorAll('[data-lmove]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const dir = btn.dataset.lmove === 'up' ? -1 : 1;
              const target = idx + dir;
              if (target < 0 || target >= items.length) return;
              [items[idx], items[target]] = [items[target], items[idx]];
              renderLegModal();
            });
          });
        });

        plotModal.querySelector('[data-lgact="apply"]').addEventListener('click', () => {
          plotConfig.showLegend = true;
          plotConfig.legendStyle = { fontSize, displayMode: globalMode, showBorder };
          plotConfig.legendOrder = items.map((it) => it.key);
          const nextOv = { ...plotConfig.legendOverrides };
          items.forEach((it) => {
            nextOv[it.key] = {
              label: it.label.trim(),
              displayMode: it.displayMode,
              hidden: it.hidden
            };
          });
          plotConfig.legendOverrides = nextOv;
          notifyConfigChange();
          renderInspector();
          renderPlot();
          plotModal.style.display = 'none';
          toast('🏷️ 범례 속성이 업데이트되었습니다.');
        });
      }

      renderLegModal();
    }

    // ---- Modal: Curve Fitting with Live SVG Preview & Draggable Equation Text ----
    function openCurveFittingModal(preselectColIdx = null) {
      closePopups();
      if (typeof callbacks.extractDataset === 'function') {
        currentDataset = callbacks.extractDataset(plotConfig);
      }
      const seriesList = currentDataset.series.filter((s) => s.points.length >= 2);
      if (seriesList.length === 0) {
        toast('⚠️ 커브 피팅을 실행할 숫자 데이터 계열(최소 2개 점)이 없습니다.');
        return;
      }

      let chosenCol = preselectColIdx !== null && seriesList.some((s) => s.colIdx === preselectColIdx)
        ? preselectColIdx
        : (selectedObj?.type === 'series' && seriesList.some((s) => s.colIdx === selectedObj.colIdx)
            ? selectedObj.colIdx
            : seriesList[0].colIdx);
      let method = 'linear';
      let fitColor = '#dc2626';
      let addEqTextBox = true;
      let showInLegend = false;
      let writeToSheet = true;

      const seriesOpts = seriesList.map((s) =>
        `<option value="${s.colIdx}" ${s.colIdx === chosenCol ? 'selected' : ''}>${escHtml(s.name)} (${s.points.length}개 점)</option>`
      ).join('');

      plotModal.innerHTML = `
        <div class="xl-submodal-card" style="max-width:480px;">
          <div class="xl-submodal-head">
            <span>📐 커브 피팅 (실시간 미리보기 · 수식 텍스트)</span>
            <button type="button" class="sb-tb-btn" data-pmclose="1">✕</button>
          </div>
          <div class="xl-submodal-body">
            <div class="insp-grid-2">
              <label class="insp-field"><span>대상 데이터 계열</span>
                <select data-cf="series">${seriesOpts}</select>
              </label>
              <label class="insp-field"><span>피팅 모델</span>
                <select data-cf="method">
                  <option value="linear">선형 회귀 (y = ax + b)</option>
                  <option value="poly2">2차 다항식 (Quadratic)</option>
                  <option value="poly3">3차 다항식 (Cubic)</option>
                  <option value="poly4">4차 다항식 (Quartic)</option>
                  <option value="exp">지수 피팅 (y = a·e^{bx})</option>
                  <option value="power">거듭제곱 피팅 (y = a·x^b)</option>
                  <option value="ma3">이동평균 스무딩 (k=3)</option>
                  <option value="ma5">이동평균 스무딩 (k=5)</option>
                  <option value="ma7">이동평균 스무딩 (k=7)</option>
                </select>
              </label>
            </div>
            <div class="origin-fit-preview-wrap" data-cf="preview"></div>
            <div class="origin-fit-eq-box" data-cf="eqbox"></div>
            <div class="insp-grid-2" style="align-items:center;">
              <label class="insp-field"><span>피팅 선 색상</span>
                <input type="color" data-cf="color" value="${fitColor}" style="height:26px;padding:2px;">
              </label>
              <label class="insp-check"><input type="checkbox" data-cf="addEq" checked> 드래그 가능한 수식 텍스트 삽입</label>
            </div>
            <div class="insp-checks-row">
              <label class="insp-check"><input type="checkbox" data-cf="inLegend"> 범례에도 피팅선 표시</label>
              <label class="insp-check"><input type="checkbox" data-cf="writeSheet" checked> 시트 새 열에 계산값 기록</label>
            </div>
          </div>
          <div class="xl-submodal-foot">
            <button type="button" class="sb-tb-btn" data-pmclose="1">취소</button>
            <button type="button" class="sb-tb-btn primary" data-cfact="apply">📐 피팅 적용</button>
          </div>
        </div>
      `;
      plotModal.style.display = 'flex';

      const selSeries = plotModal.querySelector('[data-cf="series"]');
      const selMethod = plotModal.querySelector('[data-cf="method"]');
      const inpColor = plotModal.querySelector('[data-cf="color"]');
      const chkEq = plotModal.querySelector('[data-cf="addEq"]');
      const chkLegend = plotModal.querySelector('[data-cf="inLegend"]');
      const chkSheet = plotModal.querySelector('[data-cf="writeSheet"]');
      const previewBox = plotModal.querySelector('[data-cf="preview"]');
      const eqBox = plotModal.querySelector('[data-cf="eqbox"]');
      const applyBtn = plotModal.querySelector('[data-cfact="apply"]');

      let lastComputed = null;

      function updateFitPreview() {
        chosenCol = Number(selSeries.value);
        method = selMethod.value;
        fitColor = inpColor.value;
        addEqTextBox = chkEq.checked;
        showInLegend = chkLegend.checked;
        writeToSheet = chkSheet.checked;

        const targetSeries = seriesList.find((s) => s.colIdx === chosenCol);
        if (!targetSeries) return;

        try {
          const { fitRes, curvePts } = computeFit(targetSeries.points, method);
          lastComputed = { targetSeries, fitRes, curvePts };
          applyBtn.disabled = false;

          // Build clean live SVG mini-preview
          const pw = 420, ph = 165;
          const m = { t: 14, r: 16, b: 24, l: 42 };
          const iw = pw - m.l - m.r;
          const ih = ph - m.t - m.b;
          const xs = [...targetSeries.points.map((p) => p.x), ...curvePts.map((p) => p.x)];
          const ys = [...targetSeries.points.map((p) => p.y), ...curvePts.map((p) => p.y)];
          const xMin = Math.min(...xs), xMax = Math.max(...xs);
          const yMin = Math.min(...ys), yMax = Math.max(...ys);
          const xSpan = xMax - xMin || 1;
          const ySpan = yMax - yMin || 1;
          const mx = (v) => m.l + ((v - (xMin - xSpan * 0.06)) / (xSpan * 1.12)) * iw;
          const my = (v) => m.t + ih - ((v - (yMin - ySpan * 0.08)) / (ySpan * 1.16)) * ih;

          const st = getSeriesStyle(targetSeries.colIdx, 0);
          const pSvg = createSvgEl('svg', { width: '100%', height: ph, viewBox: `0 0 ${pw} ${ph}` });
          pSvg.appendChild(createSvgEl('rect', { x: 0, y: 0, width: pw, height: ph, fill: '#ffffff', rx: 6 }));
          pSvg.appendChild(createSvgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'none', stroke: '#334155', 'stroke-width': 1 }));

          targetSeries.points.forEach((p) => {
            pSvg.appendChild(drawSymbol(st.symbol, mx(p.x), my(p.y), 3.8, st.color));
          });
          if (curvePts.length >= 2) {
            const d = curvePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${mx(p.x)} ${my(p.y)}`).join(' ');
            pSvg.appendChild(createSvgEl('path', { d, fill: 'none', stroke: fitColor, 'stroke-width': 2.2, 'stroke-dasharray': '6,3' }));
          }
          // Min/Max labels
          const mkTxt = (x, y, t, anchor) => {
            const el = createSvgEl('text', { x, y, 'text-anchor': anchor, fill: '#475569', 'font-size': '10px', 'font-family': 'monospace' });
            el.textContent = t;
            return el;
          };
          pSvg.appendChild(mkTxt(m.l, ph - 6, formatTickNumber(xMin), 'start'));
          pSvg.appendChild(mkTxt(m.l + iw, ph - 6, formatTickNumber(xMax), 'end'));
          pSvg.appendChild(mkTxt(m.l - 4, m.t + 8, formatTickNumber(yMax), 'end'));
          pSvg.appendChild(mkTxt(m.l - 4, m.t + ih, formatTickNumber(yMin), 'end'));

          previewBox.innerHTML = '';
          previewBox.appendChild(pSvg);

          const r2Line = typeof fitRes.r2 === 'number' ? `  |  R² = ${fitRes.r2.toFixed(5)}` : '';
          eqBox.className = 'origin-fit-eq-box ok';
          eqBox.innerHTML = `<div><b>수식 미리보기:</b> <code>${escHtml(fitRes.formulaOnly || fitRes.eqText)}</code>${escHtml(r2Line)}</div>`;
        } catch (err) {
          lastComputed = null;
          applyBtn.disabled = true;
          previewBox.innerHTML = `<div class="insp-empty" style="padding:28px;text-align:center;">미리보기를 계산할 수 없습니다.</div>`;
          eqBox.className = 'origin-fit-eq-box err';
          eqBox.textContent = `⚠️ ${err.message}`;
        }
      }

      [selSeries, selMethod, inpColor, chkEq, chkLegend, chkSheet].forEach((el) => {
        el.addEventListener('change', updateFitPreview);
        el.addEventListener('input', updateFitPreview);
      });
      updateFitPreview();

      applyBtn.addEventListener('click', () => {
        if (!lastComputed) return;
        const { targetSeries, fitRes, curvePts } = lastComputed;
        const yAxisOfSeries = getSeriesStyle(targetSeries.colIdx, 0).yAxis || 'y1';
        const fitId = `fit-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

        plotConfig.fitOverlays = [
          ...(plotConfig.fitOverlays || []),
          {
            id: fitId,
            label: `${targetSeries.name} (${method})`,
            eqText: fitRes.eqText,
            r2: fitRes.r2,
            points: curvePts,
            color: fitColor,
            yAxis: yAxisOfSeries,
            showInLegend
          }
        ];

        if (addEqTextBox) {
          const eqLines = typeof fitRes.r2 === 'number'
            ? `${targetSeries.name} Fit\n${fitRes.formulaOnly}\nR^2 = ${fitRes.r2.toFixed(4)}`
            : `${targetSeries.name}\n${fitRes.eqText}`;
          const offsetIdx = (plotConfig.annotations || []).length % 4;
          plotConfig.annotations = [
            ...(plotConfig.annotations || []),
            {
              id: `txt-fit-${Date.now()}`,
              text: eqLines,
              x: 0.34,
              y: 0.56 + offsetIdx * 0.08,
              fontSize: 10.5,
              color: fitColor,
              bold: false,
              hasBox: true
            }
          ];
        }

        if (writeToSheet && typeof callbacks.onWriteFitColumn === 'function') {
          callbacks.onWriteFitColumn({
            yCol: targetSeries.colIdx,
            method,
            fitRes,
            points: targetSeries.points
          });
        }

        notifyConfigChange();
        renderInspector();
        renderPlot();
        plotModal.style.display = 'none';
        toast(`📐 커브 피팅 완료: ${fitRes.eqText}`);
      });
    }

    plotModal.addEventListener('click', (e) => {
      if (e.target === plotModal || e.target.closest('[data-pmclose]')) {
        plotModal.style.display = 'none';
      }
    });

    // ---- Context Menu on Right-Click ----
    function openPlotContextMenu(clientX, clientY, items) {
      closePopups();
      const shellRect = plotShell.getBoundingClientRect();
      const left = Math.max(6, Math.min(shellRect.width - 210, clientX - shellRect.left));
      const top = Math.max(38, Math.min(shellRect.height - 180, clientY - shellRect.top));

      ctxMenu.innerHTML = items.map((it, idx) =>
        it === '---'
          ? '<hr>'
          : `<button type="button" class="${it.danger ? 'danger' : ''}" data-cidx="${idx}">${it.label}</button>`
      ).join('');

      ctxMenu.style.left = `${left}px`;
      ctxMenu.style.top = `${top}px`;
      ctxMenu.style.display = 'flex';

      ctxMenu.querySelectorAll('[data-cidx]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ctxMenu.style.display = 'none';
          const item = items[Number(btn.dataset.cidx)];
          if (item && typeof item.action === 'function') item.action();
        });
      });
    }

    // ================= Main SVG Renderer =================
    function renderPlot() {
      if (typeof callbacks.extractDataset === 'function') {
        currentDataset = callbacks.extractDataset(plotConfig);
      }

      const rect = svgStage.getBoundingClientRect();
      const W = Math.max(280, Math.round(rect.width || 480));
      const H = Math.max(260, Math.round(rect.height || 380));

      const visibleSeries = currentDataset.series
        .map((s, idx) => ({ ...s, style: getSeriesStyle(s.colIdx, idx) }))
        .filter((s) => s.style.visible && s.points.length > 0);

      const hasY2 = plotConfig.y2Axis.enabled || visibleSeries.some((s) => s.style.yAxis === 'y2');

      const margin = {
        top: plotConfig.title ? 44 : 24,
        right: hasY2 ? 78 : 28,
        bottom: 58,
        left: 76
      };
      const pw = Math.max(120, W - margin.left - margin.right);
      const ph = Math.max(120, H - margin.top - margin.bottom);

      const allX = [], y1Vals = [], y2Vals = [];
      visibleSeries.forEach((s) => {
        s.points.forEach((p) => {
          allX.push(p.x);
          const err = Number.isFinite(p.err) ? Math.abs(p.err) : 0;
          if (s.style.yAxis === 'y2') y2Vals.push(p.y - err, p.y + err);
          else y1Vals.push(p.y - err, p.y + err);
        });
      });
      (plotConfig.fitOverlays || []).forEach((ov) => {
        (ov.points || []).forEach((p) => {
          allX.push(p.x);
          if (ov.yAxis === 'y2') y2Vals.push(p.y);
          else y1Vals.push(p.y);
        });
      });

      const xScale = computeAxisScale(allX, plotConfig.xAxis, zoomState?.x || null);
      const y1Scale = computeAxisScale(y1Vals, plotConfig.yAxis, zoomState?.y1 || null);
      const y2Scale = hasY2 ? computeAxisScale(y2Vals.length ? y2Vals : y1Vals, plotConfig.y2Axis, zoomState?.y2 || null) : null;

      const mapX = (v) => {
        if (xScale.isLog) {
          if (v <= 0) return NaN;
          return margin.left + ((Math.log10(v) - Math.log10(xScale.min)) / (Math.log10(xScale.max) - Math.log10(xScale.min))) * pw;
        }
        return margin.left + ((v - xScale.min) / (xScale.max - xScale.min)) * pw;
      };
      const mapY = (v, scaleObj) => {
        if (scaleObj.isLog) {
          if (v <= 0) return NaN;
          return margin.top + ph - ((Math.log10(v) - Math.log10(scaleObj.min)) / (Math.log10(scaleObj.max) - Math.log10(scaleObj.min))) * ph;
        }
        return margin.top + ph - ((v - scaleObj.min) / (scaleObj.max - scaleObj.min)) * ph;
      };
      const unmapX = (px) => {
        const t = (px - margin.left) / pw;
        if (xScale.isLog) return Math.pow(10, Math.log10(xScale.min) + t * (Math.log10(xScale.max) - Math.log10(xScale.min)));
        return xScale.min + t * (xScale.max - xScale.min);
      };
      const unmapY = (py, scaleObj) => {
        const t = (margin.top + ph - py) / ph;
        if (scaleObj.isLog) return Math.pow(10, Math.log10(scaleObj.min) + t * (Math.log10(scaleObj.max) - Math.log10(scaleObj.min)));
        return scaleObj.min + t * (scaleObj.max - scaleObj.min);
      };

      const svg = createSvgEl('svg', {
        xmlns: SVG_NS,
        width: W,
        height: H,
        viewBox: `0 0 ${W} ${H}`,
        class: 'origin-plot-svg'
      });

      svg.appendChild(createSvgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));

      const clipId = `origin-clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const defs = createSvgEl('defs');
      const clipPath = createSvgEl('clipPath', { id: clipId });
      clipPath.appendChild(createSvgEl('rect', { x: margin.left, y: margin.top, width: pw, height: ph }));
      defs.appendChild(clipPath);
      svg.appendChild(defs);

      // Optional Grid
      if (plotConfig.showGrid) {
        const gridG = createSvgEl('g', { stroke: '#e5e7eb', 'stroke-width': 0.8, 'stroke-dasharray': '3,3' });
        xScale.majorTicks.forEach((t) => {
          const x = mapX(t.val);
          if (x >= margin.left && x <= margin.left + pw) {
            gridG.appendChild(createSvgEl('line', { x1: x, y1: margin.top, x2: x, y2: margin.top + ph }));
          }
        });
        y1Scale.majorTicks.forEach((t) => {
          const y = mapY(t.val, y1Scale);
          if (y >= margin.top && y <= margin.top + ph) {
            gridG.appendChild(createSvgEl('line', { x1: margin.left, y1: y, x2: margin.left + pw, y2: y }));
          }
        });
        svg.appendChild(gridG);
      }

      // ---- Data Layer ----
      const dataG = createSvgEl('g', { 'clip-path': `url(#${clipId})` });
      const barSeries = visibleSeries.filter((s) => (s.style.plotType || plotConfig.plotType) === 'bar');
      const barGroupCount = Math.max(1, barSeries.length);
      const allScreenPoints = [];

      visibleSeries.forEach((s) => {
        const type = s.style.plotType || plotConfig.plotType;
        const ySc = s.style.yAxis === 'y2' && y2Scale ? y2Scale : y1Scale;
        const color = s.style.color;
        const isSelected = selectedObj?.type === 'series' && selectedObj.colIdx === s.colIdx;

        const pts = s.points
          .map((p) => ({
            ...p,
            sx: mapX(p.x),
            sy: mapY(p.y, ySc),
            syTop: Number.isFinite(p.err) ? mapY(p.y + Math.abs(p.err), ySc) : NaN,
            syBot: Number.isFinite(p.err) ? mapY(p.y - Math.abs(p.err), ySc) : NaN
          }))
          .filter((p) => Number.isFinite(p.sx) && Number.isFinite(p.sy));

        pts.forEach((p) => {
          allScreenPoints.push({
            sx: p.sx, sy: p.sy, x: p.x, y: p.y, err: p.err,
            seriesName: s.name, color, yAxis: s.style.yAxis
          });
        });

        const seriesG = createSvgEl('g', {
          class: `origin-series-group${isSelected ? ' is-selected' : ''}`,
          'data-col': s.colIdx
        });

        const selectThisSeries = (e) => {
          e.stopPropagation();
          closePopups();
          selectedObj = { type: 'series', colIdx: s.colIdx };
          plotShell.focus({ preventScroll: true });
          renderInspector();
          renderPlot();
        };

        const openSeriesCtx = (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedObj = { type: 'series', colIdx: s.colIdx };
          renderInspector();
          renderPlot();
          openPlotContextMenu(e.clientX, e.clientY, [
            { label: `📐 커브 피팅 (${s.name})...`, action: () => openCurveFittingModal(s.colIdx) },
            {
              label: `↕️ ${s.style.yAxis === 'y2' ? '좌측 Y1축으로 이동' : '우측 Y2축으로 이동'}`,
              action: () => {
                updateSeriesStyle(s.colIdx, { yAxis: s.style.yAxis === 'y2' ? 'y1' : 'y2' });
                renderInspector();
              }
            },
            '---',
            {
              label: `🗑️ "${s.name}" 계열 삭제/숨기기 (Del)`,
              danger: true,
              action: () => deleteSelectedObject()
            }
          ]);
        };

        // Bar
        if (type === 'bar') {
          const barIdx = barSeries.indexOf(s);
          const baseY = Math.min(margin.top + ph, Math.max(margin.top, mapY(ySc.isLog ? ySc.min : 0, ySc)));
          const approxGap = pts.length > 1 ? Math.min(48, Math.max(8, Math.abs(pts[1].sx - pts[0].sx) * 0.72)) : 28;
          const singleW = Math.max(4, approxGap / barGroupCount);
          const groupOffset = (barIdx - (barGroupCount - 1) / 2) * singleW;

          pts.forEach((p) => {
            const top = Math.min(p.sy, baseY);
            const height = Math.max(1, Math.abs(baseY - p.sy));
            const barEl = createSvgEl('rect', {
              x: p.sx + groupOffset - singleW / 2, y: top, width: singleW - 1, height,
              fill: color, 'fill-opacity': 0.78,
              stroke: isSelected ? '#2563eb' : color,
              'stroke-width': isSelected ? 2.2 : 1,
              style: 'cursor:pointer;'
            });
            barEl.addEventListener('click', selectThisSeries);
            barEl.addEventListener('contextmenu', openSeriesCtx);
            seriesG.appendChild(barEl);
          });
        }

        // Area
        if (type === 'area' && pts.length >= 2) {
          const baseY = Math.min(margin.top + ph, Math.max(margin.top, mapY(ySc.isLog ? ySc.min : 0, ySc)));
          const dParts = [`M ${pts[0].sx} ${baseY}`];
          pts.forEach((p) => dParts.push(`L ${p.sx} ${p.sy}`));
          dParts.push(`L ${pts[pts.length - 1].sx} ${baseY} Z`);
          seriesG.appendChild(createSvgEl('path', { d: dParts.join(' '), fill: color, 'fill-opacity': 0.2 }));
        }

        // Line + Selection Glow + Wide Hit Area
        if ((type === 'line' || type === 'line-symbol' || type === 'area') && pts.length >= 2) {
          const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.sx} ${p.sy}`).join(' ');
          const dash = getStrokeDash(s.style.lineStyle);

          if (isSelected) {
            seriesG.appendChild(createSvgEl('path', {
              d, fill: 'none', stroke: '#3b82f6', 'stroke-opacity': 0.32,
              'stroke-width': s.style.lineWidth + 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
              class: 'origin-ui-only'
            }));
          }

          seriesG.appendChild(createSvgEl('path', {
            d, fill: 'none', stroke: color, 'stroke-width': s.style.lineWidth,
            ...(dash ? { 'stroke-dasharray': dash } : {})
          }));

          // Wide transparent hit path for easy clicking & right-clicking
          const hitPath = createSvgEl('path', {
            d, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
            style: 'cursor:pointer;', class: 'origin-ui-only origin-series-hit'
          });
          hitPath.addEventListener('click', selectThisSeries);
          hitPath.addEventListener('contextmenu', openSeriesCtx);
          seriesG.appendChild(hitPath);
        }

        // Error bars
        pts.forEach((p) => {
          if (Number.isFinite(p.syTop) && Number.isFinite(p.syBot)) {
            const cap = 4;
            const errG = createSvgEl('g', { stroke: color, 'stroke-width': 1.2 });
            errG.appendChild(createSvgEl('line', { x1: p.sx, y1: p.syTop, x2: p.sx, y2: p.syBot }));
            errG.appendChild(createSvgEl('line', { x1: p.sx - cap, y1: p.syTop, x2: p.sx + cap, y2: p.syTop }));
            errG.appendChild(createSvgEl('line', { x1: p.sx - cap, y1: p.syBot, x2: p.sx + cap, y2: p.syBot }));
            seriesG.appendChild(errG);
          }
        });

        // Symbols (with per-point override support + double-click per-point edit)
        const showSymbols = type === 'scatter' || type === 'line-symbol' || (type === 'line' && isSelected);
        if (showSymbols) {
          pts.forEach((p) => {
            const ptKey = `${s.colIdx}:${p.row}`;
            const ov = plotConfig.pointOverrides[ptKey];
            const symShape = ov?.symbol || s.style.symbol;
            const symSize = Number(ov?.symbolSize ?? s.style.symbolSize);
            const symColor = ov?.color || color;

            const ptG = createSvgEl('g', {
              class: 'origin-point-node',
              'data-col': s.colIdx,
              'data-row': p.row,
              style: 'cursor:pointer;'
            });

            if (isSelected) {
              ptG.appendChild(createSvgEl('circle', {
                cx: p.sx, cy: p.sy, r: symSize + 4,
                fill: 'rgba(59, 130, 246, 0.14)', stroke: '#2563eb', 'stroke-width': 1.3,
                class: 'origin-ui-only'
              }));
            }

            if (type !== 'line' || ov) {
              ptG.appendChild(drawSymbol(symShape, p.sx, p.sy, symSize, symColor));
            } else {
              // On line-only selected series, show small handle dots so user can double-click any point
              ptG.appendChild(createSvgEl('circle', {
                cx: p.sx, cy: p.sy, r: 3.5, fill: '#ffffff', stroke: color, 'stroke-width': 1.4,
                class: 'origin-ui-only'
              }));
            }

            // Invisible hit circle for smooth click & dblclick
            ptG.appendChild(createSvgEl('circle', {
              cx: p.sx, cy: p.sy, r: Math.max(9, symSize + 4),
              fill: 'transparent', class: 'origin-ui-only'
            }));

            ptG.addEventListener('click', selectThisSeries);
            ptG.addEventListener('contextmenu', openSeriesCtx);
            ptG.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              e.preventDefault();
              selectedObj = { type: 'series', colIdx: s.colIdx };
              openPointSymbolEditor(e.clientX, e.clientY, s.colIdx, p.row, s.style, p);
            });

            seriesG.appendChild(ptG);
          });
        }

        dataG.appendChild(seriesG);
      });

      // Curve Fitting Trendline Overlays (clickable + selectable + Deletable)
      (plotConfig.fitOverlays || []).forEach((ov) => {
        const ySc = ov.yAxis === 'y2' && y2Scale ? y2Scale : y1Scale;
        const pts = (ov.points || [])
          .map((p) => ({ sx: mapX(p.x), sy: mapY(p.y, ySc) }))
          .filter((p) => Number.isFinite(p.sx) && Number.isFinite(p.sy));
        if (pts.length < 2) return;

        const isSel = selectedObj?.type === 'fit' && selectedObj.fitId === ov.id;
        const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.sx} ${p.sy}`).join(' ');
        const fitG = createSvgEl('g', { class: 'origin-fit-group', 'data-fit-id': ov.id });

        if (isSel) {
          fitG.appendChild(createSvgEl('path', {
            d, fill: 'none', stroke: '#3b82f6', 'stroke-opacity': 0.35, 'stroke-width': 8,
            class: 'origin-ui-only'
          }));
        }
        fitG.appendChild(createSvgEl('path', {
          d, fill: 'none', stroke: ov.color || '#dc2626', 'stroke-width': 2.1, 'stroke-dasharray': '6,3'
        }));
        const hit = createSvgEl('path', {
          d, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
          style: 'cursor:pointer;', class: 'origin-ui-only'
        });
        hit.addEventListener('click', (e) => {
          e.stopPropagation();
          closePopups();
          selectedObj = { type: 'fit', fitId: ov.id };
          plotShell.focus({ preventScroll: true });
          renderPlot();
        });
        hit.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedObj = { type: 'fit', fitId: ov.id };
          renderPlot();
          openPlotContextMenu(e.clientX, e.clientY, [
            { label: '🗑️ 이 커브 피팅 선 삭제 (Del)', danger: true, action: () => deleteSelectedObject() }
          ]);
        });
        fitG.appendChild(hit);
        dataG.appendChild(fitG);
      });

      svg.appendChild(dataG);

      // ---- Origin Frame & Inward Ticks ----
      const frameColor = '#111827';
      const tickSign = plotConfig.inwardTicks ? 1 : -1;
      const majLen = 7, minLen = 3.5;
      const axisG = createSvgEl('g', { stroke: frameColor, 'stroke-width': 1.4, fill: 'none' });

      if (plotConfig.frameBox) {
        axisG.appendChild(createSvgEl('rect', {
          x: margin.left, y: margin.top, width: pw, height: ph,
          stroke: frameColor, 'stroke-width': 1.5, fill: 'none'
        }));
      } else {
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: margin.top + ph, x2: margin.left + pw, y2: margin.top + ph }));
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + ph }));
        if (hasY2) axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: margin.top, x2: margin.left + pw, y2: margin.top + ph }));
      }

      const labelG = createSvgEl('g', {
        fill: '#111827', 'font-family': 'Pretendard, Arial, Helvetica, sans-serif', 'font-size': '11.5px'
      });

      xScale.majorTicks.forEach((t) => {
        const x = mapX(t.val);
        if (x < margin.left - 0.5 || x > margin.left + pw + 0.5) return;
        axisG.appendChild(createSvgEl('line', { x1: x, y1: margin.top + ph, x2: x, y2: margin.top + ph - tickSign * majLen, 'stroke-width': 1.2 }));
        if (plotConfig.frameBox) {
          axisG.appendChild(createSvgEl('line', { x1: x, y1: margin.top, x2: x, y2: margin.top + tickSign * majLen, 'stroke-width': 1.2 }));
        }
        const lbl = createSvgEl('text', { x, y: margin.top + ph + 17, 'text-anchor': 'middle' });
        appendRichTextToSvgText(lbl, t.label, 11.5);
        labelG.appendChild(lbl);
      });
      xScale.minorTicks.forEach((v) => {
        const x = mapX(v);
        if (x <= margin.left || x >= margin.left + pw) return;
        axisG.appendChild(createSvgEl('line', { x1: x, y1: margin.top + ph, x2: x, y2: margin.top + ph - tickSign * minLen, 'stroke-width': 0.9 }));
        if (plotConfig.frameBox) {
          axisG.appendChild(createSvgEl('line', { x1: x, y1: margin.top, x2: x, y2: margin.top + tickSign * minLen, 'stroke-width': 0.9 }));
        }
      });

      y1Scale.majorTicks.forEach((t) => {
        const y = mapY(t.val, y1Scale);
        if (y < margin.top - 0.5 || y > margin.top + ph + 0.5) return;
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: y, x2: margin.left + tickSign * majLen, y2: y, 'stroke-width': 1.2 }));
        if (plotConfig.frameBox && !hasY2) {
          axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * majLen, y2: y, 'stroke-width': 1.2 }));
        }
        const lbl = createSvgEl('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end' });
        appendRichTextToSvgText(lbl, t.label, 11.5);
        labelG.appendChild(lbl);
      });
      y1Scale.minorTicks.forEach((v) => {
        const y = mapY(v, y1Scale);
        if (y <= margin.top || y >= margin.top + ph) return;
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: y, x2: margin.left + tickSign * minLen, y2: y, 'stroke-width': 0.9 }));
        if (plotConfig.frameBox && !hasY2) {
          axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * minLen, y2: y, 'stroke-width': 0.9 }));
        }
      });

      if (hasY2 && y2Scale) {
        const y2SeriesFirst = visibleSeries.find((s) => s.style.yAxis === 'y2');
        const y2Color = y2SeriesFirst ? y2SeriesFirst.style.color : '#2563eb';
        y2Scale.majorTicks.forEach((t) => {
          const y = mapY(t.val, y2Scale);
          if (y < margin.top - 0.5 || y > margin.top + ph + 0.5) return;
          axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * majLen, y2: y, stroke: y2Color, 'stroke-width': 1.2 }));
          const lbl = createSvgEl('text', { x: margin.left + pw + 8, y: y + 4, 'text-anchor': 'start', fill: y2Color });
          appendRichTextToSvgText(lbl, t.label, 11.5);
          labelG.appendChild(lbl);
        });
        y2Scale.minorTicks.forEach((v) => {
          const y = mapY(v, y2Scale);
          if (y <= margin.top || y >= margin.top + ph) return;
          axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * minLen, y2: y, stroke: y2Color, 'stroke-width': 0.9 }));
        });
      }

      svg.appendChild(axisG);
      svg.appendChild(labelG);

      // ---- Titles ----
      const titleG = createSvgEl('g', {
        fill: '#111827', 'font-family': 'Pretendard, Arial, Helvetica, sans-serif', 'font-weight': '700'
      });
      if (plotConfig.title) {
        const mainT = createSvgEl('text', { x: margin.left + pw / 2, y: 24, 'text-anchor': 'middle', 'font-size': '15px' });
        appendRichTextToSvgText(mainT, plotConfig.title, 15);
        titleG.appendChild(mainT);
      }
      const xTitleEl = createSvgEl('text', { x: margin.left + pw / 2, y: margin.top + ph + 42, 'text-anchor': 'middle', 'font-size': '13px' });
      appendRichTextToSvgText(xTitleEl, plotConfig.xAxis.title || currentDataset.xTitle || 'X', 13);
      titleG.appendChild(xTitleEl);

      const y1First = visibleSeries.find((s) => s.style.yAxis !== 'y2');
      const y1TitleEl = createSvgEl('text', {
        x: 20, y: margin.top + ph / 2, 'text-anchor': 'middle', 'font-size': '13px',
        transform: `rotate(-90, 20, ${margin.top + ph / 2})`
      });
      appendRichTextToSvgText(y1TitleEl, plotConfig.yAxis.title || (y1First ? y1First.axisLabel : 'Y'), 13);
      titleG.appendChild(y1TitleEl);

      if (hasY2) {
        const y2First = visibleSeries.find((s) => s.style.yAxis === 'y2');
        const y2Color = y2First ? y2First.style.color : '#2563eb';
        const y2X = W - 18;
        const y2TitleEl = createSvgEl('text', {
          x: y2X, y: margin.top + ph / 2, 'text-anchor': 'middle', 'font-size': '13px', fill: y2Color,
          transform: `rotate(90, ${y2X}, ${margin.top + ph / 2})`
        });
        appendRichTextToSvgText(y2TitleEl, plotConfig.y2Axis.title || (y2First ? y2First.axisLabel : 'Y2'), 13);
        titleG.appendChild(y2TitleEl);
      }
      svg.appendChild(titleG);

      // ---- Draggable, Resizable, Customizable Legend ----
      const legendItems = buildLegendEntries(visibleSeries, hasY2).filter((it) => !it.hidden);
      if (plotConfig.showLegend && legendItems.length > 0) {
        const legFs = Math.max(8, Math.min(24, Number(plotConfig.legendStyle?.fontSize || 11)));
        const rowH = Math.round(legFs * 1.72);
        const iconW = Math.round(legFs * 2.4);
        const maxChars = legendItems.reduce((m, it) => Math.max(m, String(it.label || '').length), 6);
        const hasAnyIcon = legendItems.some((it) => it.displayMode !== 'text');
        const legW = Math.min(pw - 16, Math.max(96, Math.round(maxChars * legFs * 0.66 + (hasAnyIcon ? iconW + 22 : 18))));
        const legH = legendItems.length * rowH + Math.round(legFs * 1.0);
        const lx = margin.left + Math.max(4, Math.min(pw - legW - 4, plotConfig.legendPos.x * pw));
        const ly = margin.top + Math.max(4, Math.min(ph - legH - 4, plotConfig.legendPos.y * ph));

        const legG = createSvgEl('g', { class: 'origin-legend-box', style: 'cursor: move;' });
        legG.appendChild(createSvgEl('rect', {
          x: lx, y: ly, width: legW, height: legH, rx: 3,
          fill: 'rgba(255,255,255,0.93)',
          stroke: plotConfig.legendStyle?.showBorder !== false ? '#111827' : 'rgba(0,0,0,0.12)',
          'stroke-width': plotConfig.legendStyle?.showBorder !== false ? 1 : 0.7
        }));

        legendItems.forEach((it, idx) => {
          const cy = ly + Math.round(rowH * 0.68) + idx * rowH;
          const mode = it.displayMode || 'both';
          const showLine = (mode === 'both' || mode === 'line') && it.hasLine;
          const showSym = (mode === 'both' || mode === 'symbol') && it.symbol;
          const textX = mode === 'text' ? lx + 9 : lx + iconW + 14;

          if (showLine) {
            legG.appendChild(createSvgEl('line', {
              x1: lx + 8, y1: cy, x2: lx + 8 + iconW, y2: cy,
              stroke: it.color, 'stroke-width': Math.max(1.6, legFs * 0.16),
              ...(it.dash ? { 'stroke-dasharray': it.dash } : {})
            }));
          }
          if (showSym) {
            legG.appendChild(drawSymbol(it.symbol, lx + 8 + iconW / 2, cy, Math.max(3, legFs * 0.34), it.color));
          }
          const txt = createSvgEl('text', {
            x: textX, y: cy + Math.round(legFs * 0.35),
            fill: '#111827', 'font-family': 'Pretendard, Arial, sans-serif', 'font-size': `${legFs}px`
          });
          appendRichTextToSvgText(txt, it.label, legFs);
          legG.appendChild(txt);
        });

        // Bottom-right Resize Handle on Legend
        const resizeHandle = createSvgEl('rect', {
          x: lx + legW - 9, y: ly + legH - 9, width: 9, height: 9, rx: 1,
          fill: '#2563eb', 'fill-opacity': 0.75, stroke: '#ffffff', 'stroke-width': 1,
          class: 'origin-legend-resizer origin-ui-only',
          style: 'cursor: nwse-resize;'
        });
        resizeHandle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startFs = legFs;
          const onMove = (ev) => {
            const delta = ((ev.clientX - startX) + (ev.clientY - startY)) * 0.08;
            plotConfig.legendStyle.fontSize = Math.max(8, Math.min(24, Math.round((startFs + delta) * 2) / 2));
            renderPlot();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            notifyConfigChange();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        legG.appendChild(resizeHandle);

        // Legend drag
        legG.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('origin-legend-resizer') || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          closePopups();
          const startX = e.clientX, startY = e.clientY;
          const origPx = plotConfig.legendPos.x * pw;
          const origPy = plotConfig.legendPos.y * ph;
          const onMove = (ev) => {
            plotConfig.legendPos.x = Math.max(0.01, Math.min(0.95, (origPx + (ev.clientX - startX)) / pw));
            plotConfig.legendPos.y = Math.max(0.01, Math.min(0.92, (origPy + (ev.clientY - startY)) / ph));
            renderPlot();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            notifyConfigChange();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        legG.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
          openLegendPropertiesModal();
        });
        legG.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openPlotContextMenu(e.clientX, e.clientY, [
            { label: '🏷️ 범례 속성 편집 (이름·표현·순서·크기)...', action: openLegendPropertiesModal },
            { label: '➕ 범례 크게', action: () => { plotConfig.legendStyle.fontSize = Math.min(24, legFs + 2); notifyConfigChange(); renderPlot(); } },
            { label: '➖ 범례 작게', action: () => { plotConfig.legendStyle.fontSize = Math.max(8, legFs - 2); notifyConfigChange(); renderPlot(); } },
            '---',
            { label: '👁️ 범례 숨기기', action: () => { plotConfig.showLegend = false; notifyConfigChange(); renderInspector(); renderPlot(); } }
          ]);
        });

        svg.appendChild(legG);
      }

      // ---- Draggable Free Text & Fit Equation Annotations ----
      (plotConfig.annotations || []).forEach((annot) => {
        const fs = Math.max(8, Math.min(32, Number(annot.fontSize || 12)));
        const lines = String(annot.text || '').split('\n');
        const lineH = Math.round(fs * 1.38);
        const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 4);
        const boxW = Math.max(54, Math.round(maxLen * fs * 0.62 + 18));
        const boxH = lines.length * lineH + 10;
        const ax = Math.max(6, Math.min(W - boxW - 6, Math.round((annot.x ?? 0.5) * W)));
        const ay = Math.max(6, Math.min(H - boxH - 6, Math.round((annot.y ?? 0.2) * H)));
        const isSel = selectedObj?.type === 'annotation' && selectedObj.id === annot.id;

        const aG = createSvgEl('g', {
          class: `origin-annot-box${isSel ? ' is-selected' : ''}`,
          'data-annot-id': annot.id,
          style: 'cursor: move;'
        });

        if (annot.hasBox !== false || isSel) {
          aG.appendChild(createSvgEl('rect', {
            x: ax, y: ay, width: boxW, height: boxH, rx: 4,
            fill: annot.hasBox !== false ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.01)',
            stroke: isSel ? '#2563eb' : (annot.hasBox !== false ? '#475569' : 'none'),
            'stroke-width': isSel ? 1.5 : 1,
            ...(isSel ? { 'stroke-dasharray': '4,2' } : {})
          }));
        } else {
          aG.appendChild(createSvgEl('rect', {
            x: ax, y: ay, width: boxW, height: boxH, fill: 'transparent', class: 'origin-ui-only'
          }));
        }

        lines.forEach((line, lIdx) => {
          const tEl = createSvgEl('text', {
            x: ax + 9, y: ay + Math.round(lineH * 0.85) + lIdx * lineH,
            fill: annot.color || '#111827',
            'font-family': 'Pretendard, Arial, sans-serif',
            'font-size': `${fs}px`,
            'font-weight': annot.bold ? '700' : '500'
          });
          appendRichTextToSvgText(tEl, line, fs);
          aG.appendChild(tEl);
        });

        aG.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          closePopups();
          selectedObj = { type: 'annotation', id: annot.id };
          plotShell.focus({ preventScroll: true });
          const startX = e.clientX, startY = e.clientY;
          const origX = (annot.x ?? 0.5) * W;
          const origY = (annot.y ?? 0.2) * H;
          let moved = false;
          const onMove = (ev) => {
            if (Math.abs(ev.clientX - startX) > 2 || Math.abs(ev.clientY - startY) > 2) moved = true;
            annot.x = Math.max(0.01, Math.min(0.95, (origX + (ev.clientX - startX)) / W));
            annot.y = Math.max(0.01, Math.min(0.92, (origY + (ev.clientY - startY)) / H));
            renderPlot();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) notifyConfigChange();
            else renderPlot();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        aG.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
          openTextAnnotationEditor(annot, e.clientX, e.clientY);
        });

        aG.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedObj = { type: 'annotation', id: annot.id };
          renderPlot();
          openPlotContextMenu(e.clientX, e.clientY, [
            { label: '✏️ 텍스트 편집...', action: () => openTextAnnotationEditor(annot, e.clientX, e.clientY) },
            { label: '🗑️ 텍스트 삭제 (Del)', danger: true, action: () => deleteSelectedObject() }
          ]);
        });

        svg.appendChild(aG);
      });

      // Empty hint
      if (visibleSeries.length === 0) {
        const hint = createSvgEl('text', {
          x: margin.left + pw / 2, y: margin.top + ph / 2,
          'text-anchor': 'middle', fill: '#6b7280',
          'font-family': 'Pretendard, sans-serif', 'font-size': '13px'
        });
        hint.textContent = '시트에 숫자 데이터(X열과 Y열)를 입력하거나 우측 속성에서 계열을 켜세요.';
        svg.appendChild(hint);
      }

      const overlayG = createSvgEl('g', { class: 'origin-overlay-layer origin-ui-only' });
      svg.appendChild(overlayG);

      // Canvas-level interactions (Clear selection / Zoom drag / Reader / Canvas Right-click)
      svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.origin-legend-box, .origin-annot-box, .origin-series-group, .origin-fit-group')) return;
        closePopups();
        if (selectedObj) {
          selectedObj = null;
          renderInspector();
          renderPlot();
        }

        const svgRect = svg.getBoundingClientRect();
        const sx = e.clientX - svgRect.left;
        const sy = e.clientY - svgRect.top;
        if (sx < margin.left || sx > margin.left + pw || sy < margin.top || sy > margin.top + ph) return;

        if (interactionMode === 'zoom') {
          e.preventDefault();
          const zoomBox = createSvgEl('rect', {
            x: sx, y: sy, width: 0, height: 0,
            fill: 'rgba(37, 99, 235, 0.14)', stroke: '#2563eb', 'stroke-width': 1, 'stroke-dasharray': '4,2'
          });
          overlayG.innerHTML = '';
          overlayG.appendChild(zoomBox);

          const onMove = (ev) => {
            const cx = Math.max(margin.left, Math.min(margin.left + pw, ev.clientX - svgRect.left));
            const cy = Math.max(margin.top, Math.min(margin.top + ph, ev.clientY - svgRect.top));
            zoomBox.setAttribute('x', String(Math.min(sx, cx)));
            zoomBox.setAttribute('y', String(Math.min(sy, cy)));
            zoomBox.setAttribute('width', String(Math.abs(cx - sx)));
            zoomBox.setAttribute('height', String(Math.abs(cy - sy)));
          };
          const onUp = (ev) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const cx = Math.max(margin.left, Math.min(margin.left + pw, ev.clientX - svgRect.left));
            const cy = Math.max(margin.top, Math.min(margin.top + ph, ev.clientY - svgRect.top));
            overlayG.innerHTML = '';
            if (Math.abs(cx - sx) > 14 && Math.abs(cy - sy) > 14) {
              zoomState = {
                x: [unmapX(Math.min(sx, cx)), unmapX(Math.max(sx, cx))],
                y1: [unmapY(Math.max(sy, cy), y1Scale), unmapY(Math.min(sy, cy), y1Scale)],
                ...(y2Scale ? { y2: [unmapY(Math.max(sy, cy), y2Scale), unmapY(Math.min(sy, cy), y2Scale)] } : {})
              };
              renderPlot();
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }
      });

      svg.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.origin-legend-box, .origin-annot-box, .origin-series-group, .origin-fit-group')) return;
        e.preventDefault();
        openPlotContextMenu(e.clientX, e.clientY, [
          { label: 'T 여기에 텍스트 삽입...', action: () => {
            const svgRect = svg.getBoundingClientRect();
            const nx = Math.max(0.05, Math.min(0.82, (e.clientX - svgRect.left) / W));
            const ny = Math.max(0.05, Math.min(0.85, (e.clientY - svgRect.top) / H));
            openTextAnnotationEditor({
              id: `txt-${Date.now()}`,
              text: '메모 텍스트',
              x: nx, y: ny, fontSize: 12, color: '#111827', bold: false, hasBox: true
            }, e.clientX, e.clientY);
          } },
          { label: '📐 커브 피팅 (미리보기)...', action: () => openCurveFittingModal() },
          { label: '🏷️ 범례 속성 편집...', action: openLegendPropertiesModal },
          '---',
          { label: '↺ 축 범위 전체 복원', action: () => { zoomState = null; renderPlot(); } }
        ]);
      });

      svg.addEventListener('mousemove', (e) => {
        if (interactionMode !== 'reader' || allScreenPoints.length === 0) return;
        const svgRect = svg.getBoundingClientRect();
        const mx = e.clientX - svgRect.left;
        const my = e.clientY - svgRect.top;
        if (mx < margin.left || mx > margin.left + pw || my < margin.top || my > margin.top + ph) {
          overlayG.innerHTML = '';
          readerHud.style.display = 'none';
          return;
        }
        let nearest = null, bestDist = Infinity;
        for (const pt of allScreenPoints) {
          const d = (pt.sx - mx) ** 2 + (pt.sy - my) ** 2;
          if (d < bestDist) { bestDist = d; nearest = pt; }
        }
        if (!nearest) return;
        overlayG.innerHTML = '';
        overlayG.appendChild(createSvgEl('line', { x1: nearest.sx, y1: margin.top, x2: nearest.sx, y2: margin.top + ph, stroke: '#ef4444', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
        overlayG.appendChild(createSvgEl('line', { x1: margin.left, y1: nearest.sy, x2: margin.left + pw, y2: nearest.sy, stroke: '#ef4444', 'stroke-width': 1, 'stroke-dasharray': '3,3' }));
        overlayG.appendChild(createSvgEl('circle', { cx: nearest.sx, cy: nearest.sy, r: 6.5, fill: 'none', stroke: '#ef4444', 'stroke-width': 2 }));
        const errPart = Number.isFinite(nearest.err) ? ` ± ${nearest.err}` : '';
        readerHud.style.display = 'block';
        readerHud.textContent = `🎯 [${nearest.seriesName}]  X = ${nearest.x}  |  Y = ${nearest.y}${errPart}`;
      });

      svg.addEventListener('dblclick', (e) => {
        if (e.target.closest('.origin-point-node, .origin-legend-box, .origin-annot-box')) return;
        if (zoomState) {
          zoomState = null;
          renderPlot();
        }
      });

      svgStage.innerHTML = '';
      svgStage.appendChild(svg);
      currentSvgEl = svg;
      lastRenderGeometry = { W, H };
      updateSelectionHud();
    }

    // ---- Export SVG & 300 DPI PNG (Clean publication output without UI handles) ----
    function buildCleanExportSvg() {
      const clone = currentSvgEl.cloneNode(true);
      clone.querySelectorAll('.origin-ui-only').forEach((el) => el.remove());
      return clone;
    }

    function exportSvg(baseName = 'origin-plot') {
      if (!currentSvgEl) return;
      const clone = buildCleanExportSvg();
      const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`⬇️ 벡터 그래프(${baseName}.svg) 저장됨`);
    }

    function exportPng300Dpi(baseName = 'origin-plot') {
      if (!currentSvgEl || !lastRenderGeometry) return;
      const clone = buildCleanExportSvg();
      const svgStr = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        const scale = 4;
        const canvas = document.createElement('canvas');
        canvas.width = lastRenderGeometry.W * scale;
        canvas.height = lastRenderGeometry.H * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, lastRenderGeometry.W, lastRenderGeometry.H);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) return;
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `${baseName}_300dpi.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(pngUrl), 10000);
          toast(`🖼️ 고해상도 300DPI PNG(${baseName}_300dpi.png) 저장됨`);
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast('⚠️ PNG 변환에 실패했습니다.');
      };
      img.src = url;
    }

    // ---- Right Plot Inspector Sidebar ----
    function renderInspector() {
      if (!inspectorContainer) return;
      if (typeof callbacks.extractDataset === 'function') {
        currentDataset = callbacks.extractDataset(plotConfig);
      }
      inspectorContainer.style.width = `${plotConfig.inspectorWidth || 232}px`;
      syncResizerVis();

      const seriesHtml = currentDataset.series.map((s, idx) => {
        const st = getSeriesStyle(s.colIdx, idx);
        const isSel = selectedObj?.type === 'series' && selectedObj.colIdx === s.colIdx;
        return `
          <div class="insp-series-card${isSel ? ' is-selected' : ''}" data-col="${s.colIdx}">
            <div class="insp-series-top">
              <label class="insp-check"><input type="checkbox" data-sprop="visible" ${st.visible ? 'checked' : ''}> <b>${escHtml(s.name)}</b></label>
              <div style="display:flex;gap:3px;align-items:center;">
                <button type="button" class="sb-tb-btn" style="height:20px;padding:0 5px;font-size:0.68rem;" data-sfit="${s.colIdx}" title="이 계열 커브 피팅">📐</button>
                <select class="insp-select-xs" data-sprop="yAxis" title="Y축 매핑">
                  <option value="y1" ${st.yAxis !== 'y2' ? 'selected' : ''}>Y1</option>
                  <option value="y2" ${st.yAxis === 'y2' ? 'selected' : ''}>Y2</option>
                </select>
              </div>
            </div>
            <div class="insp-series-row">
              <input type="color" data-sprop="color" value="${escHtml(st.color)}" title="계열 색상">
              <select class="insp-select-xs" style="flex:1;min-width:0;" data-sprop="symbol" title="심볼 모양">
                ${buildSymbolOptionsHtml(st.symbol)}
              </select>
              <input type="number" class="insp-num-xs" data-sprop="symbolSize" value="${st.symbolSize}" min="2" max="16" step="0.5" title="심볼 크기">
            </div>
            <div class="insp-series-row">
              <select class="insp-select-xs" style="flex:1;" data-sprop="lineStyle" title="선 스타일">
                <option value="solid" ${st.lineStyle === 'solid' ? 'selected' : ''}>실선</option>
                <option value="dashed" ${st.lineStyle === 'dashed' ? 'selected' : ''}>파선</option>
                <option value="dotted" ${st.lineStyle === 'dotted' ? 'selected' : ''}>점선</option>
                <option value="dashdot" ${st.lineStyle === 'dashdot' ? 'selected' : ''}>일점쇄선</option>
              </select>
              <span style="font-size:0.68rem;color:var(--text-muted);">두께</span>
              <input type="number" class="insp-num-xs" data-sprop="lineWidth" value="${st.lineWidth}" min="0" max="6" step="0.5" title="선 두께">
            </div>
          </div>
        `;
      }).join('') || '<div class="insp-empty">표시할 Y열 데이터가 없습니다.</div>';

      const fitCount = (plotConfig.fitOverlays || []).length;
      const ptOverrideCount = Object.keys(plotConfig.pointOverrides || {}).length;

      inspectorContainer.innerHTML = `
        <div class="insp-head">
          <span>🎛️ Origin 그래프 속성</span>
          <div style="display:flex;gap:3px;">
            ${fitCount > 0 ? '<button type="button" class="sb-tb-btn" data-icmd="clear-fits" title="피팅선 모두 지우기">피팅 초기화</button>' : ''}
          </div>
        </div>
        <div class="insp-body">
          <div class="insp-sec">
            <div class="insp-sec-title">기본 스타일 · 범례 · 텍스트</div>
            <label class="insp-field"><span>그래프 제목 (LaTeX)</span><input type="text" data-prop="title" value="${escHtml(plotConfig.title)}" placeholder="예: \\Delta P vs Q"></label>
            <label class="insp-field"><span>플롯 타입</span>
              <select data-prop="plotType">
                <option value="line-symbol" ${plotConfig.plotType === 'line-symbol' ? 'selected' : ''}>선 + 심볼 (Line+Symbol)</option>
                <option value="scatter" ${plotConfig.plotType === 'scatter' ? 'selected' : ''}>산점도 (Scatter)</option>
                <option value="line" ${plotConfig.plotType === 'line' ? 'selected' : ''}>선 그래프 (Line)</option>
                <option value="bar" ${plotConfig.plotType === 'bar' ? 'selected' : ''}>막대 (Column/Bar)</option>
                <option value="area" ${plotConfig.plotType === 'area' ? 'selected' : ''}>영역 (Area)</option>
              </select>
            </label>
            <div class="insp-checks-row">
              <label class="insp-check"><input type="checkbox" data-prop="frameBox" ${plotConfig.frameBox ? 'checked' : ''}> 4면 박스</label>
              <label class="insp-check"><input type="checkbox" data-prop="inwardTicks" ${plotConfig.inwardTicks ? 'checked' : ''}> 안쪽 눈금</label>
              <label class="insp-check"><input type="checkbox" data-prop="showGrid" ${plotConfig.showGrid ? 'checked' : ''}> 격자선</label>
              <label class="insp-check"><input type="checkbox" data-prop="showLegend" ${plotConfig.showLegend ? 'checked' : ''}> 범례</label>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;">
              <button type="button" class="sb-tb-btn" data-icmd="legend-props">🏷️ 범례 편집</button>
              <button type="button" class="sb-tb-btn" data-icmd="add-text">T 텍스트 삽입</button>
              ${ptOverrideCount > 0 ? `<button type="button" class="sb-tb-btn" data-icmd="clear-point-overrides">↺ 개별점 초기화(${ptOverrideCount})</button>` : ''}
            </div>
          </div>

          <div class="insp-sec">
            <div class="insp-sec-title">X축 (가로)</div>
            <label class="insp-field"><span>제목 (비우면 자동)</span><input type="text" data-axis="xAxis" data-aprop="title" value="${escHtml(plotConfig.xAxis.title)}" placeholder="예: T_{in} \\text{ [°C]}"></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>From</span><input type="text" data-axis="xAxis" data-aprop="min" value="${escHtml(plotConfig.xAxis.min)}" placeholder="자동"></label>
              <label class="insp-field"><span>To</span><input type="text" data-axis="xAxis" data-aprop="max" value="${escHtml(plotConfig.xAxis.max)}" placeholder="자동"></label>
              <label class="insp-field"><span>주 간격</span><input type="text" data-axis="xAxis" data-aprop="increment" value="${escHtml(plotConfig.xAxis.increment)}" placeholder="자동"></label>
              <label class="insp-field"><span>보조 눈금</span><input type="number" data-axis="xAxis" data-aprop="minorCount" value="${plotConfig.xAxis.minorCount}" min="0" max="9"></label>
            </div>
            <label class="insp-field"><span>스케일</span>
              <select data-axis="xAxis" data-aprop="scale">
                <option value="linear" ${plotConfig.xAxis.scale === 'linear' ? 'selected' : ''}>선형 (Linear)</option>
                <option value="log" ${plotConfig.xAxis.scale === 'log' ? 'selected' : ''}>로그 (Log10)</option>
              </select>
            </label>
          </div>

          <div class="insp-sec">
            <div class="insp-sec-title">Y1축 (좌측)</div>
            <label class="insp-field"><span>제목 (비우면 자동)</span><input type="text" data-axis="yAxis" data-aprop="title" value="${escHtml(plotConfig.yAxis.title)}" placeholder="예: \\Delta P \\text{ [kPa]}"></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>From</span><input type="text" data-axis="yAxis" data-aprop="min" value="${escHtml(plotConfig.yAxis.min)}" placeholder="자동"></label>
              <label class="insp-field"><span>To</span><input type="text" data-axis="yAxis" data-aprop="max" value="${escHtml(plotConfig.yAxis.max)}" placeholder="자동"></label>
              <label class="insp-field"><span>주 간격</span><input type="text" data-axis="yAxis" data-aprop="increment" value="${escHtml(plotConfig.yAxis.increment)}" placeholder="자동"></label>
              <label class="insp-field"><span>보조 눈금</span><input type="number" data-axis="yAxis" data-aprop="minorCount" value="${plotConfig.yAxis.minorCount}" min="0" max="9"></label>
            </div>
            <label class="insp-field"><span>스케일</span>
              <select data-axis="yAxis" data-aprop="scale">
                <option value="linear" ${plotConfig.yAxis.scale === 'linear' ? 'selected' : ''}>선형 (Linear)</option>
                <option value="log" ${plotConfig.yAxis.scale === 'log' ? 'selected' : ''}>로그 (Log10)</option>
              </select>
            </label>
          </div>

          <div class="insp-sec">
            <div class="insp-sec-title">
              <label class="insp-check"><input type="checkbox" data-axis="y2Axis" data-aprop="enabled" ${plotConfig.y2Axis.enabled ? 'checked' : ''}> Y2축 (우측 Double-Y)</label>
            </div>
            ${plotConfig.y2Axis.enabled ? `
              <label class="insp-field"><span>Y2 제목</span><input type="text" data-axis="y2Axis" data-aprop="title" value="${escHtml(plotConfig.y2Axis.title)}" placeholder="자동"></label>
              <div class="insp-grid-2">
                <label class="insp-field"><span>From</span><input type="text" data-axis="y2Axis" data-aprop="min" value="${escHtml(plotConfig.y2Axis.min)}" placeholder="자동"></label>
                <label class="insp-field"><span>To</span><input type="text" data-axis="y2Axis" data-aprop="max" value="${escHtml(plotConfig.y2Axis.max)}" placeholder="자동"></label>
                <label class="insp-field"><span>주 간격</span><input type="text" data-axis="y2Axis" data-aprop="increment" value="${escHtml(plotConfig.y2Axis.increment)}" placeholder="자동"></label>
                <label class="insp-field"><span>스케일</span>
                  <select data-axis="y2Axis" data-aprop="scale">
                    <option value="linear" ${plotConfig.y2Axis.scale === 'linear' ? 'selected' : ''}>Linear</option>
                    <option value="log" ${plotConfig.y2Axis.scale === 'log' ? 'selected' : ''}>Log10</option>
                  </select>
                </label>
              </div>
            ` : ''}
          </div>

          <div class="insp-sec">
            <div class="insp-sec-title">데이터 계열 (심볼·크기·색상·선)</div>
            <div class="insp-empty" style="font-size:0.69rem;">💡 그래프 선 클릭 → Del 삭제 / 우클릭 → 커브 피팅 / 점 더블클릭 → 개별 심볼 편집</div>
            ${seriesHtml}
          </div>
        </div>
      `;
    }

    if (inspectorContainer) {
      inspectorContainer.addEventListener('input', (e) => {
        const el = e.target;
        if (el.dataset.prop) {
          plotConfig[el.dataset.prop] = el.type === 'checkbox' ? el.checked : el.value;
          notifyConfigChange();
          renderPlot();
        } else if (el.dataset.axis && el.dataset.aprop) {
          const val = el.type === 'checkbox' ? el.checked : el.value;
          plotConfig[el.dataset.axis][el.dataset.aprop] = val;
          zoomState = null;
          notifyConfigChange();
          if (el.dataset.aprop === 'enabled') renderInspector();
          renderPlot();
        } else if (el.dataset.sprop) {
          const card = el.closest('.insp-series-card');
          if (!card) return;
          const colIdx = Number(card.dataset.col);
          const val = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
          updateSeriesStyle(colIdx, { [el.dataset.sprop]: val });
          if (el.dataset.sprop === 'yAxis') renderInspector();
        }
      });

      inspectorContainer.addEventListener('click', (e) => {
        const fitBtn = e.target.closest('[data-sfit]');
        if (fitBtn) {
          openCurveFittingModal(Number(fitBtn.dataset.sfit));
          return;
        }
        const btn = e.target.closest('[data-icmd]');
        if (!btn) return;
        const icmd = btn.dataset.icmd;
        if (icmd === 'clear-fits') {
          plotConfig.fitOverlays = [];
          notifyConfigChange();
          renderInspector();
          renderPlot();
        } else if (icmd === 'legend-props') {
          openLegendPropertiesModal();
        } else if (icmd === 'add-text') {
          openTextAnnotationEditor(null);
        } else if (icmd === 'clear-point-overrides') {
          plotConfig.pointOverrides = {};
          notifyConfigChange();
          renderInspector();
          renderPlot();
          toast('↺ 모든 개별 데이터 점 심볼이 초기화되었습니다.');
        }
      });
    }

    // Keyboard Delete on plotShell
    plotShell.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (deleteSelectedObject()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'Escape') {
        closePopups();
        plotModal.style.display = 'none';
        if (selectedObj) {
          selectedObj = null;
          renderInspector();
          renderPlot();
        }
      }
    });

    const onDocClickClose = (e) => {
      if (!e.target.closest('.origin-plot-ctxmenu')) ctxMenu.style.display = 'none';
    };
    document.addEventListener('click', onDocClickClose);

    plotBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (tool === 'select' || tool === 'zoom' || tool === 'reader') {
        interactionMode = tool;
        plotBar.querySelectorAll('[data-tool="select"], [data-tool="zoom"], [data-tool="reader"]').forEach((b) => {
          b.classList.toggle('active', b.dataset.tool === tool);
        });
        if (tool !== 'reader') {
          readerHud.style.display = 'none';
          const ov = currentSvgEl?.querySelector('.origin-overlay-layer');
          if (ov) ov.innerHTML = '';
        }
      } else if (tool === 'add-text') {
        openTextAnnotationEditor(null);
      } else if (tool === 'fit-modal') {
        openCurveFittingModal();
      } else if (tool === 'legend-props') {
        openLegendPropertiesModal();
      } else if (tool === 'reset-zoom') {
        zoomState = null;
        renderPlot();
      } else if (tool === 'export-svg') {
        exportSvg(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot');
      } else if (tool === 'export-png') {
        exportPng300Dpi(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot');
      } else if (tool === 'toggle-inspector') {
        if (typeof callbacks.onToggleInspector === 'function') callbacks.onToggleInspector();
        syncResizerVis();
      }
    });

    const resizeObs = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => renderPlot())
      : null;
    if (resizeObs) resizeObs.observe(svgStage);

    return {
      refresh() {
        syncResizerVis();
        renderInspector();
        renderPlot();
      },
      setPlotType(type, enableDoubleY = false) {
        plotConfig.plotType = type;
        if (enableDoubleY) {
          plotConfig.y2Axis.enabled = true;
          if (typeof callbacks.extractDataset === 'function') {
            currentDataset = callbacks.extractDataset(plotConfig);
          }
          if (currentDataset.series.length >= 2) {
            const secondCol = currentDataset.series[1].colIdx;
            plotConfig.seriesStyles[secondCol] = {
              ...(plotConfig.seriesStyles[secondCol] || {}),
              yAxis: 'y2'
            };
          }
        }
        notifyConfigChange();
        renderInspector();
        renderPlot();
      },
      addFitOverlay(overlay) {
        plotConfig.fitOverlays = [
          ...(plotConfig.fitOverlays || []),
          { id: overlay.id || `fit-${Date.now()}`, showInLegend: overlay.showInLegend !== false, ...overlay }
        ];
        notifyConfigChange();
        renderInspector();
        renderPlot();
      },
      openCurveFittingModal,
      openLegendPropertiesModal,
      openTextAnnotationEditor,
      getConfig() {
        return JSON.parse(JSON.stringify(plotConfig));
      },
      setConfig(cfg) {
        plotConfig = mergePlotConfig(cfg);
        zoomState = null;
        selectedObj = null;
        renderInspector();
        renderPlot();
      },
      setInteractionMode(mode) {
        interactionMode = mode;
        plotBar.querySelectorAll('[data-tool="select"], [data-tool="zoom"], [data-tool="reader"]').forEach((b) => {
          b.classList.toggle('active', b.dataset.tool === mode);
        });
      },
      resetZoom() {
        zoomState = null;
        renderPlot();
      },
      exportSvg() { exportSvg(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot'); },
      exportPng300Dpi() { exportPng300Dpi(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot'); },
      destroy() {
        if (resizeObs) resizeObs.disconnect();
        document.removeEventListener('click', onDocClickClose);
      }
    };
  }

  global.BrainOriginPlot = {
    SYMBOL_CATALOG,
    createDefaultPlotConfig,
    mergePlotConfig,
    linearRegression,
    polynomialRegression,
    exponentialRegression,
    powerRegression,
    movingAverage,
    computeFit,
    parseRichMathSegments,
    mountOriginPlotPanel
  };
})(window);
