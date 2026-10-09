import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import JSZip from 'jszip';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const outputDir = path.resolve(projectRoot, 'generated');
const outputFile = path.join(outputDir, 'md-tech-slide-0.1.0.vsix');

fs.mkdirSync(outputDir, { recursive: true });

// 1. 既存の VSIX を事前削除（一意性と今回の生成物であることを保証）
if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
  console.log('Removed existing VSIX package:', outputFile);
}

// 2. パッケージング直前に製品ビルド（__TEST_MODE__: false）を必ず再実行
console.log('Building production bundle for VSIX packaging...');
execFileSync(process.execPath, [path.resolve(projectRoot, 'esbuild.js'), '--production'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

// 3. vsce package を実行
const require = createRequire(import.meta.url);
const vsceEntry = require.resolve('@vscode/vsce/vsce');

console.log('Packaging VSIX with vsce...');
execFileSync(process.execPath, [vsceEntry, 'package', '--no-dependencies', '-o', outputFile], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (!fs.existsSync(outputFile)) {
  throw new Error(`Failed to generate VSIX package at: ${outputFile}`);
}

// 4. 生成された VSIX を展開・検査
console.log('Inspecting generated VSIX package structure...');
const vsixBuffer = fs.readFileSync(outputFile);
const zip = await JSZip.loadAsync(vsixBuffer);

const filePaths = Object.keys(zip.files);

// 4.1 generated や staging, vitest 設定、sidecar 出力が混入していないこと
for (const p of filePaths) {
  if (
    p.includes('generated/') ||
    p.includes('extension-test') ||
    p.includes('staging/') ||
    p.includes('vitest.') ||
    p.includes('fingerprint-worker-') ||
    p.includes('diag-worker-') ||
    p.includes('manifest-worker-') ||
    p.includes('reg-worker-') ||
    p.includes('browser-failure-fingerprint') ||
    p.includes('diagnostics-collector') ||
    p.includes('browser-spawn-adapter')
  ) {
    throw new Error(`Forbidden test file found in VSIX: ${p}`);
  }
}

// 4.2 extension/dist/extension.cjs にテスト用フックや setPreviewTestObserver が含まれていないこと
const extensionBundleFile = zip.file('extension/dist/extension.cjs');
if (!extensionBundleFile) {
  throw new Error('extension/dist/extension.cjs not found in VSIX package');
}

const bundleContent = await extensionBundleFile.async('text');
const forbiddenBundleIdentifiers = [
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
];

for (const id of forbiddenBundleIdentifiers) {
  if (bundleContent.includes(id)) {
    throw new Error(`CRITICAL: Test identifier "${id}" found in production VSIX bundle!`);
  }
}

// 4.3 テスト用秘密鍵・証明書等の fixture が VSIX に含まれていないこと
for (const p of filePaths) {
  if (p.includes('test-key.pem') || p.includes('test-cert.pem')) {
    throw new Error(`Forbidden test fixture found in VSIX: ${p}`);
  }
}

console.log(
  'VSIX package verified successfully: no test hooks, test staging, or diagnostic fixtures found.'
);
