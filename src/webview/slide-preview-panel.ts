import * as vscode from 'vscode';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parseMarkdownToSlideDeck } from '../parser/index.js';
import { renderDeckToHtml } from '../renderer/index.js';
import { findSlideIndexByLine, findSlideStartLine } from '../parser/slide-locator.js';
import { getAllowedResourceRoots } from '../resource/index.js';
import type { SlideDeck } from '../types/ir.js';

export class SlidePreviewPanel {
  public static currentPanel: SlidePreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private activeEditor: vscode.TextEditor | undefined;
  private lastScrollIndex = -1;
  private currentDeck: SlideDeck | undefined;

  public get activeDocument(): vscode.TextDocument | undefined {
    return this.activeEditor?.document;
  }

  private constructor(panel: vscode.WebviewPanel, editor: vscode.TextEditor) {
    this.panel = panel;
    this.activeEditor = editor;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // プレビュー側からのメッセージ受信（スライド選択 / 外部リンク委譲）
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
        }
      },
      null,
      this.disposables
    );

    this.updateContent();
  }

  public static createOrShow(
    editor: vscode.TextEditor,
    extensionUri?: vscode.Uri
  ): SlidePreviewPanel {
    const column = vscode.ViewColumn.Beside;

    if (SlidePreviewPanel.currentPanel) {
      SlidePreviewPanel.currentPanel.activeEditor = editor;
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

    SlidePreviewPanel.currentPanel = new SlidePreviewPanel(panel, editor);
    return SlidePreviewPanel.currentPanel;
  }

  public updateContent(editor?: vscode.TextEditor): void {
    if (editor) {
      this.activeEditor = editor;
    }

    if (!this.activeEditor || this.activeEditor.document.languageId !== 'markdown') {
      return;
    }

    const markdown = this.activeEditor.document.getText();
    const deck = parseMarkdownToSlideDeck(markdown);
    this.currentDeck = deck;

    const nonce = crypto.randomBytes(16).toString('base64');

    const clientScript = `
      const vscode = acquireVsCodeApi();

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
    SlidePreviewPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
