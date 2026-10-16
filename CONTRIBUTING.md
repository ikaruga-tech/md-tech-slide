# Contributing to md-tech-slide

Thank you for your interest in contributing to md-tech-slide! This document provides guidelines for contributing to this project.

## Code of Conduct

Everyone participating in this project is expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

## Development Setup

### Prerequisites

- Node.js >= 22.12.0 (Node 20 is not supported)
- Visual Studio Code >= 1.101.0
- npm (bundled with Node.js)

### Initial Setup

```bash
git clone https://github.com/ikaruga-tech/md-tech-slide.git
cd md-tech-slide
npm ci
```

## Development Workflow

### Useful Commands

- `npm run build`: Build extension and renderer bundles via esbuild
- `npm run watch`: Incremental build in watch mode
- `npm run format:check`: Check formatting with Prettier
- `npm run lint`: Run ESLint
- `npm run typecheck`: Run TypeScript type-checking without emitting files
- `npm test`: Run unit and structural tests via Vitest
- `npm run test:browser-e2e`: Run browser launch E2E tests
- `npm run test:mermaid`: Run Mermaid diagram real-browser tests
- `npm run test:pdf-e2e`: Run headless PDF export E2E tests
- `npm run test:extension`: Run VS Code Extension Host smoke tests
- `npm run package:vsix`: Package production VSIX file and verify safety boundaries
- `npm run verify`: Run all checks and tests locally (all-in-one gate)

### Coding Standards

Please strictly adhere to our project guidelines:

1. TypeScript Strict Mode: `any` is strictly prohibited. Prefer interfaces and type safety.
2. Single Responsibility: Keep functions focused; avoid monster files (target <= 300 lines).
3. Dependency Architecture: Keep dependencies unidirectional. Core logic resides in `src/core`, `src/parser`, `src/generator`. Extension code in `src/extension` only invokes core modules.
4. Output Boundary: All generated artifacts belong to `generated/` or `output/` and must not be committed to Git.
5. Error Handling: Never swallow errors silently. Emit structured Diagnostics or throw meaningful descriptive errors.

## Pull Request Guidelines

1. Always branch off `main` into a feature or fix branch (`feature/...` or `fix/...`).
2. Run `npm run verify` and `git diff --check` locally before creating a PR.
3. Use the provided PR template and fill out all required sections.
4. Do NOT include sensitive information, internal absolute paths, or production credentials in commits or PR descriptions.
