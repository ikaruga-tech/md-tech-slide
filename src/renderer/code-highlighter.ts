import { escapeHtml } from './html-escape.js';

const KEYWORDS = new Set([
  'from',
  'import',
  'as',
  'def',
  'class',
  'return',
  'if',
  'elif',
  'else',
  'for',
  'while',
  'in',
  'is',
  'not',
  'and',
  'or',
  'try',
  'except',
  'finally',
  'with',
  'lambda',
  'yield',
  'async',
  'await',
  'raise',
  'pass',
  'break',
  'continue',
  'const',
  'let',
  'var',
  'function',
  'type',
  'interface',
  'export',
  'default',
  'null',
  'true',
  'false',
  'True',
  'False',
  'None',
  'new',
  'this',
  'throw',
  'catch',
  'typeof',
  'instanceof',
  'void',
  'public',
  'private',
  'protected',
  'static',
  'readonly',
]);

const TYPES = new Set([
  'str',
  'int',
  'float',
  'bool',
  'dict',
  'list',
  'set',
  'tuple',
  'self',
  'string',
  'number',
  'boolean',
  'any',
  'void',
  'unknown',
  'never',
  'object',
  'Promise',
  'Array',
  'Record',
  'Map',
  'Set',
]);

export function highlightCodeToHtml(code: string, _language?: string): string {
  // 言語が指定されていない場合でも基本ハイライトを適用
  const tokenRegex =
    /(#.*$|\/\/.*$|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|@[a-zA-Z_]\w*|\b[a-zA-Z_]\w*\b|\b\d+(?:\.\d+)?\b)/gm;

  let lastIndex = 0;
  let html = '';

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(code.slice(lastIndex, match.index));
    }

    const token = match[0];
    lastIndex = match.index + token.length;

    if (token.startsWith('#') || token.startsWith('//') || token.startsWith('/*')) {
      html += `<span class="hl-comment">${escapeHtml(token)}</span>`;
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      html += `<span class="hl-string">${escapeHtml(token)}</span>`;
    } else if (token.startsWith('@')) {
      html += `<span class="hl-decorator">${escapeHtml(token)}</span>`;
    } else if (/^\d/.test(token)) {
      html += `<span class="hl-number">${escapeHtml(token)}</span>`;
    } else if (KEYWORDS.has(token)) {
      html += `<span class="hl-keyword">${escapeHtml(token)}</span>`;
    } else if (TYPES.has(token) || /^[A-Z][a-zA-Z0-9_]*$/.test(token)) {
      html += `<span class="hl-type">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }
  }

  if (lastIndex < code.length) {
    html += escapeHtml(code.slice(lastIndex));
  }

  return html;
}
