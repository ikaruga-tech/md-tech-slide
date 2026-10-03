import type {
  SlideDeck,
  BlockElement,
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  CodeBlock,
  TableBlock,
  PptxRoleSizes,
} from '../types/ir.js';
import { getSlideGrid } from './grid.js';
import type { SlideGrid } from './types.js';
import { calculatePptxSizes, getDeckTypography } from '../theme/typography.js';

export interface LayoutDiagnosticIssue {
  readonly slideIndex: number; // 0-based
  readonly totalHeight: number;
  readonly availableHeight: number;
  readonly overflowAmount: number;
  readonly message: string;
  readonly columnId?: string;
}

const ELEMENT_MARGIN = 0.15;

export function estimateElementHeight(
  element: BlockElement,
  columnWidth: number,
  sizes?: PptxRoleSizes
): number {
  const resolvedSizes = sizes ?? calculatePptxSizes({});
  const bodyScale = resolvedSizes.body / 15;
  const headingScale = resolvedSizes.slideTitle / 26;
  const codeScale = resolvedSizes.code / 13;

  switch (element.type) {
    case 'heading': {
      const heading = element as HeadingBlock;
      let baseH = 0.45;
      if (heading.level === 1) baseH = 0.8;
      else if (heading.level === 2) baseH = 0.6;
      return baseH * headingScale + ELEMENT_MARGIN;
    }

    case 'paragraph': {
      const para = element as ParagraphBlock;
      const totalChars = para.spans.reduce((sum, s) => sum + s.text.length, 0);
      // カラム幅に応じた概算文字数/行（フォントサイズ比率に応じて文字幅がスケール）
      const charsPerLine = Math.max(10, Math.floor((columnWidth * 16) / bodyScale));
      const lineCount = Math.max(1, Math.ceil(totalChars / charsPerLine));
      return lineCount * 0.28 * bodyScale + ELEMENT_MARGIN;
    }

    case 'list': {
      const list = element as ListBlock;
      const countItems = (items: readonly { children?: readonly unknown[] }[]): number => {
        let count = 0;
        for (const item of items) {
          count++;
          if (item.children && Array.isArray(item.children)) {
            count += countItems(item.children as { children?: readonly unknown[] }[]);
          }
        }
        return count;
      };
      const totalItems = countItems(list.items);
      return Math.max(1, totalItems) * 0.28 * bodyScale + ELEMENT_MARGIN;
    }

    case 'code': {
      const code = element as CodeBlock;
      const lineCount = code.code.split('\n').length;
      return (lineCount * 0.22 + 0.3) * codeScale + ELEMENT_MARGIN;
    }

    case 'image': {
      return 2.2 + ELEMENT_MARGIN;
    }

    case 'table': {
      const tbl = element as TableBlock;
      const headerRatio = resolvedSizes.tableHeader / 13;
      const rowRatio = resolvedSizes.tableBody / 12;
      const totalRows = tbl.rows.length + 1;
      const avgScale = (headerRatio + tbl.rows.length * rowRatio) / totalRows;
      return totalRows * 0.35 * avgScale + ELEMENT_MARGIN;
    }
  }
}

export function analyzeLayoutOverflow(deck: SlideDeck): LayoutDiagnosticIssue[] {
  const is4x3 = deck.metadata.aspectRatio === '4:3';
  const grid: SlideGrid = getSlideGrid(is4x3 ? '4:3' : '16:9');
  const availableHeight = grid.body.h; // 通常 4.8 インチ
  const issues: LayoutDiagnosticIssue[] = [];

  const typography = getDeckTypography(deck);
  const pptxSizes = calculatePptxSizes(typography.sizes);

  for (const slide of deck.slides) {
    const slideIndex = slide.index; // 0-based
    const body = slide.slots.body;

    if (body.type === 'single') {
      let totalHeight = 0;
      for (const el of body.elements) {
        totalHeight += estimateElementHeight(el, grid.body.w, pptxSizes);
      }
      // 最後の余白を引く
      if (body.elements.length > 0) {
        totalHeight -= ELEMENT_MARGIN;
      }
      totalHeight = Math.round(totalHeight * 100) / 100;

      if (totalHeight > availableHeight) {
        const overflow = Math.round((totalHeight - availableHeight) * 100) / 100;
        issues.push({
          slideIndex,
          totalHeight,
          availableHeight,
          overflowAmount: overflow,
          message: `Slide ${slideIndex + 1} content height (${totalHeight}in) exceeds available body height (${availableHeight}in) by ${overflow}in.`,
        });
      }
    } else if (body.type === 'columns') {
      const colCount = body.columns.length;
      const defaultColWidth = (grid.body.w - 0.4 * (colCount - 1)) / colCount;

      for (let i = 0; i < body.columns.length; i++) {
        const col = body.columns[i];
        if (!col) continue;

        let colHeight = 0;
        for (const el of col.elements) {
          colHeight += estimateElementHeight(el, defaultColWidth, pptxSizes);
        }
        if (col.elements.length > 0) {
          colHeight -= ELEMENT_MARGIN;
        }
        colHeight = Math.round(colHeight * 100) / 100;

        if (colHeight > availableHeight) {
          const overflow = Math.round((colHeight - availableHeight) * 100) / 100;
          issues.push({
            slideIndex,
            columnId: col.id || `column-${i + 1}`,
            totalHeight: colHeight,
            availableHeight,
            overflowAmount: overflow,
            message: `Slide ${slideIndex + 1} column ${i + 1} height (${colHeight}in) exceeds available height (${availableHeight}in) by ${overflow}in.`,
          });
        }
      }
    }
  }

  return issues;
}
