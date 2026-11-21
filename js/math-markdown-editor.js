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
    let showToc = true;
    let showPalette = currentMode !== 'view';
    let activePaletteCat = PALETTE_CATEGORIES[0].id;
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
            <button type="button" class="md-mode-btn" data-mode="split" title="좌우 분할 뷰">⚡ 분할</button>
            <button type="button" class="md-mode-btn" data-mode="view" title="프리뷰 단독">📖 프리뷰</button>
          </div>
          <button type="button" class="mmd-btn active" data-cmd="toggle-toc" title="목차(TOC) 사이드바 토글">📑 목차</button>
          <button type="button" class="mmd-btn active" data-cmd="toggle-palette" title="비주얼 수식 팔레트 토글">∑ 팔레트</button>
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

    // 1b. Collapsible Visual Formula Palette Bar (MT-03)
    const paletteBar = document.createElement('div');
    paletteBar.className = 'mmd-palette-bar';
    const paletteTabsHtml = PALETTE_CATEGORIES.map((c) =>
      `<button type="button" class="mmd-ptab${c.id === activePaletteCat ? ' active' : ''}" data-pcat="${c.id}">${c.label}</button>`
    ).join('');
    paletteBar.innerHTML = `
      <div class="mmd-palette-tabs">${paletteTabsHtml}</div>
      <div class="mmd-palette-items" data-role="palette-items"></div>
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

    // 2. Main 3-Column Body (Left: TOC | Center-Left: Editor | Center-Right: Preview)
    const workspace = document.createElement('div');
    workspace.className = 'mmd-workspace';
    workspace.dataset.mode = currentMode;

    // 2a. Left TOC Sidebar
    const tocPane = document.createElement('aside');
    tocPane.className = 'mmd-toc-pane';
    tocPane.innerHTML = `
      <div class="mmd-toc-head">📑 문서 목차 (TOC)</div>
      <div class="mmd-toc-list" data-role="toc-list"></div>
    `;

    // 2b. Center-Left Editor Pane (Gutter + Textarea + Autocomplete + Cursor Mini Preview)
    const editorPane = document.createElement('div');
    editorPane.className = 'mmd-editor-pane';

    const editorScrollWrap = document.createElement('div');
    editorScrollWrap.className = 'mmd-editor-wrap';

    const gutter = document.createElement('div');
    gutter.className = 'mmd-gutter';

    const textarea = document.createElement('textarea');
    textarea.className = 'mmd-textarea';
    textarea.spellcheck = false;
    textarea.placeholder = '# 제목을 입력하고 수식($E = mc^2$, $$\\mathcal{L}\\{f(t)\\}$$)과 다이어그램을 작성해 보세요...';

    // MT-02: Autocomplete dropdown
    const acPopup = document.createElement('div');
    acPopup.className = 'mmd-ac-popup';
    acPopup.style.display = 'none';

    // MT-04: Cursor mini math preview tooltip
    const mathTooltip = document.createElement('div');
    mathTooltip.className = 'mmd-math-tooltip';
    mathTooltip.style.display = 'none';

    editorScrollWrap.appendChild(gutter);
    editorScrollWrap.appendChild(textarea);
    editorPane.appendChild(editorScrollWrap);
    editorPane.appendChild(acPopup);
    editorPane.appendChild(mathTooltip);

    // 2c. Center-Right Live Preview Pane
    const previewPane = document.createElement('div');
    previewPane.className = 'mmd-preview-pane';
    const viewerInner = document.createElement('div');
    viewerInner.className = 'mmd-preview-inner markdown-body';
    previewPane.appendChild(viewerInner);

    workspace.appendChild(tocPane);
    workspace.appendChild(editorPane);
    workspace.appendChild(previewPane);

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
    root.appendChild(paletteBar);
    root.appendChild(findBar);
    root.appendChild(tableWizard);
    root.appendChild(workspace);
    root.appendChild(statusBar);
    root.appendChild(openFileInput);
    container.appendChild(root);

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

    let findCaseSensitive = false;
    let findUseRegex = false;
    let latestMathErrors = [];

    // ---- Render Palette Buttons ----
    function renderPaletteButtons() {
      const cat = PALETTE_CATEGORIES.find((c) => c.id === activePaletteCat) || PALETTE_CATEGORIES[0];
      elPaletteItems.innerHTML = '';
      cat.items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mmd-pitem';
        b.textContent = it.label;
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
      if (currentMode === 'view' || document.activeElement !== textarea) {
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
      const approxY = (lineNum * lineHeight) - textarea.scrollTop + 14;
      const maxTop = Math.max(20, editorPane.clientHeight - 110);
      mathTooltip.style.top = `${Math.max(12, Math.min(maxTop, approxY))}px`;
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
      const approxY = (lineNum * lineHeight) - textarea.scrollTop + 14;
      const maxTop = Math.max(20, editorPane.clientHeight - 190);
      acPopup.style.top = `${Math.max(10, Math.min(maxTop, approxY))}px`;
      acPopup.style.display = 'flex';
    }

    function applyAutocomplete(item) {
      if (!item || acTokenStart < 0) return;
      const pos = textarea.selectionStart;
      hideAutocomplete();
      insertCompiledSnippet(item.snippet, acTokenStart, pos, false);
    }

    // ---- Performance-Optimized Preview Rendering ----
    function renderPreviewImmediate() {
      const md = textarea.value || '';
      latestMathErrors = MD.validateMathSyntax(md);
      viewerInner.innerHTML = MD.render(md);
      updateGutter();
      updateToc();
      updateCursorStatus();
      elEngineBadge.textContent = global.katex ? '∑ KaTeX 활성' : '∑ 오프라인 수식 엔진';

      if (mermaidDebounceTimer) clearTimeout(mermaidDebounceTimer);
      mermaidDebounceTimer = setTimeout(() => {
        MD.renderMermaidBlocks(viewerInner).catch(() => {});
      }, 280);
    }

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
      const maxPr = Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
      previewPane.scrollTop = ratio * maxPr;
      requestAnimationFrame(() => { if (scrollSyncLock === 'editor') scrollSyncLock = null; });
    });

    previewPane.addEventListener('scroll', () => {
      if (currentMode !== 'split' || scrollSyncLock === 'editor') return;
      scrollSyncLock = 'preview';
      const maxPr = Math.max(1, previewPane.scrollHeight - previewPane.clientHeight);
      const ratio = previewPane.scrollTop / maxPr;
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
        paletteBar.style.display = 'none';
        mathTooltip.style.display = 'none';
      } else {
        paletteBar.style.display = showPalette ? 'flex' : 'none';
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

      if (cmd === 'toggle-toc') {
        showToc = !showToc;
        tocPane.style.display = showToc ? 'flex' : 'none';
        cmdBtn.classList.toggle('active', showToc);
      } else if (cmd === 'toggle-palette') {
        showPalette = !showPalette;
        paletteBar.style.display = showPalette && currentMode !== 'view' ? 'flex' : 'none';
        cmdBtn.classList.toggle('active', showPalette);
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
