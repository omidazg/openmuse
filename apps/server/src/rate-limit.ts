import type { Context } from "hono";

/** In-memory fixed-window counter per key (per API process). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** Counts one attempt; false when the key already used its allowance in this window. */
  take(key: string): boolean {
    const now = this.now();
    if (this.hits.size > 10000)
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}

/**
 * Client address. Caddy overwrites X-Real-IP with the visitor's address: the connecting one, or
 * the one a trusted ArvanCloud CDN edge reported in X-Forwarded-For. Without that header the last
 * X-Forwarded-For entry is the hop the proxy saw, and without a proxy the socket address.
 */
export function clientIp(c: Context): string {
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = c.req
    .header("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (forwarded) return forwarded;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}
