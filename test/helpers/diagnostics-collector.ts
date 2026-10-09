import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InternalDiagnosticEvent } from '../../src/diagram/internal-diagnostics.js';
import type { WorkerIntegrityManifest } from './browser-failure-fingerprint.js';

export type SanitizedTestDiagnosticEvent = Omit<
  InternalDiagnosticEvent,
  'pid' | 'browserPid' | 'childPid'
> & {
  hasProcessPid: boolean;
  hasBrowserPid?: boolean;
  hasChildPid?: boolean;
};

export type TestDiagnosticEnvelope =
  | {
      scope: 'attempt';
      workerId: string;
      processInstanceId: string;
      attemptId: string;
      correlationKey: string;
      event: SanitizedTestDiagnosticEvent;
    }
  | {
      scope: 'lifecycle';
      workerId: string;
      processInstanceId: string;
      attemptId: null;
      correlationKey: null;
      event: SanitizedTestDiagnosticEvent;
    };

export interface DiagnosticsSummary {
  readonly totalEvents: number;
  readonly workerCount: number;
  readonly browserProcessObservedCount: number;
  readonly maxConcurrentLaunches: number;
  readonly maxConcurrentBrowsers: number;
  readonly maxConcurrentPages: number;
  readonly failureStageCounts: Record<string, number>;
  readonly firstFailure?: {
    readonly stage: string;
    readonly sanitizedReason?: string;
    readonly workerId?: string;
    readonly timestamp: number;
    readonly launchAttempt?: number;
    readonly elapsedMs?: number;
    readonly spawned?: boolean;
    readonly hasChildPid?: boolean;
    readonly exitCode?: number | null | 'unavailable';
    readonly signal?: string | 'unavailable';
    readonly stderrCategory?: string;
    readonly resourceMetrics?: import('../../src/diagram/internal-diagnostics.js').SafeResourceMetrics;
  };
}

export function sanitizeDiagnosticEvent(
  event: InternalDiagnosticEvent
): SanitizedTestDiagnosticEvent {
  const { pid, browserPid, childPid, ...rest } = event;
  const sanitized: SanitizedTestDiagnosticEvent = {
    ...rest,
    hasProcessPid: typeof pid === 'number',
  };
  if (browserPid !== undefined) {
    sanitized.hasBrowserPid = typeof browserPid === 'number';
  }
  if (childPid !== undefined) {
    sanitized.hasChildPid = typeof childPid === 'number';
  }
  return sanitized;
}

export const DIAGNOSTIC_STAGES = [
  // 7 lifecycle stages
  'browser-launch-start',
  'browser-launch-success',
  'browser-close',
  'task-start',
  'task-settle',
  'service-create',
  'service-dispose',
  // 12 failure stages
  'browser-executable-resolve',
  'puppeteer-launch',
  'browser-new-page',
  'set-request-interception',
  'set-content',
  'add-script-tag',
  'page-evaluate',
  'svg-sanitize',
  'page-or-browser-close',
  'timeout',
  'cancel',
  'dispose',
] as const;

export const STDERR_CATEGORIES = [
  'executable-not-found',
  'permission-denied',
  'killed-by-signal',
  'process-limit',
  'file-descriptor-limit',
  'memory-pressure',
  'profile-lock',
  'sandbox-failure',
  'dynamic-library',
  'early-exit-with-code',
  'launch-timeout',
  'unknown',
] as const;

const ALLOWED_ENVELOPE_KEYS = new Set([
  'scope',
  'workerId',
  'processInstanceId',
  'attemptId',
  'correlationKey',
  'event',
]);

const ALLOWED_EVENT_KEYS = new Set([
  'stage',
  'serviceId',
  'activePageCount',
  'runningExecutionCount',
  'queueLength',
  'timestamp',
  'hasProcessPid',
  'workerId',
  'ownerId',
  'taskId',
  'hasBrowserPid',
  'hasChildPid',
  'sanitizedReason',
  'executableKind',
  'activeBrowserCount',
  'activeServiceCount',
  'launchAttempt',
  'elapsedMs',
  'spawned',
  'exitCode',
  'signal',
  'stderrCategory',
  'resourceMetrics',
]);

