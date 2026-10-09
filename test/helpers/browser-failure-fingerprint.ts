import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidSignal } from './diagnostics-collector.js';

export type StderrBucket = 'none' | 'small' | 'medium' | 'large';

export type FailureFingerprintIndicator =
  | 'permission-indicator'
  | 'resource-limit-indicator'
  | 'profile-lock-indicator'
  | 'sandbox-indicator'
  | 'dynamic-library-indicator'
  | 'architecture-indicator'
  | 'code-signing-indicator'
  | 'crash-handler-indicator'
  | 'assertion-indicator'
  | 'memory-indicator'
  | 'no-specific-indicator';

export interface FingerprintAttemptParams {
  workerId: string;
  processInstanceId: string;
  attemptId: string;
  exitCode?: number | null | 'unavailable';
  signal?: string | 'unavailable';
  spawned?: boolean;
  hasPid?: boolean;
  elapsedMs?: number | 'unavailable';
  resourceMetrics?: { rss: number; heap: number; openFd: number };
}

export interface SidecarFingerprintRecord {
  workerId: string;
  processInstanceId: string;
  attemptId: string;
  correlationKey: string;
  stderrPresent: boolean;
  stderrBucket: StderrBucket;
  fingerprintIndicators: FailureFingerprintIndicator[];
  exitCode: number | null | 'unavailable';
  signal: string | 'unavailable';
  spawned: boolean;
  hasPid: boolean;
  elapsedMs: number | 'unavailable';
  resourceMetrics?: { rss: number; heap: number; openFd: number };
}

type AttemptLifecycleState = 'active' | 'finalized' | 'consumed' | 'cleaned';

const MAX_BUFFER_BYTES = 64 * 1024; // 64 KB limit

export function classifyStderrBucket(byteLength: number): StderrBucket {
  if (byteLength <= 0) return 'none';
  if (byteLength <= 512) return 'small';
  if (byteLength <= 4096) return 'medium';
  return 'large';
}

const INDICATOR_RULES: Array<{
  indicator: FailureFingerprintIndicator;
  patterns: RegExp[];
}> = [
  {
    indicator: 'permission-indicator',
    patterns: [
      /\bpermission denied\b/i,
      /\beacces\b/i,
      /\boperation not permitted\b/i,
      /\baccess is denied\b/i,
    ],
  },
  {
    indicator: 'resource-limit-indicator',
    patterns: [
      /\bresource temporarily unavailable\b/i,
      /\bemfile\b/i,
      /\benfile\b/i,
      /\btoo many open files\b/i,
      /\bmax user processes\b/i,
      /\bresource limit\b/i,
    ],
  },
  {
    indicator: 'profile-lock-indicator',
    patterns: [
      /\bprofile in use\b/i,
      /\bsingletonlock\b/i,
      /\bsingletoncookie\b/i,
      /\blockfile\b/i,
      /\bprofile cannot be used\b/i,
    ],
  },
  {
    indicator: 'sandbox-indicator',
    patterns: [
      /\bsandbox_init\b/i,
      /\bfailed to initialize sandbox\b/i,
      /\bseccomp\b/i,
      /\bsetprocessmitigationpolicy\b/i,
      /\bsandbox.*cannot be initialized\b/i,
    ],
  },
  {
    indicator: 'dynamic-library-indicator',
    patterns: [
      /\bdyld: library not loaded\b/i,
      /\bimage not found\b/i,
      /\bsymbol not found\b/i,
      /\bdll load failed\b/i,
      /\bcannot open shared object\b/i,
    ],
  },
  {
    indicator: 'architecture-indicator',
    patterns: [
      /\bbad cpu type in executable\b/i,
      /\bwrong architecture\b/i,
      /\bincompatible architecture\b/i,
      /\bmach-o.*wrong architecture\b/i,
    ],
  },
  {
    indicator: 'code-signing-indicator',
    patterns: [
      /\bcode signature invalid\b/i,
      /\bkilled: 9\b/i,
      /\bamfi:\b/i,
      /\binvalid signature\b/i,
      /\bcode sign\b/i,
    ],
  },
  {
    indicator: 'crash-handler-indicator',
    patterns: [/\bcrashpad\b/i, /\bbreakpad\b/i, /\bcrash_reporter\b/i, /\bminidump\b/i],
  },
  {
    indicator: 'assertion-indicator',
    patterns: [
      /\bassertion failed\b/i,
      /\bfatal:.*check failed\b/i,
      /\bdcheck failed\b/i,
      /\bcheck failed:\b/i,
      /\bassert failed\b/i,
    ],
  },
  {
    indicator: 'memory-indicator',
    patterns: [
      /\bout of memory\b/i,
      /\benomem\b/i,
      /\bcannot allocate memory\b/i,
      /\boom killer\b/i,
    ],
  },
];

