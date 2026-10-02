import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DiagnosticLifecycleManager,
  type DisposableLike,
} from '../src/diagnostics/diagnostic-lifecycle.js';

describe('DiagnosticLifecycleManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('タイマー登録後にdisposeした場合、タイマーが進んでもコールバックは実行されない', () => {
    const manager = new DiagnosticLifecycleManager();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    manager.setDebounceTimer('doc1', callback1, 300);
    manager.setDebounceTimer('doc2', callback2, 500);

    expect(vi.getTimerCount()).toBe(2);

    manager.dispose();

    // dispose 後にタイマーを最後まで進める
    vi.runAllTimers();

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('登録された各Disposableがdispose時に1回ずつ破棄される', () => {
    const manager = new DiagnosticLifecycleManager();
    const disposable1: DisposableLike = { dispose: vi.fn() };
    const disposable2: DisposableLike = { dispose: vi.fn() };

    manager.registerDisposable(disposable1);
    manager.registerDisposable(disposable2);

    expect(disposable1.dispose).not.toHaveBeenCalled();
    expect(disposable2.dispose).not.toHaveBeenCalled();

    manager.dispose();

    expect(disposable1.dispose).toHaveBeenCalledTimes(1);
    expect(disposable2.dispose).toHaveBeenCalledTimes(1);
  });

  it('二重にdisposeを呼び出しても副作用が増えない（冪等性の担保）', () => {
    const manager = new DiagnosticLifecycleManager();
    const disposable: DisposableLike = { dispose: vi.fn() };

    manager.registerDisposable(disposable);

    manager.dispose();
    expect(disposable.dispose).toHaveBeenCalledTimes(1);

    // 2回目の dispose 呼び出し
    manager.dispose();
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('clearDebounceTimerで特定のタイマーのみ解除できる', () => {
    const manager = new DiagnosticLifecycleManager();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    manager.setDebounceTimer('doc1', callback1, 300);
    manager.setDebounceTimer('doc2', callback2, 500);

    manager.clearDebounceTimer('doc1');

    vi.advanceTimersByTime(400);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('dispose済みのmanagerに登録しようとしたリソースは即座に破棄される', () => {
    const manager = new DiagnosticLifecycleManager();
    manager.dispose();

    const disposable: DisposableLike = { dispose: vi.fn() };
    manager.registerDisposable(disposable);
    expect(disposable.dispose).toHaveBeenCalledTimes(1);

    const callback = vi.fn();
    manager.setDebounceTimer('doc', callback, 300);
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });
});
