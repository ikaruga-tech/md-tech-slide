import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('parseMarkdownToSlideDeck', () => {
  it('parses sample fixture into structured SlideDeck', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');

    const deck = parseMarkdownToSlideDeck(source);

    // Frontmatter メタデータ検証
    expect(deck.metadata.title).toBe('Technical Slide Sample');
    expect(deck.metadata.author).toBe('Antigravity Team');
    expect(deck.metadata.theme).toBe('corporate');
    expect(deck.metadata.aspectRatio).toBe('16:9');

    // Typography 検証 (theme: corporate 由来)
    expect(deck.typography).toBeDefined();
    expect(deck.typography?.fonts.heading).toBe('Calibri');
    expect(deck.typography?.fonts.body).toBe('Calibri');
    expect(deck.typography?.fonts.code).toBe('Consolas');

    // スライド数検証
    expect(deck.slides).toHaveLength(3);

    // Slide 1 (Title slide)
    const slide1 = deck.slides[0];
    expect(slide1?.index).toBe(0);
    expect(slide1?.slots.header?.title).toBe('Technical Slide Showcase');
    expect(slide1?.slots.body.type).toBe('single');

    // Slide 2 (2-Columns + Ratio + Code + Image + Note)
    const slide2 = deck.slides[1];
    expect(slide2?.index).toBe(1);
    expect(slide2?.slots.header?.title).toBe('2-Column Architecture');
    expect(slide2?.slots.body.type).toBe('columns');

    if (slide2?.slots.body.type === 'columns') {
      expect(slide2.slots.body.ratio).toBe('2:1');
      expect(slide2.slots.body.columns).toHaveLength(2);

      // Left Column
      const leftCol = slide2.slots.body.columns[0];
      expect(leftCol?.id).toBe('col-1');
      expect(leftCol?.elements.some((el) => el.type === 'heading')).toBe(true);
      expect(leftCol?.elements.some((el) => el.type === 'list')).toBe(true);
      const codeEl = leftCol?.elements.find((el) => el.type === 'code');
      expect(codeEl).toBeDefined();
      if (codeEl?.type === 'code') {
        expect(codeEl.language).toBe('typescript');
        expect(codeEl.code).toContain('export interface SlideDeck');
      }

      // Right Column
      const rightCol = slide2.slots.body.columns[1];
      expect(rightCol?.id).toBe('col-2');
      const imgEl = rightCol?.elements.find((el) => el.type === 'image');
      expect(imgEl).toBeDefined();
      if (imgEl?.type === 'image') {
        expect(imgEl.src).toBe('./images/architecture.png');
        expect(imgEl.alt).toBe('Architecture Diagram');
      }
    }

    // Slide 2 Note
    expect(slide2?.note).toContain('This is a speaker note for the 2-column slide.');

    // Slide 3 (Table + Python Code + Comment Note)
    const slide3 = deck.slides[2];
    expect(slide3?.index).toBe(2);
    expect(slide3?.slots.header?.title).toBe('Code and Tables');
    expect(slide3?.slots.body.type).toBe('single');

    if (slide3?.slots.body.type === 'single') {
      const tableEl = slide3.slots.body.elements.find((el) => el.type === 'table');
      expect(tableEl).toBeDefined();
      if (tableEl?.type === 'table') {
        expect(tableEl.headers).toEqual(['Feature', 'md-tech-slide', 'Marp']);
        expect(tableEl.rows).toHaveLength(2);
        expect(tableEl.rows[0]).toEqual(['Editable Text', 'Yes', 'No']);
      }

      const pythonCode = slide3.slots.body.elements.find((el) => el.type === 'code');
      expect(pythonCode).toBeDefined();
      if (pythonCode?.type === 'code') {
        expect(pythonCode.language).toBe('python');
        expect(pythonCode.code).toContain('def generate_slide():');
      }
    }

    // Slide 3 Comment Note
    expect(slide3?.note).toBe('Another speaker note using comment syntax');
  });

  it('parses 3-column layout and nested lists correctly', () => {
    const input = `---
theme: "dark"
---
## 3-Column Layout

::: columns
::: column
- Item 1
  - Nested Item 1.1
- Item 2
:::
::: column
**Bold text** and *italic text* and \`code inline\`.
:::
::: column
3rd column content.
:::
:::`;

    const deck = parseMarkdownToSlideDeck(input);
    expect(deck.slides).toHaveLength(1);
    const slide = deck.slides[0];
    expect(slide?.slots.header?.title).toBe('3-Column Layout');
    expect(slide?.slots.body.type).toBe('columns');

    if (slide?.slots.body.type === 'columns') {
      expect(slide.slots.body.columns).toHaveLength(3);

      // 1st column: nested list
      const col1 = slide.slots.body.columns[0];
      const listEl = col1?.elements.find((el) => el.type === 'list');
      expect(listEl).toBeDefined();
      if (listEl?.type === 'list') {
        expect(listEl.items).toHaveLength(2);
        expect(listEl.items[0]?.children).toHaveLength(1);
      }

      // 2nd column: rich text spans
      const col2 = slide.slots.body.columns[1];
      const pEl = col2?.elements.find((el) => el.type === 'paragraph');
      expect(pEl).toBeDefined();
      if (pEl?.type === 'paragraph') {
        const boldSpan = pEl.spans.find((s) => s.bold);
        expect(boldSpan?.text).toBe('Bold text');
        const italicSpan = pEl.spans.find((s) => s.italic);
        expect(italicSpan?.text).toBe('italic text');
        const codeSpan = pEl.spans.find((s) => s.code);
        expect(codeSpan?.text).toBe('code inline');
      }

      // 3rd column
      const col3 = slide.slots.body.columns[2];
      expect(col3?.elements).toHaveLength(1);
    }
  });

  it('parses markdown with custom typography settings', () => {
    const markdown = `---
title: "Custom Font Slide"
font: "BIZ UDPGothic"
codeFont: "Cascadia Code"
fontSize:
  body: 18
  heading: 28
---
# First Slide
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    expect(deck.typography).toBeDefined();
    expect(deck.typography?.fonts.heading).toBe('BIZ UDPGothic');
    expect(deck.typography?.fonts.body).toBe('BIZ UDPGothic');
    expect(deck.typography?.fonts.code).toBe('Cascadia Code');
    expect(deck.typography?.sizes.body).toBe(18);
    expect(deck.typography?.sizes.heading).toBe(28);
  });
});
