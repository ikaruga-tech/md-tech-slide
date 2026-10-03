import yaml from 'yaml';
import type { DiagnosticIssue } from '../validator/types.js';

const VALID_THEMES = new Set(['default', 'corporate', 'dark']);
const VALID_ASPECT_RATIOS = new Set(['16:9', '4:3']);
const KNOWN_KEYS = new Set([
  'title',
  'author',
  'theme',
  'aspectRatio',
  'paginate',
  'font',
  'codeFont',
  'fonts',
  'fontSize',
  'fontFamily',
]);

const VALID_FONTS_SUBKEYS = new Set(['body', 'heading', 'code']);
const VALID_FONT_SIZE_SUBKEYS = new Set(['body', 'heading']);

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 96;
const MAX_FONT_NAME_LENGTH = 128;

const INVALID_FONT_NAME_CHARS = /[<>{};]/;

function hasControlOrLinebreak(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function checkFontString(
  val: unknown,
  keyName: string,
  line: number,
  column: number,
  length: number,
  issues: DiagnosticIssue[]
): void {
  if (typeof val !== 'string') {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" must be a string.`,
      severity: 'error',
      code: 'frontmatter-invalid-font',
    });
    return;
  }

  const trimmed = val.trim();
  if (trimmed.length === 0) {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" cannot be empty.`,
      severity: 'error',
      code: 'frontmatter-invalid-font',
    });
    return;
  }

  if (trimmed.length > MAX_FONT_NAME_LENGTH) {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" exceeds maximum length of ${MAX_FONT_NAME_LENGTH} characters.`,
      severity: 'error',
      code: 'frontmatter-invalid-font',
    });
    return;
  }

  if (hasControlOrLinebreak(trimmed)) {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" contains illegal control characters.`,
      severity: 'error',
      code: 'frontmatter-invalid-font',
    });
    return;
  }

  if (INVALID_FONT_NAME_CHARS.test(trimmed)) {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" contains invalid characters (<, >, {, }, ;).`,
      severity: 'error',
      code: 'frontmatter-invalid-font',
    });
  }
}

function checkFontSizeNumber(
  val: unknown,
  keyName: string,
  line: number,
  column: number,
  length: number,
  issues: DiagnosticIssue[]
): void {
  if (
    typeof val !== 'number' ||
    !Number.isFinite(val) ||
    val < MIN_FONT_SIZE ||
    val > MAX_FONT_SIZE
  ) {
    issues.push({
      line,
      column,
      length,
      message: `"${keyName}" must be a finite number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`,
      severity: 'error',
      code: 'frontmatter-invalid-font-size',
    });
  }
}

