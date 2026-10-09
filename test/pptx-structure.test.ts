import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { generatePresentation } from '../src/generator/index.js';
import { inspectPptxBuffer } from './helpers/pptx-inspector.js';

describe('pptx-structure regression tests', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures/comprehensive.md');
  const fixtureMarkdown = fs.readFileSync(fixturePath, 'utf-8');
  const baseDir = path.dirname(fixturePath);

  it('generates a 16:9 presentation matching exact OpenXML structure and dimensions', async () => {
    const deck = parseMarkdownToSlideDeck(fixtureMarkdown);
    const pptx = await generatePresentation(deck, { baseDir });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

    const info = await inspectPptxBuffer(buffer);

    // 1. スライド枚数
    expect(info.slideCount).toBe(7);

    // 2. 16:9 寸法検証 (13.33 x 7.5 インチ)
    expect(info.slideDimensions.widthInches).toBeCloseTo(13.33, 1);
    expect(info.slideDimensions.heightInches).toBeCloseTo(7.5, 1);

    // 3. スライド1: タイトルスライド
    const slide1 = info.slides[0];
    expect(slide1).toBeDefined();
    expect(slide1?.textContents.join(' ')).toContain('Comprehensive Technical Presentation');
    // タイトルスライドにはページネーション (1 / 7) が出ない
    expect(slide1?.textContents).not.toContain('1 / 7');

    // 4. スライド2: リッチテキスト＆ネストリスト
    const slide2 = info.slides[1];
    expect(slide2?.textContents.join(' ')).toContain('Text Formatting & Deep Structure');
    expect(slide2?.textContents.join(' ')).toContain('bold typography');
    expect(slide2?.textContents.join(' ')).toContain('Tier 1 High-level Overview');
    expect(slide2?.textContents.join(' ')).toContain('2 / 7');

    // 5. スライド3: シンタックスハイライトコード
    const slide3 = info.slides[2];
    expect(slide3?.textContents.join(' ')).toContain('High Performance TypeScript Engine');
    expect(slide3?.textContents.join(' ')).toContain('PerformanceBenchmark');
    expect(slide3?.textContents.join(' ')).toContain('3 / 7');

    // 6. スライド4: 複数カラム (2:1 ratio)
    const slide4 = info.slides[3];
    expect(slide4?.textContents.join(' ')).toContain('Distributed System Architecture');
    expect(slide4?.textContents.join(' ')).toContain('Primary Cluster');
    expect(slide4?.textContents.join(' ')).toContain('Operational Data');
    expect(slide4?.textContents.join(' ')).toContain('4 / 7');

    // 7. スライド5: 画像要素
    const slide5 = info.slides[4];
    expect(slide5?.hasImage).toBe(true);
    expect(slide5?.textContents.join(' ')).toContain('5 / 7');

    // 8. スライド6: テーブル要素
    const slide6 = info.slides[5];
    expect(slide6?.hasTable).toBe(true);
    expect(slide6?.textContents.join(' ')).toContain('Feature');
    expect(slide6?.textContents.join(' ')).toContain('Production');
    expect(slide6?.textContents.join(' ')).toContain('6 / 7');

    // 9. スライド7: スピーカーノート
    const slide7 = info.slides[6];
    expect(slide7?.hasNotes).toBe(true);
    expect(slide7?.notesText).toContain('strict verification checks');
    expect(slide7?.textContents.join(' ')).toContain('7 / 7');
  });

  it('generates a 4:3 presentation with accurate 10.0 x 7.5 inch dimensions', async () => {
    const markdown4x3 = fixtureMarkdown.replace(
      /aspectRatio:\s*['"]?16:9['"]?/,
      "aspectRatio: '4:3'"
    );
    const deck = parseMarkdownToSlideDeck(markdown4x3);
    const pptx = await generatePresentation(deck, { baseDir });
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

    const info = await inspectPptxBuffer(buffer);

    expect(info.slideDimensions.widthInches).toBeCloseTo(10.0, 1);
    expect(info.slideDimensions.heightInches).toBeCloseTo(7.5, 1);
  });

  describe('Phase 8: Typography OpenXML typeface and size verification', () => {
    it('applies custom fonts and scaled font sizes across all elements in OpenXML', async () => {
      const markdown = `---
title: "OpenXML Typography Test"
fonts:
  heading: "BIZ UDPGothic"
  body: "Yu Gothic"
  code: "Cascadia Code"
fontSize:
  heading: 28
  body: 18
paginate: true
---
# Main Title Slide

########

## Content Slide Title

This is regular body text and \`inline code\`.

- First list item
- Second list item with \`list code\`

\`\`\`typescript
const x = 42;
\`\`\`

| ColHeader |
| --- |
| \`codeCell\` |
| normalCell |
`;
      const deck = parseMarkdownToSlideDeck(markdown);
      const pptx = await generatePresentation(deck);
      const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

      const info = await inspectPptxBuffer(buffer);

      // Slide 1: Title slide title should be scaled from 36pt: 36 * (28 / 26) = 38.77pt
      const slide1 = info.slides[0];
      expect(slide1).toBeDefined();
      const titleRunSlide1 = slide1!.textRuns.find((r) => r.text === 'Main Title Slide');
      expect(titleRunSlide1).toBeDefined();
      expect(titleRunSlide1?.fontSizePt).toBeCloseTo(38.77, 1);
      expect(titleRunSlide1?.latinTypeface).toBe('BIZ UDPGothic');
      expect(titleRunSlide1?.eaTypeface).toBe('BIZ UDPGothic');

      // Slide 2: Content slide
      const slide2 = info.slides[1];
      expect(slide2).toBeDefined();
      const runs = slide2!.textRuns;
      expect(runs.length).toBeGreaterThan(0);

      // 1. Content Slide Title: should use heading font (BIZ UDPGothic) and exact heading size (28pt)
      const titleRun = runs.find((r) => r.text === 'Content Slide Title');
      expect(titleRun).toBeDefined();
      expect(titleRun?.fontSizePt).toBe(28);
      expect(titleRun?.latinTypeface).toBe('BIZ UDPGothic');
      expect(titleRun?.eaTypeface).toBe('BIZ UDPGothic');

      // 2. Body paragraph: should use body font (Yu Gothic) and body size (18pt)
      const bodyRun = runs.find((r) => r.text.includes('This is regular body text and'));
      expect(bodyRun).toBeDefined();
      expect(bodyRun?.fontSizePt).toBe(18);
      expect(bodyRun?.latinTypeface).toBe('Yu Gothic');
      expect(bodyRun?.eaTypeface).toBe('Yu Gothic');

      // 3. Inline code in paragraph: should use code font (Cascadia Code) and body size (18pt)
      const inlineCodeRun = runs.find((r) => r.text === 'inline code');
      expect(inlineCodeRun).toBeDefined();
      expect(inlineCodeRun?.fontSizePt).toBe(18);
      expect(inlineCodeRun?.latinTypeface).toBe('Cascadia Code');
      expect(inlineCodeRun?.eaTypeface).toBe('Cascadia Code');

      // 4. List item: should use body font (Yu Gothic) and list size (18pt)
      const listRun = runs.find((r) => r.text.includes('First list item'));
      expect(listRun).toBeDefined();
      expect(listRun?.fontSizePt).toBe(18);
      expect(listRun?.latinTypeface).toBe('Yu Gothic');
      expect(listRun?.eaTypeface).toBe('Yu Gothic');

      // 5. Code block token: should use code font (Cascadia Code) and scaled code size (18 / 15 * 13 = 15.6pt)
      const codeBlockToken = runs.find((r) => r.text === 'const' || r.text === 'x');
      expect(codeBlockToken).toBeDefined();
      expect(codeBlockToken?.fontSizePt).toBeCloseTo(15.6, 1);
      expect(codeBlockToken?.latinTypeface).toBe('Cascadia Code');
      expect(codeBlockToken?.eaTypeface).toBe('Cascadia Code');

      // 6. Table header: should use heading font (BIZ UDPGothic) and scaled header size (18 / 15 * 13 = 15.6pt)
      const tableHeaderRun = runs.find((r) => r.text === 'ColHeader');
      expect(tableHeaderRun).toBeDefined();
      expect(tableHeaderRun?.fontSizePt).toBeCloseTo(15.6, 1);
      expect(tableHeaderRun?.latinTypeface).toBe('BIZ UDPGothic');
      expect(tableHeaderRun?.eaTypeface).toBe('BIZ UDPGothic');

      // 7. Table code cell: should use code font (Cascadia Code) and scaled body size (18 / 15 * 12 = 14.4pt)
      const tableCodeRun = runs.find((r) => r.text === 'codeCell');
      expect(tableCodeRun).toBeDefined();
      expect(tableCodeRun?.fontSizePt).toBeCloseTo(14.4, 1);
      expect(tableCodeRun?.latinTypeface).toBe('Cascadia Code');
      expect(tableCodeRun?.eaTypeface).toBe('Cascadia Code');

      // 8. Table body normal cell: should use body font (Yu Gothic) and scaled body size (18 / 15 * 12 = 14.4pt)
      const tableNormalRun = runs.find((r) => r.text === 'normalCell');
      expect(tableNormalRun).toBeDefined();
      expect(tableNormalRun?.fontSizePt).toBeCloseTo(14.4, 1);
      expect(tableNormalRun?.latinTypeface).toBe('Yu Gothic');
      expect(tableNormalRun?.eaTypeface).toBe('Yu Gothic');

      // 9. Footer (Page number): should use body font (Yu Gothic) and scaled footer size (18 / 15 * 10 = 12pt)
      const footerRun = runs.find((r) => r.text.includes('2 / 2'));
      expect(footerRun).toBeDefined();
      expect(footerRun?.fontSizePt).toBeCloseTo(12, 1);
      expect(footerRun?.latinTypeface).toBe('Yu Gothic');
      expect(footerRun?.eaTypeface).toBe('Yu Gothic');
    });

    it('maintains exact default sizes when no typography is specified', async () => {
      const markdown = `---
title: "Default PPTX Test"
paginate: true
---
# Default Title Slide

########

## Default Content Title
Default body
`;
      const deck = parseMarkdownToSlideDeck(markdown);
      const pptx = await generatePresentation(deck);
      const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

      const info = await inspectPptxBuffer(buffer);

      // Slide 1: Title slide title default is 36pt
      const titleRunSlide1 = info.slides[0]!.textRuns.find((r) => r.text === 'Default Title Slide');
      expect(titleRunSlide1?.fontSizePt).toBe(36);

      // Slide 2: Content slide title default is 26pt, body default is 15pt, footer is 10pt
      const runsSlide2 = info.slides[1]!.textRuns;
      const titleRun = runsSlide2.find((r) => r.text === 'Default Content Title');
      expect(titleRun?.fontSizePt).toBe(26);

      const bodyRun = runsSlide2.find((r) => r.text.includes('Default body'));
      expect(bodyRun?.fontSizePt).toBe(15);

      const footerRun = runsSlide2.find((r) => r.text.includes('2 / 2'));
      expect(footerRun?.fontSizePt).toBe(10);
    });
  });

  describe('Mermaid vector SVG embedding in PPTX OpenXML', () => {
    it('embeds vector SVG in ppt/media/*.svg and places picture shape within bounds', async () => {
      const markdown = `---
title: "Vector Diagram Presentation"
theme: corporate
---

# Architecture Overview

\`\`\`mermaid
flowchart TD
    Client --> Server
    Server --> Database
\`\`\`

########

# Multi-column with Diagram

::: columns
::: column
### Left Details
Explanation text here.
:::
::: column
\`\`\`mermaid
sequenceDiagram
    A->>B: Ping
    B-->>A: Pong
\`\`\`
:::
:::
`;
      const deck = parseMarkdownToSlideDeck(markdown);
      const ownerId = `pptx-test-vector-${Date.now()}`;
      const pptx = await generatePresentation(deck, { ownerId });
      const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

      const info = await inspectPptxBuffer(buffer);

      // Verify slide count
      expect(info.slideCount).toBe(2);

      // Verify SVG vector media files exist in ppt/media/
      const svgMedia = info.mediaFiles.filter((f) => f.endsWith('.svg'));
      expect(svgMedia.length).toBeGreaterThanOrEqual(2);

      // Verify [Content_Types].xml defines SVG content type
      const svgContentType = info.contentTypes.find(
        (ct) => ct.extension === 'svg' || ct.contentType === 'image/svg+xml'
      );
      expect(svgContentType).toBeDefined();
      expect(svgContentType?.contentType).toBe('image/svg+xml');

      // Verify both slides contain picture shape elements (<p:pic>)
      expect(info.slides[0]!.hasImage).toBe(true);
      expect(info.slides[1]!.hasImage).toBe(true);

      // Verify slide 1 rels link to svg media
      const slide1SvgRels = info.slides[0]!.rels.filter((r) => r.target.endsWith('.svg'));
      expect(slide1SvgRels.length).toBeGreaterThanOrEqual(1);

      // Verify slide 1 contains OpenXML vector SVG extension (<asvg:svgBlip>)
      expect(info.slides[0]!.xml).toContain('asvg:svgBlip');
      expect(info.slides[0]!.xml).toContain(`r:embed="${slide1SvgRels[0]!.id}"`);

      // Verify slide 2 rels link to svg media
      const slide2SvgRels = info.slides[1]!.rels.filter((r) => r.target.endsWith('.svg'));
      expect(slide2SvgRels.length).toBeGreaterThanOrEqual(1);

      // Verify slide 2 contains OpenXML vector SVG extension (<asvg:svgBlip>)
      expect(info.slides[1]!.xml).toContain('asvg:svgBlip');
      expect(info.slides[1]!.xml).toContain(`r:embed="${slide2SvgRels[0]!.id}"`);

      // Verify slide 2 contains column text alongside the diagram
      expect(info.slides[1]!.textContents.join(' ')).toContain('Explanation text here.');
    }, 20000);

    it('embeds multiple diagrams in a single slide without media filename or relId collisions', async () => {
      const markdown = `---
title: "Dual Diagram Presentation"
---

# Parallel Architecture

::: columns
::: column
\`\`\`mermaid
flowchart TD
    A[Start] --> B[Process 1]
\`\`\`
:::
::: column
\`\`\`mermaid
flowchart TD
    C[Start] --> D[Process 2]
\`\`\`
:::
:::
`;
      const deck = parseMarkdownToSlideDeck(markdown);
      const ownerId = `pptx-test-dual-${Date.now()}`;
      const pptx = await generatePresentation(deck, { ownerId });
      const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

      const info = await inspectPptxBuffer(buffer);

      expect(info.slideCount).toBe(1);
      const slide = info.slides[0]!;

      // 2つの異なるSVGメディアファイルが生成されていること
      const svgMedia = info.mediaFiles.filter((f) => f.endsWith('.svg'));
      expect(svgMedia.length).toBe(2);
      expect(new Set(svgMedia).size).toBe(2);

      // [Content_Types].xml に image/svg+xml が登録されていること
      const svgContentType = info.contentTypes.find(
        (ct) => ct.extension === 'svg' || ct.contentType === 'image/svg+xml'
      );
      expect(svgContentType).toBeDefined();
      expect(svgContentType?.contentType).toBe('image/svg+xml');

      // スライドのリレーションが2つの異なるSVGメディアを指し、リレーションIDも一意であること
      const svgRels = slide.rels.filter((r) => r.target.endsWith('.svg'));
      expect(svgRels.length).toBe(2);
      const relIds = svgRels.map((r) => r.id);
      expect(new Set(relIds).size).toBe(2);
      const relTargets = svgRels.map((r) => r.target);
      expect(new Set(relTargets).size).toBe(2);

      // <p:pic> がスライドXML内に2つ存在すること
      const picMatches = Array.from(slide.xml.matchAll(/<p:pic[\s>]/g));
      expect(picMatches.length).toBe(2);

      // 各ピクチャ要素が asvg:svgBlip でそれぞれのSVGリレーションを参照していること
      for (const rel of svgRels) {
        expect(slide.xml).toContain(`r:embed="${rel.id}"`);
      }
    }, 20000);
  });
});
