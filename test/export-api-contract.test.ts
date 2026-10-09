import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  Diagnostic: class {
    code?: string;
    source?: string;
    constructor(
      public range: unknown,
      public message: string,
      public severity: unknown
    ) {}
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Range: class {
    constructor(
      public start: unknown,
      public end: unknown
    ) {}
  },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  languages: {
    createDiagnosticCollection: () => ({
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  workspace: {
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    textDocuments: [],
  },
}));

import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { generatePresentation } from '../src/generator/pptx-generator.js';
import { exportDeckToPdf } from '../src/export/pdf-exporter.js';
import {
  DiagramRenderService,
  DiagramRenderError,
  resolveDeckDiagrams,
  getSafeDiagramErrorMessage,
} from '../src/diagram/index.js';
import { renderDeckToHtml } from '../src/renderer/index.js';
import { SlideDiagnosticProvider } from '../src/diagnostics/index.js';
import type { ResolvedDiagramBlock } from '../src/types/ir.js';

describe('Public API Service Ownership & Lifecycle Contracts', () => {
  const diagramMarkdown = `---
title: "Diagram Slide"
---

# Slide 1

\`\`\`mermaid
flowchart TD
  A[Node A] --> B[Node B]
\`\`\`
`;

  const plainMarkdown = `---
title: "Plain Slide"
---

# Slide 1

Just normal text without any diagrams.
`;

  it('PPTX: does NOT dispose externally injected DiagramRenderService', async () => {
    const deck = parseMarkdownToSlideDeck(diagramMarkdown);
    const mockService = {
      renderDiagram: vi.fn().mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>',
        viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
        width: 100,
        height: 100,
        aspectRatio: 1,
      }),
      cancelByOwner: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as DiagramRenderService;

    const pptx = await generatePresentation(deck, { diagramService: mockService });
    expect(pptx).toBeDefined();
    expect(mockService.renderDiagram).toHaveBeenCalledTimes(1);
    expect(mockService.dispose).not.toHaveBeenCalled();
  });

  it('PPTX: disposes temporary service in finally block if rendering fails', async () => {
    const deck = parseMarkdownToSlideDeck(diagramMarkdown);
    const brokenDeck = {
      ...deck,
      slides: deck.slides.map((s) => ({
        ...s,
        slots: {
          ...s.slots,
          body: {
            type: 'single' as const,
            elements: [
              {
                type: 'diagram' as const,
                kind: 'mermaid' as const,
                source: 'broken syntax',
                startLine: 5,
                configId: 'default',
                hash: 'h1',
                status: 'pending' as const,
              },
            ],
          },
        },
      })),
    };

    // Spy on DiagramRenderService prototype dispose
    const disposeSpy = vi.spyOn(DiagramRenderService.prototype, 'dispose');
    const renderSpy = vi
      .spyOn(DiagramRenderService.prototype, 'renderDiagram')
      .mockRejectedValue(
        new DiagramRenderError('mermaid-render-failed', 'Simulated failure during diagram render')
      );

    await expect(generatePresentation(brokenDeck)).rejects.toThrow();
    expect(disposeSpy).toHaveBeenCalled();

    renderSpy.mockRestore();
    disposeSpy.mockRestore();
  });

  it('PPTX: does NOT instantiate or invoke diagram service when deck has no diagrams', async () => {
    const deck = parseMarkdownToSlideDeck(plainMarkdown);
    const renderSpy = vi.spyOn(DiagramRenderService.prototype, 'renderDiagram');
    const disposeSpy = vi.spyOn(DiagramRenderService.prototype, 'dispose');

    const pptx = await generatePresentation(deck);
    expect(pptx).toBeDefined();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(disposeSpy).not.toHaveBeenCalled();

    renderSpy.mockRestore();
    disposeSpy.mockRestore();
  });

  it('PDF: does NOT dispose externally injected DiagramRenderService', async () => {
    const deck = parseMarkdownToSlideDeck(diagramMarkdown);
    const mockService = {
      renderDiagram: vi.fn().mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>',
        viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
        width: 100,
        height: 100,
        aspectRatio: 1,
      }),
      cancelByOwner: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as DiagramRenderService;

    // Use dummy browser path to avoid needing actual Chrome launch for this mock test
    await expect(
      exportDeckToPdf(deck, '/tmp/nonexistent-test.pdf', {
        diagramService: mockService,
        browserPath: '/bin/echo',
      })
    ).rejects.toThrow(); // Will fail on puppeteer launch with /bin/echo, but diagram resolution happens first!

    expect(mockService.renderDiagram).toHaveBeenCalledTimes(1);
    expect(mockService.dispose).not.toHaveBeenCalled();
  });

  it('PDF: does NOT instantiate diagram service when deck has no diagrams', async () => {
    const deck = parseMarkdownToSlideDeck(plainMarkdown);
    const renderSpy = vi.spyOn(DiagramRenderService.prototype, 'renderDiagram');

    await expect(
      exportDeckToPdf(deck, '/tmp/nonexistent-test.pdf', { browserPath: '/bin/echo' })
    ).rejects.toThrow();

    expect(renderSpy).not.toHaveBeenCalled();
    renderSpy.mockRestore();
  });
});

