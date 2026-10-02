import type { Rect, ColumnRect } from './types.js';
import { parseColumnRatio } from './ratio.js';

export function calculateColumnRects(
  bodyRect: Rect,
  columnCount: number,
  ratioStr?: string,
  gap = 0.5
): readonly ColumnRect[] {
  if (columnCount <= 0) {
    throw new Error(`Invalid column count: ${columnCount}. Must be greater than 0.`);
  }

  if (columnCount === 1) {
    return [
      {
        index: 0,
        id: 'col-1',
        x: bodyRect.x,
        y: bodyRect.y,
        w: bodyRect.w,
        h: bodyRect.h,
      },
    ];
  }

  const totalGap = gap * (columnCount - 1);
  const availableWidth = bodyRect.w - totalGap;
  if (availableWidth <= 0) {
    throw new Error(
      `Insufficient body width (${bodyRect.w}) for ${columnCount} columns with gap ${gap}.`
    );
  }

  let weights: number[];

  if (ratioStr && ratioStr.trim().length > 0) {
    const parsed = parseColumnRatio(ratioStr, columnCount);
    if (!parsed.valid || !parsed.weights) {
      throw new Error(parsed.error || `Invalid ratio "${ratioStr}" for ${columnCount} columns.`);
    }
    weights = [...parsed.weights];
  } else {
    weights = Array.from({ length: columnCount }, () => 1);
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const columnRects: ColumnRect[] = [];
  let currentX = bodyRect.x;

  for (let i = 0; i < columnCount; i++) {
    const weight = weights[i] ?? 1;
    const width = Number(((availableWidth * weight) / totalWeight).toFixed(3));
    columnRects.push({
      index: i,
      id: `col-${i + 1}`,
      x: Number(currentX.toFixed(3)),
      y: bodyRect.y,
      w: width,
      h: bodyRect.h,
    });
    currentX += width + gap;
  }

  return columnRects;
}
