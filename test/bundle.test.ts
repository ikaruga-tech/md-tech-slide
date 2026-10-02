import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

describe('bundle and package metadata', () => {
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  it('package.json has valid VS Code extension manifest', () => {
    expect(packageJson.name).toBe('md-tech-slide');
    expect(packageJson.displayName).toBe('md-tech-slide');
    expect(packageJson.publisher).toBe('ikaruga-tech');
    expect(packageJson.icon).toBe('media/icon.png');
    expect(packageJson.main).toBe('./dist/extension.cjs');
    expect(packageJson.engines?.vscode).toBeDefined();
    expect(packageJson.activationEvents).toContain('onLanguage:markdown');
    expect(packageJson.contributes?.commands).toHaveLength(3);
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.repository?.url).toContain('ikaruga-tech/md-tech-slide');
  });

  it('extension main icon files exist in media directory', () => {
    const iconPngPath = path.resolve(__dirname, '../media/icon.png');
    const iconSvgPath = path.resolve(__dirname, '../media/icon.svg');
    expect(fs.existsSync(iconPngPath)).toBe(true);
    expect(fs.existsSync(iconSvgPath)).toBe(true);
  });

  it('.vscodeignore file exists and excludes development files', () => {
    const vscodeignorePath = path.resolve(__dirname, '../.vscodeignore');
    expect(fs.existsSync(vscodeignorePath)).toBe(true);
    const content = fs.readFileSync(vscodeignorePath, 'utf-8');
    expect(content).toContain('src/**');
    expect(content).toContain('test/**');
    expect(content).toContain('!dist/extension.cjs');
  });

  it('both English README.md and Japanese README.ja.md exist', () => {
    const readmePath = path.resolve(__dirname, '../README.md');
    const readmeJaPath = path.resolve(__dirname, '../README.ja.md');
    expect(fs.existsSync(readmePath)).toBe(true);
    expect(fs.existsSync(readmeJaPath)).toBe(true);
    expect(fs.readFileSync(readmePath, 'utf-8')).toContain('README.ja.md');
    expect(fs.readFileSync(readmeJaPath, 'utf-8')).toContain('README.md');
  });

  it('editor toolbar menu and preview icons are configured', () => {
    const editorTitleMenus = packageJson.contributes?.menus?.['editor/title'];
    expect(editorTitleMenus).toBeDefined();
    expect(editorTitleMenus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'md-tech-slide.openPreview',
          group: 'navigation',
        }),
      ])
    );

    const darkIconPath = path.resolve(__dirname, '../media/preview-dark.svg');
    const lightIconPath = path.resolve(__dirname, '../media/preview-light.svg');
    expect(fs.existsSync(darkIconPath)).toBe(true);
    expect(fs.existsSync(lightIconPath)).toBe(true);
  });

  it('extension bundle exports activate and deactivate', () => {
    const bundlePath = path.resolve(__dirname, '../dist/extension.cjs');
    expect(fs.existsSync(bundlePath)).toBe(true);

    const require = createRequire(import.meta.url);
    // モックした vscode モジュールを用いて extension.cjs を読み込み
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = (request: string, parent: unknown, isMain: boolean) => {
      if (request === 'vscode') {
        return {
          window: {
            showInformationMessage: () => {},
            showErrorMessage: () => {},
            showSaveDialog: () => {},
            withProgress: () => {},
            registerWebviewPanelSerializer: () => {},
          },
          commands: {
            registerCommand: () => ({ dispose: () => {} }),
          },
          workspace: {
            getConfiguration: () => ({ get: () => undefined }),
            onDidChangeTextDocument: () => ({ dispose: () => {} }),
          },
          languages: {
            createDiagnosticCollection: () => ({
              set: () => {},
              delete: () => {},
              clear: () => {},
              dispose: () => {},
            }),
          },
          ViewColumn: { Two: 2 },
          Uri: { file: (p: string) => ({ fsPath: p }) },
          ProgressLocation: { Notification: 15 },
          DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
          Range: class {
            constructor(
              public sl: number,
              public sc: number,
              public el: number,
              public ec: number
            ) {}
          },
          Diagnostic: class {
            constructor(
              public range: unknown,
              public message: string,
              public severity: unknown
            ) {}
          },
        };
      }
      return originalLoad(request, parent, isMain);
    };

    try {
      const extensionModule = require(bundlePath);
      expect(typeof extensionModule.activate).toBe('function');
      expect(typeof extensionModule.deactivate).toBe('function');
    } finally {
      Module._load = originalLoad;
    }
  });
});
