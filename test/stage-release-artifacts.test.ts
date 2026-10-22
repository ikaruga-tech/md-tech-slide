import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { stageReleaseArtifacts, STAGE_ERROR_CODES } from '../scripts/stage-release-artifacts.js';

function calculateSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

describe('Stage Release Artifacts (scripts/stage-release-artifacts.js)', () => {
  let tempDir: string;
  let generatedDir: string;
  let outputDir: string;
  let stagingDir: string;
  let pkgPath: string;

  const pkgName = 'md-tech-slide';
  const pkgVersion = '0.1.0';
  const vsixName = `${pkgName}-${pkgVersion}.vsix`;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-artifacts-test-'));
    generatedDir = path.join(tempDir, 'generated');
    outputDir = path.join(tempDir, 'output');
    stagingDir = path.join(tempDir, 'release-artifacts-staging');
    pkgPath = path.join(tempDir, 'package.json');

    fs.mkdirSync(generatedDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: pkgName, version: pkgVersion }, null, 2),
      'utf-8'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function setupValidArtifacts(
    runId = '12345',
    runAttempt = '1',
    tag = 'v0.1.0-rc.1',
    commitSha = '0123456789abcdef0123456789abcdef01234567'
  ) {
    const vsixPath = path.join(generatedDir, vsixName);
    const pptxPath = path.join(outputDir, 'sample.pptx');
    const pdfPath = path.join(outputDir, 'sample.pdf');
    const checksumsPath = path.join(outputDir, 'checksums.txt');
    const manifestPath = path.join(outputDir, 'release-manifest.json');

    fs.writeFileSync(vsixPath, 'dummy-vsix-content');
    fs.writeFileSync(pptxPath, 'dummy-pptx-content');
    fs.writeFileSync(pdfPath, 'dummy-pdf-content');

    const vsixSha = calculateSha256(vsixPath);
    const pptxSha = calculateSha256(pptxPath);
    const pdfSha = calculateSha256(pdfPath);

    const checksumsContent =
      [`${vsixSha}  ${vsixName}`, `${pptxSha}  sample.pptx`, `${pdfSha}  sample.pdf`].join('\n') +
      '\n';
    fs.writeFileSync(checksumsPath, checksumsContent, 'utf-8');

    const checksumsSha = calculateSha256(checksumsPath);

    const manifestData = {
      manifestVersion: '1.0.0',
      tag,
      commitSha,
      packageName: pkgName,
      packageVersion: pkgVersion,
      isPrerelease: true,
      repository: 'ikaruga-tech/md-tech-slide',
      workflowRunId: Number(runId),
      workflowRunAttempt: Number(runAttempt),
      builtAt: new Date().toISOString(),
      artifacts: [
        {
          fileName: vsixName,
          sizeBytes: fs.statSync(vsixPath).size,
          sha256: vsixSha,
          type: 'vsix',
        },
        {
          fileName: 'sample.pptx',
          sizeBytes: fs.statSync(pptxPath).size,
          sha256: pptxSha,
          type: 'pptx',
        },
        {
          fileName: 'sample.pdf',
          sizeBytes: fs.statSync(pdfPath).size,
          sha256: pdfSha,
          type: 'pdf',
        },
        {
          fileName: 'checksums.txt',
          sizeBytes: fs.statSync(checksumsPath).size,
          sha256: checksumsSha,
          type: 'checksums',
        },
      ],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');

    return {
      runId,
      runAttempt,
      tag,
      commitSha,
      vsixSha,
      pptxSha,
      pdfSha,
      checksumsSha,
    };
  }

  it('stages 5 artifacts into a flat directory and preserves byte-level integrity', () => {
    const meta = setupValidArtifacts();

    const stageResult = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(stageResult.isSuccess).toBe(true);
    expect(stageResult.stagedFiles.length).toBe(5);

    // Verify all 5 files exist directly in stagingDir
    const stagedEntries = fs.readdirSync(stagingDir);
    expect(stagedEntries.sort()).toEqual(
      ['checksums.txt', vsixName, 'release-manifest.json', 'sample.pdf', 'sample.pptx'].sort()
    );

    // Verify byte-level integrity and no subdirectories or symlinks
    for (const entry of stagedEntries) {
      const entryPath = path.join(stagingDir, entry);
      const entryStat = fs.lstatSync(entryPath);
      expect(entryStat.isFile()).toBe(true);
      expect(entryStat.isDirectory()).toBe(false);
      expect(entryStat.isSymbolicLink()).toBe(false);
    }

    expect(calculateSha256(path.join(stagingDir, vsixName))).toBe(meta.vsixSha);
    expect(calculateSha256(path.join(stagingDir, 'sample.pptx'))).toBe(meta.pptxSha);
    expect(calculateSha256(path.join(stagingDir, 'sample.pdf'))).toBe(meta.pdfSha);
    expect(calculateSha256(path.join(stagingDir, 'checksums.txt'))).toBe(meta.checksumsSha);

    // Run existing verification CLI against the staged directory via child_process
    const verifyScript = path.resolve(__dirname, '../scripts/verify-downloaded-artifacts.js');
    let verifyOutput = '';
    let verifyError: unknown = null;
    try {
      verifyOutput = execFileSync(process.execPath, [verifyScript, stagingDir], {
        env: {
          ...process.env,
          TAG_NAME: meta.tag,
          COMMIT_SHA: meta.commitSha,
          PACKAGE_NAME: pkgName,
          PACKAGE_VERSION: pkgVersion,
          GITHUB_RUN_ID: meta.runId,
          GITHUB_RUN_ATTEMPT: meta.runAttempt,
        },
        encoding: 'utf-8',
      });
    } catch (err) {
      verifyError = err;
    }

    expect(verifyError).toBeNull();
    expect(verifyOutput).toContain(
      'All downloaded artifacts, checksums, and manifest verified successfully!'
    );
  });

  it('fails safely without leaking path when a required artifact is missing', () => {
    setupValidArtifacts();
    // Remove sample.pdf
    fs.unlinkSync(path.join(outputDir, 'sample.pdf'));

    const stageResult = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(stageResult.isSuccess).toBe(false);
    expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_NOT_FOUND);
    expect(stageResult.error).toBe('Required source artifact not found: sample PDF.');
    expect(stageResult.error).not.toContain(outputDir);
  });

  it('fails safely when an artifact is a directory or symbolic link', () => {
    setupValidArtifacts();
    // Replace sample.pptx with a directory
    fs.unlinkSync(path.join(outputDir, 'sample.pptx'));
    fs.mkdirSync(path.join(outputDir, 'sample.pptx'));

    const stageResult = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(stageResult.isSuccess).toBe(false);
    expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_SOURCE_ARTIFACT_NOT_REGULAR_FILE);
    expect(stageResult.error).toBe('Source artifact is not a regular file: sample PPTX.');
    expect(stageResult.error).not.toContain(outputDir);
  });

  it('fails safely when the staging target directory is already non-empty', () => {
    setupValidArtifacts();
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'unexpected.txt'), 'content');

    const stageResult = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(stageResult.isSuccess).toBe(false);
    expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_STAGING_DIR_NOT_EMPTY);
    expect(stageResult.error).toBe('Staging target directory must be empty.');
    expect(stageResult.error).not.toContain(stagingDir);
    expect(stageResult.error).not.toContain('unexpected.txt');
  });

  it('fails safely when package.json is missing', () => {
    setupValidArtifacts();
    fs.unlinkSync(pkgPath);

    const stageResult = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(stageResult.isSuccess).toBe(false);
    expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_PACKAGE_JSON_READ_FAILED);
    expect(stageResult.error).toBe('Failed to read package.json (ENOENT).');
    expect(stageResult.error).not.toContain(pkgPath);
  });

  it('does not leak sentinel tokens, stack traces, or absolute paths when package.json parsing fails in CLI', () => {
    setupValidArtifacts();
    const sentinelToken = 'SENTINEL_TOP_SECRET_CREDENTIAL_98765';
    fs.writeFileSync(
      pkgPath,
      `{\n  "name": "md-tech-slide",\n  "leak": "${sentinelToken}",\n  INVALID_JSON_BODY\n}`,
      'utf-8'
    );

    const cliScript = path.resolve(__dirname, '../scripts/stage-release-artifacts.js');
    const res = spawnSync(process.execPath, [cliScript, stagingDir, tempDir], {
      encoding: 'utf-8',
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      '[ERR_PACKAGE_JSON_PARSE_FAILED] Failed to parse package.json as valid JSON.'
    );
    expect(res.stderr).not.toContain(sentinelToken);
    expect(res.stdout).not.toContain(sentinelToken);
    expect(res.stderr).not.toContain(tempDir);
    expect(res.stdout).not.toContain(tempDir);
    expect(res.stderr).not.toContain('SyntaxError');
  });

  it('rejects path traversal in package.json name before creating staging directory', () => {
    setupValidArtifacts();
    const traversalNames = ['../../malicious', 'pkg/sub', 'pkg\\back', '', '   ', 'UPPERCASE'];

    for (const badName of traversalNames) {
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({ name: badName, version: '0.1.0' }, null, 2),
        'utf-8'
      );

      const targetStaging = path.join(
        tempDir,
        `staging-for-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );

      const stageResult = stageReleaseArtifacts({
        rootDir: tempDir,
        stagingDir: targetStaging,
        generatedDir,
        outputDir,
        pkgPath,
      });

      expect(stageResult.isSuccess).toBe(false);
      expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_PACKAGE_NAME_INVALID);
      expect(stageResult.error).toBe('Invalid package name format.');
      if (badName.trim().length > 0) {
        expect(stageResult.error).not.toContain(badName);
      }
      // Ensure staging dir was NOT created
      expect(fs.existsSync(targetStaging)).toBe(false);
    }
  });

  it('rejects invalid or leading-zero version before creating staging directory', () => {
    setupValidArtifacts();
    const badVersions = ['01.0.0', '1.0', '1.0.0-rc.1', '1.0.0.0', 'v1.0.0', '', '1.0.01'];

    for (const badVersion of badVersions) {
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({ name: 'md-tech-slide', version: badVersion }, null, 2),
        'utf-8'
      );

      const targetStaging = path.join(
        tempDir,
        `staging-for-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );

      const stageResult = stageReleaseArtifacts({
        rootDir: tempDir,
        stagingDir: targetStaging,
        generatedDir,
        outputDir,
        pkgPath,
      });

      expect(stageResult.isSuccess).toBe(false);
      expect(stageResult.code).toBe(STAGE_ERROR_CODES.ERR_PACKAGE_VERSION_INVALID);
      expect(stageResult.error).toBe('Invalid package version format.');
      if (badVersion.trim().length > 0) {
        expect(stageResult.error).not.toContain(badVersion);
      }
      // Ensure staging dir was NOT created
      expect(fs.existsSync(targetStaging)).toBe(false);
    }
  });

  it('sanitizes filesystem errors to allowed codes or generic code without raw error leak', () => {
    setupValidArtifacts();

    // 1. Mock mkdirSync with allowed code
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      const err = new Error('Raw sensitive host filesystem message') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const result1 = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(result1.isSuccess).toBe(false);
    expect(result1.code).toBe(STAGE_ERROR_CODES.ERR_STAGING_DIR_CREATE_FAILED);
    expect(result1.error).toBe('Failed to create staging directory (EACCES).');
    expect(result1.error).not.toContain('Raw sensitive host filesystem message');
    expect(result1.error).not.toContain(stagingDir);
    mkdirSpy.mockRestore();

    // 2. Mock copyFileSync with unknown code (normalized to ERR_FS_OPERATION_FAILED)
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => {
      const err = new Error('Sensitive kernel disk error') as NodeJS.ErrnoException;
      err.code = 'ECUSTOM_UNRECOGNIZED_CODE';
      throw err;
    });

    const result2 = stageReleaseArtifacts({
      rootDir: tempDir,
      stagingDir,
      generatedDir,
      outputDir,
      pkgPath,
    });

    expect(result2.isSuccess).toBe(false);
    expect(result2.code).toBe(STAGE_ERROR_CODES.ERR_ARTIFACT_COPY_FAILED);
    expect(result2.error).toBe(
      'Failed during artifact copy: VSIX artifact (ERR_FS_OPERATION_FAILED).'
    );
    expect(result2.error).not.toContain('Sensitive kernel disk error');
    expect(result2.error).not.toContain('ECUSTOM_UNRECOGNIZED_CODE');
    copySpy.mockRestore();
  });

  it('CLI success output outputs clean summary without leaking absolute stagingDir path', () => {
    setupValidArtifacts();
    const cliScript = path.resolve(__dirname, '../scripts/stage-release-artifacts.js');
    const res = spawnSync(process.execPath, [cliScript, stagingDir, tempDir], {
      encoding: 'utf-8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Successfully staged 5 release artifacts to staging directory.');
    expect(res.stdout).toContain(` - ${vsixName}`);
    expect(res.stdout).toContain(' - sample.pptx');
    expect(res.stdout).toContain(' - sample.pdf');
    expect(res.stdout).toContain(' - checksums.txt');
    expect(res.stdout).toContain(' - release-manifest.json');
    // Ensure absolute stagingDir is not in stdout
    expect(res.stdout).not.toContain(stagingDir);
    expect(res.stderr).toBe('');
  });
});