const ALLOWED_RESOURCE_METRICS_KEYS = new Set([
  'memoryRssMb',
  'memoryHeapUsedMb',
  'memoryExternalMb',
  'cpuUserSeconds',
  'cpuSystemSeconds',
  'openFdCount',
]);

const EXECUTABLE_KINDS = new Set([
  'system-chrome',
  'system-edge',
  'custom-path',
  'env-path',
  'unknown',
]);

const STAGES_SET = new Set<string>(DIAGNOSTIC_STAGES);
const STDERR_CATEGORIES_SET = new Set<string>(STDERR_CATEGORIES);

export const ALLOWED_SIGNALS = new Set([
  'unavailable',
  // POSIX / Linux / macOS
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGILL',
  'SIGTRAP',
  'SIGABRT',
  'SIGIOT',
  'SIGBUS',
  'SIGFPE',
  'SIGKILL',
  'SIGUSR1',
  'SIGSEGV',
  'SIGUSR2',
  'SIGPIPE',
  'SIGALRM',
  'SIGTERM',
  'SIGCHLD',
  'SIGCONT',
  'SIGSTOP',
  'SIGTSTP',
  'SIGTTIN',
  'SIGTTOU',
  'SIGURG',
  'SIGXCPU',
  'SIGXFSZ',
  'SIGVTALRM',
  'SIGPROF',
  'SIGWINCH',
  'SIGIO',
  'SIGINFO',
  'SIGSYS',
  // Windows
  'SIGBREAK',
]);

export function isValidSignal(sig: unknown): boolean {
  if (typeof sig !== 'string') return false;
  if (sig === 'unavailable') return true;
  return ALLOWED_SIGNALS.has(sig) && /^SIG[A-Z0-9]{1,16}$/.test(sig);
}

// 制御文字・改行
// eslint-disable-next-line no-control-regex
const RE_CONTROL_CHARS = /[\r\n\x00-\x1f\x7f]/;

// POSIX絶対パス（先行文字がパス構成文字でないスラッシュから始まるパスを検出）
const RE_POSIX_ABS_PATH = /(?<![A-Za-z0-9._-])\/(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/;

// Windows絶対パスおよびUNCパス
const RE_WINDOWS_PATH = /[a-zA-Z]:\\[a-zA-Z0-9_.\-\\]+/;
const RE_UNC_PATH = /\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9._\-\\]+/;

// 包括的URLスキーム（:// を伴うもの）
const RE_URL_SCHEME = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s]+/;

// 危険・機密性のある有限URIスキーム（:// を伴わないもの）
const RE_SPECIFIC_URI_SCHEME = /\b(?:data|javascript|vbscript|blob|mailto|tel|urn):[^\s]+/i;

// 認証情報付きURLおよびクエリパラメータ認証
const RE_URL_USERINFO = /:\/\/[^@\s/]+@/;
const RE_URL_QUERY_AUTH = /[?&](?:access_token|client_secret|signature|auth|key)=/i;

// 秘密鍵ヘッダー
const RE_PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY/i;

// 各種シークレットトークン形式
const RE_BEARER_TOKEN = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/i;
const RE_GITHUB_TOKEN = /gh[pousr]_[a-zA-Z0-9]{30,255}/;
const RE_API_KEY = /sk[-_][a-zA-Z0-9_-]{20,255}/;
const RE_KV_CREDENTIAL = /(?:api[_-]?key|secret|token|password|auth)=([^&\s]+)/i;
const RE_JWT = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/;

