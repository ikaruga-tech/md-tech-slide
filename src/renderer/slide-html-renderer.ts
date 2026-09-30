import type {
  SlideDeck,
  Slide,
  BlockElement,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  ListItem,
  CodeBlock,
  ImageBlock,
  TableBlock,
  TextSpan,
  ColumnsSlot,
} from '../types/ir.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveTheme } from '../theme/index.js';
import { escapeHtml } from './html-escape.js';
import { generatePreviewCss } from './css-styles.js';

export interface RenderHtmlOptions {
  readonly scriptContent?: string;
  readonly baseDir?: string;
  readonly resolveImageSrc?: (src: string) => string;
}

export function renderDeckToHtml(deck: SlideDeck, options?: RenderHtmlOptions): string {
  const aspectRatio = deck.metadata.aspectRatio === '4:3' ? '4:3' : '16:9';
  const theme = resolveTheme(deck.metadata.theme ? String(deck.metadata.theme) : undefined);
  const css = generatePreviewCss(theme, aspectRatio);

  const slidesHtml = deck.slides
    .map((slide) => renderSingleSlideHtml(slide, deck.slides.length, options))
    .join('\n');

  const clientScript = options?.scriptContent
    ? `<script>\n${options.scriptContent}\n</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(deck.metadata.title ? String(deck.metadata.title) : 'Presentation Preview')}</title>
  <style>
${css}
  </style>
</head>
<body>
${slidesHtml}
${clientScript}
</body>
</html>`.trim();
}

function renderSingleSlideHtml(slide: Slide, totalSlides: number, options?: RenderHtmlOptions): string {
  const isTitle = slide.type === 'title';
  const cardClasses = `slide-card${isTitle ? ' title-slide' : ''}`;

  let headerHtml = '';
  if (slide.slots.header && slide.slots.header.title) {
    headerHtml = `
      <div class="slide-header">
        <h2 class="slide-title">${escapeHtml(slide.slots.header.title)}</h2>
      </div>
    `.trim();
  }

  let bodyHtml = '';
  const body = slide.slots.body;
  if (body.type === 'single') {
    bodyHtml = body.elements.map((el) => renderBlockElementHtml(el, options)).join('\n');
  } else if (body.type === 'columns') {
    bodyHtml = renderColumnsHtml(body, options);
  }

  const footerHtml = `<div class="slide-footer">${slide.index + 1} / ${totalSlides}</div>`;

  let noteHtml = '';
  if (slide.note && slide.note.trim().length > 0) {
    noteHtml = `
      <details class="speaker-note-details">
        <summary>Speaker Notes</summary>
        <div class="speaker-note-content">${escapeHtml(slide.note.trim())}</div>
      </details>
    `.trim();
  }

  return `
  <div class="slide-container" data-slide-index="${slide.index}">
    <div class="${cardClasses}">
      ${headerHtml}
      <div class="slide-body">
        ${bodyHtml}
      </div>
      ${footerHtml}
    </div>
    ${noteHtml}
  </div>
  `.trim();
}

function renderColumnsHtml(columnsSlot: ColumnsSlot, options?: RenderHtmlOptions): string {
  const colCount = columnsSlot.columns.length;
  let gridStyle = `grid-template-columns: repeat(${colCount}, 1fr);`;

  if (columnsSlot.ratio) {
    const parts = columnsSlot.ratio.split(':');
    if (parts.length === colCount) {
      const frSegments = parts.map((p) => `${p.trim()}fr`).join(' ');
      gridStyle = `grid-template-columns: ${frSegments};`;
    }
  }

  const colsHtml = columnsSlot.columns
    .map((col) => {
      const elementsHtml = col.elements.map((el) => renderBlockElementHtml(el, options)).join('\n');
      return `<div class="column-box">${elementsHtml}</div>`;
    })
    .join('\n');

  return `<div class="columns-container" style="${gridStyle}">\n${colsHtml}\n</div>`;
}

export function resolveLocalImageSrc(src: string, baseDir: string): string {
  const trimmed = src.trim();
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  const queryIndex = trimmed.indexOf('?');
  const hashIndex = trimmed.indexOf('#');
  let cleanPath = trimmed;
  if (queryIndex !== -1 || hashIndex !== -1) {
    const splitIndex = Math.min(
      queryIndex !== -1 ? queryIndex : Infinity,
      hashIndex !== -1 ? hashIndex : Infinity
    );
    cleanPath = trimmed.slice(0, splitIndex);
  }

  const resolvedPath = path.isAbsolute(cleanPath)
    ? cleanPath
    : path.resolve(baseDir, cleanPath);

  if (fs.existsSync(resolvedPath)) {
    try {
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
      };
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const fileData = fs.readFileSync(resolvedPath);
      return `data:${mime};base64,${fileData.toString('base64')}`;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function renderBlockElementHtml(element: BlockElement, options?: RenderHtmlOptions): string {
  switch (element.type) {
    case 'heading': {
      const heading = element as HeadingBlock;
      return `<h3>${escapeHtml(heading.text)}</h3>`;
    }

    case 'paragraph': {
      const p = element as ParagraphBlock;
      const spansHtml = p.spans.map(renderTextSpanHtml).join('');
      return `<p>${spansHtml}</p>`;
    }

    case 'list': {
      const list = element as ListBlock;
      return renderListHtml(list.items, list.ordered);
    }

    case 'code': {
      const code = element as CodeBlock;
      const langClass = code.language ? ` class="language-${escapeHtml(code.language)}"` : '';
      return `<pre class="code-block"><code${langClass}>${escapeHtml(code.code)}</code></pre>`;
    }

    case 'image': {
      const img = element as ImageBlock;
      let resolvedSrc = img.src;
      if (options?.resolveImageSrc) {
        resolvedSrc = options.resolveImageSrc(img.src);
      } else if (options?.baseDir) {
        resolvedSrc = resolveLocalImageSrc(img.src, options.baseDir);
      }
      return `<img class="slide-image" src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(img.alt)}" />`;
    }

    case 'table': {
      const tbl = element as TableBlock;
      let thead = '';
      if (tbl.headers.length > 0) {
        thead = `<thead><tr>${tbl.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
      }
      const tbody = `<tbody>${tbl.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      return `<table class="slide-table">${thead}${tbody}</table>`;
    }
  }
}

function renderTextSpanHtml(span: TextSpan): string {
  let text = escapeHtml(span.text);
  if (span.code) {
    text = `<code class="inline-code">${text}</code>`;
  }
  if (span.bold) {
    text = `<strong>${text}</strong>`;
  }
  if (span.italic) {
    text = `<em>${text}</em>`;
  }
  if (span.link) {
    text = `<a href="${escapeHtml(span.link)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }
  return text;
}

function renderListHtml(items: readonly ListItem[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const itemsHtml = items
    .map((item) => {
      const text = item.spans.map(renderTextSpanHtml).join('');
      const childHtml = item.children && item.children.length > 0 ? renderListHtml(item.children, ordered) : '';
      return `<li>${text}${childHtml}</li>`;
    })
    .join('');

  return `<${tag}>${itemsHtml}</${tag}>`;
}
