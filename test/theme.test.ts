import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/theme/index.js';

describe('theme', () => {
  it('resolves default theme when empty or unspecified', () => {
    const themeDefault = resolveTheme();
    expect(themeDefault.name).toBe('default');
    expect(themeDefault.colors.background).toBe('FFFFFF');
  });

  it('resolves corporate and dark presets', () => {
    const corporate = resolveTheme('corporate');
    expect(corporate.name).toBe('corporate');
    expect(corporate.fonts.heading).toBe('Calibri');

    const dark = resolveTheme('dark');
    expect(dark.name).toBe('dark');
    expect(dark.colors.background).toBe('0F172A');
  });

  it('throws error on unknown theme name', () => {
    expect(() => resolveTheme('neon-cyberpunk')).toThrow('Unknown theme "neon-cyberpunk"');
  });
});
