import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateDiagnosticEnvelope,
  validateSanitizedDiagnosticEvent,
  readAllDiagnosticEnvelopes,
  type TestDiagnosticEnvelope,
  type SanitizedTestDiagnosticEvent,
} from './diagnostics-collector.js';
import type { SafeResourceMetrics } from '../../src/diagram/internal-diagnostics.js';

function assertNoSecretLeak(actualText: string, forbiddenPattern: string): void {
  const containsLeak = actualText.includes(forbiddenPattern);
  if (containsLeak) {
    throw new Error('Security test failed: forbidden pattern detected in message');
  }
}

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

describe('diagnostics-collector validation and security', () => {
  const baseValidEvent: SanitizedTestDiagnosticEvent = {
    timestamp: 1000,
    serviceId: 'srv-1',
    stage: 'browser-launch-start',
    activePageCount: 0,
    runningExecutionCount: 0,
    queueLength: 0,
    hasProcessPid: true,
  };

  it('20. rejects unknown keys in envelope and strictly enforces scope contract', () => {
    const validAttemptEnvelope: TestDiagnosticEnvelope = {
      scope: 'attempt',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      event: baseValidEvent,
    };

    expect(() => validateDiagnosticEnvelope(validAttemptEnvelope)).not.toThrow();

    // Unknown envelope key
    expect(() =>
      validateDiagnosticEnvelope({
        ...validAttemptEnvelope,
        unexpectedField: 'bad',
      } as unknown as TestDiagnosticEnvelope)
    ).toThrow(/unknown key present/);

    // scope: 'attempt' but missing attemptId
    expect(() =>
      validateDiagnosticEnvelope({
        ...validAttemptEnvelope,
        attemptId: null as unknown as string,
        correlationKey: null as unknown as string,
      })
    ).toThrow(/attemptId must be non-empty string for attempt scope/);

    // scope: 'attempt' but mismatched correlationKey
    expect(() =>
      validateDiagnosticEnvelope({
        ...validAttemptEnvelope,
        correlationKey: 'wrong:key',
      })
    ).toThrow(/correlationKey mismatch/);

    // scope: 'lifecycle' with valid contract
    const validLifecycleEnvelope: TestDiagnosticEnvelope = {
      scope: 'lifecycle',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: null,
      correlationKey: null,
      event: baseValidEvent,
    };
    expect(() => validateDiagnosticEnvelope(validLifecycleEnvelope)).not.toThrow();

    // scope: 'lifecycle' but attemptId provided
    expect(() =>
      validateDiagnosticEnvelope({
        ...validLifecycleEnvelope,
        attemptId: 'att-1' as unknown as null,
        correlationKey: 'w-1:p-1:att-1' as unknown as null,
      })
    ).toThrow(/attemptId and correlationKey must be null for lifecycle scope/);

    // Unsafe workerId (path traversal)
    expect(() =>
      validateDiagnosticEnvelope({
        ...validAttemptEnvelope,
        workerId: '../escape',
      })
    ).toThrow(/invalid workerId/);

    // File name mismatch
    expect(() =>
      validateDiagnosticEnvelope(validAttemptEnvelope, 'diag-worker-other-p-1.jsonl')
    ).toThrow(/worker key mismatch with file name/);
  });

  it('21. rejects event unknown keys, unknown stages, type mismatches, negative numbers, and non-finites', () => {
    // Unknown event key
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        circuitState: 'closed',
      } as unknown as SanitizedTestDiagnosticEvent)
    ).toThrow(/unknown key present/);

    // Unknown stage
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        stage: 'non-existent-stage' as unknown as SanitizedTestDiagnosticEvent['stage'],
      })
    ).toThrow(/invalid or missing stage/);

    // Negative numbers
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        activePageCount: -1,
      })
    ).toThrow(/activePageCount must be non-negative integer/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        timestamp: -100,
      })
    ).toThrow(/timestamp must be non-negative integer/);

    // Non-finite numbers
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        activePageCount: Infinity,
      })
    ).toThrow(/activePageCount must be non-negative integer/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        timestamp: NaN,
      })
    ).toThrow(/timestamp must be non-negative integer/);

    // Numerical PID leak rejection
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        pid: 12345,
      } as unknown as SanitizedTestDiagnosticEvent)
    ).toThrow(/contains raw PID numbers/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        browserPid: 54321,
      } as unknown as SanitizedTestDiagnosticEvent)
    ).toThrow(/contains raw PID numbers/);

    // Non-boolean PID flags
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        hasProcessPid: 'true' as unknown as boolean,
      })
    ).toThrow(/hasProcessPid must be boolean/);
  });

  it('22. rejects unknown keys and invalid values in resourceMetrics', () => {
    const validMetrics: SafeResourceMetrics = {
      memoryRssMb: 120.5,
      memoryHeapUsedMb: 45.2,
      memoryExternalMb: 10.0,
      cpuUserSeconds: 1.5,
      cpuSystemSeconds: 0.3,
      openFdCount: 35,
    };

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: validMetrics,
      })
    ).not.toThrow();

    // Unknown key in resourceMetrics
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: {
          ...validMetrics,
          unknownMetric: 99,
        } as unknown as SafeResourceMetrics,
      })
    ).toThrow(/unknown resourceMetrics key present/);

    // Negative metric
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: {
          ...validMetrics,
          memoryRssMb: -1,
        },
      })
    ).toThrow(/memoryRssMb must be non-negative finite number/);

    // Non-finite metric (Infinity)
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: {
          ...validMetrics,
          memoryHeapUsedMb: Infinity,
        },
      })
    ).toThrow(/memoryHeapUsedMb must be non-negative finite number/);

    // Invalid openFdCount (float)
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: {
          ...validMetrics,
          openFdCount: 12.34 as unknown as number,
        },
      })
    ).toThrow(/resourceMetrics openFdCount must be non-negative integer or unavailable/);

    // Valid 'unavailable' openFdCount
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        resourceMetrics: {
          ...validMetrics,
          openFdCount: 'unavailable',
        },
      })
    ).not.toThrow();
  });

  it('Item 1: rejects sanitizedReason containing newlines', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'first line\nsecond line',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'first line\r\nsecond line',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 2: rejects sanitizedReason containing non-newline control characters', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'error\x00code',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'escape\x1Bseq',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'del\x7Fchar',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 3: rejects sanitizedReason containing POSIX absolute paths with boundary checking', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: '/opt/browser',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'path:/var/tmp/example',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'source=/Users/example/file',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 4: rejects sanitizedReason containing Windows absolute or UNC paths', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'failed at C:\\Users\\Administrator\\AppData',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'failed at \\\\fileserver\\shared\\data',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 5: rejects sanitizedReason containing file: URLs', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'file:///private/var/folders/data.html',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 6: rejects sanitizedReason containing http: or https: URLs', () => {
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'failed to fetch https://example.com/api',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'failed to connect http://insecure.test/socket',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 7: rejects sanitizedReason containing typical secret formats', () => {
    // Private key header
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: '-----BEGIN RSA PRIVATE KEY----- test',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    // Bearer token
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'Bearer secret_token_xyz_123',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    // API key
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'api-error sk-proj-12345678901234567890',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    // Query auth
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'error at endpoint?access_token=secret_val',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    // Specific URI schemes
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'data:text/plain;base64,AAA=',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'javascript:void(0)',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'mailto:developer@test.local',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'tel:+1234567890',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        sanitizedReason: 'urn:isbn:0451450523',
      })
    ).toThrow(/sanitizedReason contains unsafe content/);
  });

  it('Item 8: accepts typical safe standardized reason phrases including ratio boundary', () => {
    const safeReasons = [
      '1/2',
      'exit code 1',
      'timeout after 30000ms',
      'browser closed unexpectedly',
      'launch failed with unknown error',
      'process exited early',
    ];

    for (const reason of safeReasons) {
      expect(() =>
        validateSanitizedDiagnosticEvent({
          ...baseValidEvent,
          sanitizedReason: reason,
        })
      ).not.toThrow();
    }
  });

  it('Item 9: rejects invalid signal and accepts allowed cross-platform signals and unavailable', () => {
    // Invalid signals
    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        signal: 'INVALID_SIGNAL',
      })
    ).toThrow(/signal must be an allowed signal or unavailable/);

    expect(() =>
      validateSanitizedDiagnosticEvent({
        ...baseValidEvent,
        signal: 'SIGTOOLONGSIGNALNAME123456789',
      })
    ).toThrow(/signal must be an allowed signal or unavailable/);

    // Allowed signals across Linux, macOS, Windows
    const allowed = [
      'SIGABRT',
      'SIGSEGV',
      'SIGBUS',
      'SIGTRAP',
      'SIGBREAK',
      'SIGKILL',
      'SIGTERM',
      'unavailable',
    ];

    for (const sig of allowed) {
      expect(() =>
        validateSanitizedDiagnosticEvent({
          ...baseValidEvent,
          signal: sig,
        })
      ).not.toThrow();
    }
  });

  it('Item 10 (009-17): does not leak secret in exception when all 6 real formats are placed in event unknown key name', () => {
    const dummyRealFormatKeys = [
      '/var/tmp/dummy_secret.json',
      'C:\\Users\\dummy\\secret.txt',
      '\\\\server\\share\\secret_data',
      'https://example.dummy.local/secret/path',
      'https://user:pass@example.dummy.local/secret',
      'bearer_dummy_secret_key_998877',
    ];

    for (const key of dummyRealFormatKeys) {
      try {
        validateSanitizedDiagnosticEvent({
          ...baseValidEvent,
          [key]: 'dummy_value',
        } as unknown as SanitizedTestDiagnosticEvent);
        expect.fail('Should have thrown validation error for unknown key');
      } catch (err) {
        const msg = (err as Error).message;
        assertNoSecretLeak(msg, key);
        expect(msg).toBe('Invalid diagnostic event: unknown key present');
      }
    }
  });

  it('Item 11: does not leak path or URL in exception when real path/URL format is placed in envelope unknown key name', () => {
    const dummyKeys = [
      '/var/tmp/dummy_secret_file.json',
      'C:\\Users\\dummy\\secret.txt',
      '\\\\server\\share\\secret_data',
      'https://example.dummy.local/secret/path',
      'https://user:pass@example.dummy.local/secret',
    ];

    for (const key of dummyKeys) {
      try {
        validateDiagnosticEnvelope({
          scope: 'attempt',
          workerId: 'w-1',
          processInstanceId: 'p-1',
          attemptId: 'att-1',
          correlationKey: 'w-1:p-1:att-1',
          event: baseValidEvent,
          [key]: 'dummy_value',
        } as unknown as TestDiagnosticEnvelope);
        expect.fail('Should have thrown validation error for unknown key');
      } catch (err) {
        const msg = (err as Error).message;
        assertNoSecretLeak(msg, key);
        expect(msg).toBe('Invalid diagnostic envelope: unknown key present');
      }
    }
  });

  it('Item 12 (009-17): does not leak secret in exception when all 6 real formats are placed in resourceMetrics unknown key name', () => {
    const dummyRealMetricKeys = [
      '/var/tmp/dummy_metric.json',
      'C:\\Users\\dummy\\metric.txt',
      '\\\\server\\share\\metric_data',
      'https://example.dummy.local/metric/path',
      'https://user:pass@example.dummy.local/metric',
      'bearer_dummy_secret_metric_998877',
    ];

    for (const key of dummyRealMetricKeys) {
      try {
        validateSanitizedDiagnosticEvent({
          ...baseValidEvent,
          resourceMetrics: {
            memoryRssMb: 100,
            memoryHeapUsedMb: 50,
            memoryExternalMb: 10,
            [key]: 123,
          } as unknown as SafeResourceMetrics,
        });
        expect.fail('Should have thrown validation error for unknown resourceMetrics key');
      } catch (err) {
        const msg = (err as Error).message;
        assertNoSecretLeak(msg, key);
        expect(msg).toBe('Invalid diagnostic event: unknown resourceMetrics key present');
      }
    }
  });

  describe('Item 5 (009-17): diagnostics reader 4-path error handling with return/console security proof', () => {
    it('Path 1: missing directory returns invalidCount >= 1 and empty array without throwing', () => {
      const nonExistentDir = path.join(os.tmpdir(), 'missing-diag-dir-' + Date.now());
      const res = readAllDiagnosticEnvelopes(nonExistentDir);
      expect(res.invalidCount).toBeGreaterThanOrEqual(1);
      expect(res.envelopes).toEqual([]);
    });

    it('Path 2: directory readdirSync failure returns invalidCount >= 1 without throwing, leaking to return or console', () => {
      const secretPath = '/var/secret/test/path';
      const secretUrl = 'https://user:token123@leak.internal.local/dir';
      const forbiddenList = [secretPath, secretUrl, 'token123'];

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const res = readAllDiagnosticEnvelopes('/test/diagnostics', {
          existsSync: () => true,
          readdirSync: () => {
            throw new Error(`EACCES: permission denied ${secretPath} (ref ${secretUrl})`);
          },
        } as unknown as typeof fs);

        expect(res.invalidCount).toBeGreaterThanOrEqual(1);
        expect(res.envelopes).toEqual([]);
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
      const secretFile = '/var/secret/corrupted.jsonl';
      const secretToken = 'bearer_secret_io_read_token_999';
      const forbiddenList = [secretFile, secretToken];

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const res = readAllDiagnosticEnvelopes('/test/diagnostics', {
          existsSync: () => true,
          readdirSync: () => ['diag-worker-w1-p1.jsonl' as unknown as fs.Dirent],
          readFileSync: () => {
            throw new Error(`EIO: disk read failure on ${secretFile} with ${secretToken}`);
          },
        } as unknown as typeof fs);

        expect(res.invalidCount).toBeGreaterThanOrEqual(1);
        expect(res.envelopes).toEqual([]);
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
      const res = readAllDiagnosticEnvelopes('/test/diagnostics', {
        existsSync: () => true,
        readdirSync: () => ['diag-worker-w1-p1.jsonl' as unknown as fs.Dirent],
        readFileSync: () => '{"corrupt_json": true\n{"valid_json_but_invalid_schema": 123}\n',
      } as unknown as typeof fs);
      expect(res.invalidCount).toBeGreaterThanOrEqual(1);
      expect(res.envelopes).toEqual([]);
    });
  });

  it('Item 16 (diagnostics): accepts valid normal diagnostic event and envelope records', () => {
    const validAttemptEnvelope: TestDiagnosticEnvelope = {
      scope: 'attempt',
      workerId: 'w-1',
      processInstanceId: 'p-1',
      attemptId: 'att-1',
      correlationKey: 'w-1:p-1:att-1',
      event: {
        ...baseValidEvent,
        sanitizedReason: 'exit code 1',
        signal: 'SIGABRT',
        elapsedMs: 250.5,
      },
    };

    const res = validateDiagnosticEnvelope(validAttemptEnvelope);
    expect(res.workerId).toBe('w-1');
    expect(res.event.sanitizedReason).toBe('exit code 1');
  });
});
