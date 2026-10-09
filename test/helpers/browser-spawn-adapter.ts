import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type {
  LaunchProcessDiagnostics,
  StderrCategory,
} from '../../src/diagram/internal-diagnostics.js';
import { classifyStderrCategory } from '../../src/diagram/internal-diagnostics.js';
import type { BrowserFailureFingerprintTracker } from './browser-failure-fingerprint.js';

export class MockChildProcess extends EventEmitter {
  public pid: number | undefined;
  public stderr: EventEmitter;

  constructor(pid?: number) {
    super();
    this.pid = pid;
    this.stderr = new EventEmitter();
  }
}

export interface ProcessLike {
  nodeProcess?: ChildProcess | null;
  waitForLineOutput?(regex: RegExp, timeout?: number): Promise<string>;
  getRecentLogs?(): string[];
  hasClosed?(): Promise<void>;
  close?(): Promise<void>;
}

export class FakeProcess implements ProcessLike {
  public nodeProcess: ChildProcess;
  private logs: string[] = [];
  private exited = false;
  private exitPromise: Promise<void>;
  private resolveExit!: () => void;

  constructor(nodeProc: ChildProcess) {
    this.nodeProcess = nodeProc;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    const onEnd = () => {
      if (!this.exited) {
        this.exited = true;
        this.resolveExit();
      }
    };
    nodeProc.once?.('exit', onEnd);
    nodeProc.once?.('error', onEnd);

    if (nodeProc.stderr?.on) {
      nodeProc.stderr.on('data', (chunk: Buffer | string) => {
        this.logs.push(chunk.toString());
      });
    }
  }

  public getRecentLogs(): string[] {
    return [...this.logs];
  }

  public hasClosed(): Promise<void> {
    return this.exitPromise;
  }

  public async close(): Promise<void> {
    if (!this.exited) {
      this.nodeProcess.emit?.('exit', 0, null);
    }
    return this.exitPromise;
  }

  public waitForLineOutput(_regex: RegExp, _timeout = 0): Promise<string> {
    return new Promise((_resolve, reject) => {
      const onClose = (errorOrCode: unknown) => {
        cleanup();
        reject(
          new Error(
            [
              `Failed to launch the browser process: ${
                errorOrCode instanceof Error ? ` ${errorOrCode.message}` : ` Code: ${errorOrCode}`
              }`,
              '',
              'stderr:',
              this.getRecentLogs().join('\n'),
              '',
              'TROUBLESHOOTING: https://pptr.dev/troubleshooting',
              '',
            ].join('\n')
          )
        );
      };

      this.nodeProcess.once?.('exit', onClose);
      this.nodeProcess.once?.('error', onClose);

      const cleanup = () => {
        this.nodeProcess.off?.('exit', onClose);
        this.nodeProcess.off?.('error', onClose);
      };
    });
  }
}

export type LaunchFn<T = unknown> = (options: unknown) => T;

type AttemptStatus = 'active' | 'consumed' | 'cleaned';

interface AttemptRecord {
  status: AttemptStatus;
  diagnostics: LaunchProcessDiagnostics;
  nodeProc?: ChildProcess | null;
  spawnListener?: () => void;
  exitListener?: (code: number | null, signal: string | null) => void;
  errorListener?: (err: Error) => void;
  stderrListener?: (chunk: Buffer | string) => void;
  stderrChunks: string[];
}

interface MonitoredProcess {
  nodeProc: ChildProcess;
  spawned: boolean;
  exitOrCloseObserved: boolean;
  exitListener?: (code: number | null, signal: string | null) => void;
  closeListener?: (code: number | null, signal: string | null) => void;
  errorListener?: (err: Error) => void;
}

export class BrowserSpawnTracker {
  private attempts = new Map<string, AttemptRecord>();
  private terminalAttempts = new Set<string>();
  private activeAttemptProvider: (() => string | undefined) | null = null;
  private controlledLaunchOverride: ((options: unknown) => unknown) | null = null;
  private fingerprintTracker: BrowserFailureFingerprintTracker | null = null;
  private workerId = '0';
  private processInstanceId = 'proc-default';
  private observedProcesses = new Set<ChildProcess>();
  private liveProcesses = new Set<ChildProcess>();
  private activeListeners = new Set<ChildProcess>();
  private monitoredProcesses = new Map<ChildProcess, MonitoredProcess>();

