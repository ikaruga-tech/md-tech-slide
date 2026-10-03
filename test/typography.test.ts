import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  calculatePptxSizes,
  calculatePreviewSizes,
  getDeckTypography,
  isValidFontName,
  isValidFontSize,
  resolveTypography,
} from '../src/theme/typography.js';
import { CORPORATE_THEME, DEFAULT_THEME } from '../src/theme/presets.js';
import type { SlideDeck } from '../src/types/ir.js';

describe('Typography Validation & Normalization', () => {
  describe('isValidFontName', () => {
    it('accepts valid font names', () => {
      assert.strictEqual(isValidFontName('Segoe UI'), true);
      assert.strictEqual(isValidFontName('BIZ UDPGothic'), true);
      assert.strictEqual(isValidFontName('Yu Gothic'), true);
      assert.strictEqual(isValidFontName('Cascadia Code'), true);
      assert.strictEqual(isValidFontName('Noto-Sans'), true);
    });

    it('rejects empty or whitespace-only strings', () => {
      assert.strictEqual(isValidFontName(''), false);
      assert.strictEqual(isValidFontName('   '), false);
    });

    it('rejects non-string types', () => {
      assert.strictEqual(isValidFontName(123), false);
      assert.strictEqual(isValidFontName(null), false);
      assert.strictEqual(isValidFontName(undefined), false);
      assert.strictEqual(isValidFontName({}), false);
    });

    it('rejects strings longer than 128 characters', () => {
      const longName = 'A'.repeat(129);
      assert.strictEqual(isValidFontName(longName), false);
      assert.strictEqual(isValidFontName('A'.repeat(128)), true);
    });

    it('rejects control characters, newlines, and NUL', () => {
      assert.strictEqual(isValidFontName('Font\nName'), false);
      assert.strictEqual(isValidFontName('Font\rName'), false);
      assert.strictEqual(isValidFontName('Font\0Name'), false);
      assert.strictEqual(isValidFontName('Font\u0007Name'), false);
    });

    it('rejects HTML/CSS injection characters (<, >, {, }, ;)', () => {
      assert.strictEqual(isValidFontName('Arial</style><script>'), false);
      assert.strictEqual(isValidFontName('Arial; color: red'), false);
      assert.strictEqual(isValidFontName('Arial { font-size: 99px }'), false);
    });
  });

  describe('isValidFontSize', () => {
    it('accepts valid font sizes within 8-96 pt', () => {
      assert.strictEqual(isValidFontSize(8), true);
      assert.strictEqual(isValidFontSize(18), true);
      assert.strictEqual(isValidFontSize(96), true);
      assert.strictEqual(isValidFontSize(24.5), true);
    });

    it('rejects boundaries outside 8-96 pt', () => {
      assert.strictEqual(isValidFontSize(7.9), false);
      assert.strictEqual(isValidFontSize(96.1), false);
      assert.strictEqual(isValidFontSize(0), false);
      assert.strictEqual(isValidFontSize(-10), false);
    });

    it('rejects non-finite and non-number values', () => {
      assert.strictEqual(isValidFontSize(NaN), false);
      assert.strictEqual(isValidFontSize(Infinity), false);
      assert.strictEqual(isValidFontSize(-Infinity), false);
      assert.strictEqual(isValidFontSize('18'), false);
      assert.strictEqual(isValidFontSize(null), false);
      assert.strictEqual(isValidFontSize(undefined), false);
    });
  });

  describe('resolveTypography', () => {
    it('uses theme defaults when frontmatter is undefined', () => {
      const result = resolveTypography(undefined, DEFAULT_THEME);
      assert.strictEqual(result.fonts.heading, 'Segoe UI');
      assert.strictEqual(result.fonts.body, 'Segoe UI');
      assert.strictEqual(result.fonts.code, 'Consolas');
      assert.strictEqual(result.sizes.body, undefined);
      assert.strictEqual(result.sizes.heading, undefined);
      assert.strictEqual(result.sizes.legacyBase, undefined);
    });

    it('resolves simple format (font, codeFont)', () => {
      const fm = {
        font: 'BIZ UDPGothic',
        codeFont: 'Cascadia Code',
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.heading, 'BIZ UDPGothic');
      assert.strictEqual(result.fonts.body, 'BIZ UDPGothic');
      assert.strictEqual(result.fonts.code, 'Cascadia Code');
    });

    it('resolves detailed format (fonts.*, fontSize.*)', () => {
      const fm = {
        fonts: {
          heading: 'BIZ UDPGothic',
          body: 'Yu Gothic',
          code: 'Fira Code',
        },
        fontSize: {
          heading: 28,
          body: 18,
        },
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.heading, 'BIZ UDPGothic');
      assert.strictEqual(result.fonts.body, 'Yu Gothic');
      assert.strictEqual(result.fonts.code, 'Fira Code');
      assert.strictEqual(result.sizes.heading, 28);
      assert.strictEqual(result.sizes.body, 18);
      assert.strictEqual(result.sizes.legacyBase, undefined);
    });

    it('resolves legacy format (fontFamily, numeric fontSize)', () => {
      const fm = {
        fontFamily: 'Meiryo',
        fontSize: 20,
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.heading, 'Meiryo');
      assert.strictEqual(result.fonts.body, 'Meiryo');
      assert.strictEqual(result.fonts.code, 'Consolas'); // falls back to theme
      assert.strictEqual(result.sizes.body, undefined);
      assert.strictEqual(result.sizes.heading, undefined);
      assert.strictEqual(result.sizes.legacyBase, 20);
    });

    it('obeys priority: fonts.body > font > fontFamily > theme', () => {
      const fm = {
        fonts: { body: 'RoleFont' },
        font: 'SimpleFont',
        fontFamily: 'LegacyFont',
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.body, 'RoleFont');
      assert.strictEqual(result.fonts.heading, 'SimpleFont'); // font > fontFamily
    });

    it('obeys priority: fonts.code > codeFont > theme', () => {
      const fm = {
        fonts: { code: 'DetailedCode' },
        codeFont: 'SimpleCode',
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.code, 'DetailedCode');

      const fm2 = {
        codeFont: 'SimpleCode',
      };
      const result2 = resolveTypography(fm2, DEFAULT_THEME);
      assert.strictEqual(result2.fonts.code, 'SimpleCode');
    });

    it('supports partial override without modifying unspecified roles', () => {
      const fm = {
        fonts: { body: 'Yu Gothic' },
        fontSize: { body: 18 },
      };
      const result = resolveTypography(fm, CORPORATE_THEME);
      assert.strictEqual(result.fonts.body, 'Yu Gothic');
      assert.strictEqual(result.fonts.heading, 'Calibri'); // from corporate theme
      assert.strictEqual(result.fonts.code, 'Consolas'); // from corporate theme
      assert.strictEqual(result.sizes.body, 18);
      assert.strictEqual(result.sizes.heading, undefined);
    });

    it('safely falls back on invalid font and size inputs', () => {
      const fm = {
        font: 'Arial</style>', // invalid char
        codeFont: 12345, // invalid type
        fonts: {
          heading: '   ', // whitespace
          body: 'ValidBody',
        },
        fontSize: {
          heading: 999, // out of range
          body: 16,
        },
      };
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(result.fonts.heading, 'Segoe UI'); // theme default
      assert.strictEqual(result.fonts.body, 'ValidBody');
      assert.strictEqual(result.fonts.code, 'Consolas'); // theme default
      assert.strictEqual(result.sizes.heading, undefined); // fallback
      assert.strictEqual(result.sizes.body, 16);
    });

    it('does not mutate input objects or theme presets', () => {
      const fm = Object.freeze({
        fonts: Object.freeze({ body: 'Yu Gothic' }),
      });
      const themeSnapshot = JSON.stringify(DEFAULT_THEME);
      const result = resolveTypography(fm, DEFAULT_THEME);
      assert.strictEqual(JSON.stringify(DEFAULT_THEME), themeSnapshot);
      assert.strictEqual(result.fonts.body, 'Yu Gothic');
    });
  });

  describe('calculatePptxSizes', () => {
    it('returns exact existing defaults when no size is specified', () => {
      const sizes = calculatePptxSizes({});
      assert.strictEqual(sizes.titleSlideTitle, 36);
      assert.strictEqual(sizes.slideTitle, 26);
      assert.strictEqual(sizes.bodyHeadingLevel3, 19);
      assert.strictEqual(sizes.bodyHeadingOther, 17);
      assert.strictEqual(sizes.body, 15);
      assert.strictEqual(sizes.list, 15);
      assert.strictEqual(sizes.tableHeader, 13);
      assert.strictEqual(sizes.tableBody, 12);
      assert.strictEqual(sizes.code, 13);
      assert.strictEqual(sizes.footer, 10);
    });

    it('scales only body-related roles when body size is specified', () => {
      const sizes = calculatePptxSizes({ body: 30 }); // 30 / 15 = 2x scale
      // Heading roles remain untouched
      assert.strictEqual(sizes.titleSlideTitle, 36);
      assert.strictEqual(sizes.slideTitle, 26);
      assert.strictEqual(sizes.bodyHeadingLevel3, 19);
      assert.strictEqual(sizes.bodyHeadingOther, 17);

      // Body roles scaled 2x
      assert.strictEqual(sizes.body, 30);
      assert.strictEqual(sizes.list, 30);
      assert.strictEqual(sizes.tableHeader, 26);
      assert.strictEqual(sizes.tableBody, 24);
      assert.strictEqual(sizes.code, 26);
      assert.strictEqual(sizes.footer, 20);
    });

    it('scales only heading-related roles when heading size is specified', () => {
      const sizes = calculatePptxSizes({ heading: 52 }); // 52 / 26 = 2x scale
      // Heading roles scaled 2x
      assert.strictEqual(sizes.titleSlideTitle, 72);
      assert.strictEqual(sizes.slideTitle, 52);
      assert.strictEqual(sizes.bodyHeadingLevel3, 38);
      assert.strictEqual(sizes.bodyHeadingOther, 34);

      // Body roles remain untouched
      assert.strictEqual(sizes.body, 15);
      assert.strictEqual(sizes.list, 15);
      assert.strictEqual(sizes.tableHeader, 13);
      assert.strictEqual(sizes.tableBody, 12);
      assert.strictEqual(sizes.code, 13);
      assert.strictEqual(sizes.footer, 10);
    });

    it('scales all roles proportionally when legacyBase is specified', () => {
      const sizes = calculatePptxSizes({ legacyBase: 30 }); // 30 / 15 = 2x scale
      assert.strictEqual(sizes.titleSlideTitle, 72);
      assert.strictEqual(sizes.slideTitle, 52);
      assert.strictEqual(sizes.bodyHeadingLevel3, 38);
      assert.strictEqual(sizes.bodyHeadingOther, 34);
      assert.strictEqual(sizes.body, 30);
      assert.strictEqual(sizes.list, 30);
      assert.strictEqual(sizes.tableHeader, 26);
      assert.strictEqual(sizes.tableBody, 24);
      assert.strictEqual(sizes.code, 26);
      assert.strictEqual(sizes.footer, 20);
    });
  });

  describe('calculatePreviewSizes', () => {
    it('returns exact existing px defaults with unit="px" when unspecified', () => {
      const sizes = calculatePreviewSizes({});
      assert.strictEqual(sizes.unit, 'px');
      assert.strictEqual(sizes.titleSlideTitle, 36);
      assert.strictEqual(sizes.slideTitle, 24);
      assert.strictEqual(sizes.bodyHeading, 17);
      assert.strictEqual(sizes.body, 14);
      assert.strictEqual(sizes.list, 14);
      assert.strictEqual(sizes.table, 13);
      assert.strictEqual(sizes.code, 11.5);
      assert.strictEqual(sizes.footer, 11);
    });

    it('converts to pt and preserves unmentioned heading role when body is specified', () => {
      const sizes = calculatePreviewSizes({ body: 21 }); // 21 / 10.5 = 2x body scale
      assert.strictEqual(sizes.unit, 'pt');

      // Unmentioned heading roles remain at base pt (px * 0.75)
      assert.strictEqual(sizes.titleSlideTitle, 27); // 36 * 0.75
      assert.strictEqual(sizes.slideTitle, 18); // 24 * 0.75
      assert.strictEqual(sizes.bodyHeading, 12.75); // 17 * 0.75

      // Body roles scaled 2x
      assert.strictEqual(sizes.body, 21);
      assert.strictEqual(sizes.list, 21);
      assert.strictEqual(sizes.table, 19.5); // 9.75 * 2
      assert.strictEqual(sizes.code, 17.25); // 8.625 * 2
      assert.strictEqual(sizes.footer, 16.5); // 8.25 * 2
    });

    it('scales all roles proportionally when legacyBase is specified', () => {
      const sizes = calculatePreviewSizes({ legacyBase: 21 }); // 21 / 10.5 = 2x scale
      assert.strictEqual(sizes.unit, 'pt');
      assert.strictEqual(sizes.titleSlideTitle, 54); // 27 * 2
      assert.strictEqual(sizes.slideTitle, 36); // 18 * 2
      assert.strictEqual(sizes.bodyHeading, 25.5); // 12.75 * 2
      assert.strictEqual(sizes.body, 21);
      assert.strictEqual(sizes.list, 21);
      assert.strictEqual(sizes.table, 19.5);
      assert.strictEqual(sizes.code, 17.25);
      assert.strictEqual(sizes.footer, 16.5);
    });
  });

  describe('getDeckTypography', () => {
    it('uses existing deck.typography and sanitizes invalid values', () => {
      const deck: SlideDeck = {
        metadata: { theme: 'corporate' },
        slides: [],
        typography: {
          fonts: {
            body: 'CustomBody',
            heading: 'Bad<script>', // invalid
            code: 'CustomCode',
          },
          sizes: {
            body: 20,
            heading: 1000, // out of range
          },
        },
      };

      const result = getDeckTypography(deck);
      assert.strictEqual(result.fonts.body, 'CustomBody');
      assert.strictEqual(result.fonts.heading, 'Calibri'); // falls back to corporate theme!
      assert.strictEqual(result.fonts.code, 'CustomCode');
      assert.strictEqual(result.sizes.body, 20);
      assert.strictEqual(result.sizes.heading, undefined);
    });

    it('resolves theme from metadata when deck.typography is missing', () => {
      const deck: SlideDeck = {
        metadata: { theme: 'corporate' },
        slides: [],
      };

      const result = getDeckTypography(deck);
      assert.strictEqual(result.fonts.body, 'Calibri');
      assert.strictEqual(result.fonts.heading, 'Calibri');
      assert.strictEqual(result.fonts.code, 'Consolas');
      assert.deepStrictEqual(result.sizes, {});
    });

    it('falls back to default theme when deck has no theme and no typography', () => {
      const deck: SlideDeck = {
        metadata: {},
        slides: [],
      };

      const result = getDeckTypography(deck);
      assert.strictEqual(result.fonts.body, 'Segoe UI');
      assert.strictEqual(result.fonts.heading, 'Segoe UI');
      assert.strictEqual(result.fonts.code, 'Consolas');
      assert.deepStrictEqual(result.sizes, {});
    });
  });
});