// 起動引数・スタックトレース形式
const RE_CLI_FLAGS = /--[a-zA-Z0-9-]+(?:=[^\s]+)?/;
const RE_STACK_TRACE = /\bat \w+ \(/;

export function isUnsafeReasonContent(text: string): boolean {
  if (RE_CONTROL_CHARS.test(text)) return true;
  if (RE_POSIX_ABS_PATH.test(text)) return true;
  if (RE_WINDOWS_PATH.test(text)) return true;
  if (RE_UNC_PATH.test(text)) return true;
  if (RE_URL_SCHEME.test(text)) return true;
  if (RE_SPECIFIC_URI_SCHEME.test(text)) return true;
  if (RE_URL_USERINFO.test(text)) return true;
  if (RE_URL_QUERY_AUTH.test(text)) return true;
  if (RE_PRIVATE_KEY_HEADER.test(text)) return true;
  if (RE_BEARER_TOKEN.test(text)) return true;
  if (RE_GITHUB_TOKEN.test(text)) return true;
  if (RE_API_KEY.test(text)) return true;
  if (RE_KV_CREDENTIAL.test(text)) return true;
  if (RE_JWT.test(text)) return true;
  if (RE_CLI_FLAGS.test(text)) return true;
  if (RE_STACK_TRACE.test(text)) return true;
  return false;
}

export function isValidSanitizedReason(reason: unknown): reason is string {
  if (typeof reason !== 'string' || reason.length === 0) return false;
  return !isUnsafeReasonContent(reason);
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

export function validateSanitizedDiagnosticEvent(event: unknown): SanitizedTestDiagnosticEvent {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new Error('Invalid diagnostic event: must be a JSON object');
  }

  const ev = event as Record<string, unknown>;

  // Reject PID keys
  if ('pid' in ev || 'browserPid' in ev || 'childPid' in ev) {
    throw new Error('Invalid diagnostic event: contains raw PID numbers');
  }

  // Reject unknown keys
  for (const key of Object.keys(ev)) {
    if (!ALLOWED_EVENT_KEYS.has(key)) {
      throw new Error('Invalid diagnostic event: unknown key present');
    }
  }

  // Required fields
  if (typeof ev.stage !== 'string' || !STAGES_SET.has(ev.stage)) {
    throw new Error('Invalid diagnostic event: invalid or missing stage');
  }
  if (!isValidSafeId(ev.serviceId)) {
    throw new Error('Invalid diagnostic event: invalid or missing serviceId');
  }
  if (
    typeof ev.activePageCount !== 'number' ||
    !Number.isInteger(ev.activePageCount) ||
    ev.activePageCount < 0
  ) {
    throw new Error('Invalid diagnostic event: activePageCount must be non-negative integer');
  }
  if (
    typeof ev.runningExecutionCount !== 'number' ||
    !Number.isInteger(ev.runningExecutionCount) ||
    ev.runningExecutionCount < 0
  ) {
    throw new Error('Invalid diagnostic event: runningExecutionCount must be non-negative integer');
  }
  if (
    typeof ev.queueLength !== 'number' ||
    !Number.isInteger(ev.queueLength) ||
    ev.queueLength < 0
  ) {
    throw new Error('Invalid diagnostic event: queueLength must be non-negative integer');
  }
  if (typeof ev.timestamp !== 'number' || !Number.isInteger(ev.timestamp) || ev.timestamp < 0) {
    throw new Error('Invalid diagnostic event: timestamp must be non-negative integer');
  }
  if (typeof ev.hasProcessPid !== 'boolean') {
    throw new Error('Invalid diagnostic event: hasProcessPid must be boolean');
  }

  // Optional fields validation
  if (ev.workerId !== undefined && !isValidSafeId(ev.workerId)) {
    throw new Error('Invalid diagnostic event: invalid workerId');
  }
  if (ev.ownerId !== undefined && !isValidSafeId(ev.ownerId)) {
    throw new Error('Invalid diagnostic event: invalid ownerId');
  }
  if (ev.taskId !== undefined && !isValidSafeId(ev.taskId)) {
    throw new Error('Invalid diagnostic event: invalid taskId');
  }
  if (ev.hasBrowserPid !== undefined && typeof ev.hasBrowserPid !== 'boolean') {
    throw new Error('Invalid diagnostic event: hasBrowserPid must be boolean');
  }
  if (ev.hasChildPid !== undefined && typeof ev.hasChildPid !== 'boolean') {
    throw new Error('Invalid diagnostic event: hasChildPid must be boolean');
  }
  if (ev.sanitizedReason !== undefined) {
    if (!isValidSanitizedReason(ev.sanitizedReason)) {
      throw new Error('Invalid diagnostic event: sanitizedReason contains unsafe content');
    }
  }
  if (ev.executableKind !== undefined) {
    if (typeof ev.executableKind !== 'string' || !EXECUTABLE_KINDS.has(ev.executableKind)) {
      throw new Error('Invalid diagnostic event: invalid executableKind');
    }
  }
  if (ev.activeBrowserCount !== undefined) {
    if (
      typeof ev.activeBrowserCount !== 'number' ||
      !Number.isInteger(ev.activeBrowserCount) ||
      ev.activeBrowserCount < 0
    ) {
      throw new Error('Invalid diagnostic event: activeBrowserCount must be non-negative integer');
    }
  }
  if (ev.activeServiceCount !== undefined) {
    if (
      typeof ev.activeServiceCount !== 'number' ||
      !Number.isInteger(ev.activeServiceCount) ||
      ev.activeServiceCount < 0
    ) {
      throw new Error('Invalid diagnostic event: activeServiceCount must be non-negative integer');
    }
  }
  if (ev.launchAttempt !== undefined) {
    if (
      typeof ev.launchAttempt !== 'number' ||
      !Number.isInteger(ev.launchAttempt) ||
      ev.launchAttempt < 1
    ) {
      throw new Error('Invalid diagnostic event: launchAttempt must be positive integer');
    }
  }
  if (ev.elapsedMs !== undefined) {
    if (typeof ev.elapsedMs !== 'number' || !Number.isFinite(ev.elapsedMs) || ev.elapsedMs < 0) {
      throw new Error('Invalid diagnostic event: elapsedMs must be non-negative finite number');
    }
  }
  if (ev.spawned !== undefined && typeof ev.spawned !== 'boolean') {
    throw new Error('Invalid diagnostic event: spawned must be boolean');
  }
  if (ev.exitCode !== undefined) {
    const code = ev.exitCode;
    if (
      code !== null &&
      code !== 'unavailable' &&
      (typeof code !== 'number' || !Number.isInteger(code))
    ) {
      throw new Error('Invalid diagnostic event: exitCode must be integer, null, or unavailable');
    }
  }
  if (ev.signal !== undefined) {
    if (!isValidSignal(ev.signal)) {
      throw new Error('Invalid diagnostic event: signal must be an allowed signal or unavailable');
    }
  }
  if (ev.stderrCategory !== undefined) {
    if (typeof ev.stderrCategory !== 'string' || !STDERR_CATEGORIES_SET.has(ev.stderrCategory)) {
      throw new Error('Invalid diagnostic event: invalid stderrCategory');
    }
  }
  if (ev.resourceMetrics !== undefined) {
    if (
      typeof ev.resourceMetrics !== 'object' ||
      ev.resourceMetrics === null ||
      Array.isArray(ev.resourceMetrics)
    ) {
      throw new Error('Invalid diagnostic event: resourceMetrics must be an object');
    }
    const rm = ev.resourceMetrics as Record<string, unknown>;
    for (const k of Object.keys(rm)) {
      if (!ALLOWED_RESOURCE_METRICS_KEYS.has(k)) {
        throw new Error('Invalid diagnostic event: unknown resourceMetrics key present');
      }
    }
    const requiredMetrics = ['memoryRssMb', 'memoryHeapUsedMb', 'memoryExternalMb'] as const;
    for (const req of requiredMetrics) {
      const val = rm[req];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
        throw new Error(
          `Invalid diagnostic event: resourceMetrics ${req} must be non-negative finite number`
        );
      }
    }
    if (rm.cpuUserSeconds !== undefined) {
      if (
        typeof rm.cpuUserSeconds !== 'number' ||
        !Number.isFinite(rm.cpuUserSeconds) ||
        rm.cpuUserSeconds < 0
      ) {
        throw new Error(
          'Invalid diagnostic event: resourceMetrics cpuUserSeconds must be non-negative finite number'
        );
      }
    }
    if (rm.cpuSystemSeconds !== undefined) {
      if (
        typeof rm.cpuSystemSeconds !== 'number' ||
        !Number.isFinite(rm.cpuSystemSeconds) ||
        rm.cpuSystemSeconds < 0
      ) {
        throw new Error(
          'Invalid diagnostic event: resourceMetrics cpuSystemSeconds must be non-negative finite number'
        );
      }
    }
    if (rm.openFdCount !== undefined) {
      if (
        rm.openFdCount !== 'unavailable' &&
        (typeof rm.openFdCount !== 'number' ||
          !Number.isInteger(rm.openFdCount) ||
          rm.openFdCount < 0)
      ) {
        throw new Error(
          'Invalid diagnostic event: resourceMetrics openFdCount must be non-negative integer or unavailable'
        );
      }
    }
  }

  return ev as unknown as SanitizedTestDiagnosticEvent;
}

