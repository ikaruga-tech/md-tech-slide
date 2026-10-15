import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseAndVerifyTag } from '../scripts/verify-release-tag.js';
import { verifyWorkflowJobs, REQUIRED_CI_JOB_NAMES } from '../scripts/verify-ci-status.js';
import { evaluateReleaseAbsenceStatus } from '../scripts/check-release-absence.js';
import {
  verifyArtifactsIntegrity,
  parseChecksumsContent,
  validatePackageName,
  validatePackageVersion,
  inspectDirectoryEntriesBeforeReading,
  readArtifactFile,
  collectArtifactStats,
} from '../scripts/verify-downloaded-artifacts.js';

describe('Release Tag Verification (scripts/verify-release-tag.js)', () => {
  it('accepts valid stable tag matching package version', () => {
    const res = parseAndVerifyTag('v0.1.0', '0.1.0');
    expect(res.isValid).toBe(true);
    expect(res.isPrerelease).toBe(false);
    expect(res.baseVersion).toBe('0.1.0');
  });

  it('accepts valid release candidate tag matching package version', () => {
    const res = parseAndVerifyTag('v0.1.0-rc.1', '0.1.0');
    expect(res.isValid).toBe(true);
    expect(res.isPrerelease).toBe(true);
    expect(res.baseVersion).toBe('0.1.0');
    expect(res.rcNumber).toBe(1);
  });

  it('accepts multi-digit RC numbers', () => {
    const res = parseAndVerifyTag('v0.1.0-rc.10', '0.1.0');
    expect(res.isValid).toBe(true);
    expect(res.isPrerelease).toBe(true);
    expect(res.rcNumber).toBe(10);
  });

  it('rejects invalid tag formats', () => {
    const invalidTags = [
      '0.1.0', // missing v prefix
      'v0.1.0-beta', // beta not permitted
      'v0.1.0-rc.0', // rc.0 not permitted (rc starts at 1)
      'v0.1.0-rc', // missing rc number
      'v0.1.0-rc.1.1',
      'v1.0',
      'release-0.1.0',
      '',
    ];
    for (const tag of invalidTags) {
      const res = parseAndVerifyTag(tag, '0.1.0');
      expect(res.isValid).toBe(false);
      expect(res.error).toBeDefined();
    }
  });

  it('rejects version mismatch between tag and package.json', () => {
    const resStable = parseAndVerifyTag('v0.2.0', '0.1.0');
    expect(resStable.isValid).toBe(false);
    expect(resStable.error).toContain('does not match package.json version');

    const resRc = parseAndVerifyTag('v0.2.0-rc.1', '0.1.0');
    expect(resRc.isValid).toBe(false);
    expect(resRc.error).toContain('does not match package.json version');
  });
});

describe('CI 4-Job Status Verification (scripts/verify-ci-status.js)', () => {
  const createMockJobs = (
    attempt: number,
    overrideStatuses: Record<string, { status: string; conclusion: string }> = {}
  ) => {
    return REQUIRED_CI_JOB_NAMES.map((name) => ({
      name,
      run_attempt: attempt,
      status: overrideStatuses[name]?.status ?? 'completed',
      conclusion: overrideStatuses[name]?.conclusion ?? 'success',
    }));
  };

  it('succeeds when all 4 required jobs in target attempt succeeded', () => {
    const jobs = createMockJobs(1);
    const res = verifyWorkflowJobs(jobs, REQUIRED_CI_JOB_NAMES, 1);
    expect(res.isSuccess).toBe(true);
    expect(res.foundJobNames).toEqual(REQUIRED_CI_JOB_NAMES);
    expect(res.missingJobNames).toHaveLength(0);
  });

  it('fails if any required job is missing from target attempt', () => {
    const jobs = [
      {
        name: 'Linux (Ubuntu) - Node 22',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Linux (Ubuntu) - Node 24',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Cross-OS (macos-latest)',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'success',
      },
      // Cross-OS (windows-latest) is missing
    ];
    const res = verifyWorkflowJobs(jobs, REQUIRED_CI_JOB_NAMES, 1);
    expect(res.isSuccess).toBe(false);
    expect(res.missingJobNames).toContain('Cross-OS (windows-latest)');
  });

  it('fails if any required job failed or did not complete', () => {
    const jobs = createMockJobs(1, {
      'Cross-OS (windows-latest)': { status: 'completed', conclusion: 'failure' },
    });
    const res = verifyWorkflowJobs(jobs, REQUIRED_CI_JOB_NAMES, 1);
    expect(res.isSuccess).toBe(false);
    expect(res.failedOrIncompleteJobs).toHaveLength(1);
    expect(res.failedOrIncompleteJobs[0].name).toBe('Cross-OS (windows-latest)');
  });

  it('fails if a job is still in progress', () => {
    const jobs = createMockJobs(1, {
      'Linux (Ubuntu) - Node 24': { status: 'in_progress', conclusion: '' },
    });
    const res = verifyWorkflowJobs(jobs, REQUIRED_CI_JOB_NAMES, 1);
    expect(res.isSuccess).toBe(false);
  });

  it('strictly isolates target attempt and does not mix older attempt success results', () => {
    // Attempt 1 had all 4 successful jobs
    const attempt1Jobs = createMockJobs(1);
    // Attempt 2 was re-run, but Cross-OS (macos-latest) failed in attempt 2
    const attempt2Jobs = createMockJobs(2, {
      'Cross-OS (macos-latest)': { status: 'completed', conclusion: 'failure' },
    });

    const combinedJobs = [...attempt1Jobs, ...attempt2Jobs];

    // Evaluating attempt 2 must NOT be fooled by attempt 1's success
    const res = verifyWorkflowJobs(combinedJobs, REQUIRED_CI_JOB_NAMES, 2);
    expect(res.isSuccess).toBe(false);
    expect(res.failedOrIncompleteJobs[0].name).toBe('Cross-OS (macos-latest)');
    expect(res.failedOrIncompleteJobs[0].run_attempt).toBe(2);
  });
});

