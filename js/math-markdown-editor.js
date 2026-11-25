(function (global) {
  'use strict';

  // ================= MT-03: Visual Formula Palette Catalog =================
  const PALETTE_CATEGORIES = [
    {
      id: 'greek',
      label: '그리스 문자',
      items: [
        { label: 'α', snippet: '\\alpha', wrap: false, title: 'alpha' },
        { label: 'β', snippet: '\\beta', title: 'beta' },
        { label: 'γ', snippet: '\\gamma', title: 'gamma' },
        { label: 'δ', snippet: '\\delta', title: 'delta' },
        { label: 'Δ', snippet: '\\Delta', title: 'Delta' },
        { label: 'ε', snippet: '\\varepsilon', title: 'epsilon' },
        { label: 'ζ', snippet: '\\zeta', title: 'zeta (감쇠비)' },
        { label: 'η', snippet: '\\eta', title: 'eta (효율)' },
        { label: 'θ', snippet: '\\theta', title: 'theta' },
        { label: 'λ', snippet: '\\lambda', title: 'lambda' },
        { label: 'μ', snippet: '\\mu', title: 'mu' },
        { label: 'π', snippet: '\\pi', title: 'pi' },
        { label: 'ρ', snippet: '\\rho', title: 'rho (밀도)' },
        { label: 'σ', snippet: '\\sigma', title: 'sigma' },
        { label: 'τ', snippet: '\\tau', title: 'tau (시정수)' },
        { label: 'φ', snippet: '\\phi', title: 'phi' },
        { label: 'Φ', snippet: '\\Phi', title: 'Phi' },
        { label: 'ψ', snippet: '\\psi', title: 'psi' },
        { label: 'ω', snippet: '\\omega', title: 'omega (각주파수)' },
        { label: 'Ω', snippet: '\\Omega', title: 'Omega (저항)' }
      ]
    },
    {
      id: 'calculus',
      label: '연산 · 미적분 · 제어',
      items: [
        { label: '∫ₐᵇ', snippet: '\\int_{$1}^{$2} $3 \\, dx', title: '정적분' },
        { label: '∬', snippet: '\\iint_{$1} $2 \\, dA', title: '이중적분' },
        { label: '∮', snippet: '\\oint_{$1} $2 \\, dl', title: '선적분' },
        { label: 'd/dt', snippet: '\\frac{d$1}{dt}', title: '시간 미분' },
        { label: '∂/∂x', snippet: '\\frac{\\partial $1}{\\partial $2}', title: '편미분' },
        { label: '∇', snippet: '\\nabla', title: '나블라 (Gradient/Div)' },
        { label: '∑', snippet: '\\sum_{i=$1}^{$2} $3', title: '합 (Sigma)' },
        { label: '∏', snippet: '\\prod_{i=$1}^{$2} $3', title: '곱 (Product)' },
        { label: 'lim', snippet: '\\lim_{$1 \\to $2} $3', title: '극한' },
        { label: 'ℒ{f}', snippet: '\\mathcal{L}\\{$1\\}', title: '라플라스 변환' },
        { label: 'ℒ⁻¹', snippet: '\\mathcal{L}^{-1}\\{$1\\}', title: '역라플라스 변환' },
        { label: 'G(s)', snippet: 'G(s) = \\frac{$1}{$2 s + 1}', title: '1차 전달함수' },
        { label: '2차계', snippet: 'G(s) = \\frac{\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}', title: '표준 2차 시스템' },
        { label: 'ẋ', snippet: '\\dot{$1}', title: '1차 시간미분 dot' },
        { label: 'ẍ', snippet: '\\ddot{$1}', title: '2차 시간미분 ddot' },
        { label: 'F⃗', snippet: '\\vec{$1}', title: '벡터 화살표' },
        { label: 'x̄', snippet: '\\overline{$1}', title: '평균/바' }
      ]
    },
    {
      id: 'matrix',
      label: '행렬 · 분수 · 화학',
      items: [
        { label: 'a/b', snippet: '\\frac{$1}{$2}', title: '분수 (선택 영역 감싸기)' },
        { label: '√x', snippet: '\\sqrt{$1}', title: '제곱근' },
        { label: 'ⁿ√x', snippet: '\\sqrt[$1]{$2}', title: 'n제곱근' },
        { label: 'xⁿ', snippet: '{$1}^{$2}', title: '위첨자 (거듭제곱)' },
        { label: 'xᵢ', snippet: '{$1}_{$2}', title: '아래첨자' },
        { label: '[2×2]', snippet: '\\begin{bmatrix}\n$1 & $2 \\\\\n$3 & $4\n\\end{bmatrix}', title: '2×2 대괄호 행렬' },
        { label: '[3×3]', snippet: '\\begin{bmatrix}\n$1 & $2 & $3 \\\\\n$4 & $5 & $6 \\\\\n$7 & $8 & $9\n\\end{bmatrix}', title: '3×3 대괄호 행렬' },
        { label: '(2×2)', snippet: '\\begin{pmatrix}\n$1 & $2 \\\\\n$3 & $4\n\\end{pmatrix}', title: '2×2 소괄호 행렬' },
        { label: 'cases', snippet: '\\begin{cases}\n$1, & $2 \\\\\n$3, & $4\n\\end{cases}', title: '구간 함수' },
        { label: 'aligned', snippet: '\\begin{aligned}\n$1 &= $2 \\\\\n&= $3\n\\end{aligned}', title: '등호 정렬 수식' },
        { label: '화학식', snippet: '\\ce{$1}', title: '화학 반응식 (mhchem, 예: H2O + CO2 -> H2CO3)' }
      ]
    },
    {
      id: 'logic',
      label: '관계 · 논리 · 단위',
      items: [
        { label: '±', snippet: '\\pm', title: '플러스마이너스' },
        { label: '×', snippet: '\\times', title: '곱하기' },
        { label: '·', snippet: '\\cdot', title: '내적/곱' },
        { label: '≈', snippet: '\\approx', title: '근사' },
        { label: '≠', snippet: '\\neq', title: '같지 않음' },
        { label: '≤', snippet: '\\leq', title: '작거나 같음' },
        { label: '≥', snippet: '\\geq', title: '크거나 같음' },
        { label: '≡', snippet: '\\equiv', title: '항등' },
        { label: '∝', snippet: '\\propto', title: '비례' },
        { label: '∞', snippet: '\\infty', title: '무한대' },
        { label: '⇒', snippet: '\\Rightarrow', title: '함의' },
        { label: '⇔', snippet: '\\Leftrightarrow', title: '동치' },
        { label: '∀', snippet: '\\forall', title: '모든' },
        { label: '∃', snippet: '\\exists', title: '존재' },
        { label: '∈', snippet: '\\in', title: '원소' },
        { label: '°C', snippet: '^\\circ\\text{C}', title: '섭씨 온도' },
        { label: '[kPa]', snippet: '\\text{ [kPa]}', title: '압력 단위' },
        { label: '[m³/h]', snippet: '\\text{ [m}^3\\text{/h]}', title: '유량 단위' },
        { label: '[W/m·K]', snippet: '\\text{ [W/(m}\\cdot\\text{K)]}', title: '열전도율 단위' }
      ]
    }
  ];

  // ================= MT-02: LaTeX Autocomplete Snippets =================
  const LATEX_SNIPPETS = [
    { cmd: '\\frac', snippet: '\\frac{$1}{$2}', desc: '분수 (a/b)' },
    { cmd: '\\sqrt', snippet: '\\sqrt{$1}', desc: '제곱근' },
    { cmd: '\\int', snippet: '\\int_{$1}^{$2} $3 \\, dx', desc: '정적분' },
    { cmd: '\\iint', snippet: '\\iint_{$1} $2 \\, dA', desc: '이중적분' },
    { cmd: '\\oint', snippet: '\\oint_{$1} $2 \\, dl', desc: '폐곡선 적분' },
    { cmd: '\\sum', snippet: '\\sum_{i=$1}^{$2} $3', desc: '합 기호 (Sigma)' },
    { cmd: '\\prod', snippet: '\\prod_{i=$1}^{$2} $3', desc: '곱 기호 (Product)' },
    { cmd: '\\lim', snippet: '\\lim_{$1 \\to $2} $3', desc: '극한 (Limit)' },
    { cmd: '\\partial', snippet: '\\frac{\\partial $1}{\\partial $2}', desc: '편미분' },
    { cmd: '\\nabla', snippet: '\\nabla $1', desc: '나블라 연산자' },
    { cmd: '\\mathcal', snippet: '\\mathcal{$1}', desc: '캘리그라피체 (라플라스 ℒ 등)' },
    { cmd: '\\bmatrix', snippet: '\\begin{bmatrix}\n$1 & $2 \\\\\n$3 & $4\n\\end{bmatrix}', desc: '2×2 대괄호 행렬' },
    { cmd: '\\pmatrix', snippet: '\\begin{pmatrix}\n$1 & $2 \\\\\n$3 & $4\n\\end{pmatrix}', desc: '2×2 소괄호 행렬' },
    { cmd: '\\cases', snippet: '\\begin{cases}\n$1, & $2 \\\\\n$3, & $4\n\\end{cases}', desc: '구간 함수' },
    { cmd: '\\aligned', snippet: '\\begin{aligned}\n$1 &= $2 \\\\\n&= $3\n\\end{aligned}', desc: '등호 정렬 블록' },
    { cmd: '\\ce', snippet: '\\ce{$1}', desc: '화학 반응식 (mhchem)' },
    { cmd: '\\text', snippet: '\\text{$1}', desc: '수식 내 일반 텍스트/단위' },
    { cmd: '\\dot', snippet: '\\dot{$1}', desc: '1차 시간 미분점' },
    { cmd: '\\ddot', snippet: '\\ddot{$1}', desc: '2차 시간 미분점' },
    { cmd: '\\vec', snippet: '\\vec{$1}', desc: '벡터 화살표' },
    { cmd: '\\hat', snippet: '\\hat{$1}', desc: '단위 벡터/추정치' },
    { cmd: '\\overline', snippet: '\\overline{$1}', desc: '평균 바' },
    { cmd: '\\left', snippet: '\\left( $1 \\right)', desc: '자동 크기 괄호' },
    { cmd: '\\alpha', snippet: '\\alpha', desc: '그리스 문자 α' },
    { cmd: '\\beta', snippet: '\\beta', desc: '그리스 문자 β' },
    { cmd: '\\gamma', snippet: '\\gamma', desc: '그리스 문자 γ' },
    { cmd: '\\Delta', snippet: '\\Delta', desc: '변화량 Δ' },
    { cmd: '\\theta', snippet: '\\theta', desc: '각도 θ' },
    { cmd: '\\lambda', snippet: '\\lambda', desc: '고유값/파장 λ' },
    { cmd: '\\mu', snippet: '\\mu', desc: '점성계수/평균 μ' },
    { cmd: '\\sigma', snippet: '\\sigma', desc: '응력/표준편차 σ' },
    { cmd: '\\tau', snippet: '\\tau', desc: '시정수/전단응력 τ' },
    { cmd: '\\omega', snippet: '\\omega', desc: '각주파수 ω' },
    { cmd: '\\Omega', snippet: '\\Omega', desc: '옴(저항) Ω' },
    { cmd: '\\zeta', snippet: '\\zeta', desc: '감쇠비 ζ' },
    { cmd: '\\eta', snippet: '\\eta', desc: '효율 η' },
    { cmd: '\\Phi', snippet: '\\Phi', desc: '자속/위상 Φ' },
    { cmd: '\\infty', snippet: '\\infty', desc: '무한대 ∞' },
    { cmd: '\\approx', snippet: '\\approx', desc: '근사 ≈' },
    { cmd: '\\pm', snippet: '\\pm', desc: '플러스마이너스 ±' },
    { cmd: '\\times', snippet: '\\times', desc: '곱셈 ×' },
    { cmd: '\\cdot', snippet: '\\cdot', desc: '내적 ·' }
  ];

  // Parse snippet containing $1, $2, ... into plain text + cursor tab stop offsets
  function compileSnippet(snippet, selectedText = '') {
    const stops = [];
    let out = '';
    let i = 0;
    while (i < snippet.length) {
      if (snippet[i] === '$' && /\d/.test(snippet[i + 1] || '')) {
        const num = Number(snippet[i + 1]);
        const pos = out.length;
        if (num === 1 && selectedText) {
          out += selectedText;
          stops.push({ num, start: pos, end: out.length });
        } else {
          stops.push({ num, start: pos, end: pos });
        }
        i += 2;
        continue;
      }
      out += snippet[i++];
    }
    stops.sort((a, b) => a.num - b.num);
    return { text: out, stops };
  }

  // Detect if caret is inside $ ... $ or $$ ... $$ (for MT-04 mini preview)
  function findMathAtCursor(text, caretPos) {
    // 1. Check display math $$ ... $$
    const blockRe = /\$\$([\s\S]*?)\$\$/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (caretPos >= start + 2 && caretPos <= end - 2) {
        return { expr: m[1], displayMode: true, start, end };
      }
    }
    // 2. Check inline math $ ... $ on the current line
    const lineStart = text.lastIndexOf('\n', Math.max(0, caretPos - 1)) + 1;
    let lineEnd = text.indexOf('\n', caretPos);
    if (lineEnd < 0) lineEnd = text.length;
    const lineText = text.slice(lineStart, lineEnd);
    const localPos = caretPos - lineStart;

    const inlineRe = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
    while ((m = inlineRe.exec(lineText)) !== null) {
      const s = m.index;
      const e = m.index + m[0].length;
      if (localPos >= s + 1 && localPos <= e - 1) {
        return { expr: m[1], displayMode: false, start: lineStart + s, end: lineStart + e };
      }
    }
    return null;
  }

  function isCursorInsideMath(text, caretPos) {
    return Boolean(findMathAtCursor(text, caretPos));
  }

  // ================= Naver-Style Equation Shortcut Engine (^, _, /, sqrt, Greek, Operators) =================
  const NAVER_WORD_SHORTCUTS = {
    sqrt: { text: '\\sqrt{}', cursorBack: 1 },
    cbrt: { text: '\\sqrt[3]{}', cursorBack: 1 },
    int: { text: '\\int_{}^{} ', cursorBack: 5 },
    sum: { text: '\\sum_{i=}^{} ', cursorBack: 5 },
    prod: { text: '\\prod_{i=}^{} ', cursorBack: 5 },
    lim: { text: '\\lim_{\\to } ', cursorBack: 6 },
    inf: { text: '\\infty ', cursorBack: 0 },
    infty: { text: '\\infty ', cursorBack: 0 },
    pi: { text: '\\pi ', cursorBack: 0 },
    alpha: { text: '\\alpha ', cursorBack: 0 },
    beta: { text: '\\beta ', cursorBack: 0 },
    gamma: { text: '\\gamma ', cursorBack: 0 },
    delta: { text: '\\delta ', cursorBack: 0 },
    Delta: { text: '\\Delta ', cursorBack: 0 },
    epsilon: { text: '\\varepsilon ', cursorBack: 0 },
    zeta: { text: '\\zeta ', cursorBack: 0 },
    eta: { text: '\\eta ', cursorBack: 0 },
    theta: { text: '\\theta ', cursorBack: 0 },
    lambda: { text: '\\lambda ', cursorBack: 0 },
    mu: { text: '\\mu ', cursorBack: 0 },
    rho: { text: '\\rho ', cursorBack: 0 },
    sigma: { text: '\\sigma ', cursorBack: 0 },
    tau: { text: '\\tau ', cursorBack: 0 },
    phi: { text: '\\phi ', cursorBack: 0 },
    Phi: { text: '\\Phi ', cursorBack: 0 },
    psi: { text: '\\psi ', cursorBack: 0 },
    omega: { text: '\\omega ', cursorBack: 0 },
    Omega: { text: '\\Omega ', cursorBack: 0 },
    sin: { text: '\\sin ', cursorBack: 0 },
    cos: { text: '\\cos ', cursorBack: 0 },
    tan: { text: '\\tan ', cursorBack: 0 },
    log: { text: '\\log ', cursorBack: 0 },
    ln: { text: '\\ln ', cursorBack: 0 },
    exp: { text: '\\exp ', cursorBack: 0 }
  };

  const NAVER_OP_SHORTCUTS = [
    ['<=', '\\le '],
    ['>=', '\\ge '],
    ['!=', '\\neq '],
    ['->', '\\to '],
    ['=>', '\\Rightarrow '],
    ['+-', '\\pm '],
    ['~=', '\\approx ']
  ];

  // Scan backwards from end of `before` to extract the mathematical numerator atom for `/` -> \frac{num}{den}
  function extractNumeratorBeforeCaret(before) {
    if (!before) return null;
    let end = before.length;
    // Forgive a single trailing space right after a closed group like `e^{5} /` or `(a+b) /`
    if (end >= 2 && before[end - 1] === ' ' && (before[end - 2] === '}' || before[end - 2] === ')')) {
      end -= 1;
    }
    if (end === 0) return null;
    const lastCh = before[end - 1];
    // Don't grab across operators, delimiters, or spaces
    if (/[\s+\-=,;:{[(^_\\<>|]/.test(lastCh)) return null;

    let i = end - 1;

    // Helper: walk back over a balanced group (...) or {...} or [...]
    const walkBalanced = (idx, openCh, closeCh) => {
      let depth = 0;
      let k = idx;
      while (k >= 0) {
        if (before[k] === closeCh) depth++;
        else if (before[k] === openCh) {
          depth--;
          if (depth === 0) return k;
        }
        k--;
      }
      return -1;
    };

    // Case 1: Ends with ')' — check if grouping parens (a+b) or function call f(x) / \sin(x)
    if (lastCh === ')') {
      const openIdx = walkBalanced(i, '(', ')');
      if (openIdx >= 0) {
        // Check if preceded by function name (e.g. f(x), \sin(x))
        let fnStart = openIdx;
        while (fnStart > 0 && /[A-Za-z\\]/.test(before[fnStart - 1])) fnStart--;
        const fnToken = before.slice(fnStart, openIdx);
        if (fnToken && (/^\\[A-Za-z]+$/.test(fnToken) || /^(sin|cos|tan|log|ln|exp|f|g|h|G|H|C|R|Y|X)$/.test(fnToken))) {
          return { start: fnStart, numerator: before.slice(fnStart, end) };
        }
        // Grouping parens: strip outer (...)
        return { start: openIdx, numerator: before.slice(openIdx + 1, end - 1) };
      }
      return null;
    }

    // Case 2: Walk backwards over compound atoms (e.g. e^{5}, x_{1}^{2}, \sqrt{x}, 2x, \alpha)
    let cur = end;
    let guard = 0;
    while (cur > 0 && guard++ < 12) {
      const ch = before[cur - 1];
      if (ch === '}') {
        const openIdx = walkBalanced(cur - 1, '{', '}');
        if (openIdx < 0) break;
        cur = openIdx;
        // Include preceding ^, _, or \command (like \sqrt, \frac{a}, \vec, etc.)
        if (cur > 0 && (before[cur - 1] === '^' || before[cur - 1] === '_')) {
          cur--;
          continue;
        }
        if (cur > 0 && before[cur - 1] === ']') {
          const brOpen = walkBalanced(cur - 1, '[', ']');
          if (brOpen >= 0) cur = brOpen;
        }
        if (cur > 0 && before[cur - 1] === '}') {
          continue; // e.g., \frac{a}{b}
        }
        let cmdStart = cur;
        while (cmdStart > 0 && /[A-Za-z]/.test(before[cmdStart - 1])) cmdStart--;
        if (cmdStart > 0 && before[cmdStart - 1] === '\\') {
          cur = cmdStart - 1;
          break;
        }
        break;
      } else if (/[A-Za-z0-9.]/.test(ch)) {
        while (cur > 0 && /[A-Za-z0-9.]/.test(before[cur - 1])) cur--;
        if (cur > 0 && before[cur - 1] === '\\') cur--;
        // Keep walking if this token is an exponent/subscript without braces (e.g. e^5)
        if (cur > 0 && (before[cur - 1] === '^' || before[cur - 1] === '_')) {
          cur--;
          continue;
        }
        break;
      } else {
        break;
      }
    }

    if (cur < end) {
      return { start: cur, numerator: before.slice(cur, end) };
    }
    return null;
  }

  const STANDALONE_MATH_WORDS = {
    sqrt: { text: '\\sqrt{}', cursorBack: 1 },
    cbrt: { text: '\\sqrt[3]{}', cursorBack: 1 },
    int: { text: '\\int_{}^{} ', cursorBack: 5 },
    sum: { text: '\\sum_{i=}^{} ', cursorBack: 5 },
    prod: { text: '\\prod_{i=}^{} ', cursorBack: 5 },
    lim: { text: '\\lim_{\\to } ', cursorBack: 6 }
  };

  function isInsideCodeAt(text, pos) {
    const before = text.slice(0, pos);
    const fenceMatches = before.match(/^```/gm);
    if (fenceMatches && fenceMatches.length % 2 === 1) return true;
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineBefore = before.slice(lineStart);
    const ticks = lineBefore.match(/`/g);
    return Boolean(ticks && ticks.length % 2 === 1);
  }

  // Apply Naver-style text shortcut on `beforeinput` (insertText) directly in Markdown!
  // Works seamlessly BOTH inside `$...$`/`$$...$$` AND directly in normal Markdown (auto-wrapping `$...$`).
  function applyNaverMathBeforeInput(el, e, onChanged, pushTabStopFn, { insideMath = true } = {}) {
    if (e.inputType !== 'insertText' || typeof e.data !== 'string' || e.data.length !== 1) return false;
    const ch = e.data;
    const val = el.value || '';
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const sel = val.slice(start, end);
    const before = val.slice(0, start);
    const after = val.slice(end);

    if (!insideMath && isInsideCodeAt(val, start)) return false;

    const setValAndCaret = (nextVal, caretStart, caretEnd = caretStart) => {
      el.value = nextVal;
      el.setSelectionRange(caretStart, caretEnd);
      if (typeof onChanged === 'function') onChanged(false);
    };

    // 1. `^` (지수) and `_` (아래첨자)
    if ((ch === '^' || ch === '_') && !before.endsWith('\\')) {
      if (insideMath) {
        e.preventDefault();
        if (sel) {
          const ins = `{${sel}}${ch}{}`;
          setValAndCaret(before + ins + after, start + ins.length - 1);
        } else {
          const ins = `${ch}{}`;
          setValAndCaret(before + ins + after, start + 2);
        }
        return true;
      }
      // Outside math: auto-wrap base atom like e^5 -> $e^{5}$, x_1 -> $x_{1}$ (skip Korean / markdown _italic_)
      if (sel && /^[A-Za-z0-9()+\-*/.\s]+$/.test(sel)) {
        e.preventDefault();
        const ins = `$${sel}${ch}{}$`;
        setValAndCaret(before + ins + after, start + ins.length - 2);
        return true;
      }
      const baseInfo = extractNumeratorBeforeCaret(before);
      if (baseInfo && baseInfo.numerator && /^[A-Za-z0-9().\\^_{}]+$/.test(baseInfo.numerator)) {
        // For `_`, require a short math variable/symbol base (avoid snake_case identifiers like my_var_name)
        if (ch === '_' && baseInfo.numerator.length > 4) return false;
        e.preventDefault();
        const prefix = before.slice(0, baseInfo.start);
        const rawBase = before.slice(baseInfo.start, start).trimEnd();
        const ins = `$${rawBase}${ch}{}$`;
        setValAndCaret(prefix + ins + after, prefix.length + ins.length - 2);
        return true;
      }
      return false;
    }

    // 2. `/` (분수식) -> a/b, (a+b)/c, e^{5}/2 -> \frac{num}{|} (auto-wrapped in $...$ if outside math)
    if (ch === '/' && !before.endsWith('\\')) {
      if (insideMath) {
        e.preventDefault();
        if (sel) {
          const ins = `\\frac{${sel}}{}`;
          setValAndCaret(before + ins + after, start + ins.length - 1);
          return true;
        }
        const numInfo = extractNumeratorBeforeCaret(before);
        if (numInfo && numInfo.numerator.length > 0) {
          const prefix = before.slice(0, numInfo.start);
          const ins = `\\frac{${numInfo.numerator}}{}`;
          setValAndCaret(prefix + ins + after, prefix.length + ins.length - 1);
        } else {
          const ins = '\\frac{}{}';
          const numCaret = start + 6;
          const denCaret = start + 8;
          if (typeof pushTabStopFn === 'function') pushTabStopFn({ start: denCaret, end: denCaret });
          setValAndCaret(before + ins + after, numCaret);
        }
        return true;
      }
      // Outside math: ignore URLs (http:/, https:/, file:/), comments (//), 4-digit years (2026/), Korean words
      if (/(https?:|file:|\/|:)$/i.test(before) || /\b\d{4}$/.test(before) || /[가-힣]$/.test(before)) {
        return false;
      }
      if (sel && /^[A-Za-z0-9()+\-*/.\s]+$/.test(sel)) {
        e.preventDefault();
        const ins = `$\\frac{${sel}}{}$`;
        setValAndCaret(before + ins + after, start + ins.length - 2);
        return true;
      }
      const numInfo = extractNumeratorBeforeCaret(before);
      if (numInfo && numInfo.numerator.length > 0 && /^[A-Za-z0-9()+\-.*\\^_{}\s]+$/.test(numInfo.numerator)) {
        // Avoid triggering on plain English words >= 4 letters (like "and/or", "input/output")
        if (/^[A-Za-z]{4,}$/.test(numInfo.numerator)) return false;
        e.preventDefault();
        const prefix = before.slice(0, numInfo.start);
        const ins = `$\\frac{${numInfo.numerator}}{}$`;
        setValAndCaret(prefix + ins + after, prefix.length + ins.length - 2);
        return true;
      }
      return false;
    }

    // 3. `(` after `sqrt` -> \sqrt{|} (or $\sqrt{|}$ outside math)
    if (ch === '(' && start === end) {
      const mSqrt = before.match(/(^|[^\\A-Za-z])(sqrt)$/);
      if (mSqrt) {
        e.preventDefault();
        const tokStart = start - 4;
        const ins = insideMath ? '\\sqrt{}' : '$\\sqrt{}$';
        const caret = insideMath ? tokStart + 6 : tokStart + 7;
        setValAndCaret(val.slice(0, tokStart) + ins + after, caret);
        return true;
      }
    }

    // 4. `Space`: expand math words OR cleanly exit `}` / `$` block!
    if (ch === ' ' && start === end) {
      const wordMatch = before.match(/(^|[^\\A-Za-z])([A-Za-z]{2,8})$/);
      if (wordMatch) {
        const word = wordMatch[2];
        const sc = insideMath ? NAVER_WORD_SHORTCUTS[word] : STANDALONE_MATH_WORDS[word];
        if (sc) {
          e.preventDefault();
          const wStart = start - word.length;
          if (insideMath) {
            const nextVal = val.slice(0, wStart) + sc.text + after;
            const caret = wStart + sc.text.length - sc.cursorBack;
            setValAndCaret(nextVal, caret);
          } else {
            const wrapped = `$${sc.text.trimEnd()}$`;
            const backAdjust = sc.cursorBack + (sc.text.endsWith(' ') ? 0 : 1);
            const nextVal = val.slice(0, wStart) + wrapped + after;
            const caret = wStart + wrapped.length - backAdjust;
            setValAndCaret(nextVal, caret);
          }
          return true;
        }
      }
      if (insideMath) {
        if ((after.startsWith('}^{') || after.startsWith('}_{')) && before.length > 0 && !before.endsWith('{')) {
          e.preventDefault();
          el.setSelectionRange(start + 3, start + 3);
          if (typeof onChanged === 'function') onChanged(true);
          return true;
        }
        if (after.startsWith('}{') && before.length > 0 && !before.endsWith('{')) {
          e.preventDefault();
          el.setSelectionRange(start + 2, start + 2);
          if (typeof onChanged === 'function') onChanged(true);
          return true;
        }
        if (after.startsWith('}') && before.length > 0 && !before.endsWith('{')) {
          e.preventDefault();
          el.setSelectionRange(start + 1, start + 1);
          if (typeof onChanged === 'function') onChanged(true);
          return true;
        }
        // Pressing Space right before closing `$` exits inline math smoothly into normal text!
        if (after.startsWith('$') && !after.startsWith('$$') && before.length > 0 && !before.endsWith('$')) {
          e.preventDefault();
          const nextVal = before + '$ ' + after.slice(1);
          setValAndCaret(nextVal, start + 2);
          return true;
        }
      }
    }

    // 5. Two-character math operators (inside math)
    if (insideMath && start === end) {
      const pair = (before.slice(-1) || '') + ch;
      const foundOp = NAVER_OP_SHORTCUTS.find(([k]) => k === pair);
      if (foundOp && !before.endsWith('\\' + pair[0])) {
        e.preventDefault();
        const opStart = start - 1;
        const rep = foundOp[1];
        setValAndCaret(val.slice(0, opStart) + rep + after, opStart + rep.length);
        return true;
      }
    }

    return false;
  }

  // Apply non-text navigation shortcuts on `keydown` (`Tab` word expansion + brace/math exit)
  function applyNaverMathKeydown(el, e, onChanged, { insideMath = true } = {}) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
    if (e.key !== 'Tab' || e.shiftKey) return false;
    const val = el.value || '';
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    if (start !== end) return false;
    if (!insideMath && isInsideCodeAt(val, start)) return false;
    const before = val.slice(0, start);
    const after = val.slice(end);

    const wordMatch = before.match(/(^|[^\\A-Za-z])([A-Za-z]{2,8})$/);
    if (wordMatch) {
      const word = wordMatch[2];
      const sc = insideMath ? NAVER_WORD_SHORTCUTS[word] : STANDALONE_MATH_WORDS[word];
      if (sc) {
        e.preventDefault();
        const wStart = start - word.length;
        if (insideMath) {
          el.value = val.slice(0, wStart) + sc.text + after;
          const caret = wStart + sc.text.length - sc.cursorBack;
          el.setSelectionRange(caret, caret);
        } else {
          const wrapped = `$${sc.text.trimEnd()}$`;
          const backAdjust = sc.cursorBack + (sc.text.endsWith(' ') ? 0 : 1);
          el.value = val.slice(0, wStart) + wrapped + after;
          const caret = wStart + wrapped.length - backAdjust;
          el.setSelectionRange(caret, caret);
        }
        if (typeof onChanged === 'function') onChanged(false);
        return true;
      }
    }

    if (insideMath) {
      if (after.startsWith('}^{') || after.startsWith('}_{')) {
        e.preventDefault();
        el.setSelectionRange(start + 3, start + 3);
        if (typeof onChanged === 'function') onChanged(true);
        return true;
      }
      if (after.startsWith('}{')) {
        e.preventDefault();
        el.setSelectionRange(start + 2, start + 2);
        if (typeof onChanged === 'function') onChanged(true);
        return true;
      }
      if (after.startsWith('}')) {
        e.preventDefault();
        el.setSelectionRange(start + 1, start + 1);
        if (typeof onChanged === 'function') onChanged(true);
        return true;
      }
      if (after.startsWith('$') && !after.startsWith('$$')) {
        e.preventDefault();
        el.setSelectionRange(start + 1, start + 1);
        if (typeof onChanged === 'function') onChanged(true);
        return true;
      }
    }
    return false;
  }

  // ================= Word (MathML) & HWP (한글 수식 스크립트) Converters =================
  function readBalancedGroup(str, openIdx, openCh = '{', closeCh = '}') {
    if (str[openIdx] !== openCh) return null;
    let depth = 0;
    for (let i = openIdx; i < str.length; i++) {
      if (str[i] === openCh) depth++;
      else if (str[i] === closeCh) {
        depth--;
        if (depth === 0) return { start: openIdx + 1, end: i, value: str.slice(openIdx + 1, i), nextIdx: i + 1 };
      }
    }
    return null;
  }

  function convertLatexToHwp(tex) {
    let s = String(tex || '').trim();
    // Convert \frac{a}{b} -> {a} over {b} (iteratively handles nested fractions)
    for (let pass = 0; pass < 6; pass++) {
      const idx = s.indexOf('\\frac');
      if (idx < 0) break;
      let p = idx + 5;
      while (p < s.length && s[p] === ' ') p++;
      const g1 = readBalancedGroup(s, p);
      if (!g1) break;
      let p2 = g1.nextIdx;
      while (p2 < s.length && s[p2] === ' ') p2++;
      const g2 = readBalancedGroup(s, p2);
      if (!g2) break;
      s = s.slice(0, idx) + `{${g1.value}} over {${g2.value}}` + s.slice(g2.nextIdx);
    }
    // Convert \sqrt[n]{x} -> root {n} of {x} and \sqrt{x} -> sqrt {x}
    s = s.replace(/\\sqrt\[([^\]]+)\]\{([^{}]*)\}/g, 'root {$1} of {$2}');
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt {$1}');
    // Matrix / Cases environments
    s = s.replace(/\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/g, (_, body) =>
      `left [ matrix{${body.trim().replace(/\\\\/g, ' # ').replace(/&/g, ' & ')}} right ]`
    );
    s = s.replace(/\\begin\{pmatrix\}([\s\S]*?)\\end\{pmatrix\}/g, (_, body) =>
      `left ( matrix{${body.trim().replace(/\\\\/g, ' # ').replace(/&/g, ' & ')}} right )`
    );
    s = s.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g, (_, body) =>
      `cases{${body.trim().replace(/\\\\/g, ' # ').replace(/&/g, ' & ')}}`
    );
    // Common LaTeX commands -> HWP equation keywords
    const map = [
      [/\\iint/g, 'dint'], [/\\oint/g, 'oint'], [/\\int/g, 'int'],
      [/\\sum/g, 'sum'], [/\\prod/g, 'prod'], [/\\lim/g, 'lim'],
      [/\\infty/g, 'inf'], [/\\partial/g, 'partial'], [/\\nabla/g, 'nabla'],
      [/\\times/g, 'times'], [/\\cdot/g, 'cdot'], [/\\pm/g, '+-'],
      [/\\leq?/g, '<='], [/\\geq?/g, '>='], [/\\neq/g, '!='],
      [/\\approx/g, 'approx'], [/\\equiv/g, 'equiv'], [/\\propto/g, 'prop'],
      [/\\Rightarrow/g, '=>'], [/\\Leftrightarrow/g, '<=>'], [/\\to/g, '->'],
      [/\\forall/g, 'forall'], [/\\exists/g, 'exists'], [/\\in\b/g, 'in'],
      [/\\left\(/g, 'left ('], [/\\right\)/g, 'right )'],
      [/\\left\[/g, 'left ['], [/\\right\]/g, 'right ]'],
      [/\\text\{([^{}]*)\}/g, '"$1"'],
      [/\\overline\{([^{}]*)\}/g, 'bar {$1}'],
      [/\\vec\{([^{}]*)\}/g, 'vec {$1}'],
      [/\\hat\{([^{}]*)\}/g, 'hat {$1}'],
      [/\\dot\{([^{}]*)\}/g, 'dot {$1}'],
      [/\\ddot\{([^{}]*)\}/g, 'ddot {$1}'],
      [/\\varepsilon/g, 'epsilon'],
      [/\\(alpha|beta|gamma|delta|Delta|zeta|eta|theta|lambda|mu|pi|rho|sigma|tau|phi|Phi|psi|omega|Omega|sin|cos|tan|log|ln|exp)\b/g, '$1'],
      [/\\,/g, ' ']
    ];
    map.forEach(([re, rep]) => { s = s.replace(re, rep); });
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // ================= Formula Slot Parser (for Mouse Click-to-Edit in Live Preview) =================
  function extractFormulaSlots(expr) {
    const slots = [];
    const s = String(expr || '');
    let i = 0;

    while (i < s.length) {
      // 1. \int, \iint, \oint, \sum, \prod with optional _{lower} and ^{upper}
      const opM = s.slice(i).match(/^\\(iint|oint|int|sum|prod|lim)(?![A-Za-z])/);
      if (opM) {
        const opName = opM[1];
        const opKor = opName === 'lim' ? '극한' : (opName === 'sum' ? '시그마' : (opName === 'prod' ? '곱' : '적분'));
        let p = i + opM[0].length;
        for (let pass = 0; pass < 2; pass++) {
          while (p < s.length && s[p] === ' ') p++;
          if (s[p] === '_' || s[p] === '^') {
            const isSup = s[p] === '^';
            p++;
            while (p < s.length && s[p] === ' ') p++;
            if (s[p] === '{') {
              const g = readBalancedGroup(s, p);
              if (g) {
                slots.push({
                  kind: isSup ? 'op-upper' : 'op-lower',
                  label: opName === 'lim' ? '극한 조건' : `${opKor} ${isSup ? '상한(위)' : '하한(아래)'}`,
                  start: g.start,
                  end: g.end,
                  value: g.value
                });
                p = g.nextIdx;
              }
            } else if (p < s.length) {
              slots.push({
                kind: isSup ? 'op-upper' : 'op-lower',
                label: opName === 'lim' ? '극한 조건' : `${opKor} ${isSup ? '상한(위)' : '하한(아래)'}`,
                start: p,
                end: p + 1,
                value: s[p],
                wrapBraces: true
              });
              p++;
            }
          }
        }
        i = p;
        continue;
      }

      // 2. \frac{num}{den}
      if (s.startsWith('\\frac', i)) {
        let p = i + 5;
        while (p < s.length && s[p] === ' ') p++;
        const g1 = readBalancedGroup(s, p);
        if (g1) {
          slots.push({ kind: 'frac-num', label: '분자 (위)', start: g1.start, end: g1.end, value: g1.value });
          let p2 = g1.nextIdx;
          while (p2 < s.length && s[p2] === ' ') p2++;
          const g2 = readBalancedGroup(s, p2);
          if (g2) {
            slots.push({ kind: 'frac-den', label: '분모 (아래)', start: g2.start, end: g2.end, value: g2.value });
          }
          i += 5;
          continue;
        }
      }

      // 3. \sqrt[n]{body} or \sqrt{body}
      if (s.startsWith('\\sqrt', i)) {
        let p = i + 5;
        while (p < s.length && s[p] === ' ') p++;
        if (s[p] === '[') {
          const gn = readBalancedGroup(s, p, '[', ']');
          if (gn) {
            slots.push({ kind: 'sqrt-n', label: '제곱근 차수', start: gn.start, end: gn.end, value: gn.value });
            p = gn.nextIdx;
          }
        }
        while (p < s.length && s[p] === ' ') p++;
        const gb = readBalancedGroup(s, p);
        if (gb) {
          slots.push({ kind: 'sqrt-body', label: '루트 내부', start: gb.start, end: gb.end, value: gb.value });
        }
        i += 5;
        continue;
      }

      // 4. General superscript `^{...}` or subscript `_{...}`
      if ((s[i] === '^' || s[i] === '_') && s[i - 1] !== '\\') {
        const isSup = s[i] === '^';
        let p = i + 1;
        while (p < s.length && s[p] === ' ') p++;
        if (s[p] === '{') {
          const g = readBalancedGroup(s, p);
          if (g) {
            const already = slots.some((sl) => sl.start === g.start && sl.end === g.end);
            if (!already) {
              slots.push({
                kind: isSup ? 'sup' : 'sub',
                label: isSup ? '지수 (위첨자)' : '아래첨자',
                start: g.start,
                end: g.end,
                value: g.value
              });
            }
          }
        } else if (p < s.length && /[A-Za-z0-9]/.test(s[p])) {
          const already = slots.some((sl) => sl.start === p && sl.end === p + 1);
          if (!already) {
            slots.push({
              kind: isSup ? 'sup' : 'sub',
              label: isSup ? '지수 (위첨자)' : '아래첨자',
              start: p,
              end: p + 1,
              value: s[p],
              wrapBraces: true
            });
          }
        }
      }

      i++;
    }
    return slots;
  }

  function toggleCheckboxInMarkdown(mdText, targetIndex) {
    let idx = 0;
    return String(mdText || '').replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/gm, (match, prefix, mark, suffix) => {
      if (idx++ === targetIndex) {
        return `${prefix}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}`;
      }
      return match;
    });
  }

  // ================= FS-04: Standalone Offline HTML & Print-PDF CSS =================
  function collectInlineKatexCss() {
    let cssText = '';
    try {
      for (const sheet of Array.from(document.styleSheets || [])) {
        if (sheet.href && sheet.href.includes('katex')) {
          try {
            const rules = Array.from(sheet.cssRules || []).map((r) => r.cssText).join('\n');
            cssText += rules + '\n';
          } catch (_) {}
        }
      }
    } catch (_) {}
    return cssText;
  }

  function buildStandaloneDocumentHtml(title, bodyHtml, isForPrint = false) {
    const safeTitle = global.BrainMarkdown.escapeHtml(title || 'Document');
    const katexCss = collectInlineKatexCss();
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
${katexCss}
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", "Segoe UI", sans-serif;
  line-height: 1.75;
  color: #111827;
  background: #ffffff;
  max-width: 840px;
  margin: 0 auto;
  padding: 36px 28px 64px;
  font-size: 15px;
}
h1, h2, h3, h4 { color: #0f172a; margin-top: 1.6em; margin-bottom: 0.55em; line-height: 1.3; }
h1 { font-size: 1.85em; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; }
h2 { font-size: 1.4em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25em; }
p { margin: 0 0 0.9em; }
blockquote { border-left: 4px solid #3b82f6; background: #f8fafc; margin: 1em 0; padding: 10px 14px; color: #334155; border-radius: 0 6px 6px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: #f1f5f9; padding: 2px 5px; border-radius: 4px; }
pre { background: #1e293b; color: #e2e8f0; padding: 14px 16px; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
pre code { background: transparent; color: inherit; padding: 0; }
.code-block-wrap { position: relative; margin: 1em 0; }
.code-lang-badge { position: absolute; top: 6px; right: 10px; font-size: 11px; color: #94a3b8; text-transform: uppercase; }
.hl-comment { color: #94a3b8; font-style: italic; }
.hl-str { color: #86efac; }
.hl-num { color: #fda4af; }
.hl-kw { color: #93c5fd; font-weight: 600; }
.md-table-wrap { overflow-x: auto; margin: 1em 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.94em; }
th, td { border: 1px solid #cbd5e1; padding: 8px 11px; }
th { background: #f1f5f9; font-weight: 700; }
.md-math-block { text-align: center; margin: 1.15em 0; padding: 8px 12px; overflow-x: auto; }
.md-offline-math { font-family: "Cambria Math", "Times New Roman", Georgia, serif; }
.md-offline-math.display { font-size: 1.22em; }
.md-m-frac { display: inline-flex; flex-direction: column; align-items: center; vertical-align: middle; margin: 0 3px; font-size: 0.92em; }
.md-m-num { border-bottom: 1px solid currentColor; padding: 0 4px 1px; }
.md-m-den { padding: 1px 4px 0; }
.md-m-rad { border-top: 1px solid currentColor; padding: 0 3px; }
.md-m-env table { display: inline-table; width: auto; border-collapse: collapse; vertical-align: middle; }
.md-m-env td { border: none; padding: 2px 6px; text-align: center; }
.md-m-bmatrix table { border-left: 2px solid currentColor; border-right: 2px solid currentColor; }
.md-m-pmatrix table { border-left: 2px solid currentColor; border-right: 2px solid currentColor; border-radius: 8px; }
.md-m-cases table { border-left: 2px solid currentColor; }
.md-inline-img { max-width: 100%; height: auto; border-radius: 6px; margin: 8px 0; }
.md-mermaid-wrap { text-align: center; margin: 1.2em 0; }
.md-mermaid-wrap svg { max-width: 100%; height: auto; }
.md-checklist { list-style: none; padding-left: 4px; }
.md-footnotes { font-size: 0.88em; color: #475569; margin-top: 2em; }
@media print {
  body { max-width: none; padding: 0; font-size: 11.5pt; }
  h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
  .md-math-block, .md-table-wrap, table, pre, .code-block-wrap, .md-mermaid-wrap, blockquote, img {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  a { color: #111827; text-decoration: none; }
}
</style>
</head>
<body>
${bodyHtml}
${isForPrint ? '<script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 250); });</script>' : ''}
</body>
</html>`;
  }

  // ================= Mount Full Math & Engineering Markdown Studio =================
  function mountMathMarkdownEditor(container, options = {}) {
    const MD = global.BrainMarkdown;
    let currentMode = options.initialMode || 'split'; // 'edit' | 'split' | 'view'
    let showLeftPanel = true;
    let leftPanelTab = currentMode === 'view' ? 'toc' : 'palette'; // 'palette' | 'toc'
    let naverShortcutInMd = true;   // enable ^, _, /, sqrt, int, sum shortcuts directly in Markdown
    let topPaneHeightPx = null;     // user-dragged height of Top Live Preview pane
    let activePaletteCat = PALETTE_CATEGORIES[0].id;
    let renderedMathList = [];      // [{ idx, start, end, expr, displayMode }]
    let activeSlotPopover = null;
    let isDirty = false;
    let previewFontSize = 14;
    let editorFontSize = 13.5;

    let renderDebounceTimer = null;
    let mermaidDebounceTimer = null;
    let autoSaveTimer = null;
    let scrollSyncLock = null;

    // Snippet tab-stop queue
    let pendingTabStops = [];

    // Autocomplete state
    let acMatches = [];
    let acSelectedIdx = 0;
    let acTokenStart = -1;

    // Search state
    let searchMatches = [];
    let searchCurrentIdx = -1;

    // ---- Build 4-Zone Studio DOM ----
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'mmd-root';

    // 1. Top Main Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'mmd-toolbar';
    toolbar.innerHTML = `
      <div class="mmd-tb-row">
        <div class="mmd-tb-group">
          <div class="md-mode-tabs">
            <button type="button" class="md-mode-btn" data-mode="edit" title="에디터 단독">✏️ 편집</button>
            <button type="button" class="md-mode-btn" data-mode="split" title="상하 실시간 분할">⚡ 분할</button>
            <button type="button" class="md-mode-btn" data-mode="view" title="프리뷰 단독">📖 프리뷰</button>
          </div>
          <button type="button" class="mmd-btn active" data-cmd="toggle-left" title="좌측 수식·목차 패널 토글">∑ 수식·목차</button>
          <button type="button" class="mmd-btn" data-cmd="toggle-postits" title="문서 포스트잇 노트 목록 열기/닫기">📌 포스트잇 (${(options.item?.postits || []).length})</button>
          <button type="button" class="mmd-btn" data-cmd="toggle-find" title="검색 및 치환 (Ctrl+F / Ctrl+H)">🔍 찾기</button>
        </div>

        <div class="mmd-tb-group mmd-fmt-group">
          <button type="button" class="mmd-btn" data-fmt="h1" title="제목 1">H1</button>
          <button type="button" class="mmd-btn" data-fmt="h2" title="제목 2">H2</button>
          <button type="button" class="mmd-btn" data-fmt="h3" title="제목 3">H3</button>
          <button type="button" class="mmd-btn" data-fmt="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
          <button type="button" class="mmd-btn" data-fmt="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
          <button type="button" class="mmd-btn" data-fmt="strike" title="취소선"><s>S</s></button>
          <button type="button" class="mmd-btn" data-fmt="link" title="링크 (Ctrl+K)">🔗</button>
          <button type="button" class="mmd-btn" data-fmt="code" title="코드 블록">&lt;/&gt;</button>
          <button type="button" class="mmd-btn" data-fmt="check" title="체크리스트">☑️</button>
          <button type="button" class="mmd-btn" data-cmd="table-wizard" title="표 생성 마법사">▦ 표</button>
          <button type="button" class="mmd-btn math-accent" data-fmt="math-inline" title="인라인 수식 (Ctrl+M)">$x$</button>
          <button type="button" class="mmd-btn math-accent" data-fmt="math-block" title="블록 수식 (Ctrl+Shift+M)">$$∑$$</button>
          <button type="button" class="mmd-btn" data-fmt="mermaid" title="Mermaid 블록선도/순서도 삽입">📊 다이어그램</button>
        </div>

        <div class="mmd-tb-group mmd-tb-right">
          <button type="button" class="mmd-btn" data-cmd="font-dec" title="글꼴 작게">A-</button>
          <button type="button" class="mmd-btn" data-cmd="font-inc" title="글꼴 크게">A+</button>
          <button type="button" class="mmd-btn" data-cmd="open-md" title="로컬 .md/.txt 파일 열기">📂 열기</button>
          <button type="button" class="mmd-btn" data-cmd="export-md" title=".md 파일 다운로드">⬇️ .md</button>
          <button type="button" class="mmd-btn" data-cmd="export-html" title="오프라인 단독 HTML 파일 내보내기">🌐 HTML</button>
          <button type="button" class="mmd-btn" data-cmd="export-pdf" title="인쇄 최적화 PDF 출력">🖨️ PDF</button>
          <button type="button" class="mmd-btn" data-cmd="copy-md" title="마크다운 원문 복사">📋</button>
          <button type="button" class="mmd-btn primary" data-cmd="save" title="저장 (Ctrl+S)">💾 저장</button>
          <span class="md-save-indicator" data-role="save-ind">저장됨</span>
        </div>
      </div>
    `;

    // 1c. Find & Replace Bar (ED-05)
    const findBar = document.createElement('div');
    findBar.className = 'mmd-find-bar';
    findBar.style.display = 'none';
    findBar.innerHTML = `
      <div class="mmd-find-group">
        <input type="text" class="mmd-find-inp" data-role="find-q" placeholder="찾을 내용...">
        <button type="button" class="mmd-btn" data-fopt="case" title="대소문자 구분">Aa</button>
        <button type="button" class="mmd-btn" data-fopt="regex" title="정규식(Regex) 검색">.*</button>
        <span class="mmd-find-count" data-role="find-count">0/0</span>
        <button type="button" class="mmd-btn" data-fcmd="prev" title="이전">▲</button>
        <button type="button" class="mmd-btn" data-fcmd="next" title="다음">▼</button>
      </div>
      <div class="mmd-find-group">
        <input type="text" class="mmd-find-inp" data-role="replace-q" placeholder="바꿀 내용...">
        <button type="button" class="mmd-btn" data-fcmd="replace">바꾸기</button>
        <button type="button" class="mmd-btn" data-fcmd="replace-all">모두 바꾸기</button>
        <button type="button" class="mmd-btn" data-fcmd="close">✕</button>
      </div>
    `;

    // 1d. Table Wizard Popover (ED-03)
    const tableWizard = document.createElement('div');
    tableWizard.className = 'mmd-table-wizard';
    tableWizard.style.display = 'none';
    let gridCellsHtml = '';
    for (let r = 1; r <= 6; r++) {
      for (let c = 1; c <= 8; c++) {
        gridCellsHtml += `<div class="mmd-tw-cell" data-r="${r}" data-c="${c}"></div>`;
      }
    }
    tableWizard.innerHTML = `
      <div class="mmd-tw-head">
        <span data-role="tw-label">표 크기 선택: 3 × 3</span>
        <select class="mmd-tw-align" data-role="tw-align" title="열 정렬">
          <option value="left">왼쪽 (:---)</option>
          <option value="center" selected>가운데 (:---:)</option>
          <option value="right">오른쪽 (---:)</option>
        </select>
      </div>
      <div class="mmd-tw-grid">${gridCellsHtml}</div>
    `;

    // 2. Main Body (Left: Equation/TOC Studio | Center: Top Preview ↕ Bottom Markdown | Right: Post-it Notes)
    const workspace = document.createElement('div');
    workspace.className = 'mmd-workspace';
    workspace.dataset.mode = currentMode;

    // 2a. Left Studio Sidebar (Tabbed: ∑ 수식·특수문자 팔레트 | 📑 문서 목차)
    const tocPane = document.createElement('aside');
    tocPane.className = 'mmd-toc-pane mmd-left-studio';
    const paletteTabsHtml = PALETTE_CATEGORIES.map((c) =>
      `<button type="button" class="mmd-ptab${c.id === activePaletteCat ? ' active' : ''}" data-pcat="${c.id}">${c.label}</button>`
    ).join('');
    tocPane.innerHTML = `
      <div class="mmd-left-tabs">
        <button type="button" class="mmd-ltab${leftPanelTab === 'palette' ? ' active' : ''}" data-ltab="palette">∑ 수식 · 기호</button>
        <button type="button" class="mmd-ltab${leftPanelTab === 'toc' ? ' active' : ''}" data-ltab="toc">📑 목차</button>
      </div>
      <div class="mmd-left-body" data-lpanel="palette" style="display:${leftPanelTab === 'palette' ? 'flex' : 'none'};">
        <div class="mmd-palette-cats">${paletteTabsHtml}</div>
        <div class="mmd-palette-grid" data-role="palette-items"></div>
      </div>
      <div class="mmd-left-body" data-lpanel="toc" style="display:${leftPanelTab === 'toc' ? 'flex' : 'none'};">
        <div class="mmd-toc-list" data-role="toc-list"></div>
      </div>
    `;

    // Keep paletteBar ref pointing inside tocPane for clean compatibility
    const paletteBar = tocPane.querySelector('[data-lpanel="palette"]');

    // 2b. Unified Vertical Split Studio (Top: Live Math+MD Preview ↕ Draggable Resizer ↕ Bottom: Markdown Editor with Instant Shortcuts)
    const editorPane = document.createElement('div');
    editorPane.className = 'mmd-editor-pane mmd-vsplit-pane';

    // 2b-1. TOP Pane: Live Math & Document Preview (Clean Notion/Typora paper look + Mouse-Clickable Formula Slots!)
    const previewPane = document.createElement('div');
    previewPane.className = 'mmd-preview-pane mmd-top-preview-pane';
    const previewHeader = document.createElement('div');
    previewHeader.className = 'mmd-top-preview-bar';
    previewHeader.innerHTML = `
      <span class="mmd-tp-title">✨ 실시간 문서 · 수식 편집 미리보기</span>
      <span class="mmd-tp-tip">클릭해 커서 이동 · 직접 입력 가능 · 수식 클릭 시 상/하한·분자·분모 편집 · 우클릭 Word/한글 복사</span>
    `;
    const previewScrollArea = document.createElement('div');
    previewScrollArea.className = 'mmd-top-preview-scroll';
    const viewerInner = document.createElement('div');
    viewerInner.className = 'mmd-preview-inner markdown-body mmd-preview-editable';
    viewerInner.contentEditable = 'true';
    viewerInner.spellcheck = false;
    viewerInner.setAttribute('data-placeholder', '여기에 커서를 두고 바로 문서·수식을 입력하거나 아래 마크다운 창에서 작성하세요...');
    previewScrollArea.appendChild(viewerInner);
    previewPane.appendChild(previewHeader);
    previewPane.appendChild(previewScrollArea);

    // 2b-2. Draggable Horizontal Resizer Bar between Top Preview and Bottom Markdown Editor
    const vResizer = document.createElement('div');
    vResizer.className = 'mmd-v-resizer';
    vResizer.title = '위/아래 창 크기 드래그 조절';
    vResizer.innerHTML = `<span class="mmd-v-resizer-grip"></span>`;

    // 2b-3. Bottom Section Header + Markdown Editor
    const mdSectionBar = document.createElement('div');
    mdSectionBar.className = 'mmd-md-divider';
    mdSectionBar.innerHTML = `
      <span>📝 마크다운 언어 작성 (Markdown)</span>
      <label class="mmd-neq-md-sc-toggle" title="마크다운 입력 중 e^5, a/b, sqrt, int 등을 바로 수식으로 자동 변환합니다">
        <input type="checkbox" data-role="md-math-sc" checked>
        <span>수식 즉시 단축키 (^, _, /, sqrt, int)</span>
      </label>
    `;

    const editorScrollWrap = document.createElement('div');
    editorScrollWrap.className = 'mmd-editor-wrap';

    const gutter = document.createElement('div');
    gutter.className = 'mmd-gutter';

    const textarea = document.createElement('textarea');
    textarea.className = 'mmd-textarea';
    textarea.spellcheck = false;
    textarea.placeholder = '# 여기에 마크다운을 작성하세요 — e^5, a/b, (a+b)/c, sqrt+Space, int+Space 입력 시 바로 수식이 위 창에 실시간 표시됩니다!';

    // MT-02: Autocomplete dropdown
    const acPopup = document.createElement('div');
    acPopup.className = 'mmd-ac-popup';
    acPopup.style.display = 'none';

    // MT-04: Cursor mini math preview tooltip (shown in edit-only mode)
    const mathTooltip = document.createElement('div');
    mathTooltip.className = 'mmd-math-tooltip';
    mathTooltip.style.display = 'none';

    editorScrollWrap.appendChild(gutter);
    editorScrollWrap.appendChild(textarea);
    editorPane.appendChild(previewPane);
    editorPane.appendChild(vResizer);
    editorPane.appendChild(mdSectionBar);
    editorPane.appendChild(editorScrollWrap);
    editorPane.appendChild(acPopup);
    editorPane.appendChild(mathTooltip);

    workspace.appendChild(tocPane);
    workspace.appendChild(editorPane);

    // 3. Bottom Status Bar (Stats + Math Error Alert + KaTeX Engine Status)
    const statusBar = document.createElement('div');
    statusBar.className = 'mmd-statusbar';
    statusBar.innerHTML = `
      <div class="mmd-stat-left">
        <span data-role="engine-badge">∑ Math Studio</span>
        <button type="button" class="mmd-err-badge" data-role="err-badge" style="display:none;"></button>
      </div>
      <div class="mmd-stat-right" data-role="stat-right">0자 · 0줄 · Ln 1, Col 1</div>
    `;

    // Hidden local file open input (FS-01)
    const openFileInput = document.createElement('input');
    openFileInput.type = 'file';
    openFileInput.accept = '.md,.markdown,.txt';
    openFileInput.style.display = 'none';

    root.appendChild(toolbar);
    root.appendChild(findBar);
    root.appendChild(tableWizard);
    root.appendChild(workspace);
    root.appendChild(statusBar);
    root.appendChild(openFileInput);
    container.appendChild(root);

    // Mount Right-Side Post-it Notes Drawer (PDF/HTML/MD Unified Sticky Notes)
    const elBtnPostits = toolbar.querySelector('[data-cmd="toggle-postits"]');
    const mdPostitCtrl = (global.BrainDocPostits && options.item)
      ? global.BrainDocPostits.mountPostitSidebar(workspace, {
          item: options.item,
          viewerType: 'markdown',
          initialOpen: false,
          getCurrentAnchor: () => {
            const val = textarea.value || '';
            const pos = textarea.selectionStart || 0;
            const line = val.slice(0, pos).split('\n').length;
            const lineTxt = (val.split('\n')[line - 1] || '').replace(/^#+\s*/, '').trim().slice(0, 14);
            return {
              label: lineTxt ? `L.${line} · ${lineTxt}` : `L.${line}`,
              line,
              scrollTop: textarea.scrollTop || 0
            };
          },
          onJumpToAnchor: (note) => {
            if (currentMode === 'view') setMode('split');
            jumpToEditorLine(note.line || 1);
          },
          onPersist: () => {
            if (typeof options.onPersistPostits === 'function') options.onPersistPostits(options.item);
          },
          onCountChange: (cnt) => {
            if (elBtnPostits) elBtnPostits.textContent = `📌 포스트잇 (${cnt})`;
          },
          onToast: options.onToast
        })
      : null;

    // Left panel tab switcher (∑ 수식 · 기호 <-> 📑 목차)
    tocPane.querySelectorAll('[data-ltab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        leftPanelTab = tabBtn.dataset.ltab || 'palette';
        tocPane.querySelectorAll('[data-ltab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
        tocPane.querySelectorAll('[data-lpanel]').forEach((p) => {
          p.style.display = p.dataset.lpanel === leftPanelTab ? 'flex' : 'none';
        });
      });
    });

    const elPaletteItems = paletteBar.querySelector('[data-role="palette-items"]');
    const elTocList = tocPane.querySelector('[data-role="toc-list"]');
    const elSaveInd = toolbar.querySelector('[data-role="save-ind"]');
    const elEngineBadge = statusBar.querySelector('[data-role="engine-badge"]');
    const elErrBadge = statusBar.querySelector('[data-role="err-badge"]');
    const elStatRight = statusBar.querySelector('[data-role="stat-right"]');
    const elFindQ = findBar.querySelector('[data-role="find-q"]');
    const elReplaceQ = findBar.querySelector('[data-role="replace-q"]');
    const elFindCount = findBar.querySelector('[data-role="find-count"]');
    const elFmtGroup = toolbar.querySelector('.mmd-fmt-group');
    const elMdMathScChk = mdSectionBar.querySelector('[data-role="md-math-sc"]');

    elMdMathScChk?.addEventListener('change', () => {
      naverShortcutInMd = Boolean(elMdMathScChk.checked);
    });

    // Clicking outer paper margin of Top Preview focuses editable viewerInner smoothly
    previewScrollArea.addEventListener('click', (e) => {
      if (e.target === previewScrollArea) {
        viewerInner.focus();
      }
    });

    // ---- Two-Way Direct Editing inside Top Live Preview (`viewerInner`) ----
    let isSyncingFromPreview = false;

    function serializeInlineNodes(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node;
      if (el.classList.contains('mmd-live-math')) {
        return el.dataset.rawTex || '';
      }
      if (el.classList.contains('mmd-pi-inline-arrow')) {
        return '';
      }
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      const inner = Array.from(el.childNodes).map(serializeInlineNodes).join('');
      if (tag === 'strong' || tag === 'b') return inner ? `**${inner}**` : '';
      if (tag === 'em' || tag === 'i') return inner ? `*${inner}*` : '';
      if (tag === 'del' || tag === 's') return inner ? `~~${inner}~~` : '';
      if (tag === 'code') return `\`${inner}\``;
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        return href ? `[${inner}](${href})` : inner;
      }
      return inner;
    }

    function serializePreviewDomToMarkdown(rootEl) {
      const blocks = [];
      const walkBlock = (node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          const t = String(node.nodeValue || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
          if (t.trim()) blocks.push(t);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (el.classList.contains('mmd-pi-inline-arrow')) return;
        if (el.classList.contains('mmd-live-math')) {
          blocks.push(el.dataset.rawTex || '');
          return;
        }
        const tag = el.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          const lvl = Number(tag[1]);
          blocks.push(`${'#'.repeat(lvl)} ${serializeInlineNodes(el).trim()}`);
          return;
        }
        if (tag === 'hr') {
          blocks.push('---');
          return;
        }
        if (tag === 'pre') {
          const codeEl = el.querySelector('code');
          const cls = codeEl?.className || '';
          const langM = cls.match(/language-([A-Za-z0-9_-]+)/);
          const lang = langM ? langM[1] : '';
          blocks.push(`\`\`\`${lang}\n${(codeEl || el).textContent || ''}\n\`\`\``);
          return;
        }
        if (tag === 'blockquote') {
          const txt = serializeInlineNodes(el).trim().split('\n').map((l) => `> ${l}`).join('\n');
          blocks.push(txt);
          return;
        }
        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
          const lines = items.map((li, i) => {
            const chk = li.querySelector('input[type="checkbox"]');
            if (chk) {
              const clone = li.cloneNode(true);
              clone.querySelector('input[type="checkbox"]')?.remove();
              return `- [${chk.checked ? 'x' : ' '}] ${serializeInlineNodes(clone).trim()}`;
            }
            const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
            return prefix + serializeInlineNodes(li).trim();
          });
          blocks.push(lines.join('\n'));
          return;
        }
        if (tag === 'table') {
          const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
            Array.from(tr.children).map((td) => serializeInlineNodes(td).trim())
          );
          if (rows.length > 0) {
            const head = `| ${rows[0].join(' | ')} |`;
            const sep = `| ${rows[0].map(() => '---').join(' | ')} |`;
            const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`);
            blocks.push([head, sep, ...body].join('\n'));
          }
          return;
        }
        if (tag === 'p' || tag === 'div') {
          const line = serializeInlineNodes(el).replace(/\n$/, '');
          blocks.push(line);
          return;
        }
        const fallback = serializeInlineNodes(el);
        if (fallback) blocks.push(fallback);
      };

      Array.from(rootEl.childNodes).forEach(walkBlock);
      return blocks.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    }

    function tryConvertInlineMathInPreviewCaret() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE || !viewerInner.contains(node)) return false;
      const offset = range.startOffset;
      const text = node.nodeValue || '';
      const before = text.slice(0, offset);
      const after = text.slice(offset);

      let matchStart = -1;
      let texExpr = '';
      let trailing = '';

      // Pattern 1: Complete inline `$expr$`
      const mDollar = before.match(/(^|[^\\])\$([^\n$]+?)\$$/);
      if (mDollar) {
        matchStart = before.length - mDollar[0].length + mDollar[1].length;
        texExpr = mDollar[2].trim();
        trailing = '';
      } else if (naverShortcutInMd && before.endsWith(' ')) {
        // Pattern 2: Quick shortcut + Space right inside Live Preview (`e^5 `, `(a+b)/c `, `a/b `, `sqrt(x) `)
        const trimmed = before.slice(0, -1);
        const mFrac = trimmed.match(/(\([^()]+\)|[A-Za-z0-9]+)\/(\([^()]+\)|[A-Za-z0-9]+)$/);
        const mPow = trimmed.match(/([A-Za-z0-9)])\^(\{[^{}]+\}|[A-Za-z0-9+-]+)$/);
        const mSqrt = trimmed.match(/sqrt\(([^()]+)\)$/);
        if (mFrac && !/https?:|file:/i.test(trimmed)) {
          matchStart = trimmed.length - mFrac[0].length;
          const num = mFrac[1].replace(/^\((.*)\)$/, '$1');
          const den = mFrac[2].replace(/^\((.*)\)$/, '$1');
          texExpr = `\\frac{${num}}{${den}}`;
          trailing = ' ';
        } else if (mPow) {
          matchStart = trimmed.length - mPow[0].length;
          const exp = mPow[2].replace(/^\{(.*)\}$/, '$1');
          texExpr = `${mPow[1]}^{${exp}}`;
          trailing = ' ';
        } else if (mSqrt) {
          matchStart = trimmed.length - mSqrt[0].length;
          texExpr = `\\sqrt{${mSqrt[1]}}`;
          trailing = ' ';
        }
      }

      if (matchStart < 0 || !texExpr) return false;

      const rawTex = `$${texExpr}$`;
      const span = document.createElement('span');
      span.className = 'mmd-live-math';
      span.contentEditable = 'false';
      span.dataset.rawTex = rawTex;
      span.title = '클릭하여 수식(적분 상·하한, 분자·분모, 지수 등) 바로 편집';
      span.innerHTML = MD.renderLatexToHtml(texExpr, false);

      const prefixNode = document.createTextNode(before.slice(0, matchStart));
      const suffixNode = document.createTextNode((trailing || '\u00a0') + after);
      const parent = node.parentNode;
      if (!parent) return false;
      parent.insertBefore(prefixNode, node);
      parent.insertBefore(span, node);
      parent.insertBefore(suffixNode, node);
      parent.removeChild(node);

      const nextRange = document.createRange();
      nextRange.setStart(suffixNode, trailing ? trailing.length : 1);
      nextRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nextRange);
      return true;
    }

    viewerInner.addEventListener('input', () => {
      if (isSyncingFromPreview) return;
      isSyncingFromPreview = true;
      try {
        const converted = tryConvertInlineMathInPreviewCaret();
        const nextMd = serializePreviewDomToMarkdown(viewerInner);
        if (textarea.value !== nextMd) {
          textarea.value = nextMd;
          setDirty(true);
          updateGutter();
          updateToc();
          updateCursorStatus();
          if (autoSaveTimer) clearTimeout(autoSaveTimer);
          autoSaveTimer = setTimeout(() => triggerSave(true), 1000);
        }
        if (converted) {
          // Re-index renderedMathList so newly created inline formula is immediately clickable!
          const savedSel = window.getSelection();
          let anchorInfo = null;
          if (savedSel && savedSel.rangeCount) {
            anchorInfo = { node: savedSel.getRangeAt(0).startContainer, off: savedSel.getRangeAt(0).startOffset };
          }
          // Sync data-m-idx against current markdown without rebuilding DOM
          renderedMathList = [];
          const mathRe = /\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
          let mm;
          while ((mm = mathRe.exec(textarea.value)) !== null) {
            const isD = mm[1] !== undefined;
            renderedMathList.push({
              idx: renderedMathList.length,
              start: mm.index,
              end: mm.index + mm[0].length,
              expr: isD ? mm[1] : mm[2],
              displayMode: isD
            });
          }
          viewerInner.querySelectorAll('.mmd-live-math').forEach((mEl, i) => {
            mEl.dataset.mIdx = String(i);
          });
          bindInteractiveMathSlots();
          if (anchorInfo && viewerInner.contains(anchorInfo.node)) {
            const r = document.createRange();
            r.setStart(anchorInfo.node, Math.min(anchorInfo.off, anchorInfo.node.length || 0));
            r.collapse(true);
            savedSel.removeAllRanges();
            savedSel.addRange(r);
          }
        }
      } finally {
        isSyncingFromPreview = false;
      }
    });

    viewerInner.addEventListener('blur', () => {
      if (!activeSlotPopover) {
        renderPreviewImmediate();
      }
    });

    // Draggable Horizontal Resizer between Top Preview and Bottom Markdown Editor
    let isDraggingVResizer = false;
    let vDragStartY = 0;
    let vDragStartH = 0;

    const onVResizeMove = (e) => {
      if (!isDraggingVResizer) return;
      const totalH = editorPane.clientHeight || 500;
      const deltaY = e.clientY - vDragStartY;
      const minTop = 90;
      const maxTop = Math.max(minTop + 40, totalH - 130);
      const nextH = Math.max(minTop, Math.min(maxTop, vDragStartH + deltaY));
      topPaneHeightPx = nextH;
      previewPane.style.flex = `0 0 ${nextH}px`;
      previewPane.style.height = `${nextH}px`;
    };

    const onVResizeUp = () => {
      if (!isDraggingVResizer) return;
      isDraggingVResizer = false;
      vResizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    vResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDraggingVResizer = true;
      vDragStartY = e.clientY;
      vDragStartH = previewPane.getBoundingClientRect().height;
      vResizer.classList.add('is-dragging');
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', onVResizeMove);
    document.addEventListener('mouseup', onVResizeUp);

    let findCaseSensitive = false;
    let findUseRegex = false;
    let latestMathErrors = [];

    // ---- Render Stylish Left-Side Equation & Symbol Palette Cards ----
    function renderPaletteButtons() {
      const cat = PALETTE_CATEGORIES.find((c) => c.id === activePaletteCat) || PALETTE_CATEGORIES[0];
      const isWideCat = cat.id === 'calculus' || cat.id === 'matrix';
      elPaletteItems.className = `mmd-palette-grid${isWideCat ? ' is-wide' : ''}`;
      elPaletteItems.innerHTML = '';
      cat.items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `mmd-pitem-card${isWideCat ? ' is-wide' : ''}`;
        const shortDesc = String(it.title || '').split('(')[0].trim();
        b.innerHTML = isWideCat
          ? `<span class="mmd-pi-sym">${MD.escapeHtml(it.label)}</span><span class="mmd-pi-sub">${MD.escapeHtml(shortDesc)}</span>`
          : `<span class="mmd-pi-sym">${MD.escapeHtml(it.label)}</span>`;
        b.title = `${it.title}  (${it.snippet.replace(/\$\d/g, '□')})`;
        b.addEventListener('click', () => insertPaletteSnippet(it.snippet));
        elPaletteItems.appendChild(b);
      });
    }

    // ---- Insert Snippet with Tab-Stop Support (MT-02, MT-03) ----
    function insertCompiledSnippet(snippet, replaceStart, replaceEnd, autoWrapMath = false) {
      const val = textarea.value;
      const selected = val.slice(replaceStart, replaceEnd);
      const needsWrap = autoWrapMath && !isCursorInsideMath(val, replaceStart);
      const isMultiline = snippet.includes('\n');
      const fullSnippet = needsWrap
        ? (isMultiline ? `$$\n${snippet}\n$$` : `$${snippet}$`)
        : snippet;

      const compiled = compileSnippet(fullSnippet, selected);
      textarea.value = val.slice(0, replaceStart) + compiled.text + val.slice(replaceEnd);

      const shiftedStops = compiled.stops.map((st) => ({
        start: replaceStart + st.start,
        end: replaceStart + st.end
      }));

      textarea.focus();
      if (shiftedStops.length > 0) {
        const first = shiftedStops.shift();
        pendingTabStops = shiftedStops;
        textarea.setSelectionRange(first.start, first.end);
      } else {
        pendingTabStops = [];
        const endPos = replaceStart + compiled.text.length;
        textarea.setSelectionRange(endPos, endPos);
      }
      handleEditorInput();
    }

    function insertPaletteSnippet(snippet) {
      if (currentMode === 'view') setMode('split');
      insertCompiledSnippet(snippet, textarea.selectionStart, textarea.selectionEnd, true);
    }

    // ---- Line Numbers & Math Error Gutter (MT-05) ----
    function updateGutter() {
      const linesCount = (textarea.value || '').split('\n').length;
      const errByLine = new Map();
      latestMathErrors.forEach((e) => {
        if (!errByLine.has(e.line)) errByLine.set(e.line, e.message);
      });

      const parts = [];
      for (let i = 1; i <= linesCount; i++) {
        const errMsg = errByLine.get(i);
        if (errMsg) {
          parts.push(`<div class="mmd-ln has-err" title="줄 ${i} 수식 오류: ${MD.escapeHtml(errMsg)}">!${i}</div>`);
        } else {
          parts.push(`<div class="mmd-ln">${i}</div>`);
        }
      }
      gutter.innerHTML = parts.join('');
      gutter.scrollTop = textarea.scrollTop;

      if (latestMathErrors.length > 0) {
        elErrBadge.style.display = 'inline-flex';
        elErrBadge.textContent = `⚠️ 수식 오류 ${latestMathErrors.length}건 (줄 ${latestMathErrors[0].line})`;
        elErrBadge.title = latestMathErrors.map((e) => `줄 ${e.line}: ${e.message}`).join('\n');
      } else {
        elErrBadge.style.display = 'none';
      }
    }

    elErrBadge.addEventListener('click', () => {
      if (latestMathErrors.length === 0) return;
      jumpToEditorLine(latestMathErrors[0].line);
      if (typeof options.onToast === 'function') {
        options.onToast(`⚠️ 줄 ${latestMathErrors[0].line}: ${latestMathErrors[0].message}`);
      }
    });

    function jumpToEditorLine(lineNumber) {
      const lines = textarea.value.split('\n');
      let pos = 0;
      const target = Math.max(1, Math.min(lines.length, lineNumber));
      for (let i = 0; i < target - 1; i++) pos += lines[i].length + 1;
      textarea.focus();
      textarea.setSelectionRange(pos, pos + (lines[target - 1]?.length || 0));
      const lineHeight = editorFontSize * 1.62;
      textarea.scrollTop = Math.max(0, (target - 3) * lineHeight);
      gutter.scrollTop = textarea.scrollTop;
      updateCursorStatus();
    }

    // ---- Live TOC Sidebar ----
    function updateToc() {
      const headings = MD.extractHeadings(textarea.value);
      if (headings.length === 0) {
        elTocList.innerHTML = '<div class="mmd-toc-empty"># 제목을 입력하면 목차가 자동 생성됩니다.</div>';
        return;
      }
      elTocList.innerHTML = '';
      headings.forEach((h) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `mmd-toc-item lvl-${h.level}`;
        btn.textContent = h.text;
        btn.title = `${h.text} (줄 ${h.line})`;
        btn.addEventListener('click', () => {
          if (currentMode !== 'view') jumpToEditorLine(h.line);
          const targetEl = viewerInner.querySelector(`#${h.id}`);
          if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        elTocList.appendChild(btn);
      });
    }

    // ---- Cursor Position & MT-04 Mini Math Preview Tooltip ----
    function updateCursorStatus() {
      const val = textarea.value || '';
      const pos = textarea.selectionStart || 0;
      const before = val.slice(0, pos);
      const lineNum = before.split('\n').length;
      const colNum = pos - before.lastIndexOf('\n');
      const totalChars = val.length;
      const totalLines = val ? val.split('\n').length : 0;
      elStatRight.textContent = `${totalChars.toLocaleString()}자 · ${totalLines.toLocaleString()}줄  |  Ln ${lineNum}, Col ${colNum}`;

      updateCursorMathTooltip(val, pos, lineNum);
    }

    function updateCursorMathTooltip(val, pos, lineNum) {
      // In split mode, the Top Preview Pane already renders live math continuously; only show floating tooltip in edit-only mode
      if (currentMode !== 'edit' || document.activeElement !== textarea) {
        mathTooltip.style.display = 'none';
        return;
      }
      const mathInfo = findMathAtCursor(val, pos);
      if (!mathInfo || !mathInfo.expr.trim()) {
        mathTooltip.style.display = 'none';
        return;
      }

      const rendered = MD.renderLatexToHtml(mathInfo.expr, mathInfo.displayMode);
      mathTooltip.innerHTML = `<div class="mmd-mt-lbl">${mathInfo.displayMode ? '블록 수식 미리보기' : '인라인 수식 미리보기'}</div><div class="mmd-mt-body">${rendered}</div>`;
      const lineHeight = editorFontSize * 1.62;
      const offsetTop = editorScrollWrap.offsetTop || 0;
      const approxY = offsetTop + (lineNum * lineHeight) - textarea.scrollTop + 14;
      const maxTop = Math.max(offsetTop + 10, editorPane.clientHeight - 110);
      mathTooltip.style.top = `${Math.max(offsetTop + 10, Math.min(maxTop, approxY))}px`;
      mathTooltip.style.display = 'block';
    }

    // ---- MT-02: LaTeX Autocomplete Popup ----
    function hideAutocomplete() {
      acPopup.style.display = 'none';
      acMatches = [];
      acTokenStart = -1;
    }

    function updateAutocomplete() {
      const val = textarea.value;
      const pos = textarea.selectionStart;
      if (pos !== textarea.selectionEnd) { hideAutocomplete(); return; }
      const before = val.slice(Math.max(0, pos - 24), pos);
      const m = before.match(/(\\[A-Za-z]{1,16})$/);
      if (!m) { hideAutocomplete(); return; }

      const query = m[1].toLowerCase();
      acMatches = LATEX_SNIPPETS.filter((s) => s.cmd.toLowerCase().startsWith(query)).slice(0, 8);
      if (acMatches.length === 0) { hideAutocomplete(); return; }

      acTokenStart = pos - m[1].length;
      acSelectedIdx = Math.min(acSelectedIdx, acMatches.length - 1);
      renderAutocompletePopup();
    }

    function renderAutocompletePopup() {
      acPopup.innerHTML = '';
      acMatches.forEach((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mmd-ac-item' + (idx === acSelectedIdx ? ' active' : '');
        row.innerHTML = `<span class="mmd-ac-cmd">${MD.escapeHtml(item.cmd)}</span><span class="mmd-ac-desc">${MD.escapeHtml(item.desc)}</span>`;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyAutocomplete(item);
        });
        acPopup.appendChild(row);
      });

      const lineNum = textarea.value.slice(0, textarea.selectionStart).split('\n').length;
      const lineHeight = editorFontSize * 1.62;
      const offsetTop = editorScrollWrap.offsetTop || 0;
      const approxY = offsetTop + (lineNum * lineHeight) - textarea.scrollTop + 14;
      const maxTop = Math.max(offsetTop + 10, editorPane.clientHeight - 190);
      acPopup.style.top = `${Math.max(offsetTop + 10, Math.min(maxTop, approxY))}px`;
      acPopup.style.display = 'flex';
    }

    function applyAutocomplete(item) {
      if (!item || acTokenStart < 0) return;
      const pos = textarea.selectionStart;
      hideAutocomplete();
      insertCompiledSnippet(item.snippet, acTokenStart, pos, false);
    }

    // ---- Interactive Formula Slot Popover (Click Integral Upper/Lower, Fraction Num/Den, Exponent, Sqrt!) ----
    function closeSlotPopover() {
      if (activeSlotPopover) {
        activeSlotPopover.remove();
        activeSlotPopover = null;
      }
    }

    function openFormulaSlotPopover(mathIdx, initialSlotIdx, anchorRect) {
      closeSlotPopover();
      const entry = renderedMathList[mathIdx];
      if (!entry) return;
      let curExpr = entry.expr;
      let slots = extractFormulaSlots(curExpr);
      let activeIdx = (typeof initialSlotIdx === 'number' && initialSlotIdx >= 0 && initialSlotIdx < slots.length)
        ? initialSlotIdx
        : (slots.length > 0 ? 0 : -1); // -1 = full formula

      const pop = document.createElement('div');
      pop.className = 'mmd-slot-popover';
      document.body.appendChild(pop);
      activeSlotPopover = pop;

      const renderPop = () => {
        const curSlot = activeIdx >= 0 && slots[activeIdx] ? slots[activeIdx] : null;
        const curVal = curSlot ? curSlot.value : curExpr;
        pop.innerHTML = `
          <div class="mmd-sp-head">
            <span>✏️ ${MD.escapeHtml(curSlot ? curSlot.label : '전체 수식 편집')}</span>
            <button type="button" class="sb-icon-btn-xs" data-sp-close="1">✕</button>
          </div>
          ${slots.length > 0 ? `
            <div class="mmd-sp-tabs">
              ${slots.map((sl, si) => `
                <button type="button" class="mmd-sp-tab${si === activeIdx ? ' active' : ''}" data-sp-slot="${si}">
                  ${MD.escapeHtml(sl.label)}: <b>${MD.escapeHtml(sl.value || '□')}</b>
                </button>
              `).join('')}
              <button type="button" class="mmd-sp-tab${activeIdx === -1 ? ' active' : ''}" data-sp-slot="-1">전체</button>
            </div>
          ` : ''}
          <div class="mmd-sp-input-row">
            <input type="text" class="mmd-sp-input" value="${MD.escapeHtml(curVal)}" spellcheck="false" autocomplete="off" placeholder="값 입력 (예: 0, 1, \\infty, 2x)...">
            <button type="button" class="sb-btn-primary-xs" data-sp-done="1">완료</button>
          </div>
        `;

        const inp = pop.querySelector('.mmd-sp-input');
        pop.querySelector('[data-sp-close]')?.addEventListener('click', closeSlotPopover);
        pop.querySelector('[data-sp-done]')?.addEventListener('click', closeSlotPopover);
        pop.querySelectorAll('[data-sp-slot]').forEach((b) => {
          b.addEventListener('click', () => {
            activeIdx = Number(b.dataset.spSlot);
            renderPop();
          });
        });

        const applyEdit = (newVal) => {
          const oldFull = textarea.value || '';
          let nextExpr;
          if (activeIdx >= 0 && slots[activeIdx]) {
            const sl = slots[activeIdx];
            const rep = sl.wrapBraces ? `{${newVal}}` : newVal;
            nextExpr = curExpr.slice(0, sl.start) + rep + curExpr.slice(sl.end);
          } else {
            nextExpr = newVal;
          }
          const delim = entry.displayMode ? '$$' : '$';
          const replacement = entry.displayMode ? `$$\n${nextExpr.trim()}\n$$` : `$${nextExpr}$`;
          const nextDoc = oldFull.slice(0, entry.start) + replacement + oldFull.slice(entry.end);
          entry.end = entry.start + replacement.length;
          entry.expr = nextExpr;
          curExpr = nextExpr;
          slots = extractFormulaSlots(curExpr);
          textarea.value = nextDoc;
          setDirty(true);
          renderPreviewImmediate();
          // Keep slot tab labels live-updated
          pop.querySelectorAll('[data-sp-slot]').forEach((tb) => {
            const idxNum = Number(tb.dataset.spSlot);
            if (idxNum >= 0 && slots[idxNum]) {
              const bEl = tb.querySelector('b');
              if (bEl) bEl.textContent = slots[idxNum].value || '□';
            }
          });
        };

        inp?.addEventListener('input', () => applyEdit(inp.value));
        inp?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            closeSlotPopover();
            return;
          }
          if (e.key === 'Tab' && slots.length > 1) {
            e.preventDefault();
            activeIdx = (activeIdx + (e.shiftKey ? -1 : 1) + slots.length) % slots.length;
            renderPop();
          }
        });
        setTimeout(() => { inp?.focus(); inp?.select(); }, 0);
      };

      const left = Math.max(12, Math.min(window.innerWidth - 330, (anchorRect?.left || 200)));
      const top = Math.max(12, Math.min(window.innerHeight - 160, (anchorRect?.bottom || 180) + 8));
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      pop.addEventListener('click', (e) => e.stopPropagation());
      renderPop();
    }

    // ---- Render Markdown with Exact Source-Mapped Clickable Formulas ----
    function renderMarkdownWithInteractiveMath(mdText) {
      renderedMathList = [];
      const src = String(mdText || '');
      const placeholders = [];

      // Protect code fences and inline code first so `$` in code is never treated as math
      const codeMasks = [];
      let masked = src.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m, offset) => {
        const key = `%%MMD_CODE_${codeMasks.length}%%`;
        codeMasks.push({ key, raw: m, offset });
        return key;
      });

      // Scan math expressions directly on original `src` (skipping code spans) for exact source indices!
      const codeRanges = [];
      const codeRe = /```[\s\S]*?```|`[^`\n]+`/g;
      let cm;
      while ((cm = codeRe.exec(src)) !== null) {
        codeRanges.push([cm.index, cm.index + cm[0].length]);
      }
      const inCode = (pos) => codeRanges.some(([a, b]) => pos >= a && pos < b);

      let outSrc = '';
      let cursor = 0;
      const mathRe = /\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
      let mm;
      while ((mm = mathRe.exec(src)) !== null) {
        if (inCode(mm.index)) continue;
        const isDisplay = mm[1] !== undefined;
        const expr = isDisplay ? mm[1] : mm[2];
        const idx = renderedMathList.length;
        renderedMathList.push({
          idx,
          start: mm.index,
          end: mm.index + mm[0].length,
          expr,
          displayMode: isDisplay
        });
        const tok = `MMD_IMATH_TOK_${idx}_END`;
        placeholders.push({ tok, idx, expr, isDisplay });
        outSrc += src.slice(cursor, mm.index) + (isDisplay ? `\n\n${tok}\n\n` : tok);
        cursor = mm.index + mm[0].length;
      }
      outSrc += src.slice(cursor);

      let html = MD.render(outSrc);
      placeholders.forEach(({ tok, idx, expr, isDisplay }) => {
        const rendered = MD.renderLatexToHtml(expr.trim(), isDisplay);
        const tag = isDisplay ? 'div' : 'span';
        const rawTex = isDisplay ? `$$\n${expr.trim()}\n$$` : `$${expr}$`;
        const wrapped = `<${tag} class="mmd-live-math${isDisplay ? ' is-display' : ''}" contenteditable="false" data-m-idx="${idx}" data-raw-tex="${MD.escapeHtml(rawTex)}" title="클릭하여 수식(적분 상·하한, 분자·분모, 지수 등) 바로 편집">${rendered}</${tag}>`;
        html = html.replace(new RegExp(`<p>${tok}</p>`, 'g'), wrapped).replace(tok, wrapped);
      });
      return html || '<p><br></p>';
    }

    function bindInteractiveMathSlots() {
      viewerInner.querySelectorAll('.mmd-live-math[data-m-idx]').forEach((el) => {
        const idx = Number(el.dataset.mIdx);
        const entry = renderedMathList[idx];
        if (!entry) return;
        const slots = extractFormulaSlots(entry.expr);

        // Map visual KaTeX sub-elements directly to slots for direct mouse clicking!
        const bindSubHit = (domEl, slotIdx) => {
          if (!domEl || slotIdx < 0 || !slots[slotIdx] || domEl.dataset.slotBound) return;
          domEl.dataset.slotBound = '1';
          domEl.classList.add('mmd-math-slot-hit');
          domEl.title = `클릭하여 [${slots[slotIdx].label}] 직접 수정`;
          domEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFormulaSlotPopover(idx, slotIdx, domEl.getBoundingClientRect());
          });
        };

        // 1. Integral / Sum / Prod upper & lower limits + general sup/sub
        const msupsubs = Array.from(el.querySelectorAll('.msupsub, .op-limits'));
        const supSlots = slots.map((sl, si) => ({ sl, si })).filter((x) => x.sl.kind === 'op-upper' || x.sl.kind === 'sup');
        const subSlots = slots.map((sl, si) => ({ sl, si })).filter((x) => x.sl.kind === 'op-lower' || x.sl.kind === 'sub');
        let supPtr = 0;
        let subPtr = 0;
        msupsubs.forEach((box) => {
          const rows = Array.from(box.querySelectorAll('.vlist > span'));
          if (rows.length >= 2) {
            const curSupIdx = supPtr++;
            const curSubIdx = subPtr++;
            rows.forEach((rEl) => {
              rEl.classList.add('mmd-math-slot-hit');
              rEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const boxRect = box.getBoundingClientRect();
                const clickRelY = e.clientY - boxRect.top;
                const isUpperClick = clickRelY < boxRect.height * 0.5;
                const chosen = isUpperClick
                  ? (supSlots[curSupIdx]?.si ?? supSlots[0]?.si ?? subSlots[curSubIdx]?.si ?? 0)
                  : (subSlots[curSubIdx]?.si ?? subSlots[0]?.si ?? supSlots[curSupIdx]?.si ?? 0);
                openFormulaSlotPopover(idx, chosen, rEl.getBoundingClientRect());
              });
            });
          } else if (rows.length === 1) {
            const isLikelySub = box.querySelector('.sizing')?.closest('.vlist-r') && !supSlots[supPtr];
            const targetSlot = isLikelySub
              ? (subSlots[subPtr++]?.si ?? supSlots[supPtr++]?.si ?? 0)
              : (supSlots[supPtr++]?.si ?? subSlots[subPtr++]?.si ?? 0);
            bindSubHit(rows[0], targetSlot);
          }
        });

        // 2. Fraction numerator (top) & denominator (bottom)
        const numSlots = slots.map((sl, si) => ({ sl, si })).filter((x) => x.sl.kind === 'frac-num');
        const denSlots = slots.map((sl, si) => ({ sl, si })).filter((x) => x.sl.kind === 'frac-den');
        el.querySelectorAll('.mfrac').forEach((fracEl, fIdx) => {
          fracEl.classList.add('mmd-math-slot-hit');
          fracEl.addEventListener('click', (e) => {
            if (e.target.closest('.msupsub')) return;
            e.preventDefault();
            e.stopPropagation();
            const r = fracEl.getBoundingClientRect();
            const isTop = (e.clientY - r.top) < r.height * 0.5;
            const slotIdx = isTop ? (numSlots[fIdx]?.si ?? 0) : (denSlots[fIdx]?.si ?? 1);
            openFormulaSlotPopover(idx, slotIdx, r);
          });
        });

        // 3. Sqrt body
        const sqrtSlots = slots.map((sl, si) => ({ sl, si })).filter((x) => x.sl.kind === 'sqrt-body');
        el.querySelectorAll('.sqrt').forEach((sqEl, sIdx) => {
          bindSubHit(sqEl, sqrtSlots[sIdx]?.si ?? 0);
        });

        // Fallback click anywhere on the formula -> open slot editor
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openFormulaSlotPopover(idx, 0, el.getBoundingClientRect());
        });
      });
    }

    // ---- Performance-Optimized Preview Rendering ----
    function renderPreviewImmediate() {
      const md = textarea.value || '';
      latestMathErrors = MD.validateMathSyntax(md);
      viewerInner.innerHTML = renderMarkdownWithInteractiveMath(md);
      bindInteractiveMathSlots();
      updateGutter();
      updateToc();
      updateCursorStatus();
      elEngineBadge.textContent = global.katex ? '∑ KaTeX 활성' : '∑ 오프라인 수식 엔진';

      if (mermaidDebounceTimer) clearTimeout(mermaidDebounceTimer);
      mermaidDebounceTimer = setTimeout(() => {
        MD.renderMermaidBlocks(viewerInner).catch(() => {});
      }, 280);
    }

    // ---- Right-Click Context Menu: Copy for Word (MathML/HTML) or HWP (한글 수식 문법) ----
    let copyCtxMenu = null;
    function closeCopyCtxMenu() {
      if (copyCtxMenu) { copyCtxMenu.remove(); copyCtxMenu = null; }
    }

    async function copySelectionForWord(mdSlice) {
      const src = String(mdSlice || textarea.value || '');
      // Convert LaTeX to native MathML (which MS Word pastes as editable Word equations!)
      const withMathMl = src.replace(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, blockExpr, inlineExpr) => {
        const expr = (blockExpr !== undefined ? blockExpr : inlineExpr).trim();
        const isBlock = blockExpr !== undefined;
        if (global.katex) {
          try {
            const mml = global.katex.renderToString(expr, { output: 'mathml', displayMode: isBlock, throwOnError: false });
            return isBlock ? `<p style="text-align:center;">${mml}</p>` : mml;
          } catch (_) {}
        }
        return isBlock ? `<p style="text-align:center;">${MD.escapeHtml(expr)}</p>` : MD.escapeHtml(expr);
      });
      const bodyHtml = MD.render(withMathMl);
      const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><body style="font-family:'Malgun Gothic',Calibri,sans-serif;font-size:11pt;line-height:1.6;">${bodyHtml}</body></html>`;
      try {
        if (navigator.clipboard && global.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([wordHtml], { type: 'text/html' }),
              'text/plain': new Blob([src], { type: 'text/plain' })
            })
          ]);
        } else {
          await navigator.clipboard.writeText(src);
        }
        options.onToast?.('📘 Word(MS 워드) 호환 형식(편집 가능 MathML 수식 포함)으로 복사했습니다.');
      } catch (_) {
        await navigator.clipboard?.writeText(src).catch(() => {});
        options.onToast?.('📘 Word 호환 텍스트로 복사했습니다.');
      }
    }

    async function copySelectionForHwp(mdSlice, eqOnly = false) {
      const src = String(mdSlice || textarea.value || '');
      if (eqOnly) {
        const eqs = [];
        src.replace(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b, i) => {
          eqs.push(convertLatexToHwp(b !== undefined ? b : i));
          return '';
        });
        const out = eqs.length ? eqs.join('\n') : convertLatexToHwp(src);
        await navigator.clipboard?.writeText(out).catch(() => {});
        options.onToast?.('∑ 한글(HWP) 수식 편집기용 스크립트를 복사했습니다. (한글에서 Ctrl+N,M 후 붙여넣기)');
        return;
      }
      const hwpPlain = src
        .replace(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b, i) => convertLatexToHwp(b !== undefined ? b : i))
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1');
      const hwpHtmlBody = MD.render(
        src.replace(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, b, i) => `<code>${MD.escapeHtml(convertLatexToHwp(b !== undefined ? b : i))}</code>`)
      );
      const hwpHtml = `<html><body style="font-family:'함초롬바탕','맑은 고딕',sans-serif;font-size:10.5pt;line-height:1.6;">${hwpHtmlBody}</body></html>`;
      try {
        if (navigator.clipboard && global.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([hwpHtml], { type: 'text/html' }),
              'text/plain': new Blob([hwpPlain], { type: 'text/plain' })
            })
          ]);
        } else {
          await navigator.clipboard.writeText(hwpPlain);
        }
        options.onToast?.('📄 한글(HWP) 호환 형식(한글 수식 문법 변환)으로 복사했습니다.');
      } catch (_) {
        await navigator.clipboard?.writeText(hwpPlain).catch(() => {});
        options.onToast?.('📄 한글(HWP) 호환 텍스트로 복사했습니다.');
      }
    }

    function openCopyContextMenu(e, selectedMd) {
      e.preventDefault();
      closeCopyCtxMenu();
      const hasSel = Boolean(selectedMd && selectedMd.trim());
      const targetText = hasSel ? selectedMd : (textarea.value || '');
      const menu = document.createElement('div');
      menu.className = 'mmd-copy-ctxmenu';
      menu.innerHTML = `
        <div class="mmd-ctx-title">${hasSel ? '선택 영역 복사 형식 선택' : '문서 전체 복사 형식 선택'}</div>
        <button type="button" data-cact="word">📘 Word(MS 워드) 호환 복사 <small>MathML 수식</small></button>
        <button type="button" data-cact="hwp">📄 한글(HWP) 호환 복사 <small>한글 수식 문법</small></button>
        <button type="button" data-cact="hwp-eq">∑ 한글 수식 스크립트만 복사 <small>Ctrl+N,M용</small></button>
        <button type="button" data-cact="raw">📋 마크다운 원문 복사</button>
      `;
      document.body.appendChild(menu);
      menu.style.left = `${Math.min(window.innerWidth - 260, e.clientX)}px`;
      menu.style.top = `${Math.min(window.innerHeight - 170, e.clientY)}px`;
      menu.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const btn = ev.target.closest('[data-cact]');
        if (!btn) return;
        const act = btn.dataset.cact;
        closeCopyCtxMenu();
        if (act === 'word') copySelectionForWord(targetText);
        else if (act === 'hwp') copySelectionForHwp(targetText, false);
        else if (act === 'hwp-eq') copySelectionForHwp(targetText, true);
        else {
          navigator.clipboard?.writeText(targetText).catch(() => {});
          options.onToast?.('📋 마크다운 원문을 복사했습니다.');
        }
      });
      copyCtxMenu = menu;
    }

    textarea.addEventListener('contextmenu', (e) => {
      const sel = textarea.value.slice(textarea.selectionStart || 0, textarea.selectionEnd || 0);
      openCopyContextMenu(e, sel);
    });

    previewScrollArea.addEventListener('contextmenu', (e) => {
      const winSel = window.getSelection()?.toString() || '';
      openCopyContextMenu(e, winSel ? textarea.value : textarea.value);
    });

    function schedulePreviewRender() {
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      const delay = textarea.value.length > 10000 ? 140 : 45;
      renderDebounceTimer = setTimeout(() => {
        renderDebounceTimer = null;
        renderPreviewImmediate();
      }, delay);
    }

    // ---- Dirty & 1-Second Auto-Save (FS-02) ----
    function setDirty(dirty) {
      isDirty = dirty;
      elSaveInd.textContent = dirty ? '● 수정됨' : '☁️ 저장됨';
      elSaveInd.classList.toggle('dirty', dirty);
    }

    function triggerSave(silent = false) {
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
      if (typeof options.onSave === 'function') {
        options.onSave(textarea.value, silent);
      }
      setDirty(false);
    }

    function handleEditorInput() {
      setDirty(true);
      schedulePreviewRender();
      updateAutocomplete();
      updateCursorStatus();
      if (findBar.style.display !== 'none') computeSearchMatches(false);

      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        triggerSave(true);
      }, 1000);
    }

    // ---- ED-01: Bidirectional Synchronized Scroll ----
    textarea.addEventListener('scroll', () => {
      gutter.scrollTop = textarea.scrollTop;
      if (currentMode !== 'split' || scrollSyncLock === 'preview') return;
      scrollSyncLock = 'editor';
      const maxEd = Math.max(1, textarea.scrollHeight - textarea.clientHeight);
      const ratio = textarea.scrollTop / maxEd;
      const maxPr = Math.max(0, previewScrollArea.scrollHeight - previewScrollArea.clientHeight);
      previewScrollArea.scrollTop = ratio * maxPr;
      requestAnimationFrame(() => { if (scrollSyncLock === 'editor') scrollSyncLock = null; });
    });

    previewScrollArea.addEventListener('scroll', () => {
      if (currentMode !== 'split' || scrollSyncLock === 'editor') return;
      scrollSyncLock = 'preview';
      const maxPr = Math.max(1, previewScrollArea.scrollHeight - previewScrollArea.clientHeight);
      const ratio = previewScrollArea.scrollTop / maxPr;
      const maxEd = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
      textarea.scrollTop = ratio * maxEd;
      gutter.scrollTop = textarea.scrollTop;
      requestAnimationFrame(() => { if (scrollSyncLock === 'preview') scrollSyncLock = null; });
    });

    // ---- ED-03: Table Wizard Popover ----
    let twHoverR = 3;
    let twHoverC = 3;
    const twLabel = tableWizard.querySelector('[data-role="tw-label"]');
    const twAlign = tableWizard.querySelector('[data-role="tw-align"]');
    const twCells = tableWizard.querySelectorAll('.mmd-tw-cell');

    function highlightTwGrid(r, c) {
      twHoverR = r;
      twHoverC = c;
      twLabel.textContent = `표 크기 선택: ${r}행 × ${c}열`;
      twCells.forEach((cell) => {
        const cr = Number(cell.dataset.r);
        const cc = Number(cell.dataset.c);
        cell.classList.toggle('active', cr <= r && cc <= c);
      });
    }
    highlightTwGrid(3, 3);

    tableWizard.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.mmd-tw-cell');
      if (cell) highlightTwGrid(Number(cell.dataset.r), Number(cell.dataset.c));
    });

    tableWizard.addEventListener('click', (e) => {
      const cell = e.target.closest('.mmd-tw-cell');
      if (!cell) return;
      const rows = Number(cell.dataset.r);
      const cols = Number(cell.dataset.c);
      const align = twAlign.value;
      const sepCell = align === 'center' ? ':---:' : (align === 'right' ? '---:' : ':---');

      const headerRow = '| ' + Array.from({ length: cols }, (_, i) => `항목 ${i + 1}`).join(' | ') + ' |';
      const sepRow = '| ' + Array.from({ length: cols }, () => sepCell).join(' | ') + ' |';
      const dataRows = Array.from({ length: Math.max(1, rows - 1) }, () =>
        '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |'
      ).join('\n');

      tableWizard.style.display = 'none';
      if (currentMode === 'view') setMode('split');
      insertCompiledSnippet(`\n${headerRow}\n${sepRow}\n${dataRows}\n`, textarea.selectionStart, textarea.selectionEnd, false);
    });

    // ---- ED-05: Find & Replace (Plain + Regex) ----
    function buildSearchRegex() {
      const q = elFindQ.value;
      if (!q) return null;
      const flags = findCaseSensitive ? 'g' : 'gi';
      try {
        return findUseRegex ? new RegExp(q, flags) : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      } catch (_) {
        return null;
      }
    }

    function computeSearchMatches(jumpFirst = true) {
      searchMatches = [];
      const re = buildSearchRegex();
      if (!re) {
        searchCurrentIdx = -1;
        elFindCount.textContent = '0/0';
        return;
      }
      const val = textarea.value;
      let m;
      while ((m = re.exec(val)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        searchMatches.push({ start: m.index, end: m.index + m[0].length });
        if (searchMatches.length > 2000) break;
      }
      if (searchMatches.length === 0) {
        searchCurrentIdx = -1;
        elFindCount.textContent = '0/0';
        return;
      }
      if (jumpFirst || searchCurrentIdx < 0 || searchCurrentIdx >= searchMatches.length) {
        searchCurrentIdx = 0;
      }
      elFindCount.textContent = `${searchCurrentIdx + 1}/${searchMatches.length}`;
      if (jumpFirst) selectSearchMatch(searchCurrentIdx);
    }

    function selectSearchMatch(idx) {
      if (idx < 0 || idx >= searchMatches.length) return;
      searchCurrentIdx = idx;
      const match = searchMatches[idx];
      elFindCount.textContent = `${idx + 1}/${searchMatches.length}`;
      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
      const lineNum = textarea.value.slice(0, match.start).split('\n').length;
      textarea.scrollTop = Math.max(0, (lineNum - 4) * editorFontSize * 1.62);
      gutter.scrollTop = textarea.scrollTop;
    }

    function openFindBar(focusReplace = false) {
      if (currentMode === 'view') setMode('split');
      findBar.style.display = 'flex';
      const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (sel && !sel.includes('\n')) elFindQ.value = sel;
      if (focusReplace) elReplaceQ.focus();
      else { elFindQ.focus(); elFindQ.select(); }
      computeSearchMatches(false);
    }

    elFindQ.addEventListener('input', () => computeSearchMatches(true));
    elFindQ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchMatches.length > 0) {
          selectSearchMatch((searchCurrentIdx + (e.shiftKey ? -1 : 1) + searchMatches.length) % searchMatches.length);
        }
      } else if (e.key === 'Escape') {
        findBar.style.display = 'none';
        textarea.focus();
      }
    });

    findBar.addEventListener('click', (e) => {
      const optBtn = e.target.closest('[data-fopt]');
      if (optBtn) {
        if (optBtn.dataset.fopt === 'case') {
          findCaseSensitive = !findCaseSensitive;
          optBtn.classList.toggle('active', findCaseSensitive);
        } else {
          findUseRegex = !findUseRegex;
          optBtn.classList.toggle('active', findUseRegex);
        }
        computeSearchMatches(true);
        return;
      }
      const cmdBtn = e.target.closest('[data-fcmd]');
      if (!cmdBtn) return;
      const c = cmdBtn.dataset.fcmd;
      if (c === 'close') { findBar.style.display = 'none'; textarea.focus(); return; }
      if (c === 'prev' && searchMatches.length) {
        selectSearchMatch((searchCurrentIdx - 1 + searchMatches.length) % searchMatches.length);
      } else if (c === 'next' && searchMatches.length) {
        selectSearchMatch((searchCurrentIdx + 1) % searchMatches.length);
      } else if (c === 'replace' && searchCurrentIdx >= 0 && searchMatches[searchCurrentIdx]) {
        const m = searchMatches[searchCurrentIdx];
        const rep = elReplaceQ.value;
        textarea.value = textarea.value.slice(0, m.start) + rep + textarea.value.slice(m.end);
        handleEditorInput();
        computeSearchMatches(true);
      } else if (c === 'replace-all') {
        const re = buildSearchRegex();
        if (!re) return;
        const count = searchMatches.length;
        textarea.value = textarea.value.replace(re, elReplaceQ.value);
        handleEditorInput();
        computeSearchMatches(false);
        if (typeof options.onToast === 'function') options.onToast(`🔄 ${count}건 일괄 치환 완료`);
      }
    });

    // ---- Format Insertion (ED-04) ----
    function applyFormat(fmt) {
      if (currentMode === 'view') setMode('split');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const map = {
        h1: '# $1',
        h2: '## $1',
        h3: '### $1',
        bold: '**$1**',
        italic: '*$1*',
        strike: '~~$1~~',
        link: '[$1](https://$2)',
        code: '\n```python\n$1\n```\n',
        check: '\n- [ ] $1',
        'math-inline': '$$1$',
        'math-block': '\n$$\n$1\n$$\n',
        mermaid: '\n```mermaid\nflowchart LR\n  A["입력 R(s)"] --> B["제어기 C(s)"]\n  B --> C["플랜트 G(s)"]\n  C --> D["출력 Y(s)"]\n```\n'
      };
      if (fmt === 'math-inline') {
        // Explicit inline math wrap $...$
        const val = textarea.value;
        const sel = val.slice(start, end);
        const ins = `$${sel}$`;
        textarea.value = val.slice(0, start) + ins + val.slice(end);
        textarea.focus();
        textarea.setSelectionRange(start + 1, start + 1 + sel.length);
        handleEditorInput();
        return;
      }
      if (map[fmt]) {
        insertCompiledSnippet(map[fmt], start, end, false);
      }
    }

    // ---- Direct Naver-style math shortcuts on `beforeinput` in Markdown textarea (BOTH inside & outside $...$) ----
    textarea.addEventListener('beforeinput', (e) => {
      if (!naverShortcutInMd) return;
      const insideMath = isCursorInsideMath(textarea.value || '', textarea.selectionStart || 0);
      applyNaverMathBeforeInput(
        textarea,
        e,
        (cursorOnly) => {
          if (cursorOnly) updateCursorStatus();
          else handleEditorInput();
        },
        (stop) => pendingTabStops.unshift(stop),
        { insideMath }
      );
    });

    // ---- Keyboard Handling (ED-04, MT-02 Tab-Stops) ----
    textarea.addEventListener('keydown', (e) => {
      // Autocomplete navigation
      if (acPopup.style.display !== 'none' && acMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          acSelectedIdx = (acSelectedIdx + 1) % acMatches.length;
          renderAutocompletePopup();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          acSelectedIdx = (acSelectedIdx - 1 + acMatches.length) % acMatches.length;
          renderAutocompletePopup();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          applyAutocomplete(acMatches[acSelectedIdx]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hideAutocomplete();
          return;
        }
      }

      // Direct Naver-style Tab shortcuts in Markdown textarea (inside & outside math)
      if (naverShortcutInMd) {
        const insideMath = isCursorInsideMath(textarea.value || '', textarea.selectionStart || 0);
        const handled = applyNaverMathKeydown(
          textarea,
          e,
          (cursorOnly) => {
            if (cursorOnly) updateCursorStatus();
            else handleEditorInput();
          },
          { insideMath }
        );
        if (handled) return;
      }

      // Tab key: jump to next snippet tab stop OR insert 2 spaces
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (pendingTabStops.length > 0) {
          const nextStop = pendingTabStops.shift();
          textarea.setSelectionRange(nextStop.start, nextStop.end);
          updateCursorStatus();
          return;
        }
        const s = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(end);
        textarea.setSelectionRange(s + 2, s + 2);
        handleEditorInput();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); e.stopPropagation(); triggerSave(false); return; }
        if (k === 'b') { e.preventDefault(); applyFormat('bold'); return; }
        if (k === 'i') { e.preventDefault(); applyFormat('italic'); return; }
        if (k === 'k') { e.preventDefault(); applyFormat('link'); return; }
        if (k === 'm') {
          e.preventDefault();
          applyFormat(e.shiftKey ? 'math-block' : 'math-inline');
          return;
        }
        if (k === 'f') { e.preventDefault(); openFindBar(false); return; }
        if (k === 'h') { e.preventDefault(); openFindBar(true); return; }
      }
    });

    // ---- FS-03: Clipboard Image Paste (Base64) ----
    textarea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUri = String(reader.result || '');
            if (!dataUri) return;
            const s = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const mdImg = `\n![붙여넣은 이미지](${dataUri})\n`;
            textarea.value = textarea.value.slice(0, s) + mdImg + textarea.value.slice(end);
            textarea.setSelectionRange(s + mdImg.length, s + mdImg.length);
            handleEditorInput();
            if (typeof options.onToast === 'function') options.onToast('🖼️ 클립보드 이미지가 Base64로 삽입되었습니다.');
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    });

    textarea.addEventListener('input', handleEditorInput);
    textarea.addEventListener('keyup', updateCursorStatus);
    textarea.addEventListener('click', () => { hideAutocomplete(); updateCursorStatus(); });
    textarea.addEventListener('blur', () => { setTimeout(() => { mathTooltip.style.display = 'none'; }, 120); });

    // Interactive checkboxes in preview
    viewerInner.addEventListener('change', (e) => {
      const chk = e.target.closest('.md-task-checkbox');
      if (!chk) return;
      const idx = Number(chk.dataset.checkboxIndex);
      if (Number.isNaN(idx)) return;
      textarea.value = toggleCheckboxInMarkdown(textarea.value, idx);
      renderPreviewImmediate();
      triggerSave(true);
    });

    // ---- View Mode & Panel Toggles ----
    function setMode(mode) {
      currentMode = mode;
      workspace.dataset.mode = mode;
      toolbar.querySelectorAll('.md-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      elFmtGroup.style.display = mode === 'view' ? 'none' : 'flex';
      if (mode === 'view') {
        previewPane.style.display = 'flex';
        previewPane.style.flex = '1 1 auto';
        previewPane.style.height = 'auto';
        vResizer.style.display = 'none';
        mdSectionBar.style.display = 'none';
        editorScrollWrap.style.display = 'none';
        mathTooltip.style.display = 'none';
      } else if (mode === 'edit') {
        previewPane.style.display = 'none';
        vResizer.style.display = 'none';
        mdSectionBar.style.display = 'flex';
        editorScrollWrap.style.display = 'flex';
        textarea.focus();
      } else {
        previewPane.style.display = 'flex';
        if (topPaneHeightPx) {
          previewPane.style.flex = `0 0 ${topPaneHeightPx}px`;
          previewPane.style.height = `${topPaneHeightPx}px`;
        } else {
          previewPane.style.flex = '0 0 48%';
          previewPane.style.height = '48%';
        }
        vResizer.style.display = 'flex';
        mdSectionBar.style.display = 'flex';
        editorScrollWrap.style.display = 'flex';
        textarea.focus();
      }
      renderPreviewImmediate();
    }

    function applyFontSizes() {
      textarea.style.fontSize = `${editorFontSize}px`;
      gutter.style.fontSize = `${Math.max(11, editorFontSize - 1.5)}px`;
      viewerInner.style.fontSize = `${previewFontSize}px`;
    }

    // ---- File Open & Multi-Format Export (FS-01, FS-04) ----
    openFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const text = await file.text();
      textarea.value = text;
      renderPreviewImmediate();
      triggerSave(false);
      if (typeof options.onToast === 'function') options.onToast(`📂 "${file.name}" 불러오기 완료`);
    });

    function exportMarkdownFile() {
      const baseName = String(options.fileName || 'document').replace(/\.md$/i, '');
      const blob = new Blob([textarea.value || ''], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (typeof options.onToast === 'function') options.onToast(`⬇️ "${baseName}.md" 저장됨`);
    }

    function exportStandaloneHtml() {
      const baseName = String(options.fileName || 'document').replace(/\.md$/i, '');
      const fullHtml = buildStandaloneDocumentHtml(baseName, viewerInner.innerHTML, false);
      const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (typeof options.onToast === 'function') options.onToast(`🌐 오프라인 단독 HTML(${baseName}.html) 내보내기 완료`);
    }

    function exportPrintPdf() {
      const baseName = String(options.fileName || 'document').replace(/\.md$/i, '');
      const printHtml = buildStandaloneDocumentHtml(baseName, viewerInner.innerHTML, true);
      const blob = new Blob([printHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win && typeof options.onToast === 'function') {
        options.onToast('⚠️ 팝업이 차단되어 인쇄 창을 열지 못했습니다. 팝업을 허용해 주세요.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // ---- Toolbar Events ----
    toolbar.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('.md-mode-btn');
      if (modeBtn) { setMode(modeBtn.dataset.mode); return; }

      const fmtBtn = e.target.closest('[data-fmt]');
      if (fmtBtn) { applyFormat(fmtBtn.dataset.fmt); return; }

      const cmdBtn = e.target.closest('[data-cmd]');
      if (!cmdBtn) return;
      const cmd = cmdBtn.dataset.cmd;

      if (cmd === 'toggle-left') {
        showLeftPanel = !showLeftPanel;
        tocPane.style.display = showLeftPanel ? 'flex' : 'none';
        cmdBtn.classList.toggle('active', showLeftPanel);
      } else if (cmd === 'toggle-postits') {
        const opened = mdPostitCtrl?.toggle();
        cmdBtn.classList.toggle('active', Boolean(opened));
      } else if (cmd === 'toggle-find') {
        if (findBar.style.display === 'none') openFindBar(false);
        else { findBar.style.display = 'none'; textarea.focus(); }
      } else if (cmd === 'table-wizard') {
        tableWizard.style.display = tableWizard.style.display === 'none' ? 'block' : 'none';
      } else if (cmd === 'font-dec') {
        editorFontSize = Math.max(11, editorFontSize - 1);
        previewFontSize = Math.max(12, previewFontSize - 1);
        applyFontSizes();
      } else if (cmd === 'font-inc') {
        editorFontSize = Math.min(22, editorFontSize + 1);
        previewFontSize = Math.min(22, previewFontSize + 1);
        applyFontSizes();
      } else if (cmd === 'open-md') {
        openFileInput.click();
      } else if (cmd === 'export-md') {
        exportMarkdownFile();
      } else if (cmd === 'export-html') {
        exportStandaloneHtml();
      } else if (cmd === 'export-pdf') {
        exportPrintPdf();
      } else if (cmd === 'copy-md') {
        navigator.clipboard?.writeText(textarea.value || '').then(() => {
          if (typeof options.onToast === 'function') options.onToast('📋 마크다운 원문을 복사했습니다.');
        });
      } else if (cmd === 'save') {
        triggerSave(false);
      }
    });

    paletteBar.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-pcat]');
      if (!tabBtn) return;
      activePaletteCat = tabBtn.dataset.pcat;
      paletteBar.querySelectorAll('[data-pcat]').forEach((b) => b.classList.toggle('active', b.dataset.pcat === activePaletteCat));
      renderPaletteButtons();
    });

    const onOutsideClick = (e) => {
      if (!e.target.closest('.mmd-table-wizard') && !e.target.closest('[data-cmd="table-wizard"]')) {
        tableWizard.style.display = 'none';
      }
      if (!e.target.closest('.mmd-slot-popover') && !e.target.closest('.mmd-live-math')) {
        closeSlotPopover();
      }
      if (!e.target.closest('.mmd-copy-ctxmenu')) {
        closeCopyCtxMenu();
      }
    };
    document.addEventListener('click', onOutsideClick);

    // ---- Initialize Content & KaTeX ----
    textarea.value = options.initialContent || '';
    renderPaletteButtons();
    applyFontSizes();
    setMode(currentMode);

    MD.ensureKaTeX().then((k) => {
      if (k) renderPreviewImmediate();
    });

    return {
      setMode,
      getContent() { return textarea.value; },
      setContent(val) {
        if (!isDirty) {
          textarea.value = val || '';
          renderPreviewImmediate();
        }
      },
      isDirty() { return isDirty; },
      save: triggerSave,
      destroy() {
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        if (mermaidDebounceTimer) clearTimeout(mermaidDebounceTimer);
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('mousemove', onVResizeMove);
        document.removeEventListener('mouseup', onVResizeUp);
        closeSlotPopover();
        closeCopyCtxMenu();
      }
    };
  }

  global.BrainMathMarkdown = {
    PALETTE_CATEGORIES,
    LATEX_SNIPPETS,
    compileSnippet,
    findMathAtCursor,
    mountMathMarkdownEditor
  };
})(window);
