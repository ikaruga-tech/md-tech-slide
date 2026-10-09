import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DiagramRenderService, DiagramRenderError } from '../src/diagram/mermaid-render-service.js';
import {
  setDiagnosticSinkForTesting,
  setFaultInjectionHooksForTesting,
  setNetworkProbeForTesting,
  setNetworkDecisionObserverForTesting,
  setLaunchArgsModifierForTesting,
  type InternalDiagnosticEvent,
  type NetworkInterceptionEvent,
} from '../src/diagram/internal-diagnostics.js';

export interface VerificationInput {
  readonly events: readonly NetworkInterceptionEvent[];
  readonly serverHits: {
    readonly http: number;
    readonly https: number;
    readonly ws: number;
    readonly wss: number;
  };
  readonly probedCategories: {
    readonly http: boolean;
    readonly https: boolean;
    readonly image: boolean;
    readonly font: boolean;
    readonly file: boolean;
    readonly ws: boolean;
    readonly wss: boolean;
  };
  readonly fileBlocked: boolean;
  readonly wsBlocked: boolean;
  readonly wssBlocked: boolean;
}

export function verifyNetworkIsolation(input: VerificationInput): {
  success: boolean;
  error?: string;
} {
  // 1. All required categories must be probed
  const requiredCategories = ['http', 'https', 'image', 'font', 'file', 'ws', 'wss'] as const;
  for (const cat of requiredCategories) {
    if (!input.probedCategories[cat]) {
      return { success: false, error: `Missing probe for category: ${cat}` };
    }
  }

  // 2. Server hits must be strictly 0 for all protocols
  if (input.serverHits.http > 0)
    return { success: false, error: `HTTP server reached: ${input.serverHits.http} hits` };
  if (input.serverHits.https > 0)
    return { success: false, error: `HTTPS server reached: ${input.serverHits.https} hits` };
  if (input.serverHits.ws > 0)
    return { success: false, error: `WS server reached: ${input.serverHits.ws} hits` };
  if (input.serverHits.wss > 0)
    return { success: false, error: `WSS server reached: ${input.serverHits.wss} hits` };

  // 3. Sandbox / CSP blocking for non-interception protocols
  if (!input.fileBlocked)
    return { success: false, error: 'file: scheme was not blocked by sandbox' };
  if (!input.wsBlocked) return { success: false, error: 'WebSocket was not blocked' };
  if (!input.wssBlocked) return { success: false, error: 'WebSocket Secure was not blocked' };

  // 4. Interception decisions must all be abort('blockedbyclient')
  if (input.events.length === 0) {
    return { success: false, error: 'No interception events recorded' };
  }

  let httpCount = 0;
  let httpsCount = 0;
  let imageCount = 0;
  let fontCount = 0;

  for (const e of input.events) {
    if (e.decision !== 'abort') {
      return { success: false, error: `Non-abort decision recorded: ${e.decision} for ${e.url}` };
    }
    if (e.abortReason !== 'blockedbyclient') {
      return { success: false, error: `Unexpected abort reason: ${e.abortReason} for ${e.url}` };
    }
    if (e.urlCategory === 'http') httpCount++;
    if (e.urlCategory === 'https') httpsCount++;
    if (e.urlCategory === 'image') imageCount++;
    if (e.urlCategory === 'font') fontCount++;
  }

  if (httpCount === 0) return { success: false, error: 'No HTTP abort event recorded' };
  if (httpsCount === 0) return { success: false, error: 'No HTTPS abort event recorded' };
  if (imageCount === 0) return { success: false, error: 'No Image abort event recorded' };
  if (fontCount === 0) return { success: false, error: 'No Font abort event recorded' };

  return { success: true };
}

