import type { SlideTheme } from '../theme/types.js';

export function generatePreviewCss(theme: SlideTheme, aspectRatio: '16:9' | '4:3'): string {
  const aspectValue = aspectRatio === '4:3' ? '4 / 3' : '16 / 9';

  return `
:root {
  --bg-color: #${theme.colors.background};
  --title-color: #${theme.colors.title};
  --text-color: #${theme.colors.text};
  --muted-color: #${theme.colors.muted};
  --code-bg: #${theme.colors.codeBackground};
  --code-text: #${theme.colors.codeText};
  --code-border: ${theme.name === 'dark' ? '#334155' : '#334155'};
  --inline-code-bg: ${theme.name === 'dark' ? '#334155' : '#E2E8F0'};
  --inline-code-text: ${theme.name === 'dark' ? '#38BDF8' : '#0F172A'};
  --inline-code-border: ${theme.name === 'dark' ? '#475569' : '#CBD5E1'};
  --accent-color: #${theme.colors.accent};
  --font-heading: "${theme.fonts.heading}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-body: "${theme.fonts.body}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-code: "${theme.fonts.code}", Consolas, Menlo, Monaco, "Courier New", monospace;
  --slide-aspect: ${aspectValue};
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 24px;
  background-color: var(--vscode-editor-background, #1e1e1e);
  color: var(--text-color);
  font-family: var(--font-body);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

.slide-container {
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slide-card {
  width: 100%;
  aspect-ratio: var(--slide-aspect);
  background-color: var(--bg-color);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 30px 42px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  border: 2px solid transparent;
}

.slide-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.slide-card.active {
  border-color: var(--accent-color);
}

.slide-header {
  flex-shrink: 0;
  margin-bottom: 14px;
}

.slide-title {
  margin: 0;
  color: var(--title-color);
  font-family: var(--font-heading);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
}

.slide-card.title-slide {
  justify-content: center;
  align-items: center;
  text-align: center;
}

.slide-card.title-slide .slide-title {
  font-size: 36px;
  margin-bottom: 16px;
}

.slide-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.columns-container {
  display: grid;
  gap: 20px;
  height: 100%;
  align-items: stretch;
}

.column-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: hidden;
  justify-content: flex-start;
}

h3 {
  margin: 0;
  color: var(--title-color);
  font-family: var(--font-heading);
  font-size: 17px;
  font-weight: 600;
}

p {
  margin: 0;
  line-height: 1.45;
  font-size: 14px;
}

ul, ol {
  margin: 0;
  padding-left: 20px;
}

li {
  margin-bottom: 3px;
  font-size: 14px;
  line-height: 1.4;
}

li > ul, li > ol {
  margin-top: 3px;
}

pre.code-block {
  margin: 0;
  background-color: var(--code-bg) !important;
  color: var(--code-text) !important;
  border: 1px solid var(--code-border);
  border-radius: 8px;
  padding: 10px 14px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: var(--font-code);
  font-size: 11.5px;
  line-height: 1.4;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  max-width: 100%;
}

pre.code-block code {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: inherit !important;
  background: transparent !important;
  padding: 0 !important;
  border: none !important;
}

/* シンタックスハイライト（高コントラスト＆モダン配色） */
.hl-comment {
  color: #94A3B8 !important;
  font-style: italic;
}
.hl-keyword {
  color: #F472B6 !important;
  font-weight: 600;
}
.hl-string {
  color: #34D399 !important;
}
.hl-decorator {
  color: #FBBF24 !important;
  font-weight: 600;
}
.hl-type {
  color: #38BDF8 !important;
  font-weight: 500;
}
.hl-number {
  color: #FB923C !important;
}

code.inline-code {
  background-color: var(--inline-code-bg) !important;
  color: var(--inline-code-text) !important;
  border: 1px solid var(--inline-code-border);
  padding: 2px 7px;
  border-radius: 4px;
  font-family: var(--font-code);
  font-size: 0.88em;
  font-weight: 500;
}

img.slide-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 4px;
}

.slide-image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px dashed rgba(239, 68, 68, 0.6);
  border-radius: 6px;
  color: #ef4444;
  font-size: 12px;
  font-family: var(--font-code);
  margin: 6px 0;
}

table.slide-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 4px 0;
  border-radius: 6px;
  overflow: hidden;
}

table.slide-table th, table.slide-table td {
  border: 1px solid var(--muted-color);
  padding: 8px 12px;
  text-align: left;
}

table.slide-table th {
  background-color: var(--code-bg) !important;
  color: #FFFFFF !important;
  font-weight: 600;
  border-color: #334155;
}

.slide-footer {
  position: absolute;
  bottom: 12px;
  right: 20px;
  font-size: 11px;
  color: var(--muted-color);
}

.speaker-note-details {
  background-color: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #333);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--vscode-foreground, #ccc);
}

.speaker-note-details summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--accent-color);
}

.speaker-note-content {
  margin-top: 6px;
  white-space: pre-wrap;
  line-height: 1.4;
}
`.trim();
}
