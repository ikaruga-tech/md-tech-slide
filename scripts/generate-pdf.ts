import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { exportDeckToPdf } from '../src/export/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  const inputPath = path.join(rootDir, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(rootDir, 'output', 'sample.pdf');

  console.log(`Reading Markdown from: ${inputPath}`);
  const source = fs.readFileSync(inputPath, 'utf-8');

  console.log('Parsing Markdown to Slide IR...');
  const deck = parseMarkdownToSlideDeck(source);
  console.log(
    `Parsed ${deck.slides.length} slides with theme "${deck.metadata.theme ?? 'default'}"`
  );

  console.log(`Generating PDF to: ${outputPath}...`);
  await exportDeckToPdf(deck, outputPath, {
    baseDir: path.dirname(inputPath),
  });

  const stats = fs.statSync(outputPath);
  console.log(`Successfully generated PDF presentation! File size: ${stats.size} bytes`);
}

main().catch((err: unknown) => {
  console.error('Failed to generate PDF presentation:', err);
  process.exit(1);
});
