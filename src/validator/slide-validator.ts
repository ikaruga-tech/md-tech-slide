import * as path from 'node:path';
import type { DiagnosticIssue, SlideValidationContext } from './types.js';
import { validateFrontmatter } from '../parser/frontmatter-validator.js';
import { parseMarkdownToSlideDeck } from '../parser/index.js';
import { analyzeLayoutOverflow, parseColumnRatio } from '../layout/index.js';
import { findSlideStartLine } from '../parser/slide-locator.js';
import {
  resolveLocalResource,
  ResourceNotFoundError,
  ResourceAccessDeniedError,
  UnsupportedResourceFormatError,
  ResourceTooLargeError,
} from '../resource/index.js';

interface ContainerStackItem {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

const SUPPORTED_CONTAINERS = ['columns', 'column', 'note'] as const;

export function validateSlideSyntax(
  markdown: string,
  context?: SlideValidationContext
): readonly DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  // Frontmatter のスキーマおよび型検証
  const frontmatterIssues = validateFrontmatter(markdown);
  issues.push(...frontmatterIssues);

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

    // コードブロック外のローカル画像構文検証
    if (context?.sourceMarkdownPath) {
      // インラインコード（`...`）を同一文字数のスペースでマスクして誤検知を防止
      const lineForImages = rawLine.replace(/`+[^`]+`+/g, (m) => ' '.repeat(m.length));
      const imageRegex = /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g;
      let match: RegExpExecArray | null;

      while ((match = imageRegex.exec(lineForImages)) !== null) {
        const rawSrc = match[2]?.trim() ?? '';
        if (
          !rawSrc ||
          rawSrc.startsWith('http://') ||
          rawSrc.startsWith('https://') ||
          rawSrc.startsWith('data:')
        ) {
          continue;
        }

        const queryIndex = rawSrc.indexOf('?');
        const hashIndex = rawSrc.indexOf('#');
        let cleanPath = rawSrc;
        if (queryIndex !== -1 || hashIndex !== -1) {
          const splitIndex = Math.min(
            queryIndex !== -1 ? queryIndex : Infinity,
            hashIndex !== -1 ? hashIndex : Infinity
          );
          cleanPath = rawSrc.slice(0, splitIndex);
        }

        const filename = path.basename(cleanPath);

        try {
          resolveLocalResource({
            resourcePath: cleanPath,
            sourceMarkdownPath: context.sourceMarkdownPath,
            allowedRoots: context.allowedRoots,
          });
        } catch (err) {
          let code: DiagnosticIssue['code'];
          let message: string;

          if (err instanceof ResourceNotFoundError) {
            code = 'image-not-found';
            message = `Image not found: "${filename}".`;
          } else if (err instanceof ResourceAccessDeniedError) {
            code = 'image-access-denied';
            message = `Access denied to image outside allowed workspace roots: "${filename}".`;
          } else if (err instanceof UnsupportedResourceFormatError) {
            code = 'image-format-unsupported';
            message = `Unsupported image format: "${filename}". Allowed formats: PNG, JPEG, SVG, WebP.`;
          } else if (err instanceof ResourceTooLargeError) {
            code = 'image-too-large';
            message = `Image exceeds maximum allowed size (20MB): "${filename}".`;
          } else {
            const errorName = err instanceof Error ? err.name : 'ResourceError';
            code = 'resource-invalid';
            message = `Image resource error: ${errorName} (${filename}).`;
          }

          issues.push({
            line: lineIdx,
            column: match.index,
            length: match[0].length,
            message,
            severity: 'warning',
            code,
          });
        }
      }
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
    if (!SUPPORTED_CONTAINERS.includes(containerName as (typeof SUPPORTED_CONTAINERS)[number])) {
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
          message:
            "The '::: column' container must be placed directly inside a '::: columns' block.",
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
        const parsed = parseColumnRatio(ratioMatch[1]);
        if (!parsed.valid) {
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

  // 重大な構文エラーがなければレイアウト溢れ診断を実施
  const hasSyntaxErrors = issues.some((i) => i.severity === 'error');
  if (!hasSyntaxErrors) {
    try {
      const deck = parseMarkdownToSlideDeck(markdown);
      const overflowIssues = analyzeLayoutOverflow(deck);

      for (const overflow of overflowIssues) {
        const slideStart = findSlideStartLine(markdown, overflow.slideIndex);
        issues.push({
          line: slideStart,
          column: 0,
          length: (lines[slideStart] ?? '').length || 1,
          message: overflow.message,
          severity: 'warning',
          code: 'layout-overflow',
        });
      }
    } catch {
      // レイアウト診断での予期せぬ失敗は構文検証自体を妨げない
    }
  }

  return issues;
}
