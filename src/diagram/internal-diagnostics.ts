import * as fs from 'node:fs';
import type { Page } from 'puppeteer-core';
import type {
  DiagramRenderService,
  DiagramRenderServiceOptions,
} from './mermaid-render-service.js';

declare const __DIAGNOSTICS_FILE_OUTPUT__: boolean;

export type DiagramLifecycleStage =
  | 'browser-launch-start'
  | 'browser-launch-success'
  | 'browser-close'
  | 'task-start'
  | 'task-settle'
  | 'service-create'
  | 'service-dispose';

export type DiagramFailureStage =
  | 'browser-executable-resolve'
  | 'puppeteer-launch'
  | 'browser-new-page'
  | 'set-request-interception'
  | 'set-content'
  | 'add-script-tag'
  | 'page-evaluate'
  | 'svg-sanitize'
  | 'page-or-browser-close'
  | 'timeout'
  | 'cancel'
  | 'dispose';

export type DiagramDiagnosticStage = DiagramFailureStage | DiagramLifecycleStage;

export type StderrCategory =
  | 'executable-not-found'
  | 'permission-denied'
  | 'killed-by-signal'
  | 'process-limit'
  | 'file-descriptor-limit'
  | 'memory-pressure'
  | 'profile-lock'
  | 'sandbox-failure'
  | 'dynamic-library'
  | 'early-exit-with-code'
  | 'launch-timeout'
  | 'unknown';

export interface SafeResourceMetrics {
  readonly memoryRssMb: number;
  readonly memoryHeapUsedMb: number;
  readonly memoryExternalMb: number;
  readonly cpuUserSeconds?: number;
  readonly cpuSystemSeconds?: number;
  readonly openFdCount?: number | 'unavailable';
}

export interface InternalDiagnosticEvent {
  readonly pid: number;
  readonly workerId?: string;
  readonly stage: DiagramDiagnosticStage;
  readonly serviceId: string;
  readonly ownerId?: string;
  readonly taskId?: string;
  readonly browserPid?: number;
  readonly sanitizedReason?: string;
  readonly executableKind?:
    'system-chrome' | 'system-edge' | 'custom-path' | 'env-path' | 'unknown';
  readonly activePageCount: number;
  readonly runningExecutionCount: number;
  readonly queueLength: number;
  readonly activeBrowserCount?: number;
  readonly activeServiceCount?: number;
  readonly timestamp: number;

  // Structured fields for puppeteer-launch diagnostics
  readonly launchAttempt?: number;
  readonly elapsedMs?: number;
  readonly spawned?: boolean;
  readonly childPid?: number | 'unavailable';
  readonly exitCode?: number | null | 'unavailable';
  readonly signal?: string | 'unavailable';
  readonly stderrCategory?: StderrCategory;
  readonly resourceMetrics?: SafeResourceMetrics;
}

export interface LaunchProcessDiagnostics {
  readonly launchAttempt?: number;
  readonly elapsedMs?: number;
  readonly spawned: boolean;
  readonly childPid: number | 'unavailable';
  readonly exitCode: number | null | 'unavailable';
  readonly signal: string | 'unavailable';
  readonly stderrCategory: StderrCategory;
}

export type DiagnosticSink = (event: InternalDiagnosticEvent) => void;
export type DiagramServiceFactory = (options?: DiagramRenderServiceOptions) => DiagramRenderService;

export interface BrowserFaultInjectionHooks {
  readonly failLaunch?: () => Promise<never> | never;
  readonly failNewPage?: () => Promise<never> | never;
  readonly failSetRequestInterception?: () => Promise<never> | never;
  readonly failSetContent?: () => Promise<never> | never;
  readonly failAddScriptTag?: () => Promise<never> | never;
}

export type NetworkProbe = (page: Page) => Promise<void>;

let diagnosticSink: DiagnosticSink | null = null;
let defaultServiceFactory: DiagramServiceFactory | null = null;
let customServiceFactory: DiagramServiceFactory | null = null;
let activeFaultHooks: BrowserFaultInjectionHooks | null = null;
let activeNetworkProbe: NetworkProbe | null = null;
let workerDiagnosticWriter: ((event: InternalDiagnosticEvent) => void) | null = null;
let customLaunchArgsModifier: ((args: string[]) => string[]) | null = null;
let launchAttemptContextRunner: (<T>(fn: (attemptId: string) => Promise<T>) => Promise<T>) | null =
  null;