export function classifyStderrToIndicators(text: string): FailureFingerprintIndicator[] {
  if (!text || text.trim().length === 0) {
    return ['no-specific-indicator'];
  }

  try {
    const matched: FailureFingerprintIndicator[] = [];
    for (const rule of INDICATOR_RULES) {
      if (rule.patterns.some((re) => re.test(text))) {
        matched.push(rule.indicator);
      }
    }
    if (matched.length === 0) {
      return ['no-specific-indicator'];
    }
    return matched;
  } catch {
    return ['no-specific-indicator'];
  }
}

interface AttemptTrackerEntry {
  state: AttemptLifecycleState;
  workerId: string;
  processInstanceId: string;
  attemptId: string;
  correlationKey: string;
  buffer: string[];
  totalBytes: number;
}

export type SidecarWriterFn = (record: SidecarFingerprintRecord) => void;

export class BrowserFailureFingerprintTracker {
  private entries = new Map<string, AttemptTrackerEntry>();
  private writer: SidecarWriterFn | null = null;
  private writerFailureCount = 0;
  private finalizedCount = 0;

  constructor(customWriter?: SidecarWriterFn | null) {
    this.writer = customWriter ?? null;
  }

  public setWriter(writer: SidecarWriterFn | null): void {
    this.writer = writer;
  }

  public getWriterFailureCount(): number {
    return this.writerFailureCount;
  }

  public getFinalizedCount(): number {
    return this.finalizedCount;
  }

  public registerAttempt(workerId: string, processInstanceId: string, attemptId: string): string {
    const correlationKey = `${workerId}:${processInstanceId}:${attemptId}`;
    if (!this.entries.has(correlationKey)) {
      this.entries.set(correlationKey, {
        state: 'active',
        workerId,
        processInstanceId,
        attemptId,
        correlationKey,
        buffer: [],
        totalBytes: 0,
      });
    }
    return correlationKey;
  }

  public appendStderr(correlationKey: string, chunk: Buffer | string): void {
    const entry = this.entries.get(correlationKey);
    if (!entry || entry.state !== 'active') {
      return;
    }

    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const bytes = Buffer.byteLength(str, 'utf8');
    entry.totalBytes += bytes;

    if (entry.totalBytes <= MAX_BUFFER_BYTES) {
      entry.buffer.push(str);
    } else {
      // Retain up to buffer limit if still under, but stop adding text chunks once over limit
      const currentBuffered = entry.buffer.reduce(
        (acc, c) => acc + Buffer.byteLength(c, 'utf8'),
        0
      );
      if (currentBuffered < MAX_BUFFER_BYTES) {
        entry.buffer.push(str.slice(0, MAX_BUFFER_BYTES - currentBuffered));
      }
    }
  }

  public finalizeAttempt(
    correlationKey: string,
    params?: Partial<FingerprintAttemptParams>
  ): SidecarFingerprintRecord | null {
    const entry = this.entries.get(correlationKey);
    if (!entry) {
      return null;
    }

    if (entry.state !== 'active') {
      // Idempotent: once finalized, consumed, or cleaned, ignore subsequent attempts
      return null;
    }

    entry.state = 'finalized';
    this.finalizedCount++;

    try {
      const fullStderr = entry.buffer.join('');
      const stderrPresent = entry.totalBytes > 0;
      const stderrBucket = classifyStderrBucket(entry.totalBytes);
      const indicators = classifyStderrToIndicators(fullStderr);

      const record: SidecarFingerprintRecord = {
        workerId: entry.workerId,
        processInstanceId: entry.processInstanceId,
        attemptId: entry.attemptId,
        correlationKey: entry.correlationKey,
        stderrPresent,
        stderrBucket,
        fingerprintIndicators: indicators,
        exitCode: params?.exitCode ?? 'unavailable',
        signal: params?.signal ?? 'unavailable',
        spawned: params?.spawned ?? false,
        hasPid: params?.hasPid ?? false,
        elapsedMs: params?.elapsedMs ?? 'unavailable',
        resourceMetrics: params?.resourceMetrics,
      };

      if (this.writer) {
        try {
          this.writer(record);
        } catch {
          this.writerFailureCount++;
        }
      }

      return record;
    } finally {
      // Buffer must always be completely wiped out immediately upon finalization
      entry.buffer = [];
    }
  }

