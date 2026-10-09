import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { exportDeckToPdf } from '../src/export/pdf-exporter.js';
import { findInstalledBrowser } from '../src/export/browser-finder.js';
import { validatePdfBuffer } from './helpers/pdf-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('export-pdf-e2e tests (real browser verification)', () => {
  const browserPath = findInstalledBrowser();

  it('exports a real 16:9 PDF and validates MediaBox dimensions and text content', async () => {
    if (!browserPath) {
      throw new Error(
        'Real browser must be available for PDF E2E verification. Install Chrome/Edge or set PUPPETEER_EXECUTABLE_PATH.'
      );
    }

    const markdown = `---
title: "PDF E2E Verification Presentation"
aspectRatio: "16:9"
paginate: true
---

# E2E Verified Slide 1
Title and high level overview.

########

## Architecture & Benchmarks Slide 2

This slide tests precise MediaBox calculations and font glyph rendering.

- High Throughput: 50,000 req/sec
- Target Latency: < 2.5ms

\`\`\`typescript
export const verified = true;
\`\`\`
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const tempDir = path.resolve(__dirname, '../out/test-e2e');
    fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, 'e2e-16x9.pdf');

    try {
      await exportDeckToPdf(deck, outputPath, { browserPath });
      expect(fs.existsSync(outputPath)).toBe(true);

      const buffer = fs.readFileSync(outputPath);
      const validation = await validatePdfBuffer(buffer);

      // 1. ページ数
      expect(validation.pageCount).toBe(2);

      // 2. 16:9 MediaBox 寸法（960 x 540 pt）
      for (const page of validation.pages) {
        expect(page.aspectRatio).toBe('16:9');
        expect(page.widthPt).toBeCloseTo(960, 0);
        expect(page.heightPt).toBeCloseTo(540, 0);
      }

      // 3. テキスト内容の抽出検証
      expect(validation.text).toContain('E2E Verified Slide 1');
      expect(validation.text).toContain('Architecture & Benchmarks Slide 2');
      expect(validation.text).toContain('High Throughput');
    } finally {
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore cleanup error
        }
      }
    }
  });

  it('exports a real 4:3 PDF and validates 720 x 540 pt MediaBox dimensions', async () => {
    if (!browserPath) {
      throw new Error(
        'Real browser must be available for PDF E2E verification. Install Chrome/Edge or set PUPPETEER_EXECUTABLE_PATH.'
      );
    }

    const markdown = `---
title: "4:3 PDF Verification"
aspectRatio: "4:3"
---

# 4:3 Slide
Testing 720x540 point dimensions.
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const tempDir = path.resolve(__dirname, '../out/test-e2e');
    fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, 'e2e-4x3.pdf');

    try {
      await exportDeckToPdf(deck, outputPath, { browserPath });
      expect(fs.existsSync(outputPath)).toBe(true);

      const buffer = fs.readFileSync(outputPath);
      const validation = await validatePdfBuffer(buffer);

      expect(validation.pageCount).toBe(1);
      const page = validation.pages[0];
      expect(page?.aspectRatio).toBe('4:3');
      expect(page?.widthPt).toBeCloseTo(720, 0);
      expect(page?.heightPt).toBeCloseTo(540, 0);
    } finally {
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore cleanup error
        }
      }
    }
  });

  it('exports PDF containing Mermaid diagrams as vector SVG elements', async () => {
    if (!browserPath) {
      throw new Error('Real browser must be available for PDF E2E verification.');
    }

    const markdown = `---
title: "PDF Mermaid E2E Test"
aspectRatio: "16:9"
---

# Slide 1

Introduction to architecture.

########

## System Architecture

\`\`\`mermaid
graph TD
    Client[Web Client] --> Gateway[API Gateway]
    Gateway --> Microservice[Auth Service]
\`\`\`
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const tempDir = path.resolve(__dirname, '../out/test-e2e');
    fs.mkdirSync(tempDir, { recursive: true });
    const outputPath = path.join(tempDir, 'e2e-mermaid.pdf');

    try {
      await exportDeckToPdf(deck, outputPath, { browserPath });
      expect(fs.existsSync(outputPath)).toBe(true);

      const buffer = fs.readFileSync(outputPath);
      const validation = await validatePdfBuffer(buffer);

      expect(validation.pageCount).toBe(2);
      expect(validation.text).toContain('System Architecture');
      expect(validation.text).toContain('Web Client');
      expect(validation.text).toContain('API Gateway');
    } finally {
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore cleanup
        }
      }
    }
  });
});
