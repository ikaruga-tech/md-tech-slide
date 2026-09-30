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
  --accent-color: #${theme.colors.accent};
  --font-heading: "${theme.fonts.heading}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-body: "${theme.fonts.body}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-code: "${theme.fonts.code}", Consolas, Monaco, "Courier New", monospace;
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
  padding: 36px 48px;
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
  margin-bottom: 20px;
}

.slide-title {
  margin: 0;
  color: var(--title-color);
  font-family: var(--font-heading);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
}

.slide-card.title-slide {
  justify-content: center;
  align-items: center;
  text-align: center;
}

.slide-card.title-slide .slide-title {
  font-size: 38px;
  margin-bottom: 16px;
}

.slide-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.columns-container {
  display: grid;
  gap: 24px;
  height: 100%;
  align-items: start;
}

.column-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

h3 {
  margin: 0;
  color: var(--title-color);
  font-family: var(--font-heading);
  font-size: 19px;
  font-weight: 600;
}

p {
  margin: 0;
  line-height: 1.5;
  font-size: 15px;
}

ul, ol {
  margin: 0;
  padding-left: 24px;
}

li {
  margin-bottom: 4px;
  font-size: 15px;
  line-height: 1.45;
}

li > ul, li > ol {
  margin-top: 4px;
}

pre.code-block {
  margin: 0;
  background-color: var(--code-bg);
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  font-family: var(--font-code);
  font-size: 13px;
  line-height: 1.4;
  color: var(--code-text);
}

pre.code-block code {
  font-family: inherit;
  font-size: inherit;
}

code.inline-code {
  background-color: var(--code-bg);
  color: var(--code-text);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-code);
  font-size: 0.9em;
}

img.slide-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 4px;
}

table.slide-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 4px 0;
}

table.slide-table th, table.slide-table td {
  border: 1px solid var(--muted-color);
  padding: 6px 12px;
  text-align: left;
}

table.slide-table th {
  background-color: var(--code-bg);
  color: var(--title-color);
  font-weight: 600;
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
