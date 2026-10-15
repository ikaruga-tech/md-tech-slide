import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseAndVerifyTag } from './verify-release-tag.js';

/**
 * ファイルのSHA-256ハッシュ値を計算する
 * @param {string} filePath
 * @returns {string}
 */
export function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * パッケージ名が非スコープ名の契約（小文字英数字とハイフン、先頭・末尾は英数字）を満たすか検証する
 * @param {string} name
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validatePackageName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { isValid: false, error: 'Package name must be a non-empty string.' };
  }

  // 現行製品（md-tech-slide等）を対象とする非スコープ名契約
  const namePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  if (!namePattern.test(name)) {
    return {
      isValid: false,
      error:
        'Invalid package name format. Must consist of lowercase alphanumeric characters and hyphens, starting and ending with alphanumeric.',
    };
  }

  return { isValid: true };
}

/**
 * パッケージバージョンが先頭ゼロのないX.Y.Z形式を満たすか検証する
 * @param {string} version
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validatePackageVersion(version) {
  if (typeof version !== 'string' || version.trim() === '') {
    return { isValid: false, error: 'Package version must be a non-empty string.' };
  }

  // 先頭ゼロのないX.Y.Z形式: 各要素は "0" または "[1-9][0-9]*"
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!versionPattern.test(version)) {
    return {
      isValid: false,
      error:
        'Invalid package version format. Must match "X.Y.Z" with no leading zeros in any component.',
    };
  }

  return { isValid: true };
}

/**
 * checksums.txt の内容を解析する純粋関数
 * sha256sum形式: "<64-hex-sha256>  <filename>" または "<64-hex-sha256> <filename>"
 * @param {string} content
 * @returns {{ isSuccess: boolean, entries?: Array<{ sha256: string, fileName: string }>, error?: string }}
 */
export function parseChecksumsContent(content) {
  if (typeof content !== 'string') {
    return { isSuccess: false, error: 'checksums content must be a string.' };
  }

  // 末尾の単一空行を許可し、行ごとに分割
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

  if (lines.length === 0) {
    return { isSuccess: false, error: 'checksums.txt is empty.' };
  }

  const entries = [];
  const seenFileNames = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      return { isSuccess: false, error: `Invalid empty line at line ${i + 1} in checksums.txt.` };
    }

    const match = line.match(/^([0-9a-f]{64}) {1,2}(\S+)$/);
    if (!match) {
      return {
        isSuccess: false,
        error: `Invalid format at line ${i + 1} in checksums.txt.`,
      };
    }

    const sha256 = match[1];
    const fileName = match[2];

    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return {
        isSuccess: false,
        error: `Path traversal or separator detected in checksums.txt at line ${i + 1}.`,
      };
    }

    if (seenFileNames.has(fileName)) {
      return {
        isSuccess: false,
        code: 'ERR_CHECKSUMS_DUPLICATE_ENTRY',
        error: 'Duplicate entry detected in checksums.txt.',
      };
    }

    seenFileNames.add(fileName);
    entries.push({ sha256, fileName });
  }

  return { isSuccess: true, entries };
}

const ALLOWED_FS_ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EISDIR',
  'EPERM',
  'ENOTDIR',
  'EEXIST',
  'EBUSY',
  'EIO',
]);

/**
 * ファイルシステムエラーオブジェクトから安全なエラーコードを抽出・正規化する
 * @param {unknown} err
 * @returns {string}
 */
export function sanitizeFsErrorCode(err) {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    if (ALLOWED_FS_ERROR_CODES.has(err.code)) {
      return err.code;
    }
  }
  return 'ERR_FS_OPERATION_FAILED';
}

/**
 * 成果物ファイルを安全に読み込む helper
 * @param {string} filePath
 * @param {string} safeRoleOrName
 * @returns {{ isSuccess: boolean, content?: string, error?: string, code?: string }}
 */
export function readArtifactFile(filePath, safeRoleOrName = 'artifact file') {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { isSuccess: true, content };
  } catch (err) {
    const fsCode = sanitizeFsErrorCode(err);
    return {
      isSuccess: false,
      code: 'ERR_FILE_READ_FAILED',
      error: `Failed to read ${safeRoleOrName} (${fsCode}).`,
    };
  }
}