describe('Safe Error Boundaries & Canary Leak Prevention', () => {
  const canarySecrets = [
    'CANARY_SECRET_TOKEN_999888',
    '/Users/example/private/documents/confidential.md',
    'https://internal.corp/auth?api_key=sk-1234567890abcdef',
    'at InternalMermaidEngine.compileRawCode (node:internal/eval.js:42:15)',
  ];

  it('sanitizes errors and prevents canary leakage in IR, Diagnostic, and Webview HTML', async () => {
    for (const canary of canarySecrets) {
      const maliciousSource = `flowchart TD\n  Bad[Node --> Leak] %% ${canary}`;
      const mockService = {
        renderDiagram: vi
          .fn()
          .mockRejectedValue(
            new DiagramRenderError('mermaid-invalid-syntax', `Mermaid parser crash: ${canary}`)
          ),
        cancelByOwner: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
      } as unknown as DiagramRenderService;

      const deck = parseMarkdownToSlideDeck(
        `---\ntitle: "Test"\n---\n\n# Slide\n\n\`\`\`mermaid\n${maliciousSource}\n\`\`\`\n`
      );
      const resolvedDeck = await resolveDeckDiagrams(deck, mockService);

      // 1. Verify IR error boundary
      const body = resolvedDeck.slides[0]!.slots.body;
      expect(body.type).toBe('single');
      if (body.type === 'single') {
        const diagramEl = body.elements[0] as ResolvedDiagramBlock;
        expect(diagramEl.status).toBe('error');
        expect(diagramEl.errorCode).toBe('mermaid-invalid-syntax');
        expect(diagramEl.errorMessage).toBe(getSafeDiagramErrorMessage('mermaid-invalid-syntax'));
        expect(diagramEl.errorMessage).not.toContain(canary);
      }

      // 2. Verify Webview HTML error card boundary
      const html = renderDeckToHtml(resolvedDeck);
      expect(html).toContain('slide-diagram-error');
      expect(html).toContain('mermaid-invalid-syntax');
      expect(html).not.toContain(canary);

      // 3. Verify Diagnostic provider error boundary
      const provider = new SlideDiagnosticProvider(mockService);
      const fakeDoc = {
        uri: { scheme: 'file', fsPath: '/test/path.md', toString: () => 'file:///test/path.md' },
        getText: () =>
          `---\ntitle: "Test"\n---\n\n# Slide\n\n\`\`\`mermaid\n${maliciousSource}\n\`\`\`\n`,
        positionAt: (offset: number) => ({ line: 0, character: offset }),
        languageId: 'markdown',
        version: 1,
      } as unknown as import('vscode').TextDocument;

      provider.updateDiagnostics(fakeDoc);
      // Wait for any async microtasks
      await new Promise((r) => setTimeout(r, 50));

      const setMock = (provider as unknown as { collection: { set: ReturnType<typeof vi.fn> } })
        .collection.set;
      expect(setMock).toHaveBeenCalled();
      for (const call of setMock.mock.calls) {
        const diags = call[1] as { message: string }[];
        for (const d of diags) {
          expect(d.message).not.toContain(canary);
        }
      }
    }
  });
});
