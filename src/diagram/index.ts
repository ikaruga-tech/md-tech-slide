import type {
  SlideDeck,
  ResolvedSlideDeck,
  ResolvedSlide,
  ResolvedBodySlot,
  ResolvedColumn,
  ResolvedBlockElement,
  ResolvedDiagramBlock,
  BlockElement,
  DiagramBlock,
} from '../types/ir.js';
import { assertResolvedDeck } from '../types/ir.js';
import { DiagramRenderService, DiagramRenderError } from './mermaid-render-service.js';
import { getSafeDiagramErrorMessage } from './safe-error-message.js';

export {
  DiagramRenderService,
  DiagramRenderError,
  type DiagramErrorCode,
  type RenderDiagramRequest,
  type DiagramRenderServiceOptions,
} from './mermaid-render-service.js';
export { getSafeDiagramErrorMessage } from './safe-error-message.js';
export { sanitizeSvg, SanitizeSvgError, type SanitizedSvgResult } from './svg-sanitizer.js';
export { DiagramCache } from './diagram-cache.js';

/**
 * Checks whether the SlideDeck contains any pending diagram blocks that require rendering.
 */
export function hasPendingDiagrams(deck: SlideDeck): boolean {
  for (const slide of deck.slides) {
    if (slide.slots.body.type === 'single') {
      for (const el of slide.slots.body.elements) {
        if (el.type === 'diagram' && el.status === 'pending') {
          return true;
        }
      }
    } else if (slide.slots.body.type === 'columns') {
      for (const col of slide.slots.body.columns) {
        for (const el of col.elements) {
          if (el.type === 'diagram' && el.status === 'pending') {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Resolves all pending diagram blocks in a SlideDeck into ResolvedDiagramBlocks,
 * returning a strongly typed ResolvedSlideDeck.
 */
export async function resolveDeckDiagrams(
  deck: SlideDeck,
  service?: DiagramRenderService,
  options?: { ownerId?: string }
): Promise<ResolvedSlideDeck> {
  const needsResolution = hasPendingDiagrams(deck);

  if (!needsResolution) {
    // Fast path: deck has no pending diagrams, assert and return immediately
    assertResolvedDeck(deck);
    return deck;
  }

  if (!service) {
    throw new TypeError('DiagramRenderService is required to resolve pending diagrams.');
  }

  const ownerId = options?.ownerId ?? 'resolve-deck-diagrams';
  const theme = (deck.metadata.theme?.toLowerCase().includes('dark') ? 'dark' : 'light') as
    'light' | 'dark';

  // 1. 全 pending 図形要素の位置とレンダリングタスクを収集
  interface PendingTask {
    readonly el: BlockElement;
    readonly slideIdx: number;
    readonly slotType: 'single' | 'columns';
    readonly colIdx?: number;
    readonly elIdx: number;
  }

  const tasks: PendingTask[] = [];

  for (let sIdx = 0; sIdx < deck.slides.length; sIdx++) {
    const slide = deck.slides[sIdx]!;
    if (slide.slots.body.type === 'single') {
      for (let eIdx = 0; eIdx < slide.slots.body.elements.length; eIdx++) {
        const el = slide.slots.body.elements[eIdx]!;
        if (el.type === 'diagram' && el.status === 'pending') {
          tasks.push({ el, slideIdx: sIdx, slotType: 'single', elIdx: eIdx });
        }
      }
    } else {
      for (let cIdx = 0; cIdx < slide.slots.body.columns.length; cIdx++) {
        const col = slide.slots.body.columns[cIdx]!;
        for (let eIdx = 0; eIdx < col.elements.length; eIdx++) {
          const el = col.elements[eIdx]!;
          if (el.type === 'diagram' && el.status === 'pending') {
            tasks.push({ el, slideIdx: sIdx, slotType: 'columns', colIdx: cIdx, elIdx: eIdx });
          }
        }
      }
    }
  }

  // 2. 有界並列（最大2並列）で実行し、各タスクの解決済みブロックを収集
  const CONCURRENCY = 2;
  const taskResults = new Map<PendingTask, ResolvedDiagramBlock>();
  const renderService = service;

  let currentIndex = 0;
  async function worker(): Promise<void> {
    while (currentIndex < tasks.length) {
      const taskIndex = currentIndex++;
      const task = tasks[taskIndex]!;
      const el = task.el;

      try {
        const rendered = await renderService.renderDiagram({
          source: el.type === 'diagram' ? el.source : '',
          ownerId,
          theme,
          configId: el.type === 'diagram' ? el.configId : undefined,
        });

        const diagramEl = el as DiagramBlock;
        taskResults.set(task, {
          ...diagramEl,
          status: 'success',
          svg: rendered.svg,
          viewBox: rendered.viewBox,
          width: rendered.width,
          height: rendered.height,
          aspectRatio: rendered.aspectRatio,
        });
      } catch (err: unknown) {
        const errorCode =
          err instanceof DiagramRenderError ? err.code : ('mermaid-render-failed' as const);
        const errorMessage = getSafeDiagramErrorMessage(errorCode);

        const diagramEl = el as DiagramBlock;
        taskResults.set(task, {
          ...diagramEl,
          status: 'error',
          errorCode,
          errorMessage,
        });
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, tasks.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // 3. 元の入力構造と順序を厳格に維持してデッキを再構築
  let taskLookupIdx = 0;
  const resolvedSlides: ResolvedSlide[] = [];

  for (let sIdx = 0; sIdx < deck.slides.length; sIdx++) {
    const slide = deck.slides[sIdx]!;
    let resolvedBody: ResolvedBodySlot;

    if (slide.slots.body.type === 'single') {
      const resolvedElements: ResolvedBlockElement[] = [];
      for (let eIdx = 0; eIdx < slide.slots.body.elements.length; eIdx++) {
        const el = slide.slots.body.elements[eIdx]!;
        if (el.type === 'diagram' && el.status === 'pending') {
          const task = tasks[taskLookupIdx++];
          resolvedElements.push(taskResults.get(task!)!);
        } else {
          resolvedElements.push(el as ResolvedBlockElement);
        }
      }
      resolvedBody = {
        type: 'single',
        elements: resolvedElements,
      };
    } else {
      const resolvedColumns: ResolvedColumn[] = [];
      for (let cIdx = 0; cIdx < slide.slots.body.columns.length; cIdx++) {
        const col = slide.slots.body.columns[cIdx]!;
        const resolvedColElements: ResolvedBlockElement[] = [];
        for (let eIdx = 0; eIdx < col.elements.length; eIdx++) {
          const el = col.elements[eIdx]!;
          if (el.type === 'diagram' && el.status === 'pending') {
            const task = tasks[taskLookupIdx++];
            resolvedColElements.push(taskResults.get(task!)!);
          } else {
            resolvedColElements.push(el as ResolvedBlockElement);
          }
        }
        resolvedColumns.push({
          id: col.id,
          ratio: col.ratio,
          elements: resolvedColElements,
        });
      }
      resolvedBody = {
        type: 'columns',
        ratio: slide.slots.body.ratio,
        columns: resolvedColumns,
      };
    }

    resolvedSlides.push({
      ...slide,
      slots: {
        ...slide.slots,
        body: resolvedBody,
      },
    });
  }

  const resolvedDeck = {
    ...deck,
    slides: resolvedSlides,
  };

  assertResolvedDeck(resolvedDeck);
  return resolvedDeck;
}

/**
 * Asserts that all diagram blocks in the deck resolved successfully.
 * If any diagram has status 'error', throws a DiagramRenderError with safe code and message.
 */
export function assertDeckDiagramsSuccessful(deck: SlideDeck): void {
  for (const slide of deck.slides) {
    const elements: BlockElement[] =
      slide.slots.body.type === 'single'
        ? [...slide.slots.body.elements]
        : slide.slots.body.columns.flatMap((c) => c.elements);

    for (const el of elements) {
      if (el.type === 'diagram') {
        if (el.status === 'error') {
          const code = el.errorCode ?? 'mermaid-render-failed';
          throw new DiagramRenderError(code, el.errorMessage ?? getSafeDiagramErrorMessage(code));
        }
      }
    }
  }
}
