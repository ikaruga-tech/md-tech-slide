import { describe, it, expect } from 'vitest';
import { calculateSvgContain } from '../src/layout/contain-layout.js';

describe('calculateSvgContain', () => {
  it('centers vertically when SVG is wider than target bounding box', () => {
    // 2:1 SVG inside a 1:1 box (100x100)
    const viewBox = { minX: 0, minY: 0, width: 200, height: 100 };
    const target = { x: 50, y: 50, width: 100, height: 100 };

    const placement = calculateSvgContain(viewBox, target);

    // scale = min(100/200, 100/100) = 0.5
    // width = 100, height = 50
    // offsetX = (100 - 100) / 2 = 0
    // offsetY = (100 - 50) / 2 = 25
    expect(placement.scale).toBe(0.5);
    expect(placement.width).toBe(100);
    expect(placement.height).toBe(50);
    expect(placement.x).toBe(50);
    expect(placement.y).toBe(75);
  });

  it('centers horizontally when SVG is taller than target bounding box', () => {
    // 1:2 SVG inside a 1:1 box (100x100)
    const viewBox = { minX: 0, minY: 0, width: 100, height: 200 };
    const target = { x: 0, y: 0, width: 100, height: 100 };

    const placement = calculateSvgContain(viewBox, target);

    // scale = min(100/100, 100/200) = 0.5
    // width = 50, height = 100
    // offsetX = (100 - 50) / 2 = 25
    // offsetY = (100 - 100) / 2 = 0
    expect(placement.scale).toBe(0.5);
    expect(placement.width).toBe(50);
    expect(placement.height).toBe(100);
    expect(placement.x).toBe(25);
    expect(placement.y).toBe(0);
  });

  it('fits perfectly when aspect ratios match', () => {
    const viewBox = { minX: 0, minY: 0, width: 1600, height: 900 };
    const target = { x: 10, y: 20, width: 800, height: 450 };

    const placement = calculateSvgContain(viewBox, target);
    expect(placement.scale).toBe(0.5);
    expect(placement.width).toBe(800);
    expect(placement.height).toBe(450);
    expect(placement.x).toBe(10);
    expect(placement.y).toBe(20);
  });

  it('handles zero or negative dimensions safely', () => {
    const viewBox = { minX: 0, minY: 0, width: 0, height: 100 };
    const target = { x: 0, y: 0, width: 100, height: 100 };

    const placement = calculateSvgContain(viewBox, target);
    expect(placement.scale).toBe(0);
    expect(placement.width).toBe(100);
    expect(placement.height).toBe(100);
  });
});
