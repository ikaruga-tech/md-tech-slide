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

  describe('Phase 8: font and fontSize validation', () => {
    it('accepts valid simple and detailed formats', () => {
      const markdown = `---
title: "Valid Fonts"
font: "BIZ UDPGothic"
codeFont: "Cascadia Code"
fonts:
  body: "Yu Gothic"
  heading: "BIZ UDPGothic"
  code: "Cascadia Code"
fontSize:
  body: 18
  heading: 28
---
# Content
`;
      const issues = validateFrontmatter(markdown);
      expect(issues).toHaveLength(0);
    });

    it('emits deprecated warning for fontFamily and numeric fontSize without unknown key warning', () => {
      const markdown = `---
title: "Legacy Fonts"
fontFamily: "Yu Gothic"
fontSize: 18
---
# Content
`;
      const issues = validateFrontmatter(markdown);
      const deprecatedIssues = issues.filter((i) => i.code === 'frontmatter-deprecated-key');
      expect(deprecatedIssues).toHaveLength(2);
      expect(deprecatedIssues.every((i) => i.severity === 'warning')).toBe(true);

      // Verify no unknown key warnings are emitted for deprecated keys
      const unknownIssues = issues.filter((i) => i.code === 'frontmatter-unknown-key');
      expect(unknownIssues).toHaveLength(0);
    });

    it('detects invalid font names (empty, too long, control chars, injection chars)', () => {
      const markdown = `---
font: "   "
codeFont: "Arial</style><script>"
fontFamily: "Font\\nName"
---
# Content
`;
      const issues = validateFrontmatter(markdown);
      const fontErrors = issues.filter((i) => i.code === 'frontmatter-invalid-font');
      expect(fontErrors.length).toBeGreaterThanOrEqual(3);
      expect(fontErrors.every((i) => i.severity === 'error')).toBe(true);
    });

    it('detects font size out of range (8-96pt)', () => {
      const markdown = `---
fontSize: 7.9
---
# Content
`;
      const issues = validateFrontmatter(markdown);
      const sizeErrors = issues.filter((i) => i.code === 'frontmatter-invalid-font-size');
      expect(sizeErrors.length).toBeGreaterThanOrEqual(1);

      const markdown2 = `---
fontSize:
  body: 96.1
  heading: 0
---
# Content
`;
      const issues2 = validateFrontmatter(markdown2);
      const sizeErrors2 = issues2.filter((i) => i.code === 'frontmatter-invalid-font-size');
      expect(sizeErrors2.length).toBeGreaterThanOrEqual(2);
    });

    it('detects invalid fonts/fontSize mapping types and unknown subkeys with line position', () => {
      const markdown = `---
fonts: "not a map"
---
# Content
`;
      const issues = validateFrontmatter(markdown);
      expect(issues.some((i) => i.code === 'frontmatter-invalid-type')).toBe(true);

      const markdownUnknown = `---
fonts:
  unknownRole: "Arial"
fontSize:
  invalidRole: 18
---
# Content
`;
      const issuesUnknown = validateFrontmatter(markdownUnknown);
      const unknownSubkeys = issuesUnknown.filter((i) => i.code === 'frontmatter-unknown-key');
      expect(unknownSubkeys).toHaveLength(2);
      expect(unknownSubkeys[0]?.message).toContain('unknownRole');
      expect(unknownSubkeys[1]?.message).toContain('invalidRole');
    });
  });
});
