import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * リリース成果物5点をフラットなステージング領域へ安全に集約コピーする
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.stagingDir]
 * @param {string} [options.generatedDir]
 * @param {string} [options.outputDir]
 * @param {string} [options.pkgPath]
 * @returns {{ isSuccess: boolean, stagingDir: string, stagedFiles: string[], error?: string }}
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
  if (!fs.existsSync(pkgPath)) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      error: `package.json not found at: ${pkgPath}`,
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      error: `Failed to parse package.json: ${err.message}`,
    };
  }

  if (
    !pkg.name ||
    typeof pkg.name !== 'string' ||
    !pkg.version ||
    typeof pkg.version !== 'string'
  ) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles: [],
      error: 'package.json must contain valid name and version strings.',
    };
  }

  // 2. VSIX ファイル名の導出（広域globを排除し、nameとversionに基づき厳格決定）
  const vsixFileName = `${pkg.name}-${pkg.version}.vsix`;

  // 3. 必須5ファイルの配置元と配置先
  const requiredArtifacts = [
    { source: path.join(generatedDir, vsixFileName), fileName: vsixFileName },
    { source: path.join(outputDir, 'sample.pptx'), fileName: 'sample.pptx' },
    { source: path.join(outputDir, 'sample.pdf'), fileName: 'sample.pdf' },
    { source: path.join(outputDir, 'checksums.txt'), fileName: 'checksums.txt' },
    { source: path.join(outputDir, 'release-manifest.json'), fileName: 'release-manifest.json' },
  ];

  // 4. 重複ファイル名の検査（防衛的検査）
  const fileNameSet = new Set();
  for (const artifact of requiredArtifacts) {
    if (fileNameSet.has(artifact.fileName)) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Duplicate artifact file name detected: ${artifact.fileName}`,
      };
    }
    fileNameSet.add(artifact.fileName);
  }

  // 5. ステージング先ディレクトリの準備
  if (fs.existsSync(stagingDir)) {
    let stat;
    try {
      stat = fs.lstatSync(stagingDir);
    } catch (err) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Failed to inspect existing staging path: ${err.message}`,
      };
    }

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Staging target path exists and is not a regular directory: ${stagingDir}`,
      };
    }

    const existingEntries = fs.readdirSync(stagingDir);
    if (existingEntries.length > 0) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Staging target directory must be empty, but contains ${existingEntries.length} entries: ${stagingDir}`,
      };
    }
  } else {
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
    } catch (err) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Failed to create staging directory: ${err.message}`,
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
        error: `Required artifact not found: ${artifact.source}`,
      };
    }

    let stat;
    try {
      stat = fs.lstatSync(artifact.source);
    } catch (err) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Failed to inspect artifact file ${artifact.source}: ${err.message}`,
      };
    }

    if (stat.isSymbolicLink()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Artifact file is a symbolic link (forbidden): ${artifact.source}`,
      };
    }

    if (!stat.isFile()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles: [],
        error: `Artifact file is not a regular file: ${artifact.source}`,
      };
    }

    artifact.size = stat.size;
  }

  // 7. コピー実行（バイト書き換えなし、同名上書き防止モード）
  const stagedFiles = [];
  try {
    for (const artifact of requiredArtifacts) {
      const destPath = path.join(stagingDir, artifact.fileName);
      fs.copyFileSync(artifact.source, destPath, fs.constants.COPYFILE_EXCL);

      const destStat = fs.lstatSync(destPath);
      if (destStat.size !== artifact.size) {
        throw new Error(
          `Size mismatch after copy for ${artifact.fileName}: expected ${artifact.size}, got ${destStat.size}`
        );
      }
      stagedFiles.push(artifact.fileName);
    }
  } catch (err) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles,
      error: `Failed during artifact copy: ${err.message}`,
    };
  }

  // 8. ステージング領域の最終走査（厳格に5ファイルのみ、サブディレクトリや余剰ファイル不在を検証）
  const finalEntries = fs.readdirSync(stagingDir);
  if (finalEntries.length !== requiredArtifacts.length) {
    return {
      isSuccess: false,
      stagingDir,
      stagedFiles,
      error: `Staged directory contains unexpected number of files: expected ${requiredArtifacts.length}, found ${finalEntries.length}`,
    };
  }

  for (const entry of finalEntries) {
    if (!fileNameSet.has(entry)) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        error: `Unexpected entry found in staged directory: ${entry}`,
      };
    }

    const entryPath = path.join(stagingDir, entry);
    const entryStat = fs.lstatSync(entryPath);
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      return {
        isSuccess: false,
        stagingDir,
        stagedFiles,
        error: `Staged entry is not a regular file: ${entry}`,
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
  const args = process.argv.slice(2);
  const targetStagingDir = args[0] ? path.resolve(args[0]) : undefined;
  const targetRootDir = args[1] ? path.resolve(args[1]) : undefined;

  const result = stageReleaseArtifacts({
    stagingDir: targetStagingDir,
    rootDir: targetRootDir,
  });

  if (!result.isSuccess) {
    console.error(`Artifact staging failed: ${result.error}`);
    process.exit(1);
  }

  console.log(
    `Successfully staged ${result.stagedFiles.length} release artifacts to: ${result.stagingDir}`
  );
  for (const file of result.stagedFiles) {
    console.log(` - ${file}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
