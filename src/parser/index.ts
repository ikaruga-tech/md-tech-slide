import type { SlideDeck, Slide } from '../types/ir.js';
import { parseFrontmatter } from './frontmatter.js';
import { splitSlidesWithPositions } from './slide-splitter.js';
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
  const { metadata, content, contentStartLine } = parseFrontmatter(markdown);
  const slideSections = splitSlidesWithPositions(content, contentStartLine);
  const md = createSlideMarkdownIt();

  const slides: Slide[] = slideSections.map((section, index) => {
    const tokens = md.parse(section.content, {});
    return buildSlideFromTokens(tokens, index, section.startLine);
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
