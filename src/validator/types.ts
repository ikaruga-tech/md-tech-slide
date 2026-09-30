export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticIssue {
  readonly line: number;       // 0-indexed 行番号
  readonly column: number;     // 0-indexed 列番号
  readonly length: number;     // 対象トークンの文字数
  readonly message: string;    // エラー/警告メッセージ
  readonly severity: DiagnosticSeverity;
  readonly code: string;       // エラー識別子
}
