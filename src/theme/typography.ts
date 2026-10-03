import type {
  PptxRoleSizes,
  PreviewRoleSizes,
  SlideDeck,
  TypographyFonts,
  TypographySettings,
  TypographySizes,
} from '../types/ir.js';
import { DEFAULT_THEME, THEME_PRESETS } from './presets.js';
import type { SlideTheme } from './types.js';

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 96;
export const MAX_FONT_NAME_LENGTH = 128;

const INVALID_FONT_NAME_CHARS = /[<>{};]/;

function hasControlOrLinebreak(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether the given value is a safe, valid font name string.
 */
export function isValidFontName(val: unknown): val is string {
  if (typeof val !== 'string') {
    return false;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FONT_NAME_LENGTH) {
    return false;
  }
  if (hasControlOrLinebreak(trimmed)) {
    return false;
  }
  if (INVALID_FONT_NAME_CHARS.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Checks whether the given value is a valid font size in points (8-96pt).
 */
export function isValidFontSize(val: unknown): val is number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return false;
  }
  return val >= MIN_FONT_SIZE && val <= MAX_FONT_SIZE;
}

/**
 * Normalizes typography settings from Frontmatter, applied theme, and default fallbacks.
 */
export function resolveTypography(
  frontmatter: Record<string, unknown> | undefined,
  theme: SlideTheme
): TypographySettings {
  const fmFonts =
    frontmatter && typeof frontmatter['fonts'] === 'object' && frontmatter['fonts'] !== null
      ? (frontmatter['fonts'] as Record<string, unknown>)
      : undefined;

  const fmSizes =
    frontmatter && typeof frontmatter['fontSize'] === 'object' && frontmatter['fontSize'] !== null
      ? (frontmatter['fontSize'] as Record<string, unknown>)
      : undefined;

  // 1. Resolve body font
  let bodyFont = theme.fonts.body;
  if (fmFonts && isValidFontName(fmFonts['body'])) {
    bodyFont = fmFonts['body'].trim();
  } else if (isValidFontName(frontmatter?.['font'])) {
    bodyFont = (frontmatter!['font'] as string).trim();
  } else if (isValidFontName(frontmatter?.['fontFamily'])) {
    bodyFont = (frontmatter!['fontFamily'] as string).trim();
  }

  // 2. Resolve heading font
  let headingFont = theme.fonts.heading;
  if (fmFonts && isValidFontName(fmFonts['heading'])) {
    headingFont = fmFonts['heading'].trim();
  } else if (isValidFontName(frontmatter?.['font'])) {
    headingFont = (frontmatter!['font'] as string).trim();
  } else if (isValidFontName(frontmatter?.['fontFamily'])) {
    headingFont = (frontmatter!['fontFamily'] as string).trim();
  }

  // 3. Resolve code font
  let codeFont = theme.fonts.code;
  if (fmFonts && isValidFontName(fmFonts['code'])) {
    codeFont = fmFonts['code'].trim();
  } else if (isValidFontName(frontmatter?.['codeFont'])) {
    codeFont = (frontmatter!['codeFont'] as string).trim();
  }

  // 4. Resolve font sizes
  let bodySize: number | undefined;
  let headingSize: number | undefined;
  let legacyBase: number | undefined;

  if (fmSizes) {
    if (isValidFontSize(fmSizes['body'])) {
      bodySize = fmSizes['body'];
    }
    if (isValidFontSize(fmSizes['heading'])) {
      headingSize = fmSizes['heading'];
    }
  } else if (isValidFontSize(frontmatter?.['fontSize'])) {
    legacyBase = frontmatter!['fontSize'] as number;
  }

  const fonts: TypographyFonts = {
    body: bodyFont,
    heading: headingFont,
    code: codeFont,
  };

  const sizes: TypographySizes = {
    ...(bodySize !== undefined ? { body: bodySize } : {}),
    ...(headingSize !== undefined ? { heading: headingSize } : {}),
    ...(legacyBase !== undefined ? { legacyBase } : {}),
  };

  return { fonts, sizes };
}

/**
 * Calculates PPTX role sizes in pt.
 * Unspecified roles maintain exact existing defaults (no regression).
 */
export function calculatePptxSizes(sizes: TypographySizes): PptxRoleSizes {
  const BASE_TITLE_SLIDE = 36;
  const BASE_SLIDE_TITLE = 26;
  const BASE_HEADING_L3 = 19;
  const BASE_HEADING_OTHER = 17;
  const BASE_BODY = 15;
  const BASE_LIST = 15;
  const BASE_TABLE_HEADER = 13;
  const BASE_TABLE_BODY = 12;
  const BASE_CODE = 13;
  const BASE_FOOTER = 10;

  if (sizes.legacyBase !== undefined) {
    const scale = sizes.legacyBase / BASE_BODY;
    return {
      titleSlideTitle: BASE_TITLE_SLIDE * scale,
      slideTitle: BASE_SLIDE_TITLE * scale,
      bodyHeadingLevel3: BASE_HEADING_L3 * scale,
      bodyHeadingOther: BASE_HEADING_OTHER * scale,
      body: BASE_BODY * scale,
      list: BASE_LIST * scale,
      tableHeader: BASE_TABLE_HEADER * scale,
      tableBody: BASE_TABLE_BODY * scale,
      code: BASE_CODE * scale,
      footer: BASE_FOOTER * scale,
    };
  }

  const bodyScale = sizes.body !== undefined ? sizes.body / BASE_BODY : 1;
  const headingScale = sizes.heading !== undefined ? sizes.heading / BASE_SLIDE_TITLE : 1;

  return {
    titleSlideTitle: BASE_TITLE_SLIDE * headingScale,
    slideTitle: BASE_SLIDE_TITLE * headingScale,
    bodyHeadingLevel3: BASE_HEADING_L3 * headingScale,
    bodyHeadingOther: BASE_HEADING_OTHER * headingScale,
    body: BASE_BODY * bodyScale,
    list: BASE_LIST * bodyScale,
    tableHeader: BASE_TABLE_HEADER * bodyScale,
    tableBody: BASE_TABLE_BODY * bodyScale,
    code: BASE_CODE * bodyScale,
    footer: BASE_FOOTER * bodyScale,
  };
}

/**
 * Calculates Preview role sizes.
 * If no size is specified, returns exact existing px defaults.
 * If any size is specified, converts all roles to pt (0.75 ratio) and applies scaling.
 */
export function calculatePreviewSizes(sizes: TypographySizes): PreviewRoleSizes {
  // 1. Completely unspecified: return existing exact px values
  if (sizes.body === undefined && sizes.heading === undefined && sizes.legacyBase === undefined) {
    return {
      titleSlideTitle: 36,
      slideTitle: 24,
      bodyHeading: 17,
      body: 14,
      list: 14,
      table: 13,
      code: 11.5,
      footer: 11,
      unit: 'px',
    };
  }

  // 2. Either body, heading, or legacyBase is specified: unify to pt (px * 0.75)
  const BASE_PT_TITLE_SLIDE = 36 * 0.75; // 27
  const BASE_PT_SLIDE_TITLE = 24 * 0.75; // 18
  const BASE_PT_BODY_HEADING = 17 * 0.75; // 12.75
  const BASE_PT_BODY = 14 * 0.75; // 10.5
  const BASE_PT_LIST = 14 * 0.75; // 10.5
  const BASE_PT_TABLE = 13 * 0.75; // 9.75
  const BASE_PT_CODE = 11.5 * 0.75; // 8.625
  const BASE_PT_FOOTER = 11 * 0.75; // 8.25

  if (sizes.legacyBase !== undefined) {
    const scale = sizes.legacyBase / BASE_PT_BODY;
    return {
      titleSlideTitle: BASE_PT_TITLE_SLIDE * scale,
      slideTitle: BASE_PT_SLIDE_TITLE * scale,
      bodyHeading: BASE_PT_BODY_HEADING * scale,
      body: BASE_PT_BODY * scale,
      list: BASE_PT_LIST * scale,
      table: BASE_PT_TABLE * scale,
      code: BASE_PT_CODE * scale,
      footer: BASE_PT_FOOTER * scale,
      unit: 'pt',
    };
  }

  const bodyScale = sizes.body !== undefined ? sizes.body / BASE_PT_BODY : 1;
  const headingScale = sizes.heading !== undefined ? sizes.heading / BASE_PT_SLIDE_TITLE : 1;

  return {
    titleSlideTitle: BASE_PT_TITLE_SLIDE * headingScale,
    slideTitle: BASE_PT_SLIDE_TITLE * headingScale,
    bodyHeading: BASE_PT_BODY_HEADING * headingScale,
    body: BASE_PT_BODY * bodyScale,
    list: BASE_PT_LIST * bodyScale,
    table: BASE_PT_TABLE * bodyScale,
    code: BASE_PT_CODE * bodyScale,
    footer: BASE_PT_FOOTER * bodyScale,
    unit: 'pt',
  };
}

/**
 * Safely resolves TypographySettings from a SlideDeck, ensuring valid values
 * even for hand-crafted test decks.
 */
export function getDeckTypography(deck?: SlideDeck): TypographySettings {
  if (deck?.typography) {
    const raw = deck.typography;
    const themeName =
      typeof deck.metadata?.theme === 'string' ? deck.metadata.theme.trim().toLowerCase() : '';
    const theme = THEME_PRESETS[themeName] ?? DEFAULT_THEME;

    const bodyFont = isValidFontName(raw.fonts?.body) ? raw.fonts.body.trim() : theme.fonts.body;
    const headingFont = isValidFontName(raw.fonts?.heading)
      ? raw.fonts.heading.trim()
      : theme.fonts.heading;
    const codeFont = isValidFontName(raw.fonts?.code) ? raw.fonts.code.trim() : theme.fonts.code;

    const bodySize = isValidFontSize(raw.sizes?.body) ? raw.sizes.body : undefined;
    const headingSize = isValidFontSize(raw.sizes?.heading) ? raw.sizes.heading : undefined;
    const legacyBase = isValidFontSize(raw.sizes?.legacyBase) ? raw.sizes.legacyBase : undefined;

    return {
      fonts: {
        body: bodyFont,
        heading: headingFont,
        code: codeFont,
      },
      sizes: {
        ...(bodySize !== undefined ? { body: bodySize } : {}),
        ...(headingSize !== undefined ? { heading: headingSize } : {}),
        ...(legacyBase !== undefined ? { legacyBase } : {}),
      },
    };
  }

  // No typography property on deck: resolve theme from metadata
  const themeName =
    typeof deck?.metadata?.theme === 'string' ? deck.metadata.theme.trim().toLowerCase() : '';
  const theme = THEME_PRESETS[themeName] ?? DEFAULT_THEME;

  return {
    fonts: {
      body: theme.fonts.body,
      heading: theme.fonts.heading,
      code: theme.fonts.code,
    },
    sizes: {},
  };
}
