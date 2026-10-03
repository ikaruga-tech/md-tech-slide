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

### Frontmatter Configuration

Configure deck-wide metadata and defaults in the opening YAML block:

| Key           | Type             | Default      | Description                                                    |
| :------------ | :--------------- | :----------- | :------------------------------------------------------------- |
| `title`       | string           | `""`         | Presentation title                                             |
| `author`      | string           | `""`         | Presentation author                                            |
| `theme`       | string           | `"default"`  | Visual theme (`default`, `corporate`, `dark`)                  |
| `aspectRatio` | string           | `"16:9"`     | Slide aspect ratio (`16:9`, `4:3`)                             |
| `paginate`    | boolean          | `true`       | Show slide numbers in footer (`true`, `false`)                 |
| `font`        | string           | theme        | Simple font override for heading and body                      |
| `codeFont`    | string           | theme        | Code font override for code blocks and inline code             |
| `fonts`       | mapping          | theme        | Role-specific font mapping (`body`, `heading`, `code`)         |
| `fontSize`    | number / mapping | role-default | Base font size (pt, 8-96pt). Legacy number or detailed mapping |
| `fontFamily`  | string           | -            | Deprecated (legacy). Migrating to `font` or `fonts` is advised |

```markdown
---
title: 'Sample Presentation'
author: 'Engineering Team'
theme: 'corporate'
font: 'BIZ UDPGothic'
codeFont: 'Cascadia Code'
aspectRatio: '16:9'
paginate: true
---

# Title Slide

Welcome to md-tech-slide.

########

# Next Slide

Slide body content goes here.
```

### Typography Configuration

Customize fonts and base font sizes for the entire deck directly from Frontmatter.

#### 1. Simple Format (Recommended)

Applies the specified font to both heading and body roles, with an optional separate code font:

```yaml
---
font: 'BIZ UDPGothic'
codeFont: 'Cascadia Code'
---
```

#### 2. Detailed Format

Explicitly configure role-based fonts and font sizes:

```yaml
---
fonts:
  heading: 'BIZ UDPGothic'
  body: 'Yu Gothic'
  code: 'Cascadia Code'
fontSize:
  heading: 28
  body: 18
---
```

- Font size values are specified in points (`pt`), with an accepted range of `8pt` to `96pt`.
- `fontSize.heading` acts as the base size for slide titles (default: 26pt); title slide and sub-headings follow with visual hierarchy scaling.
- `fontSize.body` acts as the base size for regular body and list text (default: 15pt); tables, code blocks, and footers scale accordingly. Specifying only `fontSize.body` keeps heading sizes at their defaults.

#### 3. Resolution Precedence

Font families are resolved per role using the following hierarchy:

- Body: `fonts.body` > `font` > `fontFamily` > Theme default > Built-in default
- Heading: `fonts.heading` > `font` > `fontFamily` > Theme default > Built-in default
- Code: `fonts.code` > `codeFont` > Theme default > Built-in default

Unspecified roles independently fall back to their next candidate without being overwritten.

#### 4. Legacy Compatibility & Deprecation Warnings

Legacy `fontFamily` and numeric `fontSize` (e.g. `fontSize: 18`) remain supported for backward compatibility.
When used, a non-blocking diagnostic warning (`frontmatter-deprecated-key`) is emitted with upgrade recommendations.

#### 5. Rendering Behavior & Font Substitution

- Webview Preview & PDF: If a specified font is not installed on the system, standard safe fallback font stacks (e.g. `-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`) are automatically applied.
- PowerPoint (PPTX): Font files are not embedded into the `.pptx` file to prevent file bloat. When viewing the generated presentation on a machine without the specified font, PowerPoint will substitute an available system font, which may alter line breaks or layout spacing.
- Recommended Fonts:
  - Japanese: `BIZ UDPGothic`, `Yu Gothic`, `Meiryo`
  - Code: `Cascadia Code`, `Consolas`, `Fira Code`
- Note: Automatic OS font discovery and diagnostics (`Run Doctor`) are planned for Phase 10.

### Multi-Column Layout

Organize slide content into columns using `::: columns` and `::: column` blocks.

````markdown
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
````

:::
::: column

### Right Column (Side)

- Supplementary notes
- Architecture summary
  :::
  :::

````

### Speaker Notes

Add presentation notes for each slide using `::: note` blocks or HTML comment notation (`<!-- note: ... -->`). These are exported to PowerPoint's native slide notes field.

```markdown
::: note
Explain the key architectural advantages of native text boxes over rasterized images.
:::
````

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

| Command                     | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `md-tech-slide.openPreview` | Open real-time slide preview for the current Markdown document  |
| `md-tech-slide.exportPPTX`  | Export active Markdown presentation to PowerPoint (PPTX) format |
| `md-tech-slide.exportPDF`   | Export active Markdown presentation to PDF format               |

---

## Security & Safe Resource Resolution

md-tech-slide adheres to strict defense-in-depth principles:

- Strict Content-Security-Policy (CSP): Webview previews forbid arbitrary external scripts and inline `style="..."` attributes, requiring cryptographic per-render nonces.
- Traversal Protection: Local images and assets are strictly constrained within the active workspace roots. Directory traversal attacks (`../`) outside allowed roots are blocked.
- Resource Safeguards: File size checks prevent reading files exceeding 20MB, and only whitelisted image formats (`.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`) are processed.
- Link Sanitization: Dangerous URL schemes (such as `javascript:` and arbitrary local `file:`) in hyperlinks are stripped from preview frames and exports.

---

## License

[MIT License](LICENSE)
