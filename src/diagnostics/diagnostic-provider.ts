import * as vscode from 'vscode';
import { validateSlideSyntax } from '../validator/index.js';
import { getAllowedResourceRoots } from '../resource/index.js';
import { DiagnosticLifecycleManager } from './diagnostic-lifecycle.js';

export class SlideDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly lifecycle = new DiagnosticLifecycleManager();

  constructor() {
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

    // ドキュメントを閉じた時の診断クリア
    this.lifecycle.registerDisposable(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.collection.delete(doc.uri);
        const key = doc.uri.toString();
        this.lifecycle.clearDebounceTimer(key);
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

    const text = document.getText();
    const sourceMarkdownPath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((wf) => wf.uri.fsPath);
    const allowedRoots = getAllowedResourceRoots(sourceMarkdownPath, workspaceFolders);

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

    this.collection.set(document.uri, diagnostics);
  }

  public dispose(): void {
    this.lifecycle.dispose();
  }
}
