import { describe, it, expect } from 'vitest';
import {
  getSlideLineRanges,
  findSlideIndexByLine,
  findSlideStartLine,
} from '../src/parser/slide-locator.js';

describe('slide-locator', () => {
  const markdown = `# Title Slide
Subtitle
########
## Second Slide
Line 4
Line 5
########
## Third Slide
Line 8`;

  it('calculates slide line ranges correctly', () => {
    const ranges = getSlideLineRanges(markdown);
    expect(ranges).toHaveLength(3);

    // Slide 1: lines 0〜1
    expect(ranges[0]?.startLine).toBe(0);
    expect(ranges[0]?.endLine).toBe(1);

    // Slide 2: lines 3〜5
    expect(ranges[1]?.startLine).toBe(3);
    expect(ranges[1]?.endLine).toBe(5);

    // Slide 3: lines 7〜8
    expect(ranges[2]?.startLine).toBe(7);
    expect(ranges[2]?.endLine).toBe(8);
  });

  it('finds correct slide index from cursor line', () => {
    expect(findSlideIndexByLine(markdown, 0)).toBe(0);
    expect(findSlideIndexByLine(markdown, 1)).toBe(0);
    expect(findSlideIndexByLine(markdown, 3)).toBe(1);
    expect(findSlideIndexByLine(markdown, 5)).toBe(1);
    expect(findSlideIndexByLine(markdown, 7)).toBe(2);
    expect(findSlideIndexByLine(markdown, 8)).toBe(2);
  });

  it('finds slide start line from slide index', () => {
    expect(findSlideStartLine(markdown, 0)).toBe(0);
    expect(findSlideStartLine(markdown, 1)).toBe(3);
    expect(findSlideStartLine(markdown, 2)).toBe(7);
  });
});