let launchDiagnosticsConsumer:
  ((attemptId: string) => LaunchProcessDiagnostics | undefined) | null = null;
let launchAttemptCleaner: ((attemptId: string) => void) | null = null;

export function setDiagnosticSinkForTesting(sink: DiagnosticSink | null): void {
  diagnosticSink = sink;
}

if (typeof __DIAGNOSTICS_FILE_OUTPUT__ !== 'undefined' && __DIAGNOSTICS_FILE_OUTPUT__) {
  (globalThis as unknown as Record<string, unknown>)['__setWorkerDiagnosticsWriter'] = (
    writer: ((event: InternalDiagnosticEvent) => void) | null
  ) => {
    workerDiagnosticWriter = writer;
  };
  (globalThis as unknown as Record<string, unknown>)['__setLaunchArgsModifier'] = (
    modifier: ((args: string[]) => string[]) | null
  ) => {
    customLaunchArgsModifier = modifier;
  };
  (globalThis as unknown as Record<string, unknown>)['__setLaunchAttemptHooks'] = (
    hooks: {
      runWithAttempt: <T>(fn: (attemptId: string) => Promise<T>) => Promise<T>;
      consumeDiagnostics: (attemptId: string) => LaunchProcessDiagnostics | undefined;
      cleanupAttempt: (attemptId: string) => void;
    } | null
  ) => {
    if (hooks) {
      launchAttemptContextRunner = hooks.runWithAttempt;
      launchDiagnosticsConsumer = hooks.consumeDiagnostics;
      launchAttemptCleaner = hooks.cleanupAttempt;
    } else {
      launchAttemptContextRunner = null;
      launchDiagnosticsConsumer = null;
      launchAttemptCleaner = null;
    }
  };
}

export async function runWithLaunchAttemptContext<T>(
  fn: (attemptId: string) => Promise<T>
): Promise<T> {
  if (launchAttemptContextRunner) {
    return launchAttemptContextRunner(fn);
  }
  return fn('');
}

export function consumeLaunchDiagnostics(attemptId: string): LaunchProcessDiagnostics | undefined {
  if (launchDiagnosticsConsumer && attemptId) {
    return launchDiagnosticsConsumer(attemptId);
  }
  return undefined;
}

export function cleanupLaunchAttempt(attemptId: string): void {
  if (launchAttemptCleaner && attemptId) {
    launchAttemptCleaner(attemptId);
  }
}

export function setLaunchArgsModifierForTesting(
  modifier: ((args: string[]) => string[]) | null
): void {
  customLaunchArgsModifier = modifier;
}

export function getLaunchArgsModifier(): ((args: string[]) => string[]) | null {
  return customLaunchArgsModifier;
}

export function getSafeResourceMetrics(): SafeResourceMetrics {
  const mem = process.memoryUsage();
  let userSec: number | undefined;
  let sysSec: number | undefined;
  if (typeof process.resourceUsage === 'function') {
    try {
      const u = process.resourceUsage();
      userSec = Math.round((u.userCPUTime / 1e6) * 100) / 100;
      sysSec = Math.round((u.systemCPUTime / 1e6) * 100) / 100;
    } catch {
      // ignore
    }
  }

  let openFdCount: number | 'unavailable' = 'unavailable';
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const fds = fs.readdirSync('/dev/fd');
      openFdCount = fds.length;
    }
  } catch {
    openFdCount = 'unavailable';
  }

  return {
    memoryRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
    memoryHeapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
    memoryExternalMb: Math.round((mem.external / (1024 * 1024)) * 10) / 10,
    cpuUserSeconds: userSec,
    cpuSystemSeconds: sysSec,
    openFdCount,
  };
}