/**
 * 成果物ファイルのサイズ取得とSHA-256ハッシュ計算を安全に行う helper
 * @param {string} filePath
 * @param {string} safeRoleOrName
 * @returns {{ isSuccess: boolean, stats?: { sizeBytes: number, sha256: string }, error?: string, code?: string }}
 */
export function collectArtifactStats(filePath, safeRoleOrName = 'artifact') {
  try {
    const sizeBytes = fs.statSync(filePath).size;
    const sha256 = calculateSha256(filePath);
    return {
      isSuccess: true,
      stats: { sizeBytes, sha256 },
    };
  } catch (err) {
    const fsCode = sanitizeFsErrorCode(err);
    return {
      isSuccess: false,
      code: 'ERR_HASH_CALCULATION_FAILED',
      error: `Failed to calculate artifact hash for ${safeRoleOrName} (${fsCode}).`,
    };
  }
}

/**
 * 成果物ディレクトリ内のエントリをファイル読込み前に安全検証する関数
 * @param {string} artifactsDir
 * @param {Set<string>} expectedAllFiles
 * @returns {{ isSuccess: boolean, actualDirEntries?: Array<{ name: string, isFile: boolean, isDirectory: boolean, isSymbolicLink: boolean }>, error?: string, code?: string }}
 */
export function inspectDirectoryEntriesBeforeReading(artifactsDir, expectedAllFiles) {
  // 1. 成果物ディレクトリ自体の検査（readdirSyncより前にlstatSyncを実行）
  let dirStat;
  try {
    dirStat = fs.lstatSync(artifactsDir);
  } catch (err) {
    return {
      isSuccess: false,
      code: 'ERR_DIR_INSPECT_FAILED',
      error: `Artifacts directory not found or inaccessible (${sanitizeFsErrorCode(err)}).`,
    };
  }

  if (dirStat.isSymbolicLink()) {
    return {
      isSuccess: false,
      code: 'ERR_DIR_IS_SYMLINK',
      error: 'Artifacts directory is a symbolic link.',
    };
  }

  if (!dirStat.isDirectory()) {
    return {
      isSuccess: false,
      code: 'ERR_DIR_NOT_DIRECTORY',
      error: 'Artifacts directory path is not a directory.',
    };
  }

  // 2. ディレクトリ内の全エントリ走査
  let rawEntries;
  try {
    rawEntries = fs.readdirSync(artifactsDir);
  } catch (err) {
    return {
      isSuccess: false,
      code: 'ERR_DIR_READ_FAILED',
      error: `Failed to read artifacts directory (${sanitizeFsErrorCode(err)}).`,
    };
  }

  const actualDirEntries = [];
  const foundFileNames = new Set();

  for (const entryName of rawEntries) {
    if (entryName.includes('/') || entryName.includes('\\') || entryName.includes('..')) {
      return {
        isSuccess: false,
        code: 'ERR_ENTRY_TRAVERSAL',
        error: 'Path traversal or separator detected in directory entry.',
      };
    }

    const fullPath = path.join(artifactsDir, entryName);
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch (err) {
      return {
        isSuccess: false,
        code: 'ERR_ENTRY_INSPECT_FAILED',
        error: `Failed to inspect directory entry (${sanitizeFsErrorCode(err)}).`,
      };
    }

    const isSymbolicLink = stat.isSymbolicLink();
    const isDirectory = stat.isDirectory();
    const isFile = stat.isFile();

    actualDirEntries.push({
      name: entryName,
      isFile,
      isDirectory,
      isSymbolicLink,
    });

    const isKnownFile = expectedAllFiles.has(entryName);
    const safeEntryLabel = isKnownFile ? `"${entryName}"` : 'entry';

    if (isSymbolicLink) {
      return {
        isSuccess: false,
        code: 'ERR_ENTRY_IS_SYMLINK',
        error: `Symbolic link found in artifacts: ${safeEntryLabel}.`,
      };
    }

    if (isDirectory) {
      return {
        isSuccess: false,
        code: 'ERR_ENTRY_IS_DIRECTORY',
        error: `Directory found in artifacts: ${safeEntryLabel}.`,
      };
    }

    if (!isFile) {
      return {
        isSuccess: false,
        code: 'ERR_ENTRY_NOT_REGULAR_FILE',
        error: `Non-regular file found in artifacts: ${safeEntryLabel}.`,
      };
    }

    if (!isKnownFile) {
      return {
        isSuccess: false,
        code: 'ERR_UNEXPECTED_ENTRY',
        error: 'Unexpected or hidden file found in artifacts directory.',
      };
    }

    foundFileNames.add(entryName);
  }

  for (const expectedFile of expectedAllFiles) {
    if (!foundFileNames.has(expectedFile)) {
      return {
        isSuccess: false,
        code: 'ERR_MISSING_REQUIRED_FILE',
        error: `Missing required artifact file in directory: "${expectedFile}".`,
      };
    }
  }

  return { isSuccess: true, actualDirEntries };
}

