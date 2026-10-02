import * as path from 'node:path';
import type {
  BlockElement,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  ListItem,
  CodeBlock,
  ImageBlock,
  TableBlock,
} from '../types/ir.js';
import type { PptxSlide, PptxTableCell } from '../types/pptx.js';
import type { SlideTheme } from '../theme/types.js';
import type { Rect } from '../layout/types.js';
import { highlightCodeToTextProps } from './syntax-highlighter.js';
import { resolveLocalResource } from '../resource/index.js';

export interface RenderOptions {
  readonly baseDir?: string;
  readonly allowedRoots?: readonly string[];
}

function countTotalListItems(items: readonly ListItem[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    if (item.children && item.children.length > 0) {
      count += countTotalListItems(item.children);
    }
  }
  return count;
}

function appendListItems(
  props: Array<{ text: string; options?: Record<string, unknown> }>,
  items: readonly ListItem[],
  theme: SlideTheme,
  indentLevel: number
): void {
  for (const item of items) {
    if (item.spans.length === 0) {
      continue;
    }

    item.spans.forEach((span, sIdx) => {
      const isFirst = sIdx === 0;
      const isLast = sIdx === item.spans.length - 1;
      const isCode = Boolean(span.code);
      const opts: Record<string, unknown> = {
        fontSize: 15,
        fontFace: isCode ? theme.fonts.code : theme.fonts.body,
        color: span.link
          ? theme.colors.accent
          : isCode
            ? theme.name === 'dark'
              ? '38BDF8'
              : theme.colors.accent
            : theme.colors.text,
        bold: isCode || span.bold,
        italic: span.italic,
      };

      if (isFirst) {
        opts.bullet = true;
        opts.indentLevel = indentLevel;
      }
      if (isLast) {
        opts.breakLine = true;
      }

      props.push({
        text: span.text,
        options: opts,
      });
    });

    if (item.children && item.children.length > 0) {
      appendListItems(props, item.children, theme, indentLevel + 1);
    }
  }
}