export function validateDiagnosticEnvelope(
  data: unknown,
  fileName?: string
): TestDiagnosticEnvelope {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid diagnostic envelope: must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(key)) {
      throw new Error('Invalid diagnostic envelope: unknown key present');
    }
  }

  if (!isValidSafeId(obj.workerId)) {
    throw new Error('Invalid diagnostic envelope: invalid workerId');
  }
  if (!isValidSafeId(obj.processInstanceId)) {
    throw new Error('Invalid diagnostic envelope: invalid processInstanceId');
  }

  if (fileName) {
    const expectedName = `diag-worker-${obj.workerId}-${obj.processInstanceId}.jsonl`;
    if (fileName !== expectedName) {
      throw new Error('Invalid diagnostic envelope: worker key mismatch with file name');
    }
  }

  validateSanitizedDiagnosticEvent(obj.event);

  if (obj.scope === 'attempt') {
    if (!isValidSafeId(obj.attemptId)) {
      throw new Error(
        'Invalid diagnostic envelope: attemptId must be non-empty string for attempt scope'
      );
    }
    if (typeof obj.correlationKey !== 'string' || !obj.correlationKey) {
      throw new Error(
        'Invalid diagnostic envelope: correlationKey must be non-empty string for attempt scope'
      );
    }
    const expectedCorrelation = `${obj.workerId}:${obj.processInstanceId}:${obj.attemptId}`;
    if (obj.correlationKey !== expectedCorrelation) {
      throw new Error('Invalid diagnostic envelope: correlationKey mismatch');
    }
    return obj as unknown as TestDiagnosticEnvelope;
  } else if (obj.scope === 'lifecycle') {
    if (obj.attemptId !== null || obj.correlationKey !== null) {
      throw new Error(
        'Invalid diagnostic envelope: attemptId and correlationKey must be null for lifecycle scope'
      );
    }
    return obj as unknown as TestDiagnosticEnvelope;
  } else {
    throw new Error('Invalid diagnostic envelope: unknown scope');
  }
}