describe('DiagramRenderService (Resilience, Isolation & Network Blocking)', () => {
  const diagnosticEvents: InternalDiagnosticEvent[] = [];

  beforeEach(() => {
    diagnosticEvents.length = 0;
    setDiagnosticSinkForTesting((event) => {
      diagnosticEvents.push(event);
    });
    setFaultInjectionHooksForTesting(null);
    setNetworkProbeForTesting(null);
    setNetworkDecisionObserverForTesting(null);
    setLaunchArgsModifierForTesting((args) => [...args, '--ignore-certificate-errors']);
  });

  afterEach(() => {
    setDiagnosticSinkForTesting(null);
    setFaultInjectionHooksForTesting(null);
    setNetworkProbeForTesting(null);
    setNetworkDecisionObserverForTesting(null);
    setLaunchArgsModifierForTesting(null);
  });

  it('blocks all external network requests (HTTP, HTTPS, file, WebSocket, WSS, fonts, images) with zero server reach and verified decisions', async () => {
    // 1. Setup local HTTP and WebSocket server on 127.0.0.1
    const serverHits = { http: 0, https: 0, ws: 0, wss: 0 };

    const httpServer = http.createServer((req, res) => {
      serverHits.http++;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('leak');
    });
    httpServer.on('upgrade', (_req, socket) => {
      serverHits.ws++;
      socket.destroy();
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const httpPort = (httpServer.address() as { port: number }).port;
    const httpBaseUrl = `http://127.0.0.1:${httpPort}`;
    const wsUrl = `ws://127.0.0.1:${httpPort}/ws`;

    // 2. Setup local HTTPS and WSS server on 127.0.0.1 using test fixture certificate
    const certPath = path.resolve(__dirname, 'fixtures/test-cert.pem');
    const keyPath = path.resolve(__dirname, 'fixtures/test-key.pem');
    const tlsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };

    const httpsServer = https.createServer(tlsOptions, (req, res) => {
      serverHits.https++;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('leak-tls');
    });
    httpsServer.on('upgrade', (_req, socket) => {
      serverHits.wss++;
      socket.destroy();
    });

    await new Promise<void>((resolve) => httpsServer.listen(0, '127.0.0.1', () => resolve()));
    const httpsPort = (httpsServer.address() as { port: number }).port;
    const httpsBaseUrl = `https://127.0.0.1:${httpsPort}`;
    const wssUrl = `wss://127.0.0.1:${httpsPort}/wss`;

    // 3. Single observation channel for interception events
    const interceptionEvents: NetworkInterceptionEvent[] = [];
    setNetworkDecisionObserverForTesting((event) => {
      interceptionEvents.push(event);
    });

    const probedCategories = {
      http: false,
      https: false,
      image: false,
      font: false,
      file: false,
      ws: false,
      wss: false,
    };
    let fileBlocked = false;
    let wsBlocked = false;
    let wssBlocked = false;

    setNetworkProbeForTesting(async (page) => {
      // Probe 1: HTTP
      probedCategories.http = true;
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
        } catch {
          // Expected network abort
        }
      }, `${httpBaseUrl}/insecure-data.json`);

      // Probe 2: HTTPS (to local TLS server)
      probedCategories.https = true;
      await page.evaluate(async (url) => {
        try {
          await fetch(url);
        } catch {
          // Expected network abort
        }
      }, `${httpsBaseUrl}/secure-data.json`);

      // Probe 3: Image
      probedCategories.image = true;
      await page.evaluate(async (url) => {
        return new Promise<void>((resolve) => {
          const img = document.createElement('img');
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
          document.body.appendChild(img);
          setTimeout(resolve, 300);
        });
      }, `${httpBaseUrl}/test-image.png`);

      // Probe 4: Font
      probedCategories.font = true;
      await page.evaluate(async (url) => {
        try {
          const font = new FontFace('TestFont', `url(${url})`);
          await font.load();
        } catch {
          // Expected font abort
        }
      }, `${httpBaseUrl}/test-font.woff2`);

      // Probe 5: file: scheme
      probedCategories.file = true;
      const fileResult = await page.evaluate(async () => {
        try {
          await fetch('file:///etc/hosts');
          return { allowed: true };
        } catch {
          return { allowed: false };
        }
      });
      if (!fileResult.allowed) {
        fileBlocked = true;
      }

      // Probe 6: WebSocket (to local WS server)
      probedCategories.ws = true;
      const wsResult = await page.evaluate(async (url) => {
        return new Promise<'opened' | 'errored'>((resolve) => {
          try {
            const ws = new WebSocket(url);
            ws.onopen = () => {
              ws.close();
              resolve('opened');
            };
            ws.onerror = () => resolve('errored');
            setTimeout(() => resolve('errored'), 500);
          } catch {
            resolve('errored');
          }
        });
      }, wsUrl);
      if (wsResult === 'errored') {
        wsBlocked = true;
      }

      // Probe 7: WSS (to local WSS server)
      probedCategories.wss = true;
      const wssResult = await page.evaluate(async (url) => {
        return new Promise<'opened' | 'errored'>((resolve) => {
          try {
            const ws = new WebSocket(url);
            ws.onopen = () => {
              ws.close();
              resolve('opened');
            };
            ws.onerror = () => resolve('errored');
            setTimeout(() => resolve('errored'), 500);
          } catch {
            resolve('errored');
          }
        });
      }, wssUrl);
      if (wssResult === 'errored') {
        wssBlocked = true;
      }
    });

    const service = new DiagramRenderService({ maxPages: 1 });

    try {
      const res = await service.renderDiagram({
        source: 'flowchart TD; A-->B;',
        ownerId: 'net-tester',
      });
      expect(res.svg).toBeDefined();

      const verification = verifyNetworkIsolation({
        events: interceptionEvents,
        serverHits,
        probedCategories,
        fileBlocked,
        wsBlocked,
        wssBlocked,
      });

      expect(verification.success).toBe(true);
      expect(verification.error).toBeUndefined();
    } finally {
      await service.dispose();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    }
  }, 30_000);

  it('rejects invalid or bypassed network observations with mutation testing on the common verifier', () => {
    const validEvents: NetworkInterceptionEvent[] = [
      {
        urlCategory: 'http',
        resourceType: 'xhr',
        protocol: 'http:',
        decision: 'abort',
        abortReason: 'blockedbyclient',
        url: 'http://127.0.0.1/data',
      },
      {
        urlCategory: 'https',
        resourceType: 'xhr',
        protocol: 'https:',
        decision: 'abort',
        abortReason: 'blockedbyclient',
        url: 'https://127.0.0.1/data',
      },
      {
        urlCategory: 'image',
        resourceType: 'image',
        protocol: 'http:',
        decision: 'abort',
        abortReason: 'blockedbyclient',
        url: 'http://127.0.0.1/image.png',
      },
      {
        urlCategory: 'font',
        resourceType: 'font',
        protocol: 'http:',
        decision: 'abort',
        abortReason: 'blockedbyclient',
        url: 'http://127.0.0.1/font.woff2',
      },
    ];

    const baseValidInput: VerificationInput = {
      events: validEvents,
      serverHits: { http: 0, https: 0, ws: 0, wss: 0 },
      probedCategories: {
        http: true,
        https: true,
        image: true,
        font: true,
        file: true,
        ws: true,
        wss: true,
      },
      fileBlocked: true,
      wsBlocked: true,
      wssBlocked: true,
    };

    // Baseline: valid input passes
    expect(verifyNetworkIsolation(baseValidInput).success).toBe(true);

    // Mutation 1: Missing abort event for http
    const mutation1: VerificationInput = {
      ...baseValidInput,
      events: validEvents.filter((e) => e.urlCategory !== 'http'),
    };
    expect(verifyNetworkIsolation(mutation1).success).toBe(false);

    // Mutation 2: continue decision recorded
    const mutation2: VerificationInput = {
      ...baseValidInput,
      events: [
        ...validEvents,
        {
          urlCategory: 'http',
          resourceType: 'xhr',
          protocol: 'http:',
          decision: 'continue',
          url: 'http://127.0.0.1/leak',
        },
      ],
    };
    expect(verifyNetworkIsolation(mutation2).success).toBe(false);

    // Mutation 3: respond decision recorded
    const mutation3: VerificationInput = {
      ...baseValidInput,
      events: [
        ...validEvents,
        {
          urlCategory: 'http',
          resourceType: 'xhr',
          protocol: 'http:',
          decision: 'respond',
          url: 'http://127.0.0.1/mock',
        },
      ],
    };
    expect(verifyNetworkIsolation(mutation3).success).toBe(false);

    // Mutation 4: HTTP server hit
    const mutation4: VerificationInput = {
      ...baseValidInput,
      serverHits: { http: 1, https: 0, ws: 0, wss: 0 },
    };
    expect(verifyNetworkIsolation(mutation4).success).toBe(false);

    // Mutation 5: HTTPS server hit
    const mutation5: VerificationInput = {
      ...baseValidInput,
      serverHits: { http: 0, https: 1, ws: 0, wss: 0 },
    };
    expect(verifyNetworkIsolation(mutation5).success).toBe(false);

    // Mutation 6: WS server hit
    const mutation6: VerificationInput = {
      ...baseValidInput,
      serverHits: { http: 0, https: 0, ws: 1, wss: 0 },
    };
    expect(verifyNetworkIsolation(mutation6).success).toBe(false);

    // Mutation 7: WSS server hit
    const mutation7: VerificationInput = {
      ...baseValidInput,
      serverHits: { http: 0, https: 0, ws: 0, wss: 1 },
    };
    expect(verifyNetworkIsolation(mutation7).success).toBe(false);

    // Mutation 8: Missing probe category (e.g. wss probe missed)
    const mutation8: VerificationInput = {
      ...baseValidInput,
      probedCategories: { ...baseValidInput.probedCategories, wss: false },
    };
    expect(verifyNetworkIsolation(mutation8).success).toBe(false);

    // Mutation 9: file not blocked by sandbox
    const mutation9: VerificationInput = {
      ...baseValidInput,
      fileBlocked: false,
    };
    expect(verifyNetworkIsolation(mutation9).success).toBe(false);

    // Mutation 10: WebSocket not blocked
    const mutation10: VerificationInput = {
      ...baseValidInput,
      wsBlocked: false,
    };
    expect(verifyNetworkIsolation(mutation10).success).toBe(false);
  });

  it('runs exactly 2 pages concurrently while queueing the 3rd task until a page is freed', async () => {
    let unblock1!: () => void;
    let unblock2!: () => void;
    const blockPromise1 = new Promise<void>((r) => {
      unblock1 = r;
    });
    const blockPromise2 = new Promise<void>((r) => {
      unblock2 = r;
    });

    let runningCount = 0;
    let maxObservedRunning = 0;

    const service = new DiagramRenderService({
      maxPages: 2,
      onTaskRunning: async (task) => {
        runningCount++;
        if (runningCount > maxObservedRunning) {
          maxObservedRunning = runningCount;
        }

        if (task.source.includes('Hold1')) {
          await blockPromise1;
        } else if (task.source.includes('Hold2')) {
          await blockPromise2;
        }
        runningCount--;
      },
    });

    try {
      const p1 = service.renderDiagram({ source: 'graph TD; Hold1;', ownerId: 'p1' });
      const p2 = service.renderDiagram({ source: 'graph TD; Hold2;', ownerId: 'p2' });
      const p3 = service.renderDiagram({ source: 'graph TD; Queued3;', ownerId: 'p3' });

      for (let i = 0; i < 50; i++) {
        if (service.getRunningExecutionCount() === 2 && service.getQueueLength() === 1) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(service.getRunningExecutionCount()).toBe(2);
      expect(service.getQueueLength()).toBe(1);
      expect(maxObservedRunning).toBe(2);

      unblock1();
      const res1 = await p1;
      expect(res1.svg).toBeDefined();

      for (let i = 0; i < 50; i++) {
        if (service.getQueueLength() === 0) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(service.getQueueLength()).toBe(0);

      unblock2();
      const res2 = await p2;
      const res3 = await p3;
      expect(res2.svg).toBeDefined();
      expect(res3.svg).toBeDefined();
    } finally {
      unblock1?.();
      unblock2?.();
      await service.dispose();
    }
  }, 30_000);

  it('keeps theme, DOM ID, and SVG output completely isolated across concurrent pages', async () => {
    const service = new DiagramRenderService({ maxPages: 2 });
    try {
      const pLight = service.renderDiagram({
        source: 'graph TD; LightNode1-->LightNode2;',
        ownerId: 'light-client',
        theme: 'light',
      });
      const pDark = service.renderDiagram({
        source: 'graph TD; DarkNode1-->DarkNode2;',
        ownerId: 'dark-client',
        theme: 'dark',
      });

      const [resLight, resDark] = await Promise.all([pLight, pDark]);

      expect(resLight.svg).toContain('LightNode1');
      expect(resLight.svg).not.toContain('DarkNode1');

      expect(resDark.svg).toContain('DarkNode1');
      expect(resDark.svg).not.toContain('LightNode1');

      expect(resLight.svg).not.toBe(resDark.svg);
    } finally {
      await service.dispose();
    }
  }, 25_000);

  describe('Fault Injection and Finite-Time Settlement', () => {
    it('settles all queued promises in finite time when puppeteer.launch fails and self-heals', async () => {
      setFaultInjectionHooksForTesting({
        failLaunch: () => {
          throw new Error('Simulated launch failure');
        },
      });

      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const p1 = service.renderDiagram({ source: 'graph TD; F1;', ownerId: 'f1' });
        const p2 = service.renderDiagram({ source: 'graph TD; F2;', ownerId: 'f2' });

        const results = await Promise.allSettled([p1, p2]);
        expect(results[0].status).toBe('rejected');
        expect(results[1].status).toBe('rejected');

        const err1 = (results[0] as PromiseRejectedResult).reason;
        expect(err1).toBeInstanceOf(DiagramRenderError);
        expect((err1 as DiagramRenderError).code).toBe('mermaid-render-failed');

        // failure stage is puppeteer-launch
        const launchEvents = diagnosticEvents.filter((e) => e.stage === 'puppeteer-launch');
        expect(launchEvents.length).toBeGreaterThan(0);

        // 障害フック解除後の次リクエストで自己修復・正常描画できること
        setFaultInjectionHooksForTesting(null);
        const recovered = await service.renderDiagram({
          source: 'graph TD; LaunchRecovered;',
          ownerId: 'rec1',
        });
        expect(recovered.svg).toContain('LaunchRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('settles queued tasks when newPage fails and recovers', async () => {
      setFaultInjectionHooksForTesting({
        failNewPage: () => {
          throw new Error('Simulated newPage failure');
        },
      });

      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const p = service.renderDiagram({ source: 'graph TD; NewPageFail;', ownerId: 'np1' });
        await expect(p).rejects.toThrow();

        const npEvents = diagnosticEvents.filter((e) => e.stage === 'browser-new-page');
        expect(npEvents.length).toBeGreaterThan(0);
        expect(service.getActivePageCount()).toBe(0);

        // 復旧検証
        setFaultInjectionHooksForTesting(null);
        const res = await service.renderDiagram({
          source: 'graph TD; NewPageRecovered;',
          ownerId: 'np2',
        });
        expect(res.svg).toContain('NewPageRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('settles queued tasks when setRequestInterception fails, closes page, and recovers', async () => {
      setFaultInjectionHooksForTesting({
        failSetRequestInterception: () => {
          throw new Error('Simulated setRequestInterception failure');
        },
      });

      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const p = service.renderDiagram({ source: 'graph TD; InterceptFail;', ownerId: 'ic1' });
        await expect(p).rejects.toThrow();

        const icEvents = diagnosticEvents.filter((e) => e.stage === 'set-request-interception');
        expect(icEvents.length).toBeGreaterThan(0);

        setFaultInjectionHooksForTesting(null);
        const res = await service.renderDiagram({
          source: 'graph TD; InterceptRecovered;',
          ownerId: 'ic2',
        });
        expect(res.svg).toContain('InterceptRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('settles queued tasks when setContent fails, closes page, and recovers', async () => {
      setFaultInjectionHooksForTesting({
        failSetContent: () => {
          throw new Error('Simulated setContent failure');
        },
      });

      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const p = service.renderDiagram({ source: 'graph TD; SetContentFail;', ownerId: 'sc1' });
        await expect(p).rejects.toThrow();

        const scEvents = diagnosticEvents.filter((e) => e.stage === 'set-content');
        expect(scEvents.length).toBeGreaterThan(0);

        setFaultInjectionHooksForTesting(null);
        const res = await service.renderDiagram({
          source: 'graph TD; SetContentRecovered;',
          ownerId: 'sc2',
        });
        expect(res.svg).toContain('SetContentRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('settles queued tasks when addScriptTag fails, closes page, and recovers', async () => {
      setFaultInjectionHooksForTesting({
        failAddScriptTag: () => {
          throw new Error('Simulated addScriptTag failure');
        },
      });

      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const p = service.renderDiagram({ source: 'graph TD; AddScriptFail;', ownerId: 'as1' });
        await expect(p).rejects.toThrow();

        const asEvents = diagnosticEvents.filter((e) => e.stage === 'add-script-tag');
        expect(asEvents.length).toBeGreaterThan(0);

        setFaultInjectionHooksForTesting(null);
        const res = await service.renderDiagram({
          source: 'graph TD; AddScriptRecovered;',
          ownerId: 'as2',
        });
        expect(res.svg).toContain('AddScriptRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('detects unexpected page crash/close during execution and recovers pool on next task', async () => {
      let pageToCrash: { close: () => Promise<void> } | null = null;
      setNetworkProbeForTesting(async (page) => {
        if (!pageToCrash) {
          pageToCrash = page;
        }
      });

      const service = new DiagramRenderService({
        maxPages: 1,
        onTaskRunning: async (task) => {
          if (task.source.includes('CrashMe') && pageToCrash) {
            await pageToCrash.close().catch(() => {});
          }
        },
      });

      try {
        const p = service.renderDiagram({ source: 'graph TD; CrashMe;', ownerId: 'cr1' });
        await expect(p).rejects.toThrow();

        setNetworkProbeForTesting(null);
        const res = await service.renderDiagram({
          source: 'graph TD; PostCrashRecovered;',
          ownerId: 'cr2',
        });
        expect(res.svg).toContain('PostCrashRecovered');
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('reconstructs browser and pool automatically after browser disconnection', async () => {
      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        const res1 = await service.renderDiagram({
          source: 'graph TD; BeforeDisconnect;',
          ownerId: 'd1',
        });
        expect(res1.svg).toContain('BeforeDisconnect');

        await service.resetBrowser();

        const res2 = await service.renderDiagram({
          source: 'graph TD; AfterDisconnect;',
          ownerId: 'd2',
        });
        expect(res2.svg).toContain('AfterDisconnect');
        expect(service.getActivePageCount()).toBeLessThanOrEqual(1);
      } finally {
        await service.dispose();
      }
    }, 25_000);

    it('handles concurrent resetBrowser, updateBrowserPath, and dispose without unhandled rejections', async () => {
      const service = new DiagramRenderService({ maxPages: 1 });
      try {
        await service.renderDiagram({
          source: 'graph TD; PreRace;',
          ownerId: 'race-client',
        });

        // 並行実行
        await Promise.all([
          service.resetBrowser(),
          (async () => service.updateBrowserPath(undefined))(),
          service.dispose(),
        ]);

        // dispose後はリクエストが即座にサービス破棄エラーとなる
        await expect(
          service.renderDiagram({ source: 'graph TD; PostDispose;', ownerId: 'after-race' })
        ).rejects.toMatchObject({
          code: 'mermaid-service-disposed',
        });
      } finally {
        await service.dispose();
      }
    }, 20_000);

    it('safely settles all queued tasks and clears pool when dispose is called during pending page creation', async () => {
      const service = new DiagramRenderService({ maxPages: 2 });
      try {
        const p1 = service.renderDiagram({ source: 'graph TD; TaskA;', ownerId: 'ownerA' });
        const p2 = service.renderDiagram({ source: 'graph TD; TaskB;', ownerId: 'ownerB' });
        const resultsPromise = Promise.allSettled([p1, p2]);

        await service.dispose();

        const results = await resultsPromise;
        expect(results.length).toBe(2);
        expect(service.getActivePageCount()).toBe(0);
        expect(service.getQueueLength()).toBe(0);

        await expect(
          service.renderDiagram({ source: 'graph TD; AfterDispose;', ownerId: 'ownerC' })
        ).rejects.toMatchObject({
          code: 'mermaid-service-disposed',
        });
      } finally {
        await service.dispose();
      }
    }, 20_000);
  });
});
