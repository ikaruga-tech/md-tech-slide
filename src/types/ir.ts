export interface TextSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  readonly link?: string;
}

export interface HeadingBlock {
  readonly type: 'heading';
  readonly level: number;
  readonly text: string;
  readonly spans: readonly TextSpan[];
}

export interface ParagraphBlock {
  readonly type: 'paragraph';
  readonly spans: readonly TextSpan[];
}

export interface ListItem {
  readonly spans: readonly TextSpan[];
  readonly children?: readonly ListItem[];
}

export interface ListBlock {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly items: readonly ListItem[];
}

export interface CodeBlock {
  readonly type: 'code';
  readonly code: string;
  readonly language?: string;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly alt: string;
  readonly src: string;
}

export interface TableBlock {
  readonly type: 'table';
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export type BlockElement =
  HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | ImageBlock | TableBlock;

export interface Column {
  readonly id: string;
  readonly ratio?: number;
  readonly elements: readonly BlockElement[];
}

export interface SingleSlot {
  readonly type: 'single';
  readonly elements: readonly BlockElement[];
}

export interface ColumnsSlot {
  readonly type: 'columns';
  readonly ratio?: string;
  readonly columns: readonly Column[];
}

export type BodySlot = SingleSlot | ColumnsSlot;

export interface HeaderSlot {
  readonly title: string;
  readonly subtitle?: string;
}

export interface FooterSlot {
  readonly text?: string;
  readonly pageNumber?: boolean;
}

export interface SlideSlots {
  readonly header?: HeaderSlot;
  readonly body: BodySlot;
  readonly footer?: FooterSlot;
}

export type SlideType = 'title' | 'content';

export interface Slide {
  readonly index: number;
  readonly type: SlideType;
  readonly slots: SlideSlots;
  readonly note?: string;
}

export interface SlideDeckMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly theme?: string;
  readonly aspectRatio?: '16:9' | '4:3';
  readonly [key: string]: unknown;
}

export interface TypographyFonts {
  readonly body: string;
  readonly heading: string;
  readonly code: string;
}

export interface TypographySizes {
  readonly body?: number;
  readonly heading?: number;
  readonly legacyBase?: number;
}

export interface TypographySettings {
  readonly fonts: TypographyFonts;
  readonly sizes: TypographySizes;
}

export interface PptxRoleSizes {
  readonly titleSlideTitle: number;
  readonly slideTitle: number;
  readonly bodyHeadingLevel3: number;
  readonly bodyHeadingOther: number;
  readonly body: number;
  readonly list: number;
  readonly tableHeader: number;
  readonly tableBody: number;
  readonly code: number;
  readonly footer: number;
}

export interface PreviewRoleSizes {
  readonly titleSlideTitle: number;
  readonly slideTitle: number;
  readonly bodyHeading: number;
  readonly body: number;
  readonly list: number;
  readonly table: number;
  readonly code: number;
  readonly footer: number;
  readonly unit: 'px' | 'pt';
}

export interface SlideDeck {
  readonly metadata: SlideDeckMetadata;
  readonly slides: readonly Slide[];
  readonly typography?: TypographySettings;
}
