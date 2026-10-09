import { describe, it, expect } from 'vitest';
import { parseMarkdownToSlideDeck } from '../src/index.js';
import type { DiagramBlock } from '../src/types/ir.js';

describe('Mermaid Parser Integration', () => {
  it('parses mermaid fenced code block as pending DiagramBlock', () => {
    const markdown = `# Slide 1

\`\`\`mermaid
graph TD;
    A-->B;
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    expect(deck.slides).toHaveLength(1);
    const body = deck.slides[0]!.slots.body;
    expect(body.type).toBe('single');
    if (body.type === 'single') {
      const diagram = body.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(diagram).toBeDefined();
      expect(diagram?.kind).toBe('mermaid');
      expect(diagram?.status).toBe('pending');
      expect(diagram?.source.trim()).toBe('graph TD;\n    A-->B;');
      expect(diagram?.startLine).toBe(2); // line 0: # Slide 1, line 1: empty, line 2: ```mermaid
    }
  });

  it('handles case-insensitive info string and extra tokens', () => {
    const markdown = `# Slide 1

\`\`\`MERMAID
sequenceDiagram
    Alice->>Bob: Hello
\`\`\`

########

# Slide 2

\`\`\`Mermaid extra-option="ignore"
classDiagram
    Class01 <|-- AveryLongClass
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    expect(deck.slides).toHaveLength(2);

    // Slide 1
    const body1 = deck.slides[0]!.slots.body;
    if (body1.type === 'single') {
      const d1 = body1.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(d1).toBeDefined();
      expect(d1?.status).toBe('pending');
      expect(d1?.source).toContain('sequenceDiagram');
    }

    // Slide 2
    const body2 = deck.slides[1]!.slots.body;
    if (body2.type === 'single') {
      const d2 = body2.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(d2).toBeDefined();
      expect(d2?.status).toBe('pending');
      expect(d2?.source).toContain('classDiagram');
    }
  });

  it('keeps non-mermaid code blocks as normal CodeBlock elements', () => {
    const markdown = `# Slide 1

\`\`\`typescript
const x: number = 42;
\`\`\`

\`\`\`
plain text
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const body = deck.slides[0]!.slots.body;
    if (body.type === 'single') {
      const diagrams = body.elements.filter((el) => el.type === 'diagram');
      const codes = body.elements.filter((el) => el.type === 'code');
      expect(diagrams).toHaveLength(0);
      expect(codes).toHaveLength(2);
    }
  });

  it('flags empty mermaid source with mermaid-empty-source error status', () => {
    const markdown = `# Slide 1

\`\`\`mermaid
   
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const body = deck.slides[0]!.slots.body;
    if (body.type === 'single') {
      const diagram = body.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(diagram).toBeDefined();
      expect(diagram?.status).toBe('error');
      if (diagram?.status === 'error') {
        expect(diagram.errorCode).toBe('mermaid-empty-source');
      }
    }
  });

  it('accurately calculates document-level startLine with frontmatter and multiple slides', () => {
    const markdown = `---
title: Test Presentation
theme: corporate
---

# Slide 1

Intro text

########

# Slide 2

Line before fence

\`\`\`mermaid
graph LR
    A --> B
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    expect(deck.slides).toHaveLength(2);
    const body2 = deck.slides[1]!.slots.body;
    if (body2.type === 'single') {
      const diagram = body2.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(diagram).toBeDefined();
      // Line count breakdown:
      // 0: ---
      // 1: title: ...
      // 2: theme: ...
      // 3: ---
      // 4: (empty)
      // 5: # Slide 1
      // 6: (empty)
      // 7: Intro text
      // 8: (empty)
      // 9: ########
      // 10: (empty)
      // 11: # Slide 2
      // 12: (empty)
      // 13: Line before fence
      // 14: (empty)
      // 15: ```mermaid
      expect(diagram?.startLine).toBe(15);
    }
  });

  it('parses diagram blocks within column layouts', () => {
    const markdown = `# Slide 1

::: columns
::: column
Left text
:::
::: column
\`\`\`mermaid
flowchart TD
    Start --> Stop
\`\`\`
:::
:::
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    const body = deck.slides[0]!.slots.body;
    expect(body.type).toBe('columns');
    if (body.type === 'columns') {
      expect(body.columns).toHaveLength(2);
      const rightCol = body.columns[1]!;
      const diagram = rightCol.elements.find((el): el is DiagramBlock => el.type === 'diagram');
      expect(diagram).toBeDefined();
      expect(diagram?.status).toBe('pending');
      expect(diagram?.source).toContain('flowchart TD');
    }
  });
});