/**
 * ダウンロード成果物とマニフェスト、checksums、および期待メタデータの厳格照合を行う純粋関数
 * @param {any} manifest
 * @param {string} checksumsContent
 * @param {Record<string, { sizeBytes: number, sha256: string }>} actualFiles
 * @param {Array<{ name: string, isFile: boolean, isDirectory?: boolean, isSymbolicLink?: boolean }>} actualDirEntries
 * @param {{ tag: string, commitSha: string, packageName: string, packageVersion: string, workflowRunId: number, workflowRunAttempt: number }} expectedMeta
 * @returns {{ isSuccess: boolean, error?: string }}
 */
export function verifyArtifactsIntegrity(
  manifest,
  checksumsContent,
  actualFiles,
  actualDirEntries,
  expectedMeta
) {
  // 1. 必須メタデータの存在・型検証
  if (!expectedMeta || typeof expectedMeta !== 'object') {
    return { isSuccess: false, error: 'Expected metadata object is required.' };
  }

  const requiredMetaKeys = [
    'tag',
    'commitSha',
    'packageName',
    'packageVersion',
    'workflowRunId',
    'workflowRunAttempt',
  ];
  for (const key of requiredMetaKeys) {
    const val = expectedMeta[key];
    if (val === undefined || val === null || val === '') {
      return { isSuccess: false, error: `Missing required expected metadata: "${key}".` };
    }
  }

  const pkgNameValidation = validatePackageName(expectedMeta.packageName);
  if (!pkgNameValidation.isValid) {
    return { isSuccess: false, error: pkgNameValidation.error };
  }

  const pkgVersionValidation = validatePackageVersion(expectedMeta.packageVersion);
  if (!pkgVersionValidation.isValid) {
    return { isSuccess: false, error: pkgVersionValidation.error };
  }

  const tagValidation = parseAndVerifyTag(expectedMeta.tag, expectedMeta.packageVersion);
  if (!tagValidation.isValid) {
    return { isSuccess: false, error: 'Release tag and package version mismatch detected.' };
  }

  if (
    typeof expectedMeta.workflowRunId !== 'number' ||
    Number.isNaN(expectedMeta.workflowRunId) ||
    typeof expectedMeta.workflowRunAttempt !== 'number' ||
    Number.isNaN(expectedMeta.workflowRunAttempt)
  ) {
    return {
      isSuccess: false,
      error: 'Expected workflowRunId and workflowRunAttempt must be valid numbers.',
    };
  }

  // 2. 独立した必須ファイル名の静的確定
  const expectedVsixName = `${expectedMeta.packageName}-${expectedMeta.packageVersion}.vsix`;
  const expectedPptxName = 'sample.pptx';
  const expectedPdfName = 'sample.pdf';
  const expectedChecksumsName = 'checksums.txt';
  const expectedManifestName = 'release-manifest.json';

  const expectedAllFiles = new Set([
    expectedVsixName,
    expectedPptxName,
    expectedPdfName,
    expectedChecksumsName,
    expectedManifestName,
  ]);

  const expectedBinaryFiles = new Set([expectedVsixName, expectedPptxName, expectedPdfName]);
  const expectedManifestArtifacts = new Set([
    expectedVsixName,
    expectedPptxName,
    expectedPdfName,
    expectedChecksumsName,
  ]);

  // 3. 実ディレクトリ全エントリの厳格走査（隠しファイル・サブディレクトリ・シンボリックリンク・余剰・欠落の拒否）
  if (!Array.isArray(actualDirEntries)) {
    return { isSuccess: false, error: 'actualDirEntries must be an array.' };
  }

  const actualFileNames = new Set();
  for (const entry of actualDirEntries) {
    if (!entry || typeof entry.name !== 'string') {
      return { isSuccess: false, error: 'Invalid directory entry encountered.' };
    }

    if (entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('..')) {
      return {
        isSuccess: false,
        error: 'Path traversal or separator detected in directory entry.',
      };
    }

    if (!entry.isFile || entry.isDirectory || entry.isSymbolicLink) {
      return {
        isSuccess: false,
        error: 'Non-regular file, directory, or symlink found in artifacts.',
      };
    }

    if (!expectedAllFiles.has(entry.name)) {
      return {
        isSuccess: false,
        error: 'Unexpected or hidden file found in artifacts directory.',
      };
    }

    actualFileNames.add(entry.name);
  }

  for (const expectedFile of expectedAllFiles) {
    if (!actualFileNames.has(expectedFile)) {
      return {
        isSuccess: false,
        error: `Missing required artifact file in directory: "${expectedFile}".`,
      };
    }
  }

  // 4. マニフェスト自体のメタデータ照合（動的入力値や期待値を出力せず安全な固定メッセージを使用）
  if (!manifest || typeof manifest !== 'object') {
    return { isSuccess: false, error: 'Manifest is empty or not an object.' };
  }

  if (manifest.tag !== expectedMeta.tag) {
    return {
      isSuccess: false,
      error: 'Manifest tag does not match expected tag.',
    };
  }

  if (manifest.commitSha !== expectedMeta.commitSha) {
    return {
      isSuccess: false,
      error: 'Manifest commitSha does not match expected commitSha.',
    };
  }

  if (manifest.packageVersion !== expectedMeta.packageVersion) {
    return {
      isSuccess: false,
      error: 'Manifest packageVersion does not match expected packageVersion.',
    };
  }

  if (manifest.workflowRunId !== expectedMeta.workflowRunId) {
    return {
      isSuccess: false,
      error: 'Manifest workflowRunId does not match expected workflowRunId.',
    };
  }

  if (manifest.workflowRunAttempt !== expectedMeta.workflowRunAttempt) {
    return {
      isSuccess: false,
      error: 'Manifest workflowRunAttempt does not match expected workflowRunAttempt.',
    };
  }

  // 5. マニフェストの artifacts 配列の検証（4エントリ完全一致、自己参照なし）
  if (!Array.isArray(manifest.artifacts)) {
    return { isSuccess: false, error: 'Manifest contains no artifacts array.' };
  }

  if (manifest.artifacts.length !== expectedManifestArtifacts.size) {
    return {
      isSuccess: false,
      error: `Manifest artifacts count (${manifest.artifacts.length}) must be exactly ${expectedManifestArtifacts.size}.`,
    };
  }

  const manifestArtifactMap = new Map();
  for (const item of manifest.artifacts) {
    if (!item || typeof item.fileName !== 'string') {
      return { isSuccess: false, error: 'Invalid manifest artifact item format.' };
    }

    if (
      item.fileName.includes('/') ||
      item.fileName.includes('\\') ||
      item.fileName.includes('..')
    ) {
      return {
        isSuccess: false,
        error: 'Path traversal or separator detected in manifest artifact fileName.',
      };
    }

    if (item.fileName === expectedManifestName) {
      return {
        isSuccess: false,
        error: 'release-manifest.json must not be included in manifest artifacts (self-reference).',
      };
    }

    if (!expectedManifestArtifacts.has(item.fileName)) {
      return {
        isSuccess: false,
        error: 'Unknown artifact fileName in manifest.',
      };
    }

    if (manifestArtifactMap.has(item.fileName)) {
      return {
        isSuccess: false,
        error: `Duplicate artifact in manifest: "${item.fileName}".`,
      };
    }

    if (
      typeof item.sizeBytes !== 'number' ||
      item.sizeBytes <= 0 ||
      !Number.isInteger(item.sizeBytes)
    ) {
      return {
        isSuccess: false,
        error: `Invalid sizeBytes for artifact "${item.fileName}".`,
      };
    }

    if (!/^[0-9a-f]{64}$/.test(item.sha256)) {
      return {
        isSuccess: false,
        error: `Invalid sha256 hash format for artifact "${item.fileName}".`,
      };
    }

    manifestArtifactMap.set(item.fileName, item);
  }

  for (const expectedArtifact of expectedManifestArtifacts) {
    if (!manifestArtifactMap.has(expectedArtifact)) {
      return {
        isSuccess: false,
        error: `Missing required artifact in manifest: "${expectedArtifact}".`,
      };
    }
  }

  // 6. 実ファイルとのサイズ・SHA-256照合
  for (const [fileName, item] of manifestArtifactMap.entries()) {
    const actual = actualFiles[fileName];
    if (!actual) {
      return {
        isSuccess: false,
        error: `Actual file missing for artifact: "${fileName}".`,
      };
    }

    if (actual.sizeBytes !== item.sizeBytes) {
      return {
        isSuccess: false,
        error: `Size mismatch for "${fileName}".`,
      };
    }

    if (actual.sha256 !== item.sha256) {
      return {
        isSuccess: false,
        error: `SHA-256 hash mismatch for "${fileName}".`,
      };
    }
  }

  // 7. checksums.txt の内容解析と厳格照合（3バイナリ成果物、形式、ハッシュ一致）
  const parsedChecksums = parseChecksumsContent(checksumsContent);
  if (!parsedChecksums.isSuccess || !parsedChecksums.entries) {
    return {
      isSuccess: false,
      error: `checksums.txt validation failed: ${parsedChecksums.error}`,
    };
  }

  if (parsedChecksums.entries.length !== expectedBinaryFiles.size) {
    return {
      isSuccess: false,
      error: `checksums.txt entries count (${parsedChecksums.entries.length}) must be exactly ${expectedBinaryFiles.size}.`,
    };
  }

  const checksumsFileMap = new Map();
  for (const entry of parsedChecksums.entries) {
    if (!expectedBinaryFiles.has(entry.fileName)) {
      return {
        isSuccess: false,
        error: 'Unexpected file entry in checksums.txt.',
      };
    }

    if (checksumsFileMap.has(entry.fileName)) {
      return {
        isSuccess: false,
        error: 'Duplicate entry detected in checksums.txt.',
      };
    }

    checksumsFileMap.set(entry.fileName, entry.sha256);
  }

  for (const expectedBinary of expectedBinaryFiles) {
    if (!checksumsFileMap.has(expectedBinary)) {
      return {
        isSuccess: false,
        error: `Missing binary entry in checksums.txt: "${expectedBinary}".`,
      };
    }

    const checksumHash = checksumsFileMap.get(expectedBinary);
    const actualFile = actualFiles[expectedBinary];
    const manifestItem = manifestArtifactMap.get(expectedBinary);

    // 実ファイルのSHA-256とchecksums.txtのハッシュを照合
    if (checksumHash !== actualFile.sha256) {
      return {
        isSuccess: false,
        error: `Hash mismatch for "${expectedBinary}" between checksums.txt and actual file.`,
      };
    }

    // manifestに記録されたハッシュとchecksums.txtのハッシュを照合
    if (checksumHash !== manifestItem.sha256) {
      return {
        isSuccess: false,
        error: `Hash mismatch for "${expectedBinary}" between checksums.txt and manifest.`,
      };
    }
  }

  return { isSuccess: true };
}