export function writeDiagnosticEnvelopeToJsonl(
  filePath: string,
  envelope: TestDiagnosticEnvelope
): void {
  const line = JSON.stringify(envelope) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

export function readAllDiagnosticEnvelopes(
  diagnosticsDir: string,
  fsOps?: Partial<typeof fs>
): {
  envelopes: TestDiagnosticEnvelope[];
  invalidCount: number;
} {
  const fileSystem = { ...fs, ...fsOps };
  try {
    if (!fileSystem.existsSync(diagnosticsDir)) {
      return { envelopes: [], invalidCount: 1 };
    }

    const allFiles = fileSystem.readdirSync(diagnosticsDir);
    const envelopes: TestDiagnosticEnvelope[] = [];
    let invalidCount = 0;

    for (const file of allFiles) {
      if (!file.startsWith('diag-worker-') || !file.endsWith('.jsonl')) {
        invalidCount++;
        continue;
      }
      const fullPath = path.join(diagnosticsDir, file);
      try {
        const content = fileSystem.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const valid = validateDiagnosticEnvelope(parsed, file);
            envelopes.push(valid);
          } catch {
            invalidCount++;
          }
        }
      } catch {
        invalidCount++;
      }
    }

    return {
      envelopes: envelopes.sort((a, b) => a.event.timestamp - b.event.timestamp),
      invalidCount,
    };
  } catch {
    return { envelopes: [], invalidCount: 1 };
  }
}

