import * as vscode from 'vscode';
import { validateSlideSyntax } from '../validator/index.js';

export class SlideDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('md-tech-slide');
    this.disposables.push(this.collection);

    // ドキュメントを開いた時の検証
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.updateDiagnostics(doc);
      })
    );

    // ドキュメント編集時の検証（300ms デバウンス）
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.debounceUpdate(e.document);
      })
    );

    // ドキュメント保存時の即時検証
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.updateDiagnostics(doc);
      })
    );

    // ドキュメントを閉じた時の診断クリア
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.collection.delete(doc.uri);
        const key = doc.uri.toString();
        const timer = this.debounceTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(key);
        }
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
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.updateDiagnostics(document);
    }, 300);

    this.debounceTimers.set(key, timer);
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== 'markdown') {
      return;
    }

    const text = document.getText();
    const issues = validateSlideSyntax(text);

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
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
