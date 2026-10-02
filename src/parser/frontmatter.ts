import { parse as parseYaml } from 'yaml';
import type { SlideDeckMetadata } from '../types/ir.js';

export interface FrontmatterResult {
  readonly metadata: SlideDeckMetadata;
  readonly content: string;
}

export function parseFrontmatter(source: string): FrontmatterResult {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) {
    return {
      metadata: {},
      content: source,
    };
  }

  const closingDelimiter = '\n---';
  const afterOpening = trimmed.slice(3);
  const closingIndex = afterOpening.indexOf(closingDelimiter);

  if (closingIndex === -1) {
    throw new Error('Frontmatter is opened with "---" but not closed with "---".');
  }

  const rawYaml = afterOpening.slice(0, closingIndex).trim();
  const restWithDelimiter = afterOpening.slice(closingIndex + closingDelimiter.length);
  // 改行をスキップ
  const content = restWithDelimiter.replace(/^(\r?\n)+/, '');

  try {
    const parsed = parseYaml(rawYaml) as unknown;
    if (parsed === null || parsed === undefined) {
      return { metadata: {}, content };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Frontmatter must be a YAML mapping object.');
    }
    return {
      metadata: parsed as SlideDeckMetadata,
      content,
    };
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to parse Frontmatter YAML: ${err.message}`, { cause: err });
    }
    throw new Error('Failed to parse Frontmatter YAML: unknown error.', { cause: err });
  }
}