  public consumeAttempt(correlationKey: string): void {
    const entry = this.entries.get(correlationKey);
    if (entry) {
      if (entry.state === 'active') {
        this.finalizeAttempt(correlationKey);
      }
      entry.state = 'consumed';
      entry.buffer = [];
      this.entries.delete(correlationKey);
    }
  }

  public cleanupAttempt(correlationKey: string): void {
    const entry = this.entries.get(correlationKey);
    if (entry) {
      if (entry.state === 'active') {
        this.finalizeAttempt(correlationKey);
      }
      entry.state = 'cleaned';
      entry.buffer = [];
      this.entries.delete(correlationKey);
    }
  }

  public getPendingCount(): number {
    return this.entries.size;
  }

  public clearAll(): void {
    for (const entry of this.entries.values()) {
      entry.buffer = [];
    }
    this.entries.clear();
    this.writerFailureCount = 0;
  }
}

export interface WorkerIntegrityManifest {
  workerId: string;
  processInstanceId: string;
  expectedDiagnosticRecordCount: number;
  writtenDiagnosticRecordCount: number;
  expectedFingerprintRecordCount: number;
  writtenFingerprintRecordCount: number;
  finalizedAttemptCount: number;
  diagnosticWriterFailureCount: number;
  fingerprintWriterFailureCount: number;
  observedBrowserProcessCount: number;
  liveBrowserProcessCountAtTeardown: number;
  unreleasedBrowserProcessCount: number;
  flushed: boolean;
}

export const ALLOWED_FINGERPRINT_INDICATORS: ReadonlySet<FailureFingerprintIndicator> = new Set([
  'permission-indicator',
  'resource-limit-indicator',
  'profile-lock-indicator',
  'sandbox-indicator',
  'dynamic-library-indicator',
  'architecture-indicator',
  'code-signing-indicator',
  'crash-handler-indicator',
  'assertion-indicator',
  'memory-indicator',
  'no-specific-indicator',
]);

const ALLOWED_RECORD_KEYS = new Set([
  'workerId',
  'processInstanceId',
  'attemptId',
  'correlationKey',
  'stderrPresent',
  'stderrBucket',
  'fingerprintIndicators',
  'exitCode',
  'signal',
  'spawned',
  'hasPid',
  'elapsedMs',
  'resourceMetrics',
]);

const ALLOWED_MANIFEST_KEYS = new Set([
  'workerId',
  'processInstanceId',
  'expectedDiagnosticRecordCount',
  'writtenDiagnosticRecordCount',
  'expectedFingerprintRecordCount',
  'writtenFingerprintRecordCount',
  'finalizedAttemptCount',
  'diagnosticWriterFailureCount',
  'fingerprintWriterFailureCount',
  'observedBrowserProcessCount',
  'liveBrowserProcessCountAtTeardown',
  'unreleasedBrowserProcessCount',
  'flushed',
]);

