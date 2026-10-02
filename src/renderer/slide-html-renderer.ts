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
import * as path from 'node:path';
import { resolveTheme } from '../theme/index.js';
import { escapeHtml } from './html-escape.js';
import { generatePreviewCss } from './css-styles.js';
import { highlightCodeToHtml } from './code-highlighter.js';
import { resolveLocalResource } from '../resource/index.js';
import { parseColumnRatio } from '../layout/index.js';

export interface RenderHtmlOptions {
  readonly scriptContent?: string;
  readonly baseDir?: string;
  readonly allowedRoots?: readonly string[];
  readonly resolveImageSrc?: (src: string) => string;
  readonly nonce?: string;
  readonly cspSource?: string;
}

interface RenderContext {
  readonly options?: RenderHtmlOptions;
  readonly dynamicStyles: Map<string, string>;
}

export function renderDeckToHtml(deck: SlideDeck, options?: RenderHtmlOptions): string {
  const aspectRatio = deck.metadata.aspectRatio === '4:3' ? '4:3' : '16:9';
  const theme = resolveTheme(deck.metadata.theme ? String(deck.metadata.theme) : undefined);
  const baseCss = generatePreviewCss(theme, aspectRatio);

  const defaultPaginate = deck.metadata.paginate !== false;
  const context: RenderContext = {
    options,
    dynamicStyles: new Map(),
  };

  const slidesHtml = deck.slides
    .map((slide) => renderSingleSlideHtml(slide, deck.slides.length, defaultPaginate, context))
    .join('\n');

  const nonceAttr = options?.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : '';

  const cspMeta =
    options?.cspSource && options?.nonce
      ? `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} data:; style-src ${options.cspSource} 'nonce-${options.nonce}'; script-src ${options.cspSource} 'nonce-${options.nonce}';">\n`
      : '';

  const dynamicCss = Array.from(context.dynamicStyles.values()).join('\n');
  const fullCss = dynamicCss
    ? `${baseCss}\n/* Dynamic grid layout classes */\n${dynamicCss}`
    : baseCss;

  const clientScript = options?.scriptContent
    ? `<script${nonceAttr}>\n${options.scriptContent}\n</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${cspMeta}  <title>${escapeHtml(deck.metadata.title ? String(deck.metadata.title) : 'Presentation Preview')}</title>
  <style${nonceAttr}>
${fullCss}
  </style>
</head>
<body>
${slidesHtml}
${clientScript}
</body>
</html>`.trim();
}

function renderSingleSlideHtml(
  slide: Slide,
  totalSlides: number,
  defaultPaginate: boolean,
  context: RenderContext
): string {
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
    bodyHtml = body.elements.map((el) => renderBlockElementHtml(el, context)).join('\n');
  } else if (body.type === 'columns') {
    bodyHtml = renderColumnsHtml(body, context);
  }

  const showPageNumber =
    slide.slots.footer?.pageNumber !== undefined
      ? slide.slots.footer.pageNumber
      : defaultPaginate && !isTitle;

  const footerHtml = showPageNumber
    ? `<div class="slide-footer">${slide.index + 1} / ${totalSlides}</div>`
    : '';

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

function renderColumnsHtml(columnsSlot: ColumnsSlot, context: RenderContext): string {
  const colCount = columnsSlot.columns.length;
  let ratioClass = '';

  if (columnsSlot.ratio) {
    const parsed = parseColumnRatio(columnsSlot.ratio, colCount);
    if (parsed.valid && parsed.frSegments && parsed.cssClassName) {
      ratioClass = parsed.cssClassName;
      if (!context.dynamicStyles.has(ratioClass)) {
        context.dynamicStyles.set(
          ratioClass,
          `.columns-container.${ratioClass} { grid-template-columns: ${parsed.frSegments.join(' ')}; }`
        );
      }
    }
  }

  const defaultColClass = `cols-count-${colCount}`;
  if (!ratioClass && !context.dynamicStyles.has(defaultColClass)) {
    context.dynamicStyles.set(
      defaultColClass,
      `.columns-container.${defaultColClass} { grid-template-columns: repeat(${colCount}, 1fr); }`
    );
  }

  const gridClass = ratioClass ? `${defaultColClass} ${ratioClass}` : defaultColClass;

  const colsHtml = columnsSlot.columns
    .map((col) => {
      const elementsHtml = col.elements.map((el) => renderBlockElementHtml(el, context)).join('\n');
      return `<div class="column-box">${elementsHtml}</div>`;
    })
    .join('\n');

  return `<div class="columns-container ${gridClass}">\n${colsHtml}\n</div>`;
}

