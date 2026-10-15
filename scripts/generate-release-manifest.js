import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
 * マニフェストデータ構造を生成する純粋関数
 * 自己参照を排除し、binary 成果物 + checksums.txt を記録する。
 */
export function createManifestData(metadata, binaryArtifacts, checksumsArtifact) {
  return {
    manifestVersion: '1.0.0',
    tag: metadata.tag,
    commitSha: metadata.commitSha,
    packageName: metadata.packageName,
    packageVersion: metadata.packageVersion,
    isPrerelease: metadata.isPrerelease,
    repository: metadata.repository,
    workflowRunId: metadata.workflowRunId,
    workflowRunAttempt: metadata.workflowRunAttempt,
    builtAt: metadata.builtAt,
    artifacts: [
      ...binaryArtifacts.map((a) => ({
        fileName: path.basename(a.filePath),
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        type: a.type,
      })),
      {
        fileName: path.basename(checksumsArtifact.filePath),
        sizeBytes: checksumsArtifact.sizeBytes,
        sha256: checksumsArtifact.sha256,
        type: 'checksums',
      },
    ],
  };
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, '..');
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  const generatedDir = path.join(projectRoot, 'generated');
  const outputDir = path.join(projectRoot, 'output');

  if (!pkg.name || !pkg.version) {
    console.error('Error: package.json must contain name and version');
    process.exit(1);
  }
  const packageName = pkg.name;
  const vsixFileName = `${packageName}-${pkg.version}.vsix`;
  const vsixPath = path.join(generatedDir, vsixFileName);
  const pptxPath = path.join(outputDir, 'sample.pptx');
  const pdfPath = path.join(outputDir, 'sample.pdf');
  const checksumsPath = path.join(outputDir, 'checksums.txt');
  const manifestPath = path.join(outputDir, 'release-manifest.json');

  // 1. バイナリ成果物の存在確認
  const binaries = [
    { filePath: vsixPath, type: 'extension' },
    { filePath: pptxPath, type: 'sample-pptx' },
    { filePath: pdfPath, type: 'sample-pdf' },
  ];

  for (const item of binaries) {
    if (!fs.existsSync(item.filePath)) {
      console.error(`Error: Required artifact not found: ${item.filePath}`);
      process.exit(1);
    }
  }

  // 2. バイナリ成果物のハッシュ計算
  const binaryArtifacts = binaries.map((item) => {
    const stat = fs.statSync(item.filePath);
    const hash = calculateSha256(item.filePath);
    return {
      filePath: item.filePath,
      sizeBytes: stat.size,
      sha256: hash,
      type: item.type,
    };
  });

  // 3. output/checksums.txt の生成（バイナリ3点のみ、自己参照なし）
  const checksumsContent =
    binaryArtifacts.map((item) => `${item.sha256}  ${path.basename(item.filePath)}`).join('\n') +
    '\n';
  fs.writeFileSync(checksumsPath, checksumsContent, 'utf-8');
  console.log(`Generated checksums file at: ${checksumsPath}`);

  // 4. checksums.txt 自身のハッシュとサイズを計算
  const checksumsStat = fs.statSync(checksumsPath);
  const checksumsHash = calculateSha256(checksumsPath);
  const checksumsArtifact = {
    filePath: checksumsPath,
    sizeBytes: checksumsStat.size,
    sha256: checksumsHash,
  };

  // 5. メタデータの構築
  const tag = process.env.TAG_NAME || process.env.GITHUB_REF_NAME || `v${pkg.version}`;
  const commitSha =
    process.env.COMMIT_SHA || process.env.GITHUB_SHA || '0000000000000000000000000000000000000000';
  const isPrerelease = tag.includes('-rc.');
  const repository = process.env.GITHUB_REPOSITORY || 'ikaruga-tech/md-tech-slide';
  const workflowRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : 0;
  const workflowRunAttempt = process.env.GITHUB_RUN_ATTEMPT
    ? Number(process.env.GITHUB_RUN_ATTEMPT)
    : 1;
  const builtAt = new Date().toISOString();

  const manifest = createManifestData(
    {
      tag,
      commitSha,
      packageName: pkg.name || 'md-tech-slide',
      packageVersion: pkg.version,
      isPrerelease,
      repository,
      workflowRunId,
      workflowRunAttempt,
      builtAt,
    },
    binaryArtifacts,
    checksumsArtifact
  );

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`Generated release manifest at: ${manifestPath}`);
  console.log('Manifest summary:');
  console.log(`- Tag: ${manifest.tag}`);
  console.log(`- Commit SHA: ${manifest.commitSha}`);
  console.log(`- Artifacts recorded: ${manifest.artifacts.length}`);
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runCli();
}