export function validateFingerprintRecord(data: unknown): SidecarFingerprintRecord {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid fingerprint record: must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_RECORD_KEYS.has(key)) {
      throw new Error('Invalid fingerprint record: unknown key present');
    }
  }

  const {
    workerId,
    processInstanceId,
    attemptId,
    correlationKey,
    stderrPresent,
    stderrBucket,
    fingerprintIndicators,
    exitCode,
    signal,
    spawned,
    hasPid,
    elapsedMs,
    resourceMetrics,
  } = obj;

  if (typeof workerId !== 'string' || !workerId) {
    throw new Error('Invalid fingerprint record: workerId must be non-empty string');
  }
  if (typeof processInstanceId !== 'string' || !processInstanceId) {
    throw new Error('Invalid fingerprint record: processInstanceId must be non-empty string');
  }
  if (typeof attemptId !== 'string' || !attemptId) {
    throw new Error('Invalid fingerprint record: attemptId must be non-empty string');
  }
  if (typeof correlationKey !== 'string' || !correlationKey) {
    throw new Error('Invalid fingerprint record: correlationKey must be non-empty string');
  }

  const expectedCorrelation = `${workerId}:${processInstanceId}:${attemptId}`;
  if (correlationKey !== expectedCorrelation) {
    throw new Error('Invalid fingerprint record: correlationKey mismatch');
  }

  if (typeof stderrPresent !== 'boolean') {
    throw new Error('Invalid fingerprint record: stderrPresent must be boolean');
  }

  if (
    typeof stderrBucket !== 'string' ||
    !['none', 'small', 'medium', 'large'].includes(stderrBucket)
  ) {
    throw new Error('Invalid fingerprint record: invalid stderrBucket');
  }

  if (!Array.isArray(fingerprintIndicators)) {
    throw new Error('Invalid fingerprint record: fingerprintIndicators must be array');
  }

  const indicatorSet = new Set<string>();
  for (const ind of fingerprintIndicators) {
    if (
      typeof ind !== 'string' ||
      !ALLOWED_FINGERPRINT_INDICATORS.has(ind as FailureFingerprintIndicator)
    ) {
      throw new Error('Invalid fingerprint record: unknown indicator enum');
    }
    if (indicatorSet.has(ind)) {
      throw new Error('Invalid fingerprint record: duplicate indicator in array');
    }
    indicatorSet.add(ind);
  }

  if (typeof spawned !== 'boolean') {
    throw new Error('Invalid fingerprint record: spawned must be boolean');
  }
  if (typeof hasPid !== 'boolean') {
    throw new Error('Invalid fingerprint record: hasPid must be boolean');
  }

  if (exitCode !== null && exitCode !== 'unavailable' && typeof exitCode !== 'number') {
    throw new Error('Invalid fingerprint record: invalid exitCode');
  }
  if (signal !== undefined) {
    if (!isValidSignal(signal)) {
      throw new Error(
        'Invalid fingerprint record: signal must be an allowed signal or unavailable'
      );
    }
  }
  if (typeof elapsedMs !== 'number' && elapsedMs !== 'unavailable') {
    throw new Error('Invalid fingerprint record: invalid elapsedMs');
  }

  if (resourceMetrics !== undefined) {
    if (typeof resourceMetrics !== 'object' || resourceMetrics === null) {
      throw new Error('Invalid fingerprint record: invalid resourceMetrics');
    }
  }

  return {
    workerId,
    processInstanceId,
    attemptId,
    correlationKey,
    stderrPresent,
    stderrBucket: stderrBucket as StderrBucket,
    fingerprintIndicators: fingerprintIndicators as FailureFingerprintIndicator[],
    exitCode: exitCode as number | null | 'unavailable',
    signal: signal as string | 'unavailable',
    spawned,
    hasPid,
    elapsedMs: elapsedMs as number | 'unavailable',
    resourceMetrics: resourceMetrics as { rss: number; heap: number; openFd: number } | undefined,
  };
}

export interface MetadataReadResult<T> {
  records: T[];
  discoveredFileCount: number;
  validFileCount: number;
  invalidFileCount: number;
  duplicateWorkerKeyCount: number;
}

export interface WorkerRegistrationRecord {
  workerId: string;
  processInstanceId: string;
  registeredAt: number;
}

function isValidSafeId(id: unknown): id is string {
  if (typeof id !== 'string' || !id) return false;
  if (
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f\r\n]/.test(id)
  ) {
    return false;
  }
  return true;
}

const ALLOWED_REGISTRATION_KEYS = new Set(['workerId', 'processInstanceId', 'registeredAt']);

export function validateWorkerRegistration(
  data: unknown,
  fileName?: string
): WorkerRegistrationRecord {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid worker registration: must be an object');
  }

  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_REGISTRATION_KEYS.has(key)) {
      throw new Error('Invalid worker registration: unknown key present');
    }
  }

  if (!isValidSafeId(obj.workerId)) {
    throw new Error('Invalid worker registration: invalid workerId');
  }
  if (!isValidSafeId(obj.processInstanceId)) {
    throw new Error('Invalid worker registration: invalid processInstanceId');
  }
  if (
    typeof obj.registeredAt !== 'number' ||
    !Number.isInteger(obj.registeredAt) ||
    obj.registeredAt < 0
  ) {
    throw new Error('Invalid worker registration: registeredAt must be non-negative integer');
  }

  if (fileName) {
    const expectedName = `reg-worker-${obj.workerId}-${obj.processInstanceId}.json`;
    if (fileName !== expectedName) {
      throw new Error('Invalid worker registration: worker key mismatch with file name');
    }
  }

  return obj as unknown as WorkerRegistrationRecord;
}

