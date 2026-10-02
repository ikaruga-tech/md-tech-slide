import { describe, it, expect } from 'vitest';
import { validateFrontmatter } from '../src/parser/frontmatter-validator.js';
import { validateSlideSyntax } from '../src/validator/slide-validator.js';

describe('frontmatter-validator', () => {
  it('passes on valid frontmatter schema', () => {
    const markdown = `---
title: "Valid Title"
author: "Author Name"
theme: "corporate"
aspectRatio: "16:9"
paginate: true
---

# Content
`;
    const issues = validateFrontmatter(markdown);
    expect(issues).toHaveLength(0);
  });

  it('detects unclosed frontmatter block', () => {
    const markdown = `---
title: "Unclosed"
# Content
`;
    const issues = validateFrontmatter(markdown);
    expect(issues.some((i) => i.code === 'frontmatter-unclosed')).toBe(true);
  });

  it('detects YAML syntax errors with line/column information', () => {
    const markdown = `---
title: [unclosed list
theme: dark
---
`;
    const issues = validateFrontmatter(markdown);
    expect(issues.some((i) => i.code === 'frontmatter-yaml-syntax')).toBe(true);
  });

  it('detects invalid theme enum', () => {
    const markdown = `---
title: "Test"
theme: "neon-cyberpunk"
---
`;
    const issues = validateFrontmatter(markdown);
    const themeIssue = issues.find((i) => i.code === 'frontmatter-invalid-theme');
    expect(themeIssue).toBeDefined();
    expect(themeIssue?.severity).toBe('error');
    expect(themeIssue?.message).toContain('neon-cyberpunk');
  });

  it('detects invalid aspectRatio enum', () => {
    const markdown = `---
title: "Test"
aspectRatio: "21:9"
---
`;
    const issues = validateFrontmatter(markdown);
    const ratioIssue = issues.find((i) => i.code === 'frontmatter-invalid-aspect-ratio');
    expect(ratioIssue).toBeDefined();
    expect(ratioIssue?.severity).toBe('error');
  });

  it('detects invalid types for paginate and title', () => {
    const markdown = `---
title: 12345
paginate: "yes"
---
`;
    const issues = validateFrontmatter(markdown);
    const typeIssues = issues.filter((i) => i.code === 'frontmatter-invalid-type');
    expect(typeIssues.length).toBeGreaterThanOrEqual(2);
  });

  it('warns on unknown frontmatter keys', () => {
    const markdown = `---
title: "Test"
customKey: "value"
---
`;
    const issues = validateFrontmatter(markdown);
    const unknownIssue = issues.find((i) => i.code === 'frontmatter-unknown-key');
    expect(unknownIssue).toBeDefined();
    expect(unknownIssue?.severity).toBe('warning');
    expect(unknownIssue?.message).toContain('customKey');
  });

  it('integrates seamlessly with validateSlideSyntax', () => {
    const markdown = `---
theme: "unknown-theme"
---

::: columns
::: column
Left
:::
`;
    const issues = validateSlideSyntax(markdown);
    expect(issues.some((i) => i.code === 'frontmatter-invalid-theme')).toBe(true);
  });
});
