import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const outputDir = path.resolve(projectRoot, 'generated');

fs.mkdirSync(outputDir, { recursive: true });

const require = createRequire(import.meta.url);
const vsceEntry = require.resolve('@vscode/vsce/vsce');
const outputFile = path.join(outputDir, 'md-tech-slide-0.1.0.vsix');

execFileSync(process.execPath, [vsceEntry, 'package', '--no-dependencies', '-o', outputFile], {
  cwd: projectRoot,
  stdio: 'inherit',
});
