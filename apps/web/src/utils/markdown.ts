/**
 * Renderizador Markdown mínimo e seguro para o DAS e o PDF.
 *
 * Cobre títulos, tabelas, listas, citações, negrito, código e régua horizontal
 * — o suficiente para o documento gerado pela API, sem dependências externas.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatação inline mínima usada pelo DAS (negrito e código). */
export function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map((cell) => cell.replace(/\u0000/g, '|').trim());
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      html.push(`<blockquote>${quote.map(renderInline).join('<br/>')}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    // Tabelas: agrupa linhas consecutivas que começam e terminam com "|".
    if (/^\|.*\|$/.test(trimmed)) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      flushAll();

      if (tableLines.length >= 2) {
        const isSeparator = (row: string) => /^\|[\s\-:|]+\|$/.test(row);
        const header = splitTableRow(tableLines[0]);
        const bodyStart = isSeparator(tableLines[1]) ? 2 : 1;
        const body = tableLines.slice(bodyStart).map(splitTableRow);
        const headHtml = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
        const bodyHtml = body
          .map((row) => {
            const cells = header.map((_, cellIndex) => row[cellIndex] ?? '');
            return `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`;
          })
          .join('');
        html.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      } else {
        html.push(`<p>${renderInline(tableLines.join(' '))}</p>`);
      }
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushAll();
      html.push('<hr/>');
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quote.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return html.join('\n');
}
