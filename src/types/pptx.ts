export interface PptxTableCellOptions {
  readonly bold?: boolean;
  readonly color?: string;
  readonly fill?: { readonly color?: string };
  readonly fontFace?: string;
  readonly fontSize?: number;
  readonly [key: string]: unknown;
}

export interface PptxTableCell {
  readonly text: string;
  readonly options?: PptxTableCellOptions;
}

export type PptxTableRow = readonly PptxTableCell[];

export interface PptxSlide {
  background: { color?: string; path?: string; data?: string };
  addText(text: string | readonly unknown[], options?: Record<string, unknown>): PptxSlide;
  addShape(shapeName: string, options?: Record<string, unknown>): PptxSlide;
  addImage(options: Record<string, unknown>): PptxSlide;
  addTable(
    tableRows: readonly (readonly PptxTableCell[])[],
    options?: Record<string, unknown>
  ): PptxSlide;
  addNotes(noteText: string): PptxSlide;
}

export interface PptxInstance {
  layout: string;
  title?: string;
  author?: string;
  addSlide(): PptxSlide;
  writeFile(props?: { fileName?: string }): Promise<string>;
}
