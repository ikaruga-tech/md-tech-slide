import * as vscode from 'vscode';
import * as path from 'node:path';
import { SlideDiagnosticProvider } from './diagnostics/index.js';
import { parseMarkdownToSlideDeck } from './parser/index.js';
import { exportDeckToPptx, exportDeckToPdf } from './export/index.js';
import { SlidePreviewPanel } from './webview/index.js';

export function activate(context: vscode.ExtensionContext): void {
  // 1. スライド構文バリデーション機能の初期化
  const diagnosticProvider = new SlideDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);

  // 2. プレビュー表示コマンドの登録
  const openPreviewCommand = vscode.commands.registerCommand(
    'md-tech-slide.openPreview',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Please open a Markdown file to view slide preview.');
        return;
      }
      SlidePreviewPanel.createOrShow(editor);
    }
  );
  context.subscriptions.push(openPreviewCommand);

  // 3. PPTXエクスポートコマンドの登録
  const exportPPTXCommand = vscode.commands.registerCommand(
    'md-tech-slide.exportPPTX',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Please open a Markdown file to export presentation.');
        return;
      }

      const document = editor.document;
      const docPath = document.uri.fsPath;
      const defaultUri = vscode.Uri.file(
        docPath ? docPath.replace(/\.md$/i, '.pptx') : 'presentation.pptx'
      );

      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'PowerPoint Presentation': ['pptx'] },
      });

      if (!targetUri) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting PowerPoint presentation...',
            cancellable: false,
          },
          async () => {
            const markdown = document.getText();
            const deck = parseMarkdownToSlideDeck(markdown);
            const baseDir = docPath ? path.dirname(docPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            await exportDeckToPptx(deck, targetUri.fsPath, { baseDir });
          }
        );

        vscode.window.showInformationMessage(
          `Successfully exported presentation to ${path.basename(targetUri.fsPath)}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to export presentation: ${msg}`);
      }
    }
  );
  context.subscriptions.push(exportPPTXCommand);

  // 4. PDFエクスポートコマンドの登録
  const exportPDFCommand = vscode.commands.registerCommand(
    'md-tech-slide.exportPDF',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Please open a Markdown file to export PDF presentation.');
        return;
      }

      const document = editor.document;
      const docPath = document.uri.fsPath;
      const defaultUri = vscode.Uri.file(
        docPath ? docPath.replace(/\.md$/i, '.pdf') : 'presentation.pdf'
      );

      const targetUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'PDF Document': ['pdf'] },
      });

      if (!targetUri) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Exporting PDF presentation via Chromium/Edge...',
            cancellable: false,
          },
          async () => {
            const markdown = document.getText();
            const deck = parseMarkdownToSlideDeck(markdown);
            const baseDir = docPath ? path.dirname(docPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            await exportDeckToPdf(deck, targetUri.fsPath, { baseDir });
          }
        );

        vscode.window.showInformationMessage(
          `Successfully exported PDF to ${path.basename(targetUri.fsPath)}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to export PDF: ${msg}`);
      }
    }
  );
  context.subscriptions.push(exportPDFCommand);

  // 5. リアルタイムプレビュー更新（デバウンス付きテキスト変更検知）
  let updateDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (SlidePreviewPanel.currentPanel && e.document.languageId === 'markdown') {
        if (updateDebounceTimer) {
          clearTimeout(updateDebounceTimer);
        }
        updateDebounceTimer = setTimeout(() => {
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor && activeEditor.document.uri.toString() === e.document.uri.toString()) {
            SlidePreviewPanel.currentPanel?.updateContent(activeEditor);
          }
        }, 250);
      }
    })
  );

  // 6. カーソル位置変更に応じたプレビュースクロール同期
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (SlidePreviewPanel.currentPanel && e.textEditor.document.languageId === 'markdown') {
        SlidePreviewPanel.currentPanel.syncScrollFromEditor();
      }
    })
  );

  // 7. アクティブエディタ切り替え時のプレビュー連動
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (SlidePreviewPanel.currentPanel && editor && editor.document.languageId === 'markdown') {
        SlidePreviewPanel.currentPanel.updateContent(editor);
      }
    })
  );
}

export function deactivate(): void {
  // リソースの破棄処理（subscriptions 経由で自動解放）
}
