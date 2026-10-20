import { planJoins, type QuerySpec, querySpec, validateQuery } from "@adam-riffi/dash-core";
import fc from "fast-check";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferContract } from "../../src/contract/index.ts";
import { introspect } from "../../src/contract/introspect.ts";
import { compileQuery, type Policy } from "../../src/query/compile.ts";
import { executeQuery } from "../../src/query/execute.ts";

// PREVIOUSPERIOD and RUNNINGSUM against what the plain measure says (ADR 0013): each bucket's
// previous period is the plain value one grain earlier, its running sum the plain values so far.
const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
  throw new Error("Refusing to create fixture schemas outside a local database");
}
const admin = postgres(adminUrl, { onnotice: () => {} });
const tables = ["fx_time.sales"];
let contract: ReturnType<typeof inferContract>;

beforeAll(async () => {
  // 300 sales over half a year on about half of its days (squares modulo 181), so that
  // daily buckets have gaps.
  await admin.unsafe(`
    drop schema if exists fx_time cascade;
    create schema fx_time;
    create table fx_time.sales (
      id int primary key, region text not null, amount numeric(10, 2) not null,
      sold_at timestamptz not null, channel text not null, tenant_id int not null
    );
    insert into fx_time.sales
    select g, (array['north', 'south', 'east'])[1 + g % 3], (g * 37) % 100,
      timestamptz '2026-01-01' + ((g * g) % 181) * interval '1 day' + (g % 24) * interval '1 hour',
      (array['web', 'store'])[1 + g % 2], 1 + g % 4
    from generate_series(1, 300) g;
  `);
  contract = inferContract(await introspect(admin, tables), { tables });
});

afterAll(() => admin.end());

async function run(
  spec: Partial<QuerySpec> & Pick<QuerySpec, "measures">,
  scope: Record<string, unknown> = {},
  policies: Policy[] = [],
) {
  const valid = validateQuery(querySpec.parse(spec), contract);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const plan = planJoins(valid.query, contract);
  if (!plan.ok) throw new Error(plan.errors.join("; "));
  const compiled = compileQuery(valid.query, plan.plan, policies, scope);
  if (!compiled.ok) throw new Error(compiled.errors.join("; "));
  return executeQuery(admin, compiled.query, { limit: valid.query.limit, settings: {} });
}

