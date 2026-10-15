# md-tech-slide Architecture Documentation

This document describes the internal software architecture of `md-tech-slide`, explaining the end-to-end processing pipeline, component boundaries, and design guarantees.

## 1. High-Level Processing Pipeline

The core philosophy of `md-tech-slide` is a unidirectional transformation pipeline centered on an immutable Slide Intermediate Representation (`SlideDeck` IR).

```text
[ Markdown Source ]
       │
       ▼ (Parser & Normalizer)
[ SlideDeck IR ] ────┬──────────────────────────────────────┐
       │             │                                      │
       ▼             ▼                                      ▼
[ Webview Preview ]  [ PowerPoint Generator (PptxGenJS) ]  [ PDF Export (Puppeteer) ]
  - HTML/CSS render    - Native OpenXML shapes & text        - Headless browser print
  - Live bidirectional - Native tables & notes               - High-resolution vector
    sync               - Vector SVG embedding                - CSS page media
```

### 1.1 Markdown to Slide IR (`src/parser`)

1. Slide Delimitation:
   - Slides are split by `########` delimiters or horizontal rules (`---` when not acting as Frontmatter).
   - `splitSlidesWithPositions` tracks exact 1-indexed document source line numbers for each slide.
2. Frontmatter Processing:
   - Parsed with `yaml`.
   - Strict schema validation emits non-blocking diagnostics for type errors, out-of-range values, or deprecated keys (`fontFamily`, numeric `fontSize`).
   - Generates an immutable `TypographySettings` model defining font families (`heading`, `body`, `code`) and sizes for the entire deck.
3. Content Tokenization & Directive Parsing:
   - Uses `markdown-it` with custom plugins for `markdown-it-container` (`::: columns`, `::: column`, `::: note`).
   - Fenced code blocks with language `mermaid` are converted to `DiagramIR` with SHA-256 hash calculation and empty source verification.
   - Images and resource links are normalized through a common resource security handler.

### 1.2 Layout & Diagnostics Core (`src/core`, `src/layout`)

1. Slide Dimensions:
   - Supports `16:9` (10 x 5.625 inches) and `4:3` (10 x 7.5 inches) aspect ratios.
2. Multi-Column Calculations:
   - Pure function `calculateColumnWidths` resolves ratio specifications (e.g., `2:1`, `1:1:1`) into exact percentage and inch coordinates.
3. Overflow Diagnostics:
   - Evaluates estimated vertical consumption based on font size multipliers, line counts, code blocks, and diagrams. Emits warnings in editor diagnostics for potential slide overflow.

### 1.3 Diagram Rendering Pipeline (`src/diagram`)

1. Offline Renderer Bundle:
   - A dedicated bundle (`dist/mermaid-renderer.js`) packages Mermaid 12.1.0 and `@xmldom/xmldom` 0.9.12 for completely offline rendering.
2. Sanitization & Safety:
   - Validates generated SVG DOM tree via `@xmldom/xmldom`.
   - Strips malicious elements (`<script>`, `<iframe>`, event handlers, external URIs, CSS `@import`, entity expansions).
   - Validates well-formedness with `requireWellFormed: true`.
3. Containment & Vector Export:
   - `calculateSvgContain` calculates bounding box dimensions preserving diagram aspect ratio.
   - PPTX: Embedded as native vector SVG files (`ppt/media/*.svg`) inside the OpenXML package.
   - PDF: Rendered natively as SVG elements within the print DOM.
4. Caching & Request Deduplication:
   - LRU memory cache (up to 64 diagrams or 50MB) keyed by SHA-256 hash.
   - In-flight promise sharing prevents redundant rendering when multiple slides reference identical diagrams.

## 2. Rendering Engines

### 2.1 Webview Preview (`src/extension/preview`)

- Hosted in a VS Code Webview panel with bidirectional scroll synchronization.
- Security Sandbox: Strict Content Security Policy (`default-src 'none'`), nonce-guarded script execution, and dynamic SHA-256 base64 style hashes.
- Local Resource Isolation: Local image files are converted into secure `vscode-resource:` URIs only through the common resource validator.

### 2.2 PowerPoint Generator (`src/generator`)

- Built on `pptxgenjs` with direct OpenXML manipulation where needed.
- Native Text Frames: Headings, body text, bullet points, and speaker notes are exported as native PowerPoint shapes with scalable typography.
- Dual-Font Assignment: Emits both `a:latin` and `a:ea` (East Asian) XML font attributes synchronously to preserve Japanese typography fidelity.
- Native Tables: Markdown tables become fully editable native PowerPoint table shapes with theme-aware border and fill styling.

### 2.3 Headless PDF Export (`src/export`)

- Powered by `puppeteer-core`.
- Browser Resolution Hierarchy:
  1. User custom setting (`mdTechSlide.export.browserPath`).
  2. Auto-detected system browser (Google Chrome, Microsoft Edge, Brave, Chromium).
  3. Pre-installed Chrome for Testing in CI environments.
- High Resolution Vector Print: Configures `@page` CSS and PDF printing flags (`printBackground: true`, exact page margins) for lossless vector typography and diagrams.

## 3. Package and Security Boundaries

1. Production Bundle Isolation (`esbuild.js`):
   - Bundles extension code into `dist/extension.cjs` and mermaid renderer into `dist/mermaid-renderer.js`.
   - Externalizes `@types/vscode` and built-in Node.js modules.
2. VSIX Package Verification (`scripts/package-vsix.js`):
   - Asserts that all diagnostic hooks, testing fixtures, sidecars, and `.pem` keys are strictly absent from the generated `.vsix`.
3. Artifact Separation:
   - Output directories (`generated/`, `output/`, `dist/`) are strictly excluded from source control.
