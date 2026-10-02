export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type SlideValidationCode =
  | 'unclosed-container'
  | 'unexpected-close'
  | 'unknown-container'
  | 'orphaned-column'
  | 'invalid-ratio'
  | 'layout-overflow'
  | 'image-not-found'
  | 'image-access-denied'
  | 'image-format-unsupported'
  | 'image-too-large'
  | 'resource-invalid'
  | string;

export interface DiagnosticIssue {
  readonly line: number; // 0-indexed 行番号
  readonly column: number; // 0-indexed 列番号
  readonly length: number; // 対象トークンの文字数
  readonly message: string; // エラー/警告メッセージ
  readonly severity: DiagnosticSeverity;
  readonly code: SlideValidationCode; // エラー識別子
}

export interface SlideValidationContext {
  readonly sourceMarkdownPath?: string;
  readonly allowedRoots?: readonly string[];
}
