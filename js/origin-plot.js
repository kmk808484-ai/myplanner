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

  const SYMBOL_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangle-down', 'cross'];

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

  function createDefaultPlotConfig() {
    return {
      title: '',
      plotType: 'line-symbol', // 'scatter' | 'line' | 'line-symbol' | 'bar' | 'area'
      xCol: null, // auto-detect first X col if null
      frameBox: true,
      inwardTicks: true,
      showGrid: false,
      showLegend: true,
      legendPos: { x: 0.04, y: 0.05 }, // Origin default top-left inside plot rect
      xAxis: {
        title: '', // empty => auto Long Name [Units]
        min: '',
        max: '',
        increment: '',
        minorCount: 4,
        scale: 'linear' // 'linear' | 'log'
      },
      yAxis: {
        title: '',
        min: '',
        max: '',
        increment: '',
        minorCount: 4,
        scale: 'linear'
      },
      y2Axis: {
        enabled: false,
        title: '',
        min: '',
        max: '',
        increment: '',
        minorCount: 4,
        scale: 'linear'
      },
      seriesStyles: {}, // colIdx -> { color, symbol, symbolSize, lineWidth, lineStyle, yAxis: 'y1'|'y2', visible: true, plotType?: '' }
      fitOverlays: [] // [{ label, eqText, r2, points: [{x,y}], color, yAxis }]
    };
  }

  function mergePlotConfig(saved) {
    const def = createDefaultPlotConfig();
    if (!saved || typeof saved !== 'object') return def;
    return {
      ...def,
      ...saved,
      legendPos: { ...def.legendPos, ...(saved.legendPos || {}) },
      xAxis: { ...def.xAxis, ...(saved.xAxis || {}) },
      yAxis: { ...def.yAxis, ...(saved.yAxis || {}) },
      y2Axis: { ...def.y2Axis, ...(saved.y2Axis || {}) },
      seriesStyles: { ...(saved.seriesStyles || {}) },
      fitOverlays: Array.isArray(saved.fitOverlays) ? saved.fitOverlays : []
    };
  }

  // ================= Curve Fitting & Smoothing (FM-04) =================
  function linearRegression(points) {
    const n = points.length;
    if (n < 2) throw new Error('선형 회귀에는 최소 2개의 유효한 (X, Y) 데이터 포인트가 필요합니다.');
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
      sxx += p.x * p.x;
      sxy += p.x * p.y;
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
    const eqText = `y = ${formatCoef(a)}x ${sign} ${formatCoef(Math.abs(b))} (R² = ${r2.toFixed(4)})`;
    return { type: 'linear', coeffs: [b, a], r2, predict, eqText };
  }

  function polynomialRegression(points, degree = 2) {
    const deg = Math.max(1, Math.min(4, Math.trunc(degree)));
    const n = points.length;
    if (n < deg + 1) throw new Error(`${deg}차 다항식 피팅에는 최소 ${deg + 1}개의 데이터 포인트가 필요합니다.`);

    const m = deg + 1;
    // Build normal equations A * c = b
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

    // Gauss-Jordan elimination with partial pivoting
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

    const coeffs = B; // coeffs[0] + coeffs[1]*x + coeffs[2]*x^2 ...
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
    const eqText = `y = ${terms.join('')} (R² = ${r2.toFixed(4)})`;
    return { type: `poly${deg}`, coeffs, r2, predict, eqText };
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
      eqText: `Moving Avg (k=${k})`
    };
  }

  function formatCoef(n) {
    if (Math.abs(n) === 0) return '0';
    if (Math.abs(n) >= 10000 || Math.abs(n) < 0.001) return n.toExponential(3);
    return Number(n.toFixed(4)).toString();
  }

  // ================= Offline LaTeX / Scientific Math SVG Renderer =================
  function parseRichMathSegments(rawText) {
    let text = String(rawText || '').trim();
    if (!text) return [];
    // Strip surrounding $...$
    text = text.replace(/\$([^$]+)\$/g, '$1');
    // Expand \text{...} and \mathrm{...}
    text = text.replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1');
    // Replace known LaTeX Greek & math commands
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
          // Single token (char or digits/letters before space)
          content = text[i++];
        }
        segments.push({ mode, text: content });
        continue;
      }
      // Plain text run
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

  function computeAxisScale(values, axisCfg, zoomRange = null) {
    const isLog = axisCfg.scale === 'log';
    const valid = values.filter((v) => Number.isFinite(v) && (!isLog || v > 0));

    let minVal = valid.length > 0 ? Math.min(...valid) : (isLog ? 1 : 0);
    let maxVal = valid.length > 0 ? Math.max(...valid) : (isLog ? 100 : 10);

    if (minVal === maxVal) {
      if (isLog) {
        minVal = minVal / 10;
        maxVal = maxVal * 10;
      } else {
        const pad = minVal === 0 ? 1 : Math.abs(minVal) * 0.1;
        minVal -= pad;
        maxVal += pad;
      }
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

    // Apply manual overrides unless actively zoomed
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

  function formatTickNumber(v) {
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1).replace('+', '');
    return String(Math.round(v * 1e6) / 1e6);
  }

  function drawSymbol(shape, cx, cy, r, color, strokeColor = '#ffffff') {
    if (shape === 'square') {
      return createSvgEl('rect', {
        x: cx - r, y: cy - r, width: r * 2, height: r * 2,
        fill: color, stroke: strokeColor, 'stroke-width': 1
      });
    }
    if (shape === 'triangle') {
      const h = r * 1.15;
      const pts = `${cx},${cy - h} ${cx - h},${cy + h * 0.85} ${cx + h},${cy + h * 0.85}`;
      return createSvgEl('polygon', { points: pts, fill: color, stroke: strokeColor, 'stroke-width': 1 });
    }
    if (shape === 'triangle-down') {
      const h = r * 1.15;
      const pts = `${cx},${cy + h} ${cx - h},${cy - h * 0.85} ${cx + h},${cy - h * 0.85}`;
      return createSvgEl('polygon', { points: pts, fill: color, stroke: strokeColor, 'stroke-width': 1 });
    }
    if (shape === 'diamond') {
      const d = r * 1.25;
      const pts = `${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`;
      return createSvgEl('polygon', { points: pts, fill: color, stroke: strokeColor, 'stroke-width': 1 });
    }
    if (shape === 'cross') {
      const g = createSvgEl('g', { stroke: color, 'stroke-width': 2 });
      g.appendChild(createSvgEl('line', { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r }));
      g.appendChild(createSvgEl('line', { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r }));
      return g;
    }
    return createSvgEl('circle', {
      cx, cy, r, fill: color, stroke: strokeColor, 'stroke-width': 1
    });
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
    let interactionMode = 'zoom'; // 'zoom' | 'reader'
    let zoomState = null; // { x: [min,max], y1: [min,max], y2?: [min,max] }
    let lastRenderGeometry = null;
    let currentSvgEl = null;

    // Build Canvas DOM
    canvasContainer.innerHTML = '';
    const plotShell = document.createElement('div');
    plotShell.className = 'origin-plot-shell';

    const plotBar = document.createElement('div');
    plotBar.className = 'origin-plot-bar';
    plotBar.innerHTML = `
      <span class="origin-plot-bar-title">📈 Origin Scientific Plot</span>
      <div class="origin-plot-bar-tools">
        <button type="button" class="sb-tb-btn active" data-tool="zoom" title="마우스 드래그로 영역 확대">🔍 줌</button>
        <button type="button" class="sb-tb-btn" data-tool="reader" title="데이터 포인트에 스냅하여 정확한 (X, Y) 좌표 읽기">🎯 데이터 리더</button>
        <button type="button" class="sb-tb-btn" data-tool="reset-zoom" title="축 범위 원래대로">↺ 전체 보기</button>
        <button type="button" class="sb-tb-btn" data-tool="export-svg" title="논문·보고서용 벡터 SVG 저장">⬇️ SVG</button>
        <button type="button" class="sb-tb-btn" data-tool="export-png" title="300 DPI 고해상도 PNG 저장">🖼️ 300DPI PNG</button>
        <button type="button" class="sb-tb-btn" data-tool="toggle-inspector" title="그래프 속성 인스펙터 열기/닫기">🎛️ 속성</button>
      </div>
    `;

    const svgStage = document.createElement('div');
    svgStage.className = 'origin-svg-stage';

    const readerHud = document.createElement('div');
    readerHud.className = 'origin-reader-hud';
    readerHud.style.display = 'none';

    plotShell.appendChild(plotBar);
    plotShell.appendChild(svgStage);
    plotShell.appendChild(readerHud);
    canvasContainer.appendChild(plotShell);

    function notifyConfigChange() {
      if (typeof callbacks.onConfigChange === 'function') {
        callbacks.onConfigChange(JSON.parse(JSON.stringify(plotConfig)));
      }
    }

    function getSeriesStyle(colIdx, seriesPos) {
      const saved = plotConfig.seriesStyles[colIdx] || {};
      return {
        color: saved.color || SERIES_PALETTE[seriesPos % SERIES_PALETTE.length],
        symbol: saved.symbol || SYMBOL_SHAPES[seriesPos % SYMBOL_SHAPES.length],
        symbolSize: Number(saved.symbolSize || 4.5),
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
      // Automatically enable Y2 axis if any series maps to y2
      const hasY2 = currentDataset.series.some((s, idx) => getSeriesStyle(s.colIdx, idx).yAxis === 'y2' && getSeriesStyle(s.colIdx, idx).visible);
      if (hasY2) plotConfig.y2Axis.enabled = true;
      notifyConfigChange();
      renderPlot();
    }

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

      // Collect axis values
      const allX = [];
      const y1Vals = [];
      const y2Vals = [];

      visibleSeries.forEach((s) => {
        s.points.forEach((p) => {
          allX.push(p.x);
          const err = Number.isFinite(p.err) ? Math.abs(p.err) : 0;
          if (s.style.yAxis === 'y2') {
            y2Vals.push(p.y - err, p.y + err);
          } else {
            y1Vals.push(p.y - err, p.y + err);
          }
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
          const t = (Math.log10(v) - Math.log10(xScale.min)) / (Math.log10(xScale.max) - Math.log10(xScale.min));
          return margin.left + t * pw;
        }
        return margin.left + ((v - xScale.min) / (xScale.max - xScale.min)) * pw;
      };

      const mapY = (v, scaleObj) => {
        if (scaleObj.isLog) {
          if (v <= 0) return NaN;
          const t = (Math.log10(v) - Math.log10(scaleObj.min)) / (Math.log10(scaleObj.max) - Math.log10(scaleObj.min));
          return margin.top + ph - t * ph;
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

      // White publication background
      svg.appendChild(createSvgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));

      // Clip path for data series inside frame
      const clipId = `origin-clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const defs = createSvgEl('defs');
      const clipPath = createSvgEl('clipPath', { id: clipId });
      clipPath.appendChild(createSvgEl('rect', { x: margin.left, y: margin.top, width: pw, height: ph }));
      defs.appendChild(clipPath);
      svg.appendChild(defs);

      // Optional subtle grid
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

      // Data Layer (clipped to plot box)
      const dataG = createSvgEl('g', { 'clip-path': `url(#${clipId})` });
      const barSeries = visibleSeries.filter((s) => (s.style.plotType || plotConfig.plotType) === 'bar');
      const barGroupCount = Math.max(1, barSeries.length);

      const allScreenPoints = []; // for Data Reader snap

      visibleSeries.forEach((s) => {
        const type = s.style.plotType || plotConfig.plotType;
        const ySc = s.style.yAxis === 'y2' && y2Scale ? y2Scale : y1Scale;
        const color = s.style.color;
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

        // Bar / Column plot
        if (type === 'bar') {
          const barIdx = barSeries.indexOf(s);
          const baseY = Math.min(margin.top + ph, Math.max(margin.top, mapY(ySc.isLog ? ySc.min : 0, ySc)));
          const approxGap = pts.length > 1
            ? Math.min(48, Math.max(8, Math.abs(pts[1].sx - pts[0].sx) * 0.72))
            : 28;
          const singleW = Math.max(4, approxGap / barGroupCount);
          const groupOffset = (barIdx - (barGroupCount - 1) / 2) * singleW;

          pts.forEach((p) => {
            const top = Math.min(p.sy, baseY);
            const height = Math.max(1, Math.abs(baseY - p.sy));
            dataG.appendChild(createSvgEl('rect', {
              x: p.sx + groupOffset - singleW / 2,
              y: top,
              width: singleW - 1,
              height,
              fill: color,
              'fill-opacity': 0.78,
              stroke: color,
              'stroke-width': 1
            }));
          });
        }

        // Area fill
        if (type === 'area' && pts.length >= 2) {
          const baseY = Math.min(margin.top + ph, Math.max(margin.top, mapY(ySc.isLog ? ySc.min : 0, ySc)));
          const dParts = [`M ${pts[0].sx} ${baseY}`];
          pts.forEach((p) => dParts.push(`L ${p.sx} ${p.sy}`));
          dParts.push(`L ${pts[pts.length - 1].sx} ${baseY} Z`);
          dataG.appendChild(createSvgEl('path', {
            d: dParts.join(' '),
            fill: color,
            'fill-opacity': 0.2
          }));
        }

        // Line
        if ((type === 'line' || type === 'line-symbol' || type === 'area') && pts.length >= 2) {
          const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.sx} ${p.sy}`).join(' ');
          const dash = getStrokeDash(s.style.lineStyle);
          dataG.appendChild(createSvgEl('path', {
            d,
            fill: 'none',
            stroke: color,
            'stroke-width': s.style.lineWidth,
            ...(dash ? { 'stroke-dasharray': dash } : {})
          }));
        }

        // Y Error Bars
        pts.forEach((p) => {
          if (Number.isFinite(p.syTop) && Number.isFinite(p.syBot)) {
            const cap = 4;
            const errG = createSvgEl('g', { stroke: color, 'stroke-width': 1.2 });
            errG.appendChild(createSvgEl('line', { x1: p.sx, y1: p.syTop, x2: p.sx, y2: p.syBot }));
            errG.appendChild(createSvgEl('line', { x1: p.sx - cap, y1: p.syTop, x2: p.sx + cap, y2: p.syTop }));
            errG.appendChild(createSvgEl('line', { x1: p.sx - cap, y1: p.syBot, x2: p.sx + cap, y2: p.syBot }));
            dataG.appendChild(errG);
          }
        });

        // Symbols
        if (type === 'scatter' || type === 'line-symbol') {
          pts.forEach((p) => {
            dataG.appendChild(drawSymbol(s.style.symbol, p.sx, p.sy, s.style.symbolSize, color));
          });
        }
      });

      // Curve Fitting Trendline Overlays (FM-04)
      (plotConfig.fitOverlays || []).forEach((ov) => {
        const ySc = ov.yAxis === 'y2' && y2Scale ? y2Scale : y1Scale;
        const pts = (ov.points || [])
          .map((p) => ({ sx: mapX(p.x), sy: mapY(p.y, ySc) }))
          .filter((p) => Number.isFinite(p.sx) && Number.isFinite(p.sy));
        if (pts.length >= 2) {
          const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.sx} ${p.sy}`).join(' ');
          dataG.appendChild(createSvgEl('path', {
            d,
            fill: 'none',
            stroke: ov.color || '#dc2626',
            'stroke-width': 2,
            'stroke-dasharray': '6,3'
          }));
        }
      });

      svg.appendChild(dataG);

      // ---- Origin-Style Frame & Inward Ticks (PL-01) ----
      const frameColor = '#111827';
      const tickSign = plotConfig.inwardTicks ? 1 : -1;
      const majLen = 7;
      const minLen = 3.5;
      const axisG = createSvgEl('g', { stroke: frameColor, 'stroke-width': 1.4, fill: 'none' });

      if (plotConfig.frameBox) {
        axisG.appendChild(createSvgEl('rect', {
          x: margin.left, y: margin.top, width: pw, height: ph,
          stroke: frameColor, 'stroke-width': 1.5, fill: 'none'
        }));
      } else {
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: margin.top + ph, x2: margin.left + pw, y2: margin.top + ph }));
        axisG.appendChild(createSvgEl('line', { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + ph }));
        if (hasY2) {
          axisG.appendChild(createSvgEl('line', { x1: margin.left + pw, y1: margin.top, x2: margin.left + pw, y2: margin.top + ph }));
        }
      }

      const labelG = createSvgEl('g', {
        fill: '#111827',
        'font-family': 'Pretendard, Arial, Helvetica, sans-serif',
        'font-size': '11.5px'
      });

      // X-axis ticks (Bottom + Top mirror if box frame)
      xScale.majorTicks.forEach((t) => {
        const x = mapX(t.val);
        if (x < margin.left - 0.5 || x > margin.left + pw + 0.5) return;
        axisG.appendChild(createSvgEl('line', {
          x1: x, y1: margin.top + ph, x2: x, y2: margin.top + ph - tickSign * majLen, 'stroke-width': 1.2
        }));
        if (plotConfig.frameBox) {
          axisG.appendChild(createSvgEl('line', {
            x1: x, y1: margin.top, x2: x, y2: margin.top + tickSign * majLen, 'stroke-width': 1.2
          }));
        }
        const lbl = createSvgEl('text', { x, y: margin.top + ph + 17, 'text-anchor': 'middle' });
        appendRichTextToSvgText(lbl, t.label, 11.5);
        labelG.appendChild(lbl);
      });

      xScale.minorTicks.forEach((v) => {
        const x = mapX(v);
        if (x <= margin.left || x >= margin.left + pw) return;
        axisG.appendChild(createSvgEl('line', {
          x1: x, y1: margin.top + ph, x2: x, y2: margin.top + ph - tickSign * minLen, 'stroke-width': 0.9
        }));
        if (plotConfig.frameBox) {
          axisG.appendChild(createSvgEl('line', {
            x1: x, y1: margin.top, x2: x, y2: margin.top + tickSign * minLen, 'stroke-width': 0.9
          }));
        }
      });

      // Y1-axis ticks (Left + Right mirror if single-Y & box frame)
      y1Scale.majorTicks.forEach((t) => {
        const y = mapY(t.val, y1Scale);
        if (y < margin.top - 0.5 || y > margin.top + ph + 0.5) return;
        axisG.appendChild(createSvgEl('line', {
          x1: margin.left, y1: y, x2: margin.left + tickSign * majLen, y2: y, 'stroke-width': 1.2
        }));
        if (plotConfig.frameBox && !hasY2) {
          axisG.appendChild(createSvgEl('line', {
            x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * majLen, y2: y, 'stroke-width': 1.2
          }));
        }
        const lbl = createSvgEl('text', { x: margin.left - 8, y: y + 4, 'text-anchor': 'end' });
        appendRichTextToSvgText(lbl, t.label, 11.5);
        labelG.appendChild(lbl);
      });

      y1Scale.minorTicks.forEach((v) => {
        const y = mapY(v, y1Scale);
        if (y <= margin.top || y >= margin.top + ph) return;
        axisG.appendChild(createSvgEl('line', {
          x1: margin.left, y1: y, x2: margin.left + tickSign * minLen, y2: y, 'stroke-width': 0.9
        }));
        if (plotConfig.frameBox && !hasY2) {
          axisG.appendChild(createSvgEl('line', {
            x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * minLen, y2: y, 'stroke-width': 0.9
          }));
        }
      });

      // Y2-axis ticks (Right independent axis for Double-Y)
      if (hasY2 && y2Scale) {
        const y2SeriesFirst = visibleSeries.find((s) => s.style.yAxis === 'y2');
        const y2Color = y2SeriesFirst ? y2SeriesFirst.style.color : '#2563eb';
        y2Scale.majorTicks.forEach((t) => {
          const y = mapY(t.val, y2Scale);
          if (y < margin.top - 0.5 || y > margin.top + ph + 0.5) return;
          axisG.appendChild(createSvgEl('line', {
            x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * majLen, y2: y,
            stroke: y2Color, 'stroke-width': 1.2
          }));
          const lbl = createSvgEl('text', { x: margin.left + pw + 8, y: y + 4, 'text-anchor': 'start', fill: y2Color });
          appendRichTextToSvgText(lbl, t.label, 11.5);
          labelG.appendChild(lbl);
        });
        y2Scale.minorTicks.forEach((v) => {
          const y = mapY(v, y2Scale);
          if (y <= margin.top || y >= margin.top + ph) return;
          axisG.appendChild(createSvgEl('line', {
            x1: margin.left + pw, y1: y, x2: margin.left + pw - tickSign * minLen, y2: y,
            stroke: y2Color, 'stroke-width': 0.9
          }));
        });
      }

      svg.appendChild(axisG);
      svg.appendChild(labelG);

      // ---- Axis Titles & Plot Title (LaTeX Rich Text) ----
      const titleG = createSvgEl('g', {
        fill: '#111827',
        'font-family': 'Pretendard, Arial, Helvetica, sans-serif',
        'font-weight': '700'
      });

      if (plotConfig.title) {
        const mainT = createSvgEl('text', {
          x: margin.left + pw / 2, y: 24, 'text-anchor': 'middle', 'font-size': '15px'
        });
        appendRichTextToSvgText(mainT, plotConfig.title, 15);
        titleG.appendChild(mainT);
      }

      // X Axis Title (Auto from Long Name [Units])
      const xTitleStr = plotConfig.xAxis.title || currentDataset.xTitle || 'X';
      const xTitleEl = createSvgEl('text', {
        x: margin.left + pw / 2, y: margin.top + ph + 42, 'text-anchor': 'middle', 'font-size': '13px'
      });
      appendRichTextToSvgText(xTitleEl, xTitleStr, 13);
      titleG.appendChild(xTitleEl);

      // Y1 Axis Title
      const y1First = visibleSeries.find((s) => s.style.yAxis !== 'y2');
      const y1TitleStr = plotConfig.yAxis.title || (y1First ? y1First.axisLabel : 'Y');
      const y1TitleEl = createSvgEl('text', {
        x: 20, y: margin.top + ph / 2, 'text-anchor': 'middle', 'font-size': '13px',
        transform: `rotate(-90, 20, ${margin.top + ph / 2})`
      });
      appendRichTextToSvgText(y1TitleEl, y1TitleStr, 13);
      titleG.appendChild(y1TitleEl);

      // Y2 Axis Title
      if (hasY2) {
        const y2First = visibleSeries.find((s) => s.style.yAxis === 'y2');
        const y2Color = y2First ? y2First.style.color : '#2563eb';
        const y2TitleStr = plotConfig.y2Axis.title || (y2First ? y2First.axisLabel : 'Y2');
        const y2X = W - 18;
        const y2TitleEl = createSvgEl('text', {
          x: y2X, y: margin.top + ph / 2, 'text-anchor': 'middle', 'font-size': '13px', fill: y2Color,
          transform: `rotate(90, ${y2X}, ${margin.top + ph / 2})`
        });
        appendRichTextToSvgText(y2TitleEl, y2TitleStr, 13);
        titleG.appendChild(y2TitleEl);
      }

      svg.appendChild(titleG);

      // ---- Draggable Legend Box (PL-05) ----
      const legendItems = [
        ...visibleSeries.map((s) => ({
          label: s.name + (hasY2 ? (s.style.yAxis === 'y2' ? ' [Y2]' : ' [Y1]') : ''),
          color: s.style.color,
          symbol: (s.style.plotType || plotConfig.plotType) === 'scatter' || (s.style.plotType || plotConfig.plotType) === 'line-symbol' ? s.style.symbol : '',
          hasLine: (s.style.plotType || plotConfig.plotType) !== 'scatter',
          dash: getStrokeDash(s.style.lineStyle)
        })),
        ...(plotConfig.fitOverlays || []).map((ov) => ({
          label: ov.eqText || ov.label,
          color: ov.color || '#dc2626',
          symbol: '',
          hasLine: true,
          dash: '6,3'
        }))
      ];

      if (plotConfig.showLegend && legendItems.length > 0) {
        const rowH = 19;
        const maxChars = legendItems.reduce((m, it) => Math.max(m, it.label.length), 8);
        const legW = Math.min(pw - 20, Math.max(120, maxChars * 7.2 + 44));
        const legH = legendItems.length * rowH + 14;
        const lx = margin.left + Math.max(4, Math.min(pw - legW - 4, plotConfig.legendPos.x * pw));
        const ly = margin.top + Math.max(4, Math.min(ph - legH - 4, plotConfig.legendPos.y * ph));

        const legG = createSvgEl('g', { class: 'origin-legend-box', style: 'cursor: move;' });
        legG.appendChild(createSvgEl('rect', {
          x: lx, y: ly, width: legW, height: legH, rx: 3,
          fill: 'rgba(255,255,255,0.92)', stroke: '#111827', 'stroke-width': 1
        }));

        legendItems.forEach((it, idx) => {
          const cy = ly + 15 + idx * rowH;
          if (it.hasLine) {
            legG.appendChild(createSvgEl('line', {
              x1: lx + 8, y1: cy, x2: lx + 28, y2: cy,
              stroke: it.color, 'stroke-width': 2,
              ...(it.dash ? { 'stroke-dasharray': it.dash } : {})
            }));
          }
          if (it.symbol) {
            legG.appendChild(drawSymbol(it.symbol, lx + 18, cy, 3.8, it.color));
          }
          const txt = createSvgEl('text', {
            x: lx + 34, y: cy + 4,
            fill: '#111827', 'font-family': 'Pretendard, Arial, sans-serif', 'font-size': '11px'
          });
          appendRichTextToSvgText(txt, it.label, 11);
          legG.appendChild(txt);
        });

        // Legend drag handler
        legG.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
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

        svg.appendChild(legG);
      }

      // Empty hint if no numeric series
      if (visibleSeries.length === 0) {
        const hint = createSvgEl('text', {
          x: margin.left + pw / 2, y: margin.top + ph / 2,
          'text-anchor': 'middle', fill: '#6b7280',
          'font-family': 'Pretendard, sans-serif', 'font-size': '13px'
        });
        hint.textContent = '시트에 숫자 데이터(X열과 Y열)를 입력하면 Origin 그래프가 실시간 표시됩니다.';
        svg.appendChild(hint);
      }

      // Overlay layer for Zoom Rect & Data Reader Crosshair
      const overlayG = createSvgEl('g', { class: 'origin-overlay-layer' });
      svg.appendChild(overlayG);

      // Attach interactive Zoom / Data Reader
      svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('.origin-legend-box')) return;
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
              const x1 = unmapX(Math.min(sx, cx));
              const x2 = unmapX(Math.max(sx, cx));
              const y1Lo = unmapY(Math.max(sy, cy), y1Scale);
              const y1Hi = unmapY(Math.min(sy, cy), y1Scale);
              zoomState = {
                x: [x1, x2],
                y1: [y1Lo, y1Hi],
                ...(y2Scale ? { y2: [unmapY(Math.max(sy, cy), y2Scale), unmapY(Math.min(sy, cy), y2Scale)] } : {})
              };
              renderPlot();
            }
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }
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
        // Snap to nearest data point
        let nearest = null;
        let bestDist = Infinity;
        for (const pt of allScreenPoints) {
          const d = (pt.sx - mx) ** 2 + (pt.sy - my) ** 2;
          if (d < bestDist) {
            bestDist = d;
            nearest = pt;
          }
        }
        if (!nearest) return;
        overlayG.innerHTML = '';
        overlayG.appendChild(createSvgEl('line', {
          x1: nearest.sx, y1: margin.top, x2: nearest.sx, y2: margin.top + ph,
          stroke: '#ef4444', 'stroke-width': 1, 'stroke-dasharray': '3,3'
        }));
        overlayG.appendChild(createSvgEl('line', {
          x1: margin.left, y1: nearest.sy, x2: margin.left + pw, y2: nearest.sy,
          stroke: '#ef4444', 'stroke-width': 1, 'stroke-dasharray': '3,3'
        }));
        overlayG.appendChild(createSvgEl('circle', {
          cx: nearest.sx, cy: nearest.sy, r: 6.5,
          fill: 'none', stroke: '#ef4444', 'stroke-width': 2
        }));

        const errPart = Number.isFinite(nearest.err) ? ` ± ${nearest.err}` : '';
        readerHud.style.display = 'block';
        readerHud.textContent = `🎯 [${nearest.seriesName}]  X = ${nearest.x}  |  Y = ${nearest.y}${errPart}`;
      });

      svg.addEventListener('dblclick', () => {
        if (zoomState) {
          zoomState = null;
          renderPlot();
        }
      });

      svgStage.innerHTML = '';
      svgStage.appendChild(svg);
      currentSvgEl = svg;
      lastRenderGeometry = { W, H };
    }

    // ---- Export SVG & 300 DPI PNG (IO-03) ----
    function exportSvg(baseName = 'origin-plot') {
      if (!currentSvgEl) return;
      const clone = currentSvgEl.cloneNode(true);
      const ov = clone.querySelector('.origin-overlay-layer');
      if (ov) ov.remove();
      const serializer = new XMLSerializer();
      const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(clone);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (typeof callbacks.onToast === 'function') callbacks.onToast(`⬇️ 벡터 그래프(${baseName}.svg) 저장됨`);
    }

    function exportPng300Dpi(baseName = 'origin-plot') {
      if (!currentSvgEl || !lastRenderGeometry) return;
      const clone = currentSvgEl.cloneNode(true);
      const ov = clone.querySelector('.origin-overlay-layer');
      if (ov) ov.remove();
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const scale = 4; // ~384 DPI (exceeds 300 DPI requirement)
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
          if (typeof callbacks.onToast === 'function') callbacks.onToast(`🖼️ 고해상도 300DPI PNG(${baseName}_300dpi.png) 저장됨`);
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        if (typeof callbacks.onToast === 'function') callbacks.onToast('⚠️ PNG 변환에 실패했습니다.');
      };
      img.src = url;
    }

    // ---- Right Plot Inspector Sidebar (PL-01 ~ PL-05) ----
    function renderInspector() {
      if (!inspectorContainer) return;
      if (typeof callbacks.extractDataset === 'function') {
        currentDataset = callbacks.extractDataset(plotConfig);
      }

      const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const seriesHtml = currentDataset.series.map((s, idx) => {
        const st = getSeriesStyle(s.colIdx, idx);
        return `
          <div class="insp-series-card" data-col="${s.colIdx}">
            <div class="insp-series-top">
              <label class="insp-check"><input type="checkbox" data-sprop="visible" ${st.visible ? 'checked' : ''}> <b>${esc(s.name)}</b></label>
              <select class="insp-select-xs" data-sprop="yAxis" title="Y축 매핑">
                <option value="y1" ${st.yAxis !== 'y2' ? 'selected' : ''}>좌측 Y1</option>
                <option value="y2" ${st.yAxis === 'y2' ? 'selected' : ''}>우측 Y2</option>
              </select>
            </div>
            <div class="insp-series-row">
              <input type="color" data-sprop="color" value="${esc(st.color)}" title="계열 색상">
              <select class="insp-select-xs" data-sprop="symbol" title="심볼 모양">
                <option value="circle" ${st.symbol === 'circle' ? 'selected' : ''}>● 원</option>
                <option value="square" ${st.symbol === 'square' ? 'selected' : ''}>■ 사각형</option>
                <option value="triangle" ${st.symbol === 'triangle' ? 'selected' : ''}>▲ 삼각형</option>
                <option value="diamond" ${st.symbol === 'diamond' ? 'selected' : ''}>◆ 마름모</option>
                <option value="triangle-down" ${st.symbol === 'triangle-down' ? 'selected' : ''}>▼ 역삼각</option>
                <option value="cross" ${st.symbol === 'cross' ? 'selected' : ''}>✕ 십자</option>
              </select>
              <select class="insp-select-xs" data-sprop="lineStyle" title="선 스타일">
                <option value="solid" ${st.lineStyle === 'solid' ? 'selected' : ''}>실선</option>
                <option value="dashed" ${st.lineStyle === 'dashed' ? 'selected' : ''}>파선</option>
                <option value="dotted" ${st.lineStyle === 'dotted' ? 'selected' : ''}>점선</option>
                <option value="dashdot" ${st.lineStyle === 'dashdot' ? 'selected' : ''}>일점쇄선</option>
              </select>
              <input type="number" class="insp-num-xs" data-sprop="lineWidth" value="${st.lineWidth}" min="0.5" max="6" step="0.5" title="선 두께">
            </div>
          </div>
        `;
      }).join('') || '<div class="insp-empty">표시할 Y열 데이터가 없습니다.</div>';

      const fitCount = (plotConfig.fitOverlays || []).length;

      inspectorContainer.innerHTML = `
        <div class="insp-head">
          <span>🎛️ Origin 그래프 속성</span>
          ${fitCount > 0 ? '<button type="button" class="sb-tb-btn" data-icmd="clear-fits">피팅 지우기</button>' : ''}
        </div>
        <div class="insp-body">
          <div class="insp-sec">
            <div class="insp-sec-title">기본 스타일</div>
            <label class="insp-field"><span>그래프 제목 (LaTeX)</span><input type="text" data-prop="title" value="${esc(plotConfig.title)}" placeholder="예: \\Delta P vs Q"></label>
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
          </div>

          <div class="insp-sec">
            <div class="insp-sec-title">X축 (가로)</div>
            <label class="insp-field"><span>제목 (비우면 자동)</span><input type="text" data-axis="xAxis" data-aprop="title" value="${esc(plotConfig.xAxis.title)}" placeholder="예: T_{in} \\text{ [°C]}"></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>From</span><input type="text" data-axis="xAxis" data-aprop="min" value="${esc(plotConfig.xAxis.min)}" placeholder="자동"></label>
              <label class="insp-field"><span>To</span><input type="text" data-axis="xAxis" data-aprop="max" value="${esc(plotConfig.xAxis.max)}" placeholder="자동"></label>
              <label class="insp-field"><span>주 간격</span><input type="text" data-axis="xAxis" data-aprop="increment" value="${esc(plotConfig.xAxis.increment)}" placeholder="자동"></label>
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
            <label class="insp-field"><span>제목 (비우면 자동)</span><input type="text" data-axis="yAxis" data-aprop="title" value="${esc(plotConfig.yAxis.title)}" placeholder="예: \\Delta P \\text{ [kPa]}"></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>From</span><input type="text" data-axis="yAxis" data-aprop="min" value="${esc(plotConfig.yAxis.min)}" placeholder="자동"></label>
              <label class="insp-field"><span>To</span><input type="text" data-axis="yAxis" data-aprop="max" value="${esc(plotConfig.yAxis.max)}" placeholder="자동"></label>
              <label class="insp-field"><span>주 간격</span><input type="text" data-axis="yAxis" data-aprop="increment" value="${esc(plotConfig.yAxis.increment)}" placeholder="자동"></label>
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
              <label class="insp-field"><span>Y2 제목</span><input type="text" data-axis="y2Axis" data-aprop="title" value="${esc(plotConfig.y2Axis.title)}" placeholder="자동"></label>
              <div class="insp-grid-2">
                <label class="insp-field"><span>From</span><input type="text" data-axis="y2Axis" data-aprop="min" value="${esc(plotConfig.y2Axis.min)}" placeholder="자동"></label>
                <label class="insp-field"><span>To</span><input type="text" data-axis="y2Axis" data-aprop="max" value="${esc(plotConfig.y2Axis.max)}" placeholder="자동"></label>
                <label class="insp-field"><span>주 간격</span><input type="text" data-axis="y2Axis" data-aprop="increment" value="${esc(plotConfig.y2Axis.increment)}" placeholder="자동"></label>
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
            <div class="insp-sec-title">데이터 계열 (Series)</div>
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
        const btn = e.target.closest('[data-icmd]');
        if (!btn) return;
        if (btn.dataset.icmd === 'clear-fits') {
          plotConfig.fitOverlays = [];
          notifyConfigChange();
          renderInspector();
          renderPlot();
        }
      });
    }

    plotBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (tool === 'zoom' || tool === 'reader') {
        interactionMode = tool;
        plotBar.querySelectorAll('[data-tool="zoom"], [data-tool="reader"]').forEach((b) => {
          b.classList.toggle('active', b.dataset.tool === tool);
        });
        if (tool !== 'reader') {
          readerHud.style.display = 'none';
          const ov = currentSvgEl?.querySelector('.origin-overlay-layer');
          if (ov) ov.innerHTML = '';
        }
      } else if (tool === 'reset-zoom') {
        zoomState = null;
        renderPlot();
      } else if (tool === 'export-svg') {
        exportSvg(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot');
      } else if (tool === 'export-png') {
        exportPng300Dpi(callbacks.getFileName ? callbacks.getFileName() : 'origin-plot');
      } else if (tool === 'toggle-inspector') {
        if (typeof callbacks.onToggleInspector === 'function') callbacks.onToggleInspector();
      }
    });

    const resizeObs = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => renderPlot())
      : null;
    if (resizeObs) resizeObs.observe(svgStage);

    return {
      refresh() {
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
        plotConfig.fitOverlays = [...(plotConfig.fitOverlays || []), overlay];
        notifyConfigChange();
        renderInspector();
        renderPlot();
      },
      getConfig() {
        return JSON.parse(JSON.stringify(plotConfig));
      },
      setConfig(cfg) {
        plotConfig = mergePlotConfig(cfg);
        zoomState = null;
        renderInspector();
        renderPlot();
      },
      setInteractionMode(mode) {
        interactionMode = mode;
        plotBar.querySelectorAll('[data-tool="zoom"], [data-tool="reader"]').forEach((b) => {
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
      }
    };
  }

  global.BrainOriginPlot = {
    createDefaultPlotConfig,
    mergePlotConfig,
    linearRegression,
    polynomialRegression,
    movingAverage,
    parseRichMathSegments,
    mountOriginPlotPanel
  };
})(window);
