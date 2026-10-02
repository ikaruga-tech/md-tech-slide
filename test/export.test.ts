import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { exportDeckToPptx, exportDeckToPdf } from '../src/export/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('export', () => {
  const pptxOutput = path.join(__dirname, '..', 'output', 'test_export_suite.pptx');
  const pdfOutput = path.join(__dirname, '..', 'output', 'test_export_suite.pdf');

  afterAll(() => {
    if (fs.existsSync(pptxOutput)) {
      fs.unlinkSync(pptxOutput);
    }
    if (fs.existsSync(pdfOutput)) {
      fs.unlinkSync(pdfOutput);
    }
  });

  it('exports presentation to PPTX file', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    await exportDeckToPptx(deck, pptxOutput, {
      baseDir: path.dirname(fixturePath),
    });

    expect(fs.existsSync(pptxOutput)).toBe(true);
    expect(fs.statSync(pptxOutput).size).toBeGreaterThan(1000);
  });

  it('throws error when no browser is found and invalid path provided', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    await expect(
      exportDeckToPdf(deck, pdfOutput, {
        browserPath: '/path/to/nonexistent/browser',
      })
    ).rejects.toThrow();
  });
});
