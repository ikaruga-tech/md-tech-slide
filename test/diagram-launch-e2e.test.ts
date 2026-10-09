import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiagramRenderService } from '../src/diagram/mermaid-render-service.js';
import {
  setDiagnosticSinkForTesting,
  getGlobalActiveBrowserCount,
  type InternalDiagnosticEvent,
} from '../src/diagram/internal-diagnostics.js';
import { resolveBrowserExecutable, isExecutableFile } from '../src/export/browser-finder.js';
import type { BrowserSpawnTracker } from './helpers/browser-spawn-adapter.js';

function getRequiredTracker(): BrowserSpawnTracker {
  const hook = (globalThis as Record<string, unknown>)['__getBrowserSpawnTrackerForTesting'];
  if (typeof hook !== 'function') {
    throw new Error('Tracker hook __getBrowserSpawnTrackerForTesting is required for E2E testing.');
  }
  const tracker = hook() as BrowserSpawnTracker;
  if (!tracker || typeof tracker.getPendingAttemptCount !== 'function') {
    throw new Error('Valid BrowserSpawnTracker instance is required for E2E testing.');
  }
  return tracker;
}

describe('Diagram Launch Real Browser E2E Test', () => {
  let emittedEvents: InternalDiagnosticEvent[] = [];
  let service: DiagramRenderService | null = null;

  beforeEach(() => {
    emittedEvents = [];
    setDiagnosticSinkForTesting((event) => {
      emittedEvents.push(event);
    });
  });

  afterEach(async () => {
    if (service) {
      await service.dispose();
      service = null;
    }
    setDiagnosticSinkForTesting(null);
  });

  it('fails explicitly when tracker hook is absent without skipping or defaulting to zero', () => {
    const globalRecord = globalThis as Record<string, unknown>;
    const originalHook = globalRecord['__getBrowserSpawnTrackerForTesting'];
    try {
      delete globalRecord['__getBrowserSpawnTrackerForTesting'];
      expect(() => getRequiredTracker()).toThrow(
        'Tracker hook __getBrowserSpawnTrackerForTesting is required for E2E testing.'
      );
    } finally {
      globalRecord['__getBrowserSpawnTrackerForTesting'] = originalHook;
    }
  });

  it('executes real Chromium launch and rendering, asserting full lifecycle and zero leaked attempts', async () => {
    // 1. Resolve browser executable and verify executable file contract
    const resolution = resolveBrowserExecutable();
    if ('error' in resolution) {
      throw new Error('Browser executable could not be resolved for E2E testing.');
    }
    expect(isExecutableFile(resolution.executablePath)).toBe(true);

    // 2. Validate tracker hook presence and assert zero pending attempts before launch
    const tracker = getRequiredTracker();
    expect(tracker.getPendingAttemptCount()).toBe(0);

    // 3. Instantiate real DiagramRenderService
    service = new DiagramRenderService();

    // 4. Render a valid Mermaid diagram
    const diagramResult = await service.renderDiagram({
      source: 'graph TD; Start[Start] --> End[End];',
      ownerId: 'e2e-real-browser-test',
    });

    // 5. Verify rendered SVG result
    expect(diagramResult).toBeDefined();
    expect(diagramResult.svg).toContain('<svg');
    expect(diagramResult.svg).toContain('Start');
    expect(diagramResult.svg).toContain('End');
    expect(diagramResult.width).toBeGreaterThan(0);
    expect(diagramResult.height).toBeGreaterThan(0);

    // 6. Verify pending launch attempts returned to zero upon successful launch
    expect(tracker.getPendingAttemptCount()).toBe(0);

    // 7. Verify diagnostic events emitted during lifecycle
    const stages = emittedEvents.map((e) => e.stage);
    expect(stages).toContain('service-create');
    expect(stages).toContain('browser-launch-start');
    expect(stages).toContain('browser-launch-success');
    expect(stages).toContain('task-start');
    expect(stages).toContain('task-settle');

    const launchSuccessEvent = emittedEvents.find((e) => e.stage === 'browser-launch-success');
    expect(launchSuccessEvent).toBeDefined();
    expect(launchSuccessEvent?.browserPid).toBeDefined();
    expect(typeof launchSuccessEvent?.browserPid).toBe('number');
    expect(launchSuccessEvent?.browserPid).toBeGreaterThan(0);

    // 8. Dispose service and verify clean shutdown
    await service.dispose();
    service = null;

    expect(getGlobalActiveBrowserCount()).toBe(0);
    expect(tracker.getPendingAttemptCount()).toBe(0);
  }, 30_000);
});
