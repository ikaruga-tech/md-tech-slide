export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SlideGrid {
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly header: Rect;
  readonly body: Rect;
  readonly footer: Rect;
}

export interface ColumnRect extends Rect {
  readonly index: number;
  readonly id: string;
}