  public getObservedBrowserProcessCount(): number {
    return this.observedProcesses.size;
  }

  public getLiveBrowserProcessCount(): number {
    return this.liveProcesses.size;
  }

  public getUnreleasedBrowserProcessCount(): number {
    return this.activeListeners.size;
  }

  public setFingerprintTracker(
    tracker: BrowserFailureFingerprintTracker | null,
    workerId = '0',
    processInstanceId = 'proc-default'
  ): void {
    this.fingerprintTracker = tracker;
    this.workerId = workerId;
    this.processInstanceId = processInstanceId;
  }

  public getFingerprintTracker(): BrowserFailureFingerprintTracker | null {
    return this.fingerprintTracker;
  }

  public setControlledLaunchOverride(override: ((options: unknown) => unknown) | null): void {
    this.controlledLaunchOverride = override;
  }

  public getControlledLaunchOverride(): ((options: unknown) => unknown) | null {
    return this.controlledLaunchOverride;
  }

  public setActiveAttemptProvider(provider: (() => string | undefined) | null): void {
    this.activeAttemptProvider = provider;
  }

  public getPendingAttemptCount(): number {
    return this.attempts.size;
  }

  public getDiagnostics(attemptId: string): LaunchProcessDiagnostics | undefined {
    return this.attempts.get(attemptId)?.diagnostics;
  }

  public consumeDiagnostics(attemptId: string): LaunchProcessDiagnostics | undefined {
    if (!attemptId) return undefined;
    const record = this.attempts.get(attemptId);
    if (!record) return undefined;

    const diag = record.diagnostics;
    this.detachAttemptListeners(record);
    record.status = 'consumed';
    record.stderrChunks = [];
    this.markTerminal(attemptId);
    this.attempts.delete(attemptId);
    if (this.fingerprintTracker) {
      const correlationKey = `${this.workerId}:${this.processInstanceId}:${attemptId}`;
      this.fingerprintTracker.consumeAttempt(correlationKey);
    }
    return diag;
  }

  public cleanupAttempt(attemptId: string): void {
    if (!attemptId) return;
    const record = this.attempts.get(attemptId);
    if (record) {
      this.detachAttemptListeners(record);
      record.status = 'cleaned';
      record.stderrChunks = [];
      this.attempts.delete(attemptId);
    }
    this.markTerminal(attemptId);
    if (this.fingerprintTracker) {
      const correlationKey = `${this.workerId}:${this.processInstanceId}:${attemptId}`;
      this.fingerprintTracker.cleanupAttempt(correlationKey);
    }
  }

  public clearAll(): void {
    for (const record of this.attempts.values()) {
      this.detachAttemptListeners(record);
      record.stderrChunks = [];
    }
    for (const monitored of this.monitoredProcesses.values()) {
      this.detachProcessListeners(monitored);
    }
    this.attempts.clear();
    this.terminalAttempts.clear();
    this.monitoredProcesses.clear();
    if (this.fingerprintTracker) {
      this.fingerprintTracker.clearAll();
    }
    this.activeListeners.clear();
    this.liveProcesses.clear();
  }

  public resetProcessCounters(): void {
    this.observedProcesses.clear();
    this.liveProcesses.clear();
    this.activeListeners.clear();
  }

  private markTerminal(attemptId: string): void {
    this.terminalAttempts.add(attemptId);
    if (this.terminalAttempts.size > 500) {
      for (const id of this.terminalAttempts) {
        this.terminalAttempts.delete(id);
        if (this.terminalAttempts.size <= 250) break;
      }
    }
  }

  private detachAttemptListeners(record: AttemptRecord): void {
    const proc = record.nodeProc;
    if (proc) {
      if (record.spawnListener && typeof proc.removeListener === 'function') {
        proc.removeListener('spawn', record.spawnListener);
      }
      if (
        record.stderrListener &&
        proc.stderr &&
        typeof proc.stderr.removeListener === 'function'
      ) {
        proc.stderr.removeListener('data', record.stderrListener);
      }
    }
    record.spawnListener = undefined;
    record.stderrListener = undefined;
  }

