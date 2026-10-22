import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePackageName,
  validatePackageVersion,
  sanitizeFsErrorCode,
} from './verify-downloaded-artifacts.js';

export const STAGE_ERROR_CODES = {
  ERR_PACKAGE_JSON_READ_FAILED: 'ERR_PACKAGE_JSON_READ_FAILED',
  ERR_PACKAGE_JSON_PARSE_FAILED: 'ERR_PACKAGE_JSON_PARSE_FAILED',
  ERR_PACKAGE_NAME_INVALID: 'ERR_PACKAGE_NAME_INVALID',
  ERR_PACKAGE_VERSION_INVALID: 'ERR_PACKAGE_VERSION_INVALID',
  ERR_STAGING_PATH_INSPECT_FAILED: 'ERR_STAGING_PATH_INSPECT_FAILED',
  ERR_STAGING_PATH_NOT_DIRECTORY: 'ERR_STAGING_PATH_NOT_DIRECTORY',
  ERR_STAGING_DIR_NOT_EMPTY: 'ERR_STAGING_DIR_NOT_EMPTY',
  ERR_STAGING_DIR_CREATE_FAILED: 'ERR_STAGING_DIR_CREATE_FAILED',
  ERR_SOURCE_ARTIFACT_NOT_FOUND: 'ERR_SOURCE_ARTIFACT_NOT_FOUND',
  ERR_SOURCE_ARTIFACT_INSPECT_FAILED: 'ERR_SOURCE_ARTIFACT_INSPECT_FAILED',
  ERR_SOURCE_ARTIFACT_IS_SYMLINK: 'ERR_SOURCE_ARTIFACT_IS_SYMLINK',
  ERR_SOURCE_ARTIFACT_NOT_REGULAR_FILE: 'ERR_SOURCE_ARTIFACT_NOT_REGULAR_FILE',
  ERR_ARTIFACT_COPY_FAILED: 'ERR_ARTIFACT_COPY_FAILED',
  ERR_STAGED_DIR_INSPECT_FAILED: 'ERR_STAGED_DIR_INSPECT_FAILED',
  ERR_STAGED_COUNT_MISMATCH: 'ERR_STAGED_COUNT_MISMATCH',
  ERR_STAGED_UNEXPECTED_ENTRY: 'ERR_STAGED_UNEXPECTED_ENTRY',
  ERR_STAGED_ENTRY_NOT_REGULAR_FILE: 'ERR_STAGED_ENTRY_NOT_REGULAR_FILE',
};

/**
 * リリース成果物5点をフラットなステージング領域へ安全に集約コピーする
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.stagingDir]
 * @param {string} [options.generatedDir]
 * @param {string} [options.outputDir]
 * @param {string} [options.pkgPath]
 * @returns {{ isSuccess: boolean, stagingDir: string, stagedFiles: string[], error?: string, code?: string }}
 */
