import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('snippets', () => {
  it('loads valid JSON snippet file with all required prefixes', () => {
    const snippetPath = path.join(__dirname, '..', 'snippets', 'markdown.json');
    expect(fs.existsSync(snippetPath)).toBe(true);

    const raw = fs.readFileSync(snippetPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<
      string,
      { prefix: string | string[]; body: string[]; description?: string }
    >;

    expect(typeof parsed).toBe('object');

    // 必須スニペットの存在チェック
    const requiredSnippets = [
      'Slide Delimiter',
      'Two Columns',
      'Three Columns',
      'Ratio Columns',
      'Speaker Note',
      'Mermaid Diagram',
    ];

    for (const name of requiredSnippets) {
      expect(parsed[name]).toBeDefined();
      expect(parsed[name]?.prefix).toBeDefined();
      expect(Array.isArray(parsed[name]?.body)).toBe(true);
      expect((parsed[name]?.body.length ?? 0) > 0).toBe(true);
    }
  });
});
