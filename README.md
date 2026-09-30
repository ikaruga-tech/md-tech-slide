# md-tech-slide

English | [日本語](./README.ja.md)

md-tech-slide is an open-source technical presentation generator and previewer from Markdown for Visual Studio Code.

Unlike conventional Markdown slide converters that export slides as static flattened images, md-tech-slide generates native, fully editable PowerPoint text boxes, shapes, and tables, alongside high-fidelity PDF slides rendered via headless browser automation.

---

## Features

- Native PowerPoint (PPTX) Generation: Produces editable native shapes, text boxes, and tables via PptxGenJS instead of rasterized images.
- Multi-Column Slot Layouts: Flexible 2-column, 3-column, and custom ratio (e.g. `ratio="2:1"`) layouts using intuitive Fenced Divs syntax (`::: columns`, `::: column`).
- Syntax Highlighted Code Blocks: Accurate code coloring powered by Shiki, mapped directly to PowerPoint formatted text frames.
- Real-Time Live Preview: Instant Webview preview alongside your Markdown editor with two-way synchronized scrolling.
- High-Quality PDF Export: Automated local browser detection (Google Chrome or Microsoft Edge) using puppeteer-core for zero-config PDF printing.
- Editor Intelligence & DX: Built-in snippet templates for slide delimiters and column blocks, plus real-time syntax diagnostic warnings.

---

## Markdown Syntax Guide

### Slide Delimiter

Delimit consecutive slides using 8 consecutive hash characters (`########`) on an isolated line.

```markdown
---
title: "Sample Presentation"
author: "Engineering Team"
theme: "corporate"
aspectRatio: "16:9"
---

# Title Slide

Welcome to md-tech-slide.

########

# Next Slide

Slide body content goes here.
```

### Multi-Column Layout

Organize slide content into columns using `::: columns` and `::: column` blocks.

```markdown
::: columns ratio="2:1"
::: column
### Left Column (Main)

- Primary technical discussion
- Code implementation walkthrough

```typescript
export interface SlideDeck {
  readonly slides: readonly Slide[];
}
```
:::
::: column
### Right Column (Side)

- Supplementary notes
- Architecture summary
:::
:::
```

### Speaker Notes

Add presentation notes for each slide using `::: note` blocks or HTML comment notation (`<!-- note: ... -->`). These are exported to PowerPoint's native slide notes field.

```markdown
::: note
Explain the key architectural advantages of native text boxes over rasterized images.
:::
```

---

## Usage

### 1. Open Preview

1. Open a Markdown presentation file in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run `md-tech-slide: Open Slide Preview` (or click the preview icon in the editor title bar).

### 2. Export to PowerPoint (PPTX)

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run `md-tech-slide: Export to PowerPoint (PPTX)`.
3. Choose the destination file path in the save dialog.

### 3. Export to PDF

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run `md-tech-slide: Export to PDF Slide`.
3. Choose the destination file path in the save dialog.

---

## Extension Settings

Customize extension behavior through the VS Code Settings editor:

- `mdTechSlide.defaultTheme`: Default presentation theme (`default`, `corporate`, `dark`).
- `mdTechSlide.defaultAspectRatio`: Default slide aspect ratio (`16:9`, `4:3`).
- `mdTechSlide.export.browserPath`: Custom executable path for Google Chrome or Microsoft Edge for PDF rendering.

---

## Commands

| Command | Description |
| --- | --- |
| `md-tech-slide.openPreview` | Open real-time slide preview for the current Markdown document |
| `md-tech-slide.exportPPTX` | Export active Markdown presentation to PowerPoint (PPTX) format |
| `md-tech-slide.exportPDF` | Export active Markdown presentation to PDF format |

---

## License

[MIT License](LICENSE)