describe('Release Absence Evaluation (scripts/check-release-absence.js)', () => {
  it('allows release creation only when repo is healthy (200) and release is 404 (not found)', () => {
    const res = evaluateReleaseAbsenceStatus(200, 404);
    expect(res.canProceed).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('aborts when a release already exists (200)', () => {
    const res = evaluateReleaseAbsenceStatus(200, 200);
    expect(res.canProceed).toBe(false);
    expect(res.error).toContain('already exists');
  });

  it('aborts when repo check fails (401/403/500)', () => {
    const resAuth = evaluateReleaseAbsenceStatus(401, 404);
    expect(resAuth.canProceed).toBe(false);
    expect(resAuth.error).toContain('Repository access check failed');

    const resForbidden = evaluateReleaseAbsenceStatus(403, 404);
    expect(resForbidden.canProceed).toBe(false);

    const resServer = evaluateReleaseAbsenceStatus(500, 404);
    expect(resServer.canProceed).toBe(false);
  });

  it('aborts when release check returns error status rather than 404', () => {
    const res = evaluateReleaseAbsenceStatus(200, 500);
    expect(res.canProceed).toBe(false);
    expect(res.error).toContain('Cannot assume non-existence');
  });
});

describe('Downloaded Artifacts Integrity Verification (scripts/verify-downloaded-artifacts.js)', () => {
  const validShaVsix = '1111111111111111111111111111111111111111111111111111111111111111';
  const validShaPptx = '2222222222222222222222222222222222222222222222222222222222222222';
  const validShaPdf = '3333333333333333333333333333333333333333333333333333333333333333';
  const validShaChk = '4444444444444444444444444444444444444444444444444444444444444444';

  const validChecksumsContent =
    [
      `${validShaVsix}  md-tech-slide-0.1.0.vsix`,
      `${validShaPptx}  sample.pptx`,
      `${validShaPdf}  sample.pdf`,
    ].join('\n') + '\n';

  const validManifest = {
    manifestVersion: '1.0.0',
    tag: 'v0.1.0-rc.1',
    commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
    packageVersion: '0.1.0',
    isPrerelease: true,
    workflowRunId: 100,
    workflowRunAttempt: 1,
    artifacts: [
      {
        fileName: 'md-tech-slide-0.1.0.vsix',
        sizeBytes: 1000,
        sha256: validShaVsix,
        type: 'extension',
      },
      { fileName: 'sample.pptx', sizeBytes: 2000, sha256: validShaPptx, type: 'sample-pptx' },
      { fileName: 'sample.pdf', sizeBytes: 3000, sha256: validShaPdf, type: 'sample-pdf' },
      { fileName: 'checksums.txt', sizeBytes: 400, sha256: validShaChk, type: 'checksums' },
    ],
  };

  const validFilesMap = {
    'md-tech-slide-0.1.0.vsix': { sizeBytes: 1000, sha256: validShaVsix },
    'sample.pptx': { sizeBytes: 2000, sha256: validShaPptx },
    'sample.pdf': { sizeBytes: 3000, sha256: validShaPdf },
    'checksums.txt': { sizeBytes: 400, sha256: validShaChk },
    'release-manifest.json': {
      sizeBytes: 500,
      sha256: '5555555555555555555555555555555555555555555555555555555555555555',
    },
  };

  const validDirEntries = [
    { name: 'md-tech-slide-0.1.0.vsix', isFile: true, isDirectory: false, isSymbolicLink: false },
    { name: 'sample.pptx', isFile: true, isDirectory: false, isSymbolicLink: false },
    { name: 'sample.pdf', isFile: true, isDirectory: false, isSymbolicLink: false },
    { name: 'checksums.txt', isFile: true, isDirectory: false, isSymbolicLink: false },
    { name: 'release-manifest.json', isFile: true, isDirectory: false, isSymbolicLink: false },
  ];

  const validMeta = {
    tag: 'v0.1.0-rc.1',
    commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
    packageName: 'md-tech-slide',
    packageVersion: '0.1.0',
    workflowRunId: 100,
    workflowRunAttempt: 1,
  };

  it('succeeds with exact 5 files, 4 manifest entries, 3 checksums entries, and valid metadata', () => {
    const res = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(res.isSuccess).toBe(true);
  });

  it('fails if PDF is removed from both manifest and actual directory (manifest-independent check)', () => {
    const manifestWithoutPdf = {
      ...validManifest,
      artifacts: validManifest.artifacts.filter((a) => a.fileName !== 'sample.pdf'),
    };
    const filesWithoutPdf = { ...validFilesMap };
    delete (filesWithoutPdf as Record<string, unknown>)['sample.pdf'];
    const entriesWithoutPdf = validDirEntries.filter((e) => e.name !== 'sample.pdf');

    const res = verifyArtifactsIntegrity(
      manifestWithoutPdf,
      validChecksumsContent,
      filesWithoutPdf,
      entriesWithoutPdf,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Missing required artifact file in directory: "sample.pdf"');
  });

  it('fails if VSIX is missing from directory', () => {
    const entriesWithoutVsix = validDirEntries.filter((e) => !e.name.endsWith('.vsix'));
    const res = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      entriesWithoutVsix,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Missing required artifact file in directory');
  });

  it('fails if hidden file (e.g. .DS_Store) exists in directory', () => {
    const entriesWithHidden = [
      ...validDirEntries,
      { name: '.DS_Store', isFile: true, isDirectory: false, isSymbolicLink: false },
    ];
    const res = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      entriesWithHidden,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Unexpected or hidden file found in artifacts directory');
  });

  it('fails if a subdirectory or symlink exists in directory', () => {
    const entriesWithSubdir = [
      ...validDirEntries,
      { name: 'subfolder', isFile: false, isDirectory: true, isSymbolicLink: false },
    ];
    const resSubdir = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      entriesWithSubdir,
      validMeta
    );
    expect(resSubdir.isSuccess).toBe(false);
    expect(resSubdir.error).toContain('Non-regular file, directory, or symlink found');

    const entriesWithSymlink = [
      ...validDirEntries,
      { name: 'link.txt', isFile: true, isDirectory: false, isSymbolicLink: true },
    ];
    const resSymlink = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      entriesWithSymlink,
      validMeta
    );
    expect(resSymlink.isSuccess).toBe(false);
    expect(resSymlink.error).toContain('Non-regular file, directory, or symlink found');
  });

  it('fails if directory entry contains path traversal characters', () => {
    const entriesWithTraversal = [
      ...validDirEntries.slice(0, 4),
      { name: '../etc/passwd', isFile: true, isDirectory: false, isSymbolicLink: false },
    ];
    const res = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      entriesWithTraversal,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Path traversal or separator detected in directory entry');
  });

  it('fails if manifest artifacts contains self-reference (release-manifest.json)', () => {
    const selfRefManifest = {
      ...validManifest,
      artifacts: [
        ...validManifest.artifacts.slice(0, 3),
        {
          fileName: 'release-manifest.json',
          sizeBytes: 500,
          sha256: validShaChk,
          type: 'manifest',
        },
      ],
    };
    const res = verifyArtifactsIntegrity(
      selfRefManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('release-manifest.json must not be included in manifest artifacts');
  });

  it('fails on manifest duplicate artifact entries or unknown artifacts', () => {
    const dupManifest = {
      ...validManifest,
      artifacts: [
        ...validManifest.artifacts.slice(0, 3),
        { fileName: 'sample.pdf', sizeBytes: 3000, sha256: validShaPdf, type: 'sample-pdf' },
      ],
    };
    const resDup = verifyArtifactsIntegrity(
      dupManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resDup.isSuccess).toBe(false);
    expect(resDup.error).toContain('Duplicate artifact in manifest: "sample.pdf"');

    const unknownManifest = {
      ...validManifest,
      artifacts: [
        ...validManifest.artifacts.slice(0, 3),
        { fileName: 'unknown.bin', sizeBytes: 10, sha256: validShaChk, type: 'unknown' },
      ],
    };
    const resUnknown = verifyArtifactsIntegrity(
      unknownManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resUnknown.isSuccess).toBe(false);
    expect(resUnknown.error).toContain('Unknown artifact fileName in manifest');
  });

  it('fails when checksums.txt is missing an entry or has unexpected entries', () => {
    // Missing sample.pdf
    const incompleteChecksums =
      [`${validShaVsix}  md-tech-slide-0.1.0.vsix`, `${validShaPptx}  sample.pptx`].join('\n') +
      '\n';

    const resMissing = verifyArtifactsIntegrity(
      validManifest,
      incompleteChecksums,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resMissing.isSuccess).toBe(false);
    expect(resMissing.error).toContain('checksums.txt entries count (2) must be exactly 3');

    // Unexpected entry
    const extraChecksums =
      [
        `${validShaVsix}  md-tech-slide-0.1.0.vsix`,
        `${validShaPptx}  sample.pptx`,
        `${validShaPdf}  sample.pdf`,
        `${validShaChk}  extra.bin`,
      ].join('\n') + '\n';

    const resExtra = verifyArtifactsIntegrity(
      validManifest,
      extraChecksums,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resExtra.isSuccess).toBe(false);
    expect(resExtra.error).toContain('checksums.txt entries count');
  });

  it('fails if checksums.txt has duplicate lines or path traversal', () => {
    const dupChecksums =
      [
        `${validShaVsix}  md-tech-slide-0.1.0.vsix`,
        `${validShaVsix}  md-tech-slide-0.1.0.vsix`,
        `${validShaPptx}  sample.pptx`,
      ].join('\n') + '\n';

    const resDup = verifyArtifactsIntegrity(
      validManifest,
      dupChecksums,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resDup.isSuccess).toBe(false);
    expect(resDup.error).toContain('Duplicate entry detected in checksums.txt');

    const traversalChecksums =
      [
        `${validShaVsix}  ../md-tech-slide-0.1.0.vsix`,
        `${validShaPptx}  sample.pptx`,
        `${validShaPdf}  sample.pdf`,
      ].join('\n') + '\n';

    const resTraversal = verifyArtifactsIntegrity(
      validManifest,
      traversalChecksums,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(resTraversal.isSuccess).toBe(false);
    expect(resTraversal.error).toContain('Path traversal or separator detected in checksums.txt');
  });

  it('fails if checksums.txt content has spoofed hash even if checksums.txt file hash matches manifest', () => {
    const spoofedSha = '9999999999999999999999999999999999999999999999999999999999999999';
    const spoofedChecksums =
      [
        `${spoofedSha}  md-tech-slide-0.1.0.vsix`,
        `${validShaPptx}  sample.pptx`,
        `${validShaPdf}  sample.pdf`,
      ].join('\n') + '\n';

    const res = verifyArtifactsIntegrity(
      validManifest,
      spoofedChecksums,
      validFilesMap,
      validDirEntries,
      validMeta
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Hash mismatch for "md-tech-slide-0.1.0.vsix"');
  });

  it('fails on missing required metadata values (stops without skipping)', () => {
    const missingVersionMeta = { ...validMeta, packageVersion: '' };
    const resVersion = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      missingVersionMeta
    );
    expect(resVersion.isSuccess).toBe(false);
    expect(resVersion.error).toContain('Missing required expected metadata: "packageVersion"');

    const missingNameMeta = { ...validMeta, packageName: '' };
    const resName = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      missingNameMeta
    );
    expect(resName.isSuccess).toBe(false);
    expect(resName.error).toContain('Missing required expected metadata: "packageName"');

    const invalidNameMeta = { ...validMeta, packageName: 'Invalid_Package_Name!' };
    const resInvalidName = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      invalidNameMeta
    );
    expect(resInvalidName.isSuccess).toBe(false);
    expect(resInvalidName.error).toContain('Invalid package name');

    const missingShaMeta = { ...validMeta, commitSha: '' };
    const resSha = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      missingShaMeta
    );
    expect(resSha.isSuccess).toBe(false);
    expect(resSha.error).toContain('Missing required expected metadata: "commitSha"');

    const missingRunIdMeta = { ...validMeta, workflowRunId: undefined as unknown as number };
    const resRunId = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      missingRunIdMeta
    );
    expect(resRunId.isSuccess).toBe(false);
    expect(resRunId.error).toContain('Missing required expected metadata: "workflowRunId"');
  });

  it('fails on version mismatch between directory vsix and expected metadata', () => {
    const res = verifyArtifactsIntegrity(
      validManifest,
      validChecksumsContent,
      validFilesMap,
      validDirEntries,
      { ...validMeta, tag: 'v0.2.0-rc.1', packageVersion: '0.2.0' }
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Unexpected or hidden file found in artifacts directory');
  });

  it('fails on version mismatch between manifest packageVersion and expected metadata', () => {
    const dirEntries020 = validDirEntries.map((e) =>
      e.name.endsWith('.vsix') ? { ...e, name: 'md-tech-slide-0.2.0.vsix' } : e
    );
    const filesMap020 = {
      ...validFilesMap,
      'md-tech-slide-0.2.0.vsix': validFilesMap['md-tech-slide-0.1.0.vsix'],
    };
    delete (filesMap020 as Record<string, unknown>)['md-tech-slide-0.1.0.vsix'];

    const res = verifyArtifactsIntegrity(
      { ...validManifest, tag: 'v0.2.0-rc.1' },
      validChecksumsContent,
      filesMap020,
      dirEntries020,
      { ...validMeta, tag: 'v0.2.0-rc.1', packageVersion: '0.2.0' }
    );
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Manifest packageVersion does not match expected packageVersion');
  });
});

