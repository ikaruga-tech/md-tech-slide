import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { renderDeckToHtml } from '../src/renderer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('renderer', () => {
  it('renders SlideDeck into complete preview HTML', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const html = renderDeckToHtml(deck);

    // ドキュメント構造検証
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Technical Slide Sample</title>');
    expect(html).toContain('--bg-color: #F8FAFC'); // corporate テーマの背景
    expect(html).toContain('--font-heading: "Calibri"');

    // スライドカードの検証
    expect(html).toContain('data-slide-index="0"');
    expect(html).toContain('data-slide-index="1"');
    expect(html).toContain('data-slide-index="2"');

    // 2カラム + 比率 (ratio="2:1") の CSS Grid 検証
    expect(html).toContain('grid-template-columns: 2fr 1fr;');
    expect(html).toContain('Left Column (Main)');
    expect(html).toContain('Right Column (Side)');

    // コードブロック検証（シンタックスハイライト付き）
    expect(html).toContain('<pre class="code-block"><code class="language-typescript">');
    expect(html).toContain('hl-keyword');
    expect(html).toContain('SlideDeck');

    // 画像検証
    expect(html).toContain(
      '<img class="slide-image" src="./images/architecture.png" alt="Architecture Diagram" />'
    );

    // テーブル検証
    expect(html).toContain('<table class="slide-table">');
    expect(html).toContain('<th>Feature</th>');
    expect(html).toContain('<td>Editable Text</td>');

    // スピーカーノート検証
    expect(html).toContain('<details class="speaker-note-details">');
    expect(html).toContain('This is a speaker note for the 2-column slide.');
  });

  it('embeds client script when provided in options', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const script = 'console.log("preview client");';
    const html = renderDeckToHtml(deck, { scriptContent: script });

    expect(html).toContain(`<script>\n${script}\n</script>`);
  });

  it('resolves local relative image to Base64 data URI when baseDir is provided', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const html = renderDeckToHtml(deck, {
      baseDir: path.join(__dirname, 'fixtures'),
    });

    expect(html).toContain('<img class="slide-image" src="data:image/png;base64,');
    expect(html).toContain('alt="Architecture Diagram" />');
  });

  it('uses custom resolveImageSrc transformer when provided', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.md');
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const deck = parseMarkdownToSlideDeck(source);

    const html = renderDeckToHtml(deck, {
      resolveImageSrc: (src) => `https://cdn.example.com/${src}`,
    });

    expect(html).toContain(
      '<img class="slide-image" src="https://cdn.example.com/./images/architecture.png"'
    );
  });

  it('hides page numbers when paginate is false', () => {
    const source = `---
title: "No Pagination Deck"
paginate: false
---
# Slide 1

########

## Slide 2
Content
`;
    const deck = parseMarkdownToSlideDeck(source);
    const html = renderDeckToHtml(deck);

    expect(html).not.toContain('class="slide-footer"');
  });

  it('shows page numbers on content slides when paginate is true', () => {
    const source = `---
title: "Pagination Deck"
paginate: true
---
# Slide 1 (Title)

########

## Slide 2 (Content)
Content
`;
    const deck = parseMarkdownToSlideDeck(source);
    const html = renderDeckToHtml(deck);

    // 表紙（Title）には出ず、2枚目のコンテンツスライドに出る
    expect(html).toContain('<div class="slide-footer">2 / 2</div>');
  });
});