export function stageReleaseArtifacts(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const pkgPath = options.pkgPath
    ? path.resolve(options.pkgPath)
    : path.join(rootDir, 'package.json');
  const generatedDir = options.generatedDir
    ? path.resolve(options.generatedDir)
    : path.join(rootDir, 'generated');
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(rootDir, 'output');
  const stagingDir = options.stagingDir
    ? path.resolve(options.stagingDir)
    : path.join(rootDir, 'release-artifacts-staging');

  // 1. package.json の読み込みと検証
  let rawPkg;
  try {
    rawPkg = fs.readFileSync(pkgPath, 'utf-8');
  } catch (err) {
    const fsCode = sanitizeFsErrorCode(err);
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      code: STAGE_ERROR_CODES.ERR_PACKAGE_JSON_READ_FAILED,
      error: `Failed to read package.json (${fsCode}).`,
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(rawPkg);
  } catch {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      code: STAGE_ERROR_CODES.ERR_PACKAGE_JSON_PARSE_FAILED,
      error: 'Failed to parse package.json as valid JSON.',
    };
  }

  // 2. パス生成前の厳格な入力契約検証（name と version）
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      code: STAGE_ERROR_CODES.ERR_PACKAGE_NAME_INVALID,
      error: 'Invalid package name format.',
    };
  }

  const nameValidation = validatePackageName(pkg.name);
  if (!nameValidation.isValid) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      code: STAGE_ERROR_CODES.ERR_PACKAGE_NAME_INVALID,
      error: 'Invalid package name format.',
    };
  }

  const versionValidation = validatePackageVersion(pkg.version);
  if (!versionValidation.isValid) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      code: STAGE_ERROR_CODES.ERR_PACKAGE_VERSION_INVALID,
      error: 'Invalid package version format.',
    };
  }

  // 3. VSIX ファイル名の導出（検証済み name と version のみから安全に構築）
  const vsixFileName = `${pkg.name}-${pkg.version}.vsix`;

  // 4. 必須5ファイルの配置元と配置先（安全な役割名で定義）
  const requiredArtifacts = [
    {
      role: 'VSIX artifact',
      source: path.join(generatedDir, vsixFileName),
      fileName: vsixFileName,
    },
    { role: 'sample PPTX', source: path.join(outputDir, 'sample.pptx'), fileName: 'sample.pptx' },
    { role: 'sample PDF', source: path.join(outputDir, 'sample.pdf'), fileName: 'sample.pdf' },
    {
      role: 'checksums file',
      source: path.join(outputDir, 'checksums.txt'),
      fileName: 'checksums.txt',
    },
    {
      role: 'release manifest',
      source: path.join(outputDir, 'release-manifest.json'),
      fileName: 'release-manifest.json',
    },
  ];

  const fileNameSet = new Set(requiredArtifacts.map((a) => a.fileName));

  // 5. ステージング先ディレクトリの準備
  if (fs.existsSync(stagingDir)) {
    let stat;
    try {
      stat = fs.lstatSync(stagingDir);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_STAGING_PATH_INSPECT_FAILED,
        error: `Failed to inspect staging directory path (${fsCode}).`,
      };
    }

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_STAGING_PATH_NOT_DIRECTORY,
        error: 'Staging target path exists and is not a regular directory.',
      };
    }

    let existingEntries;
    try {
      existingEntries = fs.readdirSync(stagingDir);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_STAGING_PATH_INSPECT_FAILED,
        error: `Failed to inspect staging directory path (${fsCode}).`,
      };
    }

    if (existingEntries.length > 0) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_STAGING_DIR_NOT_EMPTY,
        error: 'Staging target directory must be empty.',
      };
    }
  } else {
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_STAGING_DIR_CREATE_FAILED,
        error: `Failed to create staging directory (${fsCode}).`,
      };
    }
  }

  // 6. 各コピー元ファイルの存在・通常ファイル検査
  for (const artifact of requiredArtifacts) {
    if (!fs.existsSync(artifact.source)) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_NOT_FOUND,
        error: `Required source artifact not found: ${artifact.role}.`,
      };
    }

    let stat;
    try {
      stat = fs.lstatSync(artifact.source);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_INSPECT_FAILED,
        error: `Failed to inspect source artifact: ${artifact.role} (${fsCode}).`,
      };
    }

    if (stat.isSymbolicLink()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_IS_SYMLINK,
        error: `Source artifact is a symbolic link (forbidden): ${artifact.role}.`,
      };
    }

    if (!stat.isFile()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        code: STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_NOT_REGULAR_FILE,
        error: `Source artifact is not a regular file: ${artifact.role}.`,
      };
    }

    artifact.size = stat.size;
  }

  // 7. コピー実行（バイト書き換えなし、同名上書き防止モード）
  const stagedFiles = [];
  for (const artifact of requiredArtifacts) {
    const destPath = path.join(stagingDir, artifact.fileName);
    try {
      fs.copyFileSync(artifact.source, destPath, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_ARTIFACT_COPY_FAILED,
        error: `Failed during artifact copy: ${artifact.role} (${fsCode}).`,
      };
    }

    let destStat;
    try {
      destStat = fs.lstatSync(destPath);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_ARTIFACT_COPY_FAILED,
        error: `Failed during artifact copy: ${artifact.role} (${fsCode}).`,
      };
    }

    if (destStat.size !== artifact.size) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_ARTIFACT_COPY_FAILED,
        error: `Failed during artifact copy: size mismatch for ${artifact.role}.`,
      };
    }

    stagedFiles.push(artifact.fileName);
  }

  // 8. ステージング領域の最終走査（厳格に5ファイルのみ、サブディレクトリや余剰ファイル不在を検証）
  let finalEntries;
  try {
    finalEntries = fs.readdirSync(stagingDir);
  } catch (err) {
    const fsCode = sanitizeFsErrorCode(err);
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles,
      code: STAGE_ERROR_CODES.ERR_STAGED_DIR_INSPECT_FAILED,
      error: `Failed to inspect staged directory entries (${fsCode}).`,
    };
  }

  if (finalEntries.length !== requiredArtifacts.length) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles,
      code: STAGE_ERROR_CODES.ERR_STAGED_COUNT_MISMATCH,
      error: 'Staged directory contains unexpected number of files.',
    };
  }

  for (const entry of finalEntries) {
    if (!fileNameSet.has(entry)) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_STAGED_UNEXPECTED_ENTRY,
        error: 'Unexpected entry found in staged directory.',
      };
    }

    const entryPath = path.join(stagingDir, entry);
    let entryStat;
    try {
      entryStat = fs.lstatSync(entryPath);
    } catch (err) {
      const fsCode = sanitizeFsErrorCode(err);
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_STAGED_DIR_INSPECT_FAILED,
        error: `Failed to inspect staged directory entries (${fsCode}).`,
      };
    }

    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        code: STAGE_ERROR_CODES.ERR_STAGED_ENTRY_NOT_REGULAR_FILE,
        error: 'Staged entry is not a regular file.',
      };
    }
  }

  return {
    isSuccess: true,
    stagingDir,
    stagedFiles,
  };
}

function runCli() {
  try {
    const args = process.argv.slice(2);
    const targetStagingDir = args[0] ? path.resolve(args[0]) : undefined;
    const targetRootDir = args[1] ? path.resolve(args[1]) : undefined;

    const result = stageReleaseArtifacts({
      stagingDir: targetStagingDir,
      rootDir: targetRootDir,
    });

    if (!result.isSuccess) {
      console.error(`Artifact staging failed: [${result.code}] ${result.error}`);
      process.exit(1);
    }

    console.log(
      `Successfully staged ${result.stagedFiles.length} release artifacts to staging directory.`
    );
    for (const file of result.stagedFiles) {
      console.log(` - ${file}`);
    }
  } catch {
    console.error('Artifact staging failed: Unexpected internal execution error.');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
