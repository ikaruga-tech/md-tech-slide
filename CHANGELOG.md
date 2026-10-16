# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning Policy

- Format: `MAJOR.MINOR.PATCH`
- Stable releases use tags formatted as `vMAJOR.MINOR.PATCH` (e.g., `v0.1.0`).
- Release Candidates use tags formatted as `vMAJOR.MINOR.PATCH-rc.N` (e.g., `v0.1.0-rc.1`, `v0.1.0-rc.2`).
- Pre-release builds (RC) are published to GitHub Releases as pre-releases for acceptance testing prior to official general availability.

## [Unreleased]

### Added

- Native PowerPoint (.pptx) presentation generation engine from Markdown documents.
- Slide Intermediate Representation (Slide IR) architecture separating parser, layout, and renderer.
- Visual Studio Code extension integration:
  - Custom Webview live slide preview with bidirectional synchronization.
  - Interactive navigation commands: Open Slide Preview, Export to PowerPoint, Export to PDF.
  - Frontmatter schema validation and real-time layout overflow diagnostics.
- High-fidelity PDF slide export via system browser or Chrome for Testing headless execution.
- Multi-column layout syntax using `::: columns` and `::: column` container directives with configurable width ratios.
- Comprehensive Frontmatter configuration:
  - Theme switching (`default`, `corporate`, `dark`).
  - Aspect ratio selection (`16:9`, `4:3`).
  - Pagination, header, and footer controls.
  - Typography customization: simple format (`font`, `codeFont`) and granular role-based format (`fonts.*`, `fontSize.*`).
- Full Mermaid diagram rendering support:
  - Completely offline browser-based diagram renderer bundle (`dist/mermaid-renderer.js`).
  - Multi-diagram type support: Flowcharts, Sequence, Class, State, and ER diagrams.
  - Strict DOM sanitization preventing malicious tags and inline styles.
  - Native OpenXML vector SVG embedding for PowerPoint export.
  - Vector SVG rendering in Headless PDF export and live Webview preview.
  - LRU caching and in-flight request deduplication.
- Cross-platform release infrastructure:
  - Automated release workflow with tag verification and 4-job CI status inspection.
  - Integrity manifest generation (`release-manifest.json`) and SHA-256 checksums.