const STEP = { day: [0, 1], week: [0, 7], month: [1, 0] } as const;
/** The start of the bucket one grain before `iso`, in UTC. */
function earlier(iso: string, grain: keyof typeof STEP): string {
  const d = new Date(iso);
  const [months, days] = STEP[grain];
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const amount = "SUM(sales.amount)";
const soldAt = "fx_time.sales.sold_at";

describe("PREVIOUSPERIOD and RUNNINGSUM against the plain measure", () => {
  it.each([
    ["day", false],
    ["week", false],
    ["month", false],
    ["day", true],
    ["month", true],
  ] as const)("agree with it by %s (per region: %s)", async (grain, perRegion) => {
    const dimensions = [
      ...(perRegion ? [{ field: "fx_time.sales.region" }] : []),
      { field: soldAt, timeGrain: grain },
    ];
    const plain = await run({ dimensions, measures: [{ formula: amount }] });
    const timed = await run({
      dimensions,
      measures: [
        { formula: amount },
        { formula: `PREVIOUSPERIOD(${amount})` },
        { formula: `RUNNINGSUM(${amount})` },
      ],
    });
    const t = perRegion ? 1 : 0;
    const v = t + 1;
    const keyOf = (data: unknown[][], row: number, bucket: string) =>
      `${perRegion ? data[0]?.[row] : ""}|${bucket}`;
    const plainAt = new Map<string, number>();
    plain.data[t]?.forEach((bucket, row) => {
      plainAt.set(keyOf(plain.data, row, String(bucket)), Number(plain.data[v]?.[row]));
    });
    const running = new Map<string, number>();
    timed.data[t]?.forEach((bucket, row) => {
      const region = perRegion ? String(timed.data[0]?.[row]) : "";
      const value = Number(timed.data[v]?.[row]);
      expect(value).toBe(plainAt.get(keyOf(timed.data, row, String(bucket))));
      const previous = plainAt.get(`${region}|${earlier(String(bucket), grain)}`) ?? null;
      const before = timed.data[v + 1]?.[row];
      expect(before === null ? null : Number(before)).toBe(previous);
      const sum = (running.get(region) ?? 0) + value;
      running.set(region, sum);
      expect(Number(timed.data[v + 2]?.[row])).toBeCloseTo(sum, 6);
    });
    expect(timed.data[t]?.length).toBe(plain.data[t]?.length);
  });

  it("reads the period before a date filter's window", async () => {
    const plain = await run({
      dimensions: [{ field: soldAt, timeGrain: "month" }],
      measures: [{ formula: amount }],
    });
    const filtered = await run({
      dimensions: [{ field: soldAt, timeGrain: "month" }],
      measures: [{ formula: `PREVIOUSPERIOD(${amount})` }],
      filters: [{ field: soldAt, op: "gte", values: ["2026-03-01"] }],
    });
    // March's previous period is February, outside the filter but still read.
    expect(filtered.data[0]?.[0]).toBe("2026-03-01T00:00:00.000Z");
    expect(Number(filtered.data[1]?.[0])).toBe(Number(plain.data[1]?.[1]));
  });

  it("leaves the previous period empty when that bucket has no rows (no lag across gaps)", async () => {
    const days = await run({
      dimensions: [{ field: soldAt, timeGrain: "day" }],
      measures: [{ formula: `PREVIOUSPERIOD(${amount})` }],
    });
    const buckets = (days.data[0] ?? []).map(String);
    const gapped = buckets.findIndex(
      (bucket, row) => row > 0 && !buckets.includes(earlier(bucket, "day")),
    );
    expect(gapped).toBeGreaterThan(0);
    expect(days.data[1]?.[gapped]).toBeNull();
  });
});

describe("CALCULATE and ALL against the plain measure (M10 review)", () => {
  const values = { region: ["north", "south", "east"], channel: ["web", "store"] } as const;

  it("CALCULATE equals the measure with its condition as a query filter", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("region", "channel"),
        fc.constantFrom(...values.region),
        fc.constantFrom(...values.channel),
        async (by, region, channel) => {
          const [field, value] = by === "region" ? ["channel", channel] : ["region", region];
          const dimensions = [{ field: `fx_time.sales.${by}` }];
          const calculated = await run({
            dimensions,
            measures: [{ formula: `CALCULATE(${amount}, sales.${field} = "${value}")` }],
          });
          const filtered = await run({
            dimensions,
            measures: [{ formula: amount }],
            filters: [{ field: `fx_time.sales.${field}`, op: "in", values: [value] }],
          });
          const expected = new Map(
            (filtered.data[0] ?? []).map((k, i) => [k, Number(filtered.data[1]?.[i])]),
          );
          (calculated.data[0] ?? []).forEach((k, i) => {
            const v = calculated.data[1]?.[i];
            expect(v === null ? null : Number(v)).toBe(expected.get(k) ?? null);
          });
        },
      ),
      { numRuns: 10 },
    );
  });

  it.each([
    ["region", "channel"],
    ["channel", "region"],
  ])("ALL(%s) equals the measure grouped by %s alone", async (lifted, kept) => {
    const byKept = await run({
      dimensions: [{ field: `fx_time.sales.${kept}` }],
      measures: [{ formula: amount }],
    });
    const totals = await run({
      dimensions: [{ field: `fx_time.sales.${lifted}` }, { field: `fx_time.sales.${kept}` }],
      measures: [{ formula: `CALCULATE(${amount}, ALL(sales.${lifted}))` }],
    });
    const expected = new Map(
      (byKept.data[0] ?? []).map((k, i) => [k, Number(byKept.data[1]?.[i])]),
    );
    expect(totals.data[1]?.length).toBeGreaterThan(0);
    (totals.data[1] ?? []).forEach((k, i) => {
      expect(Number(totals.data[2]?.[i])).toBe(expected.get(k));
    });
  });

  it("applies the row policies inside every CTE: the previous window and the total too", async () => {
    // Without RLS here, only the gateway's own policy narrows the rows to tenants 1 and 2.
    const policies: Policy[] = [{ table: "fx_time.sales", column: "tenant_id", in: "tenantIds" }];
    const scope = { tenantIds: [1, 2] };
    const month = [{ field: soldAt, timeGrain: "month" as const }];
    const plain = await run(
      { dimensions: month, measures: [{ formula: amount }] },
      scope,
      policies,
    );
    const timed = await run(
      {
        dimensions: month,
        measures: [
          { formula: `PREVIOUSPERIOD(${amount})` },
          { formula: `CALCULATE(${amount}, ALL(sales.sold_at))` },
        ],
      },
      scope,
      policies,
    );
    const scoped = (plain.data[1] ?? []).map(Number);
    const total = scoped.reduce((a, b) => a + b, 0);
    const everything = await run({ measures: [{ formula: amount }] });
    expect(total).toBeLessThan(Number(everything.data[0]?.[0]));
    (timed.data[0] ?? []).forEach((_, i) => {
      const before = timed.data[1]?.[i];
      expect(before === null ? null : Number(before)).toBe(i === 0 ? null : scoped[i - 1]);
      expect(Number(timed.data[2]?.[i])).toBe(total);
    });
  });
});
