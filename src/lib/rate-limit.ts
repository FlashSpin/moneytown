/** Tiny in-memory fixed-window limiter. Per server instance, which is enough to stop casual abuse of paid endpoints. */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function takeToken(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
