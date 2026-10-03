import type { SlideDeck, Slide } from '../types/ir.js';
import { parseFrontmatter } from './frontmatter.js';
import { splitSlides } from './slide-splitter.js';
import { createSlideMarkdownIt } from './markdown-it-setup.js';
import { buildSlideFromTokens } from './slide-builder.js';
import { resolveTheme } from '../theme/index.js';
import { resolveTypography } from '../theme/typography.js';

export interface ParseDeckDefaults {
  readonly defaultTheme?: string;
  readonly defaultAspectRatio?: '16:9' | '4:3' | string;
}

export function parseMarkdownToSlideDeck(
  markdown: string,
  defaults?: ParseDeckDefaults
): SlideDeck {
  const { metadata, content } = parseFrontmatter(markdown);
  const slideTexts = splitSlides(content);
  const md = createSlideMarkdownIt();

  const slides: Slide[] = slideTexts.map((text, index) => {
    const tokens = md.parse(text, {});
    return buildSlideFromTokens(tokens, index);
  });

  const rawRatio = metadata.aspectRatio ?? defaults?.defaultAspectRatio;
  const validAspectRatio: '16:9' | '4:3' | undefined =
    rawRatio === '4:3' ? '4:3' : rawRatio === '16:9' ? '16:9' : undefined;

  const resolvedMetadata = {
    ...metadata,
    theme: metadata.theme ?? defaults?.defaultTheme,
    aspectRatio: validAspectRatio,
  };

  let theme;
  try {
    theme = resolveTheme(resolvedMetadata.theme);
  } catch {
    theme = resolveTheme();
  }
  const typography = resolveTypography(metadata as Record<string, unknown>, theme);

  return {
    metadata: resolvedMetadata,
    slides,
    typography,
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
export * from './frontmatter-validator.js';
