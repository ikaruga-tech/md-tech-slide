import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { savePresentationToFile } from '../src/generator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  const inputPath = path.join(rootDir, 'test', 'fixtures', 'sample.md');
  const outputPath = path.join(rootDir, 'output', 'sample.pptx');

  console.log(`Reading Markdown from: ${inputPath}`);
  const source = fs.readFileSync(inputPath, 'utf-8');

  console.log('Parsing Markdown to Slide IR...');
  const deck = parseMarkdownToSlideDeck(source);
  console.log(
    `Parsed ${deck.slides.length} slides with theme "${deck.metadata.theme ?? 'default'}"`
  );

  console.log(`Generating PPTX to: ${outputPath}...`);
  await savePresentationToFile(deck, outputPath, {
    baseDir: path.dirname(inputPath),
  });

  const stats = fs.statSync(outputPath);
  console.log(`Successfully generated presentation! File size: ${stats.size} bytes`);
}

main().catch((err: unknown) => {
  console.error('Failed to generate presentation:', err);
  process.exit(1);
});