export async function renderSlotElements(
  slide: PptxSlide,
  elements: readonly BlockElement[],
  rect: Rect,
  theme: SlideTheme,
  options?: RenderOptions
): Promise<void> {
  if (elements.length === 0) {
    return;
  }

  // すべての要素をスタックモデルで上から順に配置
  let currentY = rect.y;
  const elementMargin = 0.18;

  for (const el of elements) {
    if (currentY >= rect.y + rect.h) {
      break;
    }

    const availableH = Math.max(0.4, rect.y + rect.h - currentY);

    switch (el.type) {
      case 'heading': {
        const heading = el as HeadingBlock;
        const fontSize = heading.level === 3 ? 19 : 17;
        const h = 0.38;

        // 見出しの前に適度な上マージンを持たせる
        if (currentY > rect.y) {
          currentY += 0.08;
        }

        slide.addText(heading.text, {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h,
          fontSize,
          fontFace: theme.fonts.heading,
          color: theme.colors.title,
          bold: true,
          valign: 'top',
        });
        currentY += h + 0.12;
        break;
      }

      case 'paragraph': {
        const paragraph = el as ParagraphBlock;
        const textProps = paragraph.spans.map((s) => {
          const isCode = Boolean(s.code);
          return {
            text: s.text,
            options: {
              fontSize: 15,
              fontFace: isCode ? theme.fonts.code : theme.fonts.body,
              color: s.link
                ? theme.colors.accent
                : isCode
                  ? theme.name === 'dark'
                    ? '38BDF8'
                    : theme.colors.accent
                  : theme.colors.text,
              bold: isCode || s.bold,
              italic: s.italic,
            },
          };
        });

        const totalChars = paragraph.spans.reduce((sum, s) => sum + s.text.length, 0);
        const charsPerLine = Math.max(15, Math.floor(rect.w * 4.2));
        const estimatedLines = Math.max(1, Math.ceil(totalChars / charsPerLine));
        const estimatedH = Math.min(availableH, Math.max(0.32, estimatedLines * 0.28));

        slide.addText(textProps, {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h: estimatedH,
          fit: 'shrink',
          valign: 'top',
        });
        currentY += estimatedH + elementMargin;
        break;
      }

      case 'list': {
        const list = el as ListBlock;
        const textProps: Array<{ text: string; options?: Record<string, unknown> }> = [];
        appendListItems(textProps, list.items, theme, 0);

        const itemCount = countTotalListItems(list.items);
        const estimatedH = Math.min(availableH, Math.max(0.35, itemCount * 0.32));

        slide.addText(textProps, {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h: estimatedH,
          fit: 'shrink',
          valign: 'top',
        });
        currentY += estimatedH + elementMargin;
        break;
      }

      case 'code': {
        const codeBlock = el as CodeBlock;
        const lineCount = codeBlock.code.split('\n').length;
        const codeH = Math.min(availableH, Math.max(0.8, lineCount * 0.28 + 0.3));

        // 背景用の角丸長方形シェイプを描画
        slide.addShape('roundRect', {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h: codeH,
          rectRadius: 0.08,
          fill: { color: theme.colors.codeBackground },
          line: { color: theme.colors.codeBackground, width: 0 },
        });

        // shiki でトークン化したテキストを重ねて描画
        const highlighted = await highlightCodeToTextProps(
          codeBlock.code,
          codeBlock.language,
          theme.shikiTheme,
          theme.fonts.code,
          theme.colors.codeText
        );

        slide.addText(highlighted, {
          x: rect.x + 0.15,
          y: currentY + 0.1,
          w: rect.w - 0.3,
          h: codeH - 0.2,
          fit: 'shrink',
          valign: 'top',
        });

        currentY += codeH + elementMargin;
        break;
      }

      case 'image': {
        const imageBlock = el as ImageBlock;
        const imgH = Math.min(availableH, 2.5);

        let resolvedPath = imageBlock.src;
        const isUrl = /^https?:\/\//i.test(resolvedPath);
        const isDataUri = /^data:/i.test(resolvedPath);

        if (!isUrl && !isDataUri) {
          const base = options?.baseDir ?? process.cwd();
          const resolved = resolveLocalResource({
            resourcePath: imageBlock.src,
            allowedRoots: options?.allowedRoots ?? [base],
            sourceMarkdownPath: path.join(base, 'index.md'),
          });
          resolvedPath = resolved.absolutePath;
        }

        slide.addImage({
          path: resolvedPath,
          x: rect.x,
          y: currentY,
          w: rect.w,
          h: imgH,
          sizing: { type: 'contain', w: rect.w, h: imgH },
        });
        currentY += imgH + elementMargin;
        break;
      }

      case 'table': {
        const tableBlock = el as TableBlock;
        const tableRows: PptxTableCell[][] = [];

        // ヘッダー行（濃紺背景に鮮明な白文字）
        if (tableBlock.headers.length > 0) {
          tableRows.push(
            tableBlock.headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                color: 'FFFFFF',
                fill: { color: theme.colors.codeBackground },
                fontFace: theme.fonts.heading,
                fontSize: 13,
              },
            }))
          );
        }

        // データ行（バッククォート囲みコードは等幅フォント＋アクセント色）
        for (const row of tableBlock.rows) {
          tableRows.push(
            row.map((cell) => {
              const trimmed = cell.trim();
              const isCode = /^`([^`]+)`$/.test(trimmed);
              const displayText = isCode ? trimmed.slice(1, -1) : cell;
              return {
                text: displayText,
                options: {
                  color: isCode
                    ? theme.name === 'dark'
                      ? '38BDF8'
                      : theme.colors.accent
                    : theme.colors.text,
                  fontFace: isCode ? theme.fonts.code : theme.fonts.body,
                  fontSize: 12,
                  bold: isCode,
                },
              };
            })
          );
        }

        const tableH = Math.min(availableH, Math.max(0.6, (tableBlock.rows.length + 1) * 0.35));
        slide.addTable(tableRows, {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h: tableH,
          border: { type: 'solid', pt: 1, color: theme.colors.muted },
        });

        currentY += tableH + elementMargin;
        break;
      }
    }
  }
}
