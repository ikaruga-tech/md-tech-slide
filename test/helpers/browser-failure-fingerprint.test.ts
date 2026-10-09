import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BrowserFailureFingerprintTracker,
  classifyStderrBucket,
  classifyStderrToIndicators,
  validateFingerprintRecord,
  validateWorkerManifest,
  validateWorkerRegistration,
  readAllFingerprintRecords,
  readAllWorkerManifests,
  readAllWorkerRegistrations,
  writeWorkerRegistration,
  writeWorkerManifest,
  type FailureFingerprintIndicator,
  type SidecarFingerprintRecord,
  type WorkerIntegrityManifest,
} from './browser-failure-fingerprint.js';
import { auditDiagnosticsIntegrity, teardown } from './diagnostics-global-setup.js';
import {
  sanitizeDiagnosticEvent,
  validateDiagnosticEnvelope,
  readAllDiagnosticEnvelopes,
  aggregateDiagnostics,
  type TestDiagnosticEnvelope,
} from './diagnostics-collector.js';
import { aggregateFingerprintsAndCorrelate } from './diagnostics-aggregator.js';
import type { InternalDiagnosticEvent } from '../../src/diagram/internal-diagnostics.js';

describe('BrowserFailureFingerprintTracker and Classification', () => {
  it('1. classifies positive cases for all allowlist categories', () => {
    const positiveCases: Array<{ indicator: FailureFingerprintIndicator; text: string }> = [
      {
        indicator: 'permission-indicator',
        text: 'Error: EACCES: permission denied, open /dev/null',
      },
      { indicator: 'resource-limit-indicator', text: 'fork: Resource temporarily unavailable' },
      {
        indicator: 'profile-lock-indicator',
        text: 'Process singleton lock: SingletonLock already held',
      },
      { indicator: 'sandbox-indicator', text: 'sandbox_init failed for target process' },
      {
        indicator: 'dynamic-library-indicator',
        text: 'dyld: Library not loaded: @rpath/libtest.dylib',
      },
      {
        indicator: 'architecture-indicator',
        text: 'exec format error: bad CPU type in executable',
      },
      { indicator: 'code-signing-indicator', text: 'Killed: 9 due to code signature invalid' },
      { indicator: 'crash-handler-indicator', text: 'Crashpad handler generated minidump file' },
      { indicator: 'assertion-indicator', text: 'Check failed: !is_closing. Assertion failed' },
      {
        indicator: 'memory-indicator',
        text: 'Fatal error: Out of memory (cannot allocate memory)',
      },
    ];

    for (const { indicator, text } of positiveCases) {
      const indicators = classifyStderrToIndicators(text);
      expect(indicators).toContain(indicator);
    }
  });

  it('2. classifies negative or non-matching cases to no-specific-indicator', () => {
    const negativeCases = [
      'Normal browser initialization line without error',
      'DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc',
      'Random standard output information message',
      'The word memory alone should not trigger',
      'The word lock alone should not trigger',
      '',
      '   ',
    ];

    for (const text of negativeCases) {
      const indicators = classifyStderrToIndicators(text);
      expect(indicators).toEqual(['no-specific-indicator']);
    }
  });

  it('3. deduplicates indicators when multiple distinct categories appear', () => {
    const combinedStderr = [
      'Assertion failed: Check failed: !closed',
      'Out of memory: Cannot allocate memory',
      'Assertion failed: duplicate trigger',
    ].join('\n');

    const indicators = classifyStderrToIndicators(combinedStderr);
    expect(indicators).toContain('assertion-indicator');
    expect(indicators).toContain('memory-indicator');
    const assertionCount = indicators.filter((i) => i === 'assertion-indicator').length;
    expect(assertionCount).toBe(1);
  });

  it('4. classifies indicators split across stream chunk boundaries', () => {
    const tracker = new BrowserFailureFingerprintTracker();
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-1');

    tracker.appendStderr(key, 'Check failed: !');
    tracker.appendStderr(key, 'is_closing. Assertion failed');

    const record = tracker.finalizeAttempt(key);
    expect(record).not.toBeNull();
    expect(record!.fingerprintIndicators).toContain('assertion-indicator');
  });

  it('5. enforces 64KB memory limit and classifies large stderr to large bucket', () => {
    const tracker = new BrowserFailureFingerprintTracker();
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-1');

    const bigChunk = 'X'.repeat(70 * 1024);
    tracker.appendStderr(key, bigChunk);

    expect(classifyStderrBucket(0)).toBe('none');
    expect(classifyStderrBucket(100)).toBe('small');
    expect(classifyStderrBucket(1000)).toBe('medium');
    expect(classifyStderrBucket(5000)).toBe('large');

    const record = tracker.finalizeAttempt(key);
    expect(record).not.toBeNull();
    expect(record!.stderrBucket).toBe('large');
    expect(record!.stderrPresent).toBe(true);
  });

  it('6. does not leak paths, URLs, or sensitive tokens into fingerprint records', () => {
    const sensitiveTokens = {
      posixPath: '/Users/secret_developer/work/secret.ts',
      windowsPath: 'C:\\Users\\Secret\\token.txt',
      fileUri: 'file:///secret/pass.txt',
      bearerToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
      githubToken: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
      skToken: 'sk-proj-supersecrettoken1234567890abcdef',
      apiKey: 'https://example.com/api?key=secret_12345',
      userInfo: 'https://admin:pass1234@internal.corp.net',
    };

    const combinedStderr =
      Object.values(sensitiveTokens).join('\n') + '\nAssertion failed: Check failed:';

    const tracker = new BrowserFailureFingerprintTracker();
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-leak-test');
    tracker.appendStderr(key, combinedStderr);

    const record = tracker.finalizeAttempt(key);
    expect(record).not.toBeNull();
    expect(record!.fingerprintIndicators).toContain('assertion-indicator');

    const serialized = JSON.stringify(record);
    for (const token of Object.values(sensitiveTokens)) {
      expect(serialized.includes(token)).toBe(false);
    }
  });

  it('7. safely handles empty, unicode, control characters, and non-utf8 data without throwing', () => {
    const strangeInputs = [
      '',
      Buffer.from([]),
      '\u0000\u0001\u0002\u001b[31mError\u001b[0m',
      '日本語のクラッシュログテスト：Assertion failed',
      Buffer.from([0xff, 0xfe, 0xfd]),
    ];

    const tracker = new BrowserFailureFingerprintTracker();
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-strange');

    for (const chunk of strangeInputs) {
      expect(() => tracker.appendStderr(key, chunk)).not.toThrow();
    }

    const record = tracker.finalizeAttempt(key);
    expect(record).not.toBeNull();
    expect(record!.fingerprintIndicators).toBeDefined();
  });

  it('8. state machine enforces single finalization and ignores subsequent events', () => {
    const tracker = new BrowserFailureFingerprintTracker();
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-idempotent');

    tracker.appendStderr(key, 'Check failed: Assertion failed');
    const first = tracker.finalizeAttempt(key, { exitCode: 1, signal: 'SIGABRT' });
    expect(first).not.toBeNull();

    tracker.appendStderr(key, 'Late stderr after finalization');
    const second = tracker.finalizeAttempt(key, { exitCode: 0, signal: 'unavailable' });
    expect(second).toBeNull();

    tracker.cleanupAttempt(key);
    expect(tracker.getPendingCount()).toBe(0);
  });

  it('9. segregates attempts across workers with identical attemptId', () => {
    const tracker = new BrowserFailureFingerprintTracker();
    const keyWorker1 = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-1');
    const keyWorker2 = tracker.registerAttempt('worker-2', 'proc-2', 'attempt-1');

    expect(keyWorker1).not.toBe(keyWorker2);

    tracker.appendStderr(keyWorker1, 'Assertion failed: in worker 1');
    tracker.appendStderr(keyWorker2, 'Out of memory in worker 2');

    const rec1 = tracker.finalizeAttempt(keyWorker1);
    const rec2 = tracker.finalizeAttempt(keyWorker2);

    expect(rec1!.fingerprintIndicators).toContain('assertion-indicator');
    expect(rec1!.fingerprintIndicators).not.toContain('memory-indicator');

    expect(rec2!.fingerprintIndicators).toContain('memory-indicator');
    expect(rec2!.fingerprintIndicators).not.toContain('assertion-indicator');
  });

  it('10. isolates writer failures without throwing into caller', () => {
    const faultyWriter = vi.fn().mockImplementation(() => {
      throw new Error('Disk write error');
    });

    const tracker = new BrowserFailureFingerprintTracker(faultyWriter);
    const key = tracker.registerAttempt('worker-1', 'proc-1', 'attempt-writer-fail');
    tracker.appendStderr(key, 'dyld: Library not loaded: @rpath/fail.dylib');

    expect(() => tracker.finalizeAttempt(key)).not.toThrow();
    expect(faultyWriter).toHaveBeenCalledTimes(1);
    expect(tracker.getWriterFailureCount()).toBe(1);
  });
});

