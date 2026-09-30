import { describe, it, expect } from 'vitest';
import { validateSlideSyntax } from '../src/validator/index.js';

describe('validateSlideSyntax', () => {
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
    expect(issues.some((i) => i.code === 'unclosed-container' && i.message.includes('column'))).toBe(true);
    expect(issues.some((i) => i.code === 'unclosed-container' && i.message.includes('columns'))).toBe(true);
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
    expect(issues.some((i) => i.code === 'unknown-container' && i.severity === 'warning')).toBe(true);
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
});