export interface ResolveImageResult {
  readonly success: boolean;
  readonly src?: string;
  readonly errorName?: string;
  readonly errorMessage?: string;
}

export function resolveLocalImageSrc(
  src: string,
  baseDir: string,
  allowedRoots?: readonly string[]
): ResolveImageResult {
  const trimmed = src.trim();
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:')
  ) {
    return { success: true, src: trimmed };
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

  try {
    const resolved = resolveLocalResource({
      resourcePath: cleanPath,
      allowedRoots: allowedRoots ?? [baseDir],
      sourceMarkdownPath: path.join(baseDir, 'dummy.md'),
    });
    return { success: true, src: resolved.toDataUri() };
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'ResourceError';
    const filename = path.basename(cleanPath);
    return {
      success: false,
      errorName,
      errorMessage: `${errorName}: ${filename}`,
    };
  }
}

function renderBlockElementHtml(element: BlockElement, context: RenderContext): string {
  const options = context.options;
  switch (element.type) {
    case 'heading': {
      const heading = element as HeadingBlock;
      return `<h3>${escapeHtml(heading.text)}</h3>`;
    }

    case 'paragraph': {
      const para = element as ParagraphBlock;
      const spansHtml = para.spans.map(renderTextSpanHtml).join('');
      return `<p>${spansHtml}</p>`;
    }

    case 'list': {
      const list = element as ListBlock;
      return renderListHtml(list.items, list.ordered);
    }

    case 'code': {
      const code = element as CodeBlock;
      const langClass = code.language ? ` class="language-${escapeHtml(code.language)}"` : '';
      const highlightedHtml = highlightCodeToHtml(code.code, code.language);
      return `<pre class="code-block"><code${langClass}>${highlightedHtml}</code></pre>`;
    }

    case 'image': {
      const img = element as ImageBlock;
      if (options?.resolveImageSrc) {
        const customSrc = options.resolveImageSrc(img.src);
        return `<img class="slide-image" src="${escapeHtml(customSrc)}" alt="${escapeHtml(img.alt)}" />`;
      }
      if (options?.baseDir) {
        const result = resolveLocalImageSrc(img.src, options.baseDir, options.allowedRoots);
        if (result.success && result.src) {
          return `<img class="slide-image" src="${escapeHtml(result.src)}" alt="${escapeHtml(img.alt)}" />`;
        }
        const safeError = result.errorMessage
          ? escapeHtml(result.errorMessage)
          : 'Image Load Error';
        return `<div class="slide-image-error" role="alert"><span>Image Error: ${safeError}</span></div>`;
      }
      return `<img class="slide-image" src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" />`;
    }

    case 'table': {
      const tbl = element as TableBlock;
      let thead = '';
      if (tbl.headers.length > 0) {
        thead = `<thead><tr>${tbl.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
      }
      const tbody = `<tbody>${tbl.rows
        .map(
          (row) => `<tr>${row.map((cell) => `<td>${renderTableCellHtml(cell)}</td>`).join('')}</tr>`
        )
        .join('')}</tbody>`;
      return `<table class="slide-table">${thead}${tbody}</table>`;
    }
  }
}

function renderTableCellHtml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
}

function sanitizeLink(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
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
    const safeHref = sanitizeLink(span.link);
    if (safeHref) {
      text = `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  }
  return text;
}

function renderListHtml(items: readonly ListItem[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const itemsHtml = items
    .map((item) => {
      const text = item.spans.map(renderTextSpanHtml).join('');
      const childHtml =
        item.children && item.children.length > 0 ? renderListHtml(item.children, ordered) : '';
      return `<li>${text}${childHtml}</li>`;
    })
    .join('');

  return `<${tag}>${itemsHtml}</${tag}>`;
}
