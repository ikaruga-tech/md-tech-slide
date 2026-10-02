import { describe, it, expect } from 'vitest';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { analyzeLayoutOverflow } from '../src/layout/index.js';
import { validateSlideSyntax } from '../src/validator/index.js';
import { generatePresentationWithDiagnostics } from '../src/generator/index.js';

describe('layout-overflow diagnostics', () => {
  it('detects content overflow on a slide with too many elements', () => {
    // 多数のコードブロックと段落で高さを超過させる
    const markdown = `---
title: "Overflow Slide Deck"
---

# Normal Slide

This slide fits easily.

########

# Massive Overflow Slide

Paragraph 1 line text.

\`\`\`typescript
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
const f = 6;
const g = 7;
const h = 8;
const i = 9;
const j = 10;
\`\`\`

\`\`\`typescript
const k = 11;
const l = 12;
const m = 13;
const n = 14;
const o = 15;
const p = 16;
const q = 17;
const r = 18;
const s = 19;
const t = 20;
\`\`\`

Another long explanatory paragraph that occupies considerable vertical space.
Even more text here to guarantee the height comfortably exceeds the 4.8in body limit.
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const overflowIssues = analyzeLayoutOverflow(deck);

    expect(overflowIssues.length).toBeGreaterThanOrEqual(1);
    const issue = overflowIssues[0];
    expect(issue?.slideIndex).toBe(1); // 0-based index for 2nd slide
    expect(issue?.overflowAmount).toBeGreaterThan(0);
    expect(issue?.totalHeight).toBeGreaterThan(issue!.availableHeight);
    expect(issue?.message).toContain('Slide 2');
  });

  it('detects overflow inside a multi-column container', () => {
    const markdown = `---
title: "Column Overflow"
---

# Multi-column Slide

::: columns
::: column
Normal left column text.
:::
::: column
\`\`\`typescript
line1
line2
line3
line4
line5
line6
line7
line8
line9
line10
line11
line12
line13
line14
line15
line16
line17
line18
line19
line20
line21
line22
\`\`\`
Extra paragraph in right column.
:::
:::
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const overflowIssues = analyzeLayoutOverflow(deck);

    expect(overflowIssues.length).toBeGreaterThanOrEqual(1);
    const colIssue = overflowIssues.find((i) => i.columnId);
    expect(colIssue).toBeDefined();
    expect(colIssue?.slideIndex).toBe(0);
    expect(colIssue?.overflowAmount).toBeGreaterThan(0);
  });

  it('integrates overflow warnings into validateSlideSyntax', () => {
    const markdown = `---
title: "Syntax Integration"
---

# Slide 1

\`\`\`typescript
${Array.from({ length: 25 }, (_, i) => `console.log(${i});`).join('\n')}
\`\`\`
`;

    const issues = validateSlideSyntax(markdown);
    const overflowIssue = issues.find((i) => i.code === 'layout-overflow');
    expect(overflowIssue).toBeDefined();
    expect(overflowIssue?.severity).toBe('warning');
    expect(overflowIssue?.line).toBeGreaterThanOrEqual(0);
  });

  it('returns both pptx and diagnostics from generatePresentationWithDiagnostics', async () => {
    const markdown = `---
title: "Generator Diagnostics"
---

# Slide 1

Short text.
`;

    const deck = parseMarkdownToSlideDeck(markdown);
    const result = await generatePresentationWithDiagnostics(deck);
    expect(result.pptx).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(result.diagnostics.length).toBe(0);
  });
});
