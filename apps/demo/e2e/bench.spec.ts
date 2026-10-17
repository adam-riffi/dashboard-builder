import { expect, test } from "@playwright/test";

// DESIGN.md §10, §13: gateway latency for the demo dashboard's query, uncached and cached, from
// the browser; the cached p95 must stay under 150 ms. `pnpm bench` runs only this.

const CACHED = 25;
const UNCACHED = 15; // with CACHED and the page's own queries, under 60 queries a minute (§13)

const percentile = (ms: number[], p: number) => {
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

test("gateway latency: cached p95 under 150 ms @bench", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  const timings = await page.evaluate(
    async ({ cached, uncached }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
      const token = JSON.parse(localStorage.getItem(key ?? "") ?? "{}").access_token;
      const ask = async (filters: unknown[]) => {
        const started = performance.now();
        const res = await fetch("/api/dash/query", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            queries: [{ dimensions: [], measures: [{ name: "Revenue" }], filters }],
            maxAgeSec: 60,
          }),
        });
        const body = await res.json();
        return { ms: performance.now() - started, cache: body.results[0]?.meta?.cache };
      };
      const misses = [];
      for (let i = 0; i < uncached; i++) {
        // A status no order has: a distinct query each time, so each one runs.
        misses.push(
          await ask([
            { field: "dash_demo.orders.status", op: "in", values: [`bench-${Date.now()}-${i}`] },
          ]),
        );
      }
      await ask([]); // fills the cache
      const hits = [];
      for (let i = 0; i < cached; i++) hits.push(await ask([]));
      return { misses, hits };
    },
    { cached: CACHED, uncached: UNCACHED },
  );
  const report = (name: string, rows: { ms: number }[]) => {
    const ms = rows.map((r) => r.ms);
    const line = `${name}: n=${ms.length} p50=${percentile(ms, 50).toFixed(0)} ms p95=${percentile(ms, 95).toFixed(0)} ms`;
    console.log(line);
    return percentile(ms, 95);
  };
  report("uncached", timings.misses);
  const cachedP95 = report("cached", timings.hits);
  expect(timings.hits.every((h) => h.cache === "hit")).toBe(true);
  expect(cachedP95).toBeLessThan(150);
});
