import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const stagingDir = path.resolve(projectRoot, 'generated/extension-test/staging');

console.log('Preparing extension test staging environment at:', stagingDir);

// 1. クリーンなステージングディレクトリ作成
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

// 2. package.json の複製と main 差し替え
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8')
);
const testPackageJson = {
  ...rootPackageJson,
  main: './extension.cjs',
};
fs.writeFileSync(
  path.resolve(stagingDir, 'package.json'),
  JSON.stringify(testPackageJson, null, 2),
  'utf8'
);

// 3. テスト用 bundle のビルド
console.log('Building test bundle for extension test...');
execFileSync(process.execPath, [path.resolve(projectRoot, 'esbuild.js'), '--test-mode'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

// 4. 静的リソースのステージング
const rendererSource = path.resolve(projectRoot, 'dist/mermaid-renderer.js');
if (!fs.existsSync(rendererSource)) {
  console.log('Building mermaid renderer bundle...');
  execFileSync(process.execPath, [path.resolve(projectRoot, 'esbuild.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

const stagingDist = path.resolve(stagingDir, 'dist');
fs.mkdirSync(stagingDist, { recursive: true });
fs.copyFileSync(rendererSource, path.resolve(stagingDist, 'mermaid-renderer.js'));

const mediaSource = path.resolve(projectRoot, 'media');
if (fs.existsSync(mediaSource)) {
  fs.cpSync(mediaSource, path.resolve(stagingDir, 'media'), { recursive: true });
}

const snippetsSource = path.resolve(projectRoot, 'snippets');
if (fs.existsSync(snippetsSource)) {
  fs.cpSync(snippetsSource, path.resolve(stagingDir, 'snippets'), { recursive: true });
}

// 5. generated/extension-test の設定
const testRunnerDir = path.resolve(projectRoot, 'generated/extension-test');
fs.writeFileSync(
  path.resolve(testRunnerDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2),
  'utf8'
);

console.log('Extension test staging environment prepared successfully.');
