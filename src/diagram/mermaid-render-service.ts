import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagramCache } from './diagram-cache.js';
import { sanitizeSvg, SanitizeSvgError, type SanitizedSvgResult } from './svg-sanitizer.js';
import { resolveBrowserExecutable } from '../export/browser-finder.js';
import type { DiagramErrorCode } from '../types/ir.js';
import { getSafeDiagramErrorMessage } from './safe-error-message.js';
import {
  emitDiagnosticEvent,
  sanitizeDiagnosticReason,
  anonymizeOwnerId,
  registerDefaultDiagramServiceFactory,
  registerSnapshotProvider,
  getFaultInjectionHooks,
  getNetworkProbe,
  getNetworkDecisionObserver,
  incrementActiveServiceCount,
  decrementActiveServiceCount,
  incrementActiveBrowserCount,
  decrementActiveBrowserCount,
  getGlobalActiveBrowserCount,
  getGlobalActiveServiceCount,
  getLaunchArgsModifier,
  getSafeResourceMetrics,
  runWithLaunchAttemptContext,
  consumeLaunchDiagnostics,
  cleanupLaunchAttempt,
} from './internal-diagnostics.js';

export type { DiagramErrorCode };

export class DiagramRenderError extends Error {
  readonly code: DiagramErrorCode;

  constructor(code: DiagramErrorCode, _message?: string) {
    const safeMsg = getSafeDiagramErrorMessage(code);
    super(safeMsg);
    this.name = 'DiagramRenderError';
    this.code = code;
  }
}

export interface RenderDiagramRequest {
  readonly source: string;
  readonly ownerId: string;
  readonly theme?: 'light' | 'dark';
  readonly configId?: string;
}

interface TaskSubscriber {
  readonly ownerId: string;
  readonly resolve: (result: SanitizedSvgResult) => void;
  readonly reject: (error: unknown) => void;
}

interface QueuedTask {
  readonly id: string;
  readonly cacheKey: string;
  readonly source: string;
  readonly theme: 'light' | 'dark';
  readonly configId: string;
  subscribers: TaskSubscriber[];
}

interface RunningExecution {
  readonly task: QueuedTask;
  readonly page: Page;
  isCancelled: boolean;
}

export interface DiagramRenderServiceOptions {
  readonly maxPages?: number;
  readonly queueCapacity?: number;
  readonly timeoutMs?: number;
  readonly browserPath?: string;
  readonly fallbackBrowserPath?: string;
  readonly cache?: DiagramCache;
  /**
   * Test hook: called immediately when a task is picked from the queue and assigned
   * to a running page, before execution completes.
   */
  readonly onTaskRunning?: (task: {
    readonly id: string;
    readonly source: string;
    readonly ownerIds: readonly string[];
  }) => void | Promise<void>;
  /**
   * Test hook: called when any network request from a renderer page is intercepted and aborted.
   */
  readonly onRequestBlocked?: (url: string, resourceType: string) => void;
}

const DEFAULT_MAX_PAGES = 2;
const DEFAULT_QUEUE_CAPACITY = 32;
const DEFAULT_TIMEOUT_MS = 10_000;
const MERMAID_VERSION = '12.1.0';

let nextServiceInstanceId = 1;

export class DiagramRenderService {
  private readonly serviceId: string;
  private readonly maxPages: number;
  private readonly queueCapacity: number;
  private timeoutMs: number;
  private browserPath?: string;
  private fallbackBrowserPath?: string;
  private readonly onTaskRunning?: (task: {
    readonly id: string;
    readonly source: string;
    readonly ownerIds: readonly string[];
  }) => void | Promise<void>;
  private readonly onRequestBlocked?: (url: string, resourceType: string) => void;

  private readonly cache: DiagramCache;
  private readonly queue: QueuedTask[] = [];

  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private readonly pool: Page[] = [];
  private readonly pendingPageCreations = new Set<Promise<Page>>();
  private readonly runningExecutions = new Set<RunningExecution>();
  private activePageCount = 0;
  private isDisposed = false;

  private rendererBundleSource: string | null = null;
  private nextTaskId = 1;

