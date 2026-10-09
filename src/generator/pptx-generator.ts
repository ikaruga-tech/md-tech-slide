import PptxGenJSModule from 'pptxgenjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SlideDeck, ResolvedSlideDeck } from '../types/ir.js';
import type { PptxInstance } from '../types/pptx.js';
import { resolveTheme, getDeckTypography } from '../theme/index.js';
import { getSlideGrid } from '../layout/grid.js';
import { renderSlide } from './slide-renderer.js';
import type { RenderOptions } from './element-renderer.js';
import {
  resolveDeckDiagrams,
  hasPendingDiagrams,
  assertDeckDiagramsSuccessful,
  type DiagramRenderService,
} from '../diagram/index.js';

// NodeNext / CommonJS の相互運用のためコンストラクタを取得
const PptxGenJSConstructor = (typeof PptxGenJSModule === 'function'
  ? PptxGenJSModule
  : (PptxGenJSModule as unknown as { default: new () => PptxInstance })
      .default) as unknown as new () => PptxInstance;

export interface PptxExportOptions extends RenderOptions {
  readonly diagramService?: DiagramRenderService;
  readonly browserPath?: string;
  readonly ownerId?: string;
}

export async function generatePresentation(
  deck: SlideDeck,
  options?: PptxExportOptions
): Promise<PptxInstance> {
  let resolvedDeck = deck;
  if (hasPendingDiagrams(deck)) {
    const ownerId =
      options?.ownerId ?? `export:pptx:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    if (options?.diagramService) {
      resolvedDeck = await resolveDeckDiagrams(deck, options.diagramService, {
        ownerId,
      });
    } else {
      const { createDiagramRenderService } = await import('../diagram/internal-diagnostics.js');
      const tempService = createDiagramRenderService({ browserPath: options?.browserPath });
      try {
        resolvedDeck = await resolveDeckDiagrams(deck, tempService, {
          ownerId,
        });
      } finally {
        await tempService.dispose();
      }
    }

    assertDeckDiagramsSuccessful(resolvedDeck);
  }

  return generateResolvedPresentation(resolvedDeck as ResolvedSlideDeck, options);
}

export async function generateResolvedPresentation(
  deck: ResolvedSlideDeck,
  options?: RenderOptions
): Promise<PptxInstance> {
  const pptx = new PptxGenJSConstructor();

  const is4x3 = deck.metadata.aspectRatio === '4:3';
  pptx.layout = is4x3 ? 'LAYOUT_4x3' : 'LAYOUT_WIDE';

  if (deck.metadata.title) {
    pptx.title = String(deck.metadata.title);
  }
  if (deck.metadata.author) {
    pptx.author = String(deck.metadata.author);
  }

  const theme = resolveTheme(deck.metadata.theme ? String(deck.metadata.theme) : undefined);
  const typography = getDeckTypography(deck);
  const grid = getSlideGrid(is4x3 ? '4:3' : '16:9');

  const defaultPaginate = deck.metadata.paginate !== false;

  for (const slideData of deck.slides) {
    const slide = pptx.addSlide();
    await renderSlide(
      slide,
      slideData,
      grid,
      theme,
      deck.slides.length,
      options,
      defaultPaginate,
      typography
    );
  }

  return pptx;
}

export async function generatePresentationWithDiagnostics(
  deck: SlideDeck,
  options?: PptxExportOptions
): Promise<{
  pptx: PptxInstance;
  diagnostics: import('../layout/index.js').LayoutDiagnosticIssue[];
}> {
  let resolvedDeck = deck;
  if (hasPendingDiagrams(deck)) {
    if (options?.diagramService) {
      resolvedDeck = await resolveDeckDiagrams(deck, options.diagramService, {
        ownerId: 'export:pptx',
      });
    } else {
      const { createDiagramRenderService } = await import('../diagram/internal-diagnostics.js');
      const tempService = createDiagramRenderService({ browserPath: options?.browserPath });
      try {
        resolvedDeck = await resolveDeckDiagrams(deck, tempService, {
          ownerId: 'export:pptx',
        });
      } finally {
        await tempService.dispose();
      }
    }
  }

  const { analyzeLayoutOverflow } = await import('../layout/index.js');
  const diagnostics = analyzeLayoutOverflow(resolvedDeck);
  const pptx = await generateResolvedPresentation(resolvedDeck as ResolvedSlideDeck, options);
  return { pptx, diagnostics };
}

export async function savePresentationToFile(
  deck: SlideDeck,
  outputPath: string,
  options?: PptxExportOptions
): Promise<void> {
  const pptx = await generatePresentation(deck, options);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await pptx.writeFile({ fileName: outputPath });
}
