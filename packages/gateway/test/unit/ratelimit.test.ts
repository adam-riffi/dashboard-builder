import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/ratelimit.ts";

describe("createRateLimiter", () => {
  const clock = (start = 0) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("allows up to the limit per user per window, counting every query", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 60, windowMs: 60_000, now: time.now });
    expect(limiter.take("a", 20)).toEqual({ ok: true });
    expect(limiter.take("a", 40)).toEqual({ ok: true });
    time.advance(15_000);
    expect(limiter.take("a", 1)).toEqual({ ok: false, retryAfterSeconds: 45 });
  });

  it("keeps users apart and starts afresh in the next window", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: time.now });
    expect(limiter.take("a", 2)).toEqual({ ok: true });
    expect(limiter.take("b", 2)).toEqual({ ok: true });
    expect(limiter.take("a", 1).ok).toBe(false);
    time.advance(1_000);
    expect(limiter.take("a", 2)).toEqual({ ok: true });
  });

  it("rejects a batch larger than the remaining allowance without spending it", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000, now: clock().now });
    expect(limiter.take("a", 3).ok).toBe(true);
    expect(limiter.take("a", 3).ok).toBe(false);
    expect(limiter.take("a", 2).ok).toBe(true);
  });

  it("forgets users whose window has passed", () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: time.now });
    for (let i = 0; i < 100; i++) limiter.take(`user-${i}`, 1);
    time.advance(1_000);
    limiter.take("late", 1);
    expect(limiter.size()).toBe(1);
  });
});
