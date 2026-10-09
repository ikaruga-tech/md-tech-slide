import * as crypto from 'node:crypto';
import type { SanitizedSvgResult } from './svg-sanitizer.js';

export interface DiagramCacheOptions {
  readonly maxItems?: number;
  readonly maxBytes?: number;
}

const DEFAULT_MAX_ITEMS = 64;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB

interface CacheEntry {
  readonly key: string;
  readonly result: SanitizedSvgResult;
  readonly byteLength: number;
}

export class DiagramCache {
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private currentBytes = 0;

  // Map maintains insertion/iteration order (LRU: oldest at start, newest at end)
  private readonly items = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<SanitizedSvgResult>>();

  constructor(options: DiagramCacheOptions = {}) {
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  public static createKey(
    source: string,
    normalizedConfig: string,
    theme: string,
    mermaidVersion: string
  ): string {
    const raw = `${source}\0${normalizedConfig}\0${theme}\0${mermaidVersion}`;
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  public get(key: string): SanitizedSvgResult | undefined {
    const entry = this.items.get(key);
    if (!entry) {
      return undefined;
    }
    // Re-insert to mark as most recently used
    this.items.delete(key);
    this.items.set(key, entry);
    return entry.result;
  }

  public set(key: string, result: SanitizedSvgResult): void {
    const byteLength = Buffer.byteLength(result.svg, 'utf8');

    // If single item exceeds maxBytes, do not cache
    if (byteLength > this.maxBytes) {
      return;
    }

    if (this.items.has(key)) {
      const existing = this.items.get(key)!;
      this.currentBytes -= existing.byteLength;
      this.items.delete(key);
    }

    // Evict oldest items if limits exceeded
    while (this.items.size >= this.maxItems || this.currentBytes + byteLength > this.maxBytes) {
      const oldestKey = this.items.keys().next().value;
      if (!oldestKey) {
        break;
      }
      const removed = this.items.get(oldestKey);
      if (removed) {
        this.currentBytes -= removed.byteLength;
        this.items.delete(oldestKey);
      }
    }

    this.items.set(key, { key, result, byteLength });
    this.currentBytes += byteLength;
  }

  public async getOrCompute(
    key: string,
    computeFn: () => Promise<SanitizedSvgResult>
  ): Promise<SanitizedSvgResult> {
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    const inFlightPromise = this.inFlight.get(key);
    if (inFlightPromise) {
      return inFlightPromise;
    }

    const computePromise = (async () => {
      try {
        const result = await computeFn();
        this.set(key, result);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, computePromise);
    return computePromise;
  }

  public get currentItemCount(): number {
    return this.items.size;
  }

  public get totalBytes(): number {
    return this.currentBytes;
  }

  public clear(): void {
    this.items.clear();
    this.inFlight.clear();
    this.currentBytes = 0;
  }
}
