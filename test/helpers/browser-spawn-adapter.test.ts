import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { BrowserSpawnTracker } from './browser-spawn-adapter.js';
import { runWithLaunchAttemptContext } from '../../src/diagram/internal-diagnostics.js';

class MockChildProcess extends EventEmitter {
  public pid: number | undefined;
  public stderr: EventEmitter;

  constructor(pid?: number) {
    super();
    this.pid = pid;
    this.stderr = new EventEmitter();
  }
}

describe('BrowserSpawnTracker (Browser Launch Spawn Adapter)', () => {
  let tracker: BrowserSpawnTracker;

  beforeEach(() => {
    tracker = new BrowserSpawnTracker();
  });

  afterEach(() => {
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('1. handles success scenario when process spawns and remains active', () => {
    const mockProc = new MockChildProcess(98765);

    tracker.trackProcess({ nodeProcess: mockProc as unknown as ChildProcess }, 'attempt-1');
    mockProc.emit('spawn');

    const diag = tracker.consumeDiagnostics('attempt-1');
    expect(diag).toBeDefined();
    expect(diag?.spawned).toBe(true);
    expect(diag?.childPid).toBe(98765);
    expect(diag?.exitCode).toBe('unavailable');
    expect(diag?.signal).toBe('unavailable');
    expect(diag?.stderrCategory).toBe('unknown');
  });

  it('2. handles early exit scenario with exit code and stderr', () => {
    const mockProc = new MockChildProcess(98766);

    tracker.trackProcess({ nodeProcess: mockProc as unknown as ChildProcess }, 'attempt-2');
    mockProc.stderr.emit('data', 'Error: Permission denied to access port\n');
    mockProc.emit('exit', 1, null);

    const diag = tracker.consumeDiagnostics('attempt-2');
    expect(diag).toBeDefined();
    expect(diag?.spawned).toBe(true);
    expect(diag?.childPid).toBe(98766);
    expect(diag?.exitCode).toBe(1);
    expect(diag?.signal).toBe('unavailable');
    expect(diag?.stderrCategory).toBe('permission-denied');
  });

  it('3. handles exitCode=null and signal=SIGKILL scenario', () => {
    const mockProc = new MockChildProcess(98767);

    tracker.trackProcess({ nodeProcess: mockProc as unknown as ChildProcess }, 'attempt-3');
    mockProc.stderr.emit('data', 'Received signal 9: killed by signal\n');
    mockProc.emit('exit', null, 'SIGKILL');

    const diag = tracker.consumeDiagnostics('attempt-3');
    expect(diag).toBeDefined();
    expect(diag?.spawned).toBe(true);
    expect(diag?.childPid).toBe(98767);
    expect(diag?.exitCode).toBeNull();
    expect(diag?.signal).toBe('SIGKILL');
    expect(diag?.stderrCategory).toBe('killed-by-signal');
  });

  it('4. handles error scenario when process emits spawn error', () => {
    const mockProc = new MockChildProcess(undefined);

    tracker.trackProcess({ nodeProcess: mockProc as unknown as ChildProcess }, 'attempt-4');
    mockProc.emit('error', new Error('spawn ENOENT: browser not found'));

    const diag = tracker.consumeDiagnostics('attempt-4');
    expect(diag).toBeDefined();
    expect(diag?.spawned).toBe(false);
    expect(diag?.childPid).toBe('unavailable');
    expect(diag?.exitCode).toBe('unavailable');
    expect(diag?.signal).toBe('unavailable');
    expect(diag?.stderrCategory).toBe('executable-not-found');
  });

  it('5. handles unavailable scenario when nodeProcess is null or missing', () => {
    tracker.trackProcess(null, 'attempt-5a');
    const diagNull = tracker.consumeDiagnostics('attempt-5a');
    expect(diagNull?.spawned).toBe(false);
    expect(diagNull?.childPid).toBe('unavailable');
    expect(diagNull?.exitCode).toBe('unavailable');
    expect(diagNull?.signal).toBe('unavailable');
    expect(diagNull?.stderrCategory).toBe('unknown');

    tracker.trackProcess({ nodeProcess: null }, 'attempt-5b');
    const diagNoNode = tracker.consumeDiagnostics('attempt-5b');
    expect(diagNoNode?.spawned).toBe(false);
    expect(diagNoNode?.childPid).toBe('unavailable');
    expect(diagNoNode?.exitCode).toBe('unavailable');
    expect(diagNoNode?.signal).toBe('unavailable');
    expect(diagNoNode?.stderrCategory).toBe('unknown');
  });

  it('6. isolates diagnostics when two concurrent launches exit in reverse order', () => {
    const procA = new MockChildProcess(1001);
    const procB = new MockChildProcess(1002);

    // Launch A starts, then Launch B starts
    tracker.trackProcess({ nodeProcess: procA as unknown as ChildProcess }, 'attempt-A');
    tracker.trackProcess({ nodeProcess: procB as unknown as ChildProcess }, 'attempt-B');

    // Process B terminates first (SIGKILL)
    procB.stderr.emit('data', 'Killed by SIGKILL');
    procB.emit('exit', null, 'SIGKILL');

    // Process A terminates second (exit code 127: missing library)
    procA.stderr.emit('data', 'dlopen: library not loaded: libnss3.dylib');
    procA.emit('exit', 127, null);

    // Consume B
    const diagB = tracker.consumeDiagnostics('attempt-B');
    expect(diagB).toBeDefined();
    expect(diagB?.childPid).toBe(1002);
    expect(diagB?.exitCode).toBeNull();
    expect(diagB?.signal).toBe('SIGKILL');
    expect(diagB?.stderrCategory).toBe('killed-by-signal');

    // Consume A
    const diagA = tracker.consumeDiagnostics('attempt-A');
    expect(diagA).toBeDefined();
    expect(diagA?.childPid).toBe(1001);
    expect(diagA?.exitCode).toBe(127);
    expect(diagA?.signal).toBe('unavailable');
    expect(diagA?.stderrCategory).toBe('dynamic-library');
  });

  it('7. isolates diagnostics when one launch succeeds and the other rejects', () => {
    const procSuccess = new MockChildProcess(2001);
    const procFail = new MockChildProcess(2002);

    tracker.trackProcess({ nodeProcess: procSuccess as unknown as ChildProcess }, 'attempt-succ');
    tracker.trackProcess({ nodeProcess: procFail as unknown as ChildProcess }, 'attempt-fail');

    procSuccess.emit('spawn');

    procFail.stderr.emit('data', 'cannot run in setuid sandbox\n');
    procFail.emit('exit', 1, null);

    const diagSuccess = tracker.consumeDiagnostics('attempt-succ');
    expect(diagSuccess?.spawned).toBe(true);
    expect(diagSuccess?.childPid).toBe(2001);
    expect(diagSuccess?.stderrCategory).toBe('unknown');

    const diagFail = tracker.consumeDiagnostics('attempt-fail');
    expect(diagFail?.childPid).toBe(2002);
    expect(diagFail?.exitCode).toBe(1);
    expect(diagFail?.stderrCategory).toBe('sandbox-failure');
  });

  it('8. returns strictly undefined when attempt ID does not exist even if other attempts exist', () => {
    const proc = new MockChildProcess(3001);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'existing-attempt');

    // Missing attempt returns undefined without latest fallback
    const missingDiag = tracker.consumeDiagnostics('non-existent-attempt');
    expect(missingDiag).toBeUndefined();

    // Existing attempt is retained intact
    const existingDiag = tracker.consumeDiagnostics('existing-attempt');
    expect(existingDiag?.childPid).toBe(3001);
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('9. prevents bleeding of PID/signal/stderr from attempt B when attempt A ID is missing', () => {
    const procB = new MockChildProcess(3002);
    tracker.trackProcess({ nodeProcess: procB as unknown as ChildProcess }, 'attempt-B');
    procB.stderr.emit('data', 'Killed by SIGKILL');
    procB.emit('exit', null, 'SIGKILL');

    // Attempt A was never registered
    const diagA = tracker.consumeDiagnostics('attempt-A');
    expect(diagA).toBeUndefined();

    // Attempt B diagnostics remain strictly under attempt B
    const diagB = tracker.consumeDiagnostics('attempt-B');
    expect(diagB?.childPid).toBe(3002);
    expect(diagB?.signal).toBe('SIGKILL');
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('10. invokes original launch exactly once per attempt without double execution', () => {
    let callCount = 0;
    const mockProc = new MockChildProcess(4001);

    const originalLaunch = (opts: { val: number }) => {
      callCount++;
      return { nodeProcess: mockProc as unknown as ChildProcess, val: opts.val };
    };

    const wrapped = tracker.wrapLaunch(originalLaunch);

    const res1 = wrapped({ val: 10 });
    expect(callCount).toBe(1);
    expect(res1.val).toBe(10);

    const res2 = wrapped({ val: 20 });
    expect(callCount).toBe(2);
    expect(res2.val).toBe(20);

    tracker.clearAll();
  });

  it('11. preserves arguments, return value, this context, and exception propagation', () => {
    const mockProc = new MockChildProcess(5001);

    const contextObj = {
      base: 100,
      launch(this: { base: number }, delta: number) {
        if (delta < 0) throw new RangeError('Negative delta');
        return { nodeProcess: mockProc as unknown as ChildProcess, total: this.base + delta };
      },
    };

    const wrapped = tracker.wrapLaunch(contextObj.launch.bind(contextObj));

    const result = wrapped(25);
    expect(result.total).toBe(125);

    expect(() => wrapped(-5)).toThrow(RangeError);

    tracker.clearAll();
  });

  it('12. verifies context propagation and process diagnostics with deterministic fake process', async () => {
    const fakeProc = new MockChildProcess(8888);
    let capturedAttemptId = '';

    await expect(
      runWithLaunchAttemptContext(async (attemptId) => {
        capturedAttemptId = attemptId;
        // Pre-register another attempt to verify no leakage
        tracker.trackProcess(
          { nodeProcess: new MockChildProcess(9999) as unknown as ChildProcess },
          'other-attempt'
        );

        // Track fake process under active context
        tracker.trackProcess({ nodeProcess: fakeProc as unknown as ChildProcess }, attemptId);

        // Emit stderr and termination
        fakeProc.stderr.emit('data', 'Killed by SIGKILL');
        fakeProc.emit('exit', null, 'SIGKILL');

        throw new Error('Simulated launch failure: process died');
      })
    ).rejects.toThrow('Simulated launch failure');

    expect(capturedAttemptId).toBeDefined();
    expect(capturedAttemptId.length).toBeGreaterThan(0);

    // Consume diagnostics for this attempt
    const diag = tracker.consumeDiagnostics(capturedAttemptId);
    expect(diag).toBeDefined();
    expect(diag?.childPid).toBe(8888);
    expect(diag?.exitCode).toBeNull();
    expect(diag?.signal).toBe('SIGKILL');
    expect(diag?.stderrCategory).toBe('killed-by-signal');

    // Consuming again returns undefined (no fallback, no resurrection)
    expect(tracker.consumeDiagnostics(capturedAttemptId)).toBeUndefined();

    // Clean up the other attempt
    tracker.cleanupAttempt('other-attempt');
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('13. verifies diagnostic absence records strictly unknown without inferring from outer error', () => {
    // Attempt with no process diagnostics tracked
    const diag = tracker.consumeDiagnostics('missing-attempt-id');
    expect(diag).toBeUndefined();

    // DiagramRenderService records spawned=false, unavailable, and unknown when diag is undefined
    const simulatedEvent = {
      spawned: diag?.spawned ?? false,
      childPid: diag?.childPid ?? 'unavailable',
      exitCode: diag?.exitCode ?? 'unavailable',
      signal: diag?.signal ?? 'unavailable',
      stderrCategory: diag?.stderrCategory ?? 'unknown',
    };
    expect(simulatedEvent.spawned).toBe(false);
    expect(simulatedEvent.childPid).toBe('unavailable');
    expect(simulatedEvent.exitCode).toBe('unavailable');
    expect(simulatedEvent.signal).toBe('unavailable');
    expect(simulatedEvent.stderrCategory).toBe('unknown');
  });

  it('14. classifies as executable-not-found only when adapter observes ENOENT process error', () => {
    const procEnoent = new MockChildProcess(undefined);
    tracker.trackProcess({ nodeProcess: procEnoent as unknown as ChildProcess }, 'attempt-enoent');
    procEnoent.emit('error', new Error('spawn ENOENT'));

    const diag = tracker.consumeDiagnostics('attempt-enoent');
    expect(diag?.spawned).toBe(false);
    expect(diag?.stderrCategory).toBe('executable-not-found');
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('15. verifies listener detachment and zero Map resurrection/buffer leak on delayed events', () => {
    const proc = new MockChildProcess(7777);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-delayed');
    expect(tracker.getPendingAttemptCount()).toBe(1);

    // Verify listeners are attached
    expect(proc.listenerCount('exit')).toBe(1);
    expect(proc.listenerCount('spawn')).toBe(1);
    expect(proc.listenerCount('error')).toBe(1);
    expect(proc.stderr.listenerCount('data')).toBe(1);

    // Cleanup attempt terminates attempt, but retains minimal process exit monitoring
    tracker.cleanupAttempt('attempt-delayed');
    expect(tracker.getPendingAttemptCount()).toBe(0);

    // spawn and stderr listeners are detached, exit/error monitoring remains active
    expect(proc.listenerCount('spawn')).toBe(0);
    expect(proc.stderr.listenerCount('data')).toBe(0);
    expect(proc.listenerCount('exit')).toBe(1);
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);

    // Fire process exit
    proc.emit('exit', 1, null);

    // After exit, monitoring listeners are fully detached and live count drops to 0
    expect(proc.listenerCount('exit')).toBe(0);
    expect(proc.listenerCount('error')).toBe(0);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);

    // Fire delayed events after termination
    proc.stderr.emit('data', 'Delayed stderr chunk');
    proc.emit('exit', 1, null);
    proc.on('error', () => {});
    proc.emit('error', new Error('Delayed error'));

    // Map must remain 0 and consume must return undefined
    expect(tracker.getPendingAttemptCount()).toBe(0);
    expect(tracker.consumeDiagnostics('attempt-delayed')).toBeUndefined();
    expect(tracker.getDiagnostics('attempt-delayed')).toBeUndefined();
  });

  it('16. verifies idempotency of cleanupAttempt and consumeDiagnostics', () => {
    const proc = new MockChildProcess(6666);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-idempotent');

    const diag1 = tracker.consumeDiagnostics('attempt-idempotent');
    expect(diag1).toBeDefined();

    // Repeated consume
    const diag2 = tracker.consumeDiagnostics('attempt-idempotent');
    expect(diag2).toBeUndefined();

    // Repeated cleanup
    expect(() => tracker.cleanupAttempt('attempt-idempotent')).not.toThrow();
    expect(() => tracker.cleanupAttempt('attempt-idempotent')).not.toThrow();
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('17. verifies child process remains live after consumeDiagnostics until exit/close', () => {
    const proc = new MockChildProcess(12345);
    tracker.trackProcess(
      { nodeProcess: proc as unknown as ChildProcess },
      'attempt-live-after-consume'
    );
    proc.emit('spawn');

    const diag = tracker.consumeDiagnostics('attempt-live-after-consume');
    expect(diag?.spawned).toBe(true);

    // Process is consumed but has not exited
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(1);

    // Emit close event
    proc.emit('close', 0, null);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);
  });

  it('18. verifies delayed exit decreases live count without resurrecting attempt or sidecar', () => {
    const proc = new MockChildProcess(12346);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-delayed-exit');

    tracker.consumeDiagnostics('attempt-delayed-exit');
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);

    // Delayed exit event
    proc.emit('exit', 0, null);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getPendingAttemptCount()).toBe(0);
    expect(tracker.getDiagnostics('attempt-delayed-exit')).toBeUndefined();
  });

  it('19. verifies cleanupAttempt alone does not confirm process termination', () => {
    const proc = new MockChildProcess(12347);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-cleanup-alive');

    tracker.cleanupAttempt('attempt-cleanup-alive');
    expect(tracker.getPendingAttemptCount()).toBe(0);
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(1);

    proc.emit('exit', 0, null);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);
  });

  it('20. verifies post-spawn error does not decrease live count without exit/close', () => {
    const proc = new MockChildProcess(12348);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-error-live');
    proc.emit('spawn');

    expect(tracker.getLiveBrowserProcessCount()).toBe(1);

    // Post-spawn error event (e.g. IPC or kill failure)
    proc.emit('error', new Error('IPC channel failure'));
    // Must remain live!
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(1);

    // Finally exits
    proc.emit('exit', 1, null);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);

    const diag = tracker.consumeDiagnostics('attempt-error-live');
    expect(diag).toBeDefined();
  });

  it('21. verifies pre-spawn error without pid is treated as unspawned and completes process', () => {
    const proc = new MockChildProcess(undefined);
    tracker.trackProcess(
      { nodeProcess: proc as unknown as ChildProcess },
      'attempt-prespawn-error'
    );

    expect(tracker.getLiveBrowserProcessCount()).toBe(1);

    // Error before spawn
    proc.emit('error', new Error('spawn ENOENT: binary not found'));
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);

    const diag = tracker.consumeDiagnostics('attempt-prespawn-error');
    expect(diag?.spawned).toBe(false);
  });

  it('22. verifies audit metrics reflect unconfirmed live processes and unreleased listeners', () => {
    const proc = new MockChildProcess(12349);
    tracker.trackProcess({ nodeProcess: proc as unknown as ChildProcess }, 'attempt-audit');

    expect(tracker.getObservedBrowserProcessCount()).toBe(1);
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(1);

    // Still live after consume
    tracker.consumeDiagnostics('attempt-audit');
    expect(tracker.getLiveBrowserProcessCount()).toBe(1);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(1);

    // Exits
    proc.emit('exit', 0, null);
    expect(tracker.getObservedBrowserProcessCount()).toBe(1);
    expect(tracker.getLiveBrowserProcessCount()).toBe(0);
    expect(tracker.getUnreleasedBrowserProcessCount()).toBe(0);
  });
});