  private detachProcessListeners(monitored: MonitoredProcess): void {
    const proc = monitored.nodeProc;
    if (proc && typeof proc.removeListener === 'function') {
      if (monitored.exitListener) {
        proc.removeListener('exit', monitored.exitListener);
      }
      if (monitored.closeListener) {
        proc.removeListener('close', monitored.closeListener);
      }
      if (monitored.errorListener) {
        proc.removeListener('error', monitored.errorListener);
      }
    }
    monitored.exitListener = undefined;
    monitored.closeListener = undefined;
    monitored.errorListener = undefined;
  }

  public trackProcess(proc: ProcessLike | null | undefined, explicitAttemptId?: string): void {
    const attemptId = explicitAttemptId ?? this.activeAttemptProvider?.();
    if (!attemptId || this.terminalAttempts.has(attemptId)) {
      return;
    }

    const isExecutionAttempt =
      !explicitAttemptId || explicitAttemptId === this.activeAttemptProvider?.();

    let correlationKey: string | null = null;
    if (this.fingerprintTracker && isExecutionAttempt) {
      correlationKey = this.fingerprintTracker.registerAttempt(
        this.workerId,
        this.processInstanceId,
        attemptId
      );
    }

    if (!proc || !proc.nodeProcess) {
      const diag: LaunchProcessDiagnostics = {
        spawned: false,
        childPid: 'unavailable',
        exitCode: 'unavailable',
        signal: 'unavailable',
        stderrCategory: 'unknown',
      };
      this.attempts.set(attemptId, {
        status: 'active',
        diagnostics: diag,
        stderrChunks: [],
      });
      if (correlationKey && this.fingerprintTracker) {
        this.fingerprintTracker.finalizeAttempt(correlationKey, {
          workerId: this.workerId,
          processInstanceId: this.processInstanceId,
          attemptId,
          exitCode: 'unavailable',
          signal: 'unavailable',
          spawned: false,
          hasPid: false,
        });
      }
      return;
    }

    const nodeProc = proc.nodeProcess;
    let exitCode: number | null | 'unavailable' = 'unavailable';
    let exitSignal: string | 'unavailable' = 'unavailable';
    let spawned = nodeProc.pid !== undefined;
    const childPid: number | 'unavailable' = nodeProc.pid ?? 'unavailable';

    const initialDiag: LaunchProcessDiagnostics = {
      spawned,
      childPid,
      exitCode,
      signal: exitSignal,
      stderrCategory: 'unknown',
    };

    const record: AttemptRecord = {
      status: 'active',
      diagnostics: initialDiag,
      nodeProc,
      stderrChunks: [],
    };
    this.attempts.set(attemptId, record);
    this.observedProcesses.add(nodeProc);
    this.liveProcesses.add(nodeProc);
    this.activeListeners.add(nodeProc);

    const monitored: MonitoredProcess = {
      nodeProc,
      spawned,
      exitOrCloseObserved: false,
    };
    this.monitoredProcesses.set(nodeProc, monitored);

    const updateDiag = (diag: LaunchProcessDiagnostics): void => {
      if (record.status !== 'active' || this.terminalAttempts.has(attemptId)) {
        return;
      }
      record.diagnostics = diag;
      this.attempts.set(attemptId, record);
    };

    const spawnListener = (): void => {
      monitored.spawned = true;
      spawned = true;
      if (record.status !== 'active' || this.terminalAttempts.has(attemptId)) return;
      updateDiag({
        spawned: true,
        childPid: nodeProc.pid ?? childPid,
        exitCode,
        signal: exitSignal,
        stderrCategory: 'unknown',
      });
    };
    record.spawnListener = spawnListener;
    nodeProc.once?.('spawn', spawnListener);

    const stderrListener = (chunk: Buffer | string): void => {
      if (record.status !== 'active' || this.terminalAttempts.has(attemptId)) return;
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      record.stderrChunks.push(str);
      if (record.stderrChunks.length > 50) {
        record.stderrChunks = record.stderrChunks.slice(-50);
      }
      if (correlationKey && this.fingerprintTracker) {
        this.fingerprintTracker.appendStderr(correlationKey, chunk);
      }
    };
    record.stderrListener = stderrListener;
    nodeProc.stderr?.on?.('data', stderrListener);

    const handleProcessTermination = (code: number | null, signal: string | null): void => {
      if (monitored.exitOrCloseObserved) return;
      monitored.exitOrCloseObserved = true;

      this.liveProcesses.delete(nodeProc);
      this.detachProcessListeners(monitored);
      this.activeListeners.delete(nodeProc);
      this.monitoredProcesses.delete(nodeProc);

      if (record.status === 'active' && !this.terminalAttempts.has(attemptId)) {
        exitCode = code;
        exitSignal = signal ?? 'unavailable';
        const fullStderr = record.stderrChunks.join('');
        const category: StderrCategory = classifyStderrCategory(fullStderr, exitCode, exitSignal);
        updateDiag({
          spawned: monitored.spawned,
          childPid: nodeProc.pid ?? childPid,
          exitCode,
          signal: exitSignal,
          stderrCategory: category,
        });
        if (correlationKey && this.fingerprintTracker) {
          this.fingerprintTracker.finalizeAttempt(correlationKey, {
            workerId: this.workerId,
            processInstanceId: this.processInstanceId,
            attemptId,
            exitCode,
            signal: exitSignal,
            spawned: monitored.spawned,
            hasPid: nodeProc.pid !== undefined,
          });
        }
      }
    };

    const exitListener = (code: number | null, signal: string | null): void => {
      handleProcessTermination(code, signal);
    };
    monitored.exitListener = exitListener;
    nodeProc.once?.('exit', exitListener);

    const closeListener = (code: number | null, signal: string | null): void => {
      handleProcessTermination(code, signal);
    };
    monitored.closeListener = closeListener;
    nodeProc.once?.('close', closeListener);

    const errorListener = (err: Error): void => {
      if (!monitored.spawned && nodeProc.pid === undefined) {
        // Pre-spawn failure: process never created
        if (!monitored.exitOrCloseObserved) {
          monitored.exitOrCloseObserved = true;
          this.liveProcesses.delete(nodeProc);
          this.detachProcessListeners(monitored);
          this.activeListeners.delete(nodeProc);
          this.monitoredProcesses.delete(nodeProc);
        }
      }
      // If spawned, error alone does NOT remove from liveProcesses!

      if (record.status === 'active' && !this.terminalAttempts.has(attemptId)) {
        const fullStderr = record.stderrChunks.join('') + ' ' + (err?.message || '');
        const category: StderrCategory = classifyStderrCategory(
          fullStderr,
          'unavailable',
          'unavailable'
        );
        updateDiag({
          spawned: monitored.spawned,
          childPid,
          exitCode: 'unavailable',
          signal: 'unavailable',
          stderrCategory: category,
        });
        if (correlationKey && this.fingerprintTracker) {
          this.fingerprintTracker.finalizeAttempt(correlationKey, {
            workerId: this.workerId,
            processInstanceId: this.processInstanceId,
            attemptId,
            exitCode: 'unavailable',
            signal: 'unavailable',
            spawned: monitored.spawned,
            hasPid: nodeProc.pid !== undefined,
          });
        }
      }
    };
    monitored.errorListener = errorListener;
    nodeProc.once?.('error', errorListener);
  }

  public wrapLaunch<TLaunch extends (...args: unknown[]) => unknown>(
    originalLaunch: TLaunch
  ): TLaunch {
    return ((...args: Parameters<TLaunch>): ReturnType<TLaunch> => {
      if (this.controlledLaunchOverride) {
        let proc: unknown;
        try {
          proc = this.controlledLaunchOverride(args[0]);
        } catch (err) {
          this.trackProcess(null);
          throw err;
        }
        this.trackProcess(proc as ProcessLike | null | undefined);
        return proc as ReturnType<TLaunch>;
      }
      let proc: unknown;
      try {
        proc = originalLaunch(...args);
      } catch (err) {
        this.trackProcess(null);
        throw err;
      }
      this.trackProcess(proc as ProcessLike | null | undefined);
      return proc;
    }) as TLaunch;
  }
}
