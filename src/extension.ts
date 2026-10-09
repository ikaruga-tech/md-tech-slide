import * as vscode from 'vscode';
import * as path from 'node:path';
import { SlideDiagnosticProvider } from './diagnostics/index.js';
import { parseMarkdownToSlideDeck } from './parser/index.js';
import { exportDeckToPptx, exportDeckToPdf } from './export/index.js';
import { SlidePreviewPanel } from './webview/index.js';
import { getAllowedResourceRoots } from './resource/index.js';
import { DiagramRenderService } from './diagram/index.js';

declare const __TEST_MODE__: boolean;

export interface ExtensionApi {
  readonly getPreviewPanel: () => typeof SlidePreviewPanel.currentPanel;
  readonly getDiagramService: () => DiagramRenderService | undefined;
}

let diagramRenderService: DiagramRenderService | undefined;

function isMarkdownDocument(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === 'markdown' ||
    /\.md$/i.test(doc.fileName) ||
    /\.markdown$/i.test(doc.fileName)
  );
}

async function resolveTargetDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  // 1. コマンド引数として URI が直接渡された場合（エクスプローラーの右クリックメニュー等）
  if (uri && uri.fsPath) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      return doc;
    } catch {
      // 読み込みに失敗した場合は後続フォールバックへ
    }
  }

  // 2. 現在アクティブなテキストエディタが Markdown ドキュメントの場合
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && isMarkdownDocument(activeEditor.document)) {
    return activeEditor.document;
  }

  // 3. プレビューパネルが現在開いており、そのプレビュー対象ドキュメントがある場合
  if (
    SlidePreviewPanel.currentPanel?.activeDocument &&
    isMarkdownDocument(SlidePreviewPanel.currentPanel.activeDocument)
  ) {
    return SlidePreviewPanel.currentPanel.activeDocument;
  }

  // 4. 画面上に表示されているエディタ群（visibleTextEditors）の中に Markdown がある場合
  for (const editor of vscode.window.visibleTextEditors) {
    if (isMarkdownDocument(editor.document)) {
      return editor.document;
    }
  }

  // 5. ワークスペース内で最近開かれた Markdown ドキュメント
  for (const doc of vscode.workspace.textDocuments) {
    if (isMarkdownDocument(doc) && !doc.isClosed) {
      return doc;
    }
  }

  return undefined;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  // 0. Mermaidレンダリングサービスの初期化
  const config = vscode.workspace.getConfiguration('mdTechSlide');
  const browserPath =
    config.get<string>('browserPath')?.trim() ||
    config.get<string>('export.browserPath')?.trim() ||
    undefined;

  diagramRenderService = new DiagramRenderService({ browserPath });
  context.subscriptions.push(diagramRenderService);

  // 1. スライド構文バリデーション機能の初期化
  const diagnosticProvider = new SlideDiagnosticProvider(diagramRenderService);
  context.subscriptions.push(diagnosticProvider);

  // 2. プレビュー表示コマンドの登録
  const openPreviewCommand = vscode.commands.registerCommand(
    'md-tech-slide.openPreview',
    async (uri?: vscode.Uri) => {
      let editor = vscode.window.activeTextEditor;

      // エクスプローラー等から URI が渡された、または現在エディタが非 Markdown の場合
      if (uri && uri.fsPath) {
        const doc = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(doc, { preview: false });
      } else if (!editor || !isMarkdownDocument(editor.document)) {
        const doc = await resolveTargetDocument();
        if (doc) {
          editor = await vscode.window.showTextDocument(doc, { preview: false });
        }
      }

      if (!editor || !isMarkdownDocument(editor.document)) {
        vscode.window.showWarningMessage('Please open a Markdown file to view slide preview.');
        return;
      }
      SlidePreviewPanel.createOrShow(editor, undefined, diagramRenderService);
    }
  );
  context.subscriptions.push(openPreviewCommand);

  // 3. PPTXエクスポートコマンドの登録
  const exportPPTXCommand = vscode.commands.registerCommand(
    'md-tech-slide.exportPPTX',
    async (uri?: vscode.Uri) => {
      const document = await resolveTargetDocument(uri);
      if (!document) {
        vscode.window.showWarningMessage('Please open a Markdown file to export presentation.');
        return;
      }

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
            const config = vscode.workspace.getConfiguration('mdTechSlide');
            const defaultTheme = config.get<string>('defaultTheme') || 'default';
            const defaultAspectRatio = config.get<string>('defaultAspectRatio') || '16:9';

            const markdown = document.getText();
            const deck = parseMarkdownToSlideDeck(markdown, {
              defaultTheme,
              defaultAspectRatio,
            });
            const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
            const allowedRoots = getAllowedResourceRoots(docPath, workspaceFolders);
            const baseDir = docPath ? path.dirname(docPath) : workspaceFolders?.[0];

            await exportDeckToPptx(deck, targetUri.fsPath, {
              baseDir,
              allowedRoots,
              diagramService: diagramRenderService,
            });
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
    async (uri?: vscode.Uri) => {
      const document = await resolveTargetDocument(uri);
      if (!document) {
        vscode.window.showWarningMessage('Please open a Markdown file to export PDF presentation.');
        return;
      }

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
            const config = vscode.workspace.getConfiguration('mdTechSlide');
            const defaultTheme = config.get<string>('defaultTheme') || 'default';
            const defaultAspectRatio = config.get<string>('defaultAspectRatio') || '16:9';
            const browserPath =
              config.get<string>('browserPath')?.trim() ||
              config.get<string>('export.browserPath')?.trim() ||
              undefined;

            const markdown = document.getText();
            const deck = parseMarkdownToSlideDeck(markdown, {
              defaultTheme,
              defaultAspectRatio,
            });
            const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
            const allowedRoots = getAllowedResourceRoots(docPath, workspaceFolders);
            const baseDir = docPath ? path.dirname(docPath) : workspaceFolders?.[0];

            await exportDeckToPdf(deck, targetUri.fsPath, {
              baseDir,
              allowedRoots,
              browserPath,
              diagramService: diagramRenderService,
            });
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

  // 5. 設定変更検知とブラウザパスの動的更新
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('mdTechSlide.browserPath') ||
        e.affectsConfiguration('mdTechSlide.export.browserPath')
      ) {
        const cfg = vscode.workspace.getConfiguration('mdTechSlide');
        const newPath =
          cfg.get<string>('browserPath')?.trim() ||
          cfg.get<string>('export.browserPath')?.trim() ||
          undefined;
        diagramRenderService?.updateBrowserPath(newPath);
      }
    })
  );

  // 6. リアルタイムプレビュー更新（デバウンス付きテキスト変更検知）
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
          } else if (
            SlidePreviewPanel.currentPanel?.activeDocument?.uri.toString() ===
            e.document.uri.toString()
          ) {
            SlidePreviewPanel.currentPanel.updateContent();
          }
        }, 250);
      }
    })
  );

  // 7. カーソル位置変更に応じたプレビュースクロール同期
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (SlidePreviewPanel.currentPanel && e.textEditor.document.languageId === 'markdown') {
        SlidePreviewPanel.currentPanel.syncScrollFromEditor();
      }
    })
  );

  // 8. アクティブエディタ切り替え時のプレビュー連動
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (SlidePreviewPanel.currentPanel && editor && editor.document.languageId === 'markdown') {
        SlidePreviewPanel.currentPanel.updateContent(editor);
      }
    })
  );

  const api: ExtensionApi = {
    getPreviewPanel: () => SlidePreviewPanel.currentPanel,
    getDiagramService: () => diagramRenderService,
  };

  if (__TEST_MODE__) {
    (api as unknown as Record<string, unknown>)['setPreviewTestObserver'] = (
      observer?: (msg: Record<string, unknown>) => void
    ) => {
      SlidePreviewPanel.testObserver = observer;
    };
  }

  return api;
}

export function deactivate(): void {
  if (diagramRenderService) {
    void diagramRenderService.dispose();
    diagramRenderService = undefined;
  }
}
