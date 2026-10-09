import { describe, it, expect } from 'vitest';
import { DiagramCache } from '../src/diagram/diagram-cache.js';
import type { SanitizedSvgResult } from '../src/diagram/svg-sanitizer.js';

describe('DiagramCache', () => {
  const dummySvgResult = (svg: string): SanitizedSvgResult => ({
    svg,
    viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
    width: 100,
    height: 100,
    aspectRatio: 1.0,
  });

  it('generates deterministic cache keys based on source, config, theme, and version', () => {
    const k1 = DiagramCache.createKey('graph TD; A-->B;', 'default', 'light', '12.1.0');
    const k2 = DiagramCache.createKey('graph TD; A-->B;', 'default', 'light', '12.1.0');
    const k3 = DiagramCache.createKey('graph TD; A-->B;', 'default', 'dark', '12.1.0');

    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('evicts least recently used items when maxItems is exceeded', () => {
    const cache = new DiagramCache({ maxItems: 3 });

    cache.set('k1', dummySvgResult('<svg>1</svg>'));
    cache.set('k2', dummySvgResult('<svg>2</svg>'));
    cache.set('k3', dummySvgResult('<svg>3</svg>'));

    // Access k1 to make it most recently used (LRU order becomes: k2, k3, k1)
    expect(cache.get('k1')?.svg).toBe('<svg>1</svg>');

    // Adding k4 should evict k2
    cache.set('k4', dummySvgResult('<svg>4</svg>'));

    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
    expect(cache.get('k4')).toBeDefined();
  });

  it('evicts items when maxBytes is exceeded', () => {
    // 100 bytes max limit
    const cache = new DiagramCache({ maxBytes: 100 });

    const item30a = dummySvgResult('<svg>' + 'a'.repeat(30) + '</svg>'); // 41 bytes
    const item30b = dummySvgResult('<svg>' + 'b'.repeat(30) + '</svg>'); // 41 bytes
    const item30c = dummySvgResult('<svg>' + 'c'.repeat(30) + '</svg>'); // 41 bytes

    cache.set('k1', item30a);
    cache.set('k2', item30b);
    expect(cache.currentItemCount).toBe(2);

    // Adding k3 exceeds 100 bytes, so k1 is evicted
    cache.set('k3', item30c);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
  });

  it('deduplicates simultaneous in-flight compute requests for the same key', async () => {
    const cache = new DiagramCache();
    let computeCount = 0;

    const compute = async () => {
      computeCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return dummySvgResult('<svg>shared</svg>');
    };

    const [r1, r2, r3] = await Promise.all([
      cache.getOrCompute('shared-key', compute),
      cache.getOrCompute('shared-key', compute),
      cache.getOrCompute('shared-key', compute),
    ]);

    expect(computeCount).toBe(1);
    expect(r1.svg).toBe('<svg>shared</svg>');
    expect(r2.svg).toBe('<svg>shared</svg>');
    expect(r3.svg).toBe('<svg>shared</svg>');
  });

  it('does not cache failed in-flight computations and allows retry', async () => {
    const cache = new DiagramCache();
    let attempt = 0;

    const failingCompute = async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('Transient failure');
      }
      return dummySvgResult('<svg>recovered</svg>');
    };

    await expect(cache.getOrCompute('fail-key', failingCompute)).rejects.toThrow(
      'Transient failure'
    );

    // Subsequent request should not return error from cache, but retry
    const res = await cache.getOrCompute('fail-key', failingCompute);
    expect(res.svg).toBe('<svg>recovered</svg>');
    expect(attempt).toBe(2);
  });
});
