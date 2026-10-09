import { describe, it, expect } from 'vitest';
import { splitSlides, splitSlidesWithPositions } from '../src/parser/slide-splitter.js';

describe('splitSlides', () => {
  it('splits slides by 8 hashes', () => {
    const markdown = `# Slide 1
Content 1
########
## Slide 2
Content 2
########
### Slide 3`;

    const slides = splitSlides(markdown);
    expect(slides).toHaveLength(3);
    expect(slides[0]).toContain('# Slide 1');
    expect(slides[1]).toContain('## Slide 2');
    expect(slides[2]).toContain('### Slide 3');
  });

  it('ignores standard headings like 6 hashes or less', () => {
    const markdown = `###### Heading 6
Some content
########
Next slide`;

    const slides = splitSlides(markdown);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('###### Heading 6');
    expect(slides[1]).toContain('Next slide');
  });

  it('returns single slide when delimiter is not present', () => {
    const markdown = '# Single Slide';
    const slides = splitSlides(markdown);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toBe('# Single Slide');
  });
});

describe('splitSlidesWithPositions', () => {
  it('correctly tracks document line numbers with baseStartLine', () => {
    const markdown = `# Slide 1
Content 1
########
## Slide 2
Content 2`;

    const sections = splitSlidesWithPositions(markdown, 10);
    expect(sections).toHaveLength(2);
    expect(sections[0].startLine).toBe(10);
    expect(sections[0].content).toBe('# Slide 1\nContent 1');
    expect(sections[1].startLine).toBe(13); // line 10, 11: slide 1; line 12: ########; line 13: Slide 2
    expect(sections[1].content).toBe('## Slide 2\nContent 2');
  });

  it('handles CRLF line endings and leading empty lines in slides', () => {
    const markdown = '\r\n\r\n# Slide 1\r\n########\r\n\r\n## Slide 2\r\n';
    const sections = splitSlidesWithPositions(markdown, 0);
    expect(sections).toHaveLength(2);
    expect(sections[0].startLine).toBe(2);
    expect(sections[0].content).toBe('# Slide 1');
    expect(sections[1].startLine).toBe(5);
    expect(sections[1].content).toBe('## Slide 2');
  });

  it('handles consecutive delimiters without creating empty phantom sections', () => {
    const markdown = `# Slide 1
########
########
# Slide 2`;

    const sections = splitSlidesWithPositions(markdown, 0);
    expect(sections).toHaveLength(2);
    expect(sections[0].content).toBe('# Slide 1');
    expect(sections[0].startLine).toBe(0);
    expect(sections[1].content).toBe('# Slide 2');
    expect(sections[1].startLine).toBe(3);
  });

  it('returns single empty section if content is all whitespace', () => {
    const markdown = '   \n\n   ';
    const sections = splitSlidesWithPositions(markdown, 5);
    expect(sections).toHaveLength(1);
    expect(sections[0].content).toBe('');
    expect(sections[0].startLine).toBe(5);
  });
});
