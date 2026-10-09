import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { DiagramRenderService, DiagramRenderError } from '../src/diagram/mermaid-render-service.js';
import {
  setDiagnosticSinkForTesting,
  type InternalDiagnosticEvent,
} from '../src/diagram/internal-diagnostics.js';
import {
  BrowserSpawnTracker,
  MockChildProcess,
  FakeProcess,
} from './helpers/browser-spawn-adapter.js';

describe('Diagram Launch Diagnostics Integration (Deterministic Real-Path Tests)', () => {
  let emittedEvents: InternalDiagnosticEvent[] = [];
  let tracker: BrowserSpawnTracker;
  const setLaunchOverride = (globalThis as Record<string, unknown>)[
    '__setControlledLaunchOverride'
  ] as ((override: ((options: unknown) => unknown) | null) => void) | undefined;
  const getTracker = (globalThis as Record<string, unknown>)[
    '__getBrowserSpawnTrackerForTesting'
  ] as (() => BrowserSpawnTracker) | undefined;

  beforeEach(() => {
    emittedEvents = [];
    setDiagnosticSinkForTesting((event) => {
      emittedEvents.push(event);
    });
    if (getTracker) {
      tracker = getTracker();
    }
  });

  afterEach(async () => {
    setDiagnosticSinkForTesting(null);
    if (setLaunchOverride) {
      setLaunchOverride(null);
    }
  });

  it('1. verifies full deterministic launch failure path: fake Process -> waitForLineOutput rejection -> DiagramRenderService catch -> diagnostic event', async () => {
    const fakeProc = new MockChildProcess(8888);
    const fakeProcess = new FakeProcess(fakeProc as unknown as ChildProcess);

    // Register controlled launch override that returns ProcessLike and schedules termination
    expect(setLaunchOverride).toBeDefined();
    setLaunchOverride!((_opts: unknown) => {
      // Schedule stderr and exit after listener registration has completed
      setImmediate(() => {
        fakeProc.stderr.emit('data', 'Killed by SIGKILL');
        fakeProc.emit('exit', null, 'SIGKILL');
      });
      return fakeProcess;
    });

    // Pre-register an unrelated attempt to verify zero bleeding
    const unrelatedProcA = new MockChildProcess(9999);
    tracker.trackProcess(
      { nodeProcess: unrelatedProcA as unknown as ChildProcess },
      'unrelated-attempt-a'
    );

    const service = new DiagramRenderService();
    let thrownError: unknown = null;

    try {
      await service.renderDiagram({
        source: 'graph TD; A-->B;',
        ownerId: 'deterministic-integration-test',
      });
    } catch (err) {
      thrownError = err;
    }

    // Verify rejection with DiagramRenderError
    expect(thrownError).toBeInstanceOf(DiagramRenderError);
    const renderError = thrownError as DiagramRenderError;
    // Verify error message is a safe standard message containing no PID, signal, stderr, or attempt ID
    expect(renderError.message).not.toContain('8888');
    expect(renderError.message).not.toContain('9999');
    expect(renderError.message).not.toContain('SIGKILL');
    expect(renderError.message).not.toContain('Killed by');
    expect(renderError.message).not.toContain('attempt-');

    // Verify that DiagramRenderService actually emitted a puppeteer-launch diagnostic event
    const launchEvents = emittedEvents.filter((e) => e.stage === 'puppeteer-launch');
    expect(launchEvents.length).toBeGreaterThanOrEqual(1);

    const event = launchEvents[0]!;
    expect(event.stage).toBe('puppeteer-launch');
    expect(event.launchAttempt).toBe(1);
    expect(event.spawned).toBe(true);
    expect(event.childPid).toBe(8888);
    expect(event.exitCode).toBeNull();
    expect(event.signal).toBe('SIGKILL');
    expect(event.stderrCategory).toBe('killed-by-signal');

    // Verify unrelated attempt values did not bleed into this event
    expect(event.childPid).not.toBe(9999);

    // Clean up the unrelated attempt
    tracker.cleanupAttempt('unrelated-attempt-a');
    unrelatedProcA.emit('exit', 0, null);
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });

  it('2. verifies diagnostic absence records strictly spawned=false, unavailable, and unknown on early launch rejection', async () => {
    // Override throws before returning ProcessLike (simulating failure before process creation/tracking)
    expect(setLaunchOverride).toBeDefined();
    setLaunchOverride!((_opts: unknown) => {
      throw new Error('Immediate spawn rejection before process creation');
    });

    // Pre-register another attempt to verify no fallback to another attempt
    const unrelatedProcB = new MockChildProcess(7777);
    tracker.trackProcess(
      { nodeProcess: unrelatedProcB as unknown as ChildProcess },
      'unrelated-attempt-b'
    );

    const service = new DiagramRenderService();
    let thrownError: unknown = null;

    try {
      await service.renderDiagram({
        source: 'graph TD; A-->B;',
        ownerId: 'diagnostic-absence-test',
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(DiagramRenderError);
    const renderError = thrownError as DiagramRenderError;
    expect(renderError.message).not.toContain('7777');
    expect(renderError.message).not.toContain('unrelated-attempt');

    // Verify that the actual emitted event used safe defaults without inferring from outer error
    const launchEvents = emittedEvents.filter((e) => e.stage === 'puppeteer-launch');
    expect(launchEvents.length).toBeGreaterThanOrEqual(1);

    const event = launchEvents[0]!;
    expect(event.stage).toBe('puppeteer-launch');
    expect(event.spawned).toBe(false);
    expect(event.childPid).toBe('unavailable');
    expect(event.exitCode).toBe('unavailable');
    expect(event.signal).toBe('unavailable');
    expect(event.stderrCategory).toBe('unknown');

    // Verify unrelated attempt values were not used as fallback
    expect(event.childPid).not.toBe(7777);

    // Clean up the unrelated attempt
    tracker.cleanupAttempt('unrelated-attempt-b');
    unrelatedProcB.emit('exit', 0, null);
    expect(tracker.getPendingAttemptCount()).toBe(0);
  });
});