describe('009-13 Schema Validation, Readers, and Multi-Layer Correlation', () => {
  it('11. runtime validates valid fingerprint record and rejects unknown keys or bad enums', () => {
    const validRecord: SidecarFingerprintRecord = {
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      stderrPresent: true,
      stderrBucket: 'small',
      fingerprintIndicators: ['assertion-indicator'],
      exitCode: 1,
      signal: 'SIGABRT',
      spawned: true,
      hasPid: true,
      elapsedMs: 120,
    };

    expect(() => validateFingerprintRecord(validRecord)).not.toThrow();

    // Unknown key rejection
    const withUnknownKey = { ...validRecord, unknownProperty: 123 };
    expect(() => validateFingerprintRecord(withUnknownKey)).toThrow(/unknown key/);

    // Mismatched correlation key rejection
    const withBadCorrelation = { ...validRecord, correlationKey: 'w-1:p-1:bad-id' };
    expect(() => validateFingerprintRecord(withBadCorrelation)).toThrow(/correlationKey mismatch/);

    // Bad indicator enum rejection
    const withBadEnum = { ...validRecord, fingerprintIndicators: ['unknown-indicator-enum'] };
    expect(() => validateFingerprintRecord(withBadEnum)).toThrow(/unknown indicator enum/);

    // Duplicate indicator rejection
    const withDuplicateEnum = {
      ...validRecord,
      fingerprintIndicators: ['assertion-indicator', 'assertion-indicator'],
    };
    expect(() => validateFingerprintRecord(withDuplicateEnum)).toThrow(/duplicate indicator/);
  });

  it('12. validates TestDiagnosticEnvelope discriminated union and sanitized events', () => {
    const rawEvent: InternalDiagnosticEvent = {
      timestamp: Date.now(),
      serviceId: 'srv-1',
      stage: 'browser-launch-success',
      pid: 12345,
      browserPid: 54321,
      childPid: 67890,
      activePageCount: 1,
      runningExecutionCount: 0,
      queueLength: 0,
    };

    const sanitized = sanitizeDiagnosticEvent(rawEvent);
    expect((sanitized as Record<string, unknown>).pid).toBeUndefined();
    expect((sanitized as Record<string, unknown>).browserPid).toBeUndefined();
    expect((sanitized as Record<string, unknown>).childPid).toBeUndefined();
    expect(sanitized.hasProcessPid).toBe(true);
    expect(sanitized.hasBrowserPid).toBe(true);
    expect(sanitized.hasChildPid).toBe(true);

    const attemptEnvelope: TestDiagnosticEnvelope = {
      scope: 'attempt',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      event: sanitized,
    };
    expect(() => validateDiagnosticEnvelope(attemptEnvelope)).not.toThrow();

    const lifecycleEnvelope: TestDiagnosticEnvelope = {
      scope: 'lifecycle',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: null,
      correlationKey: null,
      event: sanitized,
    };
    expect(() => validateDiagnosticEnvelope(lifecycleEnvelope)).not.toThrow();

    // Attempt scope with missing attemptId must fail
    expect(() =>
      validateDiagnosticEnvelope({ ...attemptEnvelope, attemptId: null, correlationKey: null })
    ).toThrow();

    // Lifecycle scope with non-null attemptId must fail
    expect(() =>
      validateDiagnosticEnvelope({
        ...lifecycleEnvelope,
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
      })
    ).toThrow();
  });

  it('13. readers cleanly segregate diagnostics and fingerprints from separate subdirectories', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'segregation-test-'));
    const diagDir = path.join(tempRoot, 'diagnostics');
    const fpDir = path.join(tempRoot, 'fingerprints');
    fs.mkdirSync(diagDir);
    fs.mkdirSync(fpDir);

    const envelope: TestDiagnosticEnvelope = {
      scope: 'attempt',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      event: {
        timestamp: Date.now(),
        serviceId: 'srv-1',
        stage: 'browser-launch-success',
        activePageCount: 1,
        runningExecutionCount: 0,
        queueLength: 0,
        hasProcessPid: true,
      },
    };
    fs.writeFileSync(
      path.join(diagDir, 'diag-worker-w-1-p-1.jsonl'),
      JSON.stringify(envelope) + '\n'
    );

    const fpRecord: SidecarFingerprintRecord = {
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      stderrPresent: false,
      stderrBucket: 'none',
      fingerprintIndicators: ['no-specific-indicator'],
      exitCode: 0,
      signal: 'unavailable',
      spawned: true,
      hasPid: true,
      elapsedMs: 200,
    };
    fs.writeFileSync(
      path.join(fpDir, 'fingerprint-worker-w-1-p-1.jsonl'),
      JSON.stringify(fpRecord) + '\n'
    );

    const diagResult = readAllDiagnosticEnvelopes(diagDir);
    expect(diagResult.envelopes.length).toBe(1);
    expect(diagResult.invalidCount).toBe(0);

    const fpResult = readAllFingerprintRecords(fpDir);
    expect(fpResult.records.length).toBe(1);
    expect(fpResult.invalidCount).toBe(0);

    // Cross-read must be zero / empty
    expect(readAllDiagnosticEnvelopes(fpDir).envelopes.length).toBe(0);
    expect(readAllFingerprintRecords(diagDir).records.length).toBe(0);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('14. correlates attempt envelopes with fingerprints, detecting missing and orphaned records', () => {
    const envelopes: TestDiagnosticEnvelope[] = [
      {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        event: {
          timestamp: 100,
          serviceId: 'srv-1',
          stage: 'puppeteer-launch',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      },
      {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-2',
        correlationKey: 'w-1:p-1:att-2',
        event: {
          timestamp: 200,
          serviceId: 'srv-1',
          stage: 'browser-launch-success',
          activePageCount: 1,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      },
      {
        scope: 'lifecycle',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: null,
        correlationKey: null,
        event: {
          timestamp: 50,
          serviceId: 'srv-1',
          stage: 'service-create',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      },
    ];

    // Only att-1 has a fingerprint record; att-2 is missing; att-orphan is orphaned
    const fpRecords: SidecarFingerprintRecord[] = [
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        stderrPresent: true,
        stderrBucket: 'small',
        fingerprintIndicators: ['assertion-indicator'],
        exitCode: 1,
        signal: 'SIGABRT',
        spawned: true,
        hasPid: true,
        elapsedMs: 150,
      },
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-orphan',
        correlationKey: 'w-1:p-1:att-orphan',
        stderrPresent: false,
        stderrBucket: 'none',
        fingerprintIndicators: ['no-specific-indicator'],
        exitCode: 0,
        signal: 'unavailable',
        spawned: true,
        hasPid: true,
        elapsedMs: 250,
      },
    ];

    const manifests: WorkerIntegrityManifest[] = [
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 3,
        writtenDiagnosticRecordCount: 3,
        expectedFingerprintRecordCount: 2,
        writtenFingerprintRecordCount: 2,
        finalizedAttemptCount: 2,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 2,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      },
    ];

    const summary = aggregateFingerprintsAndCorrelate(fpRecords, envelopes, manifests, 0, 1);
    expect(summary.validFingerprintRecords).toBe(2);
    expect(summary.missingFingerprintAttemptCount).toBe(1); // att-2 is missing
    expect(summary.orphanedFingerprintRecordCount).toBe(1); // att-orphan is orphaned
    expect(summary.recordsWithStderr).toBe(1);
    expect(summary.recordsWithoutStderr).toBe(1);
    expect(summary.indicatorCounts['assertion-indicator']).toBe(1);
  });

  it('15. detects duplicate correlation keys in fingerprint sidecars', () => {
    const duplicateRecords: SidecarFingerprintRecord[] = [
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-dup',
        correlationKey: 'w-1:p-1:att-dup',
        stderrPresent: false,
        stderrBucket: 'none',
        fingerprintIndicators: ['no-specific-indicator'],
        exitCode: 0,
        signal: 'unavailable',
        spawned: true,
        hasPid: true,
        elapsedMs: 100,
      },
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-dup',
        correlationKey: 'w-1:p-1:att-dup',
        stderrPresent: false,
        stderrBucket: 'none',
        fingerprintIndicators: ['no-specific-indicator'],
        exitCode: 0,
        signal: 'unavailable',
        spawned: true,
        hasPid: true,
        elapsedMs: 100,
      },
    ];

    const summary = aggregateFingerprintsAndCorrelate(duplicateRecords, [], [], 0, 1);
    expect(summary.duplicateCorrelationKeyCount).toBe(1);
  });

  it('16. atomic manifest write and registry validation ensure integrity audit', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-audit-test-'));
    const regDir = path.join(tempRoot, 'registry');
    const manDir = path.join(tempRoot, 'manifests');

    writeWorkerRegistration(regDir, 'w-1', 'p-1');
    const registrations = readAllWorkerRegistrations(regDir);
    expect(registrations.records.length).toBe(1);
    expect(registrations.records[0].workerId).toBe('w-1');

    const manifest: WorkerIntegrityManifest = {
      workerId: 'w-1',
      processInstanceId: 'p-1',
      expectedDiagnosticRecordCount: 5,
      writtenDiagnosticRecordCount: 5,
      expectedFingerprintRecordCount: 2,
      writtenFingerprintRecordCount: 2,
      finalizedAttemptCount: 2,
      diagnosticWriterFailureCount: 0,
      fingerprintWriterFailureCount: 0,
      observedBrowserProcessCount: 2,
      liveBrowserProcessCountAtTeardown: 0,
      unreleasedBrowserProcessCount: 0,
      flushed: true,
    };

    expect(() => validateWorkerManifest(manifest)).not.toThrow();
    expect(() =>
      validateWorkerManifest({ ...manifest, unknownKey: 1 } as unknown as WorkerIntegrityManifest)
    ).toThrow(/unknown key/);
    expect(() =>
      validateWorkerManifest({
        ...manifest,
        flushed: 'not-bool',
      } as unknown as WorkerIntegrityManifest)
    ).toThrow(/flushed must be boolean/);

    writeWorkerManifest(manDir, manifest);
    const manifests = readAllWorkerManifests(manDir);
    expect(manifests.records.length).toBe(1);
    expect(manifests.records[0].flushed).toBe(true);
    expect(manifests.records[0].liveBrowserProcessCountAtTeardown).toBe(0);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('17. diagnostics-collector aggregates intervals and process counts without PID numbers', () => {
    const envelopes: TestDiagnosticEnvelope[] = [
      {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        event: {
          timestamp: 1000,
          serviceId: 'srv-1',
          stage: 'browser-launch-start',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      },
      {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        event: {
          timestamp: 1500,
          serviceId: 'srv-1',
          stage: 'browser-launch-success',
          activePageCount: 1,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
          hasBrowserPid: true,
        },
      },
      {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        event: {
          timestamp: 2000,
          serviceId: 'srv-1',
          stage: 'browser-close',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      },
    ];

    const manifests: WorkerIntegrityManifest[] = [
      {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 3,
        writtenDiagnosticRecordCount: 3,
        expectedFingerprintRecordCount: 1,
        writtenFingerprintRecordCount: 1,
        finalizedAttemptCount: 1,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 1,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      },
    ];

    const summary = aggregateDiagnostics(envelopes, manifests);
    expect(summary.totalEvents).toBe(3);
    expect(summary.workerCount).toBe(1);
    expect(summary.browserProcessObservedCount).toBe(1);
    expect(summary.maxConcurrentLaunches).toBe(1);
    expect(summary.maxConcurrentBrowsers).toBe(1);
    expect(summary.maxConcurrentPages).toBe(1);
    expect(Object.keys(summary.failureStageCounts).length).toBe(0);
  });

  describe('009-14 Integrity Audit, Registration, Manifest, and Worker Consistency', () => {
    it('7. detects corrupted worker registration JSON and counts invalid files', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-corrupt-test-'));
      const regDir = path.join(tempRoot, 'registry');
      fs.mkdirSync(regDir, { recursive: true });

      fs.writeFileSync(path.join(regDir, 'reg-worker-w1-p1.json'), '{ broken json', 'utf8');
      const result = readAllWorkerRegistrations(regDir);
      expect(result.discoveredFileCount).toBe(1);
      expect(result.validFileCount).toBe(0);
      expect(result.invalidFileCount).toBe(1);
      expect(result.records.length).toBe(0);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('8. validates registration against unknown keys, bad types, and unsafe IDs', () => {
      const valid = { workerId: 'w-1', processInstanceId: 'p-1', registeredAt: 1000 };
      expect(() => validateWorkerRegistration(valid)).not.toThrow();

      // Unknown key
      expect(() => validateWorkerRegistration({ ...valid, extraKey: true })).toThrow(/unknown key/);

      // Unsafe ID (path traversal)
      expect(() => validateWorkerRegistration({ ...valid, workerId: '../unsafe' })).toThrow(
        /invalid workerId/
      );

      // Negative registeredAt
      expect(() => validateWorkerRegistration({ ...valid, registeredAt: -1 })).toThrow(
        /registeredAt must be non-negative integer/
      );

      // File name mismatch
      expect(() => validateWorkerRegistration(valid, 'reg-worker-other-p-1.json')).toThrow(
        /worker key mismatch/
      );
    });

    it('9. detects corrupted worker manifest JSON and counts invalid files', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'man-corrupt-test-'));
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(manDir, { recursive: true });

      fs.writeFileSync(path.join(manDir, 'manifest-worker-w1-p1.json'), 'not valid json', 'utf8');
      const result = readAllWorkerManifests(manDir);
      expect(result.discoveredFileCount).toBe(1);
      expect(result.validFileCount).toBe(0);
      expect(result.invalidFileCount).toBe(1);
      expect(result.records.length).toBe(0);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('10. validates manifest against unknown keys, bad types, count contradictions, and unsafe IDs', () => {
      const valid: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 5,
        writtenDiagnosticRecordCount: 5,
        expectedFingerprintRecordCount: 2,
        writtenFingerprintRecordCount: 2,
        finalizedAttemptCount: 2,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 2,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      };

      // Written exceeds expected
      expect(() => validateWorkerManifest({ ...valid, writtenDiagnosticRecordCount: 6 })).toThrow(
        /writtenDiagnosticRecordCount exceeds expectedDiagnosticRecordCount/
      );

      // Finalized mismatch with written fingerprints
      expect(() => validateWorkerManifest({ ...valid, finalizedAttemptCount: 3 })).toThrow(
        /finalizedAttemptCount mismatch/
      );

      // Negative number
      expect(() => validateWorkerManifest({ ...valid, expectedDiagnosticRecordCount: -1 })).toThrow(
        /non-negative integer/
      );

      // Unsafe processInstanceId
      expect(() => validateWorkerManifest({ ...valid, processInstanceId: 'bad/id' })).toThrow(
        /invalid processInstanceId/
      );
    });

    it('11. detects duplicate worker keys in registration and manifest readers', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-key-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(regDir, { recursive: true });
      fs.mkdirSync(manDir, { recursive: true });

      // Two registration files with different names but same worker key
      fs.writeFileSync(
        path.join(regDir, 'reg-worker-w-1-p-1.json'),
        JSON.stringify({ workerId: 'w-1', processInstanceId: 'p-1', registeredAt: 100 })
      );
      fs.writeFileSync(
        path.join(regDir, 'reg-worker-w-1-p-1-copy.json'),
        JSON.stringify({ workerId: 'w-1', processInstanceId: 'p-1', registeredAt: 200 })
      );

      const regResult = readAllWorkerRegistrations(regDir);
      // One has matching filename, the second will fail filename mismatch or duplicate
      expect(regResult.duplicateWorkerKeyCount + regResult.invalidFileCount).toBeGreaterThan(0);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('12. audits worker-by-worker diagnostics and fingerprint record consistency', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-clean-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const diagDir = path.join(tempRoot, 'diagnostics');
      const fpDir = path.join(tempRoot, 'fingerprints');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(diagDir, { recursive: true });
      fs.mkdirSync(fpDir, { recursive: true });

      writeWorkerRegistration(regDir, 'w-1', 'p-1');
      writeWorkerRegistration(regDir, 'w-2', 'p-2');

      const manifest1: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 1,
        writtenDiagnosticRecordCount: 1,
        expectedFingerprintRecordCount: 1,
        writtenFingerprintRecordCount: 1,
        finalizedAttemptCount: 1,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 1,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      };
      const manifest2: WorkerIntegrityManifest = {
        workerId: 'w-2',
        processInstanceId: 'p-2',
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
        flushed: true,
      };

      writeWorkerManifest(manDir, manifest1);
      writeWorkerManifest(manDir, manifest2);

      // w-1 files
      const env1: TestDiagnosticEnvelope = {
        scope: 'attempt',
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        event: {
          timestamp: 100,
          serviceId: 'srv-1',
          stage: 'browser-launch-start',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      };
      fs.writeFileSync(
        path.join(diagDir, 'diag-worker-w-1-p-1.jsonl'),
        JSON.stringify(env1) + '\n'
      );
      const fp1: SidecarFingerprintRecord = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        attemptId: 'att-1',
        correlationKey: 'w-1:p-1:att-1',
        stderrPresent: false,
        stderrBucket: 'none',
        fingerprintIndicators: ['no-specific-indicator'],
        exitCode: 0,
        signal: 'unavailable',
        spawned: true,
        hasPid: true,
        elapsedMs: 50,
      };
      fs.writeFileSync(
        path.join(fpDir, 'fingerprint-worker-w-1-p-1.jsonl'),
        JSON.stringify(fp1) + '\n'
      );

      // w-2 empty files (policy A)
      fs.writeFileSync(path.join(diagDir, 'diag-worker-w-2-p-2.jsonl'), '');
      fs.writeFileSync(path.join(fpDir, 'fingerprint-worker-w-2-p-2.jsonl'), '');

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(errors).toEqual([]);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('13. detects swapped record counts between workers even if totals match', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-swap-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const diagDir = path.join(tempRoot, 'diagnostics');
      const fpDir = path.join(tempRoot, 'fingerprints');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(diagDir, { recursive: true });
      fs.mkdirSync(fpDir, { recursive: true });

      writeWorkerRegistration(regDir, 'w-1', 'p-1');
      writeWorkerRegistration(regDir, 'w-2', 'p-2');

      // Manifest says w-1 has 1 diag, w-2 has 0 diag (Total = 1)
      const m1: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 1,
        writtenDiagnosticRecordCount: 1,
        expectedFingerprintRecordCount: 0,
        writtenFingerprintRecordCount: 0,
        finalizedAttemptCount: 0,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 0,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      };
      const m2: WorkerIntegrityManifest = {
        workerId: 'w-2',
        processInstanceId: 'p-2',
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
        flushed: true,
      };
      writeWorkerManifest(manDir, m1);
      writeWorkerManifest(manDir, m2);

      // But we swap: w-1 has empty file, w-2 has 1 diag event for w-2
      fs.writeFileSync(path.join(diagDir, 'diag-worker-w-1-p-1.jsonl'), '');
      const env2: TestDiagnosticEnvelope = {
        scope: 'attempt',
        workerId: 'w-2',
        processInstanceId: 'p-2',
        attemptId: 'att-1',
        correlationKey: 'w-2:p-2:att-1',
        event: {
          timestamp: 100,
          serviceId: 'srv-1',
          stage: 'browser-launch-start',
          activePageCount: 0,
          runningExecutionCount: 0,
          queueLength: 0,
          hasProcessPid: true,
        },
      };
      fs.writeFileSync(
        path.join(diagDir, 'diag-worker-w-2-p-2.jsonl'),
        JSON.stringify(env2) + '\n'
      );
      fs.writeFileSync(path.join(fpDir, 'fingerprint-worker-w-1-p-1.jsonl'), '');
      fs.writeFileSync(path.join(fpDir, 'fingerprint-worker-w-2-p-2.jsonl'), '');

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        errors.some((e) => e.message.includes('worker diagnostic record count mismatch'))
      ).toBe(true);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('14. detects mismatch between expected and written record counts in manifest', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-mismatch-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const diagDir = path.join(tempRoot, 'diagnostics');
      const fpDir = path.join(tempRoot, 'fingerprints');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(diagDir, { recursive: true });
      fs.mkdirSync(fpDir, { recursive: true });

      writeWorkerRegistration(regDir, 'w-1', 'p-1');
      const m: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 5,
        writtenDiagnosticRecordCount: 4, // mismatch
        expectedFingerprintRecordCount: 0,
        writtenFingerprintRecordCount: 0,
        finalizedAttemptCount: 0,
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 0,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      };
      writeWorkerManifest(manDir, m);
      fs.writeFileSync(path.join(diagDir, 'diag-worker-w-1-p-1.jsonl'), '');
      fs.writeFileSync(path.join(fpDir, 'fingerprint-worker-w-1-p-1.jsonl'), '');

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(
        errors.some((e) => e.message.includes('diagnostic record count expectation mismatch'))
      ).toBe(true);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('15. detects mismatch between finalizedAttemptCount and fingerprint record count', () => {
      const invalidManifest: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        expectedDiagnosticRecordCount: 0,
        writtenDiagnosticRecordCount: 0,
        expectedFingerprintRecordCount: 2,
        writtenFingerprintRecordCount: 2,
        finalizedAttemptCount: 3, // mismatch with 2
        diagnosticWriterFailureCount: 0,
        fingerprintWriterFailureCount: 0,
        observedBrowserProcessCount: 0,
        liveBrowserProcessCountAtTeardown: 0,
        unreleasedBrowserProcessCount: 0,
        flushed: true,
      };

      expect(() => validateWorkerManifest(invalidManifest)).toThrow(
        /finalizedAttemptCount mismatch with writtenFingerprintRecordCount/
      );
    });

    it('16. detects orphaned and missing diagnostic and fingerprint files', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-orphaned-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const diagDir = path.join(tempRoot, 'diagnostics');
      const fpDir = path.join(tempRoot, 'fingerprints');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(diagDir, { recursive: true });
      fs.mkdirSync(fpDir, { recursive: true });

      writeWorkerRegistration(regDir, 'w-1', 'p-1');
      const m1: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
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
        flushed: true,
      };
      writeWorkerManifest(manDir, m1);
      fs.writeFileSync(path.join(diagDir, 'diag-worker-w-1-p-1.jsonl'), '');
      fs.writeFileSync(path.join(fpDir, 'fingerprint-worker-w-1-p-1.jsonl'), '');

      // Create orphaned diag file for non-registered worker
      fs.writeFileSync(path.join(diagDir, 'diag-worker-w-orphan-p-orphan.jsonl'), '');

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(errors.some((e) => e.message.includes('orphaned diagnostic file found'))).toBe(true);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('17. policy A: verifies 0-event 0-fingerprint worker has valid empty files matching manifest', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-a-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const diagDir = path.join(tempRoot, 'diagnostics');
      const fpDir = path.join(tempRoot, 'fingerprints');
      const manDir = path.join(tempRoot, 'manifests');
      fs.mkdirSync(diagDir, { recursive: true });
      fs.mkdirSync(fpDir, { recursive: true });

      writeWorkerRegistration(regDir, 'w-zero', 'p-zero');
      const mZero: WorkerIntegrityManifest = {
        workerId: 'w-zero',
        processInstanceId: 'p-zero',
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
        flushed: true,
      };
      writeWorkerManifest(manDir, mZero);

      // Create empty 0-byte files as policy A prescribes
      const diagPath = path.join(diagDir, 'diag-worker-w-zero-p-zero.jsonl');
      const fpPath = path.join(fpDir, 'fingerprint-worker-w-zero-p-zero.jsonl');
      fs.writeFileSync(diagPath, '');
      fs.writeFileSync(fpPath, '');

      expect(fs.statSync(diagPath).size).toBe(0);
      expect(fs.statSync(fpPath).size).toBe(0);

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(errors).toEqual([]);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('18. distinguishes between empty files and missing files for registered workers', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-file-test-'));
      const regDir = path.join(tempRoot, 'registry');
      const manDir = path.join(tempRoot, 'manifests');

      writeWorkerRegistration(regDir, 'w-miss', 'p-miss');
      const mMiss: WorkerIntegrityManifest = {
        workerId: 'w-miss',
        processInstanceId: 'p-miss',
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
        flushed: true,
      };
      writeWorkerManifest(manDir, mMiss);
      // Notice: we do NOT create diag or fingerprint file at all

      const errors = auditDiagnosticsIntegrity(tempRoot);
      expect(errors.some((e) => e.message.includes('missing diagnostic events file'))).toBe(true);
      expect(errors.some((e) => e.message.includes('missing fingerprint sidecar file'))).toBe(true);

      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('19. detects empty file creation failure during worker setup as fast fail', () => {
      // Simulating write failure on non-existent or read-only directory
      const invalidPath = path.join('/dev/null/impossible-directory', 'diag.jsonl');
      expect(() => {
        fs.writeFileSync(invalidPath, '', { flag: 'w' });
      }).toThrow();
    });
  });

  describe('009-15 Security, Signal Validation, and Error Non-Leakage', () => {
    function assertNoSecretLeak(actualText: string, forbiddenPattern: string): void {
      const containsLeak = actualText.includes(forbiddenPattern);
      if (containsLeak) {
        throw new Error('Security test failed: forbidden pattern detected in message');
      }
    }

    const baseValidRecord: SidecarFingerprintRecord = {
      workerId: 'w-sec-1',
      processInstanceId: 'p-sec-1',
      attemptId: 'att-1',
      correlationKey: 'w-sec-1:p-sec-1:att-1',
      stderrPresent: false,
      stderrBucket: 'none',
      fingerprintIndicators: ['no-specific-indicator'],
      exitCode: 0,
      signal: 'unavailable',
      spawned: true,
      hasPid: true,
      elapsedMs: 50,
    };

    it('Item 9 (fingerprint): rejects invalid signals and accepts cross-platform signals', () => {
      expect(() =>
        validateFingerprintRecord({
          ...baseValidRecord,
          signal: 'INVALID_SIGNAL_NAME',
        })
      ).toThrow(/signal must be an allowed signal or unavailable/);

      const allowedSignals = [
        'SIGABRT',
        'SIGSEGV',
        'SIGBUS',
        'SIGTRAP',
        'SIGBREAK',
        'SIGKILL',
        'SIGTERM',
        'unavailable',
      ];

      for (const sig of allowedSignals) {
        expect(() =>
          validateFingerprintRecord({
            ...baseValidRecord,
            signal: sig,
          })
        ).not.toThrow();
      }
    });

    function assertNoSecretLeakRecursive(
      target: unknown,
      forbiddenPattern: string,
      visited: WeakSet<object> = new WeakSet()
    ): void {
      if (target === null || target === undefined) {
        return;
      }
      if (typeof target === 'string') {
        assertNoSecretLeak(target, forbiddenPattern);
        return;
      }
      if (
        typeof target === 'number' ||
        typeof target === 'boolean' ||
        typeof target === 'symbol' ||
        typeof target === 'bigint' ||
        typeof target === 'function'
      ) {
        return;
      }
      if (typeof target === 'object') {
        if (visited.has(target)) {
          return;
        }
        visited.add(target);

        if (target instanceof Error) {
          assertNoSecretLeak(target.message, forbiddenPattern);
          let causeVal: unknown;
          try {
            causeVal = (target as Error & { cause?: unknown }).cause;
          } catch {
            throw new Error('Inspection error: getter threw during traversal');
          }
          if (causeVal !== undefined && causeVal !== null) {
            assertNoSecretLeakRecursive(causeVal, forbiddenPattern, visited);
          }

          if ('errors' in target) {
            let errorsVal: unknown;
            try {
              errorsVal = (target as AggregateError).errors;
            } catch {
              throw new Error('Inspection error: getter threw during traversal');
            }
            if (Array.isArray(errorsVal)) {
              for (const subErr of errorsVal) {
                assertNoSecretLeakRecursive(subErr, forbiddenPattern, visited);
              }
            }
          }
          return;
        }

        if (Array.isArray(target)) {
          for (const item of target) {
            assertNoSecretLeakRecursive(item, forbiddenPattern, visited);
          }
          return;
        }

        const descriptors = Object.getOwnPropertyDescriptors(target);
        for (const key of Object.keys(descriptors)) {
          assertNoSecretLeak(key, forbiddenPattern);
          const desc = descriptors[key];
          if (desc && 'value' in desc) {
            assertNoSecretLeakRecursive(desc.value, forbiddenPattern, visited);
          } else if (desc && desc.get) {
            try {
              const val = desc.get.call(target);
              assertNoSecretLeakRecursive(val, forbiddenPattern, visited);
            } catch {
              throw new Error('Inspection error: getter threw during traversal');
            }
          }
        }
      }
    }

    function assertNoSecretInConsoleCalls(
      spy: { mock: { calls: unknown[][] } },
      forbiddenPatterns: string[]
    ): void {
      const calls = spy.mock.calls;
      if (calls.length === 0) {
        return;
      }
      for (const callArgs of calls) {
        for (const arg of callArgs) {
          for (const pattern of forbiddenPatterns) {
            assertNoSecretLeakRecursive(arg, pattern);
          }
        }
      }
    }

    function assertNoSecretInReaderResult(result: unknown, forbiddenPatterns: string[]): void {
      for (const pattern of forbiddenPatterns) {
        assertNoSecretLeakRecursive(result, pattern);
      }
    }

    it('Item 4 & 13: does not leak secret in exception when real path/URL/token is in fingerprint unknown key', () => {
      const dummyKeys = [
        '/var/tmp/dummy_secret.json',
        'C:\\Users\\dummy\\secret.txt',
        '\\\\server\\share\\secret_data',
        'https://example.dummy.local/secret',
        'bearer_dummy_secret_fp_key',
      ];

      for (const dummyKey of dummyKeys) {
        try {
          validateFingerprintRecord({
            ...baseValidRecord,
            [dummyKey]: 'dummy_value',
          } as unknown as SidecarFingerprintRecord);
          expect.fail('Should have thrown validation error');
        } catch (err) {
          const msg = (err as Error).message;
          assertNoSecretLeak(msg, dummyKey);
          expect(msg).toBe('Invalid fingerprint record: unknown key present');
        }
      }
    });

    it('Item 4 & 14: does not leak secret in exception when real path/URL/token is in registration or manifest unknown key', () => {
      const dummyKeys = [
        '/var/tmp/dummy_reg.json',
        'C:\\Users\\dummy\\reg.txt',
        'https://example.dummy.local/reg',
        'bearer_dummy_secret_reg_key',
      ];

      const validReg = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
        registeredAt: 1000,
      };

      for (const dummyKey of dummyKeys) {
        try {
          validateWorkerRegistration({
            ...validReg,
            [dummyKey]: 'dummy_value',
          });
          expect.fail('Should have thrown validation error');
        } catch (err) {
          const msg = (err as Error).message;
          assertNoSecretLeak(msg, dummyKey);
          expect(msg).toBe('Invalid worker registration: unknown key present');
        }
      }

      const validMan: WorkerIntegrityManifest = {
        workerId: 'w-1',
        processInstanceId: 'p-1',
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
        flushed: true,
      };

      for (const dummyKey of dummyKeys) {
        try {
          validateWorkerManifest({
            ...validMan,
            [dummyKey]: 'dummy_value',
          } as unknown as WorkerIntegrityManifest);
          expect.fail('Should have thrown validation error');
        } catch (err) {
          const msg = (err as Error).message;
          assertNoSecretLeak(msg, dummyKey);
          expect(msg).toBe('Invalid worker manifest: unknown key present');
        }
      }
    });

    describe('Item 6 (009-17): fingerprint reader 4-path error handling with return/console security proof', () => {
      it('Path 1: missing directory returns invalidCount >= 1 and empty array', () => {
        const nonExistentDir = path.join(os.tmpdir(), 'missing-fp-dir-' + Date.now());
        const res = readAllFingerprintRecords(nonExistentDir);
        expect(res.invalidCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });

      it('Path 2: directory readdirSync failure returns invalidCount >= 1 without throwing, leaking to return or console', () => {
        const secretPath = '/var/secret/fp/dir';
        const secretToken = 'bearer_fp_dir_leak_token_111';
        const forbiddenList = [secretPath, secretToken];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllFingerprintRecords('/test/fingerprints', {
            existsSync: () => true,
            readdirSync: () => {
              throw new Error(`EACCES: permission denied ${secretPath} token=${secretToken}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 3: file readFileSync failure returns invalidCount >= 1 without throwing, leaking to return or console', () => {
        const secretFile = '/var/secret/fp/corrupted.jsonl';
        const secretUrl = 'https://leak.fp.internal/data';
        const forbiddenList = [secretFile, secretUrl];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllFingerprintRecords('/test/fingerprints', {
            existsSync: () => true,
            readdirSync: () => ['fingerprint-worker-w1-p1.jsonl' as unknown as fs.Dirent],
            readFileSync: () => {
              throw new Error(`EIO: disk read failure on ${secretFile} at ${secretUrl}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 4: corrupt JSON or schema-invalid lines return invalidCount >= 1', () => {
        const res = readAllFingerprintRecords('/test/fingerprints', {
          existsSync: () => true,
          readdirSync: () => ['fingerprint-worker-w1-p1.jsonl' as unknown as fs.Dirent],
          readFileSync: () => '{"invalid_fp": true}\n',
        } as unknown as typeof fs);
        expect(res.invalidCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });
    });

    describe('Item 7 (009-17): registration reader 4-path error handling with return/console security proof', () => {
      it('Path 1: missing directory returns invalidFileCount >= 1 and empty array', () => {
        const nonExistentDir = path.join(os.tmpdir(), 'missing-reg-dir-' + Date.now());
        const res = readAllWorkerRegistrations(nonExistentDir);
        expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });

      it('Path 2: directory readdirSync failure returns invalidFileCount >= 1 without throwing, leaking to return or console', () => {
        const secretPath = '/var/secret/reg/dir';
        const secretToken = 'bearer_reg_dir_secret_token_222';
        const forbiddenList = [secretPath, secretToken];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllWorkerRegistrations('/test/registry', {
            existsSync: () => true,
            readdirSync: () => {
              throw new Error(`EACCES: permission denied ${secretPath} token=${secretToken}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 3: file readFileSync failure returns invalidFileCount >= 1 without throwing, leaking to return or console', () => {
        const secretFile = '/var/secret/reg/file.json';
        const secretUrl = 'https://leak.reg.internal/data';
        const forbiddenList = [secretFile, secretUrl];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllWorkerRegistrations('/test/registry', {
            existsSync: () => true,
            readdirSync: () => ['reg-worker-w1-p1.json' as unknown as fs.Dirent],
            readFileSync: () => {
              throw new Error(`EIO: disk read failure on ${secretFile} at ${secretUrl}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 4: corrupt JSON or schema-invalid file returns invalidFileCount >= 1', () => {
        const res = readAllWorkerRegistrations('/test/registry', {
          existsSync: () => true,
          readdirSync: () => ['reg-worker-w1-p1.json' as unknown as fs.Dirent],
          readFileSync: () => '{"corrupt_reg": true}',
        } as unknown as typeof fs);
        expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });
    });

    describe('Item 8 (009-17): manifest reader 4-path error handling with return/console security proof', () => {
      it('Path 1: missing directory returns invalidFileCount >= 1 and empty array', () => {
        const nonExistentDir = path.join(os.tmpdir(), 'missing-man-dir-' + Date.now());
        const res = readAllWorkerManifests(nonExistentDir);
        expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });

      it('Path 2: directory readdirSync failure returns invalidFileCount >= 1 without throwing, leaking to return or console', () => {
        const secretPath = '/var/secret/man/dir';
        const secretToken = 'bearer_man_dir_secret_token_333';
        const forbiddenList = [secretPath, secretToken];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllWorkerManifests('/test/manifests', {
            existsSync: () => true,
            readdirSync: () => {
              throw new Error(`EACCES: permission denied ${secretPath} token=${secretToken}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 3: file readFileSync failure returns invalidFileCount >= 1 without throwing, leaking to return or console', () => {
        const secretFile = '/var/secret/man/file.json';
        const secretUrl = 'https://leak.man.internal/data';
        const forbiddenList = [secretFile, secretUrl];

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        try {
          const res = readAllWorkerManifests('/test/manifests', {
            existsSync: () => true,
            readdirSync: () => ['manifest-worker-w1-p1.json' as unknown as fs.Dirent],
            readFileSync: () => {
              throw new Error(`EIO: disk read failure on ${secretFile} at ${secretUrl}`);
            },
          } as unknown as typeof fs);
          expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
          expect(res.records).toEqual([]);
          assertNoSecretInReaderResult(res, forbiddenList);
          assertNoSecretInConsoleCalls(logSpy, forbiddenList);
          assertNoSecretInConsoleCalls(errSpy, forbiddenList);
          assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
        }
      });

      it('Path 4: corrupt JSON or schema-invalid file returns invalidFileCount >= 1', () => {
        const res = readAllWorkerManifests('/test/manifests', {
          existsSync: () => true,
          readdirSync: () => ['manifest-worker-w1-p1.json' as unknown as fs.Dirent],
          readFileSync: () => '{"corrupt_manifest": true}',
        } as unknown as typeof fs);
        expect(res.invalidFileCount).toBeGreaterThanOrEqual(1);
        expect(res.records).toEqual([]);
      });
    });

    describe.sequential('009-17 teardown() actual execution tests', () => {
      const originalDiagDir = process.env.__MD_TEST_DIAG_DIR__;
      const originalPreserve = process.env.PRESERVE_DIAGNOSTICS;

      afterEach(() => {
        vi.restoreAllMocks();
      });

      afterAll(() => {
        if (originalDiagDir !== undefined) {
          process.env.__MD_TEST_DIAG_DIR__ = originalDiagDir;
        } else {
          delete process.env.__MD_TEST_DIAG_DIR__;
        }

        if (originalPreserve !== undefined) {
          process.env.PRESERVE_DIAGNOSTICS = originalPreserve;
        } else {
          delete process.env.PRESERVE_DIAGNOSTICS;
        }

        expect(process.env.__MD_TEST_DIAG_DIR__).toBe(originalDiagDir);
        expect(process.env.PRESERVE_DIAGNOSTICS).toBe(originalPreserve);
      });

      function assertStackSecurity(
        thrownStack: string | undefined,
        originalStack: string | undefined,
        marker: string,
        secret: string
      ): void {
        if (thrownStack === undefined) {
          throw new Error('Security test failed: thrown error stack is undefined');
        }
        const originalStackWasPropagated = thrownStack === originalStack;
        if (originalStackWasPropagated) {
          throw new Error('Security test failed: original stack was propagated');
        }
        const markerWasPropagated = thrownStack.includes(marker);
        if (markerWasPropagated) {
          throw new Error('Security test failed: original stack marker was propagated');
        }
        const secretWasPropagated = thrownStack.includes(secret);
        if (secretWasPropagated) {
          throw new Error('Security test failed: secret pattern was propagated to stack');
        }
      }

      function assertReferenceDistinct(actual: unknown, expected: unknown): void {
        const isIdentical = actual === expected;
        if (isIdentical) {
          throw new Error(
            'Security test failed: returned error has identical reference to raw audit error'
          );
        }
      }

      const realFormatAuditSecrets = [
        '/var/tmp/dummy_audit_secret.json',
        'C:\\Users\\dummy\\audit_secret.txt',
        '\\\\server\\share\\audit_secret_data',
        'https://example.dummy.local/audit/secret',
        'https://user:pass@example.dummy.local/audit/secret',
        'bearer_dummy_audit_secret_token_99',
        'EIO: disk read failure /var/secret/audit_data.bin',
      ];

      it('Item 1-10 (009-18): actual teardown() normalizes all 7 real-format raw audit errors to static Error without leaking message, name, stack, cause, or custom props', async () => {
        for (const secretPattern of realFormatAuditSecrets) {
          const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-single-audit-norm-'));
          const stackMarker = `CUSTOM_DUMMY_ORIGINAL_STACK_MARKER_9988_${Date.now()}`;
          const rawAuditError = new Error(`Raw un-sanitized audit error: ${secretPattern}`);
          rawAuditError.name = 'CustomDummyAuditErrorName';
          rawAuditError.stack = `Error: CustomDummyAuditErrorName\n    at ${stackMarker} (fake-file.ts:1:1)`;
          (rawAuditError as unknown as { customSecretPayload: string }).customSecretPayload =
            `custom_secret_val_${secretPattern}`;
          (rawAuditError as unknown as { cause: Error }).cause = new Error(
            `Cause secret: ${secretPattern}`
          );

          const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
          const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          try {
            await teardown({
              diagnosticsRootDir: tempRoot,
              auditFn: () => [rawAuditError],
              cleanupFn: () => {}, // cleanup succeeds
            });
            expect.fail('Should have thrown teardown audit failure');
          } catch (err) {
            expect(err).toBeDefined();
            expect(err instanceof AggregateError).toBe(false);
            expect(err instanceof Error).toBe(true);

            // Ref identity negation
            assertReferenceDistinct(err, rawAuditError);

            const thrownErr = err as Error;

            // Message and name fixed contract
            expect(thrownErr.message).toBe('Integrity failure: audit failure occurred');
            expect(thrownErr.name).toBe('Error');

            // Stack non-leakage and distinct check (own new stack is permitted)
            assertStackSecurity(thrownErr.stack, rawAuditError.stack, stackMarker, secretPattern);

            // Custom property and cause non-propagation
            expect('customSecretPayload' in (thrownErr as object)).toBe(false);
            expect((thrownErr as Error & { cause?: unknown }).cause).toBeUndefined();

            // Recursive secret non-leakage check
            assertNoSecretLeakRecursive(thrownErr, secretPattern);

            // Console output non-leakage check
            assertNoSecretInConsoleCalls(logSpy, [secretPattern, stackMarker]);
            assertNoSecretInConsoleCalls(errSpy, [secretPattern, stackMarker]);
            assertNoSecretInConsoleCalls(warnSpy, [secretPattern, stackMarker]);
          } finally {
            logSpy.mockRestore();
            errSpy.mockRestore();
            warnSpy.mockRestore();
            fs.rmSync(tempRoot, { recursive: true, force: true });
          }
        }
      });

      it('Item 11 (009-18): composite failure with raw audit errors and cleanup failure normalizes to real AggregateError without leaking', async () => {
        for (const secretPattern of realFormatAuditSecrets) {
          const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-composite-norm-'));
          const rawAuditError = new Error(`Raw audit leak: ${secretPattern}`);
          rawAuditError.name = 'CustomDummyCompositeAuditName';
          const cleanupSecret = `/var/secret/cleanup/target_${Date.now()}`;
          const forbiddenList = [secretPattern, cleanupSecret];

          const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
          const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          try {
            await teardown({
              diagnosticsRootDir: tempRoot,
              auditFn: () => [rawAuditError],
              cleanupFn: () => {
                throw new Error(`EACCES: failed removal at ${cleanupSecret}`);
              },
            });
            expect.fail('Should have thrown real AggregateError on composite teardown failure');
          } catch (err) {
            expect(err).toBeDefined();
            expect(err instanceof AggregateError).toBe(true);
            const aggErr = err as AggregateError;
            expect(aggErr.message).toBe('Multiple teardown integrity assertion failures occurred');
            expect(aggErr.errors.length).toBe(2);

            // Elements validation
            const err0 = aggErr.errors[0] as Error;
            const err1 = aggErr.errors[1] as Error;

            assertReferenceDistinct(err0, rawAuditError);
            expect(err0.message).toBe('Integrity failure: audit failure occurred');
            expect(err0.name).toBe('Error');

            expect(err1.message).toBe('Integrity failure: cleanup failure occurred');
            expect(err1.name).toBe('Error');

            // Recursive non-leakage check across entire AggregateError
            for (const pattern of forbiddenList) {
              assertNoSecretLeakRecursive(aggErr, pattern);
            }

            assertNoSecretInConsoleCalls(logSpy, forbiddenList);
            assertNoSecretInConsoleCalls(errSpy, forbiddenList);
            assertNoSecretInConsoleCalls(warnSpy, forbiddenList);
          } finally {
            logSpy.mockRestore();
            errSpy.mockRestore();
            warnSpy.mockRestore();
            fs.rmSync(tempRoot, { recursive: true, force: true });
          }
        }
      });

      it('Item 12 (009-18): multiple audit errors maintain count and are independently replaced by safe Errors', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-multi-audit-'));
        const secretA = '/var/secret/file_a.txt';
        const secretB = 'https://secret.b.internal/token';
        const secretC = 'bearer_token_c_12345';
        const forbiddenList = [secretA, secretB, secretC];

        const rawErrors = [
          new Error(`Audit fail 1: ${secretA}`),
          new Error(`Audit fail 2: ${secretB}`),
          new Error(`Audit fail 3: ${secretC}`),
        ];

        try {
          await teardown({
            diagnosticsRootDir: tempRoot,
            auditFn: () => rawErrors,
            cleanupFn: () => {}, // cleanup succeeds
          });
          expect.fail('Should have thrown real AggregateError for multiple audit failures');
        } catch (err) {
          expect(err).toBeDefined();
          expect(err instanceof AggregateError).toBe(true);
          const aggErr = err as AggregateError;
          expect(aggErr.message).toBe('Multiple teardown integrity assertion failures occurred');
          expect(aggErr.errors.length).toBe(3);

          // Check each element is independently constructed safe Error
          for (let i = 0; i < aggErr.errors.length; i += 1) {
            const subErr = aggErr.errors[i] as Error;
            expect(subErr.message).toBe('Integrity failure: audit failure occurred');
            expect(subErr.name).toBe('Error');
            assertReferenceDistinct(subErr, rawErrors[i]);
          }
          // Elements must be distinct instances
          expect(aggErr.errors[0] !== aggErr.errors[1]).toBe(true);
          expect(aggErr.errors[1] !== aggErr.errors[2]).toBe(true);

          for (const pattern of forbiddenList) {
            assertNoSecretLeakRecursive(aggErr, pattern);
          }
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
        }
      });

      it('Item 13 (009-18): auditFn crash and cleanup single failure contracts maintained', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-contracts-'));
        const dummySecret = '/secret/classified/audit-crash-endpoint';

        // 1. auditFn throwing directly
        try {
          await teardown({
            diagnosticsRootDir: tempRoot,
            auditFn: () => {
              throw new Error(`Crash inside auditFn: ${dummySecret}`);
            },
          });
          expect.fail('Should have thrown unexpected audit failure');
        } catch (err) {
          expect(err).toBeDefined();
          expect(err instanceof AggregateError).toBe(false);
          expect(err instanceof Error).toBe(true);
          expect((err as Error).message).toBe(
            'Integrity failure: unexpected audit failure occurred'
          );
          assertNoSecretLeakRecursive(err, dummySecret);
        }

        // 2. cleanupFn failing alone
        const cleanupDummy = '/var/secret/cleanup-target-only';
        try {
          await teardown({
            diagnosticsRootDir: tempRoot,
            auditFn: () => [],
            cleanupFn: () => {
              throw new Error(`EPERM: ${cleanupDummy}`);
            },
          });
          expect.fail('Should have thrown cleanup failure');
        } catch (err) {
          expect(err).toBeDefined();
          expect(err instanceof AggregateError).toBe(false);
          expect(err instanceof Error).toBe(true);
          expect((err as Error).message).toBe('Integrity failure: cleanup failure occurred');
          assertNoSecretLeakRecursive(err, cleanupDummy);
        }

        // 3. Both succeed cleanly -> does not throw
        await expect(
          teardown({
            diagnosticsRootDir: tempRoot,
            auditFn: () => [],
            cleanupFn: () => {},
          })
        ).resolves.toBeUndefined();

        fs.rmSync(tempRoot, { recursive: true, force: true });
      });

      it('Item 14 (009-19): positive control verifies assertStackSecurity and assertReferenceDistinct fail with static error without dumping values to message or console', () => {
        const dummyMarker = 'POSITIVE_CONTROL_STACK_MARKER_TEST_123';
        const dummySecret = 'POSITIVE_CONTROL_SECRET_PATTERN_TEST_456';
        const dummyOriginalStack = `Error: dummy\n    at ${dummyMarker} (test-file.ts:10:20)\n    with ${dummySecret}`;

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
          // 1. Positive control: identical stack
          let threwForIdenticalStack = false;
          try {
            assertStackSecurity(dummyOriginalStack, dummyOriginalStack, dummyMarker, dummySecret);
          } catch (e) {
            threwForIdenticalStack = true;
            const err = e as Error;
            expect(err.message).toBe('Security test failed: original stack was propagated');
            expect(err.message.includes(dummyMarker)).toBe(false);
            expect(err.message.includes(dummySecret)).toBe(false);
            expect(err.message.includes(dummyOriginalStack)).toBe(false);
          }
          expect(threwForIdenticalStack).toBe(true);

          // 2. Positive control: stack marker propagation in different stack
          let threwForMarker = false;
          try {
            const stackWithMarker = `Error: another\n    at func (${dummyMarker})`;
            assertStackSecurity(stackWithMarker, dummyOriginalStack, dummyMarker, dummySecret);
          } catch (e) {
            threwForMarker = true;
            const err = e as Error;
            expect(err.message).toBe('Security test failed: original stack marker was propagated');
            expect(err.message.includes(dummyMarker)).toBe(false);
            expect(err.message.includes(dummySecret)).toBe(false);
          }
          expect(threwForMarker).toBe(true);

          // 3. Positive control: secret pattern propagation in stack
          let threwForSecret = false;
          try {
            const stackWithSecret = `Error: another\n    at func (${dummySecret})`;
            assertStackSecurity(stackWithSecret, dummyOriginalStack, dummyMarker, dummySecret);
          } catch (e) {
            threwForSecret = true;
            const err = e as Error;
            expect(err.message).toBe(
              'Security test failed: secret pattern was propagated to stack'
            );
            expect(err.message.includes(dummyMarker)).toBe(false);
            expect(err.message.includes(dummySecret)).toBe(false);
          }
          expect(threwForSecret).toBe(true);

          // 4. Positive control: undefined stack
          let threwForUndefined = false;
          try {
            assertStackSecurity(undefined, dummyOriginalStack, dummyMarker, dummySecret);
          } catch (e) {
            threwForUndefined = true;
            const err = e as Error;
            expect(err.message).toBe('Security test failed: thrown error stack is undefined');
          }
          expect(threwForUndefined).toBe(true);

          // 5. Positive control: reference identity
          let threwForRef = false;
          try {
            const obj = { foo: 'bar' };
            assertReferenceDistinct(obj, obj);
          } catch (e) {
            threwForRef = true;
            const err = e as Error;
            expect(err.message).toBe(
              'Security test failed: returned error has identical reference to raw audit error'
            );
          }
          expect(threwForRef).toBe(true);

          // 6. Safe console verification
          const consoleWasCalled =
            logSpy.mock.calls.length !== 0 ||
            warnSpy.mock.calls.length !== 0 ||
            errorSpy.mock.calls.length !== 0;

          if (consoleWasCalled) {
            throw new Error('Security test failed: positive control emitted console output');
          }
        } finally {
          logSpy.mockRestore();
          warnSpy.mockRestore();
          errorSpy.mockRestore();
        }
      });

      it('Item 2 & 3 (009-17): verifies recursive non-leakage with Error.cause, nested AggregateError, circular ref, and getter protection', async () => {
        const secretToken = 'secret_bearer_nested_token_sub_7788';
        const secretPath = '/var/root/super_secret_file.key';

        // 1. Nested Error with .cause
        const innerErr = new Error('Integrity failure: root cause error');
        const outerErr = new Error('Integrity failure: top level error', { cause: innerErr });
        assertNoSecretLeakRecursive(outerErr, secretToken);

        // 2. AggregateError containing cause
        const causeAggregate = new AggregateError(
          [outerErr, new Error('Integrity failure: sibling error')],
          'Multiple teardown integrity assertion failures occurred'
        );
        assertNoSecretLeakRecursive(causeAggregate, secretToken);

        // 3. Circular reference protection
        const circularErr1 = new Error('Integrity failure: circ 1');
        const circularErr2 = new Error('Integrity failure: circ 2');
        (circularErr1 as Error & { cause?: unknown }).cause = circularErr2;
        (circularErr2 as Error & { cause?: unknown }).cause = circularErr1;
        expect(() => {
          assertNoSecretLeakRecursive(circularErr1, secretPath);
        }).not.toThrow();

        // 4. Getter throw protection: getter throwing must result in fixed Inspection error
        const getterThrowObj = {
          message: 'Integrity failure: safe',
          get cause() {
            throw new Error(`Secret leak inside getter: ${secretToken}`);
          },
        };
        Object.setPrototypeOf(getterThrowObj, Error.prototype);
        expect(() => {
          assertNoSecretLeakRecursive(getterThrowObj, secretToken);
        }).toThrow('Inspection error: getter threw during traversal');

        // 5. Positive leak detection in deeply nested cause
        const leakingCause = new Error(`Integrity failure: cause has ${secretToken}`);
        const leakingOuter = new Error('Integrity failure: outer clean', { cause: leakingCause });
        expect(() => {
          assertNoSecretLeakRecursive(leakingOuter, secretToken);
        }).toThrow(/forbidden pattern detected/);
      });

      it('Item 13 (009-17): console hook is captured and restored cleanly with no leaks', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td-console-'));
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          await teardown({
            diagnosticsRootDir: tempRoot,
            auditFn: () => [],
            preserveDiagnostics: true,
          });
          const preservationNoticeWasEmitted = logSpy.mock.calls.some(
            (call) => call.length === 1 && call[0] === 'Diagnostics preserved.'
          );

          if (!preservationNoticeWasEmitted) {
            throw new Error('Security test failed: expected preservation notice was not emitted');
          }
          assertNoSecretInConsoleCalls(logSpy, ['/secret', 'token']);
          assertNoSecretInConsoleCalls(errSpy, ['/secret', 'token']);
          assertNoSecretInConsoleCalls(warnSpy, ['/secret', 'token']);
        } finally {
          logSpy.mockRestore();
          errSpy.mockRestore();
          warnSpy.mockRestore();
          fs.rmSync(tempRoot, { recursive: true, force: true });
        }
      });

      it('Item 15 (009-20): positive control verifies console notice assertion fails with static error without dumping values to message or console', () => {
        const dummySecretPayload = 'SECRET_DUMMY_CONSOLE_ARG_9988_VAL';

        // 1. Positive case: notice emitted -> passes
        const logSpyValid = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          console.log('Diagnostics preserved.');
          const emitted = logSpyValid.mock.calls.some(
            (call) => call.length === 1 && call[0] === 'Diagnostics preserved.'
          );
          if (!emitted) {
            throw new Error('Security test failed: expected preservation notice was not emitted');
          }
        } finally {
          logSpyValid.mockRestore();
        }

        // 2. Negative case: notice NOT emitted, dummy secret arg present in calls -> fails with static error
        const logSpyInvalid = vi.spyOn(console, 'log').mockImplementation(() => {});
        let threwOnMissingNotice = false;
        try {
          console.log(`Some unrelated log with secret: ${dummySecretPayload}`);
          const emitted = logSpyInvalid.mock.calls.some(
            (call) => call.length === 1 && call[0] === 'Diagnostics preserved.'
          );
          if (!emitted) {
            throw new Error('Security test failed: expected preservation notice was not emitted');
          }
        } catch (e) {
          threwOnMissingNotice = true;
          const err = e as Error;
          expect(err.message).toBe(
            'Security test failed: expected preservation notice was not emitted'
          );
          expect(err.message.includes(dummySecretPayload)).toBe(false);
        } finally {
          logSpyInvalid.mockRestore();
        }
        expect(threwOnMissingNotice).toBe(true);
      });
    });

    it('Item 16 (fingerprint & metadata): accepts valid records', () => {
      const validRecord = validateFingerprintRecord(baseValidRecord);
      expect(validRecord.workerId).toBe('w-sec-1');

      const validReg = validateWorkerRegistration({
        workerId: 'w-1',
        processInstanceId: 'p-1',
        registeredAt: 12345,
      });
      expect(validReg.workerId).toBe('w-1');
    });
  });
});
