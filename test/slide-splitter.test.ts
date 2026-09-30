import { describe, it, expect } from 'vitest';
import { splitSlides } from '../src/parser/slide-splitter.js';

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
