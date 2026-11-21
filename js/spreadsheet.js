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
      plotConfig: global.BrainOriginPlot ? global.BrainOriginPlot.createDefaultPlotConfig() : null
    };
  }

  function createEmptyWorkbook(sheetName = 'Sheet1') {
    return {
      version: 2,
      activeSheet: 0,
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
      cfg.seriesStyles[3] = { color: '#2563eb', symbol: 'square', yAxis: 'y2', visible: true, lineWidth: 1.8, symbolSize: 4.5, lineStyle: 'solid' };
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
      return {
        name: String(s?.name || `Sheet${idx + 1}`).trim() || `Sheet${idx + 1}`,
        rows: Math.max(DEFAULT_ROWS, Number(s?.rows) || DEFAULT_ROWS),
        cols: Math.max(DEFAULT_COLS, Number(s?.cols) || DEFAULT_COLS),
        cells: s?.cells && typeof s.cells === 'object' ? s.cells : {},
        colWidths: s?.colWidths && typeof s.colWidths === 'object' ? s.colWidths : {},
        colMeta,
        plotConfig: global.BrainOriginPlot
          ? global.BrainOriginPlot.mergePlotConfig(s?.plotConfig)
          : (s?.plotConfig || null)
      };
    });
    const activeSheet = Math.max(0, Math.min(sheets.length - 1, Number(wb.activeSheet) || 0));
    return { version: 2, activeSheet, sheets };
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
        return { type: 'LIT', value: makeErr('#NAME?') };
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

  // ================= Function Helper Catalog =================
  const FUNCTION_CATALOG = [
    { cat: '집계/통계', name: 'SUM / AVERAGE', sig: '=SUM(A1:A10)', desc: '합계 / 평균 계산' },
    { cat: '집계/통계', name: 'STDEV / VAR / MEDIAN', sig: '=STDEV(B1:B10)', desc: '표준편차 / 분산 / 중앙값' },
    { cat: '집계/통계', name: 'MIN / MAX / COUNT', sig: '=MAX(B1:B10)', desc: '최솟값 / 최댓값 / 숫자 개수' },
    { cat: '집계/통계', name: 'SUMPRODUCT / RANK', sig: '=SUMPRODUCT(A1:A5,B1:B5)', desc: '배열 곱 합계 / 순위' },
    { cat: '공학 수학', name: 'SIN / COS / TAN', sig: '=SIN(RADIANS(A1))', desc: '삼각함수 (라디안·도 변환 포함)' },
    { cat: '공학 수학', name: 'EXP / LN / LOG10', sig: '=LN(A1)', desc: '지수함수 / 자연로그 / 상용로그' },
    { cat: '공학 수학', name: 'SQRT / POWER / ABS / PI', sig: '=SQRT(POWER(A1,2)+POWER(B1,2))', desc: '제곱근 / 거듭제곱 / 절댓값 / 원주율' },
    { cat: '공학 수학', name: 'ROUND / ROUNDUP / MOD', sig: '=ROUND(A1,2)', desc: '반올림 / 올림 / 나머지' },
    { cat: '조건부 집계', name: 'SUMIF / SUMIFS', sig: '=SUMIF(A1:A10,">10",B1:B10)', desc: '단일·다중 조건 합계' },
    { cat: '조건부 집계', name: 'COUNTIF / COUNTIFS', sig: '=COUNTIF(A1:A10,">=75")', desc: '단일·다중 조건 개수' },
    { cat: '조건부 집계', name: 'AVERAGEIF', sig: '=AVERAGEIF(A1:A10,"적합",B1:B10)', desc: '조건부 평균' },
    { cat: '논리', name: 'IF / IFS / IFERROR', sig: '=IF(A1>=75,"적합","검토")', desc: '조건 분기 / 다중 조건 / 오류 처리' },
    { cat: '논리', name: 'AND / OR / NOT', sig: '=IF(AND(A1>0,B1>0),"OK","NO")', desc: '논리 연산' },
    { cat: '조회/참조', name: 'VLOOKUP / XLOOKUP', sig: '=VLOOKUP(A2,D2:F10,2,FALSE)', desc: '표 검색 및 값 조회' },
    { cat: '조회/참조', name: 'INDEX / MATCH', sig: '=INDEX(B2:B10,MATCH(A2,A2:A10,0))', desc: '행/열 인덱스 기반 조회' },
    { cat: '텍스트', name: 'CONCAT / TEXTJOIN / TEXT', sig: '=TEXT(A1,"#,##0.0")', desc: '문자열 결합 및 서식 변환' },
    { cat: '텍스트', name: 'LEFT / RIGHT / MID / SUBSTITUTE', sig: '=LEFT(A1,4)', desc: '문자열 추출 및 치환' },
    { cat: '날짜', name: 'TODAY / DAYS / DATEDIF', sig: '=DAYS(B1,A1)', desc: '오늘 날짜 / 두 날짜 간격 계산' }
  ];

  // ================= Interactive Excel + Origin Spreadsheet UI =================
  function mountSpreadsheetUI(container, options = {}) {
    let workbook = normalizeWorkbook(options.workbook || createEmptyWorkbook());
    let evaluator = createEvaluator(workbook);

    const undoStack = [];
    const redoStack = [];
    let isDirty = false;
    let autoSaveTimer = null;
    let clipboardData = null;

    let activeRibbonTab = 'home'; // 'home' | 'insert' | 'formulas' | 'data' | 'graph'
    let viewMode = 'sheet'; // 'sheet' | 'split' | 'plot'
    let showMetaRows = true;
    let showInspector = false;

    let selAnchor = { r: 0, c: 0 };
    let selFocus = { r: 0, c: 0 };
    let isSelecting = false;
    let isFillDragging = false;
    let fillTarget = null;
    let editingCell = null; // { r, c, source: 'cell'|'formula' }

    let plotController = null;

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

    function pushUndo() {
      undoStack.push(cloneWorkbook(workbook));
      if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
      redoStack.length = 0;
    }

    // IO-04: 1-second debounced auto-backup
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

    function markDirty() {
      isDirty = true;
      evaluator.clear();
      updateDirtyUI();
      scheduleAutoSave();
      if (typeof options.onDirtyChange === 'function') options.onDirtyChange(true);
    }

    function setCellData(sheet, r, c, raw, stylePatch = null) {
      const addr = cellKey(r, c);
      const prev = sheet.cells[addr] || { raw: '' };
      const nextRaw = raw !== undefined ? String(raw) : (prev.raw || '');
      const nextStyle = stylePatch ? { ...(prev.style || {}), ...stylePatch } : prev.style;
      const hasStyle = nextStyle && Object.keys(nextStyle).some((k) => nextStyle[k] !== undefined && nextStyle[k] !== '');

      if (nextRaw === '' && !hasStyle) delete sheet.cells[addr];
      else sheet.cells[addr] = hasStyle ? { raw: nextRaw, style: nextStyle } : { raw: nextRaw };
    }

    // ---- Extract Origin Dataset from Active Sheet (GR-03) ----
    function extractOriginDataset(plotCfg) {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const { maxR, maxC } = getUsedBounds(sheet);
      const colLimit = Math.max(maxC, 0);

      // Find X column
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

      // Map Y columns and attach adjacent right yErr column if present
      const series = [];
      for (let c = 0; c <= colLimit; c++) {
        if (c === xCol) continue;
        const meta = getColMeta(sheet, c);
        if (meta.role !== 'Y') continue;

        // Check if next column is yErr
        let errCol = -1;
        if (c + 1 <= colLimit && getColMeta(sheet, c + 1).role === 'yErr') {
          errCol = c + 1;
        }

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
    root.className = 'sb-sheet-root excel-ui';
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
        <button type="button" class="xl-rtab active" data-rtab="home">홈</button>
        <button type="button" class="xl-rtab" data-rtab="insert">삽입</button>
        <button type="button" class="xl-rtab" data-rtab="formulas">수식</button>
        <button type="button" class="xl-rtab" data-rtab="data">데이터</button>
        <button type="button" class="xl-rtab" data-rtab="graph">그래프 (Origin)</button>
      </div>
      <div class="xl-view-switcher">
        <button type="button" class="xl-view-btn active" data-vmode="sheet" title="워크시트 전체 보기">📋 시트</button>
        <button type="button" class="xl-view-btn" data-vmode="split" title="시트 + Origin 그래프 좌우 분할">◫ 분할</button>
        <button type="button" class="xl-view-btn" data-vmode="plot" title="Origin 그래프 전체 보기">📈 그래프</button>
      </div>
      <span class="sb-sheet-dirty" data-role="dirty">저장됨</span>
    `;

    // 2. Excel Ribbon Command Bar
    const ribbonBody = document.createElement('div');
    ribbonBody.className = 'xl-ribbon-body';
    ribbonBody.innerHTML = `
      <!-- 홈 탭 -->
      <div class="xl-rpanel active" data-rpanel="home">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="paste" title="붙여넣기 (Ctrl+V)">📋 붙여넣기</button>
            <button type="button" class="sb-tb-btn" data-cmd="copy" title="복사 (Ctrl+C)">📄 복사</button>
            <button type="button" class="sb-tb-btn" data-cmd="cut" title="잘라내기 (Ctrl+X)">✂️</button>
          </div>
          <div class="xl-rgroup-lbl">클립보드</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
            <button type="button" class="sb-tb-btn" data-cmd="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
            <button type="button" class="sb-tb-btn" data-cmd="underline" title="밑줄 (Ctrl+U)"><u>U</u></button>
            <label class="sb-tb-color" title="글자 색">A<input type="color" data-cmd="color" value="#1e293b"></label>
            <label class="sb-tb-color" title="채우기 색">🎨<input type="color" data-cmd="bg" value="#fef9c3"></label>
            <button type="button" class="sb-tb-btn" data-cmd="clear-style" title="서식 지우기">🧹</button>
          </div>
          <div class="xl-rgroup-lbl">글꼴</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="align-left" title="왼쪽 맞춤">⫤</button>
            <button type="button" class="sb-tb-btn" data-cmd="align-center" title="가운데 맞춤">≡</button>
            <button type="button" class="sb-tb-btn" data-cmd="align-right" title="오른쪽 맞춤">⫥</button>
          </div>
          <div class="xl-rgroup-lbl">맞춤</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="fmt-number" title="천단위 쉼표">,</button>
            <button type="button" class="sb-tb-btn" data-cmd="fmt-currency" title="원화 (₩)">₩</button>
            <button type="button" class="sb-tb-btn" data-cmd="fmt-usd" title="달러 ($)">$</button>
            <button type="button" class="sb-tb-btn" data-cmd="fmt-percent" title="백분율 (%)">%</button>
            <button type="button" class="sb-tb-btn" data-cmd="dec-inc" title="소수점 자릿수 늘림">.0+</button>
            <button type="button" class="sb-tb-btn" data-cmd="dec-dec" title="소수점 자릿수 줄임">.0-</button>
          </div>
          <div class="xl-rgroup-lbl">표시 형식</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="add-row" title="행 삽입 (Ctrl+Shift+=)">+행</button>
            <button type="button" class="sb-tb-btn" data-cmd="del-row" title="행 삭제 (Ctrl+-)">-행</button>
            <button type="button" class="sb-tb-btn" data-cmd="add-col" title="열 삽입">+열</button>
            <button type="button" class="sb-tb-btn" data-cmd="del-col" title="열 삭제">-열</button>
            <button type="button" class="sb-tb-btn active" data-cmd="toggle-meta" title="Origin 메타 헤더(Long Name/Units/Comments) 표시 토글">🏷️ 메타행</button>
          </div>
          <div class="xl-rgroup-lbl">셀 · Origin 헤더</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn primary" data-cmd="save" title="저장 (Ctrl+S)">💾 저장</button>
            <button type="button" class="sb-tb-btn ai" data-cmd="ask-ai" title="현재 시트 데이터로 AI에게 질문">🤖 AI 분석</button>
          </div>
          <div class="xl-rgroup-lbl">빠른 작업</div>
        </div>
      </div>

      <!-- 삽입 탭 (Origin 과학 그래프 퀵 생성) -->
      <div class="xl-rpanel" data-rpanel="insert">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="plot-line-symbol">📈 선+심볼</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-scatter">⚬ 산점도</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-line">〰️ 선 그래프</button>
            <button type="button" class="sb-tb-btn primary" data-cmd="plot-double-y">📊 Double-Y 이중축</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-bar">📶 막대</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-area">⛰️ 영역</button>
          </div>
          <div class="xl-rgroup-lbl">Origin 과학 그래프 생성 (X/Y/yErr 열 자동 매핑)</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="open-fit">📐 커브 피팅 / 추세선</button>
            <button type="button" class="sb-tb-btn" data-cmd="add-sheet">➕ 새 시트</button>
          </div>
          <div class="xl-rgroup-lbl">분석 · 시트</div>
        </div>
      </div>

      <!-- 수식 탭 -->
      <div class="xl-rpanel" data-rpanel="formulas">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn primary" data-cmd="fx-help">ƒx 함수 삽입 (70+)</button>
            <button type="button" class="sb-tb-btn" data-cmd="autosum-SUM">Σ 합계</button>
            <button type="button" class="sb-tb-btn" data-cmd="autosum-AVERAGE">x̄ 평균</button>
            <button type="button" class="sb-tb-btn" data-cmd="autosum-STDEV">σ 표준편차</button>
            <button type="button" class="sb-tb-btn" data-cmd="autosum-MAX">최대</button>
            <button type="button" class="sb-tb-btn" data-cmd="autosum-MIN">최소</button>
          </div>
          <div class="xl-rgroup-lbl">함수 라이브러리 · 자동 계산</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn primary" data-cmd="set-col-values">⚡ 열 일괄 수식 (Set Column Values)</button>
          </div>
          <div class="xl-rgroup-lbl">Origin 열 단위 연산</div>
        </div>
      </div>

      <!-- 데이터 탭 -->
      <div class="xl-rpanel" data-rpanel="data">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="sort-asc">⬆️ 오름차순 정렬</button>
            <button type="button" class="sb-tb-btn" data-cmd="sort-desc">⬇️ 내림차순 정렬</button>
            <button type="button" class="sb-tb-btn primary" data-cmd="open-fit">📐 커브 피팅 (회귀·다항식·스무딩)</button>
          </div>
          <div class="xl-rgroup-lbl">정렬 · 커브 피팅</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="import-file">📂 CSV/Excel 불러오기</button>
            <button type="button" class="sb-tb-btn" data-cmd="export-xlsx">⬇️ .xlsx 저장</button>
            <button type="button" class="sb-tb-btn" data-cmd="export-csv">⬇️ .csv 저장</button>
            <button type="button" class="sb-tb-btn" data-cmd="export-json">💾 프로젝트(.json)</button>
            <button type="button" class="sb-tb-btn" data-cmd="import-json">📥 프로젝트 열기</button>
          </div>
          <div class="xl-rgroup-lbl">파일 · 프로젝트 입출력</div>
        </div>
      </div>

      <!-- 그래프(Origin) 탭 -->
      <div class="xl-rpanel" data-rpanel="graph">
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn" data-cmd="plot-zoom">🔍 드래그 확대</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-reader">🎯 데이터 리더</button>
            <button type="button" class="sb-tb-btn" data-cmd="plot-reset">↺ 전체 축 복원</button>
            <button type="button" class="sb-tb-btn" data-cmd="toggle-inspector">🎛️ 속성 인스펙터</button>
          </div>
          <div class="xl-rgroup-lbl">탐색 · 속성 제어</div>
        </div>
        <div class="xl-rgroup">
          <div class="xl-rgroup-btns">
            <button type="button" class="sb-tb-btn primary" data-cmd="export-svg">⬇️ 벡터 SVG 내보내기</button>
            <button type="button" class="sb-tb-btn primary" data-cmd="export-png">🖼️ 300DPI PNG 내보내기</button>
          </div>
          <div class="xl-rgroup-lbl">논문·보고서 고해상도 출력</div>
        </div>
      </div>
    `;

    // Hidden file inputs for IO-01 & IO-02
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
        <span>ƒx 내장 엑셀·공학 함수 (70+ 함수 지원 · 클릭하면 현재 셀에 삽입)</span>
        <input type="text" class="sb-fx-search" placeholder="함수 검색 (예: SIN, VLOOKUP, SUMIF...)">
        <button type="button" class="sb-tb-btn" data-cmd="close-fx">✕</button>
      </div>
      <div class="sb-fx-list">${FUNCTION_CATALOG.map((f) =>
        `<button type="button" class="sb-fx-item" data-sig="${f.sig.replace(/"/g, '&quot;')}">
          <span class="sb-fx-cat">${f.cat}</span>
          <span class="sb-fx-name">${f.name}</span>
          <span class="sb-fx-sig">${f.sig}</span>
          <span class="sb-fx-desc">${f.desc}</span>
        </button>`
      ).join('')}</div>
    `;

    // 5. Main Split Workspace (Left: Worksheet Grid | Right: Origin Plot + Inspector)
    const workspace = document.createElement('div');
    workspace.className = 'xl-workspace mode-sheet';

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

    const fillHandle = document.createElement('div');
    fillHandle.className = 'sb-fill-handle';
    fillHandle.title = '드래그하여 숫자 패턴 또는 수식 자동 채우기';
    gridWrap.appendChild(fillHandle);

    // Header Context Menu (GR-01, GR-03, FM-03)
    const hdrMenu = document.createElement('div');
    hdrMenu.className = 'xl-hdr-menu';
    hdrMenu.style.display = 'none';
    gridPane.appendChild(gridWrap);
    gridPane.appendChild(hdrMenu);

    const plotPane = document.createElement('div');
    plotPane.className = 'xl-plot-pane';
    const plotCanvasBox = document.createElement('div');
    plotCanvasBox.className = 'xl-plot-canvas-box';
    const plotInspectorBox = document.createElement('div');
    plotInspectorBox.className = 'xl-plot-inspector-box';
    plotInspectorBox.style.display = 'none';
    plotPane.appendChild(plotCanvasBox);
    plotPane.appendChild(plotInspectorBox);

    workspace.appendChild(gridPane);
    workspace.appendChild(plotPane);

    // 6. Inline Dialog Overlay (Set Column Values & Curve Fitting)
    const subModal = document.createElement('div');
    subModal.className = 'xl-submodal-overlay';
    subModal.style.display = 'none';

    // 7. Bottom Excel Sheet Tabs + Status Bar
    const footerBar = document.createElement('div');
    footerBar.className = 'sb-sheet-footer';
    footerBar.innerHTML = `
      <div class="sb-sheet-tabs" data-role="tabs"></div>
      <div class="xl-footer-right">
        <span class="xl-autobackup-lbl" data-role="autobackup">자동 백업 준비</span>
        <div class="sb-sheet-stats" data-role="stats">준비</div>
      </div>
    `;

    root.appendChild(ribbonHeader);
    root.appendChild(ribbonBody);
    root.appendChild(formulaBar);
    root.appendChild(fxPanel);
    root.appendChild(workspace);
    root.appendChild(footerBar);
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
    const fxSearchInput = fxPanel.querySelector('.sb-fx-search');

    let tdMatrix = [];

    // Initialize Origin Plot Controller
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
        onToast: options.onToast
      });
    }

    function refreshPlotIfVisible() {
      if (plotController && viewMode !== 'sheet') {
        plotController.refresh();
      }
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
      const { r2, c2 } = getNormRange();
      const td = tdMatrix[r2]?.[c2];
      if (!td || editingCell) {
        fillHandle.style.display = 'none';
        return;
      }
      fillHandle.style.display = 'block';
      fillHandle.style.left = `${td.offsetLeft + td.offsetWidth - 5}px`;
      fillHandle.style.top = `${td.offsetTop + td.offsetHeight - 5}px`;
    }

    // ---- Column / Row Header Right-Click Menu ----
    function openHeaderContextMenu(e, kind, index) {
      e.preventDefault();
      e.stopPropagation();
      const sheet = getSheet();
      const paneRect = gridPane.getBoundingClientRect();
      const left = Math.max(4, Math.min(paneRect.width - 210, e.clientX - paneRect.left));
      const top = Math.max(4, Math.min(paneRect.height - 220, e.clientY - paneRect.top));

      if (kind === 'col') {
        const colLetter = colToLetter(index);
        const curRole = getColMeta(sheet, index).role;
        hdrMenu.innerHTML = `
          <div class="xl-hm-title">열 ${colLetter} 작업</div>
          <button type="button" data-hact="ins-col-left">➕ 왼쪽에 열 삽입</button>
          <button type="button" data-hact="ins-col-right">➕ 오른쪽에 열 삽입</button>
          <button type="button" data-hact="del-col" class="danger">🗑️ 열 ${colLetter} 삭제</button>
          <hr>
          <button type="button" data-hact="role-X">${curRole === 'X' ? '✓ ' : ''}역할 지정: X (독립변수)</button>
          <button type="button" data-hact="role-Y">${curRole === 'Y' ? '✓ ' : ''}역할 지정: Y (종속변수)</button>
          <button type="button" data-hact="role-yErr">${curRole === 'yErr' ? '✓ ' : ''}역할 지정: yErr (오차막대)</button>
          <button type="button" data-hact="role-none">${curRole === '' ? '✓ ' : ''}역할 해제</button>
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
        const nextRole = act === 'role-none' ? '' : act.slice(5);
        setColumnMetaProp(idx, 'role', nextRole);
        renderGridStructure();
      } else if (act === 'set-col-val') {
        openSetColumnValuesModal(idx);
      } else if (act === 'sort-asc') {
        sortSheetByColumn(idx, true);
      } else if (act === 'sort-desc') {
        sortSheetByColumn(idx, false);
      }
    });

    function setColumnMetaProp(colIdx, prop, val) {
      const sheet = getSheet();
      pushUndo();
      if (!sheet.colMeta) sheet.colMeta = {};
      const prev = getColMeta(sheet, colIdx);
      sheet.colMeta[colIdx] = { ...prev, [prop]: val };
      markDirty();
      refreshPlotIfVisible();
    }

    // ---- Grid Rendering (with Sticky Origin Metadata Rows) ----
    function renderGridStructure() {
      const sheet = getSheet();
      colgroup.innerHTML = '';
      thead.innerHTML = '';
      tbody.innerHTML = '';
      tdMatrix = [];

      const colRowHdr = document.createElement('col');
      colRowHdr.style.width = '76px';
      colgroup.appendChild(colRowHdr);

      for (let c = 0; c < sheet.cols; c++) {
        const col = document.createElement('col');
        col.style.width = `${sheet.colWidths[c] || 98}px`;
        colgroup.appendChild(col);
      }

      // Row 1 of thead: Excel Column Letters + Origin Role Badge
      const headTr = document.createElement('tr');
      const cornerTh = document.createElement('th');
      cornerTh.className = 'sb-corner-th';
      cornerTh.title = '전체 선택';
      cornerTh.addEventListener('click', () => {
        commitEdit();
        selAnchor = { r: 0, c: 0 };
        selFocus = { r: sheet.rows - 1, c: sheet.cols - 1 };
        updateSelectionVisuals();
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
            const next = cycle[(cycle.indexOf(meta.role) + 1) % cycle.length];
            setColumnMetaProp(c, 'role', next);
            renderGridStructure();
          });
          th.appendChild(roleBtn);
        }

        th.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || e.target.classList.contains('sb-col-resizer') || e.target.classList.contains('origin-role-badge')) return;
          commitEdit();
          selAnchor = { r: 0, c };
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

      // GR-03: 3 Sticky Origin Metadata Rows (Long Name, Units, Comments)
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
            inp.addEventListener('change', () => {
              setColumnMetaProp(c, def.key, inp.value.trim());
            });
            inp.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') inp.blur();
            });
            td.appendChild(inp);
            mTr.appendChild(td);
          }
          thead.appendChild(mTr);
        });
      }

      // Data Rows
      const frag = document.createDocumentFragment();
      for (let r = 0; r < sheet.rows; r++) {
        const tr = document.createElement('tr');
        const rowTh = document.createElement('th');
        rowTh.className = 'sb-row-th';
        rowTh.dataset.row = String(r);
        rowTh.textContent = String(r + 1);
        rowTh.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          commitEdit();
          selAnchor = { r, c: 0 };
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
          tr.appendChild(td);
          rowTds.push(td);
        }
        tdMatrix.push(rowTds);
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
      refreshAllCellValues();
      updateSelectionVisuals();
      renderSheetTabs();
      refreshPlotIfVisible();
    }

    function refreshAllCellValues() {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      evaluator.clear();

      for (let r = 0; r < sheet.rows; r++) {
        for (let c = 0; c < sheet.cols; c++) {
          const td = tdMatrix[r]?.[c];
          if (!td) continue;
          const addr = cellKey(r, c);
          const cell = sheet.cells[addr];
          if (!cell) {
            td.textContent = '';
            td.style.cssText = '';
            td.classList.remove('is-error', 'is-number');
            continue;
          }
          const val = evaluator.evalCell(sIdx, addr);
          td.textContent = formatDisplayValue(val, cell.style);

          const st = cell.style || {};
          td.style.fontWeight = st.bold ? '700' : '';
          td.style.fontStyle = st.italic ? 'italic' : '';
          td.style.textDecoration = st.underline ? 'underline' : '';
          td.style.color = isErr(val) ? '' : (st.color || '');
          td.style.backgroundColor = st.bg || '';
          td.style.textAlign = st.align || (typeof val === 'number' ? 'right' : '');
          td.classList.toggle('is-error', isErr(val));
          td.classList.toggle('is-number', typeof val === 'number');
        }
      }
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

      const activeTd = tdMatrix[selAnchor.r]?.[selAnchor.c];
      if (activeTd) activeTd.classList.add('active-cell');

      if (fillTarget) {
        const fr1 = Math.min(r1, fillTarget.r);
        const fr2 = Math.max(r2, fillTarget.r);
        const fc1 = Math.min(c1, fillTarget.c);
        const fc2 = Math.max(c2, fillTarget.c);
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
        const btnB = ribbonBody.querySelector('[data-cmd="bold"]');
        const btnI = ribbonBody.querySelector('[data-cmd="italic"]');
        const btnU = ribbonBody.querySelector('[data-cmd="underline"]');
        if (btnB) btnB.classList.toggle('active', Boolean(st.bold));
        if (btnI) btnI.classList.toggle('active', Boolean(st.italic));
        if (btnU) btnU.classList.toggle('active', Boolean(st.underline));
      }

      updateStatusStats();
      positionFillHandle();
    }

    function updateStatusStats() {
      const { r1, r2, c1, c2 } = getNormRange();
      const sIdx = workbook.activeSheet;
      const nums = [];
      let nonEmpty = 0;

      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const v = evaluator.evalCell(sIdx, cellKey(r, c));
          if (!isBlank(v)) nonEmpty++;
          if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
        }
      }

      if (nonEmpty <= 1 && nums.length === 0) {
        elStats.textContent = `준비  |  ${cellKey(selAnchor.r, selAnchor.c)}`;
        return;
      }

      const parts = [`개수: ${nonEmpty}`];
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
      elStats.textContent = parts.join('  |  ');
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
        inlineEditor.style.display = 'block';
        inlineEditor.style.left = `${td.offsetLeft}px`;
        inlineEditor.style.top = `${td.offsetTop}px`;
        inlineEditor.style.width = `${Math.max(td.offsetWidth, 130)}px`;
        inlineEditor.style.height = `${td.offsetHeight}px`;
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
      inlineEditor.style.display = 'none';
      updateSelectionVisuals();
      root.focus({ preventScroll: true });
    }

    inlineEditor.addEventListener('input', () => { elFormulaInput.value = inlineEditor.value; });
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
      const td = e.target.closest('td.sb-cell');
      if (!td || e.button !== 0) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);

      if (editingCell && isEditingFormula()) {
        e.preventDefault();
        formulaDragStartCell = { r, c };
        insertRefIntoFormula(cellKey(r, c), false);

        const onFormulaMove = (ev) => {
          const overTd = ev.target.closest?.('td.sb-cell');
          if (!overTd) return;
          const or = Number(overTd.dataset.r);
          const oc = Number(overTd.dataset.c);
          const refText = (or === formulaDragStartCell.r && oc === formulaDragStartCell.c)
            ? cellKey(or, oc)
            : `${cellKey(Math.min(formulaDragStartCell.r, or), Math.min(formulaDragStartCell.c, oc))}:${cellKey(Math.max(formulaDragStartCell.r, or), Math.max(formulaDragStartCell.c, oc))}`;
          insertRefIntoFormula(refText, true);
        };
        const onFormulaUp = () => {
          document.removeEventListener('mousemove', onFormulaMove);
          document.removeEventListener('mouseup', onFormulaUp);
          formulaDragStartCell = null;
          formulaRefInsertStart = null;
          formulaRefInsertEnd = null;
        };
        document.addEventListener('mousemove', onFormulaMove);
        document.addEventListener('mouseup', onFormulaUp);
        return;
      }

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
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      if (isSelecting) { selFocus = { r, c }; updateSelectionVisuals(); }
      else if (isFillDragging) { fillTarget = { r, c }; updateSelectionVisuals(); }
    });

    tbody.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td.sb-cell');
      if (!td) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      selAnchor = { r, c };
      selFocus = { r, c };
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
      const tr = fillTarget.r;
      const tc = fillTarget.c;
      const fillDown = tr > r2;
      const fillUp = tr < r1;
      const fillRight = tc > c2;
      const fillLeft = tc < c1;
      if (!fillDown && !fillUp && !fillRight && !fillLeft) return;

      pushUndo();
      const srcRows = r2 - r1 + 1;
      const srcCols = c2 - c1 + 1;

      if (fillDown || fillUp) {
        const startR = fillDown ? r2 + 1 : tr;
        const endR = fillDown ? tr : r1 - 1;
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
        const startC = fillRight ? c2 + 1 : tc;
        const endC = fillRight ? tc : c1 - 1;
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
      if (isSelecting) isSelecting = false;
      if (isFillDragging) {
        isFillDragging = false;
        executeFill();
        fillTarget = null;
        updateSelectionVisuals();
      }
    };
    const onGlobalClick = (e) => {
      if (!e.target.closest('.xl-hdr-menu')) hdrMenu.style.display = 'none';
    };
    document.addEventListener('mouseup', onGlobalMouseUp);
    document.addEventListener('click', onGlobalClick);

    // ---- Row/Col Insert & Delete with Formula Shifting (GR-01) ----
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
        const newR = p.row >= idx ? p.row + 1 : p.row;
        nextCells[cellKey(newR, p.col)] = sheet.cells[addr];
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
        const newR = p.row > idx ? p.row - 1 : p.row;
        nextCells[cellKey(newR, p.col)] = sheet.cells[addr];
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
        const newC = p.col >= idx ? p.col + 1 : p.col;
        nextCells[cellKey(p.row, newC)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;

      // Shift colMeta & colWidths
      const nextMeta = {};
      const nextWidths = {};
      Object.keys(sheet.colMeta || {}).forEach((k) => {
        const ci = Number(k);
        nextMeta[ci >= idx ? ci + 1 : ci] = sheet.colMeta[k];
      });
      Object.keys(sheet.colWidths || {}).forEach((k) => {
        const ci = Number(k);
        nextWidths[ci >= idx ? ci + 1 : ci] = sheet.colWidths[k];
      });
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
        const newC = p.col > idx ? p.col - 1 : p.col;
        nextCells[cellKey(p.row, newC)] = sheet.cells[addr];
      });
      sheet.cells = nextCells;

      const nextMeta = {};
      const nextWidths = {};
      Object.keys(sheet.colMeta || {}).forEach((k) => {
        const ci = Number(k);
        if (ci === idx) return;
        nextMeta[ci > idx ? ci - 1 : ci] = sheet.colMeta[k];
      });
      Object.keys(sheet.colWidths || {}).forEach((k) => {
        const ci = Number(k);
        if (ci === idx) return;
        nextWidths[ci > idx ? ci - 1 : ci] = sheet.colWidths[k];
      });
      sheet.colMeta = nextMeta;
      sheet.colWidths = nextWidths;

      rewriteAllFormulasForInsertDelete(sheet.name, 'col', idx, -1);
      selAnchor.c = Math.min(selAnchor.c, sheet.cols - 1);
      selFocus.c = Math.min(selFocus.c, sheet.cols - 1);
      markDirty();
      renderGridStructure();
    }

    // ---- Sort Sheet by Column ----
    function sortSheetByColumn(colIdx, asc = true) {
      const sheet = getSheet();
      const sIdx = workbook.activeSheet;
      const { maxR, maxC } = getUsedBounds(sheet);
      if (maxR < 1) return;

      pushUndo();
      const rowData = [];
      for (let r = 0; r <= maxR; r++) {
        const cellsInRow = {};
        let hasAny = false;
        for (let c = 0; c <= maxC; c++) {
          const cell = sheet.cells[cellKey(r, c)];
          if (cell) { cellsInRow[c] = cell; hasAny = true; }
        }
        if (hasAny) {
          rowData.push({
            sortVal: evaluator.evalCell(sIdx, cellKey(r, colIdx)),
            cellsInRow
          });
        }
      }

      rowData.sort((a, b) => {
        const cmp = compareValues(a.sortVal, b.sortVal);
        if (Number.isNaN(cmp)) return 0;
        return asc ? cmp : -cmp;
      });

      sheet.cells = {};
      rowData.forEach((rd, rIdx) => {
        Object.keys(rd.cellsInRow).forEach((cStr) => {
          sheet.cells[cellKey(rIdx, Number(cStr))] = rd.cellsInRow[cStr];
        });
      });

      markDirty();
      refreshAllCellValues();
      if (typeof options.onToast === 'function') options.onToast(`열 ${colToLetter(colIdx)} 기준 ${asc ? '오름차순' : '내림차순'} 정렬 완료`);
    }

    // ---- Smart Clipboard Paste with Auto-Expand (GR-02) ----
    function copySelection(isCut = false) {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      const rows = [];
      const tsvLines = [];
      for (let r = r1; r <= r2; r++) {
        const rowArr = [];
        const tsvCols = [];
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          const cell = sheet.cells[addr];
          rowArr.push(cell ? JSON.parse(JSON.stringify(cell)) : { raw: '' });
          const val = evaluator.evalCell(workbook.activeSheet, addr);
          tsvCols.push(formatDisplayValue(val, cell?.style));
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
      const destR = selAnchor.r;
      const destC = selAnchor.c;

      if (externalText === null && clipboardData) {
        pushUndo();
        const { r1, c1, rows } = clipboardData;
        const dRow = destR - r1;
        const dCol = destC - c1;
        const reqRows = destR + rows.length;
        const reqCols = destC + (rows[0]?.length || 1);
        let expanded = false;
        if (reqRows > sheet.rows) { sheet.rows = reqRows + 8; expanded = true; }
        if (reqCols > sheet.cols) { sheet.cols = reqCols + 4; expanded = true; }

        rows.forEach((rowArr, dr) => {
          rowArr.forEach((cell, dc) => {
            const raw = cell.raw && cell.raw.startsWith('=')
              ? shiftFormula(cell.raw, dRow, dCol)
              : (cell.raw || '');
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
      const reqRows = destR + parsed.length;
      const reqCols = destC + maxCols;
      if (reqRows > sheet.rows) { sheet.rows = reqRows + 10; expanded = true; }
      if (reqCols > sheet.cols) { sheet.cols = reqCols + 4; expanded = true; }

      parsed.forEach((cols, dr) => {
        cols.forEach((val, dc) => {
          setCellData(sheet, destR + dr, destC + dc, val);
        });
      });

      selFocus = { r: destR + parsed.length - 1, c: destC + maxCols - 1 };
      markDirty();
      if (expanded) {
        renderGridStructure();
        if (typeof options.onToast === 'function') options.onToast(`📋 ${parsed.length}행 × ${maxCols}열 붙여넣기 (시트 자동 확장됨)`);
      } else {
        refreshAllCellValues();
        updateSelectionVisuals();
      }
    }

    // ---- FM-03: Set Column Values Modal ----
    function openSetColumnValuesModal(defaultColIdx = selAnchor.c) {
      const sheet = getSheet();
      const { maxR, maxC } = getUsedBounds(sheet);
      const colOpts = Array.from({ length: sheet.cols }, (_, c) => {
        const m = getColMeta(sheet, c);
        return `<option value="${c}" ${c === defaultColIdx ? 'selected' : ''}>Col(${colToLetter(c)})${m.longName ? ` — ${m.longName}` : ''}</option>`;
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
            <label class="insp-field"><span>대상 열 선택</span><select id="scv-target-col">${colOpts}</select></label>
            <div class="insp-grid-2">
              <label class="insp-field"><span>시작 행 (1부터)</span><input type="number" id="scv-start-row" value="1" min="1"></label>
              <label class="insp-field"><span>종료 행</span><input type="number" id="scv-end-row" value="${Math.max(1, maxR + 1)}" min="1"></label>
            </div>
            <label class="insp-field">
              <span>수식 입력 (예: <code>Col(A) * 1.5 + 10</code> 또는 <code>SIN(RADIANS(Col(A)))</code>)</span>
              <input type="text" id="scv-expr" placeholder="Col(A) * 1.5 + 10" autocomplete="off">
            </label>
            <div class="xl-scv-chips">${chips}</div>
            <label class="insp-check" style="margin-top:6px;">
              <input type="checkbox" id="scv-as-formula" checked> 라이브 엑셀 수식(<code>=A1*1.5+10</code>)으로 채우기
            </label>
          </div>
          <div class="xl-submodal-foot">
            <button type="button" class="sb-tb-btn" data-smclose="1">취소</button>
            <button type="button" class="sb-tb-btn primary" id="scv-apply">⚡ 일괄 적용</button>
          </div>
        </div>
      `;
      subModal.style.display = 'flex';
      const exprInp = subModal.querySelector('#scv-expr');
      exprInp.focus();

      subModal.querySelectorAll('[data-insert-col]').forEach((b) => {
        b.addEventListener('click', () => {
          exprInp.value += b.dataset.insertCol;
          exprInp.focus();
        });
      });

      subModal.querySelector('#scv-apply').addEventListener('click', () => {
        const targetCol = Number(subModal.querySelector('#scv-target-col').value);
        const startR = Math.max(1, parseInt(subModal.querySelector('#scv-start-row').value, 10) || 1) - 1;
        const endR = Math.max(startR + 1, parseInt(subModal.querySelector('#scv-end-row').value, 10) || 1) - 1;
        const expr = exprInp.value.trim();
        const asFormula = subModal.querySelector('#scv-as-formula').checked;
        if (!expr) return;

        pushUndo();
        let expanded = false;
        if (endR + 1 > sheet.rows) { sheet.rows = endR + 10; expanded = true; }

        for (let r = startR; r <= endR; r++) {
          const formulaStr = expandColumnFormula(expr, r);
          if (asFormula) {
            setCellData(sheet, r, targetCol, formulaStr);
          } else {
            setCellData(sheet, r, targetCol, formulaStr);
          }
        }
        if (!asFormula) {
          evaluator.clear();
          const sIdx = workbook.activeSheet;
          for (let r = startR; r <= endR; r++) {
            const v = evaluator.evalCell(sIdx, cellKey(r, targetCol));
            setCellData(sheet, r, targetCol, isErr(v) ? v.__err : String(v));
          }
        }
        // Save formula note in Comments meta
        if (!sheet.colMeta) sheet.colMeta = {};
        const prevM = getColMeta(sheet, targetCol);
        sheet.colMeta[targetCol] = { ...prevM, comments: `Col(${colToLetter(targetCol)}) = ${expr}` };

        subModal.style.display = 'none';
        markDirty();
        if (expanded) renderGridStructure();
        else renderGridStructure();
        if (typeof options.onToast === 'function') {
          options.onToast(`⚡ Col(${colToLetter(targetCol)}) ${startR + 1}~${endR + 1}행 일괄 계산 완료`);
        }
      });
    }

    // ---- FM-04: Curve Fitting & Smoothing Modal ----
    function openCurveFittingModal() {
      if (!global.BrainOriginPlot) return;
      const sheet = getSheet();
      const { maxC } = getUsedBounds(sheet);
      const colLimit = Math.max(maxC + 1, 4);
      let defaultX = 0;
      let defaultY = 1;
      for (let c = 0; c < colLimit; c++) {
        if (getColMeta(sheet, c).role === 'X') { defaultX = c; break; }
      }
      for (let c = 0; c < colLimit; c++) {
        if (c !== defaultX && getColMeta(sheet, c).role === 'Y') { defaultY = c; break; }
      }

      const mkOpts = (sel) => Array.from({ length: colLimit }, (_, c) => {
        const m = getColMeta(sheet, c);
        return `<option value="${c}" ${c === sel ? 'selected' : ''}>Col(${colToLetter(c)})${m.longName ? ` — ${m.longName}` : ''}</option>`;
      }).join('');

      subModal.innerHTML = `
        <div class="xl-submodal-card">
          <div class="xl-submodal-head">
            <span>📐 커브 피팅 & 스무딩 (Curve Fitting)</span>
            <button type="button" class="sb-tb-btn" data-smclose="1">✕</button>
          </div>
          <div class="xl-submodal-body">
            <div class="insp-grid-2">
              <label class="insp-field"><span>X 열 (독립변수)</span><select id="fit-x-col">${mkOpts(defaultX)}</select></label>
              <label class="insp-field"><span>Y 열 (종속변수)</span><select id="fit-y-col">${mkOpts(defaultY)}</select></label>
            </div>
            <label class="insp-field"><span>피팅 / 스무딩 모델</span>
              <select id="fit-method">
                <option value="linear">선형 회귀 (y = ax + b, R² 산출)</option>
                <option value="poly2">2차 다항식 피팅 (Quadratic)</option>
                <option value="poly3">3차 다항식 피팅 (Cubic)</option>
                <option value="poly4">4차 다항식 피팅 (Quartic)</option>
                <option value="ma3">이동평균 스무딩 (Moving Avg, k=3)</option>
                <option value="ma5">이동평균 스무딩 (Moving Avg, k=5)</option>
                <option value="ma7">이동평균 스무딩 (Moving Avg, k=7)</option>
              </select>
            </label>
            <div class="insp-empty" style="margin-top:4px;">결과는 새 열에 자동 출력되며, Origin 그래프에 추세선과 수식(R²)이 함께 그려집니다.</div>
          </div>
          <div class="xl-submodal-foot">
            <button type="button" class="sb-tb-btn" data-smclose="1">취소</button>
            <button type="button" class="sb-tb-btn primary" id="fit-run">📐 피팅 실행</button>
          </div>
        </div>
      `;
      subModal.style.display = 'flex';

      subModal.querySelector('#fit-run').addEventListener('click', () => {
        const xCol = Number(subModal.querySelector('#fit-x-col').value);
        const yCol = Number(subModal.querySelector('#fit-y-col').value);
        const method = subModal.querySelector('#fit-method').value;
        const sIdx = workbook.activeSheet;
        const { maxR, maxC: curMaxC } = getUsedBounds(sheet);

        const pts = [];
        for (let r = 0; r <= maxR; r++) {
          const xv = evaluator.evalCell(sIdx, cellKey(r, xCol));
          const yv = evaluator.evalCell(sIdx, cellKey(r, yCol));
          if (typeof xv === 'number' && Number.isFinite(xv) && typeof yv === 'number' && Number.isFinite(yv)) {
            pts.push({ x: xv, y: yv, row: r });
          }
        }

        try {
          let fitRes;
          let curvePts = [];
          const sortedX = [...pts].sort((a, b) => a.x - b.x);
          const minX = sortedX[0]?.x ?? 0;
          const maxX = sortedX[sortedX.length - 1]?.x ?? 1;

          if (method === 'linear') {
            fitRes = global.BrainOriginPlot.linearRegression(pts);
            curvePts = [{ x: minX, y: fitRes.predict(minX) }, { x: maxX, y: fitRes.predict(maxX) }];
          } else if (method.startsWith('poly')) {
            const deg = Number(method.slice(4));
            fitRes = global.BrainOriginPlot.polynomialRegression(pts, deg);
            const steps = 60;
            for (let i = 0; i <= steps; i++) {
              const x = minX + ((maxX - minX) * i) / steps;
              curvePts.push({ x, y: fitRes.predict(x) });
            }
          } else {
            const k = Number(method.slice(2));
            fitRes = global.BrainOriginPlot.movingAverage(pts, k);
            curvePts = fitRes.points.map((p) => ({ x: p.x, y: p.y }));
          }

          // Output fitted column into sheet
          pushUndo();
          const outCol = Math.max(curMaxC + 1, 0);
          if (outCol >= sheet.cols) sheet.cols = outCol + 4;
          const yName = getColMeta(sheet, yCol).longName || `Col(${colToLetter(yCol)})`;
          if (!sheet.colMeta) sheet.colMeta = {};
          sheet.colMeta[outCol] = {
            longName: `${yName} (${method})`,
            units: getColMeta(sheet, yCol).units,
            comments: fitRes.eqText,
            role: '' // Keep as table result; trendline drawn as overlay to avoid double-clutter
          };

          if (fitRes.points) {
            fitRes.points.forEach((p) => {
              setCellData(sheet, p.row, outCol, String(Math.round(p.y * 1e6) / 1e6), { align: 'right' });
            });
          } else {
            pts.forEach((p) => {
              setCellData(sheet, p.row, outCol, String(Math.round(fitRes.predict(p.x) * 1e6) / 1e6), { align: 'right' });
            });
          }

          const yAxisOfSeries = sheet.plotConfig?.seriesStyles?.[yCol]?.yAxis || 'y1';
          if (plotController) {
            plotController.addFitOverlay({
              label: `${yName} Fit`,
              eqText: fitRes.eqText,
              r2: fitRes.r2,
              points: curvePts,
              color: '#dc2626',
              yAxis: yAxisOfSeries
            });
          }

          subModal.style.display = 'none';
          markDirty();
          renderGridStructure();
          if (viewMode === 'sheet') setViewMode('split');
          if (typeof options.onToast === 'function') options.onToast(`📐 피팅 완료: ${fitRes.eqText}`);
        } catch (err) {
          if (typeof options.onToast === 'function') options.onToast(`⚠️ ${err.message}`);
        }
      });
    }

    subModal.addEventListener('click', (e) => {
      if (e.target === subModal || e.target.closest('[data-smclose]')) {
        subModal.style.display = 'none';
      }
    });

    // ---- Style / Undo / Redo / Keyboard ----
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

    function applyStyleToSelection(patchFn) {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      pushUndo();
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const addr = cellKey(r, c);
          const prev = sheet.cells[addr] || { raw: '' };
          const nextStyle = patchFn({ ...(prev.style || {}) });
          if (nextStyle === null) {
            if (prev.raw) sheet.cells[addr] = { raw: prev.raw };
            else delete sheet.cells[addr];
          } else {
            sheet.cells[addr] = { raw: prev.raw || '', style: nextStyle };
          }
        }
      }
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    function clearSelectionCells() {
      const sheet = getSheet();
      const { r1, r2, c1, c2 } = getNormRange();
      pushUndo();
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) setCellData(sheet, r, c, '');
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
      const { r1, r2, c1, c2 } = getNormRange();
      const sheet = getSheet();
      let rangeStr;
      let targetR = r2;
      let targetC = c1;
      if (r1 !== r2 || c1 !== c2) {
        rangeStr = `${cellKey(r1, c1)}:${cellKey(r2, c2)}`;
        targetR = Math.min(sheet.rows - 1, r2 + 1);
      } else {
        // Auto-detect numeric cells above active cell
        let topR = r1 - 1;
        while (topR >= 0 && typeof evaluator.evalCell(workbook.activeSheet, cellKey(topR, c1)) === 'number') topR--;
        topR++;
        if (topR < r1) {
          rangeStr = `${cellKey(topR, c1)}:${cellKey(r1 - 1, c1)}`;
        } else {
          startEdit(r1, c1, `=${fnName}()`, 'formula');
          elFormulaInput.setSelectionRange(fnName.length + 2, fnName.length + 2);
          return;
        }
      }
      pushUndo();
      setCellData(sheet, targetR, targetC, `=${fnName}(${rangeStr})`, { bold: true });
      selAnchor = { r: targetR, c: targetC };
      selFocus = { r: targetR, c: targetC };
      markDirty();
      refreshAllCellValues();
      updateSelectionVisuals();
    }

    root.addEventListener('keydown', (e) => {
      if (
        e.target === inlineEditor ||
        e.target === elFormulaInput ||
        e.target === elAddr ||
        e.target === fxSearchInput ||
        e.target.closest('.origin-meta-input, .xl-plot-inspector-box, .xl-submodal-card')
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
        if (k === 's') { e.preventDefault(); triggerSave(); return; }
        if (k === 'z') { e.preventDefault(); doUndo(); return; }
        if (k === 'y') { e.preventDefault(); doRedo(); return; }
        if (k === 'c') { e.preventDefault(); copySelection(false); return; }
        if (k === 'x') { e.preventDefault(); copySelection(true); return; }
        if (k === 'v') { e.preventDefault(); pasteAtSelection(null); return; }
        if (k === 'b') {
          e.preventDefault();
          const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.bold;
          applyStyleToSelection((st) => ({ ...st, bold: !cur }));
          return;
        }
        if (k === 'i') {
          e.preventDefault();
          const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.italic;
          applyStyleToSelection((st) => ({ ...st, italic: !cur }));
          return;
        }
        if (k === 'u') {
          e.preventDefault();
          const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.underline;
          applyStyleToSelection((st) => ({ ...st, underline: !cur }));
          return;
        }
        // GR-01 Shortcuts: Ctrl + + / Ctrl + -
        if (e.key === '+' || (e.shiftKey && e.key === '=')) {
          e.preventDefault();
          insertRowAt(selAnchor.r);
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          deleteRowAt(selAnchor.r);
          return;
        }
      }

      if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1, 0, e.shiftKey); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1, 0, e.shiftKey); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(0, -1, e.shiftKey); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(0, 1, e.shiftKey); return; }
      if (e.key === 'Tab') { e.preventDefault(); moveSelection(0, e.shiftKey ? -1 : 1, false); return; }
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(selAnchor.r, selAnchor.c, null, 'cell'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelectionCells(); return; }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEdit(selAnchor.r, selAnchor.c, e.key, 'cell');
      }
    });

    root.addEventListener('paste', (e) => {
      if (
        e.target === inlineEditor ||
        e.target === elFormulaInput ||
        e.target === elAddr ||
        e.target === fxSearchInput ||
        e.target.closest('.origin-meta-input, .xl-plot-inspector-box, .xl-submodal-card')
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

    // ---- Save & File I/O (IO-01, IO-02) ----
    async function triggerSave() {
      commitEdit();
      if (typeof options.onSave === 'function') {
        elDirty.textContent = '저장 중...';
        try {
          await options.onSave(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
          isDirty = false;
          updateDirtyUI();
        } catch (err) {
          elDirty.textContent = '저장 실패';
          if (typeof options.onToast === 'function') options.onToast(`⚠️ 저장 실패: ${err.message}`);
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
        a.href = url;
        a.download = `${baseName}.xlsx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        if (typeof options.onToast === 'function') options.onToast(`⬇️ "${baseName}.xlsx" 다운로드됨`);
      } catch (err) {
        if (typeof options.onToast === 'function') options.onToast(`⚠️ 내보내기 실패: ${err.message}`);
      }
    }

    function triggerExportCsv() {
      commitEdit();
      const csv = exportSheetToCsv(workbook, workbook.activeSheet);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = String(options.fileName || 'spreadsheet').replace(/\.(xlsx|xls|csv|json)$/i, '');
      a.href = url;
      a.download = `${baseName}-${getSheet().name}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (typeof options.onToast === 'function') options.onToast('⬇️ CSV 파일 다운로드됨');
    }

    function triggerExportJsonProject() {
      commitEdit();
      const payload = {
        app: 'SecondBrainOS-OriginSpreadsheet',
        exportedAt: new Date().toISOString(),
        workbook: cloneWorkbook(workbook)
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = String(options.fileName || 'origin-project').replace(/\.(xlsx|xls|csv|json)$/i, '');
      a.href = url;
      a.download = `${baseName}.origin.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (typeof options.onToast === 'function') options.onToast(`💾 프로젝트 파일(${baseName}.origin.json) 저장됨`);
    }

    importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const loadedWb = await parseArrayBufferToWorkbook(buf, file.name);
        pushUndo();
        workbook = loadedWb;
        evaluator = createEvaluator(workbook);
        selAnchor = { r: 0, c: 0 };
        selFocus = { r: 0, c: 0 };
        markDirty();
        if (plotController) plotController.setConfig(getSheet().plotConfig);
        renderGridStructure();
        if (typeof options.onToast === 'function') options.onToast(`📂 "${file.name}" 불러오기 완료`);
      } catch (err) {
        if (typeof options.onToast === 'function') options.onToast(`⚠️ 불러오기 실패: ${err.message}`);
      }
    });

    importJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const wbData = parsed.workbook || parsed;
        if (!wbData || !Array.isArray(wbData.sheets)) throw new Error('올바른 프로젝트 JSON 파일이 아닙니다.');
        pushUndo();
        workbook = normalizeWorkbook(wbData);
        evaluator = createEvaluator(workbook);
        selAnchor = { r: 0, c: 0 };
        selFocus = { r: 0, c: 0 };
        markDirty();
        if (plotController) plotController.setConfig(getSheet().plotConfig);
        renderGridStructure();
        if (typeof options.onToast === 'function') options.onToast(`📥 프로젝트 "${file.name}" 복원 완료`);
      } catch (err) {
        if (typeof options.onToast === 'function') options.onToast(`⚠️ 프로젝트 복원 실패: ${err.message}`);
      }
    });

    // ---- Ribbon Tabs & Command Handlers ----
    ribbonHeader.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-rtab]');
      if (tabBtn) {
        activeRibbonTab = tabBtn.dataset.rtab;
        ribbonHeader.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === activeRibbonTab));
        ribbonBody.querySelectorAll('[data-rpanel]').forEach((p) => p.classList.toggle('active', p.dataset.rpanel === activeRibbonTab));
        return;
      }
      const vBtn = e.target.closest('[data-vmode]');
      if (vBtn) {
        setViewMode(vBtn.dataset.vmode);
        return;
      }
      const cmdBtn = e.target.closest('[data-cmd]');
      if (cmdBtn) handleCommand(cmdBtn.dataset.cmd);
    });

    function handleCommand(cmd) {
      if (cmd === 'save') { triggerSave(); return; }
      if (cmd === 'undo') { doUndo(); return; }
      if (cmd === 'redo') { doRedo(); return; }
      if (cmd === 'copy') { copySelection(false); return; }
      if (cmd === 'cut') { copySelection(true); return; }
      if (cmd === 'paste') { pasteAtSelection(null); return; }
      if (cmd === 'bold') {
        const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.bold;
        applyStyleToSelection((st) => ({ ...st, bold: !cur }));
        return;
      }
      if (cmd === 'italic') {
        const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.italic;
        applyStyleToSelection((st) => ({ ...st, italic: !cur }));
        return;
      }
      if (cmd === 'underline') {
        const cur = getSheet().cells[cellKey(selAnchor.r, selAnchor.c)]?.style?.underline;
        applyStyleToSelection((st) => ({ ...st, underline: !cur }));
        return;
      }
      if (cmd === 'align-left') { applyStyleToSelection((st) => ({ ...st, align: 'left' })); return; }
      if (cmd === 'align-center') { applyStyleToSelection((st) => ({ ...st, align: 'center' })); return; }
      if (cmd === 'align-right') { applyStyleToSelection((st) => ({ ...st, align: 'right' })); return; }
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
        const btn = ribbonBody.querySelector('[data-cmd="toggle-meta"]');
        if (btn) btn.classList.toggle('active', showMetaRows);
        renderGridStructure();
        return;
      }
      if (cmd === 'fx-help') {
        fxPanel.style.display = fxPanel.style.display === 'none' ? 'flex' : 'none';
        if (fxPanel.style.display === 'flex') fxSearchInput.focus();
        return;
      }
      if (cmd.startsWith('autosum-')) { insertAutoStat(cmd.slice(8)); return; }
      if (cmd === 'set-col-values') { openSetColumnValuesModal(selAnchor.c); return; }
      if (cmd === 'open-fit') { openCurveFittingModal(); return; }
      if (cmd === 'sort-asc') { sortSheetByColumn(selAnchor.c, true); return; }
      if (cmd === 'sort-desc') { sortSheetByColumn(selAnchor.c, false); return; }
      if (cmd === 'add-sheet') { addNewSheet(); return; }
      if (cmd === 'import-file') { importFileInput.click(); return; }
      if (cmd === 'export-xlsx') { triggerExportXlsx(); return; }
      if (cmd === 'export-csv') { triggerExportCsv(); return; }
      if (cmd === 'export-json') { triggerExportJsonProject(); return; }
      if (cmd === 'import-json') { importJsonInput.click(); return; }
      if (cmd === 'ask-ai') {
        commitEdit();
        if (typeof options.onAskAI === 'function') options.onAskAI(cloneWorkbook(workbook), workbookToMarkdownSummary(workbook));
        return;
      }

      // Origin Plot Quick Commands
      if (cmd === 'plot-line-symbol') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('line-symbol', false); return; }
      if (cmd === 'plot-scatter') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('scatter', false); return; }
      if (cmd === 'plot-line') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('line', false); return; }
      if (cmd === 'plot-double-y') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('line-symbol', true); return; }
      if (cmd === 'plot-bar') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('bar', false); return; }
      if (cmd === 'plot-area') { setViewMode(viewMode === 'sheet' ? 'split' : viewMode); plotController?.setPlotType('area', false); return; }
      if (cmd === 'plot-zoom') { if (viewMode === 'sheet') setViewMode('split'); plotController?.setInteractionMode('zoom'); return; }
      if (cmd === 'plot-reader') { if (viewMode === 'sheet') setViewMode('split'); plotController?.setInteractionMode('reader'); return; }
      if (cmd === 'plot-reset') { plotController?.resetZoom(); return; }
      if (cmd === 'toggle-inspector') {
        if (viewMode === 'sheet') setViewMode('split');
        showInspector = !showInspector;
        plotInspectorBox.style.display = showInspector ? 'flex' : 'none';
        setTimeout(() => plotController?.refresh(), 40);
        return;
      }
      if (cmd === 'export-svg') { if (viewMode === 'sheet') setViewMode('split'); setTimeout(() => plotController?.exportSvg(), 60); return; }
      if (cmd === 'export-png') { if (viewMode === 'sheet') setViewMode('split'); setTimeout(() => plotController?.exportPng300Dpi(), 60); return; }
    }

    ribbonBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn || btn.tagName === 'INPUT') return;
      handleCommand(btn.dataset.cmd);
    });

    ribbonBody.addEventListener('change', (e) => {
      const inp = e.target;
      if (!inp || !inp.dataset.cmd) return;
      if (inp.dataset.cmd === 'color') applyStyleToSelection((st) => ({ ...st, color: inp.value }));
      else if (inp.dataset.cmd === 'bg') applyStyleToSelection((st) => ({ ...st, bg: inp.value }));
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
      const sig = btn.dataset.sig || '';
      fxPanel.style.display = 'none';
      startEdit(selAnchor.r, selAnchor.c, sig, 'formula');
      elFormulaInput.setSelectionRange(sig.indexOf('(') + 1, sig.length - 1);
    });

    renderGridStructure();
    if (options.initialViewMode && ['sheet', 'split', 'plot'].includes(options.initialViewMode)) {
      setViewMode(options.initialViewMode);
    }

    return {
      getWorkbook() { commitEdit(); return cloneWorkbook(workbook); },
      getMarkdownSummary() { commitEdit(); return workbookToMarkdownSummary(workbook); },
      isDirty() { return isDirty; },
      setViewMode,
      save: triggerSave,
      destroy() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        document.removeEventListener('mouseup', onGlobalMouseUp);
        document.removeEventListener('click', onGlobalClick);
        plotController?.destroy();
      }
    };
  }

  global.BrainSpreadsheet = {
    ensureSheetJS,
    createEmptyWorkbook,
    createStarterWorkbook,
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
    mountSpreadsheetUI
  };
})(window);
