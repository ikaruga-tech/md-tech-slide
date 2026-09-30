import type { SlideDeck, Slide } from '../types/ir.js';
import { parseFrontmatter } from './frontmatter.js';
import { splitSlides } from './slide-splitter.js';
import { createSlideMarkdownIt } from './markdown-it-setup.js';
import { buildSlideFromTokens } from './slide-builder.js';

export function parseMarkdownToSlideDeck(markdown: string): SlideDeck {
  const { metadata, content } = parseFrontmatter(markdown);
  const slideTexts = splitSlides(content);
  const md = createSlideMarkdownIt();

  const slides: Slide[] = slideTexts.map((text, index) => {
    const tokens = md.parse(text, {});
    return buildSlideFromTokens(tokens, index);
  });

  return {
    metadata,
    slides,
  };
}

export * from './frontmatter.js';
export * from './slide-splitter.js';
export * from './markdown-it-setup.js';
export * from './slide-container-plugin.js';
export * from './inline-parser.js';
export * from './block-parser.js';
export * from './slide-builder.js';
export * from './slide-locator.js';
