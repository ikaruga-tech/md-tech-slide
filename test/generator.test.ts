import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { generatePresentation, savePresentationToFile } from '../src/generator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('generator', () => {
  const outputPath = path.join(__dirname, '..', 'output', 'test_sample.pptx');

  afterAll(() => {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it('generates presentation instance from sample fixture', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const pptx = await generatePresentation(deck, {
      baseDir: path.dirname(fixturePath),
    });

    expect(pptx).toBeDefined();
    expect(pptx.layout).toBe('LAYOUT_WIDE');
    expect(pptx.title).toBe('Technical Slide Sample');
  });

  it('saves pptx file to disk successfully', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    await savePresentationToFile(deck, outputPath, {
      baseDir: path.dirname(fixturePath),
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(1000); // 正常なPPTXバイナリファイルサイズ
  });

  it('generates presentation from examples/01.md with mixed text elements', async () => {
    const examplePath = path.join(__dirname, '..', 'examples', '01.md');
    const source = fs.readFileSync(examplePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const exampleOutputPath = path.join(__dirname, '..', 'output', 'test_example01.pptx');
    await savePresentationToFile(deck, exampleOutputPath, {
      baseDir: path.dirname(examplePath),
    });

    expect(fs.existsSync(exampleOutputPath)).toBe(true);
    const stats = fs.statSync(exampleOutputPath);
    expect(stats.size).toBeGreaterThan(5000);

    if (fs.existsSync(exampleOutputPath)) {
      fs.unlinkSync(exampleOutputPath);
    }
  });
});
