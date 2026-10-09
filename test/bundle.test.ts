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
    expect(packageJson.engines?.vscode).toBe('^1.101.0');
    expect(packageJson.engines?.node).toBe('>=22.12.0');
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

  it('.vscodeignore file exists and excludes development files while including bundles', () => {
    const vscodeignorePath = path.resolve(__dirname, '../.vscodeignore');
    expect(fs.existsSync(vscodeignorePath)).toBe(true);
    const content = fs.readFileSync(vscodeignorePath, 'utf-8');
    expect(content).toContain('src/**');
    expect(content).toContain('test/**');
    expect(content).toContain('!dist/extension.cjs');
    expect(content).toContain('!dist/mermaid-renderer.js');
    expect(content).toContain('!THIRD_PARTY_LICENSES.txt');
  });

  it('CI workflow enforces Node 22/24 matrix and runs test:mermaid', () => {
    const ciPath = path.resolve(__dirname, '../.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);
    const ciContent = fs.readFileSync(ciPath, 'utf-8');
    expect(ciContent).toContain('node-version: [22, 24]');
    expect(ciContent).not.toContain('20');
    expect(ciContent).toContain('npm run test:mermaid');
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
    if (!fs.existsSync(bundlePath)) {
      const { execSync } = createRequire(import.meta.url)('node:child_process');
      execSync('node esbuild.js', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
    }
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

  it('does not export internal diagnostics or diagnostic properties in public API', async () => {
    const publicExports = await import('../src/index.js');
    expect(
      (publicExports as Record<string, unknown>)['setDiagnosticSinkForTesting']
    ).toBeUndefined();
    expect(
      (publicExports as Record<string, unknown>)['setFaultInjectionHooksForTesting']
    ).toBeUndefined();
    expect(
      (publicExports as Record<string, unknown>)['createDiagramRenderService']
    ).toBeUndefined();

    const err = new publicExports.DiagramRenderError('mermaid-render-failed', 'test');
    expect((err as unknown as Record<string, unknown>)['stage']).toBeUndefined();
    expect((err as unknown as Record<string, unknown>)['detail']).toBeUndefined();
    expect((err as unknown as Record<string, unknown>)['serviceId']).toBeUndefined();
    expect((err as unknown as Record<string, unknown>)['ownerId']).toBeUndefined();
  });

  it('production extension bundle does not contain worker diagnostics hooks, writers, or env names', () => {
    const { execSync } = createRequire(import.meta.url)('node:child_process');
    execSync('node esbuild.js --production', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
    });
    const bundlePath = path.resolve(__dirname, '../dist/extension.cjs');
    const bundleContent = fs.readFileSync(bundlePath, 'utf8');
    const rendererPath = path.resolve(__dirname, '../dist/mermaid-renderer.js');
    const rendererContent = fs.existsSync(rendererPath)
      ? fs.readFileSync(rendererPath, 'utf8')
      : '';
    const allBundles = bundleContent + '\n' + rendererContent;

    const forbiddenIdentifiers = [
      'setPreviewTestObserver',
      'setWorkerDiagnosticsWriterForTesting',
      'writeDiagnosticEventToJsonl',
      '__MD_TEST_DIAG_DIR__',
      'VERBOSE_DIAGNOSTICS',
      '--ignore-certificate-errors',
      '__setLastLaunchDiagnosticsProvider',
      '__setLaunchArgsModifier',
      '__setWorkerDiagnosticsWriter',
      '__setLaunchAttemptHooks',
      '__setControlledLaunchOverride',
      '__getBrowserSpawnTrackerForTesting',
      'BrowserFailureFingerprintTracker',
      'createDefaultSidecarFileWriter',
      'classifyStderrToIndicators',
      'classifyStderrBucket',
      'permission-indicator',
      'resource-limit-indicator',
      'profile-lock-indicator',
      'fingerprint-worker-',
      'writeDiagnosticEnvelopeToJsonl',
      'readAllDiagnosticEnvelopes',
      'validateDiagnosticEnvelope',
      'WorkerIntegrityManifest',
      'writeWorkerManifest',
      'validateWorkerManifest',
      'writeWorkerRegistration',
      'validateWorkerRegistration',
      'readAllWorkerRegistrations',
      'readAllWorkerManifests',
      'auditDiagnosticsIntegrity',
      'validateSanitizedDiagnosticEvent',
      'aggregateFingerprintsAndCorrelate',
      'isValidSanitizedReason',
      'isUnsafeReasonContent',
      'isValidSignal',
      'ALLOWED_SIGNALS',
      'TeardownOptions',
    ];

    for (const id of forbiddenIdentifiers) {
      expect(allBundles.includes(id), `Production bundle contains test identifier: ${id}`).toBe(
        false
      );
    }
  }, 20_000);

  it('canary tests for all sanitization categories verify zero leakage into diagnostics or public errors', async () => {
    const { getSafeDiagramErrorMessage } = await import('../src/diagram/safe-error-message.js');
    const { sanitizeDiagnosticReason } = await import('../src/diagram/internal-diagnostics.js');

    const canaries = {
      posixPath: '/Users/secret_developer_name/work/md-tech-slide/secret-source.ts',
      windowsPath: 'C:\\Users\\Administrator\\AppData\\Local\\secret\\token.txt',
      uncPath: '\\\\fileserver.corp.internal\\shared\\confidential\\data.bin',
      fileUri: 'file:///private/var/folders/xx/secret_token_12345/data.html',
      tempDir: 'md-tech-slide-profile-xyz9876543210',
      bearerToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDNxd',
      githubToken: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
      skToken: 'sk-proj-supersecrettoken1234567890abcdef',
      apiKeyQuery: 'https://example.com/api?access_token=secret_query_val_9988',
      urlUserInfo: 'https://admin_user:super_secret_password@internal-vault.net/resource',
      jwtToken:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    };

    // 1. 利用者向け定型メッセージの検証
    const safeError = getSafeDiagramErrorMessage('mermaid-render-failed');
    expect(safeError).toBe('Mermaid diagram rendering failed.');
    for (const [name, val] of Object.entries(canaries)) {
      expect(safeError.includes(val), `Safe error leaked ${name}`).toBe(false);
    }

    // 2. 各カテゴリのサニタイズ検証
    for (const [name, val] of Object.entries(canaries)) {
      const rawError = new Error(`Error occurred with ${name}: ${val}`);
      const sanitized = sanitizeDiagnosticReason(rawError);
      expect(sanitized.includes(val), `Sanitizer leaked ${name} (${val})`).toBe(false);
    }

    // 3. 改行・制御文字・過長文字列のサニタイズ検証
    const longString = 'a'.repeat(500);
    const controlString = 'Error\nwith\rnewline\x00and\x1Fcontrol\x7Fchars ' + longString;
    const sanitizedLong = sanitizeDiagnosticReason(controlString);
    expect(sanitizedLong.includes('\n')).toBe(false);
    expect(sanitizedLong.includes('\r')).toBe(false);
    expect(sanitizedLong.length).toBeLessThanOrEqual(200);
  });
});
