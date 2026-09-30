import type { SlideGrid } from './types.js';

export function getSlideGrid(aspectRatio: '16:9' | '4:3' = '16:9'): SlideGrid {
  if (aspectRatio === '4:3') {
    return {
      slideWidth: 10.0,
      slideHeight: 7.5,
      header: { x: 0.8, y: 0.6, w: 8.4, h: 1.0 },
      body: { x: 0.8, y: 1.8, w: 8.4, h: 4.8 },
      footer: { x: 0.8, y: 6.8, w: 8.4, h: 0.4 },
    };
  }

  // 16:9 (デフォルト)
  return {
    slideWidth: 13.33,
    slideHeight: 7.5,
    header: { x: 1.0, y: 0.8, w: 11.33, h: 1.0 },
    body: { x: 1.0, y: 2.0, w: 11.33, h: 4.8 },
    footer: { x: 1.0, y: 7.0, w: 11.33, h: 0.3 },
  };
}
