import { describe, it, expect } from 'vitest';
import { getSlideGrid } from '../src/layout/grid.js';
import { calculateColumnRects } from '../src/layout/columns.js';

describe('layout', () => {
  it('calculates correct 16:9 and 4:3 grids', () => {
    const grid169 = getSlideGrid('16:9');
    expect(grid169.slideWidth).toBe(13.33);
    expect(grid169.slideHeight).toBe(7.5);
    expect(grid169.body.w).toBe(11.33);

    const grid43 = getSlideGrid('4:3');
    expect(grid43.slideWidth).toBe(10.0);
    expect(grid43.slideHeight).toBe(7.5);
    expect(grid43.body.w).toBe(8.4);
  });

  it('calculates 2 equal columns with gap', () => {
    const bodyRect = { x: 1.0, y: 2.0, w: 11.33, h: 4.8 };
    const cols = calculateColumnRects(bodyRect, 2, undefined, 0.5);

    expect(cols).toHaveLength(2);
    // (11.33 - 0.5) / 2 = 5.415
    expect(cols[0]?.w).toBe(5.415);
    expect(cols[0]?.x).toBe(1.0);
    expect(cols[1]?.x).toBe(1.0 + 5.415 + 0.5);
  });

  it('calculates columns with ratio specification', () => {
    const bodyRect = { x: 1.0, y: 2.0, w: 11.33, h: 4.8 };
    const cols = calculateColumnRects(bodyRect, 2, '2:1', 0.5);

    expect(cols).toHaveLength(2);
    // available = 11.33 - 0.5 = 10.83
    // col1 (2/3) = 10.83 * 2 / 3 = 7.22
    // col2 (1/3) = 10.83 * 1 / 3 = 3.61
    expect(cols[0]?.w).toBe(7.22);
    expect(cols[1]?.w).toBe(3.61);
    expect(cols[1]?.x).toBeCloseTo(8.72, 2);
  });

  it('throws error on mismatched ratio segments', () => {
    const bodyRect = { x: 1.0, y: 2.0, w: 11.33, h: 4.8 };
    expect(() => calculateColumnRects(bodyRect, 2, '1:2:1')).toThrow(
      'Ratio "1:2:1" specifies 3 parts, but column count is 2.'
    );
  });
});
