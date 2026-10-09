import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  readAllDiagnosticEnvelopes,
  aggregateDiagnostics,
  formatDiagnosticsSummary,
} from './diagnostics-collector.js';
import {
  readAllFingerprintRecords,
  readAllWorkerManifests,
  readAllWorkerRegistrations,
} from './browser-failure-fingerprint.js';
import { aggregateFingerprintsAndCorrelate } from './diagnostics-aggregator.js';

let diagnosticsRootDir: string | null = null;

export async function setup(): Promise<void> {
  const randomRunId = `md-tech-slide-diag-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  diagnosticsRootDir = process.env.__MD_TEST_DIAG_DIR__ || path.join(os.tmpdir(), randomRunId);

  fs.mkdirSync(path.join(diagnosticsRootDir, 'registry'), { recursive: true });
  fs.mkdirSync(path.join(diagnosticsRootDir, 'diagnostics'), { recursive: true });
  fs.mkdirSync(path.join(diagnosticsRootDir, 'fingerprints'), { recursive: true });
  fs.mkdirSync(path.join(diagnosticsRootDir, 'manifests'), { recursive: true });

  process.env.__MD_TEST_DIAG_DIR__ = diagnosticsRootDir;
}

export function auditDiagnosticsIntegrity(diagnosticsRootDir: string): Error[] {
  const errors: Error[] = [];
  const registryDir = path.join(diagnosticsRootDir, 'registry');
  const diagnosticsDir = path.join(diagnosticsRootDir, 'diagnostics');
  const fingerprintsDir = path.join(diagnosticsRootDir, 'fingerprints');
  const manifestsDir = path.join(diagnosticsRootDir, 'manifests');

  const regResult = readAllWorkerRegistrations(registryDir);
  const manifestResult = readAllWorkerManifests(manifestsDir);

  if (regResult.invalidFileCount > 0) {
    errors.push(
      new Error(
        `Integrity failure: ${regResult.invalidFileCount} invalid worker registration files found`
      )
    );
  }
  if (regResult.duplicateWorkerKeyCount > 0) {
    errors.push(
      new Error(
        `Integrity failure: ${regResult.duplicateWorkerKeyCount} duplicate worker registration keys found`
      )
    );
  }
  if (manifestResult.invalidFileCount > 0) {
    errors.push(
      new Error(
        `Integrity failure: ${manifestResult.invalidFileCount} invalid worker manifest files found`
      )
    );
  }
  if (manifestResult.duplicateWorkerKeyCount > 0) {
    errors.push(
      new Error(
        `Integrity failure: ${manifestResult.duplicateWorkerKeyCount} duplicate worker manifest keys found`
      )
    );
  }

  const registrations = regResult.records;
  const manifests = manifestResult.records;

  const registeredKeys = new Set(registrations.map((r) => `${r.workerId}:${r.processInstanceId}`));
  const manifestMap = new Map<string, (typeof manifests)[number]>();
  for (const m of manifests) {
    manifestMap.set(`${m.workerId}:${m.processInstanceId}`, m);
  }

  // Check orphaned manifests
  for (const m of manifests) {
    const key = `${m.workerId}:${m.processInstanceId}`;
    if (!registeredKeys.has(key)) {
      errors.push(new Error('Integrity failure: orphaned worker manifest found'));
    }
  }

  // 2. Read diagnostic envelopes and validate
  const { envelopes, invalidCount: invalidEnvelopes } = readAllDiagnosticEnvelopes(diagnosticsDir);
  if (invalidEnvelopes > 0) {
    errors.push(
      new Error(`Integrity failure: ${invalidEnvelopes} invalid diagnostic envelopes found`)
    );
  }

  // 3. Read fingerprint records and validate
  const { records: fingerprints, invalidCount: invalidFingerprints } =
    readAllFingerprintRecords(fingerprintsDir);
  if (invalidFingerprints > 0) {
    errors.push(
      new Error(`Integrity failure: ${invalidFingerprints} invalid fingerprint records found`)
    );
  }

  // 4. Worker-by-worker integrity checks
  for (const reg of registrations) {
    const key = `${reg.workerId}:${reg.processInstanceId}`;
    const m = manifestMap.get(key);
    if (!m) {
      errors.push(new Error('Integrity failure: registered worker is missing final manifest'));
      continue;
    }

    if (!m.flushed) {
      errors.push(new Error('Integrity failure: worker manifest was not flushed'));
    }
    if (m.diagnosticWriterFailureCount > 0) {
      errors.push(new Error('Integrity failure: diagnostic writer failures occurred'));
    }
    if (m.fingerprintWriterFailureCount > 0) {
      errors.push(new Error('Integrity failure: fingerprint writer failures occurred'));
    }
    if (m.liveBrowserProcessCountAtTeardown > 0) {
      errors.push(new Error('Integrity failure: live browser process remained at teardown'));
    }
    if (m.unreleasedBrowserProcessCount > 0) {
      errors.push(new Error('Integrity failure: unreleased browser process resources found'));
    }
    if (m.expectedDiagnosticRecordCount !== m.writtenDiagnosticRecordCount) {
      errors.push(new Error('Integrity failure: diagnostic record count expectation mismatch'));
    }
    if (m.expectedFingerprintRecordCount !== m.writtenFingerprintRecordCount) {
      errors.push(new Error('Integrity failure: fingerprint record count expectation mismatch'));
    }
    if (m.finalizedAttemptCount !== m.writtenFingerprintRecordCount) {
      errors.push(
        new Error(
          'Integrity failure: finalized attempt count does not match written fingerprint count'
        )
      );
    }

    // Check corresponding diagnostic file exists and line count matches
    const diagFileName = `diag-worker-${reg.workerId}-${reg.processInstanceId}.jsonl`;
    const diagFilePath = path.join(diagnosticsDir, diagFileName);
    if (!fs.existsSync(diagFilePath)) {
      errors.push(
        new Error('Integrity failure: missing diagnostic events file for registered worker')
      );
    } else {
      const workerEnvelopes = envelopes.filter(
        (e) => e.workerId === reg.workerId && e.processInstanceId === reg.processInstanceId
      );
      if (workerEnvelopes.length !== m.writtenDiagnosticRecordCount) {
        errors.push(new Error('Integrity failure: worker diagnostic record count mismatch'));
      }
    }

    // Check corresponding fingerprint file exists and line count matches
    const fpFileName = `fingerprint-worker-${reg.workerId}-${reg.processInstanceId}.jsonl`;
    const fpFilePath = path.join(fingerprintsDir, fpFileName);
    if (!fs.existsSync(fpFilePath)) {
      errors.push(
        new Error('Integrity failure: missing fingerprint sidecar file for registered worker')
      );
    } else {
      const workerFpRecords = fingerprints.filter(
        (r) => r.workerId === reg.workerId && r.processInstanceId === reg.processInstanceId
      );
      if (workerFpRecords.length !== m.writtenFingerprintRecordCount) {
        errors.push(new Error('Integrity failure: worker fingerprint record count mismatch'));
      }
    }
  }

  // Check for orphaned diagnostic files (not matching registered worker)
  if (fs.existsSync(diagnosticsDir)) {
    try {
      const diagFiles = fs.readdirSync(diagnosticsDir).filter((f) => f.endsWith('.jsonl'));
      const expectedDiagFiles = new Set(
        registrations.map((r) => `diag-worker-${r.workerId}-${r.processInstanceId}.jsonl`)
      );
      for (const df of diagFiles) {
        if (!expectedDiagFiles.has(df)) {
          errors.push(new Error('Integrity failure: orphaned diagnostic file found'));
        }
      }
    } catch {
      errors.push(new Error('Integrity failure: directory read failure occurred'));
    }
  }

  // Check for orphaned fingerprint files (not matching registered worker)
  if (fs.existsSync(fingerprintsDir)) {
    try {
      const fpFiles = fs.readdirSync(fingerprintsDir).filter((f) => f.endsWith('.jsonl'));
      const expectedFpFiles = new Set(
        registrations.map((r) => `fingerprint-worker-${r.workerId}-${r.processInstanceId}.jsonl`)
      );
      for (const ff of fpFiles) {
        if (!expectedFpFiles.has(ff)) {
          errors.push(new Error('Integrity failure: orphaned fingerprint file found'));
        }
      }
    } catch {
      errors.push(new Error('Integrity failure: directory read failure occurred'));
    }
  }

  // 5. Total counts check
  const totalExpectedDiag = manifests.reduce((acc, m) => acc + m.writtenDiagnosticRecordCount, 0);
  const totalExpectedFp = manifests.reduce((acc, m) => acc + m.writtenFingerprintRecordCount, 0);
  if (envelopes.length !== totalExpectedDiag) {
    errors.push(new Error('Integrity failure: total written diagnostic record count mismatch'));
  }
  if (fingerprints.length !== totalExpectedFp) {
    errors.push(new Error('Integrity failure: total written fingerprint record count mismatch'));
  }

  // 6. Correlate and aggregate
  let fpFileCount: number;
  try {
    fpFileCount = fs.existsSync(fingerprintsDir) ? fs.readdirSync(fingerprintsDir).length : 0;
  } catch {
    fpFileCount = 0;
  }

  const fpSummary = aggregateFingerprintsAndCorrelate(
    fingerprints,
    envelopes,
    manifests,
    invalidFingerprints,
    fpFileCount
  );

  if (fpSummary.duplicateCorrelationKeyCount > 0) {
    errors.push(
      new Error('Integrity failure: duplicate correlation keys detected in fingerprints')
    );
  }
  if (fpSummary.orphanedFingerprintRecordCount > 0) {
    errors.push(new Error('Integrity failure: orphaned fingerprint records detected'));
  }
  if (fpSummary.missingFingerprintAttemptCount > 0) {
    errors.push(new Error('Integrity failure: missing fingerprint records for attempts'));
  }

  // Print summary if failures detected or verbose enabled
  if (envelopes.length > 0) {
    const summary = aggregateDiagnostics(envelopes, manifests);
    const hasFailures = Object.keys(summary.failureStageCounts).length > 0 || errors.length > 0;
    const forcePrint = process.env.VERBOSE_DIAGNOSTICS === 'true';

    if (hasFailures || forcePrint) {
      console.log('\n' + formatDiagnosticsSummary(summary) + '\n');
    }
  }

  return errors;
}

export interface TeardownOptions {
  diagnosticsRootDir?: string;
  auditFn?: (dir: string) => Error[];
  cleanupFn?: (dir: string) => void;
  preserveDiagnostics?: boolean;
}

export async function teardown(options?: TeardownOptions): Promise<void> {
  const diagnosticsRootDir = options?.diagnosticsRootDir ?? process.env.__MD_TEST_DIAG_DIR__;
  if (!diagnosticsRootDir) {
    return;
  }

  const errors: Error[] = [];

  try {
    const auditErrors = options?.auditFn
      ? options.auditFn(diagnosticsRootDir)
      : auditDiagnosticsIntegrity(diagnosticsRootDir);
    for (let index = 0; index < auditErrors.length; index += 1) {
      errors.push(new Error('Integrity failure: audit failure occurred'));
    }
  } catch {
    errors.push(new Error('Integrity failure: unexpected audit failure occurred'));
  } finally {
    try {
      const preserve = options?.preserveDiagnostics ?? process.env.PRESERVE_DIAGNOSTICS === 'true';
      if (preserve) {
        console.log('Diagnostics preserved.');
      } else if (options?.cleanupFn) {
        options.cleanupFn(diagnosticsRootDir);
      } else if (diagnosticsRootDir && fs.existsSync(diagnosticsRootDir)) {
        fs.rmSync(diagnosticsRootDir, { recursive: true, force: true });
      }
    } catch {
      errors.push(new Error('Integrity failure: cleanup failure occurred'));
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  } else if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple teardown integrity assertion failures occurred');
  }
}
