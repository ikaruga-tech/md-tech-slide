import type { Slide as SlideData, TypographySettings } from '../types/ir.js';
import type { PptxSlide } from '../types/pptx.js';
import type { SlideTheme } from '../theme/types.js';
import type { SlideGrid } from '../layout/types.js';
import { calculateColumnRects } from '../layout/columns.js';
import { calculatePptxSizes } from '../theme/typography.js';
import { renderSlotElements, type RenderOptions } from './element-renderer.js';

export async function renderSlide(
  slide: PptxSlide,
  slideData: SlideData,
  grid: SlideGrid,
  theme: SlideTheme,
  totalSlides: number,
  options?: RenderOptions,
  defaultPaginate: boolean = true,
  typography?: TypographySettings
): Promise<void> {
  const pptxSizes = calculatePptxSizes(typography?.sizes ?? {});
  const headingFont = typography?.fonts.heading ?? theme.fonts.heading;
  const bodyFont = typography?.fonts.body ?? theme.fonts.body;

  // スライド背景色
  slide.background = { color: theme.colors.background };

  // Header 領域（タイトル）
  if (slideData.slots.header && slideData.slots.header.title) {
    const isTitleSlide = slideData.type === 'title';
    const fontSize = isTitleSlide ? pptxSizes.titleSlideTitle : pptxSizes.slideTitle;
    const y = isTitleSlide ? grid.header.y + 1.2 : grid.header.y;
    const h = isTitleSlide ? 1.8 : grid.header.h;

    slide.addText(slideData.slots.header.title, {
      x: grid.header.x,
      y,
      w: grid.header.w,
      h,
      fontSize,
      fontFace: headingFont,
      color: theme.colors.title,
      bold: true,
      valign: isTitleSlide ? 'middle' : 'top',
    });
  }

  // Body 領域
  const body = slideData.slots.body;
  if (body.type === 'single') {
    await renderSlotElements(slide, body.elements, grid.body, theme, options, typography);
  } else if (body.type === 'columns') {
    const columnRects = calculateColumnRects(grid.body, body.columns.length, body.ratio);

    for (let i = 0; i < body.columns.length; i++) {
      const column = body.columns[i];
      const rect = columnRects[i];
      if (column && rect) {
        await renderSlotElements(slide, column.elements, rect, theme, options, typography);
      }
    }
  }

  // Footer 領域（ページ番号）
  const isTitle = slideData.type === 'title';
  const showPageNumber =
    slideData.slots.footer?.pageNumber !== undefined
      ? slideData.slots.footer.pageNumber
      : defaultPaginate && !isTitle;

  if (showPageNumber) {
    const pageNumText = `${slideData.index + 1} / ${totalSlides}`;
    slide.addText(pageNumText, {
      x: grid.footer.x,
      y: grid.footer.y,
      w: grid.footer.w,
      h: grid.footer.h,
      fontSize: pptxSizes.footer,
      fontFace: bodyFont,
      color: theme.colors.muted,
      align: 'right',
    });
  }

  // スピーカーノート
  if (slideData.note && slideData.note.trim().length > 0) {
    slide.addNotes(slideData.note.trim());
  }
}
