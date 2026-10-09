import type { DiagramViewBox } from '../types/ir.js';

export interface TargetRect {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
}

export interface ContainPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/**
 * Calculates aspect-ratio preserving contain placement within a target bounding box,
 * centering the fitted content horizontally and vertically.
 */
export function calculateSvgContain(
  viewBox: DiagramViewBox,
  targetRect: TargetRect
): ContainPlacement {
  const targetX = targetRect.x ?? 0;
  const targetY = targetRect.y ?? 0;
  const targetW = targetRect.width;
  const targetH = targetRect.height;

  if (targetW <= 0 || targetH <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
    return {
      x: targetX,
      y: targetY,
      width: Math.max(0, targetW),
      height: Math.max(0, targetH),
      scale: 0,
    };
  }

  const scaleX = targetW / viewBox.width;
  const scaleY = targetH / viewBox.height;
  const scale = Math.min(scaleX, scaleY);

  const fittedWidth = viewBox.width * scale;
  const fittedHeight = viewBox.height * scale;

  const offsetX = (targetW - fittedWidth) / 2;
  const offsetY = (targetH - fittedHeight) / 2;

  return {
    x: targetX + offsetX,
    y: targetY + offsetY,
    width: fittedWidth,
    height: fittedHeight,
    scale,
  };
}