export function validateFrontmatter(markdown: string): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---')) {
    return issues;
  }

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
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

  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const pos = err.pos ? lineCounter.linePos(err.pos[0]) : { line: 1, col: 1 };
      issues.push({
        line: pos.line,
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

    const valNode = item.value;
    const scalarValue = yaml.isScalar(valNode) ? valNode.value : undefined;

    switch (key) {
      case 'title':
      case 'author': {
        if (scalarValue !== undefined && typeof scalarValue !== 'string') {
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
        if (typeof scalarValue !== 'string' || !VALID_THEMES.has(scalarValue)) {
          issues.push({
            line,
            column,
            length,
            message: `Invalid theme "${String(scalarValue)}". Supported: default, corporate, dark.`,
            severity: 'error',
            code: 'frontmatter-invalid-theme',
          });
        }
        break;
      }

      case 'aspectRatio': {
        if (typeof scalarValue !== 'string' || !VALID_ASPECT_RATIOS.has(scalarValue)) {
          issues.push({
            line,
            column,
            length,
            message: `Invalid aspectRatio "${String(scalarValue)}". Supported: 16:9, 4:3.`,
            severity: 'error',
            code: 'frontmatter-invalid-aspect-ratio',
          });
        }
        break;
      }

      case 'paginate': {
        if (typeof scalarValue !== 'boolean') {
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

      case 'fontFamily': {
        issues.push({
          line,
          column,
          length,
          message:
            'Key "fontFamily" is deprecated. Use "font" or "fonts.body" / "fonts.heading" instead.',
          severity: 'warning',
          code: 'frontmatter-deprecated-key',
        });
        checkFontString(scalarValue, 'fontFamily', line, column, length, issues);
        break;
      }

      case 'font':
      case 'codeFont': {
        checkFontString(scalarValue, key, line, column, length, issues);
        break;
      }

      case 'fonts': {
        if (!yaml.isMap(valNode)) {
          issues.push({
            line,
            column,
            length,
            message: '"fonts" must be a mapping object with "body", "heading", and/or "code".',
            severity: 'error',
            code: 'frontmatter-invalid-type',
          });
          break;
        }

        const fontsMap = valNode as yaml.YAMLMap;
        for (const subItem of fontsMap.items) {
          const subKeyNode = subItem.key as yaml.Scalar;
          if (!subKeyNode || typeof subKeyNode.value !== 'string') {
            continue;
          }
          const subKey = subKeyNode.value;
          const subKeyPos = subKeyNode.range
            ? lineCounter.linePos(subKeyNode.range[0])
            : { line, col: column + 1 };
          const subLine = subKeyPos.line;
          const subCol = Math.max(0, subKeyPos.col - 1);
          const subLen = subKey.length;

          if (!VALID_FONTS_SUBKEYS.has(subKey)) {
            issues.push({
              line: subLine,
              column: subCol,
              length: subLen,
              message: `Unknown subkey "${subKey}" in "fonts". Allowed: body, heading, code.`,
              severity: 'warning',
              code: 'frontmatter-unknown-key',
            });
            continue;
          }

          const subVal = yaml.isScalar(subItem.value) ? subItem.value.value : undefined;
          checkFontString(subVal, `fonts.${subKey}`, subLine, subCol, subLen, issues);
        }
        break;
      }

      case 'fontSize': {
        if (yaml.isScalar(valNode)) {
          issues.push({
            line,
            column,
            length,
            message:
              'Numeric "fontSize" is deprecated. Use "fontSize.body" or detailed "fontSize" mapping instead.',
            severity: 'warning',
            code: 'frontmatter-deprecated-key',
          });
          checkFontSizeNumber(scalarValue, 'fontSize', line, column, length, issues);
        } else if (yaml.isMap(valNode)) {
          const sizeMap = valNode as yaml.YAMLMap;
          for (const subItem of sizeMap.items) {
            const subKeyNode = subItem.key as yaml.Scalar;
            if (!subKeyNode || typeof subKeyNode.value !== 'string') {
              continue;
            }
            const subKey = subKeyNode.value;
            const subKeyPos = subKeyNode.range
              ? lineCounter.linePos(subKeyNode.range[0])
              : { line, col: column + 1 };
            const subLine = subKeyPos.line;
            const subCol = Math.max(0, subKeyPos.col - 1);
            const subLen = subKey.length;

            if (!VALID_FONT_SIZE_SUBKEYS.has(subKey)) {
              issues.push({
                line: subLine,
                column: subCol,
                length: subLen,
                message: `Unknown subkey "${subKey}" in "fontSize". Allowed: body, heading.`,
                severity: 'warning',
                code: 'frontmatter-unknown-key',
              });
              continue;
            }

            const subVal = yaml.isScalar(subItem.value) ? subItem.value.value : undefined;
            checkFontSizeNumber(subVal, `fontSize.${subKey}`, subLine, subCol, subLen, issues);
          }
        } else {
          issues.push({
            line,
            column,
            length,
            message:
              '"fontSize" must be a number between 8 and 96 or a mapping with "body" and/or "heading".',
            severity: 'error',
            code: 'frontmatter-invalid-font-size',
          });
        }
        break;
      }
    }
  }

  return issues;
}
