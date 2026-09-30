import PptxGenJSModule from 'pptxgenjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SlideDeck } from '../types/ir.js';
import type { PptxInstance } from '../types/pptx.js';
import { resolveTheme } from '../theme/index.js';
import { getSlideGrid } from '../layout/grid.js';
import { renderSlide } from './slide-renderer.js';
import type { RenderOptions } from './element-renderer.js';

// NodeNext / CommonJS の相互運用のためコンストラクタを取得
const PptxGenJSConstructor = (
  typeof PptxGenJSModule === 'function'
    ? PptxGenJSModule
    : (PptxGenJSModule as unknown as { default: new () => PptxInstance }).default
) as unknown as new () => PptxInstance;

export async function generatePresentation(
  deck: SlideDeck,
  options?: RenderOptions
): Promise<PptxInstance> {
  const pptx = new PptxGenJSConstructor();

  const is4x3 = deck.metadata.aspectRatio === '4:3';
  pptx.layout = is4x3 ? 'LAYOUT_4x3' : 'LAYOUT_WIDE';

  if (deck.metadata.title) {
    pptx.title = String(deck.metadata.title);
  }
  if (deck.metadata.author) {
    pptx.author = String(deck.metadata.author);
  }

  const theme = resolveTheme(deck.metadata.theme ? String(deck.metadata.theme) : undefined);
  const grid = getSlideGrid(is4x3 ? '4:3' : '16:9');

  for (const slideData of deck.slides) {
    const slide = pptx.addSlide();
    await renderSlide(slide, slideData, grid, theme, deck.slides.length, options);
  }

  return pptx;
}

export async function savePresentationToFile(
  deck: SlideDeck,
  outputPath: string,
  options?: RenderOptions
): Promise<void> {
  const pptx = await generatePresentation(deck, options);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await pptx.writeFile({ fileName: outputPath });
}
