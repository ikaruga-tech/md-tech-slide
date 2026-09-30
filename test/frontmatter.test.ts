import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../src/parser/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const input = `---
title: "My Slide"
theme: "dark"
aspectRatio: "16:9"
---
# Content`;

    const result = parseFrontmatter(input);
    expect(result.metadata.title).toBe('My Slide');
    expect(result.metadata.theme).toBe('dark');
    expect(result.metadata.aspectRatio).toBe('16:9');
    expect(result.content.trim()).toBe('# Content');
  });

  it('handles source without frontmatter', () => {
    const input = '# Just Markdown';
    const result = parseFrontmatter(input);
    expect(result.metadata).toEqual({});
    expect(result.content).toBe(input);
  });

  it('throws error when frontmatter is not closed', () => {
    const input = `---
title: "Unclosed"
# No closing delimiter`;

    expect(() => parseFrontmatter(input)).toThrow('Frontmatter is opened with "---" but not closed with "---".');
  });

  it('throws error when frontmatter contains invalid YAML', () => {
    const input = `---
title: [invalid: yaml
---
Content`;

    expect(() => parseFrontmatter(input)).toThrow('Failed to parse Frontmatter YAML');
  });
});
