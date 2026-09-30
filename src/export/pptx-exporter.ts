import type { SlideDeck } from '../types/ir.js';
import { savePresentationToFile } from '../generator/index.js';
import type { RenderOptions } from '../generator/element-renderer.js';

export interface PptxExportOptions extends RenderOptions {}

export async function exportDeckToPptx(
  deck: SlideDeck,
  outputPath: string,
  options?: PptxExportOptions
): Promise<void> {
  await savePresentationToFile(deck, outputPath, options);
}