export function validateWorkerManifest(data: unknown, fileName?: string): WorkerIntegrityManifest {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid worker manifest: must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      throw new Error('Invalid worker manifest: unknown key present');
    }
  }

  if (!isValidSafeId(obj.workerId)) {
    throw new Error('Invalid worker manifest: invalid workerId');
  }
  if (!isValidSafeId(obj.processInstanceId)) {
    throw new Error('Invalid worker manifest: invalid processInstanceId');
  }

  const numericFields = [
    'expectedDiagnosticRecordCount',
    'writtenDiagnosticRecordCount',
    'expectedFingerprintRecordCount',
    'writtenFingerprintRecordCount',
    'finalizedAttemptCount',
    'diagnosticWriterFailureCount',
    'fingerprintWriterFailureCount',
    'observedBrowserProcessCount',
    'liveBrowserProcessCountAtTeardown',
    'unreleasedBrowserProcessCount',
  ] as const;

  for (const field of numericFields) {
    const val = obj[field];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
      throw new Error(`Invalid worker manifest: ${field} must be non-negative integer`);
    }
  }

  if (typeof obj.flushed !== 'boolean') {
    throw new Error('Invalid worker manifest: flushed must be boolean');
  }

  const manifest = obj as unknown as WorkerIntegrityManifest;

  if (manifest.writtenDiagnosticRecordCount > manifest.expectedDiagnosticRecordCount) {
    throw new Error(
      'Invalid worker manifest: writtenDiagnosticRecordCount exceeds expectedDiagnosticRecordCount'
    );
  }
  if (manifest.writtenFingerprintRecordCount > manifest.expectedFingerprintRecordCount) {
    throw new Error(
      'Invalid worker manifest: writtenFingerprintRecordCount exceeds expectedFingerprintRecordCount'
    );
  }
  if (manifest.finalizedAttemptCount !== manifest.writtenFingerprintRecordCount) {
    throw new Error(
      'Invalid worker manifest: finalizedAttemptCount mismatch with writtenFingerprintRecordCount'
    );
  }

  if (fileName) {
    const expectedName = `manifest-worker-${manifest.workerId}-${manifest.processInstanceId}.json`;
    if (fileName !== expectedName) {
      throw new Error('Invalid worker manifest: worker key mismatch with file name');
    }
  }

  return manifest;
}

export function readAllFingerprintRecords(
  fingerprintsDir: string,
  fsOps?: Partial<typeof fs>
): {
  records: SidecarFingerprintRecord[];
  invalidCount: number;
} {
  const fileSystem = { ...fs, ...fsOps };
  try {
    if (!fileSystem.existsSync(fingerprintsDir)) {
      return { records: [], invalidCount: 1 };
    }

    const files = fileSystem.readdirSync(fingerprintsDir);
    const records: SidecarFingerprintRecord[] = [];
    let invalidCount = 0;

    for (const file of files) {
      if (!file.startsWith('fingerprint-worker-') || !file.endsWith('.jsonl')) {
        invalidCount++;
        continue;
      }
      const fullPath = path.join(fingerprintsDir, file);
      try {
        const content = fileSystem.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const valid = validateFingerprintRecord(parsed);
            records.push(valid);
          } catch {
            invalidCount++;
          }
        }
      } catch {
        invalidCount++;
      }
    }

    return { records, invalidCount };
  } catch {
    return { records: [], invalidCount: 1 };
  }
}

export function writeWorkerRegistration(
  registryDir: string,
  workerId: string,
  processInstanceId: string
): void {
  fs.mkdirSync(registryDir, { recursive: true });
  const fileName = `reg-worker-${workerId}-${processInstanceId}.json`;
  const filePath = path.join(registryDir, fileName);
  const data = JSON.stringify({ workerId, processInstanceId, registeredAt: Date.now() });
  fs.writeFileSync(filePath, data, 'utf8');
}

