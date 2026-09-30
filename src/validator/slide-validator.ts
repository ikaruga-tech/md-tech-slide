import type { DiagnosticIssue } from './types.js';

interface ContainerStackItem {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

const SUPPORTED_CONTAINERS = ['columns', 'column', 'note'] as const;

export function validateSlideSyntax(markdown: string): readonly DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const lines = markdown.split(/\r?\n/);
  const stack: ContainerStackItem[] = [];

  let inCodeFence = false;
  let codeFenceMarker = '';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] ?? '';
    const trimmedLine = rawLine.trimStart();
    const leadingSpaces = rawLine.length - trimmedLine.length;

    // コードブロックの開始・終了判定
    const fenceMatch = trimmedLine.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = marker[0] ?? '`';
      } else if (marker[0] === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = '';
      }
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    // コンテナマーカー（3つ以上の :）の検知
    if (!trimmedLine.startsWith(':::')) {
      continue;
    }

    let pos = 0;
    while (pos < trimmedLine.length && trimmedLine.charCodeAt(pos) === 0x3a) {
      pos++;
    }
    const markerLength = pos;
    const rest = trimmedLine.slice(pos).trim();

    // 閉じタグ（:::）の場合
    if (rest.length === 0) {
      if (stack.length === 0) {
        issues.push({
          line: lineIdx,
          column: leadingSpaces,
          length: markerLength,
          message: "Unexpected closing container ':::' with no matching open block.",
          severity: 'error',
          code: 'unexpected-close',
        });
      } else {
        stack.pop();
      }
      continue;
    }

    // 開きタグ（::: name [params]）の場合
    const parts = rest.split(/\s+/);
    const containerName = parts[0] ?? '';

    // サポート対象外のコンテナ名
    if (!SUPPORTED_CONTAINERS.includes(containerName as typeof SUPPORTED_CONTAINERS[number])) {
      issues.push({
        line: lineIdx,
        column: leadingSpaces,
        length: markerLength + containerName.length + 1,
        message: `Unknown container '::: ${containerName}'. Supported containers are: columns, column, note.`,
        severity: 'warning',
        code: 'unknown-container',
      });
      continue;
    }

    // ::: column は ::: columns の直下でなければならない
    if (containerName === 'column') {
      const parent = stack[stack.length - 1];
      if (!parent || parent.name !== 'columns') {
        issues.push({
          line: lineIdx,
          column: leadingSpaces,
          length: markerLength + containerName.length + 1,
          message: "The '::: column' container must be placed directly inside a '::: columns' block.",
          severity: 'error',
          code: 'orphaned-column',
        });
      }
    }

    // ::: columns の ratio 属性検証
    if (containerName === 'columns' && parts.length > 1) {
      const fullParams = rest.slice(containerName.length).trim();
      const ratioMatch = fullParams.match(/ratio=["']?([^"'\s]+)["']?/);
      if (ratioMatch && ratioMatch[1]) {
        const ratioParts = ratioMatch[1].split(':');
        const invalidSeg = ratioParts.some((p) => {
          const n = parseFloat(p);
          return Number.isNaN(n) || n <= 0;
        });
        if (invalidSeg || ratioParts.length < 2) {
          issues.push({
            line: lineIdx,
            column: leadingSpaces,
            length: rawLine.length - leadingSpaces,
            message: `Invalid ratio specification "${ratioMatch[1]}". Ratio must be in format like "2:1" or "1:2:1".`,
            severity: 'warning',
            code: 'invalid-ratio',
          });
        }
      }
    }

    stack.push({
      name: containerName,
      line: lineIdx,
      column: leadingSpaces,
      length: rawLine.length - leadingSpaces,
    });
  }

  // ループ終了後にスタックに残っている未クローズのコンテナを検出
  while (stack.length > 0) {
    const unclosed = stack.pop();
    if (unclosed) {
      issues.push({
        line: unclosed.line,
        column: unclosed.column,
        length: unclosed.length,
        message: `Unclosed container '::: ${unclosed.name}' opened on line ${unclosed.line + 1}.`,
        severity: 'error',
        code: 'unclosed-container',
      });
    }
  }

  return issues;
}