describe('Package Name Validation (validatePackageName)', () => {
  it('accepts valid non-scoped package names adhering to product contract', () => {
    expect(validatePackageName('md-tech-slide').isValid).toBe(true);
    expect(validatePackageName('my-ext-1').isValid).toBe(true);
    expect(validatePackageName('tool').isValid).toBe(true);
  });

  it('rejects invalid, uppercase, scoped, or malformed package names', () => {
    expect(validatePackageName('').isValid).toBe(false);
    expect(validatePackageName('Md-Tech-Slide').isValid).toBe(false);
    expect(validatePackageName('@scope/md-tech-slide').isValid).toBe(false);
    expect(validatePackageName('-leading-hyphen').isValid).toBe(false);
    expect(validatePackageName('trailing-hyphen-').isValid).toBe(false);
    expect(validatePackageName('has_underscore').isValid).toBe(false);
  });
});

describe('Package Version Validation (validatePackageVersion)', () => {
  it('accepts valid semver versions with no leading zeros', () => {
    expect(validatePackageVersion('0.1.0').isValid).toBe(true);
    expect(validatePackageVersion('1.0.0').isValid).toBe(true);
    expect(validatePackageVersion('12.34.56').isValid).toBe(true);
    expect(validatePackageVersion('0.0.0').isValid).toBe(true);
  });

  it('rejects invalid, leading-zero, incomplete, or malformed version strings', () => {
    expect(validatePackageVersion('').isValid).toBe(false);
    expect(validatePackageVersion('01.0.0').isValid).toBe(false);
    expect(validatePackageVersion('1.02.0').isValid).toBe(false);
    expect(validatePackageVersion('1.0.03').isValid).toBe(false);
    expect(validatePackageVersion('1.0').isValid).toBe(false);
    expect(validatePackageVersion('1.0.0.0').isValid).toBe(false);
    expect(validatePackageVersion('v1.0.0').isValid).toBe(false);
    expect(validatePackageVersion('1.0.0-rc.1').isValid).toBe(false);
    expect(validatePackageVersion('1.0.x').isValid).toBe(false);
  });
});

