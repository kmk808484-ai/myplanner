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

  function formatInline(str) {
    let text = str;
    // Inline code (protect inside placeholders first)
    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code>${code}</code>`);
      return `@@INLINECODE_${idx}@@`;
    });

    // Links [label](https://...)
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Bold, Italic, Strikethrough
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Restore inline code
    text = text.replace(/@@INLINECODE_(\d+)@@/g, (_, idx) => inlineCodes[Number(idx)] || '');
    return text;
  }

  function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function renderMarkdown(md) {
    if (!md) return '<span style="color: var(--text-muted);">내용 없음</span>';

    // 1. Extract fenced code blocks first
    const codeBlocks = [];
    let text = String(md).replace(/\r\n/g, '\n').replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const safeCode = escapeHtml(code.replace(/\n$/, ''));
      const langLabel = lang ? `<span class="code-lang-badge">${escapeHtml(lang)}</span>` : '';
      codeBlocks.push(`<div class="code-block-wrap">${langLabel}<pre><code class="lang-${escapeHtml(lang)}">${safeCode}</code></pre></div>`);
      return `\n@@CODEBLOCK_${idx}@@\n`;
    });

    // 2. Escape remaining HTML
    text = escapeHtml(text);

    // 3. Block-by-block parsing
    const lines = text.split('\n');
    const out = [];
    let inUl = false;
    let inOl = false;
    let checkboxIndex = 0;

    const closeLists = () => {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block placeholder
      const cbMatch = line.trim().match(/^@@CODEBLOCK_(\d+)@@$/);
      if (cbMatch) {
        closeLists();
        out.push(line.trim());
        continue;
      }

      // Horizontal rule
      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
        closeLists();
        out.push('<hr>');
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        closeLists();
        const level = hMatch[1].length;
        out.push(`<h${level}>${formatInline(hMatch[2])}</h${level}>`);
        continue;
      }

      // Blockquote
      const bqMatch = line.match(/^&gt;\s?(.*)$/);
      if (bqMatch) {
        closeLists();
        out.push(`<blockquote>${formatInline(bqMatch[1])}</blockquote>`);
        continue;
      }

      // Table
      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        closeLists();
        const headers = splitTableRow(line);
        let tableHtml = '<div class="md-table-wrap"><table><thead><tr>';
        headers.forEach((h) => {
          tableHtml += `<th>${formatInline(h)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        i += 2; // skip separator
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          const cols = splitTableRow(lines[i]);
          tableHtml += '<tr>';
          headers.forEach((_, idx) => {
            tableHtml += `<td>${formatInline(cols[idx] || '')}</td>`;
          });
          tableHtml += '</tr>';
          i++;
        }
        i--; // compensate loop increment
        tableHtml += '</tbody></table></div>';
        out.push(tableHtml);
        continue;
      }

      // Checklist item (- [ ] / - [x])
      const chkMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (chkMatch) {
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul class="md-checklist">'); inUl = true; }
        const checked = chkMatch[1].toLowerCase() === 'x';
        const cIdx = checkboxIndex++;
        out.push(
          `<li class="md-check-item${checked ? ' checked' : ''}">` +
          `<label><input type="checkbox" class="md-task-checkbox" data-checkbox-index="${cIdx}"${checked ? ' checked' : ''}>` +
          `<span>${formatInline(chkMatch[2])}</span></label></li>`
        );
        continue;
      }

      // Unordered list
      const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (ulMatch) {
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push(`<li>${formatInline(ulMatch[1])}</li>`);
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (!inOl) { out.push('<ol>'); inOl = true; }
        out.push(`<li>${formatInline(olMatch[1])}</li>`);
        continue;
      }

      // Blank line
      if (line.trim() === '') {
        closeLists();
        out.push('');
        continue;
      }

      // Regular paragraph line
      closeLists();
      out.push(`<p>${formatInline(line)}</p>`);
    }
    closeLists();

    let html = out.filter((s) => s !== '').join('\n');
    html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)] || '');
    return html;
  }

  global.BrainMarkdown = { render: renderMarkdown, escapeHtml };
})(window);