export function readAllWorkerRegistrations(
  registryDir: string,
  fsOps?: Partial<typeof fs>
): MetadataReadResult<WorkerRegistrationRecord> {
  const fileSystem = { ...fs, ...fsOps };
  try {
    if (!fileSystem.existsSync(registryDir)) {
      return {
        records: [],
        discoveredFileCount: 0,
        validFileCount: 0,
        invalidFileCount: 1,
        duplicateWorkerKeyCount: 0,
      };
    }

    const allFiles = fileSystem.readdirSync(registryDir);
    const records: WorkerRegistrationRecord[] = [];
    let invalidFileCount = 0;
    const seenKeys = new Set<string>();
    let duplicateWorkerKeyCount = 0;

    for (const file of allFiles) {
      if (!file.startsWith('reg-worker-') || !file.endsWith('.json')) {
        invalidFileCount++;
        continue;
      }
      const fullPath = path.join(registryDir, file);
      try {
        const content = fileSystem.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(content);
        const valid = validateWorkerRegistration(parsed, file);
        const key = `${valid.workerId}:${valid.processInstanceId}`;
        if (seenKeys.has(key)) {
          duplicateWorkerKeyCount++;
        } else {
          seenKeys.add(key);
        }
        records.push(valid);
      } catch {
        invalidFileCount++;
      }
    }

    return {
      records,
      discoveredFileCount: allFiles.length,
      validFileCount: records.length,
      invalidFileCount,
      duplicateWorkerKeyCount,
    };
  } catch {
    return {
      records: [],
      discoveredFileCount: 0,
      validFileCount: 0,
      invalidFileCount: 1,
      duplicateWorkerKeyCount: 0,
    };
  }
}

export function writeWorkerManifest(manifestsDir: string, manifest: WorkerIntegrityManifest): void {
  fs.mkdirSync(manifestsDir, { recursive: true });
  const targetName = `manifest-worker-${manifest.workerId}-${manifest.processInstanceId}.json`;
  const targetPath = path.join(manifestsDir, targetName);
  const tmpPath = path.join(manifestsDir, `${targetName}.tmp`);

  const content = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

export function readAllWorkerManifests(
  manifestsDir: string,
  fsOps?: Partial<typeof fs>
): MetadataReadResult<WorkerIntegrityManifest> {
  const fileSystem = { ...fs, ...fsOps };
  try {
    if (!fileSystem.existsSync(manifestsDir)) {
      return {
        records: [],
        discoveredFileCount: 0,
        validFileCount: 0,
        invalidFileCount: 1,
        duplicateWorkerKeyCount: 0,
      };
    }

    const allFiles = fileSystem.readdirSync(manifestsDir);
    const tmpFiles = allFiles.filter((f) => f.includes('.tmp'));
    const regularFiles = allFiles.filter(
      (f) => f.startsWith('manifest-worker-') && f.endsWith('.json') && !f.includes('.tmp')
    );
    const unknownFiles = allFiles.filter(
      (f) =>
        !(f.startsWith('manifest-worker-') && f.endsWith('.json') && !f.includes('.tmp')) &&
        !f.includes('.tmp')
    );

    let invalidFileCount = tmpFiles.length + unknownFiles.length;
    const manifests: WorkerIntegrityManifest[] = [];
    const seenKeys = new Set<string>();
    let duplicateWorkerKeyCount = 0;

    for (const file of regularFiles) {
      const fullPath = path.join(manifestsDir, file);
      try {
        const content = fileSystem.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(content);
        const valid = validateWorkerManifest(parsed, file);
        const key = `${valid.workerId}:${valid.processInstanceId}`;
        if (seenKeys.has(key)) {
          duplicateWorkerKeyCount++;
        } else {
          seenKeys.add(key);
        }
        manifests.push(valid);
      } catch {
        invalidFileCount++;
      }
    }

    return {
      records: manifests,
      discoveredFileCount: regularFiles.length,
      validFileCount: manifests.length,
      invalidFileCount,
      duplicateWorkerKeyCount,
    };
  } catch {
    return {
      records: [],
      discoveredFileCount: 0,
      validFileCount: 0,
      invalidFileCount: 1,
      duplicateWorkerKeyCount: 0,
    };
  }
}

export function createDefaultSidecarFileWriter(
  targetDir: string,
  workerId: string,
  processInstanceId: string
): SidecarWriterFn {
  const fileName = `fingerprint-worker-${workerId}-${processInstanceId}.jsonl`;
  const filePath = path.join(targetDir, fileName);

  return (record: SidecarFingerprintRecord) => {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  };
}
