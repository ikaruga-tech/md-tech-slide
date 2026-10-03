import type { SlideTheme } from './types.js';
import { THEME_PRESETS, DEFAULT_THEME } from './presets.js';

export function resolveTheme(themeName?: string): SlideTheme {
  if (!themeName || themeName.trim() === '') {
    return DEFAULT_THEME;
  }

  const normalized = themeName.trim().toLowerCase();
  const found = THEME_PRESETS[normalized];
  if (!found) {
    const available = Object.keys(THEME_PRESETS).join(', ');
    throw new Error(`Unknown theme "${themeName}". Available themes: ${available}`);
  }

  return found;
}

export * from './types.js';
export * from './presets.js';
export * from './typography.js';