export function aggregateDiagnostics(
  envelopes: TestDiagnosticEnvelope[],
  manifests?: WorkerIntegrityManifest[]
): DiagnosticsSummary {
  const failureStages = new Set([
    'browser-executable-resolve',
    'puppeteer-launch',
    'browser-new-page',
    'set-request-interception',
    'set-content',
    'add-script-tag',
    'page-evaluate',
    'svg-sanitize',
    'page-or-browser-close',
    'timeout',
    'cancel',
    'dispose',
  ]);

  const workers = new Set<string>();
  const failureStageCounts: Record<string, number> = {};
  let firstFailure: DiagnosticsSummary['firstFailure'] | undefined;
  let maxConcurrentPages = 0;

  interface Interval {
    readonly start: number;
    readonly end: number;
  }
  const launchIntervals: Interval[] = [];
  const browserIntervals: Interval[] = [];

  const pendingLaunches = new Map<string, number>(); // key: `${processInstanceId}:${serviceId}`
  const activeBrowserStarts = new Map<string, number>(); // key: `${processInstanceId}:${serviceId}`

  for (const env of envelopes) {
    const e = env.event;
    if (env.workerId) workers.add(env.workerId);
    if (e.activePageCount > maxConcurrentPages) {
      maxConcurrentPages = e.activePageCount;
    }

    const key = `${env.processInstanceId}:${e.serviceId}`;

    if (e.stage === 'browser-launch-start') {
      pendingLaunches.set(key, e.timestamp);
    } else if (e.stage === 'browser-launch-success') {
      const start = pendingLaunches.get(key) ?? e.timestamp;
      pendingLaunches.delete(key);
      launchIntervals.push({ start, end: e.timestamp });
      activeBrowserStarts.set(key, e.timestamp);
    } else if (e.stage === 'puppeteer-launch') {
      const start = pendingLaunches.get(key) ?? e.timestamp;
      pendingLaunches.delete(key);
      launchIntervals.push({ start, end: e.timestamp });
    } else if (e.stage === 'browser-close' || e.stage === 'service-dispose') {
      const start = activeBrowserStarts.get(key);
      if (start !== undefined) {
        activeBrowserStarts.delete(key);
        browserIntervals.push({ start, end: e.timestamp });
      }
    }

    if (failureStages.has(e.stage)) {
      failureStageCounts[e.stage] = (failureStageCounts[e.stage] ?? 0) + 1;
      if (!firstFailure) {
        firstFailure = {
          stage: e.stage,
          sanitizedReason: e.sanitizedReason,
          workerId: env.workerId,
          timestamp: e.timestamp,
          launchAttempt: e.launchAttempt,
          elapsedMs: e.elapsedMs,
          spawned: e.spawned,
          hasChildPid: e.hasChildPid,
          exitCode: e.exitCode,
          signal: e.signal,
          stderrCategory: e.stderrCategory,
          resourceMetrics: e.resourceMetrics,
        };
      }
    }
  }

  const latestTs =
    envelopes.length > 0 ? envelopes[envelopes.length - 1]!.event.timestamp : Date.now();
  for (const [, start] of pendingLaunches) {
    launchIntervals.push({ start, end: latestTs });
  }
  for (const [, start] of activeBrowserStarts) {
    browserIntervals.push({ start, end: latestTs });
  }

  function computeMaxOverlap(intervals: Interval[]): number {
    const points: { time: number; type: number }[] = [];
    for (const iv of intervals) {
      points.push({ time: iv.start, type: 1 });
      points.push({ time: iv.end, type: -1 });
    }
    points.sort((a, b) => a.time - b.time || a.type - b.type);
    let current = 0;
    let max = 0;
    for (const p of points) {
      current += p.type;
      if (current > max) max = current;
    }
    return max;
  }

  const maxConcurrentLaunches = computeMaxOverlap(launchIntervals);
  const maxConcurrentBrowsers = computeMaxOverlap(browserIntervals);

  let browserProcessObservedCount: number;
  if (manifests && manifests.length > 0) {
    browserProcessObservedCount = manifests.reduce(
      (sum, m) => sum + (m.observedBrowserProcessCount || 0),
      0
    );
  } else {
    // Fallback: count distinct attempt envelopes that observed a browser launch
    const seenAttempts = new Set<string>();
    for (const env of envelopes) {
      if (env.scope === 'attempt' && env.event.hasBrowserPid) {
        seenAttempts.add(env.correlationKey);
      }
    }
    browserProcessObservedCount = seenAttempts.size;
  }

  return {
    totalEvents: envelopes.length,
    workerCount: workers.size,
    browserProcessObservedCount,
    maxConcurrentLaunches,
    maxConcurrentBrowsers,
    maxConcurrentPages,
    failureStageCounts,
    firstFailure,
  };
}

