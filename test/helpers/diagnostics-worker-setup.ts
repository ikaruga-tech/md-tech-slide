import { vi, afterEach, afterAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import '../../src/diagram/internal-diagnostics.js';
import type {
  InternalDiagnosticEvent,
  LaunchProcessDiagnostics,
} from '../../src/diagram/internal-diagnostics.js';
import {
  writeDiagnosticEnvelopeToJsonl,
  sanitizeDiagnosticEvent,
} from './diagnostics-collector.js';
import type { TestDiagnosticEnvelope } from './diagnostics-collector.js';
import { BrowserSpawnTracker } from './browser-spawn-adapter.js';
import {
  BrowserFailureFingerprintTracker,
  createDefaultSidecarFileWriter,
  writeWorkerRegistration,
  writeWorkerManifest,
} from './browser-failure-fingerprint.js';
import type { WorkerIntegrityManifest } from './browser-failure-fingerprint.js';

const tracker = new BrowserSpawnTracker();
const fpTracker = new BrowserFailureFingerprintTracker();
const asyncLocalStorage = new AsyncLocalStorage<string>();
let attemptCounter = 0;

const workerId = process.env.VITEST_WORKER_ID || '0';
const processInstanceId = `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
tracker.setFingerprintTracker(fpTracker, workerId, processInstanceId);

tracker.setActiveAttemptProvider(() => asyncLocalStorage.getStore());

vi.mock('@puppeteer/browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@puppeteer/browsers')>();
  return {
    ...actual,
    launch: tracker.wrapLaunch(actual.launch),
  };
});

const diagDir = process.env.__MD_TEST_DIAG_DIR__;
const setWriter = (globalThis as Record<string, unknown>)['__setWorkerDiagnosticsWriter'] as
  ((writer: ((event: InternalDiagnosticEvent) => void) | null) => void) | undefined;

let expectedDiagnosticRecordCount = 0;
let writtenDiagnosticRecordCount = 0;
let expectedFingerprintRecordCount = 0;
let writtenFingerprintRecordCount = 0;
let diagnosticWriterFailureCount = 0;
let fingerprintWriterFailureCount = 0;

let manifestsDir: string | null = null;

if (diagDir) {
  const registryDir = path.join(diagDir, 'registry');
  const diagnosticsDir = path.join(diagDir, 'diagnostics');
  const fingerprintsDir = path.join(diagDir, 'fingerprints');
  manifestsDir = path.join(diagDir, 'manifests');

  try {
    writeWorkerRegistration(registryDir, workerId, processInstanceId);
  } catch {
    throw new Error('Failed to initialize worker diagnostics registry');
  }

  const initialManifest: WorkerIntegrityManifest = {
    workerId,
    processInstanceId,
    expectedDiagnosticRecordCount: 0,
    writtenDiagnosticRecordCount: 0,
    expectedFingerprintRecordCount: 0,
    writtenFingerprintRecordCount: 0,
    finalizedAttemptCount: 0,
    diagnosticWriterFailureCount: 0,
    fingerprintWriterFailureCount: 0,
    observedBrowserProcessCount: 0,
    liveBrowserProcessCountAtTeardown: 0,
    unreleasedBrowserProcessCount: 0,
    flushed: false,
  };

  try {
    writeWorkerManifest(manifestsDir, initialManifest);
  } catch {
    throw new Error('Failed to initialize worker diagnostics manifest');
  }

  const diagFile = path.join(diagnosticsDir, `diag-worker-${workerId}-${processInstanceId}.jsonl`);
  try {
    fs.writeFileSync(diagFile, '', { flag: 'w' });
  } catch {
    throw new Error('Failed to initialize worker diagnostic events file');
  }

  const fpFile = path.join(
    fingerprintsDir,
    `fingerprint-worker-${workerId}-${processInstanceId}.jsonl`
  );
  try {
    fs.writeFileSync(fpFile, '', { flag: 'w' });
  } catch {
    throw new Error('Failed to initialize worker fingerprint sidecar file');
  }

  const baseFpWriter = createDefaultSidecarFileWriter(fingerprintsDir, workerId, processInstanceId);
  fpTracker.setWriter((record) => {
    expectedFingerprintRecordCount++;
    try {
      baseFpWriter(record);
      writtenFingerprintRecordCount++;
    } catch {
      fingerprintWriterFailureCount++;
      throw new Error('Fingerprint sidecar write failure');
    }
  });

  if (setWriter) {
    setWriter((event: InternalDiagnosticEvent) => {
      expectedDiagnosticRecordCount++;
      try {
        const sanitized = sanitizeDiagnosticEvent(event);
        const activeAttemptId = asyncLocalStorage.getStore();
        let envelope: TestDiagnosticEnvelope;

        if (activeAttemptId) {
          envelope = {
            scope: 'attempt',
            workerId,
            processInstanceId,
            attemptId: activeAttemptId,
            correlationKey: `${workerId}:${processInstanceId}:${activeAttemptId}`,
            event: sanitized,
          };
        } else {
          envelope = {
            scope: 'lifecycle',
            workerId,
            processInstanceId,
            attemptId: null,
            correlationKey: null,
            event: sanitized,
          };
        }

        writeDiagnosticEnvelopeToJsonl(diagFile, envelope);
        writtenDiagnosticRecordCount++;
      } catch {
        diagnosticWriterFailureCount++;
      }
    });
  }
}

const setAttemptHooks = (globalThis as Record<string, unknown>)['__setLaunchAttemptHooks'] as
  | ((
      hooks: {
        runWithAttempt: <T>(fn: (attemptId: string) => Promise<T>) => Promise<T>;
        consumeDiagnostics: (attemptId: string) => LaunchProcessDiagnostics | undefined;
        cleanupAttempt: (attemptId: string) => void;
      } | null
    ) => void)
  | undefined;

if (setAttemptHooks) {
  setAttemptHooks({
    runWithAttempt: async <T>(fn: (attemptId: string) => Promise<T>): Promise<T> => {
      const attemptId = `attempt-${++attemptCounter}`;
      return asyncLocalStorage.run(attemptId, () => fn(attemptId));
    },
    consumeDiagnostics: (attemptId: string) => tracker.consumeDiagnostics(attemptId),
    cleanupAttempt: (attemptId: string) => tracker.cleanupAttempt(attemptId),
  });
}

const setModifier = (globalThis as Record<string, unknown>)['__setLaunchArgsModifier'] as
  ((modifier: ((args: string[]) => string[]) | null) => void) | undefined;

(globalThis as Record<string, unknown>)['__setControlledLaunchOverride'] = (
  override: ((options: unknown) => unknown) | null
) => {
  tracker.setControlledLaunchOverride(override);
};

afterEach(() => {
  const errors: unknown[] = [];

  // 1. 未回収 attempt 検査
  try {
    const pending = tracker.getPendingAttemptCount();
    expect(pending).toBe(0);
  } catch (err) {
    errors.push(err);
  }

  // 2. 未回収 fingerprint attempt 検査
  try {
    const pendingFp = fpTracker.getPendingCount();
    expect(pendingFp).toBe(0);
  } catch (err) {
    errors.push(err);
  }

  // 3. sidecar writer 失敗検査
  try {
    const writerFailures = fpTracker.getWriterFailureCount() + fingerprintWriterFailureCount;
    expect(writerFailures).toBe(0);
  } catch (err) {
    errors.push(err);
  }

  // 4. AsyncLocalStorage 漏洩検査
  try {
    expect(asyncLocalStorage.getStore()).toBeUndefined();
  } catch (err) {
    errors.push(err);
  }

  // 5. 失敗時クリーンアップと可変状態リセット
  try {
    if (
      tracker.getPendingAttemptCount() > 0 ||
      fpTracker.getPendingCount() > 0 ||
      errors.length > 0
    ) {
      tracker.clearAll();
      fpTracker.clearAll();
    }
  } catch (err) {
    errors.push(err);
  }

  try {
    tracker.setControlledLaunchOverride(null);
    if (setModifier) {
      setModifier(null);
    }
  } catch (err) {
    errors.push(err);
  }

  // 6. エラー再送出
  if (errors.length === 1) {
    throw errors[0];
  } else if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple afterEach assertion/cleanup failures occurred');
  }
});

afterAll(() => {
  if (manifestsDir) {
    try {
      const finalManifest: WorkerIntegrityManifest = {
        workerId,
        processInstanceId,
        expectedDiagnosticRecordCount,
        writtenDiagnosticRecordCount,
        expectedFingerprintRecordCount,
        writtenFingerprintRecordCount,
        finalizedAttemptCount: fpTracker.getFinalizedCount(),
        diagnosticWriterFailureCount,
        fingerprintWriterFailureCount,
        observedBrowserProcessCount: tracker.getObservedBrowserProcessCount(),
        liveBrowserProcessCountAtTeardown: tracker.getLiveBrowserProcessCount(),
        unreleasedBrowserProcessCount: tracker.getUnreleasedBrowserProcessCount(),
        flushed: true,
      };
      writeWorkerManifest(manifestsDir, finalManifest);
    } catch {
      // Manifest write error leaves flushed: false
    }
  }

  if (setAttemptHooks) {
    setAttemptHooks(null);
  }
  if (setWriter) {
    setWriter(null);
  }
  tracker.setControlledLaunchOverride(null);
  tracker.clearAll();
  fpTracker.clearAll();
});

(globalThis as Record<string, unknown>)['__getBrowserSpawnTrackerForTesting'] = () => tracker;
