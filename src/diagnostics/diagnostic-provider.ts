import * as vscode from 'vscode';
import { validateSlideSyntax } from '../validator/index.js';
import { getAllowedResourceRoots } from '../resource/index.js';
import { DiagnosticLifecycleManager } from './diagnostic-lifecycle.js';
import { parseMarkdownToSlideDeck } from '../parser/index.js';
import {
  getSafeDiagramErrorMessage,
  type DiagramRenderService,
  type DiagramErrorCode,
} from '../diagram/index.js';
import type { DiagramBlock } from '../types/ir.js';

export class SlideDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly lifecycle = new DiagnosticLifecycleManager();
  private readonly diagramService?: DiagramRenderService;
  private readonly documentVersions = new Map<string, number>();

  constructor(diagramService?: DiagramRenderService) {
    this.diagramService = diagramService;
    this.collection = vscode.languages.createDiagnosticCollection('md-tech-slide');
    this.lifecycle.registerDisposable(this.collection);

    // ドキュメントを開いた時の検証
    this.lifecycle.registerDisposable(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.updateDiagnostics(doc);
      })
    );

    // ドキュメント編集時の検証（300ms デバウンス）
    this.lifecycle.registerDisposable(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.debounceUpdate(e.document);
      })
    );

    // ドキュメント保存時の即時検証
    this.lifecycle.registerDisposable(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.updateDiagnostics(doc);
      })
    );

    // ドキュメントを閉じた時の診断クリアと要求キャンセル
    this.lifecycle.registerDisposable(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        this.collection.delete(doc.uri);
        this.lifecycle.clearDebounceTimer(key);
        this.documentVersions.delete(key);
        this.diagramService?.cancelByOwner(`diagnostic:${key}`);
      })
    );

    // 既に開かれている Markdown ドキュメントへの即時適用
    for (const doc of vscode.workspace.textDocuments) {
      this.updateDiagnostics(doc);
    }
  }

  private debounceUpdate(document: vscode.TextDocument): void {
    if (document.languageId !== 'markdown') {
      return;
    }

    const key = document.uri.toString();
    this.lifecycle.setDebounceTimer(
      key,
      () => {
        this.updateDiagnostics(document);
      },
      300
    );
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== 'markdown') {
      return;
    }

    const docUriStr = document.uri.toString();
    const currentVersion = document.version;
    this.documentVersions.set(docUriStr, currentVersion);

    const text = document.getText();
    const sourceMarkdownPath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
    const allowedRoots = getAllowedResourceRoots(sourceMarkdownPath, workspaceFolders);

    // 1. 同期構文バリデーション
    const issues = validateSlideSyntax(text, {
      sourceMarkdownPath,
      allowedRoots,
    });

    const diagnostics: vscode.Diagnostic[] = issues.map((issue) => {
      const range = new vscode.Range(
        issue.line,
        issue.column,
        issue.line,
        issue.column + issue.length
      );

      let severity: vscode.DiagnosticSeverity;
      if (issue.severity === 'error') {
        severity = vscode.DiagnosticSeverity.Error;
      } else if (issue.severity === 'warning') {
        severity = vscode.DiagnosticSeverity.Warning;
      } else {
        severity = vscode.DiagnosticSeverity.Information;
      }

      const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
      diagnostic.source = 'md-tech-slide';
      diagnostic.code = issue.code;
      return diagnostic;
    });

    // 2. Diagram ブロックの抽出と静的エラーの反映
    const deck = parseMarkdownToSlideDeck(text);
    const diagramBlocks: DiagramBlock[] = [];
    for (const slide of deck.slides) {
      if (slide.slots.body.type === 'single') {
        for (const el of slide.slots.body.elements) {
          if (el.type === 'diagram') diagramBlocks.push(el);
        }
      } else if (slide.slots.body.type === 'columns') {
        for (const col of slide.slots.body.columns) {
          for (const el of col.elements) {
            if (el.type === 'diagram') diagramBlocks.push(el);
          }
        }
      }
    }

    for (const diag of diagramBlocks) {
      if (diag.status === 'error' && diag.errorCode) {
        const line = Math.max(0, diag.startLine);
        const range = new vscode.Range(line, 0, line, 100);
        const d = new vscode.Diagnostic(
          range,
          diag.errorMessage || 'Mermaid diagram error',
          vscode.DiagnosticSeverity.Error
        );
        d.source = 'md-tech-slide';
        d.code = diag.errorCode;
        diagnostics.push(d);
      }
    }

    // 同期診断結果を即時設定
    this.collection.set(document.uri, diagnostics);

    // 3. 未解決 Diagram ブロックの非同期検証
    const pendingDiagrams = diagramBlocks.filter((d) => d.status === 'pending');
    if (this.diagramService && pendingDiagrams.length > 0) {
      const ownerId = `diagnostic:${docUriStr}`;
      this.diagramService.cancelByOwner(ownerId);
      void (async () => {
        const asyncDiagnostics: vscode.Diagnostic[] = [];
        for (const diag of pendingDiagrams) {
          try {
            await this.diagramService!.renderDiagram({
              source: diag.source,
              ownerId,
              configId: diag.configId,
            });
          } catch (err: unknown) {
            const errCode =
              err && typeof err === 'object' && 'code' in err
                ? String((err as { code: unknown }).code)
                : undefined;
            if (errCode === 'mermaid-cancelled' || errCode === 'mermaid-service-disposed') {
              return;
            }
            const line = Math.max(0, diag.startLine);
            const range = new vscode.Range(line, 0, line, 100);
            const safeCode = (errCode as DiagramErrorCode) || 'mermaid-render-failed';
            const message = getSafeDiagramErrorMessage(safeCode);
            const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
            d.source = 'md-tech-slide';
            d.code = safeCode;
            asyncDiagnostics.push(d);
          }
        }

        // 最新バージョンと一致する場合のみ診断コレクションを更新
        if (this.documentVersions.get(docUriStr) === currentVersion && !document.isClosed) {
          const combined = [...diagnostics, ...asyncDiagnostics];
          this.collection.set(document.uri, combined);
        }
      })();
    }
  }

  public dispose(): void {
    this.lifecycle.dispose();
  }
}