export function formatDiagnosticsSummary(summary: DiagnosticsSummary): string {
  const lines: string[] = [
    '=== Worker Diagnostics Aggregation Report ===',
    `Total Diagnostic Events: ${summary.totalEvents}`,
    `Active Vitest Workers: ${summary.workerCount}`,
    `Observed Browser Processes: ${summary.browserProcessObservedCount}`,
    `Max Concurrent Launches: ${summary.maxConcurrentLaunches}`,
    `Max Concurrent Browsers: ${summary.maxConcurrentBrowsers}`,
    `Max Concurrent Pages: ${summary.maxConcurrentPages}`,
  ];

  const failures = Object.entries(summary.failureStageCounts);
  if (failures.length > 0) {
    lines.push('Failure Stages Detected:');
    for (const [st, count] of failures) {
      lines.push(`  - ${st}: ${count}`);
    }
    if (summary.firstFailure) {
      const f = summary.firstFailure;
      lines.push(
        `First Failure: stage=${f.stage}, worker=${f.workerId ?? 'unknown'}, reason="${f.sanitizedReason ?? 'unknown'}"`
      );
      if (f.stage === 'puppeteer-launch') {
        const details: string[] = [];
        if (f.launchAttempt !== undefined) details.push(`attempt=${f.launchAttempt}`);
        if (f.elapsedMs !== undefined) details.push(`elapsed=${f.elapsedMs}ms`);
        if (f.spawned !== undefined) details.push(`spawned=${f.spawned}`);
        if (f.hasChildPid !== undefined) details.push(`hasChildPid=${f.hasChildPid}`);
        if (f.exitCode !== undefined) details.push(`exitCode=${f.exitCode}`);
        if (f.signal !== undefined) details.push(`signal=${f.signal}`);
        if (f.stderrCategory !== undefined) details.push(`stderrCategory=${f.stderrCategory}`);
        if (details.length > 0) {
          lines.push(`  Launch Details: ${details.join(', ')}`);
        }
        if (f.resourceMetrics) {
          const m = f.resourceMetrics;
          lines.push(
            `  Resource Metrics: rss=${m.memoryRssMb}MB, heap=${m.memoryHeapUsedMb}MB, openFd=${m.openFdCount ?? 'unavailable'}`
          );
        }
      }
    }
  } else {
    lines.push('Failure Stages Detected: none (all stages succeeded)');
  }
  lines.push('=============================================');

  return lines.join('\n');
}
