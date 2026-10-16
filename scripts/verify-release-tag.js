import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RC_TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/;

/**
 * @typedef {Object} TagVerificationResult
 * @property {boolean} isValid
 * @property {boolean} isPrerelease
 * @property {string} baseVersion
 * @property {number} [rcNumber]
 * @property {string} [error]
 */

/**
 * @param {string} tagName
 * @param {string} expectedVersion
 * @returns {TagVerificationResult}
 */
export function parseAndVerifyTag(tagName, expectedVersion) {
  if (!tagName || typeof tagName !== 'string') {
    return {
      isValid: false,
      isPrerelease: false,
      baseVersion: '',
      error: 'Tag name must be a non-empty string.',
    };
  }

  const stableMatch = tagName.match(STABLE_TAG_REGEX);
  if (stableMatch) {
    const baseVersion = `${stableMatch[1]}.${stableMatch[2]}.${stableMatch[3]}`;
    if (baseVersion !== expectedVersion) {
      return {
        isValid: false,
        isPrerelease: false,
        baseVersion,
        error: `Tag base version "${baseVersion}" does not match package.json version "${expectedVersion}".`,
      };
    }
    return {
      isValid: true,
      isPrerelease: false,
      baseVersion,
    };
  }

  const rcMatch = tagName.match(RC_TAG_REGEX);
  if (rcMatch) {
    const baseVersion = `${rcMatch[1]}.${rcMatch[2]}.${rcMatch[3]}`;
    const rcNumber = Number.parseInt(rcMatch[4], 10);
    if (baseVersion !== expectedVersion) {
      return {
        isValid: false,
        isPrerelease: true,
        baseVersion,
        rcNumber,
        error: `RC tag base version "${baseVersion}" does not match package.json version "${expectedVersion}".`,
      };
    }
    return {
      isValid: true,
      isPrerelease: true,
      baseVersion,
      rcNumber,
    };
  }

  return {
    isValid: false,
    isPrerelease: false,
    baseVersion: '',
    error: `Invalid tag format "${tagName}". Must match "vX.Y.Z" or "vX.Y.Z-rc.N" (N >= 1).`,
  };
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, '..');
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const tag = process.env.TAG_NAME || process.argv[2];
  if (!tag) {
    console.error('Error: Tag name not specified (via TAG_NAME environment variable or argument).');
    process.exit(1);
  }

  console.log(`Verifying release tag: "${tag}" against package.json version: "${pkg.version}"`);
  const result = parseAndVerifyTag(tag, pkg.version);

  if (!result.isValid) {
    console.error(`Tag verification failed: ${result.error}`);
    process.exit(1);
  }

  console.log('Tag verification passed!');
  console.log(`- Base Version: ${result.baseVersion}`);
  console.log(`- Is Pre-release: ${result.isPrerelease}`);
  if (result.rcNumber !== undefined) {
    console.log(`- RC Number: ${result.rcNumber}`);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runCli();
}
