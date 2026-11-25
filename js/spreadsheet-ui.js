(function (global) {
  'use strict';

  const BS = global.BrainSpreadsheet;
  if (!BS || !BS._internals) {
    console.error('[BrainSpreadsheetUI] BrainSpreadsheet core must load first.');
    return;
  }

  const {
    MAX_UNDO_STEPS,
    colToLetter,
    cellKey,
    parseCellRef,
    cloneWorkbook,
    createEmptySheet,
    getColMeta,
    isErr,
    isBlank,
    toStrictNumber,
    compareValues,
    formatDisplayValue,
    getUsedBounds
  } = BS._internals;

  const {
    createEmptyWorkbook,
    EXAMPLE_CATALOG,
    createExampleWorkbook,
    normalizeWorkbook,
    parseArrayBufferToWorkbook,
    exportWorkbookToXlsxBlob,
    exportSheetToCsv,
    workbookToMarkdownSummary,
    createEvaluator,
    shiftFormula,
    shiftFormulaOnInsertDelete,
    expandColumnFormula
  } = BS;

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ================= Function Library Catalog (Excel Formulas Tab) =================
  const FUNCTION_CATALOG = [
    { cat: '집계/통계', name: 'SUM', sig: '=SUM(A1:A10)', desc: '합계 계산' },
    { cat: '집계/통계', name: 'AVERAGE', sig: '=AVERAGE(A1:A10)', desc: '평균 계산' },
    { cat: '집계/통계', name: 'STDEV / VAR / MEDIAN', sig: '=STDEV(B1:B10)', desc: '표준편차 / 분산 / 중앙값' },
    { cat: '집계/통계', name: 'MIN / MAX / COUNT', sig: '=MAX(B1:B10)', desc: '최솟값 / 최댓값 / 숫자 개수' },
    { cat: '집계/통계', name: 'SUMPRODUCT / RANK', sig: '=SUMPRODUCT(A1:A5,B1:B5)', desc: '배열 곱 합계 / 순위' },
    { cat: '재무', name: 'PMT', sig: '=PMT(0.05/12, 60, -10000000)', desc: '정기 상환액 계산 (월납입금)' },
    { cat: '재무', name: 'FV', sig: '=FV(0.05/12, 60, -200000, 0)', desc: '미래가치 계산' },
    { cat: '재무', name: 'PV', sig: '=PV(0.05/12, 60, -200000)', desc: '현재가치 계산' },
    { cat: '재무', name: 'NPV', sig: '=NPV(0.08, B1:B5)', desc: '순현재가치 계산' },
    { cat: '수학/삼각', name: 'SIN / COS / TAN', sig: '=SIN(RADIANS(A1))', desc: '삼각함수 (라디안·도 변환)' },
    { cat: '수학/삼각', name: 'EXP / LN / LOG10', sig: '=LN(A1)', desc: '지수함수 / 자연로그 / 상용로그' },
    { cat: '수학/삼각', name: 'SQRT / POWER / ABS / PI', sig: '=SQRT(POWER(A1,2)+POWER(B1,2))', desc: '제곱근 / 거듭제곱 / 절댓값 / 원주율' },
    { cat: '수학/삼각', name: 'ROUND / ROUNDUP / MOD', sig: '=ROUND(A1,2)', desc: '반올림 / 올림 / 나머지' },
    { cat: '조건부 집계', name: 'SUMIF / SUMIFS', sig: '=SUMIF(A1:A10,">10",B1:B10)', desc: '단일·다중 조건 합계' },
    { cat: '조건부 집계', name: 'COUNTIF / COUNTIFS', sig: '=COUNTIF(A1:A10,">=75")', desc: '단일·다중 조건 개수' },
    { cat: '조건부 집계', name: 'AVERAGEIF', sig: '=AVERAGEIF(A1:A10,"적합",B1:B10)', desc: '조건부 평균' },
    { cat: '논리', name: 'IF / IFS / IFERROR', sig: '=IF(A1>=75,"적합","검토")', desc: '조건 분기 / 다중 조건 / 오류 처리' },
    { cat: '논리', name: 'AND / OR / NOT', sig: '=IF(AND(A1>0,B1>0),"OK","NO")', desc: '논리 연산' },
    { cat: '찾기/참조', name: 'VLOOKUP / XLOOKUP', sig: '=VLOOKUP(A2,D2:F10,2,FALSE)', desc: '표 검색 및 값 조회' },
    { cat: '찾기/참조', name: 'INDEX / MATCH', sig: '=INDEX(B2:B10,MATCH(A2,A2:A10,0))', desc: '행/열 인덱스 기반 조회' },
    { cat: '텍스트', name: 'CONCAT / TEXTJOIN / TEXT', sig: '=TEXT(A1,"#,##0.0")', desc: '문자열 결합 및 서식 변환' },
    { cat: '텍스트', name: 'LEFT / RIGHT / MID / SUBSTITUTE', sig: '=LEFT(A1,4)', desc: '문자열 추출 및 치환' },
    { cat: '날짜 및 시간', name: 'TODAY / DAYS / DATEDIF', sig: '=DAYS(B1,A1)', desc: '오늘 날짜 / 두 날짜 간격 계산' }
  ];

  const FORMULA_CATEGORIES = {
    financial: [
      { label: 'PMT(이율, 기간, 현재가치)', sig: '=PMT(0.05/12,60,-10000000)' },
      { label: 'FV(이율, 기간, 납입액)', sig: '=FV(0.05/12,60,-200000)' },
      { label: 'PV(이율, 기간, 납입액)', sig: '=PV(0.05/12,60,-200000)' },
      { label: 'NPV(할인율, 현금흐름범위)', sig: '=NPV(0.08,B1:B5)' }
    ],
    logical: [
      { label: 'IF(조건, 참, 거짓)', sig: '=IF(A1>=75,"적합","검토")' },
      { label: 'IFS(조건1, 값1, ...)', sig: '=IFS(A1>=90,"A",A1>=80,"B",TRUE,"C")' },
      { label: 'IFERROR(수식, 대체값)', sig: '=IFERROR(A1/B1,0)' },
      { label: 'AND(조건1, 조건2)', sig: '=AND(A1>0,B1>0)' },
      { label: 'OR(조건1, 조건2)', sig: '=OR(A1>0,B1>0)' },
      { label: 'NOT(조건)', sig: '=NOT(A1=0)' }
    ],
    text: [
      { label: 'CONCAT(텍스트1, 텍스트2)', sig: '=CONCAT(A1," ",B1)' },
      { label: 'TEXTJOIN(구분자, 빈셀무시, 범위)', sig: '=TEXTJOIN(", ",TRUE,A1:A5)' },
      { label: 'TEXT(값, "형식")', sig: '=TEXT(A1,"#,##0.0")' },
      { label: 'LEFT(텍스트, 개수)', sig: '=LEFT(A1,4)' },
      { label: 'RIGHT(텍스트, 개수)', sig: '=RIGHT(A1,4)' },
      { label: 'MID(텍스트, 시작, 개수)', sig: '=MID(A1,2,3)' },
      { label: 'LEN(텍스트)', sig: '=LEN(A1)' },
      { label: 'SUBSTITUTE(텍스트, 이전, 새값)', sig: '=SUBSTITUTE(A1," ","_")' },
      { label: 'TRIM(텍스트)', sig: '=TRIM(A1)' },
      { label: 'UPPER / LOWER', sig: '=UPPER(A1)' }
    ],
    date: [
      { label: 'TODAY() — 오늘 날짜', sig: '=TODAY()' },
      { label: 'NOW() — 현재 날짜/시각', sig: '=NOW()' },
      { label: 'DATE(연, 월, 일)', sig: '=DATE(2026,11,22)' },
      { label: 'YEAR / MONTH / DAY', sig: '=YEAR(A1)' },
      { label: 'DAYS(종료일, 시작일)', sig: '=DAYS(B1,A1)' },
      { label: 'DATEDIF(시작일, 종료일, "D")', sig: '=DATEDIF(A1,B1,"D")' },
      { label: 'EOMONTH(날짜, 개월수)', sig: '=EOMONTH(A1,1)' },
      { label: 'EDATE(날짜, 개월수)', sig: '=EDATE(A1,3)' }
    ],
    lookup: [
      { label: 'VLOOKUP(찾을값, 범위, 열번호, FALSE)', sig: '=VLOOKUP(A2,D2:F10,2,FALSE)' },
      { label: 'XLOOKUP(찾을값, 검색범위, 반환범위)', sig: '=XLOOKUP(A2,D2:D10,E2:E10,"없음")' },
      { label: 'INDEX(범위, 행번호)', sig: '=INDEX(B2:B10,MATCH(A2,A2:A10,0))' },
      { label: 'MATCH(찾을값, 범위, 0)', sig: '=MATCH(A2,A2:A10,0)' },
      { label: 'ROW() / COLUMN()', sig: '=ROW()' }
    ],
    math: [
      { label: 'SUM(범위)', sig: '=SUM(A1:A10)' },
      { label: 'SUMIF(범위, 조건, 합계범위)', sig: '=SUMIF(A1:A10,">10",B1:B10)' },
      { label: 'SUMIFS(합계범위, 조건범위, 조건)', sig: '=SUMIFS(B1:B10,A1:A10,">10")' },
      { label: 'SUMPRODUCT(배열1, 배열2)', sig: '=SUMPRODUCT(A1:A5,B1:B5)' },
      { label: 'ROUND(값, 자릿수)', sig: '=ROUND(A1,2)' },
      { label: 'SQRT(값)', sig: '=SQRT(A1)' },
      { label: 'POWER(밑, 지수)', sig: '=POWER(A1,2)' },
      { label: 'ABS(값)', sig: '=ABS(A1)' },
      { label: 'SIN / COS / TAN (라디안)', sig: '=SIN(RADIANS(A1))' },
      { label: 'LN / LOG10 / EXP', sig: '=LN(A1)' },
      { label: 'PI() — 원주율', sig: '=PI()' },
      { label: 'MOD(나눔수, 나누는수)', sig: '=MOD(A1,2)' }
    ],
    more: [
      { label: 'AVERAGE(범위) — 평균', sig: '=AVERAGE(A1:A10)' },
      { label: 'AVERAGEIF(범위, 조건, 평균범위)', sig: '=AVERAGEIF(A1:A10,">0",B1:B10)' },
      { label: 'MEDIAN(범위) — 중앙값', sig: '=MEDIAN(A1:A10)' },
      { label: 'STDEV(범위) — 표준편차', sig: '=STDEV(A1:A10)' },
      { label: 'VAR(범위) — 분산', sig: '=VAR(A1:A10)' },
      { label: 'COUNT / COUNTA', sig: '=COUNT(A1:A10)' },
      { label: 'COUNTIF(범위, 조건)', sig: '=COUNTIF(A1:A10,">=75")' },
      { label: 'RANK(값, 범위)', sig: '=RANK(A1,$A$1:$A$10)' },
      { label: 'ISNUMBER / ISBLANK / ISERROR', sig: '=ISNUMBER(A1)' }
    ]
  };

  const SYMBOL_CHARS = [
    'Δ', 'α', 'β', 'γ', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Ω', 'η', 'ε',
    '±', '×', '÷', '·', '≈', '≠', '≤', '≥', '∞', '°', '℃', '℉', '√', '∑', '∫', '∂',
    '→', '←', '↔', '²', '³', '⁻¹', 'm²', 'm³', 'kPa', 'MPa'
  ];

  const EQUATION_SNIPPETS = [
    { label: '피타고라스 / 크기  √(A1² + B1²)', sig: '=SQRT(POWER(A1,2)+POWER(B1,2))' },
    { label: '삼각함수  SIN(RADIANS(A1))', sig: '=SIN(RADIANS(A1))' },
    { label: '자연로그 / 지수  LN(A1)', sig: '=LN(A1)' },
    { label: '상대 오차(%)  ABS(A1-B1)/B1', sig: '=ABS(A1-B1)/B1' },
    { label: '원의 면적  π·r²', sig: '=PI()*POWER(A1,2)' },
    { label: '표준화(Z-score)  (A1-평균)/표준편차', sig: '=(A1-AVERAGE($A$1:$A$10))/STDEV($A$1:$A$10)' },
    { label: '레이놀즈 수  ρ·v·D / μ', sig: '=(A1*B1*C1)/D1' },
    { label: '라벨: ΔP [kPa] (LaTeX)', raw: '\\Delta P [kPa]' },
    { label: '라벨: 효율 η [%] (LaTeX)', raw: '효율 \\eta [%]' }
  ];

  const CELL_STYLE_PRESETS = [
    { label: '표준 (기본)', style: null },
    { label: '제목 1 (굵은 남색)', style: { bold: true, fontSize: 15, color: '#1e3a8a', borderBottom: '2px solid #217346' } },
    { label: '강조 헤더 (엑셀 그린)', style: { bold: true, bg: '#217346', color: '#ffffff', align: 'center' } },
    { label: '좋음 (녹색)', style: { bg: '#dcfce7', color: '#166534', bold: true } },
    { label: '나쁨 (빨강)', style: { bg: '#fee2e2', color: '#991b1b', bold: true } },
    { label: '보통 (노랑)', style: { bg: '#fef3c7', color: '#92400e', bold: true } },
    { label: '입력 셀 (파랑 강조)', style: { bg: '#eff6ff', color: '#1d4ed8', borderAll: true } },
    { label: '요약 / 합계행', style: { bold: true, bg: '#f1f5f9', borderTop: '1px solid #334155', borderBottom: '3px double #334155' } }
  ];

  // ================= Inline Cell Sparkline SVG =================
  function buildSparklineSvg(sparkCfg, evaluator, sheetIdx) {
    if (!sparkCfg || !sparkCfg.range) return '';
    const parts = String(sparkCfg.range).split(':');
    const p1 = parseCellRef(parts[0]);
    const p2 = parts[1] ? parseCellRef(parts[1]) : p1;
    if (!p1 || !p2) return '';
    const r1 = Math.min(p1.row, p2.row), r2 = Math.max(p1.row, p2.row);
    const c1 = Math.min(p1.col, p2.col), c2 = Math.max(p1.col, p2.col);
    const vals = [];
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = evaluator.evalCell(sheetIdx, cellKey(r, c));
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
      }
    }
    if (vals.length === 0) return '';
    const W = 82, H = 20, pad = 2;
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;

    if (sparkCfg.type === 'col') {
      const bw = Math.max(2, (W - pad * 2) / vals.length - 1);
      const baseZero = min < 0 && max > 0 ? pad + ((max - 0) / span) * (H - pad * 2) : H - pad;
      const bars = vals.map((v, i) => {
        const x = pad + i * ((W - pad * 2) / vals.length);
        const y = pad + ((max - v) / span) * (H - pad * 2);
        const top = Math.min(y, baseZero);
        const bh = Math.max(1.5, Math.abs(baseZero - y));
        return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${v < 0 ? '#dc2626' : '#217346'}"/>`;
      }).join('');
      return `<svg class="xl-sparkline-svg" viewBox="0 0 ${W} ${H}" width="100%" height="20">${bars}</svg>`;
    }

    if (sparkCfg.type === 'winloss') {
      const bw = Math.max(2, (W - pad * 2) / vals.length - 1);
      const mid = H / 2;
      const bars = vals.map((v, i) => {
        const x = pad + i * ((W - pad * 2) / vals.length);
        if (v === 0) return '';
        return `<rect x="${x.toFixed(1)}" y="${v > 0 ? 2 : mid}" width="${bw.toFixed(1)}" height="${mid - 2}" fill="${v > 0 ? '#2563eb' : '#dc2626'}"/>`;
      }).join('');
      return `<svg class="xl-sparkline-svg" viewBox="0 0 ${W} ${H}" width="100%" height="20"><line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="#cbd5e1" stroke-width="0.7"/>${bars}</svg>`;
    }

    // Default: line
    const pts = vals.map((v, i) => {
      const x = vals.length === 1 ? W / 2 : pad + (i / (vals.length - 1)) * (W - pad * 2);
      const y = pad + ((max - v) / span) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const lastPt = pts.split(' ').pop().split(',');
    return `<svg class="xl-sparkline-svg" viewBox="0 0 ${W} ${H}" width="100%" height="20"><polyline fill="none" stroke="#2563eb" stroke-width="1.5" points="${pts}"/><circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2" fill="#dc2626"/></svg>`;
  }

  // ================= Interactive Excel + Origin Spreadsheet UI =================
  function mountSpreadsheetUI(container, options = {}) {
    let workbook = normalizeWorkbook(options.workbook || createEmptyWorkbook());
    let evaluator = createEvaluator(workbook);

    const undoStack = [];
    const redoStack = [];
    let isDirty = false;
    let autoSaveTimer = null;
    let clipboardData = null;

    // Mode separation: 'excel' | 'origin'
    let appMode = options.initialAppMode === 'origin' ? 'origin' : 'excel';
    let activeRibbonTab = 'home'; // 'home' | 'insert' | 'formulas' | 'data' | 'view' | 'graph'
    let viewMode = appMode === 'origin' ? (options.initialViewMode || 'split') : 'sheet';
    let showMetaRows = appMode === 'origin';
    let showInspector = appMode === 'origin';
    let showGridlines = true;
    let showFormulaBar = true;
    let zoomLevel = 100;

    let formatPainterStyle = null;
    const recentFunctions = ['SUM', 'AVERAGE', 'IF', 'VLOOKUP', 'ROUND'];

    let selAnchor = { r: 0, c: 0 };
    let selFocus = { r: 0, c: 0 };
    let isSelecting = false;
    let isSelectingCols = false;
    let isSelectingRows = false;
    let isFillDragging = false;
    let fillTarget = null;
    let editingCell = null; // { r, c, source: 'cell'|'formula' }

    let plotController = null;
    let findMatches = [];
    let findCursor = -1;

    function getSheet() {
      return workbook.sheets[workbook.activeSheet] || workbook.sheets[0];
    }

    function getNormRange() {
      return {
        r1: Math.min(selAnchor.r, selFocus.r),
        r2: Math.max(selAnchor.r, selFocus.r),
        c1: Math.min(selAnchor.c, selFocus.c),
        c2: Math.max(selAnchor.c, selFocus.c)
      };
    }

    function toast(msg) {
      if (typeof options.onToast === 'function') options.onToast(msg);
    }

    function pushUndo() {
      undoStack.push(cloneWorkbook(workbook));
      if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
      redoStack.length = 0;
    }

    function scheduleAutoSave() {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        if (typeof options.onAutoSave === 'function') {
          try {
            options.onAutoSave(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
            elAutoBackup.textContent = `자동 백업됨 (${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`;
          } catch (_) {}
        }
      }, 1000);
    }

    function markDirty(skipBroadcast = false) {
      isDirty = true;
      evaluator.clear();
      updateDirtyUI();
      scheduleAutoSave();
      if (typeof options.onDirtyChange === 'function') options.onDirtyChange(true);
      if (!skipBroadcast && typeof options.onWorkbookMutate === 'function') {
        options.onWorkbookMutate(cloneWorkbook(workbook));
      }
    }

    function setCellData(sheet, r, c, raw, stylePatch = null) {
      const addr = cellKey(r, c);
      const prev = sheet.cells[addr] || { raw: '' };
      const nextRaw = raw !== undefined ? String(raw) : (prev.raw || '');
      const nextStyle = stylePatch ? { ...(prev.style || {}), ...stylePatch } : prev.style;
      const hasStyle = nextStyle && Object.keys(nextStyle).some((k) => nextStyle[k] !== undefined && nextStyle[k] !== '');
      const spark = prev.sparkline;

      if (nextRaw === '' && !hasStyle && !spark) delete sheet.cells[addr];
      else {
        const nextObj = { raw: nextRaw };
        if (hasStyle) nextObj.style = nextStyle;
        if (spark) nextObj.sparkline = spark;
        sheet.cells[addr] = nextObj;
      }
    }

    // ---- Extract Origin Dataset from Active Sheet ----
    function extractOriginDataset(plotCfg) {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const { maxR, maxC } = getUsedBounds(sheet);
      const colLimit = Math.max(maxC, 0);

      let xCol = Number.isInteger(plotCfg?.xCol) ? plotCfg.xCol : -1;
      if (xCol < 0) {
        for (let c = 0; c <= colLimit; c++) {
          if (getColMeta(sheet, c).role === 'X') { xCol = c; break; }
        }
      }
      if (xCol < 0) xCol = 0;

      const xMeta = getColMeta(sheet, xCol);
      const xTitle = xMeta.longName
        ? `${xMeta.longName}${xMeta.units ? ` [${xMeta.units}]` : ''}`
        : `Col(${colToLetter(xCol)})`;

      const series = [];
      for (let c = 0; c <= colLimit; c++) {
        if (c === xCol) continue;
        const meta = getColMeta(sheet, c);
        if (meta.role !== 'Y') continue;

        let errCol = -1;
        if (c + 1 <= colLimit && getColMeta(sheet, c + 1).role === 'yErr') errCol = c + 1;

        const points = [];
        for (let r = 0; r <= maxR; r++) {
          const xVal = evaluator.evalCell(sIdx, cellKey(r, xCol));
          const yVal = evaluator.evalCell(sIdx, cellKey(r, c));
          if (typeof xVal === 'number' && Number.isFinite(xVal) && typeof yVal === 'number' && Number.isFinite(yVal)) {
            let errVal = NaN;
            if (errCol >= 0) {
              const ev = evaluator.evalCell(sIdx, cellKey(r, errCol));
              if (typeof ev === 'number' && Number.isFinite(ev)) errVal = Math.abs(ev);
            }
            points.push({ x: xVal, y: yVal, err: errVal, row: r });
          }
        }

        const name = meta.longName || `Col(${colToLetter(c)})`;
        const axisLabel = meta.longName
          ? `${meta.longName}${meta.units ? ` [${meta.units}]` : ''}`
          : name;
        series.push({ colIdx: c, errCol, name, axisLabel, points });
      }
      return { xCol, xTitle, series };
    }

    // ---- Build Excel-Authentic DOM Skeleton ----
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = `sb-sheet-root excel-ui appmode-${appMode}`;
    root.tabIndex = 0;

    // 1. Excel Green Ribbon Tab Strip (Top)
    const ribbonHeader = document.createElement('div');
    ribbonHeader.className = 'xl-ribbon-top';
    ribbonHeader.innerHTML = `
      <div class="xl-qat">
        <button type="button" class="xl-qat-btn" data-cmd="save" title="저장 (Ctrl+S)">💾</button>
        <button type="button" class="xl-qat-btn" data-cmd="undo" title="실행 취소 (Ctrl+Z)">↩️</button>
        <button type="button" class="xl-qat-btn" data-cmd="redo" title="다시 실행 (Ctrl+Y)">↪️</button>
      </div>
      <div class="xl-ribbon-tabs">
        <button type="button" class="xl-rtab xl-rtab-file" data-dropdown="file-menu">파일</button>
        <button type="button" class="xl-rtab active" data-rtab="home">홈</button>
        <button type="button" class="xl-rtab" data-rtab="insert">삽입</button>
        <button type="button" class="xl-rtab" data-rtab="formulas">수식</button>
        <button type="button" class="xl-rtab" data-rtab="data">데이터</button>
        <button type="button" class="xl-rtab" data-rtab="view">보기</button>
        <button type="button" class="xl-rtab xl-rtab-origin" data-rtab="graph">그래프</button>
      </div>
      <div class="xl-top-right-controls">
        <div class="xl-mode-switch" title="엑셀 작업 모드와 OriginLab 과학 그래프 모드를 전환합니다">
          <button type="button" class="xl-mode-btn ${appMode === 'excel' ? 'active' : ''}" data-appmode="excel">📗 Excel</button>
          <button type="button" class="xl-mode-btn ${appMode === 'origin' ? 'active' : ''}" data-appmode="origin">📈 Origin</button>
        </div>
        <div class="xl-view-switcher" data-role="origin-view-switcher">
          <button type="button" class="xl-view-btn" data-vmode="sheet" title="워크시트 전체 보기">시트</button>
          <button type="button" class="xl-view-btn active" data-vmode="split" title="시트 + Origin 그래프 좌우 분할">분할</button>
          <button type="button" class="xl-view-btn" data-vmode="plot" title="Origin 그래프 전체 보기">그래프</button>
        </div>
        <span class="sb-sheet-dirty" data-role="dirty">저장됨</span>
      </div>
    `;

    // 2. Excel Ribbon Command Bar (exact match to 4 screenshots minus red-X items)
    const ribbonBody = document.createElement('div');
    ribbonBody.className = 'xl-ribbon-body';
    ribbonBody.innerHTML = `
      <!-- 홈 탭 (Image 1: 클립보드, 글꼴, 맞춤, 표시 형식, 스타일[표서식/셀스타일], 셀, 편집) -->
      <div class="xl-rpanel active" data-rpanel="home">
        <div class="xl-rgroup">
          <div class="xl-rgroup-grid xl-rg-clipboard">
            <button type="button" class="xl-big-btn" data-cmd="paste" title="붙여넣기 (Ctrl+V)"><span class="xl-big-ico">📋</span><span>붙여넣기</span></button>
            <div class="xl-stack-col">
              <button type="button" class="xl-mini-btn" data-cmd="cut" title="잘라내기 (Ctrl+X)">✂️ 잘라내기</button>
              <button type="button" class="xl-mini-btn" data-cmd="copy" title="복사 (Ctrl+C)">📄 복사</button>
              <button type="button" class="xl-mini-btn" data-cmd="format-painter" title="서식 복사: 현재 셀의 서식을 다른 셀에 복사">🖌️ 서식 복사</button>
            </div>
          </div>
          <div class="xl-rgroup-lbl">클립보드</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-stack-rows">
            <div class="xl-rrow">
              <select class="xl-rselect" data-cmd="font-family" title="글꼴" style="width:94px;">
                <option value="">Pretendard</option>
                <option value="Malgun Gothic, sans-serif">맑은 고딕</option>
                <option value="Calibri, sans-serif">Calibri</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Consolas, monospace">Consolas</option>
                <option value="Times New Roman, serif">Times New Roman</option>
              </select>
              <select class="xl-rselect" data-cmd="font-size" title="글꼴 크기" style="width:48px;">
                <option value="9">9</option>
                <option value="10">10</option>
                <option value="11" selected>11</option>
                <option value="12">12</option>
                <option value="14">14</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="20">20</option>
                <option value="24">24</option>
              </select>
              <button type="button" class="sb-tb-btn" data-cmd="font-inc" title="글꼴 크기 크게">가↑</button>
              <button type="button" class="sb-tb-btn" data-cmd="font-dec" title="글꼴 크기 작게">가↓</button>
            </div>
            <div class="xl-rrow">
              <button type="button" class="sb-tb-btn" data-cmd="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
              <button type="button" class="sb-tb-btn" data-cmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
              <button type="button" class="sb-tb-btn" data-cmd="underline" title="밑줄 (Ctrl+U)"><u>U</u></button>
              <button type="button" class="sb-tb-btn" data-dropdown="borders" title="셀 테두리">▦▾</button>
              <label class="sb-tb-color" title="채우기 색">🎨<input type="color" data-cmd="bg" value="#fef9c3"></label>
              <label class="sb-tb-color" title="글자 색"><b>A</b><input type="color" data-cmd="color" value="#1e293b"></label>
            </div>
          </div>
          <div class="xl-rgroup-lbl">글꼴</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-grid">
            <div class="xl-stack-rows">
              <div class="xl-rrow">
                <button type="button" class="sb-tb-btn" data-cmd="valign-top" title="위쪽 맞춤">⤒</button>
                <button type="button" class="sb-tb-btn" data-cmd="valign-middle" title="가운데 맞춤(세로)">↕</button>
                <button type="button" class="sb-tb-btn" data-cmd="valign-bottom" title="아래쪽 맞춤">⤓</button>
              </div>
              <div class="xl-rrow">
                <button type="button" class="sb-tb-btn" data-cmd="align-left" title="왼쪽 맞춤">⫤</button>
                <button type="button" class="sb-tb-btn" data-cmd="align-center" title="가운데 맞춤">≡</button>
                <button type="button" class="sb-tb-btn" data-cmd="align-right" title="오른쪽 맞춤">⫥</button>
              </div>
            </div>
            <div class="xl-stack-col">
              <button type="button" class="xl-mini-btn" data-cmd="wrap-text" title="텍스트 자동 줄 바꿈">↩ 자동 줄 바꿈</button>
              <button type="button" class="xl-mini-btn" data-cmd="merge-center" title="선택 영역 병합하고 가운데 맞춤">⊞ 병합하고 가운데 맞춤</button>
            </div>
          </div>
          <div class="xl-rgroup-lbl">맞춤</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-stack-rows">
            <div class="xl-rrow">
              <select class="xl-rselect" data-cmd="num-fmt-select" title="표시 형식" style="width:104px;">
                <option value="general">일반</option>
                <option value="number">숫자 (1,000)</option>
                <option value="currency">통화 (₩)</option>
                <option value="usd">달러 ($)</option>
                <option value="percent">백분율 (%)</option>
                <option value="date">날짜</option>
              </select>
            </div>
            <div class="xl-rrow">
              <button type="button" class="sb-tb-btn" data-cmd="fmt-currency" title="원화 (₩)">₩</button>
              <button type="button" class="sb-tb-btn" data-cmd="fmt-percent" title="백분율 (%)">%</button>
              <button type="button" class="sb-tb-btn" data-cmd="fmt-number" title="천단위 쉼표">,</button>
              <button type="button" class="sb-tb-btn" data-cmd="dec-inc" title="자릿수 늘림">.0+</button>
              <button type="button" class="sb-tb-btn" data-cmd="dec-dec" title="자릿수 줄임">.0-</button>
            </div>
          </div>
          <div class="xl-rgroup-lbl">표시 형식</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-dropdown="table-style" title="선택 범위에 표 서식 적용"><span class="xl-big-ico">▤</span><span>표 서식 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="cell-style" title="셀 스타일 프리셋"><span class="xl-big-ico">🎨</span><span>셀 스타일 ▾</span></button>
          </div>
          <div class="xl-rgroup-lbl">스타일</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-dropdown="cell-insert" title="행/열/시트 삽입"><span class="xl-big-ico">➕</span><span>삽입 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="cell-delete" title="행/열 삭제"><span class="xl-big-ico">➖</span><span>삭제 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="cell-format" title="열 너비·서식·메타행"><span class="xl-big-ico">📐</span><span>서식 ▾</span></button>
          </div>
          <div class="xl-rgroup-lbl">셀</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-grid">
            <div class="xl-stack-col">
              <button type="button" class="xl-mini-btn" data-dropdown="autosum-menu" title="자동 합계 및 기본 통계">Σ 자동 합계 ▾</button>
              <button type="button" class="xl-mini-btn" data-dropdown="fill-menu" title="선택 영역 채우기">⬇️ 채우기 ▾</button>
              <button type="button" class="xl-mini-btn" data-dropdown="clear-menu" title="내용/서식 지우기">🧹 지우기 ▾</button>
            </div>
            <button type="button" class="xl-big-btn" data-dropdown="sort-filter-menu" title="정렬 및 엑셀 필터 (Ctrl+Shift+L)"><span class="xl-big-ico">🔻</span><span>정렬 및<br>필터 ▾</span></button>
            <button type="button" class="xl-big-btn" data-cmd="open-find" title="찾기 및 바꾸기 (Ctrl+F)"><span class="xl-big-ico">🔍</span><span>찾기 및<br>선택</span></button>
          </div>
          <div class="xl-rgroup-lbl">편집</div>
        </div>
      </div>

      <!-- 삽입 탭 (Image 2: ORIGIN 차트 + 스파클라인 + 기호[π 수식, Ω 기호]) -->
      <div class="xl-rpanel" data-rpanel="insert">
        <div class="xl-rgroup xl-rgroup-origin">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="plot-line-symbol"><span class="xl-big-ico">📈</span><span>선+심볼</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-scatter"><span class="xl-big-ico">⚬</span><span>산점도</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-line"><span class="xl-big-ico">〰️</span><span>선 그래프</span></button>
            <button type="button" class="xl-big-btn origin-accent" data-cmd="plot-double-y"><span class="xl-big-ico">📊</span><span>Double-Y</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-bar"><span class="xl-big-ico">📶</span><span>막대</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-area"><span class="xl-big-ico">⛰️</span><span>영역</span></button>
            <button type="button" class="xl-big-btn" data-cmd="open-fit"><span class="xl-big-ico">📐</span><span>커브 피팅</span></button>
          </div>
          <div class="xl-rgroup-lbl">ORIGIN 차트 (클릭 시 Origin 모드 실행)</div>
        </div>

        <div class="xl-rgroup xl-rgroup-origin">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="spark-line" title="현재 셀에 꺾은선 스파클라인 삽입"><span class="xl-big-ico">📉</span><span>꺾은선형</span></button>
            <button type="button" class="xl-big-btn" data-cmd="spark-col" title="현재 셀에 열 스파클라인 삽입"><span class="xl-big-ico">📊</span><span>열</span></button>
            <button type="button" class="xl-big-btn" data-cmd="spark-winloss" title="현재 셀에 승패 스파클라인 삽입"><span class="xl-big-ico">⚖️</span><span>승패</span></button>
            <button type="button" class="xl-mini-btn" data-cmd="spark-clear" title="선택 셀 스파클라인 제거">🧹 지우기</button>
          </div>
          <div class="xl-rgroup-lbl">스파클라인 (ORIGIN)</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-dropdown="eq-picker" title="공학 수식 템플릿 삽입"><span class="xl-big-ico" style="font-family:Georgia,serif;">π</span><span>수식 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="sym-picker" title="그리스 문자·공학 기호 삽입"><span class="xl-big-ico" style="font-family:Georgia,serif;">Ω</span><span>기호 ▾</span></button>
          </div>
          <div class="xl-rgroup-lbl">기호</div>
        </div>
      </div>

      <!-- 수식 탭 (Image 3: 함수 라이브러리 + 이름 관리자 + Origin 열 일괄 수식) -->
      <div class="xl-rpanel" data-rpanel="formulas">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn primary-lit" data-cmd="fx-help" title="전체 내장 함수 검색 및 삽입"><span class="xl-big-ico" style="font-style:italic;font-family:Georgia,serif;">fx</span><span>함수 삽입</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="autosum-menu"><span class="xl-big-ico">Σ</span><span>자동 합계 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-recent"><span class="xl-big-ico">★</span><span>최근 사용<br>항목 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-financial"><span class="xl-big-ico">💰</span><span>재무 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-logical"><span class="xl-big-ico">❓</span><span>논리 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-text"><span class="xl-big-ico">가</span><span>텍스트 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-date"><span class="xl-big-ico">📅</span><span>날짜 및<br>시간 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-lookup"><span class="xl-big-ico">🔎</span><span>찾기/참조<br>영역 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-math"><span class="xl-big-ico">θ</span><span>수학/삼각 ▾</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="fn-more"><span class="xl-big-ico">⋯</span><span>함수 더<br>보기 ▾</span></button>
          </div>
          <div class="xl-rgroup-lbl">함수 라이브러리</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="name-manager" title="수식에서 쓸 셀/범위 이름 정의"><span class="xl-big-ico">🏷️</span><span>이름<br>관리자</span></button>
          </div>
          <div class="xl-rgroup-lbl">정의된 이름</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn origin-accent" data-cmd="set-col-values"><span class="xl-big-ico">⚡</span><span>열 일괄<br>수식</span></button>
          </div>
          <div class="xl-rgroup-lbl">Origin 열 연산</div>
        </div>
      </div>

      <!-- 데이터 탭 -->
      <div class="xl-rpanel" data-rpanel="data">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="toggle-filter" title="엑셀 열 필터 켜기/끄기 (Ctrl+Shift+L)"><span class="xl-big-ico">🔻</span><span>필터</span></button>
            <button type="button" class="xl-big-btn" data-cmd="clear-filters" title="적용된 모든 열 필터 해제"><span class="xl-big-ico">↺</span><span>필터 해제</span></button>
            <button type="button" class="xl-big-btn" data-cmd="sort-asc"><span class="xl-big-ico">⬆️</span><span>오름차순</span></button>
            <button type="button" class="xl-big-btn" data-cmd="sort-desc"><span class="xl-big-ico">⬇️</span><span>내림차순</span></button>
          </div>
          <div class="xl-rgroup-lbl">정렬 및 필터</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn origin-accent" data-cmd="open-fit"><span class="xl-big-ico">📐</span><span>커브 피팅</span></button>
            <button type="button" class="xl-big-btn" data-cmd="set-col-values"><span class="xl-big-ico">⚡</span><span>열 일괄수식</span></button>
          </div>
          <div class="xl-rgroup-lbl">과학 데이터 분석</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="import-file"><span class="xl-big-ico">📂</span><span>CSV/Excel<br>불러오기</span></button>
            <button type="button" class="xl-big-btn" data-cmd="export-xlsx"><span class="xl-big-ico">⬇️</span><span>.xlsx 저장</span></button>
            <button type="button" class="xl-big-btn" data-cmd="export-csv"><span class="xl-big-ico">📄</span><span>.csv 저장</span></button>
            <button type="button" class="xl-big-btn" data-cmd="export-json"><span class="xl-big-ico">💾</span><span>프로젝트</span></button>
            <button type="button" class="xl-big-btn" data-cmd="ask-ai"><span class="xl-big-ico">🤖</span><span>AI 분석</span></button>
          </div>
          <div class="xl-rgroup-lbl">파일 입출력</div>
        </div>
      </div>

      <!-- 보기 탭 (Image 4: 확대/축소, 100%, 선택 영역 확대/축소 | 새 창, 모두 정렬, 틀 고정) -->
      <div class="xl-rpanel" data-rpanel="view">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-dropdown="zoom-menu" title="시트 배율 선택"><span class="xl-big-ico">🔍</span><span>확대/<br>축소 ▾</span></button>
            <button type="button" class="xl-big-btn" data-cmd="zoom-100" title="100% 기본 배율로 복원"><span class="xl-big-ico" style="font-size:0.86rem;font-weight:800;color:#2563eb;">1:1</span><span>100%</span></button>
            <button type="button" class="xl-big-btn" data-cmd="zoom-selection" title="선택한 셀 영역에 맞춰 확대/축소"><span class="xl-big-ico">🎯</span><span>선택 영역<br>확대/축소</span></button>
          </div>
          <div class="xl-rgroup-lbl">확대/축소</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn primary-lit" data-cmd="new-window" title="같은 파일을 새 창으로 하나 더 열어 실시간 동기화하며 보기"><span class="xl-big-ico">🪟</span><span>새 창</span></button>
            <button type="button" class="xl-big-btn" data-cmd="arrange-windows" title="열려 있는 시트 창들을 나란히 정렬"><span class="xl-big-ico">◫</span><span>모두<br>정렬</span></button>
            <button type="button" class="xl-big-btn" data-dropdown="freeze-menu" title="행/열 틀 고정 (스크롤 시 고정 유지)"><span class="xl-big-ico">❄️</span><span>틀 고정 ▾</span></button>
          </div>
          <div class="xl-rgroup-lbl">창</div>
        </div>

        <div class="xl-rgroup">
          <div class="xl-stack-col">
            <label class="insp-check"><input type="checkbox" data-vchk="gridlines" checked> 눈금선 표시</label>
            <label class="insp-check"><input type="checkbox" data-vchk="formulabar" checked> 수식 입력줄</label>
            <label class="insp-check"><input type="checkbox" data-vchk="metarows" ${showMetaRows ? 'checked' : ''}> Origin 메타행 (Long Name/Units)</label>
          </div>
          <div class="xl-rgroup-lbl">표시</div>
        </div>
      </div>

      <!-- 그래프 (Origin) 탭 -->
      <div class="xl-rpanel" data-rpanel="graph">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="plot-select"><span class="xl-big-ico">↖️</span><span>선택/편집</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-zoom"><span class="xl-big-ico">🔍</span><span>드래그 줌</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-reader"><span class="xl-big-ico">🎯</span><span>데이터 리더</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-reset"><span class="xl-big-ico">↺</span><span>축 복원</span></button>
          </div>
          <div class="xl-rgroup-lbl">탐색</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn" data-cmd="plot-add-text"><span class="xl-big-ico" style="font-weight:800;">T</span><span>텍스트 삽입</span></button>
            <button type="button" class="xl-big-btn origin-accent" data-cmd="open-fit"><span class="xl-big-ico">📐</span><span>커브 피팅</span></button>
            <button type="button" class="xl-big-btn" data-cmd="plot-legend"><span class="xl-big-ico">🏷️</span><span>범례 편집</span></button>
            <button type="button" class="xl-big-btn" data-cmd="toggle-inspector"><span class="xl-big-ico">🎛️</span><span>속성 패널</span></button>
          </div>
          <div class="xl-rgroup-lbl">편집 · 분석</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="xl-big-btn primary-lit" data-cmd="export-svg"><span class="xl-big-ico">⬇️</span><span>벡터 SVG</span></button>
            <button type="button" class="xl-big-btn primary-lit" data-cmd="export-png"><span class="xl-big-ico">🖼️</span><span>300DPI PNG</span></button>
          </div>
          <div class="xl-rgroup-lbl">논문·보고서 출력</div>
        </div>
      </div>
    `;

    // Floating Ribbon Dropdown (anchored on root so never clipped by horizontal scroll)
    const ribbonDropdown = document.createElement('div');
    ribbonDropdown.className = 'xl-ribbon-dropdown';
    ribbonDropdown.style.display = 'none';

    // Hidden file inputs
    const importFileInput = document.createElement('input');
    importFileInput.type = 'file';
    importFileInput.accept = '.xlsx,.xls,.csv,.tsv,.txt';
    importFileInput.style.display = 'none';

    const importJsonInput = document.createElement('input');
    importJsonInput.type = 'file';
    importJsonInput.accept = '.json';
    importJsonInput.style.display = 'none';

    // 3. Excel Formula Bar
    const formulaBar = document.createElement('div');
    formulaBar.className = 'sb-sheet-formula-bar';
    formulaBar.innerHTML = `
      <input type="text" class="sb-cell-addr-box" data-role="addr" value="A1" title="셀 주소 (입력 후 Enter로 이동)" autocomplete="off">
      <div class="xl-fbar-btns">
        <button type="button" class="xl-fbar-btn" data-fcmd="cancel" title="취소 (Esc)">✕</button>
        <button type="button" class="xl-fbar-btn" data-fcmd="commit" title="입력 (Enter)">✓</button>
        <button type="button" class="sb-fx-badge" data-cmd="fx-help" title="함수 삽입">ƒx</button>
      </div>
      <input type="text" class="sb-formula-input" data-role="formula-input" placeholder="값 또는 수식 입력 (예: =SUM(A1:A10), =SIN(RADIANS(A1)))" autocomplete="off" spellcheck="false">
    `;

    // 4. Function Helper Drawer
    const fxPanel = document.createElement('div');
    fxPanel.className = 'sb-fx-panel';
    fxPanel.style.display = 'none';
    fxPanel.innerHTML = `
      <div class="sb-fx-panel-head">
        <span>ƒx 내장 엑셀·재무·공학 함수 (클릭하면 현재 셀에 삽입)</span>
        <input type="text" class="sb-fx-search" placeholder="함수 검색 (예: PMT, SIN, VLOOKUP, SUMIF...)">
        <button type="button" class="sb-tb-btn" data-cmd="close-fx">✕</button>
      </div>
      <div class="sb-fx-list">${FUNCTION_CATALOG.map((f) =>
        `<button type="button" class="sb-fx-item" data-sig="${escHtml(f.sig)}" data-fname="${escHtml(f.name.split('/')[0].trim())}">
          <span class="sb-fx-cat">${escHtml(f.cat)}</span>
          <span class="sb-fx-name">${escHtml(f.name)}</span>
          <span class="sb-fx-sig">${escHtml(f.sig)}</span>
          <span class="sb-fx-desc">${escHtml(f.desc)}</span>
        </button>`
      ).join('')}</div>
    `;

    // 4b. Find & Replace Bar (Ctrl+F)
    const findBar = document.createElement('div');
    findBar.className = 'xl-find-bar';
    findBar.style.display = 'none';
    findBar.innerHTML = `
      <span class="xl-find-lbl">🔍 찾기</span>
      <input type="text" class="xl-find-inp" data-fr="query" placeholder="찾을 내용...">
      <input type="text" class="xl-find-inp" data-fr="replace" placeholder="바꿀 내용...">
      <span class="xl-find-count" data-fr="count">0 / 0</span>
      <button type="button" class="sb-tb-btn" data-fract="prev">▲ 이전</button>
      <button type="button" class="sb-tb-btn" data-fract="next">▼ 다음</button>
      <button type="button" class="sb-tb-btn" data-fract="replace-one">바꾸기</button>
      <button type="button" class="sb-tb-btn" data-fract="replace-all">모두 바꾸기</button>
      <button type="button" class="sb-tb-btn" data-fract="close">✕</button>
    `;

    // 5. Main Split Workspace
    const workspace = document.createElement('div');
    workspace.className = `xl-workspace mode-${viewMode}`;

    const gridPane = document.createElement('div');
    gridPane.className = 'xl-grid-pane';

    const gridWrap = document.createElement('div');
    gridWrap.className = 'sb-sheet-grid-wrap';
    const table = document.createElement('table');
    table.className = 'sb-sheet-table';
    const colgroup = document.createElement('colgroup');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    table.appendChild(colgroup);
    table.appendChild(thead);
    table.appendChild(tbody);
    gridWrap.appendChild(table);

    const inlineEditor = document.createElement('input');
    inlineEditor.type = 'text';
    inlineEditor.className = 'sb-inline-editor';
    inlineEditor.style.display = 'none';
    inlineEditor.autocomplete = 'off';
    inlineEditor.spellcheck = false;
    gridWrap.appendChild(inlineEditor);

    const selOverlay = document.createElement('div');
    selOverlay.className = 'sb-sel-overlay';
    selOverlay.style.display = 'none';
    gridWrap.appendChild(selOverlay);

    const fillHandle = document.createElement('div');
    fillHandle.className = 'sb-fill-handle';
    fillHandle.title = '드래그하여 숫자 패턴 또는 수식 자동 채우기';
    gridWrap.appendChild(fillHandle);

    const hdrMenu = document.createElement('div');
    hdrMenu.className = 'xl-hdr-menu';
    hdrMenu.style.display = 'none';

    const filterPopover = document.createElement('div');
    filterPopover.className = 'xl-filter-popover';
    filterPopover.style.display = 'none';

    gridPane.appendChild(findBar);
    gridPane.appendChild(gridWrap);
    gridPane.appendChild(hdrMenu);
    gridPane.appendChild(filterPopover);

    const plotPane = document.createElement('div');
    plotPane.className = 'xl-plot-pane';
    const plotCanvasBox = document.createElement('div');
    plotCanvasBox.className = 'xl-plot-canvas-box';
    const plotInspectorBox = document.createElement('div');
    plotInspectorBox.className = 'xl-plot-inspector-box';
    plotInspectorBox.style.display = showInspector ? 'flex' : 'none';
    plotPane.appendChild(plotCanvasBox);
    plotPane.appendChild(plotInspectorBox);

    workspace.appendChild(gridPane);
    workspace.appendChild(plotPane);

    // 6. Inline Modal Overlay
    const subModal = document.createElement('div');
    subModal.className = 'xl-submodal-overlay';
    subModal.style.display = 'none';

    // 7. Bottom Excel Sheet Tabs + Status Bar + Zoom Slider
    const footerBar = document.createElement('div');
    footerBar.className = 'sb-sheet-footer';
    footerBar.innerHTML = `
      <div class="sb-sheet-tabs" data-role="tabs"></div>
      <div class="xl-footer-right">
        <span class="xl-autobackup-lbl" data-role="autobackup">자동 백업 준비</span>
        <div class="sb-sheet-stats" data-role="stats">준비</div>
        <div class="xl-zoom-bar" title="시트 확대/축소">
          <button type="button" class="xl-zoom-step" data-zact="out">−</button>
          <span class="xl-zoom-val" data-role="zoom-val">100%</span>
          <button type="button" class="xl-zoom-step" data-zact="in">+</button>
        </div>
      </div>
    `;

    root.appendChild(ribbonHeader);
    root.appendChild(ribbonBody);
    root.appendChild(formulaBar);
    root.appendChild(fxPanel);
    root.appendChild(workspace);
    root.appendChild(footerBar);
    root.appendChild(ribbonDropdown);
    root.appendChild(subModal);
    root.appendChild(importFileInput);
    root.appendChild(importJsonInput);
    container.appendChild(root);

    const elAddr = formulaBar.querySelector('[data-role="addr"]');
    const elFormulaInput = formulaBar.querySelector('[data-role="formula-input"]');
    const elDirty = ribbonHeader.querySelector('[data-role="dirty"]');
    const elTabs = footerBar.querySelector('[data-role="tabs"]');
    const elStats = footerBar.querySelector('[data-role="stats"]');
    const elAutoBackup = footerBar.querySelector('[data-role="autobackup"]');
    const elZoomVal = footerBar.querySelector('[data-role="zoom-val"]');
    const fxSearchInput = fxPanel.querySelector('.sb-fx-search');

    let tdMatrix = [];

    // ---- Initialize Origin Plot Controller ----
    if (global.BrainOriginPlot) {
      plotController = global.BrainOriginPlot.mountOriginPlotPanel(plotCanvasBox, plotInspectorBox, {
        getPlotConfig: () => getSheet().plotConfig,
        extractDataset: (cfg) => extractOriginDataset(cfg),
        getFileName: () => String(options.fileName || getSheet().name || 'origin-plot').replace(/\.(xlsx|xls|csv|json)$/i, ''),
        onConfigChange(nextCfg) {
          getSheet().plotConfig = nextCfg;
          markDirty();
        },
        onToggleInspector() {
          showInspector = !showInspector;
          plotInspectorBox.style.display = showInspector ? 'flex' : 'none';
          if (plotController) setTimeout(() => plotController.refresh(), 40);
        },
        onWriteFitColumn({ yCol, method, fitRes, points }) {
          const sheet = getSheet();
          const { maxC: curMaxC } = getUsedBounds(sheet);
          pushUndo();
          const outCol = Math.max(curMaxC + 1, 0);
          if (outCol >= sheet.cols) sheet.cols = outCol + 4;
          const yName = getColMeta(sheet, yCol).longName || `Col(${colToLetter(yCol)})`;
          if (!sheet.colMeta) sheet.colMeta = {};
          sheet.colMeta[outCol] = {
            longName: `${yName} (${method})`,
            units: getColMeta(sheet, yCol).units,
            comments: fitRes.eqText,
            role: ''
          };
          if (fitRes.points) {
            fitRes.points.forEach((p) => {
              setCellData(sheet, p.row, outCol, String(Math.round(p.y * 1e6) / 1e6), { align: 'right' });
            });
          } else {
            points.forEach((p) => {
              const pred = fitRes.predict(p.x);
              if (Number.isFinite(pred)) {
                setCellData(sheet, p.row, outCol, String(Math.round(pred * 1e6) / 1e6), { align: 'right' });
              }
            });
          }
          markDirty();
          renderGridStructure();
        },
        onToast: toast
      });
    }

    function refreshPlotIfVisible() {
      if (plotController && viewMode !== 'sheet') {
        plotController.refresh();
      }
    }

    function switchRibbonTab(tabName) {
      activeRibbonTab = tabName;
      ribbonHeader.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === activeRibbonTab));
      ribbonBody.querySelectorAll('[data-rpanel]').forEach((p) => p.classList.toggle('active', p.dataset.rpanel === activeRibbonTab));
    }

    function setViewMode(nextMode) {
      viewMode = nextMode;
      workspace.classList.remove('mode-sheet', 'mode-split', 'mode-plot');
      workspace.classList.add(`mode-${nextMode}`);
      ribbonHeader.querySelectorAll('[data-vmode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.vmode === nextMode);
      });
      if (nextMode === 'plot') {
        showInspector = true;
        plotInspectorBox.style.display = 'flex';
      } else if (nextMode === 'split') {
        plotInspectorBox.style.display = showInspector ? 'flex' : 'none';
      }
      if (nextMode !== 'sheet' && plotController) {
        plotController.setConfig(getSheet().plotConfig);
        setTimeout(() => plotController.refresh(), 50);
      }
    }

    function setAppMode(nextAppMode) {
      appMode = nextAppMode === 'origin' ? 'origin' : 'excel';
      root.classList.toggle('appmode-excel', appMode === 'excel');
      root.classList.toggle('appmode-origin', appMode === 'origin');
      ribbonHeader.querySelectorAll('[data-appmode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.appmode === appMode);
      });

      if (appMode === 'excel') {
        showMetaRows = false;
        setViewMode('sheet');
        if (activeRibbonTab === 'graph') switchRibbonTab('home');
      } else {
        showMetaRows = true;
        showInspector = true;
        plotInspectorBox.style.display = 'flex';
        setViewMode(viewMode === 'sheet' ? 'split' : viewMode);
      }

      const metaChk = ribbonBody.querySelector('[data-vchk="metarows"]');
      if (metaChk) metaChk.checked = showMetaRows;
      renderGridStructure();
    }

    function setZoom(nextZoom) {
      zoomLevel = Math.max(50, Math.min(200, Math.round(nextZoom)));
      table.style.zoom = `${zoomLevel}%`;
      elZoomVal.textContent = `${zoomLevel}%`;
      positionFillHandle();
    }

    function updateDirtyUI() {
      elDirty.textContent = isDirty ? '● 수정됨' : '저장됨';
      elDirty.classList.toggle('is-dirty', isDirty);
    }

    function getActiveEditorInput() {
      if (!editingCell) return null;
      return editingCell.source === 'formula' ? elFormulaInput : inlineEditor;
    }

    function isEditingFormula() {
      const inp = getActiveEditorInput();
      return Boolean(inp && inp.value.startsWith('='));
    }

    function positionFillHandle() {
      const { r1, r2, c1, c2 } = getNormRange();
      const td1 = tdMatrix[r1]?.[c1];
      const td2 = tdMatrix[r2]?.[c2];
      const scale = zoomLevel / 100;

      if (td1 && td2 && (r1 !== r2 || c1 !== c2) && td1.style.display !== 'none' && td2.style.display !== 'none') {
        selOverlay.style.display = 'block';
        selOverlay.style.left = `${td1.offsetLeft * scale}px`;
        selOverlay.style.top = `${td1.offsetTop * scale}px`;
        selOverlay.style.width = `${Math.max(0, (td2.offsetLeft + td2.offsetWidth - td1.offsetLeft) * scale)}px`;
        selOverlay.style.height = `${Math.max(0, (td2.offsetTop + td2.offsetHeight - td1.offsetTop) * scale)}px`;
      } else {
        selOverlay.style.display = 'none';
      }

      if (!td2 || editingCell || td2.style.display === 'none') {
        fillHandle.style.display = 'none';
        return;
      }
      fillHandle.style.display = 'block';
      fillHandle.style.left = `${(td2.offsetLeft + td2.offsetWidth) * scale - 5}px`;
      fillHandle.style.top = `${(td2.offsetTop + td2.offsetHeight) * scale - 5}px`;
    }

    function selectAllCells() {
      const sheet = getSheet();
      commitEdit();
      selAnchor = { r: 0, c: 0 };
      selFocus = { r: Math.max(0, sheet.rows - 1), c: Math.max(0, sheet.cols - 1) };
      updateSelectionVisuals();
      root.focus({ preventScroll: true });
    }

    function recordRecentFn(fnName) {
      const up = String(fnName || '').toUpperCase().replace(/[^A-Z0-9_.]/g, '');
      if (!up) return;
      const idx = recentFunctions.indexOf(up);
      if (idx >= 0) recentFunctions.splice(idx, 1);
      recentFunctions.unshift(up);
      if (recentFunctions.length > 8) recentFunctions.pop();
    }

    function insertFormulaSnippet(sig, fnName = '') {
      if (fnName) recordRecentFn(fnName);
      startEdit(selAnchor.r, selAnchor.c, sig, 'formula');
      const openIdx = sig.indexOf('(');
      if (openIdx >= 0 && sig.endsWith(')')) {
        elFormulaInput.setSelectionRange(openIdx + 1, sig.length - 1);
      }
    }

    function insertTextIntoCellOrEditor(text) {
      if (editingCell) {
        const inp = getActiveEditorInput();
        if (inp) {
          const s = inp.selectionStart ?? inp.value.length;
          const e = inp.selectionEnd ?? inp.value.length;
          const next = inp.value.slice(0, s) + text + inp.value.slice(e);
          inp.value = next;
          elFormulaInput.value = next;
          if (inp === elFormulaInput) inlineEditor.value = next;
          inp.focus();
          inp.setSelectionRange(s + text.length, s + text.length);
          return;
        }
      }
      const sheet = getSheet();
      const prev = sheet.cells[cellKey(selAnchor.r, selAnchor.c)]?.raw || '';
      pushUndo();
      setCellData(sheet, selAnchor.r, selAnchor.c, prev + text);
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    // ================= Excel Column Filter =================
    function getCellDisplayStr(sheet, sIdx, r, c) {
      const addr = cellKey(r, c);
      const val = evaluator.evalCell(sIdx, addr);
      return formatDisplayValue(val, sheet.cells[addr]?.style);
    }

    function applyRowFiltersVisuals() {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const activeCols = sheet.filterEnabled ? Object.keys(sheet.columnFilters || {}) : [];
      const { maxR } = getUsedBounds(sheet);
      let visibleCount = 0;
      let totalDataRows = 0;

      for (let r = 0; r < sheet.rows; r++) {
        const tr = tbody.children[r];
        if (!tr) continue;
        if (!sheet.filterEnabled || activeCols.length === 0 || r === 0 || r > maxR) {
          tr.style.display = '';
          const rTh = tr.children[0];
          if (rTh) rTh.classList.remove('is-filtered-row');
          continue;
        }
        totalDataRows++;
        let pass = true;
        for (const colStr of activeCols) {
          const ci = Number(colStr);
          const allowed = sheet.columnFilters[colStr]?.allowed;
          if (!Array.isArray(allowed)) continue;
          const disp = getCellDisplayStr(sheet, sIdx, r, ci);
          const normDisp = disp === '' ? '(빈 셀)' : disp;
          if (!allowed.includes(normDisp)) { pass = false; break; }
        }
        tr.style.display = pass ? '' : 'none';
        const rTh = tr.children[0];
        if (rTh) rTh.classList.toggle('is-filtered-row', pass);
        if (pass) visibleCount++;
      }

      const filterBtn = ribbonBody.querySelector('[data-cmd="toggle-filter"]');
      if (filterBtn) filterBtn.classList.toggle('active', Boolean(sheet.filterEnabled));

      if (sheet.filterEnabled && activeCols.length > 0 && totalDataRows > 0) {
        elStats.textContent = `🔻 필터 적용: ${totalDataRows}개 중 ${visibleCount}개 행 표시`;
      }
    }

    function openColumnFilterPopover(colIdx, anchorEl) {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const { maxR } = getUsedBounds(sheet);

      const valueCounts = new Map();
      for (let r = 1; r <= maxR; r++) {
        const disp = getCellDisplayStr(sheet, sIdx, r, colIdx);
        const key = disp === '' ? '(빈 셀)' : disp;
        valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
      }

      const allVals = Array.from(valueCounts.keys()).sort((a, b) => {
        if (a === '(빈 셀)') return 1;
        if (b === '(빈 셀)') return -1;
        const na = toStrictNumber(a), nb = toStrictNumber(b);
        if (na !== null && nb !== null) return na - nb;
        return a.localeCompare(b, 'ko');
      });

      const curFilter = sheet.columnFilters?.[colIdx];
      const checkedSet = new Set(curFilter && Array.isArray(curFilter.allowed) ? curFilter.allowed : allVals);

      const paneRect = gridPane.getBoundingClientRect();
      const btnRect = anchorEl.getBoundingClientRect();
      const left = Math.max(6, Math.min(paneRect.width - 246, btnRect.left - paneRect.left - 160));
      const top = Math.max(28, Math.min(paneRect.height - 310, btnRect.bottom - paneRect.top + 3));

      filterPopover.innerHTML = `
        <div class="xl-fp-head">
          <span>🔻 열 ${colToLetter(colIdx)} 필터</span>
          <button type="button" class="origin-pop-close" data-fpclose="1">✕</button>
        </div>
        <div class="xl-fp-sorts">
          <button type="button" data-fpact="sort-asc">⬆️ 오름차순 정렬 (A→Z)</button>
          <button type="button" data-fpact="sort-desc">⬇️ 내림차순 정렬 (Z→A)</button>
        </div>
        <input type="text" class="xl-fp-search" placeholder="값 검색...">
        <label class="xl-fp-item xl-fp-all"><input type="checkbox" data-fpall="1" ${checkedSet.size === allVals.length ? 'checked' : ''}> <b>(모두 선택)</b></label>
        <div class="xl-fp-list">
          ${allVals.map((v) => `
            <label class="xl-fp-item" data-fval="${escHtml(v)}">
              <input type="checkbox" value="${escHtml(v)}" ${checkedSet.has(v) ? 'checked' : ''}>
              <span class="xl-fp-val">${escHtml(v)}</span>
              <span class="xl-fp-cnt">${valueCounts.get(v)}</span>
            </label>
          `).join('') || '<div class="insp-empty" style="padding:8px;">필터링할 데이터 행(2행 이하)이 없습니다.</div>'}
        </div>
        <div class="xl-fp-foot">
          <button type="button" class="sb-tb-btn" data-fpact="clear">필터 해제</button>
          <button type="button" class="sb-tb-btn primary" data-fpact="apply">확인</button>
        </div>
      `;
      filterPopover.style.left = `${left}px`;
      filterPopover.style.top = `${top}px`;
      filterPopover.style.display = 'flex';

      const searchInp = filterPopover.querySelector('.xl-fp-search');
      const allChk = filterPopover.querySelector('[data-fpall]');
      const getValChks = () => Array.from(filterPopover.querySelectorAll('.xl-fp-list input[type="checkbox"]'));

      searchInp.addEventListener('input', () => {
        const q = searchInp.value.trim().toLowerCase();
        filterPopover.querySelectorAll('.xl-fp-list .xl-fp-item').forEach((lbl) => {
          lbl.style.display = !q || lbl.dataset.fval.toLowerCase().includes(q) ? 'flex' : 'none';
        });
      });

      allChk.addEventListener('change', () => {
        getValChks().forEach((c) => {
          if (c.closest('.xl-fp-item').style.display !== 'none') c.checked = allChk.checked;
        });
      });

      filterPopover.querySelector('[data-fpclose]').addEventListener('click', () => {
        filterPopover.style.display = 'none';
      });
      filterPopover.querySelector('[data-fpact="sort-asc"]').addEventListener('click', () => {
        filterPopover.style.display = 'none';
        sortSheetByColumn(colIdx, true);
      });
      filterPopover.querySelector('[data-fpact="sort-desc"]').addEventListener('click', () => {
        filterPopover.style.display = 'none';
        sortSheetByColumn(colIdx, false);
      });
      filterPopover.querySelector('[data-fpact="clear"]').addEventListener('click', () => {
        if (sheet.columnFilters) delete sheet.columnFilters[colIdx];
        filterPopover.style.display = 'none';
        markDirty();
        refreshAllCellValues();
      });
      filterPopover.querySelector('[data-fpact="apply"]').addEventListener('click', () => {
        const selectedVals = getValChks().filter((c) => c.checked).map((c) => c.value);
        if (!sheet.columnFilters) sheet.columnFilters = {};
        if (selectedVals.length === allVals.length) {
          delete sheet.columnFilters[colIdx];
        } else {
          sheet.columnFilters[colIdx] = { allowed: selectedVals };
        }
        filterPopover.style.display = 'none';
        markDirty();
        refreshAllCellValues();
      });
    }

    // ================= Freeze Panes (틀 고정) =================
    function applyFreezePanes() {
      const sheet = getSheet();
      const freezeR = Math.max(0, Math.min(sheet.rows - 1, sheet.freeze?.rows || 0));
      const freezeC = Math.max(0, Math.min(sheet.cols - 1, sheet.freeze?.cols || 0));

      const theadBaseTop = showMetaRows ? (26 + 23 * 3) : 26;
      const rowHdrW = showMetaRows ? 76 : 46;

      // Compute cumulative left offsets for columns
      const colLefts = [];
      let accX = rowHdrW;
      for (let c = 0; c < sheet.cols; c++) {
        colLefts.push(accX);
        accX += (sheet.colWidths[c] || 98);
      }

      // Column headers sticky left when frozen
      const headTr = thead.children[0];
      if (headTr) {
        for (let c = 0; c < sheet.cols; c++) {
          const th = headTr.children[c + 1];
          if (!th) continue;
          if (c < freezeC) {
            th.style.left = `${colLefts[c]}px`;
            th.style.zIndex = '28';
          } else {
            th.style.left = '';
            th.style.zIndex = '';
          }
          th.classList.toggle('xl-frozen-col-edge', freezeC > 0 && c === freezeC - 1);
        }
      }

      // Data rows & cells
      for (let r = 0; r < sheet.rows; r++) {
        const tr = tbody.children[r];
        if (!tr) continue;
        const isFrozenR = r < freezeR;
        const stickyTop = theadBaseTop + r * 26;
        const rowTh = tr.children[0];
        if (rowTh) {
          if (isFrozenR) {
            rowTh.style.top = `${stickyTop}px`;
            rowTh.style.zIndex = '24';
          } else {
            rowTh.style.top = '';
            rowTh.style.zIndex = '';
          }
          rowTh.classList.toggle('xl-frozen-row-edge', freezeR > 0 && r === freezeR - 1);
        }

        for (let c = 0; c < sheet.cols; c++) {
          const td = tdMatrix[r]?.[c];
          if (!td) continue;
          const isFrozenC = c < freezeC;
          if (isFrozenR || isFrozenC) {
            td.style.position = 'sticky';
            td.style.top = isFrozenR ? `${stickyTop}px` : '';
            td.style.left = isFrozenC ? `${colLefts[c]}px` : '';
            td.style.zIndex = (isFrozenR && isFrozenC) ? '22' : (isFrozenR ? '14' : '12');
          } else {
            td.style.position = '';
            td.style.top = '';
            td.style.left = '';
            td.style.zIndex = '';
          }
          td.classList.toggle('xl-frozen-cell', isFrozenR || isFrozenC);
          td.classList.toggle('xl-frozen-row-edge', freezeR > 0 && r === freezeR - 1);
          td.classList.toggle('xl-frozen-col-edge', freezeC > 0 && c === freezeC - 1);
        }
      }
    }

    // ---- Column / Row Header Right-Click Menu ----
    function openHeaderContextMenu(e, kind, index) {
      e.preventDefault();
      e.stopPropagation();
      const sheet = getSheet();
      const paneRect = gridPane.getBoundingClientRect();
      const left = Math.max(4, Math.min(paneRect.width - 210, e.clientX - paneRect.left));
      const top = Math.max(4, Math.min(paneRect.height - 240, e.clientY - paneRect.top));

      if (kind === 'col') {
        const colLetter = colToLetter(index);
        const curRole = getColMeta(sheet, index).role;
        hdrMenu.innerHTML = `
          <div class="xl-hm-title">열 ${colLetter} 작업</div>
          <button type="button" data-hact="ins-col-left">➕ 왼쪽에 열 삽입</button>
          <button type="button" data-hact="ins-col-right">➕ 오른쪽에 열 삽입</button>
          <button type="button" data-hact="del-col" class="danger">🗑️ 열 ${colLetter} 삭제</button>
          <hr>
          <button type="button" data-hact="role-X">${curRole === 'X' ? '✓ ' : ''}Origin 역할: X (독립변수)</button>
          <button type="button" data-hact="role-Y">${curRole === 'Y' ? '✓ ' : ''}Origin 역할: Y (종속변수)</button>
          <button type="button" data-hact="role-yErr">${curRole === 'yErr' ? '✓ ' : ''}Origin 역할: yErr (오차막대)</button>
          <button type="button" data-hact="role-none">${curRole === '' ? '✓ ' : ''}Origin 역할 해제</button>
          <hr>
          <button type="button" data-hact="set-col-val">⚡ 열 일괄 수식 (Set Column Values)...</button>
          <button type="button" data-hact="sort-asc">⬆️ 열 ${colLetter} 기준 오름차순</button>
          <button type="button" data-hact="sort-desc">⬇️ 열 ${colLetter} 기준 내림차순</button>
        `;
      } else {
        hdrMenu.innerHTML = `
          <div class="xl-hm-title">행 ${index + 1} 작업</div>
          <button type="button" data-hact="ins-row-above">➕ 위에 행 삽입</button>
          <button type="button" data-hact="ins-row-below">➕ 아래에 행 삽입</button>
          <button type="button" data-hact="del-row" class="danger">🗑️ 행 ${index + 1} 삭제</button>
        `;
      }

      hdrMenu.dataset.kind = kind;
      hdrMenu.dataset.index = String(index);
      hdrMenu.style.left = `${left}px`;
      hdrMenu.style.top = `${top}px`;
      hdrMenu.style.display = 'flex';
    }

    hdrMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hact]');
      if (!btn) return;
      const act = btn.dataset.hact;
      const idx = Number(hdrMenu.dataset.index);
      hdrMenu.style.display = 'none';

      if (act === 'ins-col-left') insertColAt(idx);
      else if (act === 'ins-col-right') insertColAt(idx + 1);
      else if (act === 'del-col') deleteColAt(idx);
      else if (act === 'ins-row-above') insertRowAt(idx);
      else if (act === 'ins-row-below') insertRowAt(idx + 1);
      else if (act === 'del-row') deleteRowAt(idx);
      else if (act.startsWith('role-')) {
        setColumnMetaProp(idx, 'role', act === 'role-none' ? '' : act.slice(5));
        renderGridStructure();
      } else if (act === 'set-col-val') openSetColumnValuesModal(idx);
      else if (act === 'sort-asc') sortSheetByColumn(idx, true);
      else if (act === 'sort-desc') sortSheetByColumn(idx, false);
    });

    function setColumnMetaProp(colIdx, prop, val) {
      const sheet = getSheet();
      pushUndo();
      if (!sheet.colMeta) sheet.colMeta = {};
      sheet.colMeta[colIdx] = { ...getColMeta(sheet, colIdx), [prop]: val };
      markDirty();
      refreshPlotIfVisible();
    }

    // ---- Grid Rendering (with Merges, Filter Buttons, Freeze Panes, Origin Meta Rows) ----
    function renderGridStructure() {
      const sheet = getSheet();
      colgroup.innerHTML = '';
      thead.innerHTML = '';
      tbody.innerHTML = '';
      tdMatrix = [];

      const colRowHdr = document.createElement('col');
      colRowHdr.style.width = showMetaRows ? '76px' : '46px';
      colgroup.appendChild(colRowHdr);

      for (let c = 0; c < sheet.cols; c++) {
        const col = document.createElement('col');
        col.style.width = `${sheet.colWidths[c] || 98}px`;
        colgroup.appendChild(col);
      }

      const headTr = document.createElement('tr');
      const cornerTh = document.createElement('th');
      cornerTh.className = 'sb-corner-th';
      cornerTh.title = '전체 선택 (Ctrl+A)';
      cornerTh.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        selectAllCells();
      });
      headTr.appendChild(cornerTh);

      for (let c = 0; c < sheet.cols; c++) {
        const th = document.createElement('th');
        th.className = 'sb-col-th';
        th.dataset.col = String(c);
        const meta = getColMeta(sheet, c);
        const letterSpan = document.createElement('span');
        letterSpan.textContent = colToLetter(c);
        th.appendChild(letterSpan);

        if (showMetaRows) {
          const roleBtn = document.createElement('button');
          roleBtn.type = 'button';
          roleBtn.className = `origin-role-badge role-${(meta.role || 'none').toLowerCase()}`;
          roleBtn.textContent = meta.role || '·';
          roleBtn.title = '클릭하여 열 역할 전환 (X → Y → yErr → 없음)';
          roleBtn.addEventListener('mousedown', (e) => e.stopPropagation());
          roleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cycle = ['X', 'Y', 'yErr', ''];
            setColumnMetaProp(c, 'role', cycle[(cycle.indexOf(meta.role) + 1) % cycle.length]);
            renderGridStructure();
          });
          th.appendChild(roleBtn);
        }

        th.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || e.target.classList.contains('sb-col-resizer') || e.target.classList.contains('origin-role-badge')) return;
          e.preventDefault();
          commitEdit();
          if (e.shiftKey) {
            selAnchor = { r: 0, c: selAnchor.c };
            selFocus = { r: sheet.rows - 1, c };
          } else {
            selAnchor = { r: 0, c };
            selFocus = { r: sheet.rows - 1, c };
          }
          isSelectingCols = true;
          updateSelectionVisuals();
          root.focus({ preventScroll: true });
        });
        th.addEventListener('mouseover', () => {
          if (!isSelectingCols) return;
          selFocus = { r: sheet.rows - 1, c };
          updateSelectionVisuals();
        });
        th.addEventListener('contextmenu', (e) => openHeaderContextMenu(e, 'col', c));

        const resizer = document.createElement('div');
        resizer.className = 'sb-col-resizer';
        resizer.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startW = sheet.colWidths[c] || 98;
          const colEl = colgroup.children[c + 1];
          const onMove = (ev) => {
            const nextW = Math.max(52, Math.min(420, startW + (ev.clientX - startX)));
            sheet.colWidths[c] = Math.round(nextW);
            if (colEl) colEl.style.width = `${sheet.colWidths[c]}px`;
            applyFreezePanes();
            positionFillHandle();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            markDirty();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        th.appendChild(resizer);
        headTr.appendChild(th);
      }
      thead.appendChild(headTr);

      if (showMetaRows) {
        const metaDefs = [
          { key: 'longName', label: 'Long Name', placeholder: '변수명' },
          { key: 'units', label: 'Units', placeholder: '단위' },
          { key: 'comments', label: 'Comments', placeholder: '비고' }
        ];
        metaDefs.forEach((def, mIdx) => {
          const mTr = document.createElement('tr');
          mTr.className = `origin-meta-tr origin-meta-row-${mIdx}`;
          const lblTh = document.createElement('th');
          lblTh.className = 'origin-meta-lbl';
          lblTh.textContent = def.label;
          mTr.appendChild(lblTh);

          for (let c = 0; c < sheet.cols; c++) {
            const td = document.createElement('th');
            td.className = 'origin-meta-cell';
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'origin-meta-input';
            inp.value = getColMeta(sheet, c)[def.key];
            inp.placeholder = def.placeholder;
            inp.addEventListener('change', () => setColumnMetaProp(c, def.key, inp.value.trim()));
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
            td.appendChild(inp);
            mTr.appendChild(td);
          }
          thead.appendChild(mTr);
        });
      }

      // Build merge lookup maps
      const mergeTopLeft = new Map();
      const mergeHidden = new Set();
      (sheet.merges || []).forEach((m) => {
        mergeTopLeft.set(`${m.r1}:${m.c1}`, m);
        for (let rr = m.r1; rr <= m.r2; rr++) {
          for (let cc = m.c1; cc <= m.c2; cc++) {
            if (rr !== m.r1 || cc !== m.c1) mergeHidden.add(`${rr}:${cc}`);
          }
        }
      });

      const frag = document.createDocumentFragment();
      for (let r = 0; r < sheet.rows; r++) {
        const tr = document.createElement('tr');
        const rowTh = document.createElement('th');
        rowTh.className = 'sb-row-th';
        rowTh.dataset.row = String(r);
        rowTh.textContent = String(r + 1);
        rowTh.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          commitEdit();
          if (e.shiftKey) {
            selAnchor = { r: selAnchor.r, c: 0 };
            selFocus = { r, c: sheet.cols - 1 };
          } else {
            selAnchor = { r, c: 0 };
            selFocus = { r, c: sheet.cols - 1 };
          }
          isSelectingRows = true;
          updateSelectionVisuals();
          root.focus({ preventScroll: true });
        });
        rowTh.addEventListener('mouseover', () => {
          if (!isSelectingRows) return;
          selFocus = { r, c: sheet.cols - 1 };
          updateSelectionVisuals();
        });
        rowTh.addEventListener('contextmenu', (e) => openHeaderContextMenu(e, 'row', r));
        tr.appendChild(rowTh);

        const rowTds = [];
        for (let c = 0; c < sheet.cols; c++) {
          const td = document.createElement('td');
          td.className = 'sb-cell';
          td.dataset.r = String(r);
          td.dataset.c = String(c);
          const mk = `${r}:${c}`;
          if (mergeTopLeft.has(mk)) {
            const m = mergeTopLeft.get(mk);
            td.rowSpan = m.r2 - m.r1 + 1;
            td.colSpan = m.c2 - m.c1 + 1;
          } else if (mergeHidden.has(mk)) {
            td.style.display = 'none';
          }
          tr.appendChild(td);
          rowTds.push(td);
        }
        tdMatrix.push(rowTds);
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
      table.classList.toggle('hide-gridlines', !showGridlines);
      table.style.zoom = `${zoomLevel}%`;
      refreshAllCellValues();
      applyFreezePanes();
      updateSelectionVisuals();
      renderSheetTabs();
      refreshPlotIfVisible();
    }

    function refreshAllCellValues() {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      evaluator.clear();
      const { maxC } = getUsedBounds(sheet);
      const filterColLimit = Math.max(maxC, 5);

      for (let r = 0; r < sheet.rows; r++) {
        for (let c = 0; c < sheet.cols; c++) {
          const td = tdMatrix[r]?.[c];
          if (!td || td.style.display === 'none') continue;
          const addr = cellKey(r, c);
          const cell = sheet.cells[addr];
          const needsFilterBtn = sheet.filterEnabled && r === 0 && c <= filterColLimit;

          // Clear styles cleanly without touching sticky freeze properties
          td.style.fontWeight = '';
          td.style.fontStyle = '';
          td.style.textDecoration = '';
          td.style.color = '';
          td.style.backgroundColor = '';
          td.style.textAlign = '';
          td.style.verticalAlign = '';
          td.style.fontFamily = '';
          td.style.fontSize = '';
          td.style.whiteSpace = '';
          td.style.borderTop = '';
          td.style.borderBottom = '';
          td.style.borderLeft = '';
          td.style.borderRight = '';
          td.classList.remove('is-error', 'is-number', 'is-wrap', 'has-filter-btn');

          let displayStr = '';
          let val = '';
          if (cell) {
            val = evaluator.evalCell(sIdx, addr);
            displayStr = formatDisplayValue(val, cell.style);
            const st = cell.style || {};
            if (st.bold) td.style.fontWeight = '700';
            if (st.italic) td.style.fontStyle = 'italic';
            if (st.underline) td.style.textDecoration = 'underline';
            if (!isErr(val) && st.color) td.style.color = st.color;
            if (st.bg) td.style.backgroundColor = st.bg;
            td.style.textAlign = st.align || (typeof val === 'number' ? 'right' : '');
            if (st.valign) td.style.verticalAlign = st.valign;
            if (st.fontFamily) td.style.fontFamily = st.fontFamily;
            if (st.fontSize) td.style.fontSize = `${st.fontSize}px`;
            if (st.wrap) td.classList.add('is-wrap');
            if (st.borderAll) {
              td.style.borderTop = '1px solid #334155';
              td.style.borderBottom = '1px solid #334155';
              td.style.borderLeft = '1px solid #334155';
              td.style.borderRight = '1px solid #334155';
            }
            if (st.borderTop) td.style.borderTop = st.borderTop;
            if (st.borderBottom) td.style.borderBottom = st.borderBottom;
            if (st.borderLeft) td.style.borderLeft = st.borderLeft;
            if (st.borderRight) td.style.borderRight = st.borderRight;
            td.classList.toggle('is-error', isErr(val));
            td.classList.toggle('is-number', typeof val === 'number');
          }

          if (cell?.sparkline) {
            td.innerHTML = buildSparklineSvg(cell.sparkline, evaluator, sIdx);
          } else if (needsFilterBtn) {
            td.classList.add('has-filter-btn');
            const isFiltered = Boolean(sheet.columnFilters?.[c]);
            td.innerHTML = `<span class="sb-cell-txt">${escHtml(displayStr)}</span><button type="button" class="xl-filter-btn${isFiltered ? ' is-active' : ''}" data-fcol="${c}" title="열 ${colToLetter(c)} 필터 및 정렬">${isFiltered ? '⏷' : '▼'}</button>`;
          } else {
            td.textContent = displayStr;
          }
        }
      }

      applyRowFiltersVisuals();
      updateStatusStats();
      refreshPlotIfVisible();
    }

    function updateSelectionVisuals() {
      const { r1, r2, c1, c2 } = getNormRange();
      const sheet = getSheet();

      tbody.querySelectorAll('.sb-cell.selected, .sb-cell.active-cell, .sb-cell.fill-preview').forEach((el) => {
        el.classList.remove('selected', 'active-cell', 'fill-preview');
      });
      thead.querySelectorAll('.sb-col-th.hdr-active').forEach((el) => el.classList.remove('hdr-active'));
      tbody.querySelectorAll('.sb-row-th.hdr-active').forEach((el) => el.classList.remove('hdr-active'));

      for (let r = r1; r <= r2; r++) {
        const rowTh = tbody.children[r]?.children[0];
        if (rowTh) rowTh.classList.add('hdr-active');
        for (let c = c1; c <= c2; c++) {
          const td = tdMatrix[r]?.[c];
          if (td) td.classList.add('selected');
        }
      }
      for (let c = c1; c <= c2; c++) {
        const colTh = thead.children[0]?.children[c + 1];
        if (colTh) colTh.classList.add('hdr-active');
      }

      const cornerEl = thead.querySelector('.sb-corner-th');
      if (cornerEl) {
        const isAllSelected = r1 === 0 && c1 === 0 && r2 === sheet.rows - 1 && c2 === sheet.cols - 1;
        cornerEl.classList.toggle('all-selected', isAllSelected);
      }

      const activeTd = tdMatrix[selAnchor.r]?.[selAnchor.c];
      if (activeTd) activeTd.classList.add('active-cell');

      if (fillTarget) {
        const fr1 = Math.min(r1, fillTarget.r), fr2 = Math.max(r2, fillTarget.r);
        const fc1 = Math.min(c1, fillTarget.c), fc2 = Math.max(c2, fillTarget.c);
        for (let r = fr1; r <= fr2; r++) {
          for (let c = fc1; c <= fc2; c++) {
            const td = tdMatrix[r]?.[c];
            if (td) td.classList.add('fill-preview');
          }
        }
      }

      const addrText = (r1 === r2 && c1 === c2)
        ? cellKey(selAnchor.r, selAnchor.c)
        : `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;
      if (document.activeElement !== elAddr) elAddr.value = addrText;

      if (!editingCell) {
        const curCell = sheet.cells[cellKey(selAnchor.r, selAnchor.c)];
        elFormulaInput.value = curCell?.raw || '';
        const st = curCell?.style || {};
        ribbonBody.querySelector('[data-cmd="bold"]')?.classList.toggle('active', Boolean(st.bold));
        ribbonBody.querySelector('[data-cmd="italic"]')?.classList.toggle('active', Boolean(st.italic));
        ribbonBody.querySelector('[data-cmd="underline"]')?.classList.toggle('active', Boolean(st.underline));
        ribbonBody.querySelector('[data-cmd="wrap-text"]')?.classList.toggle('active', Boolean(st.wrap));
        const ff = ribbonBody.querySelector('[data-cmd="font-family"]');
        if (ff) ff.value = st.fontFamily || '';
        const fs = ribbonBody.querySelector('[data-cmd="font-size"]');
        if (fs) fs.value = String(st.fontSize || 11);
        const nf = ribbonBody.querySelector('[data-cmd="num-fmt-select"]');
        if (nf) nf.value = st.numFmt || 'general';
      }

      updateStatusStats();
      positionFillHandle();
    }

    function updateStatusStats() {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      const sIdx = workbook.activeSheet;
      const nums = [];
      let nonEmpty = 0;

      for (let r = r1; r <= r2; r++) {
        if (tbody.children[r]?.style.display === 'none') continue;
        for (let c = c1; c <= c2; c++) {
          const v = evaluator.evalCell(sIdx, cellKey(r, c));
          if (!isBlank(v)) nonEmpty++;
          if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
        }
      }

      const freezeInfo = (sheet.freeze?.rows || sheet.freeze?.cols)
        ? ` · ❄️틀고정(${sheet.freeze.rows}행/${sheet.freeze.cols}열)` : '';

      const rowSpan = r2 - r1 + 1;
      const colSpan = c2 - c1 + 1;
      const totalSelected = rowSpan * colSpan;
      const isMulti = totalSelected > 1;

      if (nonEmpty <= 1 && nums.length === 0) {
        if (isMulti) {
          elStats.textContent = `선택: ${rowSpan}행 × ${colSpan}열 (${totalSelected.toLocaleString()}셀)  |  ${cellKey(r1, c1)}:${cellKey(r2, c2)}${freezeInfo}`;
        } else {
          elStats.textContent = `준비  |  ${cellKey(selAnchor.r, selAnchor.c)}${freezeInfo}`;
        }
        return;
      }

      const parts = [];
      if (isMulti) parts.push(`${rowSpan}행×${colSpan}열`);
      parts.push(`개수: ${nonEmpty}`);
      if (nums.length > 0) {
        const sum = nums.reduce((a, b) => a + b, 0);
        const avg = sum / nums.length;
        parts.push(`합계: ${formatDisplayValue(sum, { numFmt: 'number', decimals: Number.isInteger(sum) ? 0 : 2 })}`);
        parts.push(`평균: ${formatDisplayValue(avg, { numFmt: 'number', decimals: 2 })}`);
        if (nums.length > 1) {
          parts.push(`최소: ${formatDisplayValue(Math.min(...nums))}`);
          parts.push(`최대: ${formatDisplayValue(Math.max(...nums))}`);
        }
      }
      elStats.textContent = parts.join('  |  ') + freezeInfo;
    }

    // ---- Editable Name Box Jump ----
    elAddr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const raw = elAddr.value.trim().toUpperCase();
        const parts = raw.split(':');
        const p1 = parseCellRef(parts[0]);
        const p2 = parts[1] ? parseCellRef(parts[1]) : p1;
        if (p1 && p2) {
          const sheet = getSheet();
          selAnchor = { r: Math.min(sheet.rows - 1, p1.row), c: Math.min(sheet.cols - 1, p1.col) };
          selFocus = { r: Math.min(sheet.rows - 1, p2.row), c: Math.min(sheet.cols - 1, p2.col) };
          updateSelectionVisuals();
          tdMatrix[selAnchor.r]?.[selAnchor.c]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        root.focus({ preventScroll: true });
      }
    });

    // ---- In-cell & Formula Bar Editing ----
    function startEdit(r, c, initialChar = null, source = 'cell') {
      const sheet = getSheet();
      const raw = sheet.cells[cellKey(r, c)]?.raw || '';
      editingCell = { r, c, source };

      const startVal = initialChar !== null ? initialChar : raw;
      elFormulaInput.value = startVal;

      if (source === 'cell') {
        const td = tdMatrix[r]?.[c];
        if (!td) return;
        const scale = zoomLevel / 100;
        inlineEditor.style.display = 'block';
        inlineEditor.style.left = `${td.offsetLeft * scale}px`;
        inlineEditor.style.top = `${td.offsetTop * scale}px`;
        inlineEditor.style.width = `${Math.max(td.offsetWidth * scale, 130)}px`;
        inlineEditor.style.height = `${td.offsetHeight * scale}px`;
        inlineEditor.value = startVal;
        inlineEditor.focus();
        inlineEditor.setSelectionRange(startVal.length, startVal.length);
      } else {
        inlineEditor.style.display = 'none';
        elFormulaInput.focus();
      }
      fillHandle.style.display = 'none';
    }

    function commitEdit(moveDir = null) {
      if (!editingCell) return;
      const { r, c, source } = editingCell;
      const newVal = source === 'formula' ? elFormulaInput.value : inlineEditor.value;
      const sheet = getSheet();
      const prevRaw = sheet.cells[cellKey(r, c)]?.raw || '';

      editingCell = null;
      formulaDragStartCell = null;
      formulaRefInsertStart = null;
      formulaRefInsertEnd = null;
      inlineEditor.style.display = 'none';

      if (newVal !== prevRaw) {
        pushUndo();
        setCellData(sheet, r, c, newVal);
        markDirty();
        refreshAllCellValues();
      }

      if (moveDir) moveSelection(moveDir.dr, moveDir.dc, false);
      else updateSelectionVisuals();
      root.focus({ preventScroll: true });
    }

    function cancelEdit() {
      if (!editingCell) return;
      editingCell = null;
      formulaDragStartCell = null;
      formulaRefInsertStart = null;
      formulaRefInsertEnd = null;
      inlineEditor.style.display = 'none';
      updateSelectionVisuals();
      root.focus({ preventScroll: true });
    }

    inlineEditor.addEventListener('input', () => {
      elFormulaInput.value = inlineEditor.value;
      formulaDragStartCell = null;
      formulaRefInsertStart = null;
      formulaRefInsertEnd = null;
    });
    elFormulaInput.addEventListener('input', () => {
      formulaDragStartCell = null;
      formulaRefInsertStart = null;
      formulaRefInsertEnd = null;
    });
    elFormulaInput.addEventListener('focus', () => {
      if (!editingCell) {
        editingCell = { r: selAnchor.r, c: selAnchor.c, source: 'formula' };
        fillHandle.style.display = 'none';
      } else {
        editingCell.source = 'formula';
        inlineEditor.style.display = 'none';
      }
    });

    const handleEditKeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
      }
    };
    elFormulaInput.addEventListener('keydown', handleEditKeydown);
    inlineEditor.addEventListener('keydown', handleEditKeydown);
    formulaBar.querySelector('[data-fcmd="cancel"]').addEventListener('click', cancelEdit);
    formulaBar.querySelector('[data-fcmd="commit"]').addEventListener('click', () => commitEdit());

    let formulaRefInsertStart = null;
    let formulaRefInsertEnd = null;
    let formulaDragStartCell = null;

    function insertRefIntoFormula(refStr, replaceLast = false) {
      const inp = getActiveEditorInput();
      if (!inp) return;
      const val = inp.value;
      const start = replaceLast && formulaRefInsertStart !== null ? formulaRefInsertStart : (inp.selectionStart ?? val.length);
      const end = replaceLast && formulaRefInsertEnd !== null ? formulaRefInsertEnd : (inp.selectionEnd ?? val.length);
      const nextVal = val.slice(0, start) + refStr + val.slice(end);
      inp.value = nextVal;
      elFormulaInput.value = nextVal;
      if (inp === elFormulaInput) inlineEditor.value = nextVal;
      formulaRefInsertStart = start;
      formulaRefInsertEnd = start + refStr.length;
      inp.focus();
      inp.setSelectionRange(formulaRefInsertEnd, formulaRefInsertEnd);
    }

    tbody.addEventListener('mousedown', (e) => {
      hdrMenu.style.display = 'none';
      ribbonDropdown.style.display = 'none';

      // Filter button click on header row
      const fBtn = e.target.closest('.xl-filter-btn');
      if (fBtn) {
        e.preventDefault();
        e.stopPropagation();
        openColumnFilterPopover(Number(fBtn.dataset.fcol), fBtn);
        return;
      }
      filterPopover.style.display = 'none';

      const td = e.target.closest('td.sb-cell');
      if (!td || e.button !== 0) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);

      if (editingCell && isEditingFormula()) {
        e.preventDefault();
        if (e.shiftKey && formulaDragStartCell) {
          const refText = (r === formulaDragStartCell.r && c === formulaDragStartCell.c)
            ? cellKey(r, c)
            : `${cellKey(Math.min(formulaDragStartCell.r, r), Math.min(formulaDragStartCell.c, c))}:${cellKey(Math.max(formulaDragStartCell.r, r), Math.max(formulaDragStartCell.c, c))}`;
          insertRefIntoFormula(refText, true);
          return;
        }
        formulaDragStartCell = { r, c };
        insertRefIntoFormula(cellKey(r, c), false);
        const onFormulaMove = (ev) => {
          const overTd = ev.target.closest?.('td.sb-cell');
          if (!overTd) return;
          const or = Number(overTd.dataset.r), oc = Number(overTd.dataset.c);
          const refText = (or === formulaDragStartCell.r && oc === formulaDragStartCell.c)
            ? cellKey(or, oc)
            : `${cellKey(Math.min(formulaDragStartCell.r, or), Math.min(formulaDragStartCell.c, oc))}:${cellKey(Math.max(formulaDragStartCell.r, or), Math.max(formulaDragStartCell.c, oc))}`;
          insertRefIntoFormula(refText, true);
        };
        const onFormulaUp = () => {
          document.removeEventListener('mousemove', onFormulaMove);
          document.removeEventListener('mouseup', onFormulaUp);
        };
        document.addEventListener('mousemove', onFormulaMove);
        document.addEventListener('mouseup', onFormulaUp);
        return;
      }

      e.preventDefault();
      commitEdit();
      if (e.shiftKey) selFocus = { r, c };
      else { selAnchor = { r, c }; selFocus = { r, c }; }
      isSelecting = true;
      updateSelectionVisuals();
      root.focus({ preventScroll: true });
    });

    tbody.addEventListener('mouseover', (e) => {
      const td = e.target.closest('td.sb-cell');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      if (isSelecting) { selFocus = { r, c }; updateSelectionVisuals(); }
      else if (isFillDragging) { fillTarget = { r, c }; updateSelectionVisuals(); }
    });

    tbody.addEventListener('dblclick', (e) => {
      if (e.target.closest('.xl-filter-btn')) return;
      const td = e.target.closest('td.sb-cell');
      if (!td) return;
      const r = Number(td.dataset.r), c = Number(td.dataset.c);
      selAnchor = { r, c }; selFocus = { r, c };
      updateSelectionVisuals();
      startEdit(r, c, null, 'cell');
    });

    fillHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isFillDragging = true;
      fillTarget = { r: getNormRange().r2, c: getNormRange().c2 };
    });

    function executeFill() {
      if (!fillTarget) return;
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      const tr = fillTarget.r, tc = fillTarget.c;
      const fillDown = tr > r2, fillUp = tr < r1, fillRight = tc > c2, fillLeft = tc < c1;
      if (!fillDown && !fillUp && !fillRight && !fillLeft) return;

      pushUndo();
      const srcRows = r2 - r1 + 1, srcCols = c2 - c1 + 1;

      if (fillDown || fillUp) {
        const startR = fillDown ? r2 + 1 : tr, endR = fillDown ? tr : r1 - 1;
        for (let c = c1; c <= c2; c++) {
          let step = null;
          if (srcRows >= 2) {
            const v0 = toStrictNumber(sheet.cells[cellKey(r1, c)]?.raw);
            const v1 = toStrictNumber(sheet.cells[cellKey(r1 + 1, c)]?.raw);
            if (v0 !== null && v1 !== null) {
              let isLinear = true;
              const diff = v1 - v0;
              for (let k = 2; k < srcRows; k++) {
                const vk = toStrictNumber(sheet.cells[cellKey(r1 + k, c)]?.raw);
                if (vk === null || Math.abs((vk - v0) - diff * k) > 1e-9) { isLinear = false; break; }
              }
              if (isLinear) step = { base: v0, diff };
            }
          }
          for (let r = startR; r <= endR; r++) {
            const offset = r - r1;
            const srcR = r1 + (((offset % srcRows) + srcRows) % srcRows);
            const srcCell = sheet.cells[cellKey(srcR, c)];
            const srcRaw = srcCell?.raw || '';
            let nextRaw;
            if (srcRaw.startsWith('=')) nextRaw = shiftFormula(srcRaw, r - srcR, 0);
            else if (step !== null) nextRaw = String(Math.round((step.base + step.diff * offset) * 1e10) / 1e10);
            else nextRaw = srcRaw;
            setCellData(sheet, r, c, nextRaw, srcCell?.style ? { ...srcCell.style } : null);
          }
        }
        selAnchor = { r: Math.min(r1, tr), c: c1 };
        selFocus = { r: Math.max(r2, tr), c: c2 };
      } else {
        const startC = fillRight ? c2 + 1 : tc, endC = fillRight ? tc : c1 - 1;
        for (let r = r1; r <= r2; r++) {
          for (let c = startC; c <= endC; c++) {
            const offset = c - c1;
            const srcC = c1 + (((offset % srcCols) + srcCols) % srcCols);
            const srcCell = sheet.cells[cellKey(r, srcC)];
            const srcRaw = srcCell?.raw || '';
            const nextRaw = srcRaw.startsWith('=') ? shiftFormula(srcRaw, 0, c - srcC) : srcRaw;
            setCellData(sheet, r, c, nextRaw, srcCell?.style ? { ...srcCell.style } : null);
          }
        }
        selAnchor = { r: r1, c: Math.min(c1, tc) };
        selFocus = { r: r2, c: Math.max(c2, tc) };
      }
      markDirty();
      refreshAllCellValues();
    }

    const onGlobalMouseUp = () => {
      isSelectingCols = false;
      isSelectingRows = false;
      if (isSelecting) {
        isSelecting = false;
        if (formatPainterStyle) {
          const copied = { ...formatPainterStyle };
          formatPainterStyle = null;
          ribbonBody.querySelector('[data-cmd="format-painter"]')?.classList.remove('active');
          gridWrap.classList.remove('format-painter-cursor');
          applyStyleToSelection(() => ({ ...copied }));
          toast('🖌️ 서식이 적용되었습니다.');
        }
      }
      if (isFillDragging) {
        isFillDragging = false;
        executeFill();
        fillTarget = null;
        updateSelectionVisuals();
      }
    };
    const onGlobalClick = (e) => {
      if (!e.target.closest('.xl-hdr-menu')) hdrMenu.style.display = 'none';
      if (!e.target.closest('.xl-ribbon-dropdown, [data-dropdown]')) ribbonDropdown.style.display = 'none';
      if (!e.target.closest('.xl-filter-popover, .xl-filter-btn')) filterPopover.style.display = 'none';
    };
    document.addEventListener('mouseup', onGlobalMouseUp);
    document.addEventListener('click', onGlobalClick);

    // ---- Row/Col Insert & Delete with Formula Shifting ----
    function rewriteAllFormulasForInsertDelete(targetSheetName, axis, index, delta) {
      workbook.sheets.forEach((s) => {
        Object.keys(s.cells).forEach((addr) => {
          const c = s.cells[addr];
          if (c && typeof c.raw === 'string' && c.raw.startsWith('=')) {
            c.raw = shiftFormulaOnInsertDelete(c.raw, targetSheetName, s.name, axis, index, delta);
          }
        });
      });
    }

    function insertRowAt(idx) {
      const sheet = getSheet();
      pushUndo();
      sheet.rows++;
      const nextCells = {};
      Object.keys(sheet.cells).forEach((addr) => {
        const p = parseCellRef(addr);
        if (!p) return;
        nextCells[cellKey(p.row >= idx ? p.row + 1 : p.row, p.col)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;
      rewriteAllFormulasForInsertDelete(sheet.name, 'row', idx, +1);
      markDirty();
      renderGridStructure();
    }

    function deleteRowAt(idx) {
      const sheet = getSheet();
      if (sheet.rows <= 5) return;
      pushUndo();
      sheet.rows--;
      const nextCells = {};
      Object.keys(sheet.cells).forEach((addr) => {
        const p = parseCellRef(addr);
        if (!p || p.row === idx) return;
        nextCells[cellKey(p.row > idx ? p.row - 1 : p.row, p.col)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;
      rewriteAllFormulasForInsertDelete(sheet.name, 'row', idx, -1);
      selAnchor.r = Math.min(selAnchor.r, sheet.rows - 1);
      selFocus.r = Math.min(selFocus.r, sheet.rows - 1);
      markDirty();
      renderGridStructure();
    }

    function insertColAt(idx) {
      const sheet = getSheet();
      pushUndo();
      sheet.cols++;
      const nextCells = {};
      Object.keys(sheet.cells).forEach((addr) => {
        const p = parseCellRef(addr);
        if (!p) return;
        nextCells[cellKey(p.row, p.col >= idx ? p.col + 1 : p.col)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;
      const nextMeta = {}, nextWidths = {};
      Object.keys(sheet.colMeta || {}).forEach((k) => { const ci = Number(k); nextMeta[ci >= idx ? ci + 1 : ci] = sheet.colMeta[k]; });
      Object.keys(sheet.colWidths || {}).forEach((k) => { const ci = Number(k); nextWidths[ci >= idx ? ci + 1 : ci] = sheet.colWidths[k]; });
      sheet.colMeta = nextMeta;
      sheet.colWidths = nextWidths;
      rewriteAllFormulasForInsertDelete(sheet.name, 'col', idx, +1);
      markDirty();
      renderGridStructure();
    }

    function deleteColAt(idx) {
      const sheet = getSheet();
      if (sheet.cols <= 3) return;
      pushUndo();
      sheet.cols--;
      const nextCells = {};
      Object.keys(sheet.cells).forEach((addr) => {
        const p = parseCellRef(addr);
        if (!p || p.col === idx) return;
        nextCells[cellKey(p.row, p.col > idx ? p.col - 1 : p.col)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;
      const nextMeta = {}, nextWidths = {};
      Object.keys(sheet.colMeta || {}).forEach((k) => { const ci = Number(k); if (ci !== idx) nextMeta[ci > idx ? ci - 1 : ci] = sheet.colMeta[k]; });
      Object.keys(sheet.colWidths || {}).forEach((k) => { const ci = Number(k); if (ci !== idx) nextWidths[ci > idx ? ci - 1 : ci] = sheet.colWidths[k]; });
      sheet.colMeta = nextMeta;
      sheet.colWidths = nextWidths;
      rewriteAllFormulasForInsertDelete(sheet.name, 'col', idx, -1);
      selAnchor.c = Math.min(selAnchor.c, sheet.cols - 1);
      selFocus.c = Math.min(selFocus.c, sheet.cols - 1);
      markDirty();
      renderGridStructure();
    }

    // ---- Sort Sheet by Column (preserves row 0 header when filterEnabled) ----
    function sortSheetByColumn(colIdx, asc = true) {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const { maxR, maxC } = getUsedBounds(sheet);
      const startRow = sheet.filterEnabled ? 1 : 0;
      if (maxR <= startRow) return;

      pushUndo();
      const headerRow = {};
      if (startRow === 1) {
        for (let c = 0; c <= maxC; c++) {
          const cell = sheet.cells[cellKey(0, c)];
          if (cell) headerRow[c] = cell;
        }
      }

      const rowData = [];
      for (let r = startRow; r <= maxR; r++) {
        const cellsInRow = {};
        let hasAny = false;
        for (let c = 0; c <= maxC; c++) {
          const cell = sheet.cells[cellKey(r, c)];
          if (cell) { cellsInRow[c] = cell; hasAny = true; }
        }
        if (hasAny) {
          rowData.push({ sortVal: evaluator.evalCell(sIdx, cellKey(r, colIdx)), cellsInRow });
        }
      }

      rowData.sort((a, b) => {
        const cmp = compareValues(a.sortVal, b.sortVal);
        return Number.isNaN(cmp) ? 0 : (asc ? cmp : -cmp);
      });

      sheet.cells = {};
      if (startRow === 1) {
        Object.keys(headerRow).forEach((cStr) => { sheet.cells[cellKey(0, Number(cStr))] = headerRow[cStr]; });
      }
      rowData.forEach((rd, idx) => {
        Object.keys(rd.cellsInRow).forEach((cStr) => {
          sheet.cells[cellKey(startRow + idx, Number(cStr))] = rd.cellsInRow[cStr];
        });
      });

      markDirty();
      refreshAllCellValues();
      toast(`열 ${colToLetter(colIdx)} 기준 ${asc ? '오름차순' : '내림차순'} 정렬 완료`);
    }

    // ---- Smart Clipboard Paste with Auto-Expand ----
    function copySelection(isCut = false) {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      const rows = [], tsvLines = [];
      for (let r = r1; r <= r2; r++) {
        const rowArr = [], tsvCols = [];
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          const cell = sheet.cells[addr];
          rowArr.push(cell ? JSON.parse(JSON.stringify(cell)) : { raw: '' });
          tsvCols.push(formatDisplayValue(evaluator.evalCell(workbook.activeSheet, addr), cell?.style));
        }
        rows.push(rowArr);
        tsvLines.push(tsvCols.join('\t'));
      }
      clipboardData = { r1, c1, rows, isCut };
      try { navigator.clipboard?.writeText(tsvLines.join('\n')).catch(() => {}); } catch (_) {}
      if (isCut) clearSelectionCells();
    }

    async function pasteAtSelection(externalText = null) {
      const sheet = getSheet();
      const destR = selAnchor.r, destC = selAnchor.c;

      if (externalText === null && clipboardData) {
        pushUndo();
        const { r1, c1, rows } = clipboardData;
        const dRow = destR - r1, dCol = destC - c1;
        let expanded = false;
        if (destR + rows.length > sheet.rows) { sheet.rows = destR + rows.length + 8; expanded = true; }
        if (destC + (rows[0]?.length || 1) > sheet.cols) { sheet.cols = destC + (rows[0]?.length || 1) + 4; expanded = true; }

        rows.forEach((rowArr, dr) => {
          rowArr.forEach((cell, dc) => {
            const raw = cell.raw && cell.raw.startsWith('=') ? shiftFormula(cell.raw, dRow, dCol) : (cell.raw || '');
            setCellData(sheet, destR + dr, destC + dc, raw, cell.style ? { ...cell.style } : null);
          });
        });
        selFocus = { r: destR + rows.length - 1, c: destC + (rows[0]?.length || 1) - 1 };
        markDirty();
        if (expanded) renderGridStructure();
        else { refreshAllCellValues(); updateSelectionVisuals(); }
        return;
      }

      let text = externalText;
      if (text === null) {
        try { text = await navigator.clipboard.readText(); } catch (_) { return; }
      }
      if (!text) return;

      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const sep = lines.some((l) => l.includes('\t')) ? '\t' : ',';
      const parsed = lines.map((l) => l.split(sep));
      const maxCols = parsed.reduce((m, r) => Math.max(m, r.length), 1);

      pushUndo();
      let expanded = false;
      if (destR + parsed.length > sheet.rows) { sheet.rows = destR + parsed.length + 10; expanded = true; }
      if (destC + maxCols > sheet.cols) { sheet.cols = destC + maxCols + 4; expanded = true; }

      parsed.forEach((cols, dr) => cols.forEach((val, dc) => setCellData(sheet, destR + dr, destC + dc, val)));
      selFocus = { r: destR + parsed.length - 1, c: destC + maxCols - 1 };
      markDirty();
      if (expanded) {
        renderGridStructure();
        toast(`📋 ${parsed.length}행 × ${maxCols}열 붙여넣기 (시트 자동 확장됨)`);
      } else {
        refreshAllCellValues();
        updateSelectionVisuals();
      }
    }

    // ---- Modals: Set Column Values & Name Manager ----
    function openSetColumnValuesModal(defaultColIdx = selAnchor.c) {
      const sheet = getSheet();
      const { maxR } = getUsedBounds(sheet);
      const colOpts = Array.from({ length: sheet.cols }, (_, c) => {
        const m = getColMeta(sheet, c);
        return `<option value="${c}" ${c === defaultColIdx ? 'selected' : ''}>Col(${colToLetter(c)})${m.longName ? ` — ${escHtml(m.longName)}` : ''}</option>`;
      }).join('');
      const chips = Array.from({ length: Math.min(sheet.cols, 10) }, (_, c) =>
        `<button type="button" class="sb-tb-btn" data-insert-col="Col(${colToLetter(c)})">Col(${colToLetter(c)})</button>`
      ).join('');

      subModal.innerHTML = `
        <div class="xl-submodal-card">
          <div class="xl-submodal-head">
            <span>⚡ 열 일괄 수식 (Set Column Values)</span>
            <button type="button" class="sb-tb-btn" data-smclose="1">✕</button>
          </div>
          <div class="xl-submodal-body">
            <label class="insp-field"><span>대상 열 선택</span><select data-scv="col">${colOpts}</select></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>시작 행 (1부터)</span><input type="number" data-scv="start" value="1" min="1"></label>
              <label class="insp-field"><span>종료 행</span><input type="number" data-scv="end" value="${Math.max(1, maxR + 1)}" min="1"></label>
            </div>
            <label class="insp-field">
              <span>수식 입력 (예: <code>Col(A) * 1.5 + 10</code> 또는 <code>SIN(RADIANS(Col(A)))</code>)</span>
              <input type="text" data-scv="expr" placeholder="Col(A) * 1.5 + 10" autocomplete="off">
            </label>
            <div class="xl-scv-chips">${chips}</div>
            <label class="insp-check" style="margin-top:4px;">
              <input type="checkbox" data-scv="formula" checked> 라이브 엑셀 수식(<code>=A1*1.5+10</code>)으로 채우기
            </label>
          </div>
          <div class="xl-submodal-foot">
            <button type="button" class="sb-tb-btn" data-smclose="1">취소</button>
            <button type="button" class="sb-tb-btn primary" data-scv="apply">⚡ 일괄 적용</button>
          </div>
        </div>
      `;
      subModal.style.display = 'flex';
      const exprInp = subModal.querySelector('[data-scv="expr"]');
      exprInp.focus();
      subModal.querySelectorAll('[data-insert-col]').forEach((b) => {
        b.addEventListener('click', () => { exprInp.value += b.dataset.insertCol; exprInp.focus(); });
      });
      subModal.querySelector('[data-scv="apply"]').addEventListener('click', () => {
        const targetCol = Number(subModal.querySelector('[data-scv="col"]').value);
        const startR = Math.max(1, parseInt(subModal.querySelector('[data-scv="start"]').value, 10) || 1) - 1;
        const endR = Math.max(startR + 1, parseInt(subModal.querySelector('[data-scv="end"]').value, 10) || 1) - 1;
        const expr = exprInp.value.trim();
        const asFormula = subModal.querySelector('[data-scv="formula"]').checked;
        if (!expr) return;

        pushUndo();
        if (endR + 1 > sheet.rows) sheet.rows = endR + 10;
        for (let r = startR; r <= endR; r++) setCellData(sheet, r, targetCol, expandColumnFormula(expr, r));
        if (!asFormula) {
          evaluator.clear();
          const sIdx = workbook.activeSheet;
          for (let r = startR; r <= endR; r++) {
            const v = evaluator.evalCell(sIdx, cellKey(r, targetCol));
            setCellData(sheet, r, targetCol, isErr(v) ? v.__err : String(v));
          }
        }
        if (!sheet.colMeta) sheet.colMeta = {};
        sheet.colMeta[targetCol] = { ...getColMeta(sheet, targetCol), comments: `Col(${colToLetter(targetCol)}) = ${expr}` };
        subModal.style.display = 'none';
        markDirty();
        renderGridStructure();
        toast(`⚡ Col(${colToLetter(targetCol)}) ${startR + 1}~${endR + 1}행 일괄 계산 완료`);
      });
    }

    function openNameManagerModal() {
      const { r1, r2, c1, c2 } = getNormRange();
      const defaultRef = (r1 === r2 && c1 === c2) ? cellKey(r1, c1) : `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;

      function renderNM() {
        const entries = Object.entries(workbook.namedRanges || {});
        const listHtml = entries.map(([k, v]) => `
          <div class="xl-nm-row">
            <code><b>${escHtml(k)}</b></code>
            <span>= ${escHtml(v)}</span>
            <button type="button" class="sb-tb-btn" data-nmdel="${escHtml(k)}">🗑️</button>
          </div>
        `).join('') || '<div class="insp-empty">정의된 이름이 없습니다. 아래에서 새 이름을 추가하세요.</div>';

        subModal.innerHTML = `
          <div class="xl-submodal-card">
            <div class="xl-submodal-head">
              <span>🏷️ 이름 관리자 (수식에서 이름으로 셀·범위 참조)</span>
              <button type="button" class="sb-tb-btn" data-smclose="1">✕</button>
            </div>
            <div class="xl-submodal-body">
              <div class="xl-nm-list">${listHtml}</div>
              <div class="insp-grid-2">
                <label class="insp-field"><span>이름 (영문/밑줄)</span><input type="text" data-nm="name" placeholder="예: TaxRate"></label>
                <label class="insp-field"><span>참조 범위</span><input type="text" data-nm="ref" value="${escHtml(defaultRef)}"></label>
              </div>
            </div>
            <div class="xl-submodal-foot">
              <button type="button" class="sb-tb-btn" data-smclose="1">닫기</button>
              <button type="button" class="sb-tb-btn primary" data-nm="add">➕ 이름 추가</button>
            </div>
          </div>
        `;
        subModal.style.display = 'flex';
        subModal.querySelectorAll('[data-nmdel]').forEach((b) => {
          b.addEventListener('click', () => {
            pushUndo();
            delete workbook.namedRanges[b.dataset.nmdel];
            markDirty();
            refreshAllCellValues();
            renderNM();
          });
        });
        subModal.querySelector('[data-nm="add"]').addEventListener('click', () => {
          const n = subModal.querySelector('[data-nm="name"]').value.trim();
          const ref = subModal.querySelector('[data-nm="ref"]').value.trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || !ref) {
            toast('⚠️ 이름은 영문/밑줄로 시작해야 합니다 (예: TaxRate).');
            return;
          }
          pushUndo();
          if (!workbook.namedRanges) workbook.namedRanges = {};
          workbook.namedRanges[n] = ref;
          markDirty();
          refreshAllCellValues();
          renderNM();
          toast(`🏷️ 이름 "${n}" (= ${ref})이 등록되었습니다.`);
        });
      }
      renderNM();
    }

    subModal.addEventListener('click', (e) => {
      if (e.target === subModal || e.target.closest('[data-smclose]')) subModal.style.display = 'none';
    });

    // ================= Find & Replace (Ctrl+F) =================
    const elFindQuery = findBar.querySelector('[data-fr="query"]');
    const elFindReplace = findBar.querySelector('[data-fr="replace"]');
    const elFindCount = findBar.querySelector('[data-fr="count"]');

    function runFindSearch(jumpToFirst = true) {
      const q = elFindQuery.value.trim().toLowerCase();
      findMatches = [];
      findCursor = -1;
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      if (q) {
        const { maxR, maxC } = getUsedBounds(sheet);
        for (let r = 0; r <= maxR; r++) {
          for (let c = 0; c <= maxC; c++) {
            const addr = cellKey(r, c);
            const raw = String(sheet.cells[addr]?.raw || '').toLowerCase();
            const disp = getCellDisplayStr(sheet, sIdx, r, c).toLowerCase();
            if (raw.includes(q) || disp.includes(q)) findMatches.push({ r, c });
          }
        }
      }
      if (findMatches.length > 0 && jumpToFirst) {
        findCursor = 0;
        jumpToFindMatch();
      }
      elFindCount.textContent = findMatches.length > 0 ? `${findCursor + 1} / ${findMatches.length}` : '0 / 0';
    }

    function jumpToFindMatch() {
      if (findMatches.length === 0) return;
      const m = findMatches[findCursor];
      selAnchor = { r: m.r, c: m.c };
      selFocus = { r: m.r, c: m.c };
      updateSelectionVisuals();
      tdMatrix[m.r]?.[m.c]?.scrollIntoView({ block: 'center', inline: 'center' });
      elFindCount.textContent = `${findCursor + 1} / ${findMatches.length}`;
    }

    elFindQuery.addEventListener('input', () => runFindSearch(true));
    elFindQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (findMatches.length === 0) runFindSearch(true);
        else { findCursor = (findCursor + 1) % findMatches.length; jumpToFindMatch(); }
      } else if (e.key === 'Escape') {
        findBar.style.display = 'none';
        root.focus({ preventScroll: true });
      }
    });
    findBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fract]');
      if (!btn) return;
      const act = btn.dataset.fract;
      if (act === 'close') { findBar.style.display = 'none'; root.focus({ preventScroll: true }); }
      else if (act === 'next' && findMatches.length) { findCursor = (findCursor + 1) % findMatches.length; jumpToFindMatch(); }
      else if (act === 'prev' && findMatches.length) { findCursor = (findCursor - 1 + findMatches.length) % findMatches.length; jumpToFindMatch(); }
      else if (act === 'replace-one' && findMatches.length && findCursor >= 0) {
        const q = elFindQuery.value;
        const rep = elFindReplace.value;
        const m = findMatches[findCursor];
        const sheet = getSheet();
        const curRaw = sheet.cells[cellKey(m.r, m.c)]?.raw || '';
        pushUndo();
        setCellData(sheet, m.r, m.c, curRaw.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), rep));
        markDirty();
        refreshAllCellValues();
        runFindSearch(true);
      } else if (act === 'replace-all' && elFindQuery.value) {
        const q = elFindQuery.value;
        const rep = elFindReplace.value;
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const sheet = getSheet();
        pushUndo();
        let count = 0;
        Object.keys(sheet.cells).forEach((addr) => {
          const raw = sheet.cells[addr]?.raw;
          if (typeof raw === 'string' && re.test(raw)) {
            sheet.cells[addr].raw = raw.replace(re, rep);
            count++;
          }
        });
        markDirty();
        refreshAllCellValues();
        runFindSearch(false);
        toast(`🔍 ${count}개 셀을 바꾸었습니다.`);
      }
    });

    // ---- Style / Merge / Borders / Undo / Redo / Keyboard ----
    function moveSelection(dr, dc, extend = false) {
      const sheet = getSheet();
      const target = extend ? selFocus : selAnchor;
      const nr = Math.max(0, Math.min(sheet.rows - 1, target.r + dr));
      const nc = Math.max(0, Math.min(sheet.cols - 1, target.c + dc));
      if (extend) selFocus = { r: nr, c: nc };
      else { selAnchor = { r: nr, c: nc }; selFocus = { r: nr, c: nc }; }
      updateSelectionVisuals();
      tdMatrix[nr]?.[nc]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function jumpToDataEdge(dr, dc, extend = false) {
      const sheet = getSheet();
      const start = extend ? selFocus : selAnchor;
      const hasVal = (r, c) => {
        const raw = sheet.cells[cellKey(r, c)]?.raw;
        return raw !== undefined && raw !== null && String(raw).trim() !== '';
      };
      const inBounds = (r, c) => r >= 0 && r < sheet.rows && c >= 0 && c < sheet.cols;

      let r = start.r;
      let c = start.c;
      const nr1 = r + dr;
      const nc1 = c + dc;
      if (!inBounds(nr1, nc1)) return;

      const curFilled = hasVal(r, c);
      const nextFilled = hasVal(nr1, nc1);

      if (curFilled && nextFilled) {
        // Move to last contiguous filled cell
        while (inBounds(r + dr, c + dc) && hasVal(r + dr, c + dc)) {
          r += dr;
          c += dc;
        }
      } else {
        // Skip blanks to first filled cell (or sheet boundary)
        r = nr1;
        c = nc1;
        while (inBounds(r + dr, c + dc) && !hasVal(r, c)) {
          r += dr;
          c += dc;
        }
      }

      if (extend) selFocus = { r, c };
      else { selAnchor = { r, c }; selFocus = { r, c }; }
      updateSelectionVisuals();
      tdMatrix[r]?.[c]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function applyStyleToSelection(patchFn) {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      pushUndo();
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          const prev = sheet.cells[addr] || { raw: '' };
          const nextStyle = patchFn({ ...(prev.style || {}) }, r, c, r1, r2, c1, c2);
          if (nextStyle === null) {
            if (prev.raw || prev.sparkline) {
              sheet.cells[addr] = { raw: prev.raw || '', ...(prev.sparkline ? { sparkline: prev.sparkline } : {}) };
            } else delete sheet.cells[addr];
          } else {
            sheet.cells[addr] = { raw: prev.raw || '', style: nextStyle, ...(prev.sparkline ? { sparkline: prev.sparkline } : {}) };
          }
        }
      }
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    function toggleMergeCenter() {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      if (!sheet.merges) sheet.merges = [];
      const overlappingIdx = sheet.merges.findIndex((m) => !(m.r2 < r1 || m.r1 > r2 || m.c2 < c1 || m.c1 > c2));
      pushUndo();
      if (overlappingIdx >= 0) {
        sheet.merges = sheet.merges.filter((m) => (m.r2 < r1 || m.r1 > r2 || m.c2 < c1 || m.c1 > c2));
        toast('⊞ 셀 병합이 해제되었습니다.');
      } else if (r1 !== r2 || c1 !== c2) {
        sheet.merges.push({ r1, c1, r2, c2 });
        const topLeft = sheet.cells[cellKey(r1, c1)] || { raw: '' };
        setCellData(sheet, r1, c1, topLeft.raw, { ...(topLeft.style || {}), align: 'center', valign: 'middle' });
        toast(`⊞ ${cellKey(r1, c1)}:${cellKey(r2, c2)} 병합하고 가운데 맞춤 완료`);
      } else {
        toast('💡 병합할 2개 이상의 셀 범위를 드래그해 선택해 주세요.');
        return;
      }
      markDirty();
      renderGridStructure();
    }

    function applyTableStylePreset(theme) {
      const { r1, r2, c1, c2 } = getNormRange();
      const sheet = getSheet();
      const bounds = getUsedBounds(sheet);
      const tr1 = (r1 === r2 && c1 === c2) ? 0 : r1;
      const tr2 = (r1 === r2 && c1 === c2) ? Math.max(0, bounds.maxR) : r2;
      const tc1 = (r1 === r2 && c1 === c2) ? 0 : c1;
      const tc2 = (r1 === r2 && c1 === c2) ? Math.max(0, bounds.maxC) : c2;
      const palettes = {
        green: { hBg: '#217346', hCol: '#ffffff', stripe: '#f0fdf4', bdr: '1px solid #86efac' },
        blue:  { hBg: '#1d4ed8', hCol: '#ffffff', stripe: '#eff6ff', bdr: '1px solid #93c5fd' },
        slate: { hBg: '#334155', hCol: '#ffffff', stripe: '#f8fafc', bdr: '1px solid #cbd5e1' }
      };
      pushUndo();
      for (let r = tr1; r <= tr2; r++) {
        for (let c = tc1; c <= tc2; c++) {
          const addr = cellKey(r, c);
          const prev = sheet.cells[addr] || { raw: '' };
          if (theme === 'none') {
            if (prev.raw) sheet.cells[addr] = { raw: prev.raw };
            else delete sheet.cells[addr];
          } else {
            const p = palettes[theme];
            const isHdr = r === tr1;
            const isOdd = (r - tr1) % 2 === 1;
            sheet.cells[addr] = {
              raw: prev.raw || '',
              style: {
                ...(prev.style || {}),
                bold: isHdr ? true : Boolean(prev.style?.bold),
                bg: isHdr ? p.hBg : (isOdd ? p.stripe : '#ffffff'),
                color: isHdr ? p.hCol : '#1e293b',
                borderBottom: p.bdr
              }
            };
          }
        }
      }
      markDirty();
      refreshAllCellValues();
    }

    function insertSparkline(type) {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      const defaultRange = c1 > 0
        ? `${cellKey(r1, 0)}:${cellKey(r1, c1 - 1)}`
        : `${cellKey(r1, c1 + 1)}:${cellKey(r1, Math.min(sheet.cols - 1, c1 + 4))}`;
      const rangeInput = prompt('스파클라인 데이터 범위를 입력하세요 (예: A1:D1):', defaultRange);
      if (!rangeInput || !rangeInput.trim()) return;
      pushUndo();
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          const prev = sheet.cells[addr] || { raw: '' };
          const shiftedRange = r === r1 ? rangeInput.trim().toUpperCase() : shiftFormula(`=${rangeInput.trim().toUpperCase()}`, r - r1, 0).slice(1);
          sheet.cells[addr] = { ...prev, sparkline: { type, range: shiftedRange } };
        }
      }
      markDirty();
      refreshAllCellValues();
      toast('📉 스파클라인이 삽입되었습니다.');
    }

    function clearSelectionCells(mode = 'contents') {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      pushUndo();
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          if (mode === 'all') delete sheet.cells[addr];
          else if (mode === 'style') {
            if (sheet.cells[addr]?.raw) sheet.cells[addr] = { raw: sheet.cells[addr].raw };
            else delete sheet.cells[addr];
          } else {
            setCellData(sheet, r, c, '');
          }
        }
      }
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    function doUndo() {
      if (undoStack.length === 0) return;
      redoStack.push(cloneWorkbook(workbook));
      workbook = normalizeWorkbook(undoStack.pop());
      evaluator = createEvaluator(workbook);
      markDirty();
      if (plotController) plotController.setConfig(getSheet().plotConfig);
      renderGridStructure();
    }

    function doRedo() {
      if (redoStack.length === 0) return;
      undoStack.push(cloneWorkbook(workbook));
      workbook = normalizeWorkbook(redoStack.pop());
      evaluator = createEvaluator(workbook);
      markDirty();
      if (plotController) plotController.setConfig(getSheet().plotConfig);
      renderGridStructure();
    }

    function insertAutoStat(fnName) {
      recordRecentFn(fnName);
      const { r1, r2, c1, c2 } = getNormRange();
      const sheet = getSheet();
      let rangeStr, targetR = r2, targetC = c1;
      if (r1 !== r2 || c1 !== c2) {
        rangeStr = `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;
        targetR = Math.min(sheet.rows - 1, r2 + 1);
      } else {
        let topR = r1 - 1;
        while (topR >= 0 && typeof evaluator.evalCell(workbook.activeSheet, cellKey(topR, c1)) === 'number') topR--;
        topR++;
        if (topR < r1) rangeStr = `${cellKey(topR, c1)}:${cellKey(r1 - 1, c1)}`;
        else { insertFormulaSnippet(`=${fnName}()`, fnName); return; }
      }
      pushUndo();
      setCellData(sheet, targetR, targetC, `=${fnName}(${rangeStr})`, { bold: true });
      selAnchor = { r: targetR, c: targetC };
      selFocus = { r: targetR, c: targetC };
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    function loadExampleIntoWorkbook(exampleId, asNewSheet = false) {
      if (typeof createExampleWorkbook !== 'function') return;
      commitEdit();
      const exWb = createExampleWorkbook(exampleId);
      const exSheet = exWb.sheets[0];
      if (!exSheet) return;
      pushUndo();

      if (asNewSheet) {
        let base = exSheet.name;
        let candidate = base;
        let n = 2;
        while (workbook.sheets.some((s) => s.name === candidate)) candidate = `${base} ${n++}`;
        exSheet.name = candidate;
        workbook.sheets.push(exSheet);
        workbook.activeSheet = workbook.sheets.length - 1;
      } else {
        workbook.sheets[workbook.activeSheet] = exSheet;
      }

      evaluator = createEvaluator(workbook);
      selAnchor = { r: 0, c: 0 };
      selFocus = { r: 0, c: 0 };
      markDirty();
      setAppMode('origin');
      setViewMode('split');
      if (plotController) {
        plotController.setConfig(getSheet().plotConfig);
        setTimeout(() => plotController.refresh(), 50);
      }
      renderGridStructure();
      const info = (EXAMPLE_CATALOG || []).find((x) => x.id === exampleId);
      toast(`🎨 예제 불러옴: ${info ? info.name : exSheet.name} (Ctrl+Z로 되돌리기 가능)`);
    }

    function openExamplesGalleryModal() {
      const catalog = Array.isArray(EXAMPLE_CATALOG) ? EXAMPLE_CATALOG : [];
      const cardsHtml = catalog.map((ex) => `
        <div class="xl-ex-card">
          <div class="xl-ex-top">
            <span class="xl-ex-icon">${ex.icon}</span>
            <div class="xl-ex-meta">
              <div class="xl-ex-name">${escHtml(ex.name)}</div>
              <div class="xl-ex-badge">${escHtml(ex.badge)}</div>
            </div>
          </div>
          <div class="xl-ex-desc">${escHtml(ex.desc)}</div>
          <div class="xl-ex-actions">
            <button type="button" class="sb-tb-btn primary" data-ex-load="${escHtml(ex.id)}" data-ex-mode="replace">✨ 현재 시트에 열기</button>
            <button type="button" class="sb-tb-btn" data-ex-load="${escHtml(ex.id)}" data-ex-mode="new">➕ 새 시트로 추가</button>
          </div>
        </div>
      `).join('');

      subModal.innerHTML = `
        <div class="xl-submodal-card" style="max-width:560px;">
          <div class="xl-submodal-head">
            <span>🎨 Origin 그래프 예제 갤러리 (${catalog.length}종)</span>
            <button type="button" class="sb-tb-btn" data-smclose="1">✕</button>
          </div>
          <div class="xl-submodal-body" style="max-height:68vh;overflow-y:auto;">
            <div class="insp-empty">원하는 공학·과학 그래프 예제를 선택하면 데이터와 Origin 그래프 스타일·피팅·주석이 함께 열립니다.</div>
            <div class="xl-ex-grid">${cardsHtml}</div>
          </div>
          <div class="xl-submodal-foot">
            <button type="button" class="sb-tb-btn" data-smclose="1">닫기</button>
          </div>
        </div>
      `;
      subModal.style.display = 'flex';
      subModal.querySelectorAll('[data-ex-load]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const exId = btn.dataset.exLoad;
          const asNew = btn.dataset.exMode === 'new';
          subModal.style.display = 'none';
          loadExampleIntoWorkbook(exId, asNew);
        });
      });
    }

    // ---- Floating Ribbon Dropdown Builder ----
    function openRibbonDropdown(kind, anchorEl) {
      const rootRect = root.getBoundingClientRect();
      const btnRect = anchorEl.getBoundingClientRect();
      const left = Math.max(6, Math.min(rootRect.width - 270, btnRect.left - rootRect.left));
      const top = btnRect.bottom - rootRect.top + 2;

      let html = '';
      if (kind === 'file-menu') {
        const exList = Array.isArray(EXAMPLE_CATALOG) ? EXAMPLE_CATALOG : [];
        const exQuickHtml = exList.map((ex) =>
          `<button type="button" data-ddex="${escHtml(ex.id)}">${ex.icon} ${escHtml(ex.name)}</button>`
        ).join('');
        const aiBtnHtml = options.hideAI ? '' : '<hr><button type="button" data-ddcmd="ask-ai">🤖 현재 시트로 AI 분석 질문</button>';
        html = `
          <div class="xl-dd-title">파일 작업</div>
          <button type="button" data-ddcmd="save">💾 저장 (Ctrl+S)</button>
          <button type="button" data-ddcmd="save-as">📝 다른 이름으로 저장...</button>
          <button type="button" data-ddcmd="import-file">📂 CSV / Excel(.xlsx) 불러오기</button>
          <hr>
          <div class="xl-dd-title">예제 (Origin 그래프 샘플)</div>
          <button type="button" data-ddcmd="open-examples" style="font-weight:700;color:#1d4ed8;">🎨 그래프 예제 갤러리 보기 (${exList.length}종)...</button>
          ${exQuickHtml}
          <hr>
          <div class="xl-dd-title">내보내기 · 프로젝트</div>
          <button type="button" data-ddcmd="export-xlsx">⬇️ Excel (.xlsx) 내보내기</button>
          <button type="button" data-ddcmd="export-csv">📄 CSV 내보내기</button>
          <button type="button" data-ddcmd="export-json">💾 Origin 프로젝트(.json) 저장</button>
          <button type="button" data-ddcmd="import-json">📥 Origin 프로젝트 열기</button>
          ${aiBtnHtml}
        `;
      } else if (kind === 'borders') {
        html = `
          <div class="xl-dd-title">셀 테두리</div>
          <button type="button" data-ddact="bdr-all">▦ 모든 테두리</button>
          <button type="button" data-ddact="bdr-outer">▢ 바깥쪽 테두리</button>
          <button type="button" data-ddact="bdr-bottom">▁ 아래쪽 테두리</button>
          <button type="button" data-ddact="bdr-bottom-thick">▄ 굵은 아래쪽 테두리</button>
          <button type="button" data-ddact="bdr-none">✕ 테두리 없음</button>
        `;
      } else if (kind === 'table-style') {
        html = `
          <div class="xl-dd-title">표 서식 (선택 영역 또는 전체 데이터)</div>
          <button type="button" data-ddact="tbl-green">🟩 Excel 클래식 그린</button>
          <button type="button" data-ddact="tbl-blue">🟦 오션 블루 테이블</button>
          <button type="button" data-ddact="tbl-slate">⬛ 슬레이트 모던 다크</button>
          <button type="button" data-ddact="tbl-none">🧹 표 서식 지우기</button>
        `;
      } else if (kind === 'cell-style') {
        html = `<div class="xl-dd-title">셀 스타일</div>` + CELL_STYLE_PRESETS.map((p, idx) =>
          `<button type="button" data-cstyle="${idx}">${escHtml(p.label)}</button>`
        ).join('');
      } else if (kind === 'cell-insert') {
        html = `
          <button type="button" data-ddcmd="add-row">➕ 시트 행 삽입 (Ctrl+Shift+=)</button>
          <button type="button" data-ddcmd="add-col">➕ 시트 열 삽입</button>
          <button type="button" data-ddcmd="add-sheet">📄 새 워크시트 삽입</button>
        `;
      } else if (kind === 'cell-delete') {
        html = `
          <button type="button" data-ddcmd="del-row" class="danger">➖ 시트 행 삭제 (Ctrl+-)</button>
          <button type="button" data-ddcmd="del-col" class="danger">➖ 시트 열 삭제</button>
        `;
      } else if (kind === 'cell-format') {
        html = `
          <button type="button" data-ddact="autofit-col">↔️ 열 너비 자동 맞춤</button>
          <button type="button" data-ddcmd="clear-style">🧹 서식 지우기</button>
          <button type="button" data-ddcmd="toggle-meta">🏷️ Origin 메타행 표시 토글</button>
        `;
      } else if (kind === 'autosum-menu') {
        html = `
          <button type="button" data-ddcmd="autosum-SUM">Σ 합계 (SUM)</button>
          <button type="button" data-ddcmd="autosum-AVERAGE">x̄ 평균 (AVERAGE)</button>
          <button type="button" data-ddcmd="autosum-COUNT"># 숫자 개수 (COUNT)</button>
          <button type="button" data-ddcmd="autosum-MAX">▲ 최댓값 (MAX)</button>
          <button type="button" data-ddcmd="autosum-MIN">▼ 최솟값 (MIN)</button>
          <button type="button" data-ddcmd="autosum-STDEV">σ 표준편차 (STDEV)</button>
        `;
      } else if (kind === 'fill-menu') {
        html = `
          <button type="button" data-ddact="fill-down">⬇️ 아래로 채우기</button>
          <button type="button" data-ddact="fill-right">➡️ 오른쪽으로 채우기</button>
        `;
      } else if (kind === 'clear-menu') {
        html = `
          <button type="button" data-ddact="clear-all">🗑️ 모두 지우기 (값+서식)</button>
          <button type="button" data-ddact="clear-style">🧹 서식만 지우기</button>
          <button type="button" data-ddact="clear-contents">⌫ 내용만 지우기 (Del)</button>
        `;
      } else if (kind === 'sort-filter-menu') {
        const isF = Boolean(getSheet().filterEnabled);
        html = `
          <button type="button" data-ddcmd="sort-asc">⬆️ 텍스트 오름차순 정렬 (A→Z)</button>
          <button type="button" data-ddcmd="sort-desc">⬇️ 텍스트 내림차순 정렬 (Z→A)</button>
          <hr>
          <button type="button" data-ddcmd="toggle-filter">${isF ? '✓ ' : ''}🔻 필터 (Ctrl+Shift+L)</button>
          <button type="button" data-ddcmd="clear-filters">↺ 모든 필터 해제</button>
        `;
      } else if (kind === 'zoom-menu') {
        html = `<div class="xl-dd-title">화면 배율</div>` + [50, 75, 90, 100, 125, 150, 200].map((z) =>
          `<button type="button" data-ddzoom="${z}">${z === zoomLevel ? '✓ ' : ''}${z}%</button>`
        ).join('');
      } else if (kind === 'freeze-menu') {
        const fz = getSheet().freeze || { rows: 0, cols: 0 };
        html = `
          <div class="xl-dd-title">틀 고정 (현재: ${fz.rows}행 / ${fz.cols}열)</div>
          <button type="button" data-ddfreeze="current">❄️ 현재 셀(${cellKey(selAnchor.r, selAnchor.c)}) 기준 틀 고정</button>
          <button type="button" data-ddfreeze="top-row">📌 첫 행 고정 (1행)</button>
          <button type="button" data-ddfreeze="first-col">📌 첫 열 고정 (A열)</button>
          <hr>
          <button type="button" data-ddfreeze="none">🔓 틀 고정 해제</button>
        `;
      } else if (kind === 'sym-picker') {
        html = `<div class="xl-dd-title">그리스 문자 · 공학 기호 (클릭 삽입)</div><div class="xl-sym-grid">${
          SYMBOL_CHARS.map((ch) => `<button type="button" class="xl-sym-cell" data-ddsym="${escHtml(ch)}">${escHtml(ch)}</button>`).join('')
        }</div>`;
      } else if (kind === 'eq-picker') {
        html = `<div class="xl-dd-title">π 공학 수식 템플릿</div>` + EQUATION_SNIPPETS.map((eq, i) =>
          `<button type="button" data-ddeq="${i}">${escHtml(eq.label)}</button>`
        ).join('');
      } else if (kind === 'fn-recent') {
        html = `<div class="xl-dd-title">최근 사용 함수</div>` + recentFunctions.map((fn) =>
          `<button type="button" data-ddfn="=${fn}()" data-ddfname="${fn}">ƒx ${fn}</button>`
        ).join('');
      } else if (kind.startsWith('fn-')) {
        const list = FORMULA_CATEGORIES[kind.slice(3)] || [];
        html = list.map((f) =>
          `<button type="button" data-ddfn="${escHtml(f.sig)}" data-ddfname="${escHtml(f.sig.slice(1).split('(')[0])}">${escHtml(f.label)}</button>`
        ).join('');
      }

      ribbonDropdown.innerHTML = html;
      ribbonDropdown.style.left = `${left}px`;
      ribbonDropdown.style.top = `${top}px`;
      ribbonDropdown.style.display = 'flex';
    }

    ribbonDropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      ribbonDropdown.style.display = 'none';

      if (btn.dataset.ddcmd) { handleCommand(btn.dataset.ddcmd); return; }
      if (btn.dataset.ddex) { loadExampleIntoWorkbook(btn.dataset.ddex, false); return; }
      if (btn.dataset.ddzoom) { setZoom(Number(btn.dataset.ddzoom)); return; }
      if (btn.dataset.ddsym) { insertTextIntoCellOrEditor(btn.dataset.ddsym); return; }
      if (btn.dataset.ddeq !== undefined) {
        const eq = EQUATION_SNIPPETS[Number(btn.dataset.ddeq)];
        if (eq.sig) insertFormulaSnippet(eq.sig);
        else if (eq.raw) insertTextIntoCellOrEditor(eq.raw);
        return;
      }
      if (btn.dataset.ddfn) { insertFormulaSnippet(btn.dataset.ddfn, btn.dataset.ddfname); return; }
      if (btn.dataset.cstyle !== undefined) {
        const preset = CELL_STYLE_PRESETS[Number(btn.dataset.cstyle)];
        applyStyleToSelection(() => (preset.style ? { ...preset.style } : null));
        return;
      }
      if (btn.dataset.ddfreeze) {
        const sheet = getSheet();
        const mode = btn.dataset.ddfreeze;
        pushUndo();
        if (mode === 'none') sheet.freeze = { rows: 0, cols: 0 };
        else if (mode === 'top-row') sheet.freeze = { rows: 1, cols: 0 };
        else if (mode === 'first-col') sheet.freeze = { rows: 0, cols: 1 };
        else if (mode === 'current') {
          sheet.freeze = (selAnchor.r === 0 && selAnchor.c === 0)
            ? { rows: 1, cols: 0 }
            : { rows: selAnchor.r, cols: selAnchor.c };
        }
        markDirty();
        applyFreezePanes();
        updateStatusStats();
        toast(sheet.freeze.rows || sheet.freeze.cols
          ? `❄️ 틀 고정됨 (${sheet.freeze.rows}행 / ${sheet.freeze.cols}열)`
          : '🔓 틀 고정이 해제되었습니다.');
        return;
      }

      const act = btn.dataset.ddact;
      if (act === 'bdr-all') applyStyleToSelection((st) => ({ ...st, borderAll: true }));
      else if (act === 'bdr-outer') {
        applyStyleToSelection((st, r, c, r1, r2, c1, c2) => ({
          ...st,
          ...(r === r1 ? { borderTop: '1.5px solid #1e293b' } : {}),
          ...(r === r2 ? { borderBottom: '1.5px solid #1e293b' } : {}),
          ...(c === c1 ? { borderLeft: '1.5px solid #1e293b' } : {}),
          ...(c === c2 ? { borderRight: '1.5px solid #1e293b' } : {})
        }));
      } else if (act === 'bdr-bottom') applyStyleToSelection((st) => ({ ...st, borderBottom: '1px solid #1e293b' }));
      else if (act === 'bdr-bottom-thick') applyStyleToSelection((st) => ({ ...st, borderBottom: '2.5px solid #1e293b' }));
      else if (act === 'bdr-none') applyStyleToSelection((st) => {
        const next = { ...st };
        delete next.borderAll; delete next.borderTop; delete next.borderBottom; delete next.borderLeft; delete next.borderRight;
        return next;
      });
      else if (act === 'tbl-green') applyTableStylePreset('green');
      else if (act === 'tbl-blue') applyTableStylePreset('blue');
      else if (act === 'tbl-slate') applyTableStylePreset('slate');
      else if (act === 'tbl-none') applyTableStylePreset('none');
      else if (act === 'autofit-col') {
        const sheet = getSheet();
        const { c1, c2 } = getNormRange();
        const { maxR } = getUsedBounds(sheet);
        pushUndo();
        for (let c = c1; c <= c2; c++) {
          let maxChars = 6;
          for (let r = 0; r <= maxR; r++) {
            maxChars = Math.max(maxChars, getCellDisplayStr(sheet, workbook.activeSheet, r, c).length);
          }
          sheet.colWidths[c] = Math.max(68, Math.min(340, maxChars * 9 + 26));
        }
        markDirty();
        renderGridStructure();
      } else if (act === 'fill-down') {
        const { r1, r2, c1, c2 } = getNormRange();
        if (r2 > r1) {
          const sheet = getSheet();
          pushUndo();
          for (let c = c1; c <= c2; c++) {
            const src = sheet.cells[cellKey(r1, c)];
            const srcRaw = src?.raw || '';
            for (let r = r1 + 1; r <= r2; r++) {
              const nextRaw = srcRaw.startsWith('=') ? shiftFormula(srcRaw, r - r1, 0) : srcRaw;
              setCellData(sheet, r, c, nextRaw, src?.style ? { ...src.style } : null);
            }
          }
          markDirty();
          refreshAllCellValues();
        }
      } else if (act === 'fill-right') {
        const { r1, r2, c1, c2 } = getNormRange();
        if (c2 > c1) {
          const sheet = getSheet();
          pushUndo();
          for (let r = r1; r <= r2; r++) {
            const src = sheet.cells[cellKey(r, c1)];
            const srcRaw = src?.raw || '';
            for (let c = c1 + 1; c <= c2; c++) {
              const nextRaw = srcRaw.startsWith('=') ? shiftFormula(srcRaw, 0, c - c1) : srcRaw;
              setCellData(sheet, r, c, nextRaw, src?.style ? { ...src.style } : null);
            }
          }
          markDirty();
          refreshAllCellValues();
        }
      } else if (act === 'clear-all') clearSelectionCells('all');
      else if (act === 'clear-style') clearSelectionCells('style');
      else if (act === 'clear-contents') clearSelectionCells('contents');
    });

    // ---- Keyboard Shortcuts ----
    root.addEventListener('keydown', (e) => {
      if (
        e.target === inlineEditor ||
        e.target === elFormulaInput ||
        e.target === elAddr ||
        e.target === fxSearchInput ||
        e.target.closest('.origin-meta-input, .xl-plot-inspector-box, .xl-submodal-card, .origin-plot-shell, .xl-find-bar, .xl-filter-popover')
      ) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          commitEdit();
          triggerSave();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'a') { e.preventDefault(); e.stopPropagation(); selectAllCells(); return; }
        if (k === 's') { e.preventDefault(); e.stopPropagation(); triggerSave(); return; }
        if (k === 'z') { e.preventDefault(); e.stopPropagation(); doUndo(); return; }
        if (k === 'y') { e.preventDefault(); e.stopPropagation(); doRedo(); return; }
        if (k === 'c') { e.preventDefault(); e.stopPropagation(); copySelection(false); return; }
        if (k === 'x') { e.preventDefault(); e.stopPropagation(); copySelection(true); return; }
        if (k === 'v') { e.preventDefault(); e.stopPropagation(); pasteAtSelection(null); return; }
        if (k === 'f') { e.preventDefault(); e.stopPropagation(); handleCommand('open-find'); return; }
        if (k === 'l' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); handleCommand('toggle-filter'); return; }
        if (k === 'b') { e.preventDefault(); e.stopPropagation(); handleCommand('bold'); return; }
        if (k === 'i') { e.preventDefault(); e.stopPropagation(); handleCommand('italic'); return; }
        if (k === 'u') { e.preventDefault(); e.stopPropagation(); handleCommand('underline'); return; }
        if (e.key === '+' || (e.shiftKey && e.key === '=')) { e.preventDefault(); e.stopPropagation(); insertRowAt(selAnchor.r); return; }
        if (e.key === '-') { e.preventDefault(); e.stopPropagation(); deleteRowAt(selAnchor.r); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); jumpToDataEdge(-1, 0, e.shiftKey); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); jumpToDataEdge(1, 0, e.shiftKey); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); jumpToDataEdge(0, -1, e.shiftKey); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); jumpToDataEdge(0, 1, e.shiftKey); return; }
        if (e.key === 'Home') {
          e.preventDefault(); e.stopPropagation();
          if (e.shiftKey) selFocus = { r: 0, c: 0 };
          else { selAnchor = { r: 0, c: 0 }; selFocus = { r: 0, c: 0 }; }
          updateSelectionVisuals();
          tdMatrix[0]?.[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return;
        }
        if (e.key === 'End') {
          e.preventDefault(); e.stopPropagation();
          const b = getUsedBounds(getSheet());
          const er = Math.max(0, b.maxR), ec = Math.max(0, b.maxC);
          if (e.shiftKey) selFocus = { r: er, c: ec };
          else { selAnchor = { r: er, c: ec }; selFocus = { r: er, c: ec }; }
          updateSelectionVisuals();
          tdMatrix[er]?.[ec]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return;
        }
      }

      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveSelection(-1, 0, e.shiftKey); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); moveSelection(1, 0, e.shiftKey); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); moveSelection(0, -1, e.shiftKey); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); moveSelection(0, 1, e.shiftKey); return; }
      if (e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); moveSelection(-15, 0, e.shiftKey); return; }
      if (e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); moveSelection(15, 0, e.shiftKey); return; }
      if (e.key === 'Home') {
        e.preventDefault(); e.stopPropagation();
        const tr = e.shiftKey ? selFocus.r : selAnchor.r;
        if (e.shiftKey) selFocus = { r: tr, c: 0 };
        else { selAnchor = { r: tr, c: 0 }; selFocus = { r: tr, c: 0 }; }
        updateSelectionVisuals();
        tdMatrix[tr]?.[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); moveSelection(0, e.shiftKey ? -1 : 1, false); return; }
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); startEdit(selAnchor.r, selAnchor.c, null, 'cell'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); clearSelectionCells('contents'); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        startEdit(selAnchor.r, selAnchor.c, e.key, 'cell');
      }
    });

    root.addEventListener('paste', (e) => {
      if (
        e.target === inlineEditor || e.target === elFormulaInput || e.target === elAddr || e.target === fxSearchInput ||
        e.target.closest('.origin-meta-input, .xl-plot-inspector-box, .xl-submodal-card, .origin-plot-shell, .xl-find-bar, .xl-filter-popover')
      ) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        clipboardData = null;
        pasteAtSelection(text);
      }
    });

    // ---- Sheet Tabs ----
    function addNewSheet() {
      commitEdit();
      pushUndo();
      let n = workbook.sheets.length + 1;
      while (workbook.sheets.some((s) => s.name === `Sheet${n}`)) n++;
      workbook.sheets.push(createEmptySheet(`Sheet${n}`));
      workbook.activeSheet = workbook.sheets.length - 1;
      selAnchor = { r: 0, c: 0 };
      selFocus = { r: 0, c: 0 };
      markDirty();
      if (plotController) plotController.setConfig(getSheet().plotConfig);
      renderGridStructure();
    }

    function renderSheetTabs() {
      elTabs.innerHTML = '';
      workbook.sheets.forEach((s, idx) => {
        const tab = document.createElement('div');
        tab.className = 'sb-sheet-tab' + (idx === workbook.activeSheet ? ' active' : '');
        const label = document.createElement('span');
        label.textContent = s.name;
        tab.appendChild(label);

        tab.addEventListener('click', () => {
          if (idx === workbook.activeSheet) return;
          commitEdit();
          workbook.activeSheet = idx;
          selAnchor = { r: 0, c: 0 };
          selFocus = { r: 0, c: 0 };
          if (plotController) plotController.setConfig(getSheet().plotConfig);
          renderGridStructure();
        });
        tab.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const nextName = prompt('시트 이름을 입력하세요:', s.name);
          if (nextName && nextName.trim() && nextName.trim() !== s.name) {
            pushUndo();
            s.name = nextName.trim().slice(0, 31);
            markDirty();
            renderSheetTabs();
            refreshAllCellValues();
          }
        });
        if (workbook.sheets.length > 1) {
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'sb-sheet-tab-del';
          del.textContent = '×';
          del.title = '시트 삭제';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`"${s.name}" 시트를 삭제할까요?`)) return;
            pushUndo();
            workbook.sheets.splice(idx, 1);
            workbook.activeSheet = Math.max(0, Math.min(workbook.activeSheet, workbook.sheets.length - 1));
            markDirty();
            if (plotController) plotController.setConfig(getSheet().plotConfig);
            renderGridStructure();
          });
          tab.appendChild(del);
        }
        elTabs.appendChild(tab);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'sb-sheet-tab-add';
      addBtn.textContent = '＋';
      addBtn.title = '새 시트 추가';
      addBtn.addEventListener('click', addNewSheet);
      elTabs.appendChild(addBtn);
    }

    // ---- Save & File I/O ----
    async function triggerSave() {
      commitEdit();
      if (typeof options.onSave === 'function') {
        elDirty.textContent = '저장 중...';
        try {
          const res = await options.onSave(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
          if (res && res.cancelled) {
            updateDirtyUI();
            return;
          }
          if (res && res.fileName) options.fileName = res.fileName;
          isDirty = false;
          updateDirtyUI();
        } catch (err) {
          elDirty.textContent = '저장 실패';
          toast(`⚠️ 저장 실패: ${err.message}`);
        }
      }
    }

    async function triggerSaveAs() {
      commitEdit();
      const handler = typeof options.onSaveAs === 'function' ? options.onSaveAs : options.onSave;
      if (typeof handler === 'function') {
        elDirty.textContent = '저장 중...';
        try {
          const res = await handler(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
          if (res && res.cancelled) {
            updateDirtyUI();
            return;
          }
          if (res && res.fileName) options.fileName = res.fileName;
          isDirty = false;
          updateDirtyUI();
        } catch (err) {
          elDirty.textContent = '저장 실패';
          toast(`⚠️ 저장 실패: ${err.message}`);
        }
      }
    }

    async function triggerExportXlsx() {
      commitEdit();
      try {
        const blob = await exportWorkbookToXlsxBlob(workbook);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const baseName = String(options.fileName || 'spreadsheet').replace(/\.(xlsx|xls|csv|json)$/i, '');
        a.href = url; a.download = `${baseName}.xlsx`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        toast(`⬇️ "${baseName}.xlsx" 다운로드됨`);
      } catch (err) { toast(`⚠️ 내보내기 실패: ${err.message}`); }
    }

    function triggerExportCsv() {
      commitEdit();
      const csv = exportSheetToCsv(workbook, workbook.activeSheet);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      const baseName = String(options.fileName || 'spreadsheet').replace(/\.(xlsx|xls|csv|json)$/i, '');
      a.href = url; a.download = `${baseName}-${getSheet().name}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('⬇️ CSV 파일 다운로드됨');
    }

    function triggerExportJsonProject() {
      commitEdit();
      const payload = { app: 'SecondBrainOS-OriginSpreadsheet', exportedAt: new Date().toISOString(), workbook: cloneWorkbook(workbook) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a');
      const baseName = String(options.fileName || 'origin-project').replace(/\.(xlsx|xls|csv|json)$/i, '');
      a.href = url; a.download = `${baseName}.origin.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`💾 프로젝트 파일(${baseName}.origin.json) 저장됨`);
    }

    importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const loadedWb = await parseArrayBufferToWorkbook(await file.arrayBuffer(), file.name);
        pushUndo();
        workbook = loadedWb;
        evaluator = createEvaluator(workbook);
        selAnchor = { r: 0, c: 0 }; selFocus = { r: 0, c: 0 };
        markDirty();
        if (plotController) plotController.setConfig(getSheet().plotConfig);
        renderGridStructure();
        toast(`📂 "${file.name}" 불러오기 완료`);
      } catch (err) { toast(`⚠️ 불러오기 실패: ${err.message}`); }
    });

    importJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const wbData = parsed.workbook || parsed;
        if (!wbData || !Array.isArray(wbData.sheets)) throw new Error('올바른 프로젝트 JSON 파일이 아닙니다.');
        pushUndo();
        workbook = normalizeWorkbook(wbData);
        evaluator = createEvaluator(workbook);
        selAnchor = { r: 0, c: 0 }; selFocus = { r: 0, c: 0 };
        markDirty();
        if (plotController) plotController.setConfig(getSheet().plotConfig);
        renderGridStructure();
        toast(`📥 프로젝트 "${file.name}" 복원 완료`);
      } catch (err) { toast(`⚠️ 프로젝트 복원 실패: ${err.message}`); }
    });

    // ---- Ribbon Tabs & Commands ----
    function ensureOriginSplit() {
      if (appMode !== 'origin') setAppMode('origin');
      if (viewMode === 'sheet') setViewMode('split');
    }

    function handleCommand(cmd) {
      if (cmd === 'save') { triggerSave(); return; }
      if (cmd === 'save-as') { triggerSaveAs(); return; }
      if (cmd === 'undo') { doUndo(); return; }
      if (cmd === 'redo') { doRedo(); return; }
      if (cmd === 'copy') { copySelection(false); return; }
      if (cmd === 'cut') { copySelection(true); return; }
      if (cmd === 'paste') { pasteAtSelection(null); return; }
      if (cmd === 'format-painter') {
        const curSt = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style || {};
        formatPainterStyle = { ...curSt };
        ribbonBody.querySelector('[data-cmd="format-painter"]')?.classList.add('active');
        gridWrap.classList.add('format-painter-cursor');
        toast('🖌️ 서식 복사 켜짐 — 적용할 셀을 클릭하거나 드래그하세요.');
        return;
      }
      if (cmd === 'bold') { const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.bold; applyStyleToSelection((st) => ({ ...st, bold: !cur })); return; }
      if (cmd === 'italic') { const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.italic; applyStyleToSelection((st) => ({ ...st, italic: !cur })); return; }
      if (cmd === 'underline') { const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.underline; applyStyleToSelection((st) => ({ ...st, underline: !cur })); return; }
      if (cmd === 'font-inc') { applyStyleToSelection((st) => ({ ...st, fontSize: Math.min(28, (st.fontSize || 11) + 1) })); return; }
      if (cmd === 'font-dec') { applyStyleToSelection((st) => ({ ...st, fontSize: Math.max(8, (st.fontSize || 11) - 1) })); return; }
      if (cmd === 'align-left') { applyStyleToSelection((st) => ({ ...st, align: 'left' })); return; }
      if (cmd === 'align-center') { applyStyleToSelection((st) => ({ ...st, align: 'center' })); return; }
      if (cmd === 'align-right') { applyStyleToSelection((st) => ({ ...st, align: 'right' })); return; }
      if (cmd === 'valign-top') { applyStyleToSelection((st) => ({ ...st, valign: 'top' })); return; }
      if (cmd === 'valign-middle') { applyStyleToSelection((st) => ({ ...st, valign: 'middle' })); return; }
      if (cmd === 'valign-bottom') { applyStyleToSelection((st) => ({ ...st, valign: 'bottom' })); return; }
      if (cmd === 'wrap-text') { const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.wrap; applyStyleToSelection((st) => ({ ...st, wrap: !cur })); return; }
      if (cmd === 'merge-center') { toggleMergeCenter(); return; }
      if (cmd === 'clear-style') { applyStyleToSelection(() => null); return; }
      if (cmd === 'fmt-number') { applyStyleToSelection((st) => ({ ...st, numFmt: st.numFmt === 'number' ? 'general' : 'number' })); return; }
      if (cmd === 'fmt-currency') { applyStyleToSelection((st) => ({ ...st, numFmt: st.numFmt === 'currency' ? 'general' : 'currency' })); return; }
      if (cmd === 'fmt-usd') { applyStyleToSelection((st) => ({ ...st, numFmt: st.numFmt === 'usd' ? 'general' : 'usd' })); return; }
      if (cmd === 'fmt-percent') { applyStyleToSelection((st) => ({ ...st, numFmt: st.numFmt === 'percent' ? 'general' : 'percent' })); return; }
      if (cmd === 'dec-inc') { applyStyleToSelection((st) => ({ ...st, decimals: Math.min(6, (typeof st.decimals === 'number' ? st.decimals : 0) + 1) })); return; }
      if (cmd === 'dec-dec') { applyStyleToSelection((st) => ({ ...st, decimals: Math.max(0, (typeof st.decimals === 'number' ? st.decimals : 1) - 1) })); return; }
      if (cmd === 'add-row') { insertRowAt(selAnchor.r + 1); return; }
      if (cmd === 'del-row') { deleteRowAt(selAnchor.r); return; }
      if (cmd === 'add-col') { insertColAt(selAnchor.c + 1); return; }
      if (cmd === 'del-col') { deleteColAt(selAnchor.c); return; }
      if (cmd === 'toggle-meta') {
        showMetaRows = !showMetaRows;
        const chk = ribbonBody.querySelector('[data-vchk="metarows"]');
        if (chk) chk.checked = showMetaRows;
        renderGridStructure();
        return;
      }
      if (cmd === 'toggle-filter') {
        const sheet = getSheet();
        pushUndo();
        sheet.filterEnabled = !sheet.filterEnabled;
        if (!sheet.filterEnabled) sheet.columnFilters = {};
        markDirty();
        refreshAllCellValues();
        toast(sheet.filterEnabled ? '🔻 엑셀 필터 켜짐 — 1행의 ▼ 버튼을 눌러 값을 필터링하세요.' : '🔻 필터가 해제되었습니다.');
        return;
      }
      if (cmd === 'clear-filters') {
        const sheet = getSheet();
        if (!sheet.columnFilters || Object.keys(sheet.columnFilters).length === 0) return;
        pushUndo();
        sheet.columnFilters = {};
        markDirty();
        refreshAllCellValues();
        toast('↺ 적용된 모든 열 필터가 초기화되었습니다.');
        return;
      }
      if (cmd === 'open-find') {
        findBar.style.display = 'flex';
        elFindQuery.focus();
        elFindQuery.select();
        return;
      }
      if (cmd === 'fx-help') {
        fxPanel.style.display = fxPanel.style.display === 'none' ? 'flex' : 'none';
        if (fxPanel.style.display === 'flex') fxSearchInput.focus();
        return;
      }
      if (cmd === 'name-manager') { openNameManagerModal(); return; }
      if (cmd.startsWith('autosum-')) { insertAutoStat(cmd.slice(8)); return; }
      if (cmd === 'set-col-values') { openSetColumnValuesModal(selAnchor.c); return; }
      if (cmd === 'sort-asc') { sortSheetByColumn(selAnchor.c, true); return; }
      if (cmd === 'sort-desc') { sortSheetByColumn(selAnchor.c, false); return; }
      if (cmd === 'add-sheet') { addNewSheet(); return; }
      if (cmd === 'import-file') { importFileInput.click(); return; }
      if (cmd === 'export-xlsx') { triggerExportXlsx(); return; }
      if (cmd === 'export-csv') { triggerExportCsv(); return; }
      if (cmd === 'export-json') { triggerExportJsonProject(); return; }
      if (cmd === 'import-json') { importJsonInput.click(); return; }
      if (cmd === 'open-examples') { openExamplesGalleryModal(); return; }
      if (cmd === 'ask-ai') {
        if (options.hideAI) return;
        commitEdit();
        if (typeof options.onAskAI === 'function') options.onAskAI(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
        return;
      }

      // Sparklines
      if (cmd === 'spark-line') { insertSparkline('line'); return; }
      if (cmd === 'spark-col') { insertSparkline('col'); return; }
      if (cmd === 'spark-winloss') { insertSparkline('winloss'); return; }
      if (cmd === 'spark-clear') {
        const sheet = getSheet();
        const { r1, r2, c1, c2 } = getNormRange();
        pushUndo();
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
          const cell = sheet.cells[cellKey(r, c)];
          if (cell?.sparkline) delete cell.sparkline;
        }
        markDirty();
        refreshAllCellValues();
        return;
      }

      // View: Zoom, New Window, Arrange All
      if (cmd === 'zoom-100') { setZoom(100); return; }
      if (cmd === 'zoom-selection') {
        const { r1, r2, c1, c2 } = getNormRange();
        const wrapRect = gridWrap.getBoundingClientRect();
        let selW = 0;
        const sheet = getSheet();
        for (let c = c1; c <= c2; c++) selW += (sheet.colWidths[c] || 98);
        const selH = (r2 - r1 + 1) * 26;
        const fitZoom = Math.min((wrapRect.width * 0.78) / Math.max(80, selW), (wrapRect.height * 0.72) / Math.max(40, selH)) * 100;
        setZoom(Math.max(60, Math.min(200, Math.round(fitZoom / 5) * 5)));
        tdMatrix[r1]?.[c1]?.scrollIntoView({ block: 'center', inline: 'center' });
        toast(`🎯 선택 영역 배율: ${zoomLevel}%`);
        return;
      }
      if (cmd === 'new-window') {
        commitEdit();
        if (typeof options.onNewWindow === 'function') options.onNewWindow(cloneWorkbook(workbook), appMode);
        else toast('💡 새 창 기능은 세컨드 브레인 멀티 윈도우에서 동작합니다.');
        return;
      }
      if (cmd === 'arrange-windows') {
        if (typeof options.onArrangeWindows === 'function') options.onArrangeWindows();
        else toast('💡 모두 정렬 기능은 세컨드 브레인 멀티 윈도우에서 동작합니다.');
        return;
      }

      // Origin Plot Commands (auto-enter Origin mode!)
      if (cmd === 'open-fit') { ensureOriginSplit(); setTimeout(() => plotController?.openCurveFittingModal(), 60); return; }
      if (cmd === 'plot-line-symbol') { ensureOriginSplit(); plotController?.setPlotType('line-symbol', false); return; }
      if (cmd === 'plot-scatter') { ensureOriginSplit(); plotController?.setPlotType('scatter', false); return; }
      if (cmd === 'plot-line') { ensureOriginSplit(); plotController?.setPlotType('line', false); return; }
      if (cmd === 'plot-double-y') { ensureOriginSplit(); plotController?.setPlotType('line-symbol', true); return; }
      if (cmd === 'plot-bar') { ensureOriginSplit(); plotController?.setPlotType('bar', false); return; }
      if (cmd === 'plot-area') { ensureOriginSplit(); plotController?.setPlotType('area', false); return; }
      if (cmd === 'plot-select') { ensureOriginSplit(); plotController?.setInteractionMode('select'); return; }
      if (cmd === 'plot-zoom') { ensureOriginSplit(); plotController?.setInteractionMode('zoom'); return; }
      if (cmd === 'plot-reader') { ensureOriginSplit(); plotController?.setInteractionMode('reader'); return; }
      if (cmd === 'plot-reset') { plotController?.resetZoom(); return; }
      if (cmd === 'plot-add-text') { ensureOriginSplit(); setTimeout(() => plotController?.openTextAnnotationEditor(null), 60); return; }
      if (cmd === 'plot-legend') { ensureOriginSplit(); setTimeout(() => plotController?.openLegendPropertiesModal(), 60); return; }
      if (cmd === 'toggle-inspector') {
        ensureOriginSplit();
        showInspector = !showInspector;
        plotInspectorBox.style.display = showInspector ? 'flex' : 'none';
        setTimeout(() => plotController?.refresh(), 40);
        return;
      }
      if (cmd === 'export-svg') { ensureOriginSplit(); setTimeout(() => plotController?.exportSvg(), 60); return; }
      if (cmd === 'export-png') { ensureOriginSplit(); setTimeout(() => plotController?.exportPng300Dpi(), 60); return; }
    }

    ribbonHeader.addEventListener('click', (e) => {
      const ddBtn = e.target.closest('[data-dropdown]');
      if (ddBtn) { e.stopPropagation(); openRibbonDropdown(ddBtn.dataset.dropdown, ddBtn); return; }
      const tabBtn = e.target.closest('[data-rtab]');
      if (tabBtn) { switchRibbonTab(tabBtn.dataset.rtab); return; }
      const modeBtn = e.target.closest('[data-appmode]');
      if (modeBtn) { setAppMode(modeBtn.dataset.appmode); return; }
      const vBtn = e.target.closest('[data-vmode]');
      if (vBtn) { setViewMode(vBtn.dataset.vmode); return; }
      const cmdBtn = e.target.closest('[data-cmd]');
      if (cmdBtn) handleCommand(cmdBtn.dataset.cmd);
    });

    ribbonBody.addEventListener('click', (e) => {
      const ddBtn = e.target.closest('[data-dropdown]');
      if (ddBtn) { e.stopPropagation(); openRibbonDropdown(ddBtn.dataset.dropdown, ddBtn); return; }
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'SELECT') return;
      handleCommand(btn.dataset.cmd);
    });

    ribbonBody.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset.vchk) {
        if (el.dataset.vchk === 'gridlines') { showGridlines = el.checked; table.classList.toggle('hide-gridlines', !showGridlines); }
        else if (el.dataset.vchk === 'formulabar') { showFormulaBar = el.checked; formulaBar.style.display = showFormulaBar ? 'flex' : 'none'; }
        else if (el.dataset.vchk === 'metarows') { showMetaRows = el.checked; renderGridStructure(); }
        return;
      }
      const cmd = el.dataset.cmd;
      if (!cmd) return;
      if (cmd === 'color') applyStyleToSelection((st) => ({ ...st, color: el.value }));
      else if (cmd === 'bg') applyStyleToSelection((st) => ({ ...st, bg: el.value }));
      else if (cmd === 'font-family') applyStyleToSelection((st) => ({ ...st, fontFamily: el.value }));
      else if (cmd === 'font-size') applyStyleToSelection((st) => ({ ...st, fontSize: Number(el.value) || 11 }));
      else if (cmd === 'num-fmt-select') applyStyleToSelection((st) => ({ ...st, numFmt: el.value }));
    });

    footerBar.addEventListener('click', (e) => {
      const zBtn = e.target.closest('[data-zact]');
      if (!zBtn) return;
      if (zBtn.dataset.zact === 'in') setZoom(zoomLevel + 10);
      else if (zBtn.dataset.zact === 'out') setZoom(zoomLevel - 10);
    });

    formulaBar.querySelector('[data-cmd="fx-help"]').addEventListener('click', () => handleCommand('fx-help'));
    fxPanel.querySelector('[data-cmd="close-fx"]').addEventListener('click', () => { fxPanel.style.display = 'none'; });
    fxSearchInput.addEventListener('input', () => {
      const q = fxSearchInput.value.trim().toLowerCase();
      fxPanel.querySelectorAll('.sb-fx-item').forEach((item) => {
        item.style.display = !q || item.textContent.toLowerCase().includes(q) ? 'grid' : 'none';
      });
    });
    fxPanel.addEventListener('click', (e) => {
      const btn = e.target.closest('.sb-fx-item');
      if (!btn) return;
      fxPanel.style.display = 'none';
      insertFormulaSnippet(btn.dataset.sig || '', btn.dataset.fname || '');
    });

    // Initial render
    if (options.hideAI) root.classList.add('hide-ai');
    renderGridStructure();
    if (appMode === 'origin' && viewMode !== 'sheet') setViewMode(viewMode);

    return {
      getWorkbook() { commitEdit(); return cloneWorkbook(workbook); },
      getMarkdownSummary() { commitEdit(); return workbookToMarkdownSummary(workbook); },
      isDirty() { return isDirty; },
      getAppMode() { return appMode; },
      setAppMode,
      setViewMode,
      setZoom,
      loadExample: loadExampleIntoWorkbook,
      openExamplesGallery: openExamplesGalleryModal,
      getPlotController() { return plotController; },
      // Live sync from another open window ("새 창") viewing the SAME file
      syncWorkbook(externalWb) {
        const keepSheet = Math.min(workbook.activeSheet, Math.max(0, (externalWb?.sheets?.length || 1) - 1));
        const normalized = normalizeWorkbook(externalWb);
        normalized.activeSheet = keepSheet;
        workbook = normalized;
        evaluator = createEvaluator(workbook);
        if (plotController) plotController.setConfig(getSheet().plotConfig);
        renderGridStructure();
      },
      save: triggerSave,
      saveAs: triggerSaveAs,
      destroy() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        document.removeEventListener('mouseup', onGlobalMouseUp);
        document.removeEventListener('click', onGlobalClick);
        plotController?.destroy();
      }
    };
  }

  BS.mountSpreadsheetUI = mountSpreadsheetUI;
})(window);
