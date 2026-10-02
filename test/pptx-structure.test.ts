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
});