describe('Pre-read Directory Safety Inspection (inspectDirectoryEntriesBeforeReading)', () => {
  const expected5Files = new Set([
    'md-tech-slide-0.1.0.vsix',
    'sample.pptx',
    'sample.pdf',
    'checksums.txt',
    'release-manifest.json',
  ]);

  it('fails before reading when the artifacts directory itself is a symlink', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-real-dir-'));
    const linkDir = path.join(os.tmpdir(), `md-tech-link-dir-${Date.now()}`);
    try {
      fs.symlinkSync(realDir, linkDir);
      const res = inspectDirectoryEntriesBeforeReading(linkDir, expected5Files);
      expect(res.isSuccess).toBe(false);
      expect(res.error).toContain('Artifacts directory is a symbolic link');
    } finally {
      try {
        fs.unlinkSync(linkDir);
      } catch {
        // ignore
      }
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when the artifacts directory path is a regular file', () => {
    const tempFile = path.join(os.tmpdir(), `md-tech-file-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tempFile, 'not a dir');
      const res = inspectDirectoryEntriesBeforeReading(tempFile, expected5Files);
      expect(res.isSuccess).toBe(false);
      expect(res.error).toContain('Artifacts directory path is not a directory');
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  });

  it('fails before reading when the artifacts directory does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), `md-tech-nonexistent-${Date.now()}`);
    const res = inspectDirectoryEntriesBeforeReading(nonExistent, expected5Files);
    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain('Artifacts directory not found or inaccessible');
  });

  it('succeeds when all 5 regular files exist with no extra files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-inspect-test-ok-'));
    try {
      for (const f of expected5Files) {
        fs.writeFileSync(path.join(tempDir, f), 'content');
      }
      const res = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(res.isSuccess).toBe(true);
      expect(res.actualDirEntries).toHaveLength(5);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when a directory entry is a symlink', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-inspect-test-sym-'));
    try {
      const realTarget = path.join(tempDir, 'real-file.txt');
      fs.writeFileSync(realTarget, 'real');
      for (const f of expected5Files) {
        if (f === 'checksums.txt') {
          fs.symlinkSync(realTarget, path.join(tempDir, f));
        } else {
          fs.writeFileSync(path.join(tempDir, f), 'content');
        }
      }
      const res = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(res.isSuccess).toBe(false);
      expect(res.error).toContain('Symbolic link found in artifacts: "checksums.txt"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when a directory exists in artifacts', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-inspect-test-dir-'));
    try {
      for (const f of expected5Files) {
        fs.writeFileSync(path.join(tempDir, f), 'content');
      }
      fs.mkdirSync(path.join(tempDir, 'subfolder'));
      const res = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(res.isSuccess).toBe(false);
      expect(res.error).toContain('Directory found in artifacts: entry');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Checksums Content Parsing (parseChecksumsContent)', () => {
  it('parses valid 3-entry checksums with single or double space and trailing newline', () => {
    const content =
      [
        '1111111111111111111111111111111111111111111111111111111111111111  md-tech-slide-0.1.0.vsix',
        '2222222222222222222222222222222222222222222222222222222222222222 sample.pptx',
        '3333333333333333333333333333333333333333333333333333333333333333  sample.pdf',
      ].join('\n') + '\n';

    const res = parseChecksumsContent(content);
    expect(res.isSuccess).toBe(true);
    expect(res.entries).toHaveLength(3);
    expect(res.entries?.[0].fileName).toBe('md-tech-slide-0.1.0.vsix');
  });

  it('rejects empty or whitespace-only checksums content', () => {
    expect(parseChecksumsContent('').isSuccess).toBe(false);
    expect(parseChecksumsContent('   \n\n').isSuccess).toBe(false);
  });

  it('rejects invalid hash length or non-hex characters', () => {
    const invalidHash = 'not-a-hash  sample.pptx\n';
    expect(parseChecksumsContent(invalidHash).isSuccess).toBe(false);
  });

  it('rejects duplicate entries with fixed non-leaking message and does not leak sentinel filename', () => {
    const sentinelFile = 'SECRET_SENTINEL_DUP_FILE_999.bin';
    const dupContent =
      [
        '1111111111111111111111111111111111111111111111111111111111111111  md-tech-slide-0.1.0.vsix',
        `2222222222222222222222222222222222222222222222222222222222222222  ${sentinelFile}`,
        `2222222222222222222222222222222222222222222222222222222222222222  ${sentinelFile}`,
      ].join('\n') + '\n';

    const res = parseChecksumsContent(dupContent);
    expect(res.isSuccess).toBe(false);
    expect(res.code).toBe('ERR_CHECKSUMS_DUPLICATE_ENTRY');
    expect(res.error).toBe('Duplicate entry detected in checksums.txt.');
    expect(res.error).not.toContain(sentinelFile);
  });
});

describe('Downloaded Artifacts CLI Execution (scripts/verify-downloaded-artifacts.js)', () => {
  const scriptPath = path.resolve(__dirname, '../scripts/verify-downloaded-artifacts.js');

  const calcHash = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

  const createValidFixture = (dir: string, packageName = 'md-tech-slide', version = '0.1.0') => {
    const vsixName = `${packageName}-${version}.vsix`;
    const vsixBuf = Buffer.from('dummy-vsix-content');
    const pptxBuf = Buffer.from('dummy-pptx-content');
    const pdfBuf = Buffer.from('dummy-pdf-content');

    fs.writeFileSync(path.join(dir, vsixName), vsixBuf);
    fs.writeFileSync(path.join(dir, 'sample.pptx'), pptxBuf);
    fs.writeFileSync(path.join(dir, 'sample.pdf'), pdfBuf);

    const vsixHash = calcHash(vsixBuf);
    const pptxHash = calcHash(pptxBuf);
    const pdfHash = calcHash(pdfBuf);

    const chkContent =
      [`${vsixHash}  ${vsixName}`, `${pptxHash}  sample.pptx`, `${pdfHash}  sample.pdf`].join(
        '\n'
      ) + '\n';
    fs.writeFileSync(path.join(dir, 'checksums.txt'), chkContent, 'utf-8');
    const chkHash = calcHash(Buffer.from(chkContent, 'utf-8'));

    const manifest = {
      manifestVersion: '1.0.0',
      tag: `v${version}-rc.1`,
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      packageName,
      packageVersion: version,
      isPrerelease: true,
      workflowRunId: 100,
      workflowRunAttempt: 1,
      artifacts: [
        {
          fileName: vsixName,
          sizeBytes: vsixBuf.length,
          sha256: vsixHash,
          type: 'extension',
        },
        {
          fileName: 'sample.pptx',
          sizeBytes: pptxBuf.length,
          sha256: pptxHash,
          type: 'sample-pptx',
        },
        { fileName: 'sample.pdf', sizeBytes: pdfBuf.length, sha256: pdfHash, type: 'sample-pdf' },
        {
          fileName: 'checksums.txt',
          sizeBytes: Buffer.byteLength(chkContent, 'utf-8'),
          sha256: chkHash,
          type: 'checksums',
        },
      ],
    };
    fs.writeFileSync(
      path.join(dir, 'release-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8'
    );
  };

  it('fails with exit code 1 when required environment variable PACKAGE_NAME is missing or invalid', () => {
    // Missing PACKAGE_NAME
    let errorCaught = false;
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: '', // missing
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      errorCaught = true;
      const status = (err as { status?: number }).status;
      expect(status).toBe(1);
    }
    expect(errorCaught).toBe(true);

    // Invalid PACKAGE_NAME (scoped name rejected by product contract)
    let invalidCaught = false;
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: '@scope/md-tech-slide', // invalid
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      invalidCaught = true;
      const status = (err as { status?: number }).status;
      expect(status).toBe(1);
    }
    expect(invalidCaught).toBe(true);
  });

  it('fails with exit code 1 when required environment variable PACKAGE_VERSION is missing', () => {
    let errorCaught = false;
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '', // missing
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      errorCaught = true;
      const status = (err as { status?: number }).status;
      expect(status).toBe(1);
    }
    expect(errorCaught).toBe(true);
  });

  it('fails with exit code 1 when PACKAGE_VERSION has leading zeros or invalid format', () => {
    let errorCaught = false;
    let stderrOutput = '';
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v01.0.0',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '01.0.0', // leading zero
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      errorCaught = true;
      const status = (err as { status?: number }).status;
      expect(status).toBe(1);
      stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(errorCaught).toBe(true);
    expect(stderrOutput).toContain('Invalid package version format');
  });

  it('fails with exit code 1 when TAG_NAME base version does not match PACKAGE_VERSION', () => {
    let errorCaught = false;
    let stderrOutput = '';
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.2.0-rc.1',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '0.1.0', // mismatch with v0.2.0-rc.1
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      errorCaught = true;
      const status = (err as { status?: number }).status;
      expect(status).toBe(1);
      stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(errorCaught).toBe(true);
    expect(stderrOutput).toContain('Tag and version verification failed');
  });

  it('fails before reading when the target artifacts directory itself is a symlink', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-cli-real-dir-'));
    const linkDir = path.join(os.tmpdir(), `md-tech-cli-link-dir-${Date.now()}`);
    try {
      createValidFixture(realDir);
      fs.symlinkSync(realDir, linkDir);

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, linkDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      expect(stderrOutput).toContain('Artifacts directory is a symbolic link');
    } finally {
      try {
        fs.unlinkSync(linkDir);
      } catch {
        // ignore
      }
      fs.rmSync(realDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when the target artifacts directory path is a regular file', () => {
    const tempFile = path.join(os.tmpdir(), `md-tech-cli-file-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tempFile, 'not a directory');

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempFile], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      expect(stderrOutput).toContain('Artifacts directory path is not a directory');
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  });

  it('fails before reading when the target artifacts directory does not exist', () => {
    const nonExistentDir = path.join(os.tmpdir(), `md-tech-cli-nonexistent-${Date.now()}`);

    let stderrOutput = '';
    try {
      execFileSync(process.execPath, [scriptPath, nonExistentDir], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0-rc.1',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(stderrOutput).toContain('Artifacts directory not found or inaccessible');
  });

  it('fails before reading JSON when release-manifest.json is a symlink (even if target is invalid JSON)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-symlink-manifest-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-outside-manifest-'));
    try {
      createValidFixture(tempDir);
      // manifestを削除し、外部の不正JSONファイルへのシンボリックリンクにする
      const manifestPath = path.join(tempDir, 'release-manifest.json');
      fs.unlinkSync(manifestPath);

      const invalidJsonTarget = path.join(outsideDir, 'corrupt-trap.txt');
      fs.writeFileSync(invalidJsonTarget, '{ invalid unparseable json... ');
      fs.symlinkSync(invalidJsonTarget, manifestPath);

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      expect(stderrOutput).toContain('Symbolic link found in artifacts: "release-manifest.json"');
      expect(stderrOutput).not.toContain('Failed to parse release-manifest.json');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when checksums.txt is a symlink', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-symlink-checksums-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-outside-checksums-'));
    try {
      createValidFixture(tempDir);
      const chkPath = path.join(tempDir, 'checksums.txt');
      fs.unlinkSync(chkPath);

      const targetFile = path.join(outsideDir, 'trap-target.txt');
      fs.writeFileSync(targetFile, 'fake');
      fs.symlinkSync(targetFile, chkPath);

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      expect(stderrOutput).toContain('Symbolic link found in artifacts: "checksums.txt"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('fails before reading when a binary artifact (sample.pdf) is a symlink', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-symlink-pdf-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-outside-pdf-'));
    try {
      createValidFixture(tempDir);
      const pdfPath = path.join(tempDir, 'sample.pdf');
      fs.unlinkSync(pdfPath);

      const targetFile = path.join(outsideDir, 'target.pdf');
      fs.writeFileSync(targetFile, 'pdf content');
      fs.symlinkSync(targetFile, pdfPath);

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      expect(stderrOutput).toContain('Symbolic link found in artifacts: "sample.pdf"');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('dynamically adapts expected VSIX name to PACKAGE_NAME with no hardcoded mismatch', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-custom-name-'));
    try {
      createValidFixture(tempDir, 'custom-slide', '1.2.3');

      const output = execFileSync(process.execPath, [scriptPath, tempDir], {
        env: {
          ...process.env,
          TAG_NAME: 'v1.2.3-rc.1',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'custom-slide',
          PACKAGE_VERSION: '1.2.3',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      expect(output).toContain(
        'All downloaded artifacts, checksums, and manifest verified successfully!'
      );
      expect(output).toContain('custom-slide-1.2.3.vsix');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('succeeds with exit code 0 when artifacts directory is fully valid', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-release-test-'));
    try {
      createValidFixture(tempDir);

      const output = execFileSync(process.execPath, [scriptPath, tempDir], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0-rc.1',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      expect(output).toContain(
        'All downloaded artifacts, checksums, and manifest verified successfully!'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with exit code 1 when unexpected hidden file exists in directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-release-test-extra-'));
    try {
      createValidFixture(tempDir);

      // 余計な隠しファイルを追加
      fs.writeFileSync(path.join(tempDir, '.hidden_leak'), 'leaked');

      let errorCaught = false;
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        errorCaught = true;
        const status = (err as { status?: number }).status;
        expect(status).toBe(1);
      }
      expect(errorCaught).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not leak local absolute path into stdout or stderr during successful execution', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-cli-leak-free-'));
    try {
      createValidFixture(tempDir);
      const output = execFileSync(process.execPath, [scriptPath, tempDir], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0-rc.1',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      expect(output).not.toContain(tempDir);
      expect(output).toContain('Verifying downloaded release artifacts...');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not leak unexpected or hidden sentinel filename into stderr', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-cli-sentinel-file-'));
    const sentinelFileName = 'SECRET_SENTINEL_FILE_999.tmp';
    try {
      createValidFixture(tempDir);
      fs.writeFileSync(path.join(tempDir, sentinelFileName), 'leak payload');

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }

      expect(stderrOutput).toContain('Unexpected or hidden file found in artifacts directory');
      expect(stderrOutput).not.toContain(sentinelFileName);
      expect(stderrOutput).not.toContain(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not leak unverified sentinel environment variables (TAG_NAME, PACKAGE_NAME) into stderr on error', () => {
    const sentinelTag = 'vSECRET_SENTINEL_TAG_123';
    let stderrOutput = '';
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: sentinelTag,
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: 'md-tech-slide',
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
    }

    expect(stderrOutput).toContain('Tag and version verification failed');
    expect(stderrOutput).not.toContain(sentinelTag);

    const sentinelPkgName = 'SECRET_SENTINEL_PKG_456!';
    let pkgStderr = '';
    try {
      execFileSync(process.execPath, [scriptPath, '.'], {
        env: {
          ...process.env,
          TAG_NAME: 'v0.1.0',
          COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
          PACKAGE_NAME: sentinelPkgName,
          PACKAGE_VERSION: '0.1.0',
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_ATTEMPT: '1',
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      pkgStderr = String((err as { stderr?: Buffer }).stderr ?? '');
    }

    expect(pkgStderr).toContain('Invalid package name format');
    expect(pkgStderr).not.toContain(sentinelPkgName);
  });

  it('fails with safe message and does not leak stack trace or sentinel on invalid JSON manifest', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-cli-invalid-json-'));
    const sentinelInJson = 'SENTINEL_SECRET_TOKEN_IN_JSON_789';
    try {
      createValidFixture(tempDir);
      const manifestPath = path.join(tempDir, 'release-manifest.json');
      fs.writeFileSync(manifestPath, `{ "broken": "${sentinelInJson}" invalid syntax...`);

      let stderrOutput = '';
      try {
        execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }

      expect(stderrOutput).toContain('Failed to parse release-manifest.json (invalid JSON)');
      expect(stderrOutput).not.toContain(sentinelInJson);
      expect(stderrOutput).not.toContain('SyntaxError');
      expect(stderrOutput).not.toContain('at JSON.parse');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with safe message and does not leak sentinel or line content when duplicate entry exists in checksums.txt', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-cli-dup-checksums-'));
    const sentinelFile = 'SECRET_SENTINEL_DUP_FILE_999.bin';
    const sentinelHash = '2222222222222222222222222222222222222222222222222222222222222222';
    try {
      createValidFixture(tempDir);

      const vsixBuf = fs.readFileSync(path.join(tempDir, 'md-tech-slide-0.1.0.vsix'));
      const pptxBuf = fs.readFileSync(path.join(tempDir, 'sample.pptx'));
      const pdfBuf = fs.readFileSync(path.join(tempDir, 'sample.pdf'));
      const vsixHash = calcHash(vsixBuf);
      const pptxHash = calcHash(pptxBuf);
      const pdfHash = calcHash(pdfBuf);

      const dupChkContent =
        [
          `${vsixHash}  md-tech-slide-0.1.0.vsix`,
          `${pptxHash}  sample.pptx`,
          `${pdfHash}  sample.pdf`,
          `${sentinelHash}  ${sentinelFile}`,
          `${sentinelHash}  ${sentinelFile}`,
        ].join('\n') + '\n';
      fs.writeFileSync(path.join(tempDir, 'checksums.txt'), dupChkContent, 'utf-8');

      // 改変後checksums.txtのサイズとSHA-256をmanifestへ反映し、先行するサイズ/ハッシュ不一致を回避
      const chkBuf = Buffer.from(dupChkContent, 'utf-8');
      const chkHash = calcHash(chkBuf);
      const manifestPath = path.join(tempDir, 'release-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const chkItem = manifest.artifacts.find(
        (a: { fileName: string }) => a.fileName === 'checksums.txt'
      );
      if (chkItem) {
        chkItem.sizeBytes = chkBuf.length;
        chkItem.sha256 = chkHash;
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

      let stderrOutput = '';
      let stdoutOutput = '';
      try {
        stdoutOutput = execFileSync(process.execPath, [scriptPath, tempDir], {
          env: {
            ...process.env,
            TAG_NAME: 'v0.1.0-rc.1',
            COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
            PACKAGE_NAME: 'md-tech-slide',
            PACKAGE_VERSION: '0.1.0',
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
          },
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } catch (err: unknown) {
        stderrOutput = String((err as { stderr?: Buffer }).stderr ?? '');
      }

      expect(stderrOutput).toContain(
        'checksums.txt validation failed: Duplicate entry detected in checksums.txt.'
      );
      expect(stderrOutput).not.toContain('Size mismatch');
      expect(stderrOutput).not.toContain('SHA-256 hash mismatch');
      expect(stderrOutput).not.toContain(sentinelFile);
      expect(stderrOutput).not.toContain(sentinelHash);
      expect(stderrOutput).not.toContain(tempDir);
      expect(stdoutOutput).not.toContain(sentinelFile);
      expect(stdoutOutput).not.toContain(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('Helper Exception Handling & Code Sanitization (Mock Tests)', () => {
  const expected5Files = new Set([
    'md-tech-slide-0.1.0.vsix',
    'sample.pptx',
    'sample.pdf',
    'checksums.txt',
    'release-manifest.json',
  ]);

  it('inspectDirectoryEntriesBeforeReading: sanitizes readdirSync exceptions to ERR_DIR_READ_FAILED with no raw message leak', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-mock-readdir-'));
    try {
      const eaccesErr = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementationOnce(() => {
        throw eaccesErr;
      });

      const resEacces = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(resEacces.isSuccess).toBe(false);
      expect(resEacces.code).toBe('ERR_DIR_READ_FAILED');
      expect(resEacces.error).toBe('Failed to read artifacts directory (EACCES).');
      expect(resEacces.error).not.toContain('Permission denied');

      const unknownErr = new Error('Sensitive database socket error: 10.0.0.1');
      readdirSpy.mockImplementationOnce(() => {
        throw unknownErr;
      });

      const resUnknown = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(resUnknown.isSuccess).toBe(false);
      expect(resUnknown.code).toBe('ERR_DIR_READ_FAILED');
      expect(resUnknown.error).toBe(
        'Failed to read artifacts directory (ERR_FS_OPERATION_FAILED).'
      );
      expect(resUnknown.error).not.toContain('Sensitive database');
      expect(resUnknown.error).not.toContain('10.0.0.1');

      readdirSpy.mockRestore();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('inspectDirectoryEntriesBeforeReading: sanitizes lstatSync entry exceptions to ERR_ENTRY_INSPECT_FAILED with no path leak', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tech-mock-lstat-'));
    try {
      fs.writeFileSync(path.join(tempDir, 'sample.pdf'), 'dummy');
      const originalLstat = fs.lstatSync;

      const epermErr = Object.assign(new Error('Operation not permitted on secret path'), {
        code: 'EPERM',
      });
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(((
        targetPath: fs.PathLike,
        options?: fs.StatOptions
      ) => {
        if (typeof targetPath === 'string' && targetPath.endsWith('sample.pdf')) {
          throw epermErr;
        }
        return originalLstat(targetPath, options);
      }) as typeof fs.lstatSync);

      const res = inspectDirectoryEntriesBeforeReading(tempDir, expected5Files);
      expect(res.isSuccess).toBe(false);
      expect(res.code).toBe('ERR_ENTRY_INSPECT_FAILED');
      expect(res.error).toBe('Failed to inspect directory entry (EPERM).');
      expect(res.error).not.toContain('Operation not permitted on secret path');
      expect(res.error).not.toContain('sample.pdf');
      expect(res.error).not.toContain(tempDir);

      lstatSpy.mockRestore();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('readArtifactFile: catches readFileSync exceptions and returns ERR_FILE_READ_FAILED with code only', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Hardware I/O error on disk 4'), { code: 'EIO' });
    });

    const res = readArtifactFile('/fake/path/release-manifest.json', 'release manifest');
    expect(res.isSuccess).toBe(false);
    expect(res.code).toBe('ERR_FILE_READ_FAILED');
    expect(res.error).toBe('Failed to read release manifest (EIO).');
    expect(res.error).not.toContain('Hardware I/O error');
    expect(res.error).not.toContain('/fake/path');

    readSpy.mockRestore();
  });

  it('collectArtifactStats: catches statSync / calculateSha256 exceptions and returns ERR_HASH_CALCULATION_FAILED', () => {
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('Permission denied on binary artifact'), { code: 'EACCES' });
    });

    const res = collectArtifactStats('/fake/path/sample.pptx', 'sample presentation (PPTX)');
    expect(res.isSuccess).toBe(false);
    expect(res.code).toBe('ERR_HASH_CALCULATION_FAILED');
    expect(res.error).toBe(
      'Failed to calculate artifact hash for sample presentation (PPTX) (EACCES).'
    );
    expect(res.error).not.toContain('Permission denied');
    expect(res.error).not.toContain('/fake/path');

    statSpy.mockRestore();
  });
});

describe('Release Workflow Packaging and Name Alignment (.github/workflows/release.yml)', () => {
  it('statically ensures release.yml checks out target SHA and passes PACKAGE_NAME and PACKAGE_VERSION to verify CLI', () => {
    const workflowPath = path.resolve(__dirname, '../.github/workflows/release.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const content = fs.readFileSync(workflowPath, 'utf-8');

    // 1. target SHA checkout
    expect(content).toContain('ref: ${{ github.sha }}');

    // 2. package.json reading both name and version
    expect(content).toContain('Read package name and version from checked out package.json');
    expect(content).toContain('PACKAGE_NAME=');
    expect(content).toContain('PACKAGE_VERSION=');

    // 3. Passing both variables to verification script
    expect(content).toContain('PACKAGE_NAME: ${{ env.PACKAGE_NAME }}');
    expect(content).toContain('PACKAGE_VERSION: ${{ env.PACKAGE_VERSION }}');
    expect(content).toContain('node scripts/verify-downloaded-artifacts.js');
  });
});
