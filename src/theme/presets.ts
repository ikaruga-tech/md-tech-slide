import type { SlideTheme } from './types.js';

export const DEFAULT_THEME: SlideTheme = {
  name: 'default',
  colors: {
    background: 'FFFFFF',
    title: '1E293B',
    text: '334155',
    muted: '64748B',
    codeBackground: '1E293B',
    codeText: 'F8FAFC',
    accent: '2563EB',
  },
  fonts: {
    heading: 'Segoe UI',
    body: 'Segoe UI',
    code: 'Consolas',
  },
  shikiTheme: 'github-dark',
};

export const CORPORATE_THEME: SlideTheme = {
  name: 'corporate',
  colors: {
    background: 'F8FAFC',
    title: '0F172A',
    text: '1E293B',
    muted: '475569',
    codeBackground: '1E293B',
    codeText: 'F8FAFC',
    accent: '0369A1',
  },
  fonts: {
    heading: 'Calibri',
    body: 'Calibri',
    code: 'Consolas',
  },
  shikiTheme: 'github-dark',
};

export const DARK_THEME: SlideTheme = {
  name: 'dark',
  colors: {
    background: '0F172A',
    title: 'F8FAFC',
    text: 'E2E8F0',
    muted: '94A3B8',
    codeBackground: '0B0F19',
    codeText: 'F8FAFC',
    accent: '38BDF8',
  },
  fonts: {
    heading: 'Segoe UI',
    body: 'Segoe UI',
    code: 'Consolas',
  },
  shikiTheme: 'github-dark',
};

export const THEME_PRESETS: Readonly<Record<string, SlideTheme>> = {
  default: DEFAULT_THEME,
  corporate: CORPORATE_THEME,
  dark: DARK_THEME,
};