export function classifyStderrCategory(
  rawStderr: string,
  exitCode?: number | null | 'unavailable',
  signal?: string | 'unavailable'
): StderrCategory {
  const lower = rawStderr.toLowerCase();
  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('no such file')) {
    return 'executable-not-found';
  }
  if (lower.includes('eacces') || lower.includes('permission denied')) {
    return 'permission-denied';
  }
  if (
    (signal && signal !== 'unavailable' && signal !== 'unknown') ||
    lower.includes('sigkill') ||
    lower.includes('sigterm') ||
    lower.includes('sigsegv') ||
    lower.includes('sigbus') ||
    lower.includes('killed by signal')
  ) {
    return 'killed-by-signal';
  }
  if (
    lower.includes('eagain') ||
    lower.includes('resource temporarily unavailable') ||
    lower.includes('emproc') ||
    lower.includes('enproc')
  ) {
    return 'process-limit';
  }
  if (
    lower.includes('emfile') ||
    lower.includes('enfile') ||
    lower.includes('too many open files')
  ) {
    return 'file-descriptor-limit';
  }
  if (
    lower.includes('out of memory') ||
    lower.includes('enomem') ||
    lower.includes('cannot allocate memory') ||
    lower.includes('allocation failed')
  ) {
    return 'memory-pressure';
  }
  if (
    lower.includes('processsingleton') ||
    lower.includes('profile directory') ||
    lower.includes('singletonlock')
  ) {
    return 'profile-lock';
  }
  if (lower.includes('sandbox') || lower.includes('setuid sandbox')) {
    return 'sandbox-failure';
  }
  if (
    lower.includes('mach-o') ||
    lower.includes('shared object') ||
    lower.includes('library not loaded') ||
    lower.includes('image not found') ||
    lower.includes('dlopen')
  ) {
    return 'dynamic-library';
  }
  if (lower.includes('timed out') || lower.includes('timeouterror')) {
    return 'launch-timeout';
  }
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return 'early-exit-with-code';
  }
  return 'unknown';
}

export function emitDiagnosticEvent(
  event: Omit<InternalDiagnosticEvent, 'timestamp' | 'pid' | 'workerId'> & {
    pid?: number;
    workerId?: string;
  }
): void {
  const fullEvent: InternalDiagnosticEvent = {
    ...event,
    pid: event.pid ?? process.pid,
    workerId: event.workerId ?? process.env.VITEST_WORKER_ID,
    activeBrowserCount: event.activeBrowserCount ?? getGlobalActiveBrowserCount(),
    activeServiceCount: event.activeServiceCount ?? getGlobalActiveServiceCount(),
    timestamp: Date.now(),
  };

  if (diagnosticSink) {
    try {
      diagnosticSink(fullEvent);
    } catch {
      // Diagnostic sink failure must never crash the service
    }
  }

  if (typeof __DIAGNOSTICS_FILE_OUTPUT__ !== 'undefined' && __DIAGNOSTICS_FILE_OUTPUT__) {
    if (workerDiagnosticWriter) {
      try {
        workerDiagnosticWriter(fullEvent);
      } catch {
        // Worker diagnostic writer failure must never crash the service
      }
    }
  }
}

export function registerDefaultDiagramServiceFactory(factory: DiagramServiceFactory): void {
  defaultServiceFactory = factory;
}

export function setDiagramServiceFactoryForTesting(factory: DiagramServiceFactory | null): void {
  customServiceFactory = factory;
}

export function createDiagramRenderService(
  options?: DiagramRenderServiceOptions
): DiagramRenderService {
  if (customServiceFactory) {
    return customServiceFactory(options);
  }
  if (!defaultServiceFactory) {
    throw new Error('Default DiagramRenderService factory is not registered.');
  }
  return defaultServiceFactory(options);
}

export function setFaultInjectionHooksForTesting(hooks: BrowserFaultInjectionHooks | null): void {
  activeFaultHooks = hooks;
}

export function getFaultInjectionHooks(): BrowserFaultInjectionHooks | null {
  return activeFaultHooks;
}

export function setNetworkProbeForTesting(probe: NetworkProbe | null): void {
  activeNetworkProbe = probe;
}

export function getNetworkProbe(): NetworkProbe | null {
  return activeNetworkProbe;
}

