import yaml from 'yaml';
import type { DiagnosticIssue } from '../validator/types.js';

const VALID_THEMES = new Set(['default', 'corporate', 'dark']);
const VALID_ASPECT_RATIOS = new Set(['16:9', '4:3']);
const KNOWN_KEYS = new Set(['title', 'author', 'theme', 'aspectRatio', 'paginate']);

export function validateFrontmatter(markdown: string): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---')) {
    return issues;
  }

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    // 閉じタグがない、または不完全なFrontmatter
    issues.push({
      line: 0,
      column: 0,
      length: 3,
      message: 'Unclosed frontmatter block (missing closing "---").',
      severity: 'error',
      code: 'frontmatter-unclosed',
    });
    return issues;
  }

  const yamlContent = match[1] ?? '';
  const lineCounter = new yaml.LineCounter();
  const doc = yaml.parseDocument(yamlContent, { lineCounter });

  // YAMLパースエラー
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const pos = err.pos ? lineCounter.linePos(err.pos[0]) : { line: 1, col: 1 };
      issues.push({
        line: pos.line, // line 0 は '---' なので line 1 は Markdown の line 1
        column: Math.max(0, pos.col - 1),
        length: 1,
        message: `YAML syntax error: ${err.message}`,
        severity: 'error',
        code: 'frontmatter-yaml-syntax',
      });
    }
    return issues;
  }

  if (!doc.contents) {
    return issues;
  }

  if (!yaml.isMap(doc.contents)) {
    issues.push({
      line: 1,
      column: 0,
      length: 3,
      message: 'Frontmatter must be a YAML mapping object.',
      severity: 'error',
      code: 'frontmatter-not-a-mapping',
    });
    return issues;
  }

  const mapNode = doc.contents as yaml.YAMLMap;

  for (const item of mapNode.items) {
    const keyNode = item.key as yaml.Scalar;
    if (!keyNode || typeof keyNode.value !== 'string') {
      continue;
    }

    const key = keyNode.value;
    const keyPos = keyNode.range ? lineCounter.linePos(keyNode.range[0]) : { line: 1, col: 1 };
    const line = keyPos.line;
    const column = Math.max(0, keyPos.col - 1);
    const length = key.length;

    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        line,
        column,
        length,
        message: `Unknown frontmatter key "${key}".`,
        severity: 'warning',
        code: 'frontmatter-unknown-key',
      });
      continue;
    }

    const valNode = item.value as yaml.Scalar;
    const value = valNode ? valNode.value : undefined;

    switch (key) {
      case 'title':
      case 'author': {
        if (value !== undefined && typeof value !== 'string') {
          issues.push({
            line,
            column,
            length,
            message: `"${key}" must be a string.`,
            severity: 'error',
            code: 'frontmatter-invalid-type',
          });
        }
        break;
      }

      case 'theme': {
        if (typeof value !== 'string' || !VALID_THEMES.has(value)) {
          issues.push({
            line,
            column,
            length,
            message: `Invalid theme "${String(value)}". Supported: default, corporate, dark.`,
            severity: 'error',
            code: 'frontmatter-invalid-theme',
          });
        }
        break;
      }

      case 'aspectRatio': {
        if (typeof value !== 'string' || !VALID_ASPECT_RATIOS.has(value)) {
          issues.push({
            line,
            column,
            length,
            message: `Invalid aspectRatio "${String(value)}". Supported: 16:9, 4:3.`,
            severity: 'error',
            code: 'frontmatter-invalid-aspect-ratio',
          });
        }
        break;
      }

      case 'paginate': {
        if (typeof value !== 'boolean') {
          issues.push({
            line,
            column,
            length,
            message: '"paginate" must be a boolean (true or false).',
            severity: 'error',
            code: 'frontmatter-invalid-type',
          });
        }
        break;
      }
    }
  }

  return issues;
}
