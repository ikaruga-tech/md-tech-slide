import * as fs from 'node:fs';
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

export interface RenderOptions {
  readonly baseDir?: string;
}

function isPureTextElements(elements: readonly BlockElement[]): boolean {
  return elements.every((el) => el.type === 'heading' || el.type === 'paragraph' || el.type === 'list');
}

function buildTextPropsFromBlocks(
  elements: readonly BlockElement[],
  theme: SlideTheme
): Array<{ text: string; options?: Record<string, unknown> }> {
  const props: Array<{ text: string; options?: Record<string, unknown> }> = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) {
      continue;
    }

    if (el.type === 'heading') {
      const heading = el as HeadingBlock;
      const fontSize = heading.level === 3 ? 20 : 18;
      props.push({
        text: heading.text,
        options: {
          fontSize,
          fontFace: theme.fonts.heading,
          color: theme.colors.title,
          bold: true,
          breakLine: true,
        },
      });
    } else if (el.type === 'paragraph') {
      const paragraph = el as ParagraphBlock;
      for (const span of paragraph.spans) {
        props.push({
          text: span.text,
          options: {
            fontSize: 15,
            fontFace: theme.fonts.body,
            color: span.link ? theme.colors.accent : theme.colors.text,
            bold: span.bold,
            italic: span.italic,
          },
        });
      }
      props.push({ text: '\n', options: { fontSize: 10 } });
    } else if (el.type === 'list') {
      const list = el as ListBlock;
      appendListItems(props, list.items, theme, 0);
    }
  }

  return props;
}

function appendListItems(
  props: Array<{ text: string; options?: Record<string, unknown> }>,
  items: readonly ListItem[],
  theme: SlideTheme,
  indentLevel: number
): void {
  for (const item of items) {
    const itemText = item.spans.map((s) => s.text).join('');
    props.push({
      text: itemText,
      options: {
        fontSize: 15,
        fontFace: theme.fonts.body,
        color: theme.colors.text,
        bullet: true,
        indentLevel,
        breakLine: true,
      },
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

  // テキスト要素のみの場合は 1 つの Text Frame にまとめて描画
  if (isPureTextElements(elements)) {
    const textProps = buildTextPropsFromBlocks(elements, theme);
    slide.addText(textProps, {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      fit: 'shrink',
      valign: 'top',
    });
    return;
  }

  // 複合要素が含まれる場合はスタックモデルで上から順に配置
  let currentY = rect.y;
  const elementMargin = 0.2;

  for (const el of elements) {
    if (currentY >= rect.y + rect.h) {
      break;
    }

    const availableH = Math.max(0.5, rect.y + rect.h - currentY);

    switch (el.type) {
      case 'heading': {
        const heading = el as HeadingBlock;
        const h = 0.4;
        slide.addText(heading.text, {
          x: rect.x,
          y: currentY,
          w: rect.w,
          h,
          fontSize: heading.level === 3 ? 20 : 18,
          fontFace: theme.fonts.heading,
          color: theme.colors.title,
          bold: true,
          valign: 'top',
        });
        currentY += h + elementMargin;
        break;
      }

      case 'paragraph': {
        const paragraph = el as ParagraphBlock;
        const textProps = paragraph.spans.map((s) => ({
          text: s.text,
          options: {
            fontSize: 15,
            fontFace: theme.fonts.body,
            color: s.link ? theme.colors.accent : theme.colors.text,
            bold: s.bold,
            italic: s.italic,
          },
        }));
        const estimatedH = Math.min(availableH, Math.max(0.4, paragraph.spans.length * 0.25));
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
        const estimatedH = Math.min(availableH, Math.max(0.5, list.items.length * 0.35));
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
          if (!path.isAbsolute(resolvedPath)) {
            const base = options?.baseDir ?? process.cwd();
            resolvedPath = path.resolve(base, resolvedPath);
          }
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Image not found at path: ${resolvedPath} (referenced as "${imageBlock.src}")`);
          }
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

        // ヘッダー行
        if (tableBlock.headers.length > 0) {
          tableRows.push(
            tableBlock.headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                color: theme.colors.title,
                fill: { color: theme.colors.codeBackground },
                fontFace: theme.fonts.heading,
                fontSize: 13,
              },
            }))
          );
        }

        // データ行
        for (const row of tableBlock.rows) {
          tableRows.push(
            row.map((cell) => ({
              text: cell,
              options: {
                color: theme.colors.text,
                fontFace: theme.fonts.body,
                fontSize: 12,
              },
            }))
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
