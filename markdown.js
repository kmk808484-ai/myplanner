(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(md) {
    if (!md) return '<span style="color: var(--text-muted);">내용 없음</span>';

    // 1. Extract fenced code blocks first so their contents aren't parsed as markdown
    const codeBlocks = [];
    let text = String(md).replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const safeCode = escapeHtml(code.replace(/\n$/, ''));
      codeBlocks.push(`<pre><code class="lang-${escapeHtml(lang)}">${safeCode}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    });

    // 2. Escape remaining HTML
    text = escapeHtml(text);

    // 3. Inline code
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // 4. Headings
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 5. Blockquotes
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 6. Bold & Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 7. Links [label](https://...)
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 8. Lists (unordered & ordered)
    const lines = text.split('\n');
    const out = [];
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
      const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);

      if (ulMatch) {
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (!inOl) { out.push('<ol>'); inOl = true; }
        out.push(`<li>${olMatch[1]}</li>`);
      } else {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (inOl) { out.push('</ol>'); inOl = false; }
        out.push(line);
      }
    }
    if (inUl) out.push('</ul>');
    if (inOl) out.push('</ol>');

    // 9. Paragraphs & line breaks
    let html = out.join('\n')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html = `<p>${html}</p>`
      .replace(/<p>(<(?:h[1-3]|ul|ol|blockquote|pre)[^>]*>)/g, '$1')
      .replace(/(<\/(?:h[1-3]|ul|ol|blockquote|pre)>)<\/p>/g, '$1')
      .replace(/<p><\/p>/g, '');

    // 10. Restore code blocks
    html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)] || '');

    return html;
  }

  global.BrainMarkdown = { render: renderMarkdown, escapeHtml };
})(window);
