export interface DisposableLike {
  dispose(): void;
}

/**
 * DiagnosticProviderにおけるタイマーおよび破棄対象オブジェクトの
 * ライフサイクル管理を行うVS Code非依存のヘルパークラス。
 */
export class DiagnosticLifecycleManager {
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposables: DisposableLike[] = [];
  private isDisposed = false;

  /**
   * 破棄対象のリソースを登録します。
   */
  public registerDisposable(disposable: DisposableLike): void {
    if (this.isDisposed) {
      disposable.dispose();
      return;
    }
    this.disposables.push(disposable);
  }

  /**
   * 指定したキーのデバウンスタイマーを登録します。
   * 既にタイマーが存在する場合は既存タイマーを解除して再スケジュールします。
   */
  public setDebounceTimer(key: string, callback: () => void, delayMs: number): void {
    if (this.isDisposed) {
      return;
    }

    this.clearDebounceTimer(key);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      callback();
    }, delayMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * 指定したキーのデバウンスタイマーを解除します。
   */
  public clearDebounceTimer(key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(key);
    }
  }

  /**
   * 管理対象のタイマーをすべて解除し、登録されたすべてのリソースを破棄します。
   * 複数回呼び出されても副作用が増加しない冪等性を持ちます。
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    const targets = this.disposables;
    this.disposables = [];
    for (const target of targets) {
      target.dispose();
    }
  }
}
