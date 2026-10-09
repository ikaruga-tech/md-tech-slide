import { describe, it, expect } from 'vitest';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { renderDeckToHtml } from '../src/renderer/index.js';
import type { ResolvedDiagramBlock } from '../src/types/ir.js';

describe('webview-security', () => {
  it('renders HTML with strict CSP and matching nonces when provided', () => {
    const markdown = `---
title: "Security Test"
---

# Slide 1

This is a test.
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const nonce = 'test-nonce-12345';
    const cspSource = 'vscode-webview:';

    const html = renderDeckToHtml(deck, {
      nonce,
      cspSource,
      scriptContent: 'console.log("hello");',
    });

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(`style-src ${cspSource} 'nonce-${nonce}';`);
    expect(html).toContain(`script-src ${cspSource} 'nonce-${nonce}';`);
    expect(html).toContain(`img-src ${cspSource} data:;`);
    expect(html).not.toContain('https:');

    // All <style> and <script> tags must have nonce
    const styleMatches = html.match(/<style[^>]*>/g) || [];
    for (const tag of styleMatches) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }

    const scriptMatches = html.match(/<script[^>]*>/g) || [];
    for (const tag of scriptMatches) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  it('guarantees that no inline style="..." attribute exists in rendered HTML even with column ratios', () => {
    const markdown = `---
title: "Columns Test"
---

# Multi Column Slide

::: columns ratio="2:1"
::: column
Left content
:::
::: column
Right content
:::
:::
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const html = renderDeckToHtml(deck);

    // Verify there is ZERO style="..." attribute in any HTML element
    const inlineStyleRegex = /<[a-zA-Z0-9-]+\s+[^>]*\bstyle\s*=\s*["'][^"']*["'][^>]*>/gi;
    const matches = html.match(inlineStyleRegex);
    expect(matches).toBeNull();

    // Verify class-based styling was generated instead
    expect(html).toContain('cols-ratio-2-1');
  });

  it('sanitizes and blocks unsafe link schemes such as javascript: and file:', () => {
    const markdown = `---
title: "Link Test"
---

# Links

- [Safe Web](https://example.com)
- [Safe Mail](mailto:test@example.com)
- [Unsafe JS](javascript:alert(1))
- [Unsafe File](file:///etc/passwd)
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const html = renderDeckToHtml(deck);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('file:///etc/passwd');
    expect(html).toContain('Unsafe JS');
    expect(html).toContain('Unsafe File');
  });

  it('rejects CSS injection attempts via column ratio and falls back to default columns', () => {
    const maliciousRatios = [
      '1;}.slide-card{display:none}/*:1',
      '1fr:1',
      '1px:1',
      '-1:2',
      '0:1',
      'NaN:1',
      'Infinity:1',
      '1e3:1',
      '<script>:1',
      '1:2:3', // mismatch with 2 columns
      '2', // single segment
    ];

    for (const ratio of maliciousRatios) {
      const markdown = `---
title: "Injection Test"
---

# Malicious Ratio Test

::: columns ratio="${ratio}"
::: column
Left
:::
::: column
Right
:::
:::
`;
      const deck = parseMarkdownToSlideDeck(markdown);
      const html = renderDeckToHtml(deck);

      // Verify that malicious payload NEVER appears in generated CSS
      expect(html).not.toContain('display:none');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('1frfr');
      expect(html).not.toContain('1pxfr');
      expect(html).not.toContain('-1fr');

      // Verify safe fallback to default column grid
      expect(html).toContain('cols-count-2');
      expect(html).toContain(
        '.columns-container.cols-count-2 { grid-template-columns: repeat(2, 1fr); }'
      );
    }
  });

  it('injects dynamic SHA-256 style hashes into CSP for resolved Diagram SVG styles', async () => {
    const crypto = await import('node:crypto');
    const markdown = `# Diagram Slide

\`\`\`mermaid
graph TD; A-->B;
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const styleContent = '.node { fill: #fff; }';
    const expectedHash = crypto.createHash('sha256').update(styleContent, 'utf8').digest('base64');

    const body = deck.slides[0]!.slots.body;
    if (body.type === 'single') {
      const diagramEl: ResolvedDiagramBlock = {
        type: 'diagram',
        kind: 'mermaid',
        source: 'graph TD; A-->B;',
        startLine: 2,
        configId: 'default',
        hash: 'abc',
        status: 'success',
        svg: `<svg xmlns="http://www.w3.org/2000/svg"><style>${styleContent}</style><g/></svg>`,
      };
      deck.slides[0]!.slots.body = {
        type: 'single',
        elements: [diagramEl],
      };
    }

    const nonce = 'security-nonce-xyz';
    const cspSource = 'vscode-webview:';
    const html = renderDeckToHtml(deck, { nonce, cspSource });

    expect(html).toContain(`'sha256-${expectedHash}'`);
    expect(html).toContain(`style-src ${cspSource} 'nonce-${nonce}' 'sha256-${expectedHash}';`);
    expect(html).toContain('<div class="slide-diagram"><svg');
  });

  it('renders accessible error card when diagram rendering fails', () => {
    const markdown = `# Error Slide

\`\`\`mermaid
graph TD; A-->B;
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const body = deck.slides[0]!.slots.body;
    if (body.type === 'single') {
      const diagramEl: ResolvedDiagramBlock = {
        type: 'diagram',
        kind: 'mermaid',
        source: 'graph TD; A-->B;',
        startLine: 2,
        configId: 'default',
        hash: 'abc',
        status: 'error',
        errorCode: 'mermaid-invalid-syntax',
        errorMessage: 'Invalid syntax at line 1',
      };
      deck.slides[0]!.slots.body = {
        type: 'single',
        elements: [diagramEl],
      };
    }

    const html = renderDeckToHtml(deck);
    expect(html).toContain('class="slide-diagram-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('mermaid-invalid-syntax');
    expect(html).toContain('Invalid syntax at line 1');
  });
});
