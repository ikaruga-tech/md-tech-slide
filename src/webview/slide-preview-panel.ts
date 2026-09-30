import * as vscode from 'vscode';
import * as path from 'node:path';
import { parseMarkdownToSlideDeck } from '../parser/index.js';
import { renderDeckToHtml } from '../renderer/index.js';
import { findSlideIndexByLine, findSlideStartLine } from '../parser/slide-locator.js';

export class SlidePreviewPanel {
  public static currentPanel: SlidePreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private activeEditor: vscode.TextEditor | undefined;
  private lastScrollIndex = -1;

  private constructor(panel: vscode.WebviewPanel, editor: vscode.TextEditor) {
    this.panel = panel;
    this.activeEditor = editor;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // プレビュー側からのメッセージ受信（スライド選択 ➔ エディタ移動）
    this.panel.webview.onDidReceiveMessage(
      (message: { command: string; index: number }) => {
        if (message.command === 'selectSlide' && this.activeEditor) {
          const doc = this.activeEditor.document;
          const targetLine = findSlideStartLine(doc.getText(), message.index);
          const pos = new vscode.Position(targetLine, 0);
          this.activeEditor.selection = new vscode.Selection(pos, pos);
          this.activeEditor.revealRange(
            new vscode.Range(pos, pos),
            vscode.TextEditorRevealType.InCenter
          );
        }
      },
      null,
      this.disposables
    );

    this.updateContent();
  }

  public static createOrShow(editor: vscode.TextEditor): SlidePreviewPanel {
    const column = vscode.ViewColumn.Beside;

    if (SlidePreviewPanel.currentPanel) {
      SlidePreviewPanel.currentPanel.activeEditor = editor;
      SlidePreviewPanel.currentPanel.panel.reveal(column);
      SlidePreviewPanel.currentPanel.updateContent();
      return SlidePreviewPanel.currentPanel;
    }

    const localResourceRoots: vscode.Uri[] = [];
    if (vscode.workspace.workspaceFolders) {
      localResourceRoots.push(...vscode.workspace.workspaceFolders.map((f) => f.uri));
    }
    const docUri = editor.document.uri;
    if (docUri.scheme === 'file') {
      localResourceRoots.push(vscode.Uri.file(path.dirname(docUri.fsPath)));
    }

    const panel = vscode.window.createWebviewPanel(
      'mdTechSlidePreview',
      'Slide Preview',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      }
    );

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

    const clientScript = `
      const vscode = acquireVsCodeApi();

      document.addEventListener('click', (e) => {
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
        if (msg.type === 'scrollToSlide') {
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
    const baseDir = docUri.scheme === 'file' ? path.dirname(docUri.fsPath) : undefined;
    if (baseDir && docUri.scheme === 'file') {
      this.panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
          vscode.Uri.file(baseDir),
        ],
      };
    }

    const html = renderDeckToHtml(deck, {
      scriptContent: clientScript,
      baseDir,
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
