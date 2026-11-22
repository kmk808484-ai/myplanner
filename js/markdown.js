(function (global) {
  'use strict';

  const KATEX_CSS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  const KATEX_JS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  const MHCHEM_JS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/mhchem.min.js';
  const MERMAID_JS_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js';

  let katexLoadPromise = null;
  let mermaidLoadPromise = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadCssOnce(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && existing.dataset.loaded === 'true') { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureKaTeX() {
    if (global.katex) return global.katex;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    if (!katexLoadPromise) {
      loadCssOnce(KATEX_CSS_URL);
      katexLoadPromise = (async () => {
        await loadScriptOnce(KATEX_JS_URL);
        try { await loadScriptOnce(MHCHEM_JS_URL); } catch (_) {}
        return global.katex || null;
      })().catch(() => {
        katexLoadPromise = null;
        return null;
      });
    }
    return katexLoadPromise;
  }

  async function ensureMermaid() {
    if (global.mermaid) return global.mermaid;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    if (!mermaidLoadPromise) {
      mermaidLoadPromise = (async () => {
        await loadScriptOnce(MERMAID_JS_URL);
        if (global.mermaid) {
          global.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        }
        return global.mermaid || null;
      })().catch(() => {
        mermaidLoadPromise = null;
        return null;
      });
    }
    return mermaidLoadPromise;
  }

  // ================= Offline LaTeX-to-HTML Fallback Renderer =================
  const OFFLINE_LATEX_MAP = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\Gamma': 'Γ', '\\delta': 'δ', '\\Delta': 'Δ',
    '\\epsilon': 'ε', '\\varepsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\Theta': 'Θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\Lambda': 'Λ', '\\mu': 'μ', '\\nu': 'ν',
    '\\xi': 'ξ', '\\pi': 'π', '\\Pi': 'Π', '\\rho': 'ρ', '\\sigma': 'σ', '\\Sigma': 'Σ',
    '\\tau': 'τ', '\\phi': 'φ', '\\varphi': 'φ', '\\Phi': 'Φ', '\\chi': 'χ', '\\psi': 'ψ',
    '\\Psi': 'Ψ', '\\omega': 'ω', '\\Omega': 'Ω',
    '\\int': '∫', '\\iint': '∬', '\\iiint': '∭', '\\oint': '∮', '\\sum': '∑', '\\prod': '∏',
    '\\partial': '∂', '\\nabla': '∇', '\\infty': '∞', '\\pm': '±', '\\mp': '∓',
    '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\approx': '≈', '\\neq': '≠', '\\ne': '≠',
    '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\equiv': '≡', '\\propto': '∝',
    '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
    '\\Leftrightarrow': '⇔', '\\iff': '⇔', '\\forall': '∀', '\\exists': '∃', '\\in': '∈',
    '\\notin': '∉', '\\subset': '⊂', '\\subseteq': '⊆', '\\cup': '∪', '\\cap': '∩',
    '\\angle': '∠', '\\degree': '°', '\\circ': '°', '\\dots': '…', '\\cdots': '⋯', '\\ldots': '…',
    '\\quad': '&emsp;', '\\qquad': '&emsp;&emsp;', '\\,': '&thinsp;', '\\;': '&ensp;'
  };

  function readBracedGroup(str, startIdx) {
    if (str[startIdx] !== '{') return null;
    let depth = 1;
    let i = startIdx + 1;
    let out = '';
    while (i < str.length && depth > 0) {
      if (str[i] === '\\' && i + 1 < str.length) {
        out += str[i] + str[i + 1];
        i += 2;
        continue;
      }
      if (str[i] === '{') depth++;
      else if (str[i] === '}') { depth--; if (depth === 0) return { content: out, next: i + 1 }; }
      if (depth > 0) out += str[i++];
    }
    return null;
  }

  function renderOfflineChem(raw) {
    return escapeHtml(raw)
      .replace(/-&gt;/g, ' → ')
      .replace(/&lt;-&gt;/g, ' ⇌ ')
      .replace(/([A-Za-z)\]])(\d+)/g, '$1<sub>$2</sub>')
      .replace(/\^([0-9]*[+-])/g, '<sup>$1</sup>');
  }

  function renderOfflineLatexInner(tex) {
    let s = String(tex || '').trim();
    if (!s) return '';

    // Handle matrices & aligned / cases environments
    s = s.replace(/\\begin\{(bmatrix|pmatrix|vmatrix|matrix|cases|aligned)\}([\s\S]*?)\\end\{\1\}/g, (_, env, body) => {
      const rows = body.trim().split(/\\\\/).map((r) => r.trim()).filter(Boolean);
      const rowsHtml = rows.map((r) => {
        const cols = r.split('&').map((c) => `<td>${renderOfflineLatexInner(c)}</td>`).join('');
        return `<tr>${cols}</tr>`;
      }).join('');
      const cls = `md-m-env md-m-${env}`;
      return `<span class="${cls}"><table>${rowsHtml}</table></span>`;
    });

    // Replace \ce{...}
    let idx = 0;
    let result = '';
    while (idx < s.length) {
      if (s.startsWith('\\frac', idx)) {
        const g1 = readBracedGroup(s, idx + 5);
        const g2 = g1 ? readBracedGroup(s, g1.next) : null;
        if (g1 && g2) {
          result += `<span class="md-m-frac"><span class="md-m-num">${renderOfflineLatexInner(g1.content)}</span><span class="md-m-den">${renderOfflineLatexInner(g2.content)}</span></span>`;
          idx = g2.next;
          continue;
        }
      }
      if (s.startsWith('\\sqrt', idx)) {
        let pos = idx + 5;
        let rootIdx = '';
        if (s[pos] === '[') {
          const endB = s.indexOf(']', pos);
          if (endB > pos) { rootIdx = s.slice(pos + 1, endB); pos = endB + 1; }
        }
        const g = readBracedGroup(s, pos);
        if (g) {
          result += `<span class="md-m-sqrt">${rootIdx ? `<sup>${escapeHtml(rootIdx)}</sup>` : ''}√<span class="md-m-rad">${renderOfflineLatexInner(g.content)}</span></span>`;
          idx = g.next;
          continue;
        }
      }
      if (s.startsWith('\\ce', idx)) {
        const g = readBracedGroup(s, idx + 3);
        if (g) {
          result += `<span class="md-m-chem">${renderOfflineChem(g.content)}</span>`;
          idx = g.next;
          continue;
        }
      }
      if (s.startsWith('\\text', idx) || s.startsWith('\\mathrm', idx)) {
        const cmdLen = s.startsWith('\\mathrm', idx) ? 7 : 5;
        const g = readBracedGroup(s, idx + cmdLen);
        if (g) {
          result += `<span class="md-m-text">${escapeHtml(g.content)}</span>`;
          idx = g.next;
          continue;
        }
      }
      if (s.startsWith('\\mathcal', idx)) {
        const g = readBracedGroup(s, idx + 8);
        if (g) {
          const mapL = { L: 'ℒ', F: 'ℱ', H: 'ℋ', O: '𝒪', R: 'ℛ' };
          const ch = mapL[g.content.trim()] || g.content;
          result += `<span class="md-m-cal">${escapeHtml(ch)}</span>`;
          idx = g.next;
          continue;
        }
      }
      if (s.startsWith('\\dot', idx) || s.startsWith('\\ddot', idx) || s.startsWith('\\vec', idx) || s.startsWith('\\hat', idx) || s.startsWith('\\overline', idx) || s.startsWith('\\bar', idx)) {
        const m = s.slice(idx).match(/^\\(ddot|dot|vec|hat|overline|bar)/);
        if (m) {
          const g = readBracedGroup(s, idx + m[0].length);
          if (g) {
            const accMap = { dot: '̇', ddot: '̈', vec: '⃗', hat: '̂', bar: '̄' };
            if (m[1] === 'overline') {
              result += `<span style="text-decoration:overline;">${renderOfflineLatexInner(g.content)}</span>`;
            } else {
              result += `${renderOfflineLatexInner(g.content)}${accMap[m[1]] || ''}`;
            }
            idx = g.next;
            continue;
          }
        }
      }
      if (s.startsWith('\\left', idx) || s.startsWith('\\right', idx)) {
        idx += s.startsWith('\\right', idx) ? 6 : 5;
        if (s[idx] === '.') { idx++; continue; }
        continue;
      }
      if (s[idx] === '^' || s[idx] === '_') {
        const tag = s[idx] === '^' ? 'sup' : 'sub';
        idx++;
        if (s[idx] === '{') {
          const g = readBracedGroup(s, idx);
          if (g) {
            result += `<${tag}>${renderOfflineLatexInner(g.content)}</${tag}>`;
            idx = g.next;
            continue;
          }
        } else if (idx < s.length) {
          result += `<${tag}>${escapeHtml(s[idx++])}</${tag}>`;
          continue;
        }
      }
      if (s[idx] === '\\') {
        const cmdMatch = s.slice(idx).match(/^\\([A-Za-z]+|[,;!{}\[\]| ])/);
        if (cmdMatch) {
          const fullCmd = cmdMatch[0];
          if (OFFLINE_LATEX_MAP[fullCmd] !== undefined) {
            result += OFFLINE_LATEX_MAP[fullCmd];
          } else if (['\\{', '\\}', '\\[', '\\]', '\\|'].includes(fullCmd)) {
            result += escapeHtml(cmdMatch[1]);
          } else if (['\\sin', '\\cos', '\\tan', '\\ln', '\\log', '\\exp', '\\lim', '\\det', '\\max', '\\min', '\\arg'].includes(fullCmd)) {
            result += `<span class="md-m-op">${cmdMatch[1]}</span>`;
          } else {
            result += escapeHtml(cmdMatch[1]);
          }
          idx += fullCmd.length;
          continue;
        }
      }
      if (s[idx] === '{' || s[idx] === '}') { idx++; continue; }
      result += escapeHtml(s[idx++]);
    }
    return result;
  }

  function renderLatexToHtml(tex, displayMode = false) {
    const clean = String(tex || '').trim();
    if (!clean) return '';

    if (global.katex) {
      try {
        return global.katex.renderToString(clean, {
          displayMode: Boolean(displayMode),
          throwOnError: true,
          strict: false
        });
      } catch (err) {
        const msg = escapeHtml(err?.message || 'LaTeX 구문 오류');
        return `<span class="md-math-err-inline" title="${msg}">⚠️ ${escapeHtml(clean)}</span>`;
      }
    }

    const inner = renderOfflineLatexInner(clean);
    return displayMode
      ? `<div class="md-offline-math display">${inner}</div>`
      : `<span class="md-offline-math inline">${inner}</span>`;
  }

  // ================= MT-05: Math Syntax Validator =================
  function checkBraceBalance(tex) {
    let brace = 0;
    let leftCount = 0;
    for (let i = 0; i < tex.length; i++) {
      if (tex[i] === '\\' && i + 1 < tex.length) {
        if (tex.startsWith('\\left', i)) leftCount++;
        else if (tex.startsWith('\\right', i)) leftCount--;
        i++;
        continue;
      }
      if (tex[i] === '{') brace++;
      else if (tex[i] === '}') {
        brace--;
        if (brace < 0) return '닫는 중괄호 `}`가 여는 중괄호 `{`보다 많습니다.';
      }
    }
    if (brace > 0) return `열린 중괄호 \`{\`가 ${brace}개 닫히지 않았습니다.`;
    if (leftCount !== 0) return '\\left 와 \\right 쌍이 일치하지 않습니다.';
    return null;
  }

  function validateMathSyntax(md) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    const errors = [];

    // Strip fenced code blocks (preserve line count)
    const stripped = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));

    function lineAt(charIdx) {
      let line = 1;
      for (let i = 0; i < charIdx && i < stripped.length; i++) {
        if (stripped[i] === '\n') line++;
      }
      return line;
    }

    function inspectExpr(expr, displayMode, charIdx) {
      const line = lineAt(charIdx);
      const braceErr = checkBraceBalance(expr);
      if (braceErr) {
        errors.push({ line, expr: expr.trim().slice(0, 60), message: braceErr });
        return;
      }
      if (global.katex) {
        try {
          global.katex.renderToString(expr.trim(), { displayMode, throwOnError: true, strict: false });
        } catch (err) {
          const cleanMsg = String(err?.message || 'LaTeX 구문 오류').replace(/^KaTeX parse error:\s*/i, '');
          errors.push({ line, expr: expr.trim().slice(0, 60), message: cleanMsg });
        }
      }
    }

    // 1. Check block math $$...$$
    const withoutBlocks = stripped.replace(/\$\$([\s\S]*?)\$\$/g, (m, expr, offset) => {
      inspectExpr(expr, true, offset);
      return m.replace(/[^\n]/g, ' ');
    });

    // Check unclosed $$
    const unclosedBlockIdx = withoutBlocks.indexOf('$$');
    if (unclosedBlockIdx >= 0) {
      errors.push({ line: lineAt(unclosedBlockIdx), expr: '$$', message: '블록 수식 `$$`가 닫히지 않았습니다.' });
    }

    // 2. Check inline math $...$
    const inlineCleaned = withoutBlocks.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
    const reInline = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/g;
    let m;
    while ((m = reInline.exec(inlineCleaned)) !== null) {
      inspectExpr(m[1], false, m.index);
    }

    return errors;
  }

  // ================= Lightweight Offline Code Syntax Highlighter (ED-02) =================
  function highlightCode(code, lang = '') {
    const escaped = escapeHtml(code);
    const l = String(lang || '').toLowerCase();
    if (!l || l === 'text' || l === 'plain') return escaped;

    const tokens = [];
    const stash = (cls, raw) => {
      const idx = tokens.length;
      tokens.push(`<span class="hl-${cls}">${raw}</span>`);
      return `@@HL_${idx}@@`;
    };

    let out = escaped;
    // Comments
    out = out.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, (m) => {
      if (m.startsWith('#') && !['py', 'python', 'bash', 'sh', 'yaml', 'yml', 'r', 'powershell', 'ps1'].includes(l)) return m;
      return stash('comment', m);
    });
    // Strings
    out = out.replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;|&#39;(?:\\.|[^&]|&(?!#39;))*?&#39;|`[^`]*`)/g, (m) => stash('str', m));
    // Numbers
    out = out.replace(/\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, (m) => stash('num', m));
    // Keywords
    const kwRe = /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|async|await|try|catch|finally|import|from|export|default|def|elif|pass|lambda|with|as|in|not|and|or|True|False|None|true|false|null|undefined|int|float|double|void|struct|public|private|static|SELECT|FROM|WHERE|JOIN|ORDER|GROUP|BY|INSERT|UPDATE|DELETE)\b/g;
    out = out.replace(kwRe, (m) => stash('kw', m));

    out = out.replace(/@@HL_(\d+)@@/g, (_, idx) => tokens[Number(idx)] || '');
    return out;
  }

  // ================= Headings / TOC Extractor =================
  function extractHeadings(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const headings = [];
    let inFence = false;
    let hIdx = 0;

    lines.forEach((line, idx) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const m = line.match(/^(#{1,4})\s+(.+)$/);
      if (m) {
        headings.push({
          id: `md-h-${hIdx++}`,
          level: m[1].length,
          text: m[2].replace(/[*_`~]/g, '').trim(),
          line: idx + 1
        });
      }
    });
    return headings;
  }

  // ================= Core Markdown Renderer (GFM + Math + Mermaid + Footnotes) =================
  function formatInline(str, mathTokens) {
    let text = str;

    // Protect inline code first
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code>${code}</code>`);
      return `@@INLINECODE_${idx}@@`;
    });

    // Inline math $...$ (avoid matching currency like $100 alone unless paired)
    text = text.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (_, rawExpr) => {
      const idx = mathTokens.length;
      // Unescape HTML entities inside math before rendering
      const unescaped = rawExpr
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      mathTokens.push(renderLatexToHtml(unescaped, false));
      return `@@MATH_${idx}@@`;
    });

    // Images ![alt](src) — supports https://, http://, and data:image/...
    text = text.replace(
      /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^\s)]+)\)/g,
      '<img src="$2" alt="$1" class="md-inline-img">'
    );

    // Links [label](https://...)
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Footnote reference [^id]
    text = text.replace(
      /\[\^([A-Za-z0-9_-]+)\]/g,
      '<sup class="md-fn-ref"><a href="#fn-$1" id="fnref-$1">[$1]</a></sup>'
    );

    // Bold, Strikethrough, Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Restore inline code & math
    text = text.replace(/@@MATH_(\d+)@@/g, (_, idx) => mathTokens[Number(idx)] || '');
    text = text.replace(/@@INLINECODE_(\d+)@@/g, (_, idx) => inlineCodes[Number(idx)] || '');
    return text;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  }

  function parseTableAlignments(sepLine) {
    return splitTableRow(sepLine).map((cell) => {
      const c = cell.trim();
      if (c.startsWith(':') && c.endsWith(':')) return 'center';
      if (c.endsWith(':')) return 'right';
      if (c.startsWith(':')) return 'left';
      return '';
    });
  }

  function renderMarkdown(md) {
    if (!md) return '<span style="color: var(--text-muted);">내용 없음</span>';

    const codeBlocks = [];
    const mathTokens = [];
    const footnotes = [];

    let text = String(md).replace(/\r\n/g, '\n');

    // 1. Extract fenced code blocks & mermaid blocks first
    text = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const cleanCode = code.replace(/\n$/, '');
      if (String(lang || '').toLowerCase() === 'mermaid') {
        codeBlocks.push(
          `<div class="md-mermaid-wrap">` +
          `<div class="md-mermaid-block" data-mermaid="${escapeHtml(cleanCode)}">` +
          `<pre class="md-mermaid-fallback">${escapeHtml(cleanCode)}</pre>` +
          `</div></div>`
        );
      } else {
        const langLabel = lang ? `<span class="code-lang-badge">${escapeHtml(lang)}</span>` : '';
        const highlighted = highlightCode(cleanCode, lang);
        codeBlocks.push(`<div class="code-block-wrap">${langLabel}<pre><code class="lang-${escapeHtml(lang)}">${highlighted}</code></pre></div>`);
      }
      return `\n@@CODEBLOCK_${idx}@@\n`;
    });

    // 2. Extract display math blocks $$ ... $$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push(`<div class="md-math-block">${renderLatexToHtml(expr, true)}</div>`);
      return `\n@@MATHBLOCK_${idx}@@\n`;
    });

    // 3. Extract footnote definitions [^id]: text
    text = text.replace(/^\[\^([A-Za-z0-9_-]+)\]:\s*(.+)$/gm, (_, id, body) => {
      footnotes.push({ id, body });
      return '';
    });

    // 4. Escape remaining HTML
    text = escapeHtml(text);

    // 5. Block-by-block parsing
    const lines = text.split('\n');
    const out = [];
    let inUl = false;
    let inOl = false;
    let checkboxIndex = 0;
    let headingIdx = 0;

    const closeLists = () => {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const cbMatch = line.trim().match(/^@@CODEBLOCK_(\d+)@@$/);
      if (cbMatch) { closeLists(); out.push(line.trim()); continue; }

      const mbMatch = line.trim().match(/^@@MATHBLOCK_(\d+)@@$/);
      if (mbMatch) { closeLists(); out.push(line.trim()); continue; }

      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
        closeLists();
        out.push('<hr>');
        continue;
      }

      const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        closeLists();
        const level = hMatch[1].length;
        const hId = `md-h-${headingIdx++}`;
        out.push(`<h${level} id="${hId}">${formatInline(hMatch[2], mathTokens)}</h${level}>`);
        continue;
      }

      const bqMatch = line.match(/^&gt;\s?(.*)$/);
      if (bqMatch) {
        closeLists();
        out.push(`<blockquote>${formatInline(bqMatch[1], mathTokens)}</blockquote>`);
        continue;
      }

      // GFM Table with column alignment
      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        closeLists();
        const headers = splitTableRow(line);
        const aligns = parseTableAlignments(lines[i + 1]);
        let tableHtml = '<div class="md-table-wrap"><table><thead><tr>';
        headers.forEach((h, idx) => {
          const styleAttr = aligns[idx] ? ` style="text-align:${aligns[idx]};"` : '';
          tableHtml += `<th${styleAttr}>${formatInline(h, mathTokens)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          const cols = splitTableRow(lines[i]);
          tableHtml += '<tr>';
          headers.forEach((_, idx) => {
            const styleAttr = aligns[idx] ? ` style="text-align:${aligns[idx]};"` : '';
            tableHtml += `<td${styleAttr}>${formatInline(cols[idx] || '', mathTokens)}</td>`;
          });
          tableHtml += '</tr>';
          i++;
        }
        i--;
        tableHtml += '</tbody></table></div>';
        out.push(tableHtml);
        continue;
      }

      const chkMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (chkMatch) {
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul class="md-checklist">'); inUl = true; }
        const checked = chkMatch[1].toLowerCase() === 'x';
        const cIdx = checkboxIndex++;
        out.push(
          `<li class="md-check-item${checked ? ' checked' : ''}">` +
          `<label><input type="checkbox" class="md-task-checkbox" data-checkbox-index="${cIdx}"${checked ? ' checked' : ''}>` +
          `<span>${formatInline(chkMatch[2], mathTokens)}</span></label></li>`
        );
        continue;
      }

      const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (ulMatch) {
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push(`<li>${formatInline(ulMatch[1], mathTokens)}</li>`);
        continue;
      }

      const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (!inOl) { out.push('<ol>'); inOl = true; }
        out.push(`<li>${formatInline(olMatch[1], mathTokens)}</li>`);
        continue;
      }

      if (line.trim() === '') {
        closeLists();
        out.push('');
        continue;
      }

      closeLists();
      out.push(`<p>${formatInline(line, mathTokens)}</p>`);
    }
    closeLists();

    if (footnotes.length > 0) {
      let fnHtml = '<section class="md-footnotes"><hr><ol>';
      footnotes.forEach((fn) => {
        fnHtml += `<li id="fn-${escapeHtml(fn.id)}">${formatInline(escapeHtml(fn.body), mathTokens)} <a href="#fnref-${escapeHtml(fn.id)}" class="md-fn-back">↩</a></li>`;
      });
      fnHtml += '</ol></section>';
      out.push(fnHtml);
    }

    let html = out.filter((s) => s !== '').join('\n');
    html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)] || '');
    html = html.replace(/@@MATHBLOCK_(\d+)@@/g, (_, idx) => mathTokens[Number(idx)] || '');
    return html;
  }

  let mermaidRenderSeq = 0;
  async function renderMermaidBlocks(containerEl) {
    if (!containerEl) return;
    const blocks = containerEl.querySelectorAll('.md-mermaid-block[data-mermaid]');
    if (blocks.length === 0) return;

    const mermaid = await ensureMermaid();
    if (!mermaid) return;

    for (const block of blocks) {
      const code = block.getAttribute('data-mermaid') || '';
      if (!code.trim()) continue;
      const id = `sb-mmd-${++mermaidRenderSeq}`;
      try {
        const res = await mermaid.render(id, code);
        if (res && res.svg) {
          block.innerHTML = res.svg;
          block.classList.add('rendered');
        }
      } catch (err) {
        block.innerHTML = `<div class="md-mermaid-err">⚠️ Mermaid 다이어그램 오류: ${escapeHtml(err?.message || '구문 확인 필요')}</div><pre class="md-mermaid-fallback">${escapeHtml(code)}</pre>`;
      }
    }
  }

  // Trigger background KaTeX preload if online (never blocks offline execution)
  if (typeof window !== 'undefined' && navigator.onLine !== false) {
    setTimeout(() => { ensureKaTeX().catch(() => {}); }, 300);
  }

  global.BrainMarkdown = {
    render: renderMarkdown,
    escapeHtml,
    ensureKaTeX,
    ensureMermaid,
    renderLatexToHtml,
    renderMermaidBlocks,
    extractHeadings,
    validateMathSyntax
  };
})(window);
