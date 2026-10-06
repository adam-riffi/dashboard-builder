/** DESIGN.md §13: 60 queries per minute per user. */
export const QUERIES_PER_MINUTE = 60;

export type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * A fixed-window limiter keyed by user, counting queries rather than requests.
 * ponytail: per function instance; a shared store (Redis, DESIGN.md §4 v1.1) makes it global.
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const windows = new Map<string, { start: number; used: number }>();

  return {
    take(key: string, count: number): Take {
      const t = now();
      for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      const window = windows.get(key) ?? { start: t, used: 0 };
      if (window.used + count > limit) {
        return { ok: false, retryAfterSeconds: Math.ceil((window.start + windowMs - t) / 1000) };
      }
      window.used += count;
      windows.set(key, window);
      return { ok: true };
    },
    size: () => windows.size,
  };
}
