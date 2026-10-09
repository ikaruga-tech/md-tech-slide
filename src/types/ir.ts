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

export interface DiagramViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export type DiagramErrorCode =
  | 'mermaid-empty-source'
  | 'mermaid-invalid-syntax'
  | 'mermaid-render-timeout'
  | 'mermaid-queue-full'
  | 'mermaid-output-unsafe'
  | 'mermaid-cancelled'
  | 'mermaid-service-disposed'
  | 'mermaid-render-failed'
  | 'mermaid-browser-not-found'
  | 'mermaid-invalid-browser-path'
  | 'mermaid-invalid-svg';

export interface DiagramBlock {
  readonly type: 'diagram';
  readonly kind: 'mermaid';
  readonly source: string;
  readonly startLine: number; // 0-indexed, document-level line
  readonly configId: string;
  readonly hash: string; // SHA-256
  readonly status: 'pending' | 'success' | 'error';
  readonly svg?: string; // Sanitized SVG string
  readonly viewBox?: DiagramViewBox;
  readonly width?: number;
  readonly height?: number;
  readonly aspectRatio?: number;
  readonly errorCode?: DiagramErrorCode;
  readonly errorMessage?: string;
}

export type BlockElement =
  HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | ImageBlock | TableBlock | DiagramBlock;

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

export type ResolvedDiagramBlock =
  | (DiagramBlock & {
      readonly status: 'success';
      readonly svg: string;
      readonly viewBox: DiagramViewBox;
    })
  | (DiagramBlock & {
      readonly status: 'error';
      readonly errorCode: DiagramErrorCode;
      readonly errorMessage: string;
    });

declare const resolvedDeckBrand: unique symbol;

export type ResolvedBlockElement = Exclude<BlockElement, DiagramBlock> | ResolvedDiagramBlock;

export interface ResolvedColumn extends Omit<Column, 'elements'> {
  readonly elements: readonly ResolvedBlockElement[];
}

export type ResolvedBodySlot =
  | {
      readonly type: 'single';
      readonly elements: readonly ResolvedBlockElement[];
    }
  | {
      readonly type: 'columns';
      readonly ratio?: string;
      readonly columns: readonly ResolvedColumn[];
    };

export interface ResolvedSlide extends Omit<Slide, 'slots'> {
  readonly slots: Omit<SlideSlots, 'body'> & {
    readonly body: ResolvedBodySlot;
  };
}

export interface ResolvedSlideDeck extends Omit<SlideDeck, 'slides'> {
  readonly slides: readonly ResolvedSlide[];
  readonly [resolvedDeckBrand]: true;
}

function assertValidResolvedDiagram(diagram: DiagramBlock, locationMsg: string): void {
  if (diagram.status === 'pending') {
    throw new Error(`${locationMsg} contains an unresolved pending diagram.`);
  }

  if (diagram.status === 'success') {
    if (!diagram.svg || typeof diagram.svg !== 'string' || diagram.svg.trim().length === 0) {
      throw new Error(`${locationMsg} has status 'success' but is missing valid non-empty svg.`);
    }
    const vb = diagram.viewBox;
    if (
      !vb ||
      typeof vb.minX !== 'number' ||
      !Number.isFinite(vb.minX) ||
      typeof vb.minY !== 'number' ||
      !Number.isFinite(vb.minY) ||
      typeof vb.width !== 'number' ||
      !Number.isFinite(vb.width) ||
      vb.width <= 0 ||
      typeof vb.height !== 'number' ||
      !Number.isFinite(vb.height) ||
      vb.height <= 0
    ) {
      throw new Error(`${locationMsg} has status 'success' but has invalid non-positive viewBox.`);
    }
  } else if (diagram.status === 'error') {
    if (
      !diagram.errorCode ||
      typeof diagram.errorCode !== 'string' ||
      diagram.errorCode.trim().length === 0
    ) {
      throw new Error(`${locationMsg} has status 'error' but is missing non-empty errorCode.`);
    }
    if (typeof diagram.errorMessage !== 'string') {
      throw new Error(`${locationMsg} has status 'error' but is missing errorMessage string.`);
    }
  } else {
    throw new Error(
      `${locationMsg} has unknown diagram status: ${(diagram as { status?: unknown }).status}`
    );
  }
}

export function assertResolvedDeck(deck: SlideDeck): asserts deck is ResolvedSlideDeck {
  for (let sIdx = 0; sIdx < deck.slides.length; sIdx++) {
    const slide = deck.slides[sIdx];
    if (!slide) continue;
    const body = slide.slots.body;
    if (body.type === 'single') {
      for (let eIdx = 0; eIdx < body.elements.length; eIdx++) {
        const el = body.elements[eIdx];
        if (el?.type === 'diagram') {
          assertValidResolvedDiagram(el, `Slide ${sIdx + 1}, element ${eIdx + 1}`);
        }
      }
    } else if (body.type === 'columns') {
      for (let cIdx = 0; cIdx < body.columns.length; cIdx++) {
        const col = body.columns[cIdx];
        if (!col) continue;
        for (let eIdx = 0; eIdx < col.elements.length; eIdx++) {
          const el = col.elements[eIdx];
          if (el?.type === 'diagram') {
            assertValidResolvedDiagram(
              el,
              `Slide ${sIdx + 1}, column ${cIdx + 1}, element ${eIdx + 1}`
            );
          }
        }
      }
    }
  }
}