export function runCli() {
  try {
    const artifactsDir = process.argv[2] || process.env.ARTIFACTS_DIR || '.';
    const absArtifactsDir = path.resolve(artifactsDir);

    console.log('Verifying downloaded release artifacts...');

    // 1. 必須環境変数の存在と値の検証（欠落時はファイルアクセス前に即座に停止）
    const expectedMeta = {
      tag: process.env.TAG_NAME,
      commitSha: process.env.COMMIT_SHA || process.env.GITHUB_SHA,
      packageName: process.env.PACKAGE_NAME,
      packageVersion: process.env.PACKAGE_VERSION,
      workflowRunId: process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : undefined,
      workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT
        ? Number(process.env.GITHUB_RUN_ATTEMPT)
        : undefined,
    };

    const missingEnvVars = [];
    if (!expectedMeta.tag) missingEnvVars.push('TAG_NAME');
    if (!expectedMeta.commitSha) missingEnvVars.push('COMMIT_SHA (or GITHUB_SHA)');
    if (!expectedMeta.packageName) missingEnvVars.push('PACKAGE_NAME');
    if (!expectedMeta.packageVersion) missingEnvVars.push('PACKAGE_VERSION');
    if (expectedMeta.workflowRunId === undefined || Number.isNaN(expectedMeta.workflowRunId)) {
      missingEnvVars.push('GITHUB_RUN_ID');
    }
    if (
      expectedMeta.workflowRunAttempt === undefined ||
      Number.isNaN(expectedMeta.workflowRunAttempt)
    ) {
      missingEnvVars.push('GITHUB_RUN_ATTEMPT');
    }

    if (missingEnvVars.length > 0) {
      console.error(
        `Error: Missing required environment variables for verification: ${missingEnvVars.join(', ')}`
      );
      process.exit(1);
    }

    const pkgNameValidation = validatePackageName(expectedMeta.packageName);
    if (!pkgNameValidation.isValid) {
      console.error(`Error: ${pkgNameValidation.error}`);
      process.exit(1);
    }

    const pkgVersionValidation = validatePackageVersion(expectedMeta.packageVersion);
    if (!pkgVersionValidation.isValid) {
      console.error(`Error: ${pkgVersionValidation.error}`);
      process.exit(1);
    }

    const tagValidation = parseAndVerifyTag(expectedMeta.tag, expectedMeta.packageVersion);
    if (!tagValidation.isValid) {
      console.error('Error: Tag and version verification failed.');
      process.exit(1);
    }

    // 2. 独立した期待5ファイル名の決定
    const expectedVsixName = `${expectedMeta.packageName}-${expectedMeta.packageVersion}.vsix`;
    const expectedAllFiles = new Set([
      expectedVsixName,
      'sample.pptx',
      'sample.pdf',
      'checksums.txt',
      'release-manifest.json',
    ]);

    // 3. 成果物ディレクトリと全エントリの安全検査（ファイル読込み前・ハッシュ計算前に実行）
    const dirCheck = inspectDirectoryEntriesBeforeReading(absArtifactsDir, expectedAllFiles);
    if (!dirCheck.isSuccess) {
      console.error(`Artifact verification failed before reading: ${dirCheck.error}`);
      process.exit(1);
    }

    const actualDirEntries = dirCheck.actualDirEntries;

    // 4. 安全検査通過後、ファイルを読み込み
    const manifestPath = path.join(absArtifactsDir, 'release-manifest.json');
    const manifestReadRes = readArtifactFile(manifestPath, 'release manifest');
    if (!manifestReadRes.isSuccess) {
      console.error(`Artifact verification failed: ${manifestReadRes.error}`);
      process.exit(1);
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestReadRes.content);
    } catch {
      console.error(
        'Artifact verification failed: Failed to parse release-manifest.json (invalid JSON).'
      );
      process.exit(1);
    }

    const checksumsPath = path.join(absArtifactsDir, 'checksums.txt');
    const checksumsReadRes = readArtifactFile(checksumsPath, 'checksums file');
    if (!checksumsReadRes.isSuccess) {
      console.error(`Artifact verification failed: ${checksumsReadRes.error}`);
      process.exit(1);
    }
    const checksumsContent = checksumsReadRes.content;

    // 5. 各成果物のハッシュ計算
    const actualFiles = {};
    for (const entry of actualDirEntries) {
      if (entry.isFile) {
        const p = path.join(absArtifactsDir, entry.name);
        const statsRes = collectArtifactStats(p, entry.name);
        if (!statsRes.isSuccess) {
          console.error(`Artifact verification failed: ${statsRes.error}`);
          process.exit(1);
        }
        actualFiles[entry.name] = statsRes.stats;
      }
    }

    // 6. マニフェスト、チェックサム、実ファイル、メタデータの厳格照合
    const result = verifyArtifactsIntegrity(
      manifest,
      checksumsContent,
      actualFiles,
      actualDirEntries,
      expectedMeta
    );

    if (!result.isSuccess) {
      console.error(`Artifact verification failed: ${result.error}`);
      process.exit(1);
    }

    console.log('All downloaded artifacts, checksums, and manifest verified successfully!');
    for (const item of manifest.artifacts) {
      console.log(
        `- [OK] ${item.fileName} (${item.sizeBytes} bytes, SHA-256: ${item.sha256.slice(0, 12)}...)`
      );
    }
  } catch {
    console.error('Artifact verification failed: Unexpected internal execution error.');
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runCli();
}
