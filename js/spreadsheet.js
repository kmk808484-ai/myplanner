(function (global) {
  'use strict';

  const DEFAULT_ROWS = 40;
  const DEFAULT_COLS = 14;
  const MAX_UNDO_STEPS = 60;
  const SHEETJS_URLS = [
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];

  let sheetJsLoadPromise = null;

  // ================= Column / Cell Helpers =================
  function colToLetter(colIdx) {
    let n = colIdx + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function letterToCol(letters) {
    const s = String(letters || '').toUpperCase();
    let col = 0;
    for (let i = 0; i < s.length; i++) {
      col = col * 26 + (s.charCodeAt(i) - 64);
    }
    return col - 1;
  }

  function cellKey(row, col) {
    return `${colToLetter(col)}${row + 1}`;
  }

  function parseCellRef(refStr) {
    const m = String(refStr || '').trim().match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/);
    if (!m) return null;
    const col = letterToCol(m[2]);
    const row = parseInt(m[4], 10) - 1;
    if (col < 0 || row < 0 || col > 16383 || row > 1048575) return null;
    return { col, row, absCol: m[1] === '$', absRow: m[3] === '$' };
  }

  function cloneWorkbook(wb) {
    return JSON.parse(JSON.stringify(wb));
  }

  function createEmptySheet(name = 'Sheet1', rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
    return {
      name,
      rows,
      cols,
      cells: {},
      colWidths: {},
      colMeta: {
        0: { longName: '', units: '', comments: '', role: 'X' }
      },
      filterEnabled: false,
      columnFilters: {}, // colIdx -> { allowed: string[] }
      freeze: { rows: 0, cols: 0 },
      merges: [], // [{ r1, c1, r2, c2 }]
      plotConfig: global.BrainOriginPlot ? global.BrainOriginPlot.createDefaultPlotConfig() : null
    };
  }

  function createEmptyWorkbook(sheetName = 'Sheet1') {
    return {
      version: 3,
      activeSheet: 0,
      namedRanges: {}, // NAME -> "A1" or "Sheet1!A1:B5"
      sheets: [createEmptySheet(sheetName)]
    };
  }

  function createStarterWorkbook() {
    const wb = createEmptyWorkbook('실험 데이터');
    const s = wb.sheets[0];
    s.colMeta = {
      0: { longName: '유량 Q', units: 'm^3/h', comments: '입력 유량', role: 'X' },
      1: { longName: '\\Delta P', units: 'kPa', comments: '압력 강하 측정', role: 'Y' },
      2: { longName: '오차', units: 'kPa', comments: '표준편차', role: 'yErr' },
      3: { longName: '효율 \\eta', units: '%', comments: '시스템 효율 (Y2)', role: 'Y' },
      4: { longName: '판정', units: '', comments: '목표 효율(>=75%)', role: '' }
    };
    s.cells = {
      A1: { raw: '10', style: { align: 'right' } },
      B1: { raw: '12.4', style: { align: 'right' } },
      C1: { raw: '0.8', style: { align: 'right' } },
      D1: { raw: '62.5', style: { align: 'right' } },
      E1: { raw: '=IF(D1>=75,"적합","검토")', style: { align: 'center' } },

      A2: { raw: '20', style: { align: 'right' } },
      B2: { raw: '25.8', style: { align: 'right' } },
      C2: { raw: '1.1', style: { align: 'right' } },
      D2: { raw: '71.2', style: { align: 'right' } },
      E2: { raw: '=IF(D2>=75,"적합","검토")', style: { align: 'center' } },

      A3: { raw: '30', style: { align: 'right' } },
      B3: { raw: '41.2', style: { align: 'right' } },
      C3: { raw: '1.5', style: { align: 'right' } },
      D3: { raw: '78.4', style: { align: 'right' } },
      E3: { raw: '=IF(D3>=75,"적합","검토")', style: { align: 'center' } },

      A4: { raw: '40', style: { align: 'right' } },
      B4: { raw: '59.5', style: { align: 'right' } },
      C4: { raw: '2.0', style: { align: 'right' } },
      D4: { raw: '83.1', style: { align: 'right' } },
      E4: { raw: '=IF(D4>=75,"적합","검토")', style: { align: 'center' } },

      A5: { raw: '50', style: { align: 'right' } },
      B5: { raw: '80.3', style: { align: 'right' } },
      C5: { raw: '2.4', style: { align: 'right' } },
      D5: { raw: '81.6', style: { align: 'right' } },
      E5: { raw: '=IF(D5>=75,"적합","검토")', style: { align: 'center' } },

      A6: { raw: '60', style: { align: 'right' } },
      B6: { raw: '104.8', style: { align: 'right' } },
      C6: { raw: '3.1', style: { align: 'right' } },
      D6: { raw: '76.9', style: { align: 'right' } },
      E6: { raw: '=IF(D6>=75,"적합","검토")', style: { align: 'center' } },

      A8: { raw: '평균', style: { bold: true, bg: '#f1f5f9' } },
      B8: { raw: '=ROUND(AVERAGE(B1:B6),2)', style: { bold: true, align: 'right', bg: '#f1f5f9' } },
      D8: { raw: '=ROUND(AVERAGE(D1:D6),2)', style: { bold: true, align: 'right', bg: '#f1f5f9' } },
      A9: { raw: '최댓값', style: { bold: true } },
      B9: { raw: '=MAX(B1:B6)', style: { align: 'right' } },
      D9: { raw: '=MAX(D1:D6)', style: { align: 'right' } },
      A10: { raw: '적합 건수', style: { bold: true } },
      E10: { raw: '=COUNTIF(E1:E6,"적합")', style: { align: 'center', bold: true } }
    };
    s.colWidths = { 0: 96, 1: 102, 2: 86, 3: 102, 4: 86 };
    if (global.BrainOriginPlot) {
      const cfg = global.BrainOriginPlot.createDefaultPlotConfig();
      cfg.title = '\\Delta P \\text{ & } \\eta \\text{ vs 유량 } Q';
      cfg.y2Axis.enabled = true;
      cfg.seriesStyles[1] = { color: '#dc2626', symbol: 'open-circle', yAxis: 'y1', visible: true, lineWidth: 2, symbolSize: 5.5, lineStyle: 'solid' };
      cfg.seriesStyles[3] = { color: '#2563eb', symbol: 'dot-square', yAxis: 'y2', visible: true, lineWidth: 2, symbolSize: 5.5, lineStyle: 'dashed' };
      const pts = [
        { x: 10, y: 12.4 }, { x: 20, y: 25.8 }, { x: 30, y: 41.2 },
        { x: 40, y: 59.5 }, { x: 50, y: 80.3 }, { x: 60, y: 104.8 }
      ];
      try {
        const { fitRes, curvePts } = global.BrainOriginPlot.computeFit(pts, 'poly2');
        cfg.fitOverlays = [{
          id: 'fit-demo-1', label: 'ΔP 2차 피팅', eqText: fitRes.eqText, r2: fitRes.r2,
          points: curvePts, color: '#991b1b', yAxis: 'y1', showInLegend: false
        }];
        cfg.annotations = [{
          id: 'txt-demo-1',
          text: `\\Delta P 2차 회귀\n${fitRes.formulaOnly}\nR^2 = ${fitRes.r2.toFixed(4)}`,
          x: 0.36, y: 0.58, fontSize: 10.5, color: '#991b1b', bold: false, hasBox: true
        }];
      } catch (_) {}
      s.plotConfig = cfg;
    }
    return wb;
  }

  // ================= Publication-Grade Origin Graph Example Gallery =================
  const EXAMPLE_CATALOG = [
    {
      id: 'double-y',
      icon: '🌊',
      name: '유체 압력강하 & 효율 (Double-Y)',
      badge: '이중 Y축 · 오차막대 · 2차 피팅',
      desc: '좌측 Y1(압력강하 ΔP + 오차막대 + 2차 다항식 피팅)과 우측 Y2(효율 η)를 동시에 표현한 대표 공학 그래프'
    },
    {
      id: 'damped-osc',
      icon: '🎛️',
      name: '제어공학 감쇠 진동 응답 (다중 곡선)',
      badge: '다중 계열 · 선 스타일 · 오버슈트 주석',
      desc: '감쇠비 ζ = 0.15(과소감쇠), 0.35(적정), 1.0(임계감쇠)의 2차 시스템 계단 응답을 깔끔하게 비교'
    },
    {
      id: 'bode-log',
      icon: '⚡',
      name: 'RC 필터 보드 선도 (Log10 X축)',
      badge: '로그 스케일 · Double-Y · 차단주파수',
      desc: '주파수 10 Hz ~ 100 kHz 로그 X축 위에 이득(dB)과 위상(°)을 이중축으로 그린 회로이론 보드 선도'
    },
    {
      id: 'exp-fit',
      icon: '🔥',
      name: '반응속도 실험 산점도 & 지수 피팅',
      badge: '산점도 · 지수 피팅 · 개별점 강조',
      desc: '온도별 반응속도 실험 데이터에 오차막대, 지수 회귀선(y = a·e^{bx}), 특이점(✕) 개별 심볼을 적용'
    },
    {
      id: 'bar-compare',
      icon: '📊',
      name: '소재 강도 벤치마크 (그룹 막대 + 수식)',
      badge: '막대 그래프 · 엑셀 집계 수식',
      desc: '기존 합금 vs 신규 복합재 vs 열처리 시편의 인장강도(MPa)를 그룹 막대 그래프와 자동 개선율(%) 수식으로 비교'
    }
  ];

  function createExampleWorkbook(exampleId) {
    if (exampleId === 'double-y') {
      return createStarterWorkbook();
    }

    if (exampleId === 'damped-osc') {
      const wb = createEmptyWorkbook('감쇠 진동 응답');
      const s = wb.sheets[0];
      s.rows = 52;
      s.colMeta = {
        0: { longName: '시간 t', units: 's', comments: '0~10초 샘플링', role: 'X' },
        1: { longName: '\\zeta = 0.15', units: '', comments: '과소감쇠 (Underdamped)', role: 'Y' },
        2: { longName: '\\zeta = 0.35', units: '', comments: '적정감쇠', role: 'Y' },
        3: { longName: '\\zeta = 1.00', units: '', comments: '임계감쇠 (Critically damped)', role: 'Y' }
      };
      const wn = 2.0;
      const stepResp = (t, zeta) => {
        if (zeta < 1) {
          const wd = wn * Math.sqrt(1 - zeta * zeta);
          const phi = Math.atan2(Math.sqrt(1 - zeta * zeta), zeta);
          return 1 - (Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t + phi);
        }
        return 1 - (1 + wn * t) * Math.exp(-wn * t);
      };
      for (let i = 0; i <= 40; i++) {
        const t = Math.round(i * 0.25 * 100) / 100;
        s.cells[cellKey(i, 0)] = { raw: String(t), style: { align: 'right' } };
        s.cells[cellKey(i, 1)] = { raw: stepResp(t, 0.15).toFixed(4), style: { align: 'right' } };
        s.cells[cellKey(i, 2)] = { raw: stepResp(t, 0.35).toFixed(4), style: { align: 'right' } };
        s.cells[cellKey(i, 3)] = { raw: stepResp(t, 1.0).toFixed(4), style: { align: 'right' } };
      }
      s.colWidths = { 0: 84, 1: 102, 2: 102, 3: 102 };
      if (global.BrainOriginPlot) {
        const cfg = global.BrainOriginPlot.createDefaultPlotConfig();
        cfg.title = '2차 시스템 계단 응답 (\\omega_n = 2 rad/s)';
        cfg.plotType = 'line-symbol';
        cfg.showGrid = true;
        cfg.legendPos = { x: 0.62, y: 0.56 };
        cfg.yAxis.title = '정규화 출력 y(t)';
        cfg.yAxis.min = '0';
        cfg.yAxis.max = '1.8';
        cfg.seriesStyles[1] = { color: '#dc2626', symbol: 'open-circle', symbolSize: 3.5, lineWidth: 2, lineStyle: 'solid', yAxis: 'y1', visible: true };
        cfg.seriesStyles[2] = { color: '#2563eb', symbol: 'triangle', symbolSize: 3.5, lineWidth: 2, lineStyle: 'dashed', yAxis: 'y1', visible: true };
        cfg.seriesStyles[3] = { color: '#059669', symbol: 'dot-circle', symbolSize: 3.5, lineWidth: 2, lineStyle: 'dashdot', yAxis: 'y1', visible: true };
        cfg.annotations = [{
          id: 'txt-damp-1',
          text: '최대 오버슈트 M_p \\approx 62%\n(\\zeta = 0.15, t_p = 1.59 s)',
          x: 0.30, y: 0.15, fontSize: 10.5, color: '#dc2626', bold: true, hasBox: true
        }];
        s.plotConfig = cfg;
      }
      return wb;
    }

    if (exampleId === 'bode-log') {
      const wb = createEmptyWorkbook('RC 필터 보드 선도');
      const s = wb.sheets[0];
      const fc = 1000; // 1 kHz cutoff
      s.colMeta = {
        0: { longName: '주파수 f', units: 'Hz', comments: 'Log10 스윕 (10~100kHz)', role: 'X' },
        1: { longName: '이득 Gain', units: 'dB', comments: '20·log10(|H(jω)|)', role: 'Y' },
        2: { longName: '위상 Phase', units: '°', comments: '-atan(f / f_c)', role: 'Y' }
      };
      const freqs = [10, 20, 40, 70, 100, 160, 250, 400, 630, 800, 1000, 1300, 1600, 2500, 4000, 6300, 10000, 20000, 40000, 70000, 100000];
      freqs.forEach((f, idx) => {
        const ratio = f / fc;
        const mag = 1 / Math.sqrt(1 + ratio * ratio);
        const gainDb = 20 * Math.log10(mag);
        const phaseDeg = -Math.atan(ratio) * (180 / Math.PI);
        s.cells[cellKey(idx, 0)] = { raw: String(f), style: { align: 'right', numFmt: 'number' } };
        s.cells[cellKey(idx, 1)] = { raw: gainDb.toFixed(2), style: { align: 'right' } };
        s.cells[cellKey(idx, 2)] = { raw: phaseDeg.toFixed(2), style: { align: 'right' } };
      });
      s.colWidths = { 0: 96, 1: 102, 2: 102 };
      if (global.BrainOriginPlot) {
        const cfg = global.BrainOriginPlot.createDefaultPlotConfig();
        cfg.title = '1차 RC 저역통과 필터 보드 선도 (f_c = 1 kHz)';
        cfg.plotType = 'line-symbol';
        cfg.showGrid = true;
        cfg.xAxis.scale = 'log';
        cfg.yAxis.min = '-45';
        cfg.yAxis.max = '5';
        cfg.y2Axis.enabled = true;
        cfg.y2Axis.min = '-95';
        cfg.y2Axis.max = '5';
        cfg.legendPos = { x: 0.05, y: 0.68 };
        cfg.seriesStyles[1] = { color: '#1f2937', symbol: 'circle', symbolSize: 4.5, lineWidth: 2.2, lineStyle: 'solid', yAxis: 'y1', visible: true };
        cfg.seriesStyles[2] = { color: '#7c3aed', symbol: 'dot-circle', symbolSize: 4.8, lineWidth: 2, lineStyle: 'dashed', yAxis: 'y2', visible: true };
        cfg.pointOverrides = { '1:10': { symbol: 'cross', symbolSize: 8.5, color: '#dc2626' } };
        cfg.annotations = [{
          id: 'txt-bode-1',
          text: '차단 주파수 f_c = 10^3 Hz\nGain = -3.01 dB, Phase = -45°',
          x: 0.44, y: 0.16, fontSize: 10.5, color: '#1f2937', bold: true, hasBox: true
        }];
        s.plotConfig = cfg;
      }
      return wb;
    }

    if (exampleId === 'exp-fit') {
      const wb = createEmptyWorkbook('반응속도 지수 피팅');
      const s = wb.sheets[0];
      s.colMeta = {
        0: { longName: '온도 T', units: '°C', comments: '반응기 온도', role: 'X' },
        1: { longName: '반응속도 k', units: 'mol/s', comments: '측정 평균값', role: 'Y' },
        2: { longName: '표준편차', units: 'mol/s', comments: '3회 반복 측정 오차', role: 'yErr' }
      };
      const rows = [
        [20, 0.42, 0.06], [30, 0.68, 0.08], [40, 1.09, 0.11], [50, 1.72, 0.15],
        [60, 2.84, 0.22], [70, 4.45, 0.31], [80, 7.12, 0.48], [90, 11.40, 0.72], [100, 18.25, 1.05]
      ];
      rows.forEach((r, idx) => {
        s.cells[cellKey(idx, 0)] = { raw: String(r[0]), style: { align: 'right' } };
        s.cells[cellKey(idx, 1)] = { raw: String(r[1]), style: { align: 'right' } };
        s.cells[cellKey(idx, 2)] = { raw: String(r[2]), style: { align: 'right' } };
      });
      s.colWidths = { 0: 92, 1: 108, 2: 96 };
      if (global.BrainOriginPlot) {
        const cfg = global.BrainOriginPlot.createDefaultPlotConfig();
        cfg.title = '온도에 따른 반응속도 지수 모델링';
        cfg.plotType = 'scatter';
        cfg.showGrid = true;
        cfg.legendPos = { x: 0.05, y: 0.07 };
        cfg.seriesStyles[1] = { color: '#dc2626', symbol: 'open-diamond', symbolSize: 6, lineWidth: 1.8, lineStyle: 'solid', yAxis: 'y1', visible: true };
        cfg.pointOverrides = { '1:6': { symbol: 'cross', symbolSize: 9, color: '#059669' } };
        const pts = rows.map((r) => ({ x: r[0], y: r[1] }));
        try {
          const { fitRes, curvePts } = global.BrainOriginPlot.computeFit(pts, 'exp');
          cfg.fitOverlays = [{
            id: 'fit-exp-1', label: '지수 회귀 (Exp Fit)', eqText: fitRes.eqText, r2: fitRes.r2,
            points: curvePts, color: '#1d4ed8', yAxis: 'y1', showInLegend: true
          }];
          cfg.annotations = [{
            id: 'txt-exp-1',
            text: `지수 피팅 모델\n${fitRes.formulaOnly}\nR^2 = ${fitRes.r2.toFixed(4)}`,
            x: 0.16, y: 0.34, fontSize: 11, color: '#1d4ed8', bold: true, hasBox: true
          }];
        } catch (_) {}
        s.plotConfig = cfg;
      }
      return wb;
    }

    // Default / 'bar-compare'
    const wb = createEmptyWorkbook('소재 강도 벤치마크');
    const s = wb.sheets[0];
    s.colMeta = {
      0: { longName: '시편 번호', units: '', comments: '샘플 인덱스', role: 'X' },
      1: { longName: '기존 합금', units: 'MPa', comments: '기준 인장강도', role: 'Y' },
      2: { longName: '신규 복합재', units: 'MPa', comments: '복합소재 적용', role: 'Y' },
      3: { longName: '열처리 개선', units: 'MPa', comments: '후열처리 강화', role: 'Y' },
      4: { longName: '향상률', units: '%', comments: '기존 대비 개선율', role: '' }
    };
    const data = [
      [1, 310, 385, 442],
      [2, 295, 372, 428],
      [3, 328, 410, 476],
      [4, 305, 392, 455],
      [5, 318, 404, 468]
    ];
    data.forEach((row, idx) => {
      const rNum = idx + 1;
      s.cells[cellKey(idx, 0)] = { raw: String(row[0]), style: { align: 'center' } };
      s.cells[cellKey(idx, 1)] = { raw: String(row[1]), style: { align: 'right' } };
      s.cells[cellKey(idx, 2)] = { raw: String(row[2]), style: { align: 'right' } };
      s.cells[cellKey(idx, 3)] = { raw: String(row[3]), style: { align: 'right' } };
      s.cells[cellKey(idx, 4)] = { raw: `=(D${rNum}-B${rNum})/B${rNum}`, style: { align: 'right', numFmt: 'percent', decimals: 1, bold: true, color: '#059669' } };
    });
    s.cells.A7 = { raw: '평균', style: { bold: true, bg: '#f1f5f9' } };
    s.cells.B7 = { raw: '=ROUND(AVERAGE(B1:B5),1)', style: { bold: true, align: 'right', bg: '#f1f5f9' } };
    s.cells.C7 = { raw: '=ROUND(AVERAGE(C1:C5),1)', style: { bold: true, align: 'right', bg: '#f1f5f9' } };
    s.cells.D7 = { raw: '=ROUND(AVERAGE(D1:D5),1)', style: { bold: true, align: 'right', bg: '#f1f5f9' } };
    s.cells.E7 = { raw: '=AVERAGE(E1:E5)', style: { bold: true, align: 'right', numFmt: 'percent', decimals: 1, bg: '#dcfce7', color: '#166534' } };
    s.colWidths = { 0: 76, 1: 96, 2: 102, 3: 102, 4: 88 };
    if (global.BrainOriginPlot) {
      const cfg = global.BrainOriginPlot.createDefaultPlotConfig();
      cfg.title = '시편별 인장강도 비교 (MPa)';
      cfg.plotType = 'bar';
      cfg.showGrid = true;
      cfg.yAxis.min = '0';
      cfg.yAxis.max = '550';
      cfg.legendPos = { x: 0.04, y: 0.04 };
      cfg.seriesStyles[1] = { color: '#64748b', symbol: 'square', symbolSize: 4.5, lineWidth: 1.5, lineStyle: 'solid', yAxis: 'y1', visible: true };
      cfg.seriesStyles[2] = { color: '#2563eb', symbol: 'square', symbolSize: 4.5, lineWidth: 1.5, lineStyle: 'solid', yAxis: 'y1', visible: true };
      cfg.seriesStyles[3] = { color: '#059669', symbol: 'square', symbolSize: 4.5, lineWidth: 1.5, lineStyle: 'solid', yAxis: 'y1', visible: true };
      cfg.annotations = [{
        id: 'txt-bar-1',
        text: '열처리 개선 시편:\n평균 인장강도 +46.0% 향상',
        x: 0.48, y: 0.13, fontSize: 10.5, color: '#059669', bold: true, hasBox: true
      }];
      s.plotConfig = cfg;
    }
    return wb;
  }

  function normalizeWorkbook(wb) {
    if (!wb || !Array.isArray(wb.sheets) || wb.sheets.length === 0) {
      return createEmptyWorkbook();
    }
    const sheets = wb.sheets.map((s, idx) => {
      const colMeta = s?.colMeta && typeof s.colMeta === 'object' ? s.colMeta : { 0: { longName: '', units: '', comments: '', role: 'X' } };
      const freeze = s?.freeze && typeof s.freeze === 'object'
        ? { rows: Math.max(0, Math.trunc(Number(s.freeze.rows) || 0)), cols: Math.max(0, Math.trunc(Number(s.freeze.cols) || 0)) }
        : { rows: 0, cols: 0 };
      return {
        name: String(s?.name || `Sheet${idx + 1}`).trim() || `Sheet${idx + 1}`,
        rows: Math.max(DEFAULT_ROWS, Number(s?.rows) || DEFAULT_ROWS),
        cols: Math.max(DEFAULT_COLS, Number(s?.cols) || DEFAULT_COLS),
        cells: s?.cells && typeof s.cells === 'object' ? s.cells : {},
        colWidths: s?.colWidths && typeof s.colWidths === 'object' ? s.colWidths : {},
        colMeta,
        filterEnabled: Boolean(s?.filterEnabled),
        columnFilters: s?.columnFilters && typeof s.columnFilters === 'object' ? s.columnFilters : {},
        freeze,
        merges: Array.isArray(s?.merges) ? s.merges.filter((m) => m && typeof m.r1 === 'number') : [],
        plotConfig: global.BrainOriginPlot
          ? global.BrainOriginPlot.mergePlotConfig(s?.plotConfig)
          : (s?.plotConfig || null)
      };
    });
    const activeSheet = Math.max(0, Math.min(sheets.length - 1, Number(wb.activeSheet) || 0));
    const namedRanges = wb?.namedRanges && typeof wb.namedRanges === 'object' ? { ...wb.namedRanges } : {};
    return { version: 3, activeSheet, namedRanges, sheets };
  }

  function getColMeta(sheet, colIdx) {
    if (!sheet.colMeta) sheet.colMeta = {};
    const m = sheet.colMeta[colIdx] || {};
    return {
      longName: String(m.longName || ''),
      units: String(m.units || ''),
      comments: String(m.comments || ''),
      role: m.role !== undefined ? String(m.role) : (colIdx === 0 ? 'X' : 'Y')
    };
  }

  // ================= SheetJS Lazy Loader =================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`SheetJS 로드 실패: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureSheetJS() {
    if (global.XLSX) return global.XLSX;
    if (!sheetJsLoadPromise) {
      sheetJsLoadPromise = (async () => {
        let lastErr = null;
        for (const url of SHEETJS_URLS) {
          try {
            await loadScript(url);
            if (global.XLSX) return global.XLSX;
          } catch (err) {
            lastErr = err;
          }
        }
        sheetJsLoadPromise = null;
        throw lastErr || new Error('SheetJS 라이브러리를 불러올 수 없습니다. 오프라인 상태에서는 CSV/JSON 입출력을 이용해 주세요.');
      })();
    }
    return sheetJsLoadPromise;
  }

  // ================= CSV / TSV / XLSX Import & Export (IO-01) =================
  function detectDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).slice(0, 5).join('\n');
    const tabCount = (sample.match(/\t/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    const semiCount = (sample.match(/;/g) || []).length;
    if (tabCount > commaCount && tabCount >= semiCount) return '\t';
    if (semiCount > commaCount && semiCount > tabCount) return ';';
    return ',';
  }

  function parseDelimitedText(rawText, delimiter = null) {
    const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sep = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === sep) {
          row.push(field);
          field = '';
        } else if (ch === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else {
          field += ch;
        }
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function parseCsvToWorkbook(csvText, sheetName = 'Sheet1') {
    const parsedRows = parseDelimitedText(csvText);
    const maxCols = parsedRows.reduce((m, r) => Math.max(m, r.length), 0);
    const sheet = createEmptySheet(
      sheetName,
      Math.max(DEFAULT_ROWS, parsedRows.length + 10),
      Math.max(DEFAULT_COLS, maxCols + 4)
    );
    parsedRows.forEach((r, rIdx) => {
      r.forEach((val, cIdx) => {
        if (val !== '') {
          sheet.cells[cellKey(rIdx, cIdx)] = { raw: val };
        }
      });
    });
    return normalizeWorkbook({ version: 2, activeSheet: 0, sheets: [sheet] });
  }

  function formatDateYMD(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async function parseArrayBufferToWorkbook(arrayBuffer, fileName = '') {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
      const dec = new TextDecoder('utf-8');
      return parseCsvToWorkbook(dec.decode(arrayBuffer), fileName.replace(/\.(csv|tsv|txt)$/i, '') || 'Sheet1');
    }

    const XLSX = await ensureSheetJS();
    const xlsxWb = XLSX.read(new Uint8Array(arrayBuffer), {
      type: 'array',
      cellFormula: true,
      cellDates: true,
      cellNF: true
    });

    const sheets = (xlsxWb.SheetNames || []).map((name) => {
      const ws = xlsxWb.Sheets[name];
      const ref = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
      const numRows = Math.max(DEFAULT_ROWS, ref.e.r + 12);
      const numCols = Math.max(DEFAULT_COLS, ref.e.c + 6);
      const sheet = createEmptySheet(name, numRows, numCols);

      if (ws && Array.isArray(ws['!cols'])) {
        ws['!cols'].forEach((cInfo, idx) => {
          if (cInfo && (cInfo.wpx || cInfo.wch)) {
            sheet.colWidths[idx] = Math.max(54, Math.min(360, Math.round(cInfo.wpx || cInfo.wch * 8.2)));
          }
        });
      }

      if (ws) {
        Object.keys(ws).forEach((addr) => {
          if (addr.startsWith('!')) return;
          const c = ws[addr];
          if (!c) return;
          let raw = '';
          const style = {};
          if (c.f) {
            raw = `=${c.f}`;
          } else if (c.v instanceof Date) {
            raw = formatDateYMD(c.v);
            style.numFmt = 'date';
          } else if (c.t === 'b') {
            raw = c.v ? 'TRUE' : 'FALSE';
          } else if (c.v !== undefined && c.v !== null) {
            raw = String(c.v);
          }

          if (c.z && typeof c.z === 'string') {
            if (c.z.includes('%')) style.numFmt = 'percent';
            else if (c.z.includes('₩') || c.z.includes('\\')) style.numFmt = 'currency';
            else if (c.z.includes('$')) style.numFmt = 'usd';
            else if (c.z.includes('#,##0')) style.numFmt = 'number';
          }

          if (raw !== '') {
            sheet.cells[addr.toUpperCase()] = Object.keys(style).length > 0 ? { raw, style } : { raw };
          }
        });
      }
      return sheet;
    });

    return normalizeWorkbook({ version: 2, activeSheet: 0, sheets });
  }

  // ================= Formula Engine (FM-01, FM-02) =================
  function makeErr(code) {
    return { __err: code };
  }

  function isErr(v) {
    return Boolean(v && typeof v === 'object' && typeof v.__err === 'string');
  }

  function isBlank(v) {
    return v === null || v === undefined || v === '';
  }

  function parseDateLike(val) {
    if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0 && val < 2958466) {
      const ms = (val - 25569) * 86400000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
    }
    if (typeof val === 'string') {
      const s = val.trim();
      const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (iso) {
        const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  function dateToSerial(dateObj) {
    const utc = Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    return Math.floor(utc / 86400000) + 25569;
  }

  function toNumber(v) {
    if (isErr(v)) return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : makeErr('#NUM!');
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isBlank(v)) return 0;
    if (typeof v === 'string') {
      const cleaned = v.trim().replace(/,/g, '');
      if (cleaned === '') return 0;
      if (/^[+-]?\d+(\.\d+)?%$/.test(cleaned)) {
        return parseFloat(cleaned.slice(0, -1)) / 100;
      }
      if (/^[₩$€£]\s*[+-]?\d+(\.\d+)?$/.test(cleaned)) {
        return parseFloat(cleaned.slice(1).trim());
      }
      const n = Number(cleaned);
      if (!Number.isNaN(n) && Number.isFinite(n)) return n;
      const d = parseDateLike(cleaned);
      if (d) return dateToSerial(d);
    }
    return makeErr('#VALUE!');
  }

  function toStrictNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim().replace(/,/g, '');
      if (s === '') return null;
      if (/^[+-]?\d+(\.\d+)?%$/.test(s)) return parseFloat(s.slice(0, -1)) / 100;
      if (/^[₩$€£]\s*[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s.slice(1).trim());
      if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) {
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  }

  function toBool(v) {
    if (isErr(v)) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const up = v.trim().toUpperCase();
      if (up === 'TRUE') return true;
      if (up === 'FALSE' || up === '') return false;
      return makeErr('#VALUE!');
    }
    return false;
  }

  function toText(v) {
    if (isErr(v)) return v.__err;
    if (isBlank(v)) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function compareValues(a, b) {
    if (isErr(a) || isErr(b)) return NaN;
    const na = typeof a === 'number' ? a : (isBlank(a) && typeof b === 'number' ? 0 : null);
    const nb = typeof b === 'number' ? b : (isBlank(b) && typeof a === 'number' ? 0 : null);
    if (na !== null && nb !== null) {
      return na === nb ? 0 : (na < nb ? -1 : 1);
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a === b ? 0 : (a ? 1 : -1);
    }
    const sa = toText(a).toLowerCase();
    const sb = toText(b).toLowerCase();
    return sa === sb ? 0 : (sa < sb ? -1 : 1);
  }

  function matchesCriteria(val, criteria) {
    if (isErr(val)) return false;
    if (typeof criteria === 'number' || typeof criteria === 'boolean') {
      return compareValues(val, criteria) === 0;
    }
    const critStr = String(criteria ?? '').trim();
    const opMatch = critStr.match(/^(>=|<=|<>|!=|=|>|<)(.*)$/);
    if (opMatch) {
      const op = opMatch[1];
      const rhsRaw = opMatch[2].trim();
      const rhsNum = toStrictNumber(rhsRaw);
      const lhsNum = toStrictNumber(val);
      const cmp = rhsNum !== null && lhsNum !== null
        ? (lhsNum === rhsNum ? 0 : (lhsNum < rhsNum ? -1 : 1))
        : compareValues(val, rhsRaw);
      if (Number.isNaN(cmp)) return false;
      if (op === '=') return cmp === 0;
      if (op === '<>' || op === '!=') return cmp !== 0;
      if (op === '>') return cmp > 0;
      if (op === '>=') return cmp >= 0;
      if (op === '<') return cmp < 0;
      if (op === '<=') return cmp <= 0;
    }
    if (critStr.includes('*') || critStr.includes('?')) {
      const escaped = critStr
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${escaped}$`, 'i').test(toText(val));
    }
    const numCrit = toStrictNumber(critStr);
    const numVal = toStrictNumber(val);
    if (numCrit !== null && numVal !== null) return numVal === numCrit;
    return toText(val).toLowerCase() === critStr.toLowerCase();
  }

  function tokenizeFormula(expr) {
    const tokens = [];
    let i = 0;
    const len = expr.length;

    while (i < len) {
      const ch = expr[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      if (ch === '"') {
        let str = '';
        i++;
        while (i < len) {
          if (expr[i] === '"') {
            if (expr[i + 1] === '"') { str += '"'; i += 2; }
            else { i++; break; }
          } else {
            str += expr[i++];
          }
        }
        tokens.push({ type: 'STRING', value: str });
        continue;
      }

      if (ch === "'") {
        let sheetName = '';
        i++;
        while (i < len) {
          if (expr[i] === "'") {
            if (expr[i + 1] === "'") { sheetName += "'"; i += 2; }
            else { i++; break; }
          } else {
            sheetName += expr[i++];
          }
        }
        if (expr[i] === '!') {
          i++;
          const rest = expr.slice(i);
          const refMatch = rest.match(/^(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/);
          if (refMatch) {
            i += refMatch[1].length;
            tokens.push({ type: 'REF', sheet: sheetName, value: refMatch[1] });
            continue;
          }
        }
        tokens.push({ type: 'ERR', value: '#REF!' });
        continue;
      }

      if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] || ''))) {
        let numStr = '';
        while (i < len && /[\d.]/.test(expr[i])) numStr += expr[i++];
        if (i < len && (expr[i] === 'e' || expr[i] === 'E') && /[+-]?\d/.test(expr.slice(i + 1, i + 3))) {
          numStr += expr[i++];
          if (expr[i] === '+' || expr[i] === '-') numStr += expr[i++];
          while (i < len && /\d/.test(expr[i])) numStr += expr[i++];
        }
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
        continue;
      }

      const two = expr.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
        tokens.push({ type: 'OP', value: two === '!=' ? '<>' : two });
        i += 2;
        continue;
      }

      if ('+-*/^&=<>%'.includes(ch)) {
        tokens.push({ type: 'OP', value: ch });
        i++;
        continue;
      }
      if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
      if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
      if (ch === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }
      if (ch === ':') { tokens.push({ type: 'COLON', value: ':' }); i++; continue; }

      const rest = expr.slice(i);
      const sheetRefMatch = rest.match(/^([A-Za-z0-9_가-힣]+)!\s*(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/);
      if (sheetRefMatch) {
        i += sheetRefMatch[0].length;
        tokens.push({ type: 'REF', sheet: sheetRefMatch[1], value: sheetRefMatch[2] });
        continue;
      }

      const rangeOrCellMatch = rest.match(/^(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])/);
      if (rangeOrCellMatch) {
        i += rangeOrCellMatch[1].length;
        tokens.push({ type: 'REF', sheet: null, value: rangeOrCellMatch[1] });
        continue;
      }

      const identMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
      if (identMatch) {
        i += identMatch[1].length;
        const up = identMatch[1].toUpperCase();
        if (up === 'TRUE' || up === 'FALSE') {
          tokens.push({ type: 'BOOL', value: up === 'TRUE' });
        } else {
          tokens.push({ type: 'IDENT', value: up });
        }
        continue;
      }

      const errMatch = rest.match(/^(#[A-Z0-9/]+[!?]?)/);
      if (errMatch) {
        i += errMatch[1].length;
        tokens.push({ type: 'ERR', value: errMatch[1] });
        continue;
      }

      throw new Error('#ERROR!');
    }

    return tokens;
  }

  function parseFormulaTokens(tokens) {
    let pos = 0;
    const peek = () => tokens[pos] || null;
    const consume = () => tokens[pos++];

    function parseComparison() {
      let left = parseConcat();
      while (peek() && peek().type === 'OP' && ['=', '<>', '<', '<=', '>', '>='].includes(peek().value)) {
        const op = consume().value;
        const right = parseConcat();
        left = { type: 'BIN', op, left, right };
      }
      return left;
    }
    function parseConcat() {
      let left = parseAddSub();
      while (peek() && peek().type === 'OP' && peek().value === '&') {
        const op = consume().value;
        const right = parseAddSub();
        left = { type: 'BIN', op, left, right };
      }
      return left;
    }
    function parseAddSub() {
      let left = parseMulDiv();
      while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        const right = parseMulDiv();
        left = { type: 'BIN', op, left, right };
      }
      return left;
    }
    function parseMulDiv() {
      let left = parsePower();
      while (peek() && peek().type === 'OP' && (peek().value === '*' || peek().value === '/')) {
        const op = consume().value;
        const right = parsePower();
        left = { type: 'BIN', op, left, right };
      }
      return left;
    }
    function parsePower() {
      let left = parseUnary();
      while (peek() && peek().type === 'OP' && peek().value === '^') {
        const op = consume().value;
        const right = parseUnary();
        left = { type: 'BIN', op, left, right };
      }
      return left;
    }
    function parseUnary() {
      if (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
        const op = consume().value;
        return { type: 'UNARY', op, arg: parseUnary() };
      }
      return parsePercent();
    }
    function parsePercent() {
      let node = parsePrimary();
      while (peek() && peek().type === 'OP' && peek().value === '%') {
        consume();
        node = { type: 'PERCENT', arg: node };
      }
      return node;
    }
    function parsePrimary() {
      const tok = peek();
      if (!tok) throw new Error('#ERROR!');
      if (tok.type === 'NUMBER' || tok.type === 'STRING' || tok.type === 'BOOL') {
        consume();
        return { type: 'LIT', value: tok.value };
      }
      if (tok.type === 'ERR') {
        consume();
        return { type: 'LIT', value: makeErr(tok.value) };
      }
      if (tok.type === 'REF') {
        consume();
        return { type: 'REF', sheet: tok.sheet, value: tok.value };
      }
      if (tok.type === 'IDENT') {
        consume();
        if (peek() && peek().type === 'LPAREN') {
          consume();
          const args = [];
          if (peek() && peek().type !== 'RPAREN') {
            while (true) {
              if (peek() && peek().type === 'COMMA') {
                args.push({ type: 'LIT', value: '' });
              } else if (peek() && peek().type === 'RPAREN') {
                args.push({ type: 'LIT', value: '' });
                break;
              } else {
                args.push(parseComparison());
              }
              if (peek() && peek().type === 'COMMA') consume();
              else break;
            }
          }
          if (!peek() || peek().type !== 'RPAREN') throw new Error('#ERROR!');
          consume();
          return { type: 'CALL', name: tok.value, args };
        }
        return { type: 'NAME', name: tok.value };
      }
      if (tok.type === 'LPAREN') {
        consume();
        const inner = parseComparison();
        if (!peek() || peek().type !== 'RPAREN') throw new Error('#ERROR!');
        consume();
        return inner;
      }
      throw new Error('#ERROR!');
    }

    const ast = parseComparison();
    if (pos < tokens.length) throw new Error('#ERROR!');
    return ast;
  }

  function createEvaluator(workbook) {
    const cache = new Map();
    const visiting = new Set();

    function findSheetIndex(name, defaultIdx) {
      if (!name) return defaultIdx;
      const target = String(name).trim().toLowerCase();
      return workbook.sheets.findIndex((s) => s.name.toLowerCase() === target);
    }

    function parseRawLiteral(raw) {
      if (raw === null || raw === undefined || raw === '') return '';
      const s = String(raw);
      const trimmed = s.trim();
      if (trimmed === '') return '';
      if (trimmed.toUpperCase() === 'TRUE') return true;
      if (trimmed.toUpperCase() === 'FALSE') return false;
      const num = toStrictNumber(trimmed);
      if (num !== null) return num;
      return s;
    }

    function evalCell(sheetIdx, addr) {
      const upperAddr = String(addr).toUpperCase();
      const cacheKey = `${sheetIdx}:${upperAddr}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      if (visiting.has(cacheKey)) return makeErr('#CYCLE!');

      const sheet = workbook.sheets[sheetIdx];
      if (!sheet) return makeErr('#REF!');
      const cell = sheet.cells[upperAddr];
      if (!cell || cell.raw === undefined || cell.raw === null || cell.raw === '') {
        cache.set(cacheKey, '');
        return '';
      }

      const raw = String(cell.raw);
      if (!raw.startsWith('=')) {
        const val = parseRawLiteral(raw);
        cache.set(cacheKey, val);
        return val;
      }

      visiting.add(cacheKey);
      let result;
      try {
        const expr = raw.slice(1).trim();
        if (!expr) {
          result = '';
        } else {
          const tokens = tokenizeFormula(expr);
          const ast = parseFormulaTokens(tokens);
          const parsedSelf = parseCellRef(upperAddr) || { row: 0, col: 0 };
          result = evalNode(ast, { sheetIdx, row: parsedSelf.row, col: parsedSelf.col });
          if (result && result.__range) {
            result = result.matrix[0]?.[0] ?? '';
          }
        }
      } catch (e) {
        const code = e && typeof e.message === 'string' && e.message.startsWith('#') ? e.message : '#ERROR!';
        result = makeErr(code);
      } finally {
        visiting.delete(cacheKey);
      }

      cache.set(cacheKey, result);
      return result;
    }

    function resolveRef(sheetName, refStr, currentSheetIdx) {
      const targetIdx = findSheetIndex(sheetName, currentSheetIdx);
      if (targetIdx < 0) return makeErr('#REF!');

      if (refStr.includes(':')) {
        const [a, b] = refStr.split(':');
        const p1 = parseCellRef(a);
        const p2 = parseCellRef(b);
        if (!p1 || !p2) return makeErr('#REF!');
        const r1 = Math.min(p1.row, p2.row);
        const r2 = Math.max(p1.row, p2.row);
        const c1 = Math.min(p1.col, p2.col);
        const c2 = Math.max(p1.col, p2.col);
        if ((r2 - r1 + 1) * (c2 - c1 + 1) > 50000) return makeErr('#REF!');
        const matrix = [];
        for (let r = r1; r <= r2; r++) {
          const rowVals = [];
          for (let c = c1; c <= c2; c++) {
            rowVals.push(evalCell(targetIdx, cellKey(r, c)));
          }
          matrix.push(rowVals);
        }
        return { __range: true, sheetIdx: targetIdx, r1, r2, c1, c2, matrix };
      }

      const p = parseCellRef(refStr);
      if (!p) return makeErr('#REF!');
      return evalCell(targetIdx, cellKey(p.row, p.col));
    }

    function flattenArgs(argNodes, ctx) {
      const vals = [];
      for (const node of argNodes) {
        const v = evalNode(node, ctx);
        if (v && v.__range) {
          for (const row of v.matrix) for (const cellVal of row) vals.push(cellVal);
        } else {
          vals.push(v);
        }
      }
      return vals;
    }

    function collectNumbers(argNodes, ctx) {
      const nums = [];
      for (const node of argNodes) {
        const v = evalNode(node, ctx);
        if (v && v.__range) {
          for (const row of v.matrix) {
            for (const c of row) {
              if (isErr(c)) return c;
              if (typeof c === 'number' && Number.isFinite(c)) nums.push(c);
            }
          }
        } else {
          if (isErr(v)) return v;
          if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
          else if (typeof v === 'boolean') nums.push(v ? 1 : 0);
          else if (typeof v === 'string' && v.trim() !== '') {
            const n = toStrictNumber(v);
            if (n !== null) nums.push(n);
          }
        }
      }
      return nums;
    }

    function evalScalar(node, ctx) {
      const v = evalNode(node, ctx);
      if (v && v.__range) return v.matrix[0]?.[0] ?? '';
      return v;
    }

    function evalRangeFlat(node, ctx) {
      const v = evalNode(node, ctx);
      if (isErr(v)) return v;
      if (v && v.__range) {
        const out = [];
        for (const r of v.matrix) for (const c of r) out.push(c);
        return out;
      }
      return [v];
    }

    function evalNode(node, ctx) {
      if (!node) return '';
      if (node.type === 'LIT') return node.value;
      if (node.type === 'NAME') {
        const nr = workbook.namedRanges || {};
        const key = Object.keys(nr).find((k) => k.toUpperCase() === node.name.toUpperCase());
        if (!key) return makeErr('#NAME?');
        const refVal = String(nr[key] || '').trim().replace(/^=/, '');
        const bangIdx = refVal.indexOf('!');
        if (bangIdx > 0) {
          const sh = refVal.slice(0, bangIdx).replace(/^'|'$/g, '');
          return resolveRef(sh, refVal.slice(bangIdx + 1), ctx.sheetIdx);
        }
        return resolveRef(null, refVal, ctx.sheetIdx);
      }
      if (node.type === 'REF') return resolveRef(node.sheet, node.value, ctx.sheetIdx);
      if (node.type === 'UNARY') {
        const n = toNumber(evalScalar(node.arg, ctx));
        return isErr(n) ? n : (node.op === '-' ? -n : n);
      }
      if (node.type === 'PERCENT') {
        const n = toNumber(evalScalar(node.arg, ctx));
        return isErr(n) ? n : n / 100;
      }
      if (node.type === 'BIN') {
        const l = evalScalar(node.left, ctx);
        if (isErr(l)) return l;
        const r = evalScalar(node.right, ctx);
        if (isErr(r)) return r;
        if (node.op === '&') return toText(l) + toText(r);
        if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) {
          const cmp = compareValues(l, r);
          if (Number.isNaN(cmp)) return makeErr('#VALUE!');
          if (node.op === '=') return cmp === 0;
          if (node.op === '<>') return cmp !== 0;
          if (node.op === '<') return cmp < 0;
          if (node.op === '<=') return cmp <= 0;
          if (node.op === '>') return cmp > 0;
          if (node.op === '>=') return cmp >= 0;
        }
        const ln = toNumber(l);
        if (isErr(ln)) return ln;
        const rn = toNumber(r);
        if (isErr(rn)) return rn;
        if (node.op === '+') return ln + rn;
        if (node.op === '-') return ln - rn;
        if (node.op === '*') return ln * rn;
        if (node.op === '/') return rn === 0 ? makeErr('#DIV/0!') : ln / rn;
        if (node.op === '^') {
          const res = Math.pow(ln, rn);
          return Number.isFinite(res) ? res : makeErr('#NUM!');
        }
        return makeErr('#ERROR!');
      }
      if (node.type === 'CALL') return evalFunction(node.name, node.args, ctx);
      return makeErr('#ERROR!');
    }

    function evalFunction(name, args, ctx) {
      switch (name) {
        // ---- Logical ----
        case 'IF': {
          if (args.length < 2) return makeErr('#VALUE!');
          const cond = toBool(evalScalar(args[0], ctx));
          if (isErr(cond)) return cond;
          if (cond) return evalScalar(args[1], ctx);
          return args.length >= 3 ? evalScalar(args[2], ctx) : false;
        }
        case 'IFS': {
          for (let i = 0; i + 1 < args.length; i += 2) {
            const cond = toBool(evalScalar(args[i], ctx));
            if (isErr(cond)) return cond;
            if (cond) return evalScalar(args[i + 1], ctx);
          }
          return makeErr('#N/A');
        }
        case 'IFERROR': {
          if (args.length < 2) return makeErr('#VALUE!');
          const v = evalScalar(args[0], ctx);
          return isErr(v) ? evalScalar(args[1], ctx) : v;
        }
        case 'IFNA': {
          if (args.length < 2) return makeErr('#VALUE!');
          const v = evalScalar(args[0], ctx);
          return isErr(v) && v.__err === '#N/A' ? evalScalar(args[1], ctx) : v;
        }
        case 'SWITCH': {
          if (args.length < 3) return makeErr('#VALUE!');
          const target = evalScalar(args[0], ctx);
          if (isErr(target)) return target;
          let i = 1;
          for (; i + 1 < args.length; i += 2) {
            const cand = evalScalar(args[i], ctx);
            if (!isErr(cand) && compareValues(target, cand) === 0) return evalScalar(args[i + 1], ctx);
          }
          if (i < args.length) return evalScalar(args[i], ctx);
          return makeErr('#N/A');
        }
        case 'AND': {
          const flat = flattenArgs(args, ctx);
          let hasBool = false;
          for (const v of flat) {
            if (isErr(v)) return v;
            if (isBlank(v)) continue;
            const b = toBool(v);
            if (isErr(b)) continue;
            hasBool = true;
            if (!b) return false;
          }
          return hasBool ? true : makeErr('#VALUE!');
        }
        case 'OR': {
          const flat = flattenArgs(args, ctx);
          let hasBool = false;
          for (const v of flat) {
            if (isErr(v)) return v;
            if (isBlank(v)) continue;
            const b = toBool(v);
            if (isErr(b)) continue;
            hasBool = true;
            if (b) return true;
          }
          return hasBool ? false : makeErr('#VALUE!');
        }
        case 'XOR': {
          const flat = flattenArgs(args, ctx);
          let trues = 0;
          for (const v of flat) {
            if (isErr(v)) return v;
            if (isBlank(v)) continue;
            const b = toBool(v);
            if (!isErr(b) && b) trues++;
          }
          return trues % 2 === 1;
        }
        case 'NOT': {
          if (args.length < 1) return makeErr('#VALUE!');
          const b = toBool(evalScalar(args[0], ctx));
          return isErr(b) ? b : !b;
        }
        case 'TRUE': return true;
        case 'FALSE': return false;

        // ---- Stats & Aggregation ----
        case 'SUM': {
          const nums = collectNumbers(args, ctx);
          return isErr(nums) ? nums : nums.reduce((a, b) => a + b, 0);
        }
        case 'AVERAGE': {
          const nums = collectNumbers(args, ctx);
          if (isErr(nums)) return nums;
          return nums.length === 0 ? makeErr('#DIV/0!') : nums.reduce((a, b) => a + b, 0) / nums.length;
        }
        case 'COUNT': {
          return flattenArgs(args, ctx).filter((v) => typeof v === 'number' && Number.isFinite(v)).length;
        }
        case 'COUNTA': {
          return flattenArgs(args, ctx).filter((v) => !isBlank(v)).length;
        }
        case 'COUNTBLANK': {
          return flattenArgs(args, ctx).filter((v) => isBlank(v)).length;
        }
        case 'MIN': {
          const nums = collectNumbers(args, ctx);
          return isErr(nums) ? nums : (nums.length === 0 ? 0 : Math.min(...nums));
        }
        case 'MAX': {
          const nums = collectNumbers(args, ctx);
          return isErr(nums) ? nums : (nums.length === 0 ? 0 : Math.max(...nums));
        }
        case 'MEDIAN': {
          const nums = collectNumbers(args, ctx);
          if (isErr(nums)) return nums;
          if (nums.length === 0) return makeErr('#NUM!');
          const sorted = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        }
        case 'PRODUCT': {
          const nums = collectNumbers(args, ctx);
          return isErr(nums) ? nums : (nums.length === 0 ? 0 : nums.reduce((a, b) => a * b, 1));
        }
        case 'SUMPRODUCT': {
          if (args.length === 0) return makeErr('#VALUE!');
          const arrays = args.map((a) => evalRangeFlat(a, ctx));
          for (const arr of arrays) if (isErr(arr)) return arr;
          const len = arrays[0].length;
          if (arrays.some((a) => a.length !== len)) return makeErr('#VALUE!');
          let sum = 0;
          for (let i = 0; i < len; i++) {
            let prod = 1;
            for (const arr of arrays) {
              const v = arr[i];
              if (isErr(v)) return v;
              prod *= typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : 0);
            }
            sum += prod;
          }
          return sum;
        }
        case 'STDEV':
        case 'STDEV.S':
        case 'VAR':
        case 'VAR.S':
        case 'STDEVP':
        case 'STDEV.P':
        case 'VARP':
        case 'VAR.P': {
          const nums = collectNumbers(args, ctx);
          if (isErr(nums)) return nums;
          const isPop = name.endsWith('P');
          if (nums.length < (isPop ? 1 : 2)) return makeErr('#DIV/0!');
          const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
          const sq = nums.reduce((a, b) => a + (b - mean) ** 2, 0);
          const variance = sq / (isPop ? nums.length : nums.length - 1);
          return name.startsWith('VAR') ? variance : Math.sqrt(variance);
        }
        case 'LARGE':
        case 'SMALL': {
          if (args.length < 2) return makeErr('#VALUE!');
          const nums = collectNumbers([args[0]], ctx);
          if (isErr(nums)) return nums;
          const k = toNumber(evalScalar(args[1], ctx));
          if (isErr(k)) return k;
          const idx = Math.floor(k) - 1;
          if (idx < 0 || idx >= nums.length) return makeErr('#NUM!');
          const sorted = [...nums].sort((a, b) => (name === 'LARGE' ? b - a : a - b));
          return sorted[idx];
        }
        case 'RANK':
        case 'RANK.EQ': {
          if (args.length < 2) return makeErr('#VALUE!');
          const target = toNumber(evalScalar(args[0], ctx));
          if (isErr(target)) return target;
          const nums = collectNumbers([args[1]], ctx);
          if (isErr(nums)) return nums;
          const order = args[2] ? toNumber(evalScalar(args[2], ctx)) : 0;
          if (isErr(order)) return order;
          const sorted = [...nums].sort((a, b) => (order ? a - b : b - a));
          const pos = sorted.indexOf(target);
          return pos < 0 ? makeErr('#N/A') : pos + 1;
        }

        // ---- Engineering Math & Trig (FM-02) ----
        case 'SIN': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.sin(n); }
        case 'COS': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.cos(n); }
        case 'TAN': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.tan(n); }
        case 'ASIN': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          return (n < -1 || n > 1) ? makeErr('#NUM!') : Math.asin(n);
        }
        case 'ACOS': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          return (n < -1 || n > 1) ? makeErr('#NUM!') : Math.acos(n);
        }
        case 'ATAN': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.atan(n); }
        case 'ATAN2': {
          if (args.length < 2) return makeErr('#VALUE!');
          const x = toNumber(evalScalar(args[0], ctx));
          const y = toNumber(evalScalar(args[1], ctx));
          if (isErr(x)) return x;
          if (isErr(y)) return y;
          return (x === 0 && y === 0) ? makeErr('#DIV/0!') : Math.atan2(y, x);
        }
        case 'SINH': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.sinh(n); }
        case 'COSH': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.cosh(n); }
        case 'TANH': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.tanh(n); }
        case 'RADIANS': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : (n * Math.PI) / 180; }
        case 'DEGREES': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : (n * 180) / Math.PI; }
        case 'FACT': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          const k = Math.trunc(n);
          if (k < 0 || k > 170) return makeErr('#NUM!');
          let f = 1;
          for (let i = 2; i <= k; i++) f *= i;
          return f;
        }
        case 'ROUND':
        case 'ROUNDUP':
        case 'ROUNDDOWN': {
          if (args.length < 1) return makeErr('#VALUE!');
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          const digits = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 0;
          if (isErr(digits)) return digits;
          const factor = Math.pow(10, Math.trunc(digits));
          if (name === 'ROUND') return Math.round((n + Number.EPSILON) * factor) / factor;
          if (name === 'ROUNDUP') return (n >= 0 ? Math.ceil(n * factor) : Math.floor(n * factor)) / factor;
          return Math.trunc(n * factor) / factor;
        }
        case 'INT': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.floor(n); }
        case 'TRUNC': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          const digits = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 0;
          if (isErr(digits)) return digits;
          const factor = Math.pow(10, Math.trunc(digits));
          return Math.trunc(n * factor) / factor;
        }
        case 'ABS': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.abs(n); }
        case 'SIGN': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.sign(n); }
        case 'MOD': {
          if (args.length < 2) return makeErr('#VALUE!');
          const a = toNumber(evalScalar(args[0], ctx));
          const b = toNumber(evalScalar(args[1], ctx));
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          return b === 0 ? makeErr('#DIV/0!') : ((a % b) + b) % b;
        }
        case 'SQRT': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          return n < 0 ? makeErr('#NUM!') : Math.sqrt(n);
        }
        case 'POWER': {
          if (args.length < 2) return makeErr('#VALUE!');
          const a = toNumber(evalScalar(args[0], ctx));
          const b = toNumber(evalScalar(args[1], ctx));
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          const res = Math.pow(a, b);
          return Number.isFinite(res) ? res : makeErr('#NUM!');
        }
        case 'EXP': { const n = toNumber(evalScalar(args[0], ctx)); return isErr(n) ? n : Math.exp(n); }
        case 'LN': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          return n <= 0 ? makeErr('#NUM!') : Math.log(n);
        }
        case 'LOG10': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          return n <= 0 ? makeErr('#NUM!') : Math.log10(n);
        }
        case 'LOG': {
          const n = toNumber(evalScalar(args[0], ctx));
          if (isErr(n)) return n;
          const base = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 10;
          if (isErr(base)) return base;
          if (n <= 0 || base <= 0 || base === 1) return makeErr('#NUM!');
          return Math.log(n) / Math.log(base);
        }
        case 'CEILING':
        case 'FLOOR': {
          if (args.length < 2) return makeErr('#VALUE!');
          const n = toNumber(evalScalar(args[0], ctx));
          const sig = toNumber(evalScalar(args[1], ctx));
          if (isErr(n)) return n;
          if (isErr(sig)) return sig;
          if (sig === 0) return name === 'FLOOR' ? makeErr('#DIV/0!') : 0;
          return name === 'CEILING' ? Math.ceil(n / sig) * sig : Math.floor(n / sig) * sig;
        }
        case 'PI': return Math.PI;
        case 'RAND': return Math.random();
        case 'RANDBETWEEN': {
          if (args.length < 2) return makeErr('#VALUE!');
          const lo = toNumber(evalScalar(args[0], ctx));
          const hi = toNumber(evalScalar(args[1], ctx));
          if (isErr(lo)) return lo;
          if (isErr(hi)) return hi;
          if (lo > hi) return makeErr('#NUM!');
          return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo);
        }

        // ---- Conditional Aggregation ----
        case 'COUNTIF': {
          if (args.length < 2) return makeErr('#VALUE!');
          const range = evalRangeFlat(args[0], ctx);
          if (isErr(range)) return range;
          const crit = evalScalar(args[1], ctx);
          if (isErr(crit)) return crit;
          return range.filter((v) => matchesCriteria(v, crit)).length;
        }
        case 'SUMIF':
        case 'AVERAGEIF': {
          if (args.length < 2) return makeErr('#VALUE!');
          const critRange = evalRangeFlat(args[0], ctx);
          if (isErr(critRange)) return critRange;
          const crit = evalScalar(args[1], ctx);
          if (isErr(crit)) return crit;
          const sumRange = args.length >= 3 ? evalRangeFlat(args[2], ctx) : critRange;
          if (isErr(sumRange)) return sumRange;
          let sum = 0, cnt = 0;
          for (let i = 0; i < critRange.length; i++) {
            if (matchesCriteria(critRange[i], crit)) {
              const v = sumRange[i];
              if (typeof v === 'number' && Number.isFinite(v)) { sum += v; cnt++; }
            }
          }
          return name === 'AVERAGEIF' ? (cnt === 0 ? makeErr('#DIV/0!') : sum / cnt) : sum;
        }
        case 'COUNTIFS': {
          if (args.length < 2 || args.length % 2 !== 0) return makeErr('#VALUE!');
          const pairs = [];
          for (let i = 0; i < args.length; i += 2) {
            const r = evalRangeFlat(args[i], ctx);
            if (isErr(r)) return r;
            const c = evalScalar(args[i + 1], ctx);
            if (isErr(c)) return c;
            pairs.push([r, c]);
          }
          let cnt = 0;
          for (let i = 0; i < pairs[0][0].length; i++) {
            if (pairs.every(([r, c]) => matchesCriteria(r[i], c))) cnt++;
          }
          return cnt;
        }
        case 'SUMIFS': {
          if (args.length < 3 || args.length % 2 === 0) return makeErr('#VALUE!');
          const sumRange = evalRangeFlat(args[0], ctx);
          if (isErr(sumRange)) return sumRange;
          const pairs = [];
          for (let i = 1; i < args.length; i += 2) {
            const r = evalRangeFlat(args[i], ctx);
            if (isErr(r)) return r;
            const c = evalScalar(args[i + 1], ctx);
            if (isErr(c)) return c;
            pairs.push([r, c]);
          }
          let sum = 0;
          for (let i = 0; i < sumRange.length; i++) {
            if (pairs.every(([r, c]) => matchesCriteria(r[i], c))) {
              const v = sumRange[i];
              if (typeof v === 'number' && Number.isFinite(v)) sum += v;
            }
          }
          return sum;
        }

        // ---- Lookup & Reference ----
        case 'VLOOKUP': {
          if (args.length < 3) return makeErr('#VALUE!');
          const lookup = evalScalar(args[0], ctx);
          if (isErr(lookup)) return lookup;
          const table = evalNode(args[1], ctx);
          if (isErr(table) || !table?.__range) return isErr(table) ? table : makeErr('#N/A');
          const colIdx = toNumber(evalScalar(args[2], ctx));
          if (isErr(colIdx)) return colIdx;
          const c = Math.trunc(colIdx) - 1;
          if (c < 0 || c >= (table.matrix[0]?.length || 0)) return makeErr('#REF!');
          const approx = args.length >= 4 ? toBool(evalScalar(args[3], ctx)) : true;
          if (isErr(approx)) return approx;
          if (!approx) {
            for (const row of table.matrix) if (compareValues(row[0], lookup) === 0) return row[c];
            return makeErr('#N/A');
          }
          let bestIdx = -1;
          for (let i = 0; i < table.matrix.length; i++) {
            if (compareValues(table.matrix[i][0], lookup) <= 0) bestIdx = i;
            else break;
          }
          return bestIdx >= 0 ? table.matrix[bestIdx][c] : makeErr('#N/A');
        }
        case 'HLOOKUP': {
          if (args.length < 3) return makeErr('#VALUE!');
          const lookup = evalScalar(args[0], ctx);
          if (isErr(lookup)) return lookup;
          const table = evalNode(args[1], ctx);
          if (isErr(table) || !table?.__range) return isErr(table) ? table : makeErr('#N/A');
          const rowIdx = toNumber(evalScalar(args[2], ctx));
          if (isErr(rowIdx)) return rowIdx;
          const r = Math.trunc(rowIdx) - 1;
          if (r < 0 || r >= table.matrix.length) return makeErr('#REF!');
          const approx = args.length >= 4 ? toBool(evalScalar(args[3], ctx)) : true;
          if (isErr(approx)) return approx;
          const header = table.matrix[0] || [];
          if (!approx) {
            for (let c = 0; c < header.length; c++) if (compareValues(header[c], lookup) === 0) return table.matrix[r][c];
            return makeErr('#N/A');
          }
          let bestIdx = -1;
          for (let c = 0; c < header.length; c++) {
            if (compareValues(header[c], lookup) <= 0) bestIdx = c;
            else break;
          }
          return bestIdx >= 0 ? table.matrix[r][bestIdx] : makeErr('#N/A');
        }
        case 'XLOOKUP': {
          if (args.length < 3) return makeErr('#VALUE!');
          const lookup = evalScalar(args[0], ctx);
          if (isErr(lookup)) return lookup;
          const lookupArr = evalRangeFlat(args[1], ctx);
          const returnArr = evalRangeFlat(args[2], ctx);
          if (isErr(lookupArr)) return lookupArr;
          if (isErr(returnArr)) return returnArr;
          const notFound = args.length >= 4 ? evalScalar(args[3], ctx) : makeErr('#N/A');
          const matchMode = args.length >= 5 ? toNumber(evalScalar(args[4], ctx)) : 0;
          if (isErr(matchMode)) return matchMode;
          for (let i = 0; i < lookupArr.length; i++) {
            const matched = matchMode === 2
              ? matchesCriteria(lookupArr[i], toText(lookup))
              : compareValues(lookupArr[i], lookup) === 0;
            if (matched) return i < returnArr.length ? returnArr[i] : '';
          }
          return notFound;
        }
        case 'INDEX': {
          if (args.length < 2) return makeErr('#VALUE!');
          const arr = evalNode(args[0], ctx);
          if (isErr(arr) || !arr?.__range) return isErr(arr) ? arr : makeErr('#REF!');
          const rNum = toNumber(evalScalar(args[1], ctx));
          if (isErr(rNum)) return rNum;
          const cNum = args.length >= 3 ? toNumber(evalScalar(args[2], ctx)) : 1;
          if (isErr(cNum)) return cNum;
          const r = Math.trunc(rNum) - 1;
          const c = Math.trunc(cNum) - 1;
          if (args.length === 2 && arr.matrix.length === 1 && arr.matrix[0].length > 1) {
            return (r < 0 || r >= arr.matrix[0].length) ? makeErr('#REF!') : arr.matrix[0][r];
          }
          if (r < 0 || r >= arr.matrix.length || c < 0 || c >= (arr.matrix[0]?.length || 0)) return makeErr('#REF!');
          return arr.matrix[r][c];
        }
        case 'MATCH': {
          if (args.length < 2) return makeErr('#VALUE!');
          const lookup = evalScalar(args[0], ctx);
          if (isErr(lookup)) return lookup;
          const arr = evalRangeFlat(args[1], ctx);
          if (isErr(arr)) return arr;
          const matchType = args.length >= 3 ? toNumber(evalScalar(args[2], ctx)) : 1;
          if (isErr(matchType)) return matchType;
          if (matchType === 0) {
            for (let i = 0; i < arr.length; i++) {
              if (typeof lookup === 'string' && (lookup.includes('*') || lookup.includes('?'))) {
                if (matchesCriteria(arr[i], lookup)) return i + 1;
              } else if (compareValues(arr[i], lookup) === 0) return i + 1;
            }
            return makeErr('#N/A');
          }
          let best = -1;
          for (let i = 0; i < arr.length; i++) {
            const cond = matchType > 0 ? compareValues(arr[i], lookup) <= 0 : compareValues(arr[i], lookup) >= 0;
            if (cond) best = i;
            else break;
          }
          return best >= 0 ? best + 1 : makeErr('#N/A');
        }
        case 'CHOOSE': {
          if (args.length < 2) return makeErr('#VALUE!');
          const idx = toNumber(evalScalar(args[0], ctx));
          if (isErr(idx)) return idx;
          const n = Math.trunc(idx);
          return (n < 1 || n >= args.length) ? makeErr('#VALUE!') : evalScalar(args[n], ctx);
        }
        case 'ROW': {
          if (args.length === 0) return ctx.row + 1;
          if (args[0].type === 'REF') {
            const p = parseCellRef(args[0].value.split(':')[0]);
            return p ? p.row + 1 : makeErr('#REF!');
          }
          return ctx.row + 1;
        }
        case 'COLUMN': {
          if (args.length === 0) return ctx.col + 1;
          if (args[0].type === 'REF') {
            const p = parseCellRef(args[0].value.split(':')[0]);
            return p ? p.col + 1 : makeErr('#REF!');
          }
          return ctx.col + 1;
        }
        case 'ROWS': { const v = evalNode(args[0], ctx); return isErr(v) ? v : (v?.__range ? v.matrix.length : 1); }
        case 'COLUMNS': { const v = evalNode(args[0], ctx); return isErr(v) ? v : (v?.__range ? (v.matrix[0]?.length || 0) : 1); }

        // ---- Text ----
        case 'CONCAT':
        case 'CONCATENATE': {
          const flat = flattenArgs(args, ctx);
          for (const v of flat) if (isErr(v)) return v;
          return flat.map((v) => toText(v)).join('');
        }
        case 'TEXTJOIN': {
          if (args.length < 3) return makeErr('#VALUE!');
          const delim = toText(evalScalar(args[0], ctx));
          const ignoreEmpty = toBool(evalScalar(args[1], ctx));
          if (isErr(ignoreEmpty)) return ignoreEmpty;
          const flat = flattenArgs(args.slice(2), ctx);
          for (const v of flat) if (isErr(v)) return v;
          return flat.map((v) => toText(v)).filter((s) => !(ignoreEmpty && s === '')).join(delim);
        }
        case 'LEFT': {
          const s = toText(evalScalar(args[0], ctx));
          const n = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 1;
          return isErr(n) ? n : (n < 0 ? makeErr('#VALUE!') : s.slice(0, Math.trunc(n)));
        }
        case 'RIGHT': {
          const s = toText(evalScalar(args[0], ctx));
          const n = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 1;
          if (isErr(n) || n < 0) return isErr(n) ? n : makeErr('#VALUE!');
          const cnt = Math.trunc(n);
          return cnt === 0 ? '' : s.slice(-cnt);
        }
        case 'MID': {
          if (args.length < 3) return makeErr('#VALUE!');
          const s = toText(evalScalar(args[0], ctx));
          const start = toNumber(evalScalar(args[1], ctx));
          const count = toNumber(evalScalar(args[2], ctx));
          if (isErr(start) || isErr(count) || start < 1 || count < 0) return makeErr('#VALUE!');
          return s.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(count));
        }
        case 'LEN': return toText(evalScalar(args[0], ctx)).length;
        case 'TRIM': return toText(evalScalar(args[0], ctx)).trim().replace(/\s+/g, ' ');
        case 'UPPER': return toText(evalScalar(args[0], ctx)).toUpperCase();
        case 'LOWER': return toText(evalScalar(args[0], ctx)).toLowerCase();
        case 'PROPER': return toText(evalScalar(args[0], ctx)).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        case 'FIND':
        case 'SEARCH': {
          if (args.length < 2) return makeErr('#VALUE!');
          const findStr = toText(evalScalar(args[0], ctx));
          const within = toText(evalScalar(args[1], ctx));
          const start = args.length >= 3 ? toNumber(evalScalar(args[2], ctx)) : 1;
          if (isErr(start)) return start;
          const idx = name === 'FIND'
            ? within.indexOf(findStr, Math.max(0, Math.trunc(start) - 1))
            : within.toLowerCase().indexOf(findStr.toLowerCase(), Math.max(0, Math.trunc(start) - 1));
          return idx < 0 ? makeErr('#VALUE!') : idx + 1;
        }
        case 'SUBSTITUTE': {
          if (args.length < 3) return makeErr('#VALUE!');
          const text = toText(evalScalar(args[0], ctx));
          const oldStr = toText(evalScalar(args[1], ctx));
          const newStr = toText(evalScalar(args[2], ctx));
          if (!oldStr) return text;
          if (args.length >= 4) {
            const nth = toNumber(evalScalar(args[3], ctx));
            if (isErr(nth) || nth < 1) return makeErr('#VALUE!');
            let count = 0, pos = 0;
            while ((pos = text.indexOf(oldStr, pos)) !== -1) {
              count++;
              if (count === Math.trunc(nth)) return text.slice(0, pos) + newStr + text.slice(pos + oldStr.length);
              pos += oldStr.length;
            }
            return text;
          }
          return text.split(oldStr).join(newStr);
        }
        case 'REPLACE': {
          if (args.length < 4) return makeErr('#VALUE!');
          const text = toText(evalScalar(args[0], ctx));
          const start = toNumber(evalScalar(args[1], ctx));
          const count = toNumber(evalScalar(args[2], ctx));
          const rep = toText(evalScalar(args[3], ctx));
          if (isErr(start) || isErr(count) || start < 1 || count < 0) return makeErr('#VALUE!');
          const sIdx = Math.trunc(start) - 1;
          return text.slice(0, sIdx) + rep + text.slice(sIdx + Math.trunc(count));
        }
        case 'REPT': {
          if (args.length < 2) return makeErr('#VALUE!');
          const text = toText(evalScalar(args[0], ctx));
          const times = toNumber(evalScalar(args[1], ctx));
          return (isErr(times) || times < 0 || times > 10000) ? makeErr('#VALUE!') : text.repeat(Math.trunc(times));
        }
        case 'VALUE': return toNumber(evalScalar(args[0], ctx));
        case 'TEXT': {
          if (args.length < 2) return makeErr('#VALUE!');
          const val = evalScalar(args[0], ctx);
          if (isErr(val)) return val;
          const fmt = toText(evalScalar(args[1], ctx));
          const d = parseDateLike(val);
          if (d && /[yMd]/i.test(fmt)) {
            return fmt
              .replace(/yyyy/gi, String(d.getFullYear()))
              .replace(/mm/gi, String(d.getMonth() + 1).padStart(2, '0'))
              .replace(/dd/gi, String(d.getDate()).padStart(2, '0'));
          }
          const n = toNumber(val);
          if (isErr(n)) return toText(val);
          if (fmt.includes('%')) {
            const dec = (fmt.match(/\.(0+)/) || ['', ''])[1].length;
            return `${(n * 100).toFixed(dec)}%`;
          }
          const dec = (fmt.match(/\.(0+)/) || ['', ''])[1].length;
          const formatted = fmt.includes(',')
            ? n.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
            : n.toFixed(dec);
          if (fmt.includes('₩')) return `₩${formatted}`;
          if (fmt.includes('$')) return `$${formatted}`;
          return formatted;
        }

        // ---- Date & Info ----
        case 'TODAY': return formatDateYMD(new Date());
        case 'NOW': {
          const now = new Date();
          return `${formatDateYMD(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }
        case 'DATE': {
          if (args.length < 3) return makeErr('#VALUE!');
          const y = toNumber(evalScalar(args[0], ctx));
          const m = toNumber(evalScalar(args[1], ctx));
          const d = toNumber(evalScalar(args[2], ctx));
          if (isErr(y) || isErr(m) || isErr(d)) return makeErr('#VALUE!');
          return formatDateYMD(new Date(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d)));
        }
        case 'YEAR':
        case 'MONTH':
        case 'DAY':
        case 'WEEKDAY': {
          const d = parseDateLike(evalScalar(args[0], ctx));
          if (!d) return makeErr('#VALUE!');
          if (name === 'YEAR') return d.getFullYear();
          if (name === 'MONTH') return d.getMonth() + 1;
          if (name === 'DAY') return d.getDate();
          const returnType = args.length >= 2 ? toNumber(evalScalar(args[1], ctx)) : 1;
          const jsDay = d.getDay();
          return returnType === 2 ? (jsDay === 0 ? 7 : jsDay) : jsDay + 1;
        }
        case 'DAYS': {
          if (args.length < 2) return makeErr('#VALUE!');
          const endD = parseDateLike(evalScalar(args[0], ctx));
          const startD = parseDateLike(evalScalar(args[1], ctx));
          return (!endD || !startD) ? makeErr('#VALUE!') : dateToSerial(endD) - dateToSerial(startD);
        }
        case 'DATEDIF': {
          if (args.length < 3) return makeErr('#VALUE!');
          const d1 = parseDateLike(evalScalar(args[0], ctx));
          const d2 = parseDateLike(evalScalar(args[1], ctx));
          const unit = toText(evalScalar(args[2], ctx)).toUpperCase();
          if (!d1 || !d2) return makeErr('#VALUE!');
          if (d1 > d2) return makeErr('#NUM!');
          if (unit === 'D') return dateToSerial(d2) - dateToSerial(d1);
          if (unit === 'Y') {
            let years = d2.getFullYear() - d1.getFullYear();
            if (d2.getMonth() < d1.getMonth() || (d2.getMonth() === d1.getMonth() && d2.getDate() < d1.getDate())) years--;
            return years;
          }
          if (unit === 'M') {
            let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
            if (d2.getDate() < d1.getDate()) months--;
            return months;
          }
          return makeErr('#NUM!');
        }
        case 'EOMONTH':
        case 'EDATE': {
          if (args.length < 2) return makeErr('#VALUE!');
          const d = parseDateLike(evalScalar(args[0], ctx));
          const months = toNumber(evalScalar(args[1], ctx));
          if (!d || isErr(months)) return makeErr('#VALUE!');
          const target = name === 'EOMONTH'
            ? new Date(d.getFullYear(), d.getMonth() + Math.trunc(months) + 1, 0)
            : new Date(d.getFullYear(), d.getMonth() + Math.trunc(months), d.getDate());
          return formatDateYMD(target);
        }
        case 'ISBLANK': return isBlank(evalScalar(args[0], ctx));
        case 'ISNUMBER': return typeof evalScalar(args[0], ctx) === 'number';
        case 'ISTEXT': return typeof evalScalar(args[0], ctx) === 'string' && evalScalar(args[0], ctx) !== '';
        case 'ISERROR': return isErr(evalScalar(args[0], ctx));
        case 'ISNA': { const v = evalScalar(args[0], ctx); return isErr(v) && v.__err === '#N/A'; }
        // Financial functions
        case 'PMT': {
          if (args.length < 3) return makeErr('#VALUE!');
          const rate = toNumber(evalScalar(args[0], ctx));
          const nper = toNumber(evalScalar(args[1], ctx));
          const pv = toNumber(evalScalar(args[2], ctx));
          const fv = args[3] ? toNumber(evalScalar(args[3], ctx)) : 0;
          const type = args[4] ? toNumber(evalScalar(args[4], ctx)) : 0;
          if ([rate, nper, pv, fv, type].some(isErr) || nper === 0) return makeErr('#NUM!');
          if (rate === 0) return -(pv + fv) / nper;
          const pvif = Math.pow(1 + rate, nper);
          let pmt = (rate / (pvif - 1)) * -(pv * pvif + fv);
          if (type === 1) pmt /= (1 + rate);
          return pmt;
        }
        case 'FV': {
          if (args.length < 3) return makeErr('#VALUE!');
          const rate = toNumber(evalScalar(args[0], ctx));
          const nper = toNumber(evalScalar(args[1], ctx));
          const pmt = toNumber(evalScalar(args[2], ctx));
          const pv = args[3] ? toNumber(evalScalar(args[3], ctx)) : 0;
          const type = args[4] ? toNumber(evalScalar(args[4], ctx)) : 0;
          if ([rate, nper, pmt, pv, type].some(isErr)) return makeErr('#VALUE!');
          if (rate === 0) return -(pv + pmt * nper);
          const f = Math.pow(1 + rate, nper);
          return -pv * f - pmt * (1 + rate * type) * (f - 1) / rate;
        }
        case 'PV': {
          if (args.length < 3) return makeErr('#VALUE!');
          const rate = toNumber(evalScalar(args[0], ctx));
          const nper = toNumber(evalScalar(args[1], ctx));
          const pmt = toNumber(evalScalar(args[2], ctx));
          const fv = args[3] ? toNumber(evalScalar(args[3], ctx)) : 0;
          const type = args[4] ? toNumber(evalScalar(args[4], ctx)) : 0;
          if ([rate, nper, pmt, fv, type].some(isErr)) return makeErr('#VALUE!');
          if (rate === 0) return -(fv + pmt * nper);
          const f = Math.pow(1 + rate, nper);
          return (-fv - pmt * (1 + rate * type) * (f - 1) / rate) / f;
        }
        case 'NPV': {
          if (args.length < 2) return makeErr('#VALUE!');
          const rate = toNumber(evalScalar(args[0], ctx));
          if (isErr(rate)) return rate;
          const cashFlows = collectNumbers(args.slice(1), ctx);
          if (isErr(cashFlows)) return cashFlows;
          let sum = 0;
          cashFlows.forEach((cf, idx) => { sum += cf / Math.pow(1 + rate, idx + 1); });
          return sum;
        }
        default: return makeErr('#NAME?');
      }
    }

    return {
      evalCell,
      clear() { cache.clear(); visiting.clear(); }
    };
  }

  // ================= Formula Shifters (Copy/Fill + GR-01 Insert/Delete) =================
  function shiftFormula(formula, dRow, dCol) {
    if (!formula || !String(formula).startsWith('=')) return formula;
    let out = '';
    let i = 0;
    const str = String(formula);
    while (i < str.length) {
      if (str[i] === '"' || str[i] === "'") {
        const q = str[i];
        out += str[i++];
        while (i < str.length) {
          out += str[i];
          if (str[i] === q) {
            i++;
            if (str[i] === q) { out += str[i++]; continue; }
            break;
          }
          i++;
        }
        continue;
      }
      const rest = str.slice(i);
      const refMatch = rest.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/);
      if (refMatch && (i === 0 || !/[A-Za-z0-9_]/.test(str[i - 1]))) {
        const absCol = refMatch[1] === '$';
        const col = letterToCol(refMatch[2]);
        const absRow = refMatch[3] === '$';
        const row = parseInt(refMatch[4], 10) - 1;
        const nextCol = absCol ? col : Math.max(0, col + dCol);
        const nextRow = absRow ? row : Math.max(0, row + dRow);
        out += `${absCol ? '$' : ''}${colToLetter(nextCol)}${absRow ? '$' : ''}${nextRow + 1}`;
        i += refMatch[0].length;
        continue;
      }
      out += str[i++];
    }
    return out;
  }

  // GR-01: Shift cell references across formulas when inserting (+1) or deleting (-1) rows/cols
  function shiftFormulaOnInsertDelete(formula, targetSheetName, currentSheetName, axis, index, delta) {
    if (!formula || !String(formula).startsWith('=')) return formula;
    const isSameSheet = targetSheetName.toLowerCase() === currentSheetName.toLowerCase();
    const str = String(formula);
    let out = '';
    let i = 0;

    function adjustPoint(p, isRangeEnd = false) {
      let r = p.row;
      let c = p.col;
      if (axis === 'row') {
        if (delta > 0 && r >= index) r += delta;
        else if (delta < 0) {
          if (r === index) return isRangeEnd ? { ...p, row: Math.max(0, r - 1) } : null;
          if (r > index) r += delta;
        }
      } else {
        if (delta > 0 && c >= index) c += delta;
        else if (delta < 0) {
          if (c === index) return isRangeEnd ? { ...p, col: Math.max(0, c - 1) } : null;
          if (c > index) c += delta;
        }
      }
      return { ...p, row: r, col: c };
    }

    function fmtPoint(p) {
      return `${p.absCol ? '$' : ''}${colToLetter(p.col)}${p.absRow ? '$' : ''}${p.row + 1}`;
    }

    while (i < str.length) {
      if (str[i] === '"') {
        out += str[i++];
        while (i < str.length) {
          out += str[i];
          if (str[i] === '"') { i++; if (str[i] === '"') { out += str[i++]; continue; } break; }
          i++;
        }
        continue;
      }

      const rest = str.slice(i);
      // Match optional sheet prefix + cell or range
      const fullMatch = rest.match(/^(?:'([^']+)'!|([A-Za-z0-9_가-힣]+)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?(?![A-Za-z0-9_(])/);
      if (fullMatch && (i === 0 || !/[A-Za-z0-9_]/.test(str[i - 1]))) {
        const refSheet = fullMatch[1] || fullMatch[2] || null;
        const applies = refSheet
          ? refSheet.toLowerCase() === targetSheetName.toLowerCase()
          : isSameSheet;

        if (!applies) {
          out += fullMatch[0];
          i += fullMatch[0].length;
          continue;
        }

        const sheetPrefix = fullMatch[1] ? `'${fullMatch[1]}'!` : (fullMatch[2] ? `${fullMatch[2]}!` : '');
        const p1 = parseCellRef(fullMatch[3]);
        const p2 = fullMatch[4] ? parseCellRef(fullMatch[4]) : null;

        if (!p1) {
          out += fullMatch[0];
          i += fullMatch[0].length;
          continue;
        }

        if (!p2) {
          const adj = adjustPoint(p1, false);
          out += adj ? `${sheetPrefix}${fmtPoint(adj)}` : '#REF!';
        } else {
          // Range A1:A10 — handle deletion gracefully even if edge row deleted
          let a1 = adjustPoint(p1, true);
          let a2 = adjustPoint(p2, true);
          if (delta < 0 && axis === 'row' && p1.row === index && p2.row === index) {
            out += '#REF!';
          } else if (delta < 0 && axis === 'col' && p1.col === index && p2.col === index) {
            out += '#REF!';
          } else {
            if (delta < 0 && axis === 'row' && p1.row === index) a1 = { ...p1, row: index };
            if (delta < 0 && axis === 'col' && p1.col === index) a1 = { ...p1, col: index };
            out += `${sheetPrefix}${fmtPoint(a1)}:${fmtPoint(a2)}`;
          }
        }
        i += fullMatch[0].length;
        continue;
      }

      out += str[i++];
    }
    return out;
  }

  // FM-03: Convert Origin Set Column Values expr `Col(A) * 1.5 + 10` -> Excel formula for rowIdx
  function expandColumnFormula(colExpr, rowIdx) {
    const clean = String(colExpr || '').trim().replace(/^=/, '');
    if (!clean) return '';
    const rowNum = rowIdx + 1;
    // Replace Col(A), Col(B), Col(1), Col("A") -> A1, B1...
    const expanded = clean.replace(/\bCol\(\s*["']?([A-Za-z]{1,3}|\d+)["']?\s*\)/gi, (_, token) => {
      if (/^\d+$/.test(token)) {
        return `${colToLetter(Math.max(0, parseInt(token, 10) - 1))}${rowNum}`;
      }
      return `${token.toUpperCase()}${rowNum}`;
    });
    return `=${expanded}`;
  }

  // ================= Formatting & Export =================
  function formatDisplayValue(val, style = {}) {
    if (isErr(val)) return val.__err;
    if (isBlank(val)) return '';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number' && Number.isFinite(val)) {
      const fmt = style?.numFmt || 'general';
      const hasCustomDec = typeof style?.decimals === 'number';
      if (fmt === 'percent') {
        const dec = hasCustomDec ? style.decimals : 1;
        return `${(val * 100).toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
      }
      if (fmt === 'currency') {
        const dec = hasCustomDec ? style.decimals : 0;
        return `₩${val.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
      }
      if (fmt === 'usd') {
        const dec = hasCustomDec ? style.decimals : 2;
        return `$${val.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
      }
      if (fmt === 'number') {
        const dec = hasCustomDec ? style.decimals : 0;
        return val.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      }
      if (hasCustomDec) {
        return val.toLocaleString('ko-KR', { minimumFractionDigits: style.decimals, maximumFractionDigits: style.decimals });
      }
      return String(Math.round(val * 1e10) / 1e10);
    }
    return String(val);
  }

  function getUsedBounds(sheet) {
    let maxR = -1;
    let maxC = -1;
    Object.keys(sheet.cells || {}).forEach((addr) => {
      const c = sheet.cells[addr];
      if (!c || (c.raw === '' || c.raw === undefined || c.raw === null)) return;
      const p = parseCellRef(addr);
      if (p) {
        if (p.row > maxR) maxR = p.row;
        if (p.col > maxC) maxC = p.col;
      }
    });
    return { maxR, maxC };
  }

  function workbookToMarkdownSummary(workbook) {
    const wb = normalizeWorkbook(workbook);
    const ev = createEvaluator(wb);
    const lines = [];

    wb.sheets.forEach((sheet, sIdx) => {
      const { maxR, maxC } = getUsedBounds(sheet);
      if (maxR < 0 || maxC < 0) return;
      const cappedR = Math.min(maxR, 35);
      const cappedC = Math.min(maxC, 14);
      lines.push(`### 📊 ${sheet.name}`);
      lines.push('');

      // Check if Origin Long Names exist
      const hasMetaNames = Array.from({ length: cappedC + 1 }, (_, c) => getColMeta(sheet, c).longName).some(Boolean);
      const headerCols = [];
      let startRow = 0;

      if (hasMetaNames) {
        for (let c = 0; c <= cappedC; c++) {
          const m = getColMeta(sheet, c);
          const lbl = m.longName ? `${m.longName}${m.units ? ` [${m.units}]` : ''}` : colToLetter(c);
          headerCols.push(lbl.replace(/\|/g, '\\|'));
        }
        startRow = 0;
      } else {
        for (let c = 0; c <= cappedC; c++) {
          const v = formatDisplayValue(ev.evalCell(sIdx, cellKey(0, c)), sheet.cells[cellKey(0, c)]?.style);
          headerCols.push((v || colToLetter(c)).replace(/\|/g, '\\|').replace(/\n/g, ' '));
        }
        startRow = 1;
      }

      lines.push(`| ${headerCols.join(' | ')} |`);
      lines.push(`| ${headerCols.map(() => '---').join(' | ')} |`);
      for (let r = startRow; r <= cappedR; r++) {
        const rowCols = [];
        let hasAny = false;
        for (let c = 0; c <= cappedC; c++) {
          const addr = cellKey(r, c);
          const v = formatDisplayValue(ev.evalCell(sIdx, addr), sheet.cells[addr]?.style);
          if (v !== '') hasAny = true;
          rowCols.push(v.replace(/\|/g, '\\|').replace(/\n/g, ' '));
        }
        if (hasAny) lines.push(`| ${rowCols.join(' | ')} |`);
      }
      if (maxR > cappedR) lines.push(`\n*...외 ${maxR - cappedR}행 더 있음*`);
      lines.push('');
    });

    return lines.join('\n').trim() || '*빈 스프레드시트*';
  }

  async function exportWorkbookToXlsxBlob(workbook) {
    const XLSX = await ensureSheetJS();
    const wb = normalizeWorkbook(workbook);
    const ev = createEvaluator(wb);
    const outWb = XLSX.utils.book_new();

    wb.sheets.forEach((sheet, sIdx) => {
      const ws = {};
      const { maxR, maxC } = getUsedBounds(sheet);
      if (maxR >= 0 && maxC >= 0) {
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
        for (let r = 0; r <= maxR; r++) {
          for (let c = 0; c <= maxC; c++) {
            const addr = cellKey(r, c);
            const cell = sheet.cells[addr];
            if (!cell || cell.raw === undefined || cell.raw === null || cell.raw === '') continue;
            const raw = String(cell.raw);
            const val = ev.evalCell(sIdx, addr);
            const xCell = {};
            if (raw.startsWith('=')) xCell.f = raw.slice(1);
            if (isErr(val)) { xCell.t = 'e'; xCell.w = val.__err; }
            else if (typeof val === 'number') { xCell.t = 'n'; xCell.v = val; }
            else if (typeof val === 'boolean') { xCell.t = 'b'; xCell.v = val; }
            else { xCell.t = 's'; xCell.v = String(val); }

            if (cell.style?.numFmt === 'percent') xCell.z = '0.0%';
            else if (cell.style?.numFmt === 'currency') xCell.z = '₩#,##0';
            else if (cell.style?.numFmt === 'usd') xCell.z = '$#,##0.00';
            else if (cell.style?.numFmt === 'number') xCell.z = '#,##0';

            ws[addr] = xCell;
          }
        }
        const colsMeta = [];
        for (let c = 0; c <= maxC; c++) colsMeta.push({ wpx: sheet.colWidths[c] || 96 });
        ws['!cols'] = colsMeta;
      } else {
        ws['!ref'] = 'A1:A1';
      }

      const safeSheetName = sheet.name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || `Sheet${sIdx + 1}`;
      XLSX.utils.book_append_sheet(outWb, ws, safeSheetName);
    });

    const arr = XLSX.write(outWb, { bookType: 'xlsx', type: 'array' });
    return new Blob([arr], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function exportSheetToCsv(workbook, sheetIdx = 0) {
    const wb = normalizeWorkbook(workbook);
    const ev = createEvaluator(wb);
    const sheet = wb.sheets[sheetIdx] || wb.sheets[0];
    const { maxR, maxC } = getUsedBounds(sheet);
    if (maxR < 0 || maxC < 0) return '';
    const lines = [];
    for (let r = 0; r <= maxR; r++) {
      const cols = [];
      for (let c = 0; c <= maxC; c++) {
        const addr = cellKey(r, c);
        const text = formatDisplayValue(ev.evalCell(sheetIdx, addr), sheet.cells[addr]?.style);
        cols.push(/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
      }
      lines.push(cols.join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }


  global.BrainSpreadsheet = {
    ensureSheetJS,
    createEmptyWorkbook,
    createStarterWorkbook,
    EXAMPLE_CATALOG,
    createExampleWorkbook,
    normalizeWorkbook,
    parseCsvToWorkbook,
    parseArrayBufferToWorkbook,
    exportWorkbookToXlsxBlob,
    exportSheetToCsv,
    workbookToMarkdownSummary,
    createEvaluator,
    shiftFormula,
    shiftFormulaOnInsertDelete,
    expandColumnFormula,
    _internals: {
      DEFAULT_ROWS,
      DEFAULT_COLS,
      MAX_UNDO_STEPS,
      colToLetter,
      letterToCol,
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
    }
  };
})(window);