  constructor(options: DiagramRenderServiceOptions = {}) {
    incrementActiveServiceCount();
    this.serviceId = `mermaid-service-${nextServiceInstanceId++}`;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.queueCapacity = options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.browserPath = options.browserPath;
    this.fallbackBrowserPath = options.fallbackBrowserPath;
    this.cache = options.cache ?? new DiagramCache();
    this.onTaskRunning = options.onTaskRunning;
    this.onRequestBlocked = options.onRequestBlocked;

    registerSnapshotProvider(this, () => ({
      serviceId: this.serviceId,
      activePageCount: this.activePageCount,
      runningExecutionCount: this.runningExecutions.size,
      queueLength: this.queue.length,
      isDisposed: this.isDisposed,
    }));

    emitDiagnosticEvent({
      stage: 'service-create',
      serviceId: this.serviceId,
      activePageCount: this.activePageCount,
      runningExecutionCount: this.runningExecutions.size,
      queueLength: this.queue.length,
    });
  }

  public setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  public updateBrowserPath(newPath?: string): void {
    this.browserPath = newPath;
    void this.resetBrowser();
  }

  public getActivePageCount(): number {
    return this.activePageCount;
  }

  public getRunningExecutionCount(): number {
    return this.runningExecutions.size;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public cancelByOwner(ownerId: string): void {
    emitDiagnosticEvent({
      stage: 'cancel',
      serviceId: this.serviceId,
      ownerId: anonymizeOwnerId(ownerId),
      sanitizedReason: 'Cancelled by owner',
      activePageCount: this.activePageCount,
      runningExecutionCount: this.runningExecutions.size,
      queueLength: this.queue.length,
    });

    // 1. 待機中キューの走査：ownerIdが一致するSubscriberを個別にreject
    const remainingQueue: QueuedTask[] = [];
    for (const task of this.queue) {
      const matchingSubs: TaskSubscriber[] = [];
      const keepingSubs: TaskSubscriber[] = [];
      for (const sub of task.subscribers) {
        if (sub.ownerId === ownerId) {
          matchingSubs.push(sub);
        } else {
          keepingSubs.push(sub);
        }
      }
      for (const sub of matchingSubs) {
        sub.reject(
          new DiagramRenderError('mermaid-cancelled', `Task cancelled for owner ${ownerId}`)
        );
      }
      if (keepingSubs.length > 0) {
        task.subscribers = keepingSubs;
        remainingQueue.push(task);
      }
    }
    this.queue.length = 0;
    this.queue.push(...remainingQueue);

    // 2. 実行中タスクの走査：ownerIdが一致するSubscriberを個別にreject
    for (const exec of Array.from(this.runningExecutions)) {
      if (exec.isCancelled) continue;
      const matchingSubs: TaskSubscriber[] = [];
      const keepingSubs: TaskSubscriber[] = [];
      for (const sub of exec.task.subscribers) {
        if (sub.ownerId === ownerId) {
          matchingSubs.push(sub);
        } else {
          keepingSubs.push(sub);
        }
      }
      for (const sub of matchingSubs) {
        sub.reject(
          new DiagramRenderError('mermaid-cancelled', `Task cancelled for owner ${ownerId}`)
        );
      }
      exec.task.subscribers = keepingSubs;

      // 全ての購読者がキャンセルされた場合のみ、実行中Pageを破棄して処理中断
      if (keepingSubs.length === 0) {
        exec.isCancelled = true;
        void exec.page.close().catch(() => {});
      }
    }
  }

  public async renderDiagram(request: RenderDiagramRequest): Promise<SanitizedSvgResult> {
    if (this.isDisposed) {
      throw new DiagramRenderError(
        'mermaid-service-disposed',
        'DiagramRenderService has been disposed.'
      );
    }

    const trimmedSource = request.source.trim();
    if (trimmedSource.length === 0) {
      throw new DiagramRenderError('mermaid-empty-source', 'Mermaid diagram source is empty.');
    }

    const theme = request.theme ?? 'light';
    const configId = request.configId ?? 'strict-default';

    const cacheKey = DiagramCache.createKey(request.source, configId, theme, MERMAID_VERSION);

    // 1. キャッシュヒット
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. 待機中キューの合流確認
    const queuedTask = this.queue.find((t) => t.cacheKey === cacheKey);
    if (queuedTask) {
      return new Promise<SanitizedSvgResult>((resolve, reject) => {
        queuedTask.subscribers.push({ ownerId: request.ownerId, resolve, reject });
      });
    }

    // 3. 実行中タスクの合流確認
    for (const exec of this.runningExecutions) {
      if (exec.task.cacheKey === cacheKey && !exec.isCancelled) {
        return new Promise<SanitizedSvgResult>((resolve, reject) => {
          exec.task.subscribers.push({ ownerId: request.ownerId, resolve, reject });
        });
      }
    }

    // 4. 新規タスク作成とキュー追加
    if (this.queue.length >= this.queueCapacity) {
      throw new DiagramRenderError(
        'mermaid-queue-full',
        `Diagram render queue capacity exceeded (max ${this.queueCapacity})`
      );
    }

    return new Promise<SanitizedSvgResult>((resolve, reject) => {
      const task: QueuedTask = {
        id: `mermaid-diagram-${this.nextTaskId++}`,
        cacheKey,
        source: request.source,
        theme,
        configId,
        subscribers: [{ ownerId: request.ownerId, resolve, reject }],
      };
      this.queue.push(task);
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isDisposed || this.queue.length === 0) {
      return;
    }

    // Try to get a page from the pool or allocate a new page if under capacity and tasks are waiting
    let page: Page | null = null;
    if (this.pool.length > 0) {
      page = this.pool.pop()!;
    } else if (
      this.activePageCount < this.maxPages &&
      this.queue.length > this.runningExecutions.size
    ) {
      this.activePageCount = Math.min(this.maxPages, this.activePageCount + 1);
      const pagePromise = this.acquireNewPage();
      this.pendingPageCreations.add(pagePromise);
      try {
        page = await pagePromise;
      } catch (err) {
        this.activePageCount = Math.max(0, this.activePageCount - 1);
        if (this.isDisposed) {
          return;
        }
        // If acquiring browser/page fails and no other pages are active/busy, reject pending tasks
        if (this.activePageCount === 0 && this.pool.length === 0) {
          const wrappedErr = this.wrapError(err);
          while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
              for (const sub of task.subscribers) {
                sub.reject(wrappedErr);
              }
            }
          }
        }
        return;
      } finally {
        this.pendingPageCreations.delete(pagePromise);
      }
    }

    if (!page) {
      return; // All pages are busy; waiting for a worker to finish
    }

    if (this.isDisposed) {
      void page.close().catch(() => {});
      this.activePageCount = Math.max(0, this.activePageCount - 1);
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      this.pool.push(page);
      return;
    }

    const execution: RunningExecution = {
      task,
      page,
      isCancelled: false,
    };
    this.runningExecutions.add(execution);

    // Call test synchronization hook if provided
    if (this.onTaskRunning) {
      try {
        await this.onTaskRunning({
          id: task.id,
          source: task.source,
          ownerIds: task.subscribers.map((s) => s.ownerId),
        });
      } catch {
        // Ignore test hook errors
      }
    }

    // If cancelled during the hook (e.g. all subscribers unsubscribed)
    if (execution.isCancelled || task.subscribers.length === 0) {
      this.runningExecutions.delete(execution);
      try {
        await page.close().catch(() => {});
      } finally {
        this.activePageCount = Math.max(0, this.activePageCount - 1);
      }
      if (this.queue.length > 0) {
        void this.processQueue();
      }
      return;
    }

    let shouldDiscardPage = false;
    let timeoutTimer: NodeJS.Timeout | null = null;

    emitDiagnosticEvent({
      stage: 'task-start',
      serviceId: this.serviceId,
      taskId: task.id,
      ownerId: anonymizeOwnerId(task.subscribers[0]?.ownerId),
      activePageCount: this.activePageCount,
      runningExecutionCount: this.runningExecutions.size,
      queueLength: this.queue.length,
    });

    try {
      const renderPromise = this.executeRenderOnPage(page, task);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          shouldDiscardPage = true;
          emitDiagnosticEvent({
            stage: 'timeout',
            serviceId: this.serviceId,
            ownerId: anonymizeOwnerId(task.subscribers[0]?.ownerId),
            taskId: task.id,
            sanitizedReason: `Mermaid rendering timed out after ${this.timeoutMs}ms`,
            activePageCount: this.activePageCount,
            runningExecutionCount: this.runningExecutions.size,
            queueLength: this.queue.length,
          });
          reject(
            new DiagramRenderError(
              'mermaid-render-timeout',
              `Mermaid rendering timed out after ${this.timeoutMs}ms.`
            )
          );
        }, this.timeoutMs);
      });

      const rawSvg = await Promise.race([renderPromise, timeoutPromise]);
      if (!execution.isCancelled) {
        let sanitized: SanitizedSvgResult;
        try {
          sanitized = sanitizeSvg(rawSvg);
        } catch (sanitizeErr) {
          emitDiagnosticEvent({
            stage: 'svg-sanitize',
            serviceId: this.serviceId,
            ownerId: anonymizeOwnerId(task.subscribers[0]?.ownerId),
            taskId: task.id,
            sanitizedReason: sanitizeDiagnosticReason(sanitizeErr),
            activePageCount: this.activePageCount,
            runningExecutionCount: this.runningExecutions.size,
            queueLength: this.queue.length,
          });
          throw sanitizeErr;
        }

        // キャッシュに保存
        this.cache.set(task.cacheKey, sanitized);
        // 残存する全購読者に成功結果を通知
        for (const sub of task.subscribers) {
          sub.resolve(sanitized);
        }
      }
    } catch (err) {
      if (!execution.isCancelled) {
        const wrapped = this.wrapError(err);
        // 失敗・エラー結果はキャッシュせず、残存購読者に通知
        for (const sub of task.subscribers) {
          sub.reject(wrapped);
        }
      }
    } finally {
      emitDiagnosticEvent({
        stage: 'task-settle',
        serviceId: this.serviceId,
        taskId: task.id,
        ownerId: anonymizeOwnerId(task.subscribers[0]?.ownerId),
        activePageCount: this.activePageCount,
        runningExecutionCount: this.runningExecutions.size,
        queueLength: this.queue.length,
      });

      this.runningExecutions.delete(execution);
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }

      if (shouldDiscardPage || execution.isCancelled || page.isClosed()) {
        try {
          await page.close().catch(() => {});
        } finally {
          this.activePageCount = Math.max(0, this.activePageCount - 1);
        }
      } else {
        this.pool.push(page);
      }

      // Continue processing remaining queue items
      if (this.queue.length > 0) {
        void this.processQueue();
      }
    }
  }

  private async executeRenderOnPage(page: Page, task: QueuedTask): Promise<string> {
    try {
      const result = await page.evaluate(
        async (diagramId: string, text: string, theme: 'light' | 'dark') => {
          const win = window as unknown as {
            __mermaidRenderer?: {
              renderDiagram: (
                id: string,
                source: string,
                t: 'light' | 'dark'
              ) => Promise<{ svg: string }>;
            };
          };
          const renderer = win.__mermaidRenderer;
          if (!renderer) {
            throw new Error('Mermaid renderer bundle is not loaded in browser.');
          }
          const res = await renderer.renderDiagram(diagramId, text, theme);
          return res.svg;
        },
        task.id,
        task.source,
        task.theme
      );

      if (typeof result !== 'string' || result.trim().length === 0) {
        throw new DiagramRenderError(
          'mermaid-render-failed',
          'Empty SVG returned from browser renderer.'
        );
      }

      return result;
    } catch (err: unknown) {
      emitDiagnosticEvent({
        stage: 'page-evaluate',
        serviceId: this.serviceId,
        ownerId: anonymizeOwnerId(task.subscribers[0]?.ownerId),
        taskId: task.id,
        sanitizedReason: sanitizeDiagnosticReason(err),
        activePageCount: this.activePageCount,
        runningExecutionCount: this.runningExecutions.size,
        queueLength: this.queue.length,
      });

      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('Parse error') ||
        message.includes('Syntax error') ||
        message.includes('Lexical error') ||
        message.includes('Diagram error') ||
        message.includes('UnknownDiagramError')
      ) {
        throw new DiagramRenderError('mermaid-invalid-syntax', message);
      }
      throw err;
    }
  }

  private async acquireNewPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    let page: Page | null = null;

    try {
      const hooks = getFaultInjectionHooks();
      if (hooks?.failNewPage) {
        emitDiagnosticEvent({
          stage: 'browser-new-page',
          serviceId: this.serviceId,
          sanitizedReason: 'Injected newPage failure',
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        await hooks.failNewPage();
      }

      try {
        page = await browser.newPage();
      } catch (err) {
        emitDiagnosticEvent({
          stage: 'browser-new-page',
          serviceId: this.serviceId,
          sanitizedReason: sanitizeDiagnosticReason(err),
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        throw err;
      }

      if (hooks?.failSetRequestInterception) {
        emitDiagnosticEvent({
          stage: 'set-request-interception',
          serviceId: this.serviceId,
          sanitizedReason: 'Injected setRequestInterception failure',
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        await hooks.failSetRequestInterception();
      }

      try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const urlStr = req.url();
          const rType = req.resourceType();
          const protocol = urlStr.startsWith('https:')
            ? 'https:'
            : urlStr.startsWith('http:')
              ? 'http:'
              : 'other';
          let urlCategory: 'http' | 'https' | 'image' | 'font' | 'other' = 'other';
          if (rType === 'image' || urlStr.match(/\.(png|jpg|jpeg|gif|svg|webp)($|\?)/i)) {
            urlCategory = 'image';
          } else if (rType === 'font' || urlStr.match(/\.(woff2?|ttf|otf|eot)($|\?)/i)) {
            urlCategory = 'font';
          } else if (protocol === 'https:') {
            urlCategory = 'https';
          } else if (protocol === 'http:') {
            urlCategory = 'http';
          }

          const decision: 'abort' | 'continue' | 'respond' = 'abort';
          const abortReason = 'blockedbyclient';

          getNetworkDecisionObserver()?.({
            urlCategory,
            resourceType: rType,
            protocol,
            decision,
            abortReason,
            url: urlStr,
          });

          this.onRequestBlocked?.(urlStr, rType);
          void req.abort(abortReason);
        });
      } catch (err) {
        emitDiagnosticEvent({
          stage: 'set-request-interception',
          serviceId: this.serviceId,
          sanitizedReason: sanitizeDiagnosticReason(err),
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        throw err;
      }

      if (hooks?.failSetContent) {
        emitDiagnosticEvent({
          stage: 'set-content',
          serviceId: this.serviceId,
          sanitizedReason: 'Injected setContent failure',
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        await hooks.failSetContent();
      }

      try {
        await page.setContent(
          '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="connect-src http: https: data:; font-src http: https: data:; img-src http: https: data:;"></head><body><div id="container"></div></body></html>',
          {
            waitUntil: 'domcontentloaded',
          }
        );
      } catch (err) {
        emitDiagnosticEvent({
          stage: 'set-content',
          serviceId: this.serviceId,
          sanitizedReason: sanitizeDiagnosticReason(err),
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        throw err;
      }

      if (hooks?.failAddScriptTag) {
        emitDiagnosticEvent({
          stage: 'add-script-tag',
          serviceId: this.serviceId,
          sanitizedReason: 'Injected addScriptTag failure',
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
        });
        await hooks.failAddScriptTag();
      }

      try {
        const bundleSource = this.getRendererBundleSource();
        await page.addScriptTag({ content: bundleSource });
      } catch (err) {
        if (!this.isDisposed || !String(err).includes('Target closed')) {
          emitDiagnosticEvent({
            stage: 'add-script-tag',
            serviceId: this.serviceId,
            sanitizedReason: sanitizeDiagnosticReason(err),
            activePageCount: this.activePageCount,
            runningExecutionCount: this.runningExecutions.size,
            queueLength: this.queue.length,
          });
        }
        throw err;
      }

      const probe = getNetworkProbe();
      if (probe) {
        await probe(page);
      }

      return page;
    } catch (err) {
      if (page && !page.isClosed()) {
        try {
          await page.close().catch(() => {});
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  private getRendererBundleSource(): string {
    if (this.rendererBundleSource) {
      return this.rendererBundleSource;
    }

    let bundlePath: string;
    if (typeof __dirname !== 'undefined') {
      bundlePath = path.resolve(__dirname, 'mermaid-renderer.js');
      if (!fs.existsSync(bundlePath)) {
        bundlePath = path.resolve(__dirname, '../../dist/mermaid-renderer.js');
      }
    } else {
      const currentFilePath = import.meta.url ? fileURLToPath(import.meta.url) : process.cwd();
      bundlePath = path.resolve(path.dirname(currentFilePath), '../../dist/mermaid-renderer.js');
    }

    if (!fs.existsSync(bundlePath)) {
      // Fallback for development / test directory structures
      const candidatePaths = [
        path.resolve(process.cwd(), 'dist/mermaid-renderer.js'),
        path.resolve(process.cwd(), 'md-tech-slide/dist/mermaid-renderer.js'),
      ];
      const found = candidatePaths.find((p) => fs.existsSync(p));
      if (!found) {
        throw new DiagramRenderError('mermaid-render-failed');
      }
      bundlePath = found;
    }

    this.rendererBundleSource = fs.readFileSync(bundlePath, 'utf8');
    return this.rendererBundleSource;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      const resolution = resolveBrowserExecutable(this.browserPath, this.fallbackBrowserPath);
      if ('error' in resolution) {
        emitDiagnosticEvent({
          stage: 'browser-executable-resolve',
          serviceId: this.serviceId,
          sanitizedReason: sanitizeDiagnosticReason(resolution.message),
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
          activeBrowserCount: getGlobalActiveBrowserCount(),
          activeServiceCount: getGlobalActiveServiceCount(),
        });
        throw new DiagramRenderError(resolution.error);
      }

      let executableKind: 'system-chrome' | 'system-edge' | 'custom-path' | 'env-path' | 'unknown' =
        'unknown';
      if (this.browserPath) {
        executableKind = 'custom-path';
      } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        executableKind = 'env-path';
      } else if (
        resolution.executablePath.includes('Edge') ||
        resolution.executablePath.includes('edge')
      ) {
        executableKind = 'system-edge';
      } else if (
        resolution.executablePath.includes('Chrome') ||
        resolution.executablePath.includes('chrome') ||
        resolution.executablePath.includes('chromium')
      ) {
        executableKind = 'system-chrome';
      }

      const hooks = getFaultInjectionHooks();
      if (hooks?.failLaunch) {
        emitDiagnosticEvent({
          stage: 'puppeteer-launch',
          serviceId: this.serviceId,
          sanitizedReason: 'Injected launch failure',
          executableKind,
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
          activeBrowserCount: getGlobalActiveBrowserCount(),
          activeServiceCount: getGlobalActiveServiceCount(),
        });
        await hooks.failLaunch();
      }

      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-extensions',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--mute-audio',
      ];

      let finalArgs = [...launchArgs];
      const modifier = getLaunchArgsModifier();
      if (modifier) {
        finalArgs = modifier(finalArgs);
      }

      emitDiagnosticEvent({
        stage: 'browser-launch-start',
        serviceId: this.serviceId,
        executableKind,
        activePageCount: this.activePageCount,
        runningExecutionCount: this.runningExecutions.size,
        queueLength: this.queue.length,
      });

      return await runWithLaunchAttemptContext(async (attemptId) => {
        const attemptStartTime = Date.now();
        try {
          const browser = await puppeteer.launch({
            headless: true,
            executablePath: resolution.executablePath,
            args: finalArgs,
          });

          // Discard attempt state upon success
          cleanupLaunchAttempt(attemptId);

          browser.on('disconnected', () => {
            emitDiagnosticEvent({
              stage: 'page-or-browser-close',
              serviceId: this.serviceId,
              sanitizedReason: 'Browser emitted disconnected event',
              activePageCount: this.activePageCount,
              runningExecutionCount: this.runningExecutions.size,
              queueLength: this.queue.length,
              activeBrowserCount: getGlobalActiveBrowserCount(),
              activeServiceCount: getGlobalActiveServiceCount(),
            });
            void this.resetBrowser();
          });

          incrementActiveBrowserCount();
          this.browser = browser;

          emitDiagnosticEvent({
            stage: 'browser-launch-success',
            serviceId: this.serviceId,
            browserPid: browser.process()?.pid,
            executableKind,
            activePageCount: this.activePageCount,
            runningExecutionCount: this.runningExecutions.size,
            queueLength: this.queue.length,
          });

          return browser;
        } catch (err: unknown) {
          const launchDiag = consumeLaunchDiagnostics(attemptId);
          const elapsedMs = Date.now() - attemptStartTime;
          const resourceMetrics = getSafeResourceMetrics();

          emitDiagnosticEvent({
            stage: 'puppeteer-launch',
            serviceId: this.serviceId,
            sanitizedReason: sanitizeDiagnosticReason(err),
            executableKind,
            activePageCount: this.activePageCount,
            runningExecutionCount: this.runningExecutions.size,
            queueLength: this.queue.length,
            activeBrowserCount: getGlobalActiveBrowserCount(),
            activeServiceCount: getGlobalActiveServiceCount(),
            launchAttempt: 1,
            elapsedMs,
            spawned: launchDiag?.spawned ?? false,
            childPid: launchDiag !== undefined ? launchDiag.childPid : 'unavailable',
            exitCode: launchDiag !== undefined ? launchDiag.exitCode : 'unavailable',
            signal: launchDiag !== undefined ? launchDiag.signal : 'unavailable',
            stderrCategory: launchDiag?.stderrCategory ?? 'unknown',
            resourceMetrics,
          });

          throw new DiagramRenderError('mermaid-render-failed');
        } finally {
          cleanupLaunchAttempt(attemptId);
        }
      });
    })().finally(() => {
      this.browserPromise = null;
    });

    return this.browserPromise;
  }

  public async resetBrowser(): Promise<void> {
    this.pool.length = 0;
    this.activePageCount = 0;

    // Settle in-flight page creations before closing browser
    if (this.pendingPageCreations.size > 0) {
      await Promise.allSettled(Array.from(this.pendingPageCreations));
    }

    if (this.browser) {
      const b = this.browser;
      this.browser = null;
      decrementActiveBrowserCount();
      emitDiagnosticEvent({
        stage: 'browser-close',
        serviceId: this.serviceId,
        browserPid: b.process()?.pid,
        sanitizedReason: 'Browser closed normally',
        activePageCount: this.activePageCount,
        runningExecutionCount: this.runningExecutions.size,
        queueLength: this.queue.length,
      });
      try {
        await b.close().catch(() => {});
      } catch (err) {
        emitDiagnosticEvent({
          stage: 'page-or-browser-close',
          serviceId: this.serviceId,
          sanitizedReason: sanitizeDiagnosticReason(err),
          activePageCount: this.activePageCount,
          runningExecutionCount: this.runningExecutions.size,
          queueLength: this.queue.length,
          activeBrowserCount: getGlobalActiveBrowserCount(),
          activeServiceCount: getGlobalActiveServiceCount(),
        });
      }
    }
  }

  private wrapError(err: unknown): DiagramRenderError {
    if (err instanceof DiagramRenderError) {
      return err;
    }
    if (err instanceof SanitizeSvgError) {
      return new DiagramRenderError(
        'mermaid-output-unsafe',
        getSafeDiagramErrorMessage('mermaid-output-unsafe')
      );
    }
    if (err instanceof Error) {
      const message = err.message;
      if (
        message.includes('Parse error') ||
        message.includes('Syntax error') ||
        message.includes('Lexical error') ||
        message.includes('UnknownDiagramError')
      ) {
        return new DiagramRenderError(
          'mermaid-invalid-syntax',
          getSafeDiagramErrorMessage('mermaid-invalid-syntax')
        );
      }
    }
    return new DiagramRenderError(
      'mermaid-render-failed',
      getSafeDiagramErrorMessage('mermaid-render-failed')
    );
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    decrementActiveServiceCount();

    emitDiagnosticEvent({
      stage: 'service-dispose',
      serviceId: this.serviceId,
      sanitizedReason: 'DiagramRenderService disposed',
      activePageCount: this.activePageCount,
      runningExecutionCount: this.runningExecutions.size,
      queueLength: this.queue.length,
      activeBrowserCount: getGlobalActiveBrowserCount(),
      activeServiceCount: getGlobalActiveServiceCount(),
    });

    // Reject all queued tasks
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        for (const sub of task.subscribers) {
          sub.reject(
            new DiagramRenderError(
              'mermaid-service-disposed',
              getSafeDiagramErrorMessage('mermaid-service-disposed')
            )
          );
        }
      }
    }

    this.cache.clear();
    await this.resetBrowser();
  }
}

registerDefaultDiagramServiceFactory((options) => new DiagramRenderService(options));
