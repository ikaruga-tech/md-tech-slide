import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSlideSyntax } from '../src/validator/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('validateSlideSyntax', () => {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const sampleMdPath = path.join(fixturesDir, 'sample.md');

  it('returns no issues for valid slide syntax', () => {
    const input = `# Slide Title
::: columns ratio="2:1"
::: column
### Left
Content
:::
::: column
### Right
Content
:::
:::
::: note
Speaker note
:::`;

    const issues = validateSlideSyntax(input);
    expect(issues).toHaveLength(0);
  });

  it('detects unclosed container when ::: is missing', () => {
    const input = `::: columns
::: column
Left content without close`;

    const issues = validateSlideSyntax(input);
    expect(issues).toHaveLength(2);
    expect(
      issues.some((i) => i.code === 'unclosed-container' && i.message.includes('column'))
    ).toBe(true);
    expect(
      issues.some((i) => i.code === 'unclosed-container' && i.message.includes('columns'))
    ).toBe(true);
  });

  it('detects orphaned column outside columns container', () => {
    const input = `::: column
This is orphaned
:::`;

    const issues = validateSlideSyntax(input);
    expect(issues.some((i) => i.code === 'orphaned-column')).toBe(true);
  });

  it('detects unexpected closing container tag', () => {
    const input = `Content
:::
More content`;

    const issues = validateSlideSyntax(input);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unexpected-close');
    expect(issues[0]?.line).toBe(1);
  });

  it('detects unknown container names with warning', () => {
    const input = `::: sidebar
Invalid container
:::`;

    const issues = validateSlideSyntax(input);
    expect(issues.some((i) => i.code === 'unknown-container' && i.severity === 'warning')).toBe(
      true
    );
  });

  it('detects invalid ratio formats with warning', () => {
    const input = `::: columns ratio="invalid"
::: column
Content
:::
:::`;

    const issues = validateSlideSyntax(input);
    expect(issues.some((i) => i.code === 'invalid-ratio' && i.severity === 'warning')).toBe(true);
  });

  it('ignores ::: inside fenced code blocks', () => {
    const input = `Here is sample code:
\`\`\`markdown
::: columns
::: column
This should not trigger validation errors
\`\`\`
Regular text`;

    const issues = validateSlideSyntax(input);
    expect(issues).toHaveLength(0);
  });

  it('detects structured image error codes without leaking absolute paths', () => {
    const markdown = `# Slide With Bad Images
![Missing](non-existent-image.png)
![Escaping](../../../secret.png)
![Unsupported](document.pdf)
`;
    const issues = validateSlideSyntax(markdown, {
      sourceMarkdownPath: sampleMdPath,
      allowedRoots: [fixturesDir],
    });

    const notFound = issues.find((i) => i.code === 'image-not-found');
    expect(notFound).toBeDefined();
    expect(notFound?.message).toContain('non-existent-image.png');
    expect(notFound?.message).not.toContain(fixturesDir);

    const accessDenied = issues.find((i) => i.code === 'image-access-denied');
    expect(accessDenied).toBeDefined();
    expect(accessDenied?.message).toContain('secret.png');
    expect(accessDenied?.message).not.toContain(fixturesDir);

    const formatUnsupported = issues.find((i) => i.code === 'image-format-unsupported');
    expect(formatUnsupported).toBeDefined();
    expect(formatUnsupported?.message).toContain('document.pdf');
    expect(formatUnsupported?.message).not.toContain(fixturesDir);
  });

  it('ignores images inside fenced code blocks and inline code blocks', () => {
    const markdown = `# Slide
\`\`\`markdown
![Not An Image](non-existent-in-fence.png)
\`\`\`

Here is inline code: \`![Also Not Image](missing-inline.png)\`

And real valid image with title:
![Architecture](images/architecture.png "System Diagram")
`;
    const issues = validateSlideSyntax(markdown, {
      sourceMarkdownPath: sampleMdPath,
      allowedRoots: [fixturesDir],
    });

    const imageIssues = issues.filter((i) => i.code?.startsWith('image-'));
    expect(imageIssues).toHaveLength(0);
  });

  it('detects image-too-large for files exceeding 20MB limit', () => {
    const tempDir = path.join(fixturesDir, 'temp-large');
    fs.mkdirSync(tempDir, { recursive: true });
    const largeFilePath = path.join(tempDir, 'large.png');

    try {
      // 21MB スパースファイルを作成して検証
      const fd = fs.openSync(largeFilePath, 'w');
      fs.ftruncateSync(fd, 21 * 1024 * 1024);
      fs.closeSync(fd);

      const markdown = `# Large Image Test\n![Huge](./temp-large/large.png)\n`;
      const issues = validateSlideSyntax(markdown, {
        sourceMarkdownPath: sampleMdPath,
        allowedRoots: [fixturesDir],
      });

      const largeIssue = issues.find((i) => i.code === 'image-too-large');
      expect(largeIssue).toBeDefined();
      expect(largeIssue?.message).toContain('large.png');
      expect(largeIssue?.message).not.toContain(fixturesDir);
    } finally {
      if (fs.existsSync(largeFilePath)) {
        fs.unlinkSync(largeFilePath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    }
  });
});