export function sanitizeDiagnosticReason(err: unknown): string {
  if (!err) {
    return 'unknown';
  }
  let message = err instanceof Error ? err.message : String(err);

  // Strip stack trace or newlines if present
  const newlineIdx = message.indexOf('\n');
  if (newlineIdx !== -1) {
    message = message.slice(0, newlineIdx);
  }

  // Anonymize and strip tokens, credentials, paths and URIs
  message = message
    // Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [token]')
    // GitHub tokens
    .replace(/gh[pousr]_[a-zA-Z0-9]{30,255}/g, '[github-token]')
    // sk- / secret tokens
    .replace(/sk[-_][a-zA-Z0-9_-]{20,255}/g, '[api-key]')
    // Generic credentials in key-value format
    .replace(/(?:api[_-]?key|secret|token|password|auth)=([^&\s]+)/gi, 'auth=[credential]')
    // JWT pattern
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[jwt-token]')
    // URL userinfo
    .replace(/:\/\/[^@\s/]+@/g, '://[userinfo]@')
    // URL query credentials
    .replace(/([?&](?:access_token|client_secret|signature|auth|key)=)[^&\s]+/gi, '$1[credential]')
    // file:// URI
    .replace(/file:\/\/[^\s]+/g, '[file-uri]')
    // Windows UNC paths
    .replace(/\\\\[a-zA-Z0-9._-]+\\[a-zA-Z0-9._\-\\]+/g, '[unc-path]')
    // Windows absolute paths
    .replace(/[a-zA-Z]:\\[a-zA-Z0-9_.\-\\]+/g, '[windows-path]')
    // POSIX absolute paths
    .replace(/(?:\/[a-zA-Z0-9_.-]+)+/g, '[path]')
    // Temporary directory and profile names
    .replace(/(?:md-tech-slide|puppeteer_dev_profile)[a-zA-Z0-9_.-]*/g, '[temp-dir]')
    // Control characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    // Multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  return message.slice(0, 200);
}

export function anonymizeOwnerId(ownerId?: string): string | undefined {
  if (!ownerId) {
    return undefined;
  }
  if (ownerId.startsWith('file:') || ownerId.includes('/') || ownerId.includes('\\')) {
    let hash = 0;
    for (let i = 0; i < ownerId.length; i++) {
      hash = (hash << 5) - hash + ownerId.charCodeAt(i);
      hash |= 0;
    }
    return `anonymized-owner:${Math.abs(hash).toString(16)}`;
  }
  return ownerId;
}

export interface InternalServiceSnapshot {
  readonly serviceId: string;
  readonly activePageCount: number;
  readonly runningExecutionCount: number;
  readonly queueLength: number;
  readonly isDisposed: boolean;
}

const serviceSnapshotProviders = new WeakMap<DiagramRenderService, () => InternalServiceSnapshot>();

export function registerSnapshotProvider(
  service: DiagramRenderService,
  provider: () => InternalServiceSnapshot
): void {
  serviceSnapshotProviders.set(service, provider);
}

export function getInternalServiceSnapshot(
  service: DiagramRenderService
): InternalServiceSnapshot | undefined {
  const provider = serviceSnapshotProviders.get(service);
  return provider ? provider() : undefined;
}

let activeServiceCount = 0;
let activeBrowserCount = 0;

export function incrementActiveServiceCount(): void {
  activeServiceCount++;
}

export function decrementActiveServiceCount(): void {
  activeServiceCount = Math.max(0, activeServiceCount - 1);
}

export function getGlobalActiveServiceCount(): number {
  return activeServiceCount;
}

export function incrementActiveBrowserCount(): void {
  activeBrowserCount++;
}

export function decrementActiveBrowserCount(): void {
  activeBrowserCount = Math.max(0, activeBrowserCount - 1);
}

export function getGlobalActiveBrowserCount(): number {
  return activeBrowserCount;
}

export interface NetworkInterceptionEvent {
  readonly urlCategory: 'http' | 'https' | 'image' | 'font' | 'other';
  readonly resourceType: string;
  readonly protocol: string;
  readonly decision: 'abort' | 'continue' | 'respond';
  readonly abortReason?: string;
  readonly url: string;
}

export type NetworkDecisionObserver = (event: NetworkInterceptionEvent) => void;

let activeNetworkObserver: NetworkDecisionObserver | null = null;

export function setNetworkDecisionObserverForTesting(
  observer: NetworkDecisionObserver | null
): void {
  activeNetworkObserver = observer;
}

export function getNetworkDecisionObserver(): NetworkDecisionObserver | null {
  return activeNetworkObserver;
}
