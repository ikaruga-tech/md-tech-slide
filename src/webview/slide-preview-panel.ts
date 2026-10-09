import * as vscode from 'vscode';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parseMarkdownToSlideDeck } from '../parser/index.js';
import { renderDeckToHtml } from '../renderer/index.js';
import { findSlideIndexByLine, findSlideStartLine } from '../parser/slide-locator.js';
import { getAllowedResourceRoots } from '../resource/index.js';
import type { SlideDeck } from '../types/ir.js';
import {
  resolveDeckDiagrams,
  hasPendingDiagrams,
  type DiagramRenderService,
} from '../diagram/index.js';

export class SlidePreviewPanel {
  public static currentPanel: SlidePreviewPanel | undefined;
  public static testObserver?: (message: Record<string, unknown>) => void;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private activeEditor: vscode.TextEditor | undefined;
  private lastScrollIndex = -1;
  private currentDeck: SlideDeck | undefined;
  private diagramService?: DiagramRenderService;
  private readonly panelId: string = crypto.randomUUID();
  private renderGeneration = 0;
  private isDisposed = false;

  public get activeDocument(): vscode.TextDocument | undefined {
    return this.activeEditor?.document;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    editor: vscode.TextEditor,
    diagramService?: DiagramRenderService
  ) {
    this.panel = panel;
    this.activeEditor = editor;
    this.diagramService = diagramService;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // プレビュー側からのメッセージ受信（スライド選択 / 外部リンク委譲 / 観測イベント）
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (!message || typeof message !== 'object') {
          return;
        }
        const msg = message as Record<string, unknown>;

        if (msg.command === 'selectSlide' && typeof msg.index === 'number' && this.activeEditor) {
          const doc = this.activeEditor.document;
          const maxSlides = this.currentDeck?.slides.length ?? Infinity;
          if (msg.index >= 0 && msg.index < maxSlides) {
            const targetLine = findSlideStartLine(doc.getText(), msg.index);
            const pos = new vscode.Position(targetLine, 0);
            this.activeEditor.selection = new vscode.Selection(pos, pos);
            this.activeEditor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter
            );
          }
        } else if (msg.command === 'openExternal' && typeof msg.url === 'string') {
          const trimmedUrl = msg.url.trim();
          if (/^(https?:|mailto:)/i.test(trimmedUrl)) {
            vscode.env.openExternal(vscode.Uri.parse(trimmedUrl));
          }
        } else if (
          msg.command === 'securityPolicyViolation' ||
          msg.command === 'diagramObservation' ||
          msg.command === 'webviewReady'
        ) {
          SlidePreviewPanel.testObserver?.(msg);
        }
      },
      null,
      this.disposables
    );

    this.updateContent();
  }

  public static createOrShow(
    editor: vscode.TextEditor,
    extensionUri?: vscode.Uri,
    diagramService?: DiagramRenderService
  ): SlidePreviewPanel {
    const column = vscode.ViewColumn.Beside;

    if (SlidePreviewPanel.currentPanel) {
      SlidePreviewPanel.currentPanel.activeEditor = editor;
      if (diagramService) {
        SlidePreviewPanel.currentPanel.diagramService = diagramService;
      }
      SlidePreviewPanel.currentPanel.panel.reveal(column);
      SlidePreviewPanel.currentPanel.updateContent();
      return SlidePreviewPanel.currentPanel;
    }

    const docUri = editor.document.uri;
    const sourceMarkdownPath = docUri.scheme === 'file' ? docUri.fsPath : undefined;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
    const allowedRoots = getAllowedResourceRoots(sourceMarkdownPath, workspaceFolders);

    const localResourceRoots: vscode.Uri[] = allowedRoots.map((r) => vscode.Uri.file(r));
    if (extensionUri) {
      localResourceRoots.push(extensionUri);
    }

    const panel = vscode.window.createWebviewPanel('mdTechSlidePreview', 'Slide Preview', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots,
    });

    SlidePreviewPanel.currentPanel = new SlidePreviewPanel(panel, editor, diagramService);
    return SlidePreviewPanel.currentPanel;
  }

  public updateContent(editor?: vscode.TextEditor): void {
    if (editor) {
      this.activeEditor = editor;
    }

    if (!this.activeEditor || this.activeEditor.document.languageId !== 'markdown') {
      return;
    }

    const currentGeneration = ++this.renderGeneration;
    const markdown = this.activeEditor.document.getText();
    const deck = parseMarkdownToSlideDeck(markdown);
    this.currentDeck = deck;

    // Initial render (shows pending state or instant if no diagrams)
    this.renderAndApplyHtml(deck);

    if (hasPendingDiagrams(deck) && this.diagramService) {
      const ownerId = `preview:${this.panelId}`;
      this.diagramService.cancelByOwner(ownerId);
      void resolveDeckDiagrams(deck, this.diagramService, { ownerId })
        .then((resolvedDeck) => {
          if (this.renderGeneration === currentGeneration && !this.isDisposed) {
            this.currentDeck = resolvedDeck;
            this.renderAndApplyHtml(resolvedDeck);
          }
        })
        .catch(() => {
          // Handled within resolveDeckDiagrams error blocks
        });
    }
  }

  private renderAndApplyHtml(deck: SlideDeck): void {
    if (!this.activeEditor || this.isDisposed) {
      return;
    }

    const nonce = crypto.randomBytes(16).toString('base64');

    const currentGeneration = this.renderGeneration;

    const clientScript = `
      const vscode = acquireVsCodeApi();
      const currentGen = ${currentGeneration};

      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href) {
          e.preventDefault();
          vscode.postMessage({ command: 'openExternal', url: link.href });
          return;
        }

        const container = e.target.closest('.slide-container');
        if (container) {
          const idx = parseInt(container.getAttribute('data-slide-index'), 10);
          if (!isNaN(idx)) {
            vscode.postMessage({ command: 'selectSlide', index: idx });
          }
        }
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'scrollToSlide' && typeof msg.index === 'number') {
          const container = document.querySelector('[data-slide-index="' + msg.index + '"]');
          if (container) {
            document.querySelectorAll('.slide-card').forEach(el => el.classList.remove('active'));
            const card = container.querySelector('.slide-card');
            if (card) {
              card.classList.add('active');
            }
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });

      document.addEventListener('securitypolicyviolation', (e) => {
        vscode.postMessage({
          command: 'securityPolicyViolation',
          generation: currentGen,
          blockedURI: e.blockedURI,
          violatedDirective: e.violatedDirective,
        });
      });

      vscode.postMessage({ command: 'webviewReady', generation: currentGen });

      setTimeout(() => {
        const svgs = document.querySelectorAll('.slide-diagram svg');
        const errorCards = document.querySelectorAll('.slide-diagram-error');
        const errorCodes = Array.from(errorCards).map(el => el.getAttribute('data-error-code') || '');
        vscode.postMessage({
          command: 'diagramObservation',
          generation: currentGen,
          svgCount: svgs.length,
          errorCardCount: errorCards.length,
          errorCodes,
        });
      }, 50);
    `.trim();

    const docUri = this.activeEditor.document.uri;
    const sourceMarkdownPath = docUri.scheme === 'file' ? docUri.fsPath : undefined;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
    const allowedRoots = getAllowedResourceRoots(sourceMarkdownPath, workspaceFolders);
    const baseDir = sourceMarkdownPath ? path.dirname(sourceMarkdownPath) : undefined;

    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: allowedRoots.map((r) => vscode.Uri.file(r)),
    };

    const html = renderDeckToHtml(deck, {
      scriptContent: clientScript,
      baseDir,
      allowedRoots,
      nonce,
      cspSource: this.panel.webview.cspSource,
    });
    this.panel.webview.html = html;

    // 現在のカーソル位置に対応するスライドへスクロール同期
    this.syncScrollFromEditor();
  }

  public syncScrollFromEditor(): void {
    if (!this.activeEditor) {
      return;
    }

    const line = this.activeEditor.selection.active.line;
    const slideIndex = findSlideIndexByLine(this.activeEditor.document.getText(), line);

    if (slideIndex !== this.lastScrollIndex) {
      this.lastScrollIndex = slideIndex;
      this.panel.webview.postMessage({
        type: 'scrollToSlide',
        index: slideIndex,
      });
    }
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    SlidePreviewPanel.currentPanel = undefined;
    this.diagramService?.cancelByOwner(`preview:${this.panelId}`);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
