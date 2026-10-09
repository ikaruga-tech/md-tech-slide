import * as path from 'node:path';
import * as fs from 'node:fs';
import { runTests } from '@vscode/test-electron';

const stagingPath = path.resolve(__dirname, 'staging');
const extensionDevelopmentPath = fs.existsSync(path.join(stagingPath, 'package.json'))
  ? stagingPath
  : path.resolve(__dirname, '../..');
const extensionTestsPath = path.resolve(__dirname, 'suite/index.js');

async function main(): Promise<void> {
  const version = process.env.VSCODE_VERSION || '1.101.0';
  console.log(`Executing VS Code extension tests using version: ${version}`);

  const hadElectronRunAsNode = Object.prototype.hasOwnProperty.call(
    process.env,
    'ELECTRON_RUN_AS_NODE'
  );
  const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

  delete process.env.ELECTRON_RUN_AS_NODE;

  let runSuccess = false;

  try {
    await runTests({
      version,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', '--disable-gpu'],
    });
    runSuccess = true;
  } catch (err) {
    console.error('Failed to run extension tests:', err);
  } finally {
    if (hadElectronRunAsNode && originalElectronRunAsNode !== undefined) {
      process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
    } else {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  }

  if (!runSuccess) {
    process.exit(1);
  }
}

void main();