describe('Release Workflow Configuration for Flat Artifacts (.github/workflows/release.yml)', () => {
  it('configures flat artifact staging, verification prior to upload, and single directory upload/download', () => {
    const workflowPath = path.resolve(__dirname, '../.github/workflows/release.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const rawYaml = fs.readFileSync(workflowPath, 'utf-8');
    const doc = YAML.parse(rawYaml);

    const buildJob = doc.jobs['build-and-verify'];
    expect(buildJob).toBeDefined();

    const buildSteps = buildJob.steps as Array<{
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;

    // 1. Staging step exists
    const stageStep = buildSteps.find(
      (s) => s.run && s.run.includes('scripts/stage-release-artifacts.js')
    );
    expect(stageStep).toBeDefined();

    // 2. Pre-upload verification step exists and runs against staging directory
    const preUploadVerifyStep = buildSteps.find(
      (s) =>
        s.run && s.run.includes('scripts/verify-downloaded-artifacts.js release-artifacts-staging')
    );
    expect(preUploadVerifyStep).toBeDefined();

    // 3. Upload artifact step uploads release-artifacts-staging/
    const uploadStep = buildSteps.find((s) => s.uses && s.uses.includes('actions/upload-artifact'));
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.with?.name).toBe('release-artifacts');
    expect(uploadStep?.with?.path).toBe('release-artifacts-staging/');

    // Ensure staging occurs BEFORE verification and verification occurs BEFORE upload
    const stageIndex = buildSteps.indexOf(stageStep!);
    const verifyIndex = buildSteps.indexOf(preUploadVerifyStep!);
    const uploadIndex = buildSteps.indexOf(uploadStep!);

    expect(stageIndex).toBeLessThan(verifyIndex);
    expect(verifyIndex).toBeLessThan(uploadIndex);

    // 4. Publish job downloads artifact to release-dist and verifies release-dist
    const publishJob = doc.jobs['publish-release'];
    expect(publishJob).toBeDefined();

    const publishSteps = publishJob.steps as Array<{
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;

    const downloadStep = publishSteps.find(
      (s) => s.uses && s.uses.includes('actions/download-artifact')
    );
    expect(downloadStep).toBeDefined();
    expect(downloadStep?.with?.name).toBe('release-artifacts');
    expect(downloadStep?.with?.path).toBe('release-dist');

    const publishVerifyStep = publishSteps.find(
      (s) => s.run && s.run.includes('scripts/verify-downloaded-artifacts.js release-dist')
    );
    expect(publishVerifyStep).toBeDefined();

    // 5. Publish step uses softprops/action-gh-release@v2 and specifies release-dist/*
    const releaseStep = publishSteps.find(
      (s) => s.uses && s.uses.includes('softprops/action-gh-release')
    );
    expect(releaseStep).toBeDefined();
    expect(String(releaseStep?.with?.files).trim()).toBe('release-dist/*');
  });
});
