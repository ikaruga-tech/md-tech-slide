import type { SlideDeck } from '../types/ir.js';
import { savePresentationToFile, type PptxExportOptions } from '../generator/index.js';

export type { PptxExportOptions };

export async function exportDeckToPptx(
  deck: SlideDeck,
  outputPath: string,
  options?: PptxExportOptions
): Promise<void> {
  await savePresentationToFile(deck, outputPath, options);
}
