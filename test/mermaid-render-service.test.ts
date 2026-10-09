import { describe, it, expect, afterAll } from 'vitest';
import { DiagramRenderService, DiagramRenderError } from '../src/diagram/mermaid-render-service.js';
import { resolveDeckDiagrams, hasPendingDiagrams } from '../src/diagram/index.js';
import { parseMarkdownToSlideDeck } from '../src/index.js';

describe('DiagramRenderService (Browser Pool E2E)', () => {
  const service = new DiagramRenderService();

  afterAll(async () => {
    await service.dispose();
  });

  it('renders standard diagrams (flowchart, sequence, class, state, ER, japanese, dark)', async () => {
    // 1. Flowchart
    const res1 = await service.renderDiagram({
      source: 'flowchart TD; A[開始]-->B[終了];',
      ownerId: 'test-diagrams',
    });
    expect(res1.svg).toContain('開始');
    expect(res1.svg).toContain('終了');
    expect(res1.viewBox.width).toBeGreaterThan(0);
    expect(res1.viewBox.height).toBeGreaterThan(0);

    // 2. Sequence diagram
    const res2 = await service.renderDiagram({
      source: 'sequenceDiagram\nAlice->>Bob: Hello',
      ownerId: 'test-diagrams',
    });
    expect(res2.svg).toContain('Alice');

    // 3. Class diagram
    const res3 = await service.renderDiagram({
      source: 'classDiagram\nAnimal <|-- Duck',
      ownerId: 'test-diagrams',
    });
    expect(res3.svg).toContain('Animal');

    // 4. State diagram
    const res4 = await service.renderDiagram({
      source: 'stateDiagram-v2\n[*] --> Still\nStill --> [*]',
      ownerId: 'test-diagrams',
    });
    expect(res4.svg).toContain('Still');
    expect(res4.viewBox.width).toBeGreaterThan(0);

    // 5. ER diagram
    const res5 = await service.renderDiagram({
      source: 'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      ownerId: 'test-diagrams',
    });
    expect(res5.svg).toContain('CUSTOMER');
    expect(res5.svg).toContain('ORDER');
    expect(res5.viewBox.width).toBeGreaterThan(0);

    // 6. Japanese characters & Dark theme
    const res6 = await service.renderDiagram({
      source: 'graph TD; 開始[日本語ノード]-->次[処理];',
      ownerId: 'test-diagrams',
      theme: 'dark',
    });
    expect(res6.svg).toContain('日本語ノード');
  }, 40_000);

  it('produces deterministic output with same inputs and cache', async () => {
    const source = 'graph TD; NodeA-->NodeB;';
    const r1 = await service.renderDiagram({ source, ownerId: 'det-1' });
    const r2 = await service.renderDiagram({ source, ownerId: 'det-2' });

    expect(r1.svg).toBe(r2.svg);
    expect(r1.viewBox).toEqual(r2.viewBox);
  }, 15_000);

  it('produces deterministic output across two independent service instances without cache', async () => {
    const source = 'flowchart TD; Step1-->Step2;';
    const svc1 = new DiagramRenderService();
    const svc2 = new DiagramRenderService();
    try {
      const r1 = await svc1.renderDiagram({ source, ownerId: 'inst-1' });
      const r2 = await svc2.renderDiagram({ source, ownerId: 'inst-2' });
      expect(r1.svg).toBe(r2.svg);
      expect(r1.viewBox).toEqual(r2.viewBox);
    } finally {
      await svc1.dispose();
      await svc2.dispose();
    }
  }, 30_000);

  it('cancels actively running execution using onTaskRunning synchronization point without corrupting pool', async () => {
    let runningHookCalled = false;
    let hookResolve: (() => void) | null = null;
    const hookPromise = new Promise<void>((r) => {
      hookResolve = r;
    });

    const targetService: DiagramRenderService = new DiagramRenderService({
      maxPages: 1,
      onTaskRunning: (task) => {
        if (task.ownerIds.includes('running-owner')) {
          runningHookCalled = true;
          // 確実にPage上でrunning状態になった同期点でcancelByOwnerを呼ぶ
          targetService.cancelByOwner('running-owner');
          hookResolve?.();
        }
      },
    });

    try {
      const p1 = targetService.renderDiagram({
        source: 'graph TD; RunningS-->RunningE;',
        ownerId: 'running-owner',
      });

      // フックが実行されたことを待機
      await hookPromise;
      expect(runningHookCalled).toBe(true);

      // 対象Promiseがmermaid-cancelledで拒否されること
      await expect(p1).rejects.toThrowError(DiagramRenderError);
      try {
        await p1;
      } catch (err: unknown) {
        expect((err as DiagramRenderError).code).toBe('mermaid-cancelled');
      }

      // 実行中だったPageが閉じられ、activePageCountが0またはプール補充準備状態であること
      expect(targetService.getRunningExecutionCount()).toBe(0);

      // 別ownerの後続要求が新しいPageで正常に成功すること（カウンター破損や二重settleがないこと）
      const p2 = await targetService.renderDiagram({
        source: 'graph TD; NextS-->NextE;',
        ownerId: 'subsequent-owner',
      });
      expect(p2.svg).toContain('NextS');
      expect(targetService.getActivePageCount()).toBeLessThanOrEqual(1);
    } finally {
      await targetService.dispose();
    }
  }, 25_000);

  it('merges in-flight identical key requests and allows per-owner partial cancellation', async () => {
    let hookResolve: (() => void) | null = null;
    const hookPromise = new Promise<void>((r) => {
      hookResolve = r;
    });

    const sharedService: DiagramRenderService = new DiagramRenderService({
      maxPages: 1,
      onTaskRunning: (task) => {
        if (task.ownerIds.includes('owner-A') && task.ownerIds.includes('owner-B')) {
          // 両方のownerが合流した状態でowner-Aのみキャンセル
          sharedService.cancelByOwner('owner-A');
          hookResolve?.();
        }
      },
    });

    try {
      const source = 'graph TD; SharedNodeA-->SharedNodeB;';
      const pA = sharedService.renderDiagram({ source, ownerId: 'owner-A' });
      const pB = sharedService.renderDiagram({ source, ownerId: 'owner-B' });

      await hookPromise;

      // owner-A のPromiseは mermaid-cancelled で拒否される
      await expect(pA).rejects.toThrowError(DiagramRenderError);
      try {
        await pA;
      } catch (err: unknown) {
        expect((err as DiagramRenderError).code).toBe('mermaid-cancelled');
      }

      // owner-B のPromiseは他ownerキャンセルに巻き込まれず正常終了する
      const resB = await pB;
      expect(resB.svg).toContain('SharedNodeA');

      // 正常完了した結果がキャッシュに保存されていること
      const cached = await sharedService.renderDiagram({ source, ownerId: 'owner-C' });
      expect(cached.svg).toBe(resB.svg);
    } finally {
      await sharedService.dispose();
    }
  }, 25_000);

  it('recovers from timeout within the EXACT same DiagramRenderService instance', async () => {
    // タイムアウト設定が変更可能な同一インスタンス
    const timeoutService = new DiagramRenderService({ maxPages: 1, timeoutMs: 1 });
    try {
      // 1. 意図的にタイムアウトを発生させる
      const timeoutPromise = timeoutService.renderDiagram({
        source: 'graph TD; T1-->T2;',
        ownerId: 'timeout-user',
      });
      await expect(timeoutPromise).rejects.toThrowError(DiagramRenderError);
      try {
        await timeoutPromise;
      } catch (err: unknown) {
        expect((err as DiagramRenderError).code).toBe('mermaid-render-timeout');
      }

      // タイムアウトPageが破棄され、activePageCountが回復していること
      expect(timeoutService.getRunningExecutionCount()).toBe(0);

      // 2. 同一サービスインスタンスでタイムアウトを本番規定値に戻す
      timeoutService.setTimeoutMs(10_000);

      // 3. 【同一サービス】において後続の正常リクエストが新しいPageで成功すること
      const normalRes = await timeoutService.renderDiagram({
        source: 'flowchart LR; RecoveredSameSvc1-->RecoveredSameSvc2;',
        ownerId: 'same-service-user',
      });
      expect(normalRes.svg).toContain('RecoveredSameSvc1');
      expect(timeoutService.getActivePageCount()).toBe(1);
    } finally {
      await timeoutService.dispose();
    }
  }, 25_000);

  it('rejects with mermaid-queue-full when queue exceeds capacity (32 items)', async () => {
    const tinyQueueService = new DiagramRenderService({ maxPages: 1, queueCapacity: 2 });
    try {
      const p1 = tinyQueueService.renderDiagram({ source: 'graph TD; Q1;', ownerId: 'q-test' });
      const p2 = tinyQueueService.renderDiagram({ source: 'graph TD; Q2;', ownerId: 'q-test' });
      const p3 = tinyQueueService.renderDiagram({ source: 'graph TD; Q3;', ownerId: 'q-test' });
      const p4 = tinyQueueService.renderDiagram({ source: 'graph TD; Q4;', ownerId: 'q-test' });

      // p1 is running, p2 and p3 fill the 2-capacity queue, p4 should reject immediately
      await expect(p4).rejects.toThrowError(DiagramRenderError);
      try {
        await p4;
      } catch (err: unknown) {
        expect((err as DiagramRenderError).code).toBe('mermaid-queue-full');
      }

      await Promise.allSettled([p1, p2, p3]);
    } finally {
      await tinyQueueService.dispose();
    }
  }, 20_000);

  it('throws mermaid-invalid-syntax on malformed Mermaid diagrams', async () => {
    const badSource = 'graph TD; A[broken --> B;';
    await expect(
      service.renderDiagram({ source: badSource, ownerId: 'bad-syntax' })
    ).rejects.toThrowError(DiagramRenderError);

    try {
      await service.renderDiagram({ source: badSource, ownerId: 'bad-syntax' });
    } catch (err: unknown) {
      expect((err as DiagramRenderError).code).toBe('mermaid-invalid-syntax');
    }
  }, 15_000);

  it('is safe against multiple dispose calls (idempotent) and rejects new requests', async () => {
    const tempService = new DiagramRenderService();
    await tempService.dispose();
    await tempService.dispose(); // Should not throw

    await expect(
      tempService.renderDiagram({ source: 'graph TD; A-->B;', ownerId: 'disposed' })
    ).rejects.toThrowError(DiagramRenderError);
  });

  it('resolves SlideDeck diagrams with resolveDeckDiagrams', async () => {
    const markdown = `# Title

\`\`\`mermaid
graph TD
    Start --> Stop
\`\`\`
`;
    const deck = parseMarkdownToSlideDeck(markdown);
    expect(hasPendingDiagrams(deck)).toBe(true);

    const resolvedDeck = await resolveDeckDiagrams(deck, service);
    expect(
      hasPendingDiagrams(resolvedDeck as unknown as Parameters<typeof hasPendingDiagrams>[0])
    ).toBe(false);

    const body = resolvedDeck.slides[0]!.slots.body;
    expect(body.type).toBe('single');
    if (body.type === 'single') {
      const diagram = body.elements[0]!;
      expect(diagram.type).toBe('diagram');
      if (diagram.type === 'diagram') {
        expect(diagram.status).toBe('success');
        expect(diagram.svg).toContain('Start');
        expect(diagram.viewBox?.width).toBeGreaterThan(0);
      }
    }
  }, 20_000);

  it('throws TypeError if resolveDeckDiagrams is called without service on pending deck', async () => {
    const markdown = `# Slide\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\``;
    const deck = parseMarkdownToSlideDeck(markdown);
    await expect(
      resolveDeckDiagrams(deck, undefined as unknown as DiagramRenderService)
    ).rejects.toThrowError(TypeError);
  });
});
