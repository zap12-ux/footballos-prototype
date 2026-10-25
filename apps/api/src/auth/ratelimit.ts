/** In-memory sliding-window limiter. Keys are opaque (e.g. `${ipHash}|${email}`). Resets on restart. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns `retryAfterSec` when the key is over the limit, otherwise null. Does not record a hit. */
  check(key: string): number | null {
    const t = this.now();
    const arr = this.prune(key, t);
    if (arr.length < this.max) return null;
    return Math.max(1, Math.ceil((arr[0]! + this.windowMs - t) / 1000));
  }

  hit(key: string): void {
    const t = this.now();
    const arr = this.prune(key, t);
    arr.push(t);
    this.hits.set(key, arr);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(key: string, t: number): number[] {
    const arr = (this.hits.get(key) ?? []).filter((h) => h > t - this.windowMs);
    if (arr.length === 0) this.hits.delete(key);
    else this.hits.set(key, arr);
    if (this.hits.size > 50_000) this.hits.clear(); // bounded memory; coarse but safe
    return arr;
  }
}
