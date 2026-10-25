import { planJoins, type QuerySpec, querySpec, validateQuery } from "@adam-riffi/dash-core";
import fc from "fast-check";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferContract } from "../../src/contract/index.ts";
import { introspect } from "../../src/contract/introspect.ts";
import { compileQuery, type Policy } from "../../src/query/compile.ts";
import { executeQuery } from "../../src/query/execute.ts";

// Queries over several fact tables against each measure queried alone (ADR 0014): a measure's
// value in the joined result is its own query's value for the same dimensions, or null where
// its fact has no row for them.
const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
  throw new Error("Refusing to create fixture schemas outside a local database");
}
const admin = postgres(adminUrl, { onnotice: () => {} });
const tables = ["fx_facts.stores", "fx_facts.sales", "fx_facts.refunds"];
const policies: Policy[] = tables.map((table) => ({ table, column: "tenant_id", in: "tenantIds" }));
let contract: ReturnType<typeof inferContract>;

beforeAll(async () => {
  // 12 stores (some without a region, two without sales), 200 sales, 40 refunds; each row's
  // tenant is independent of its parents', so every table's policy matters.
  await admin.unsafe(`
    drop schema if exists fx_facts cascade;
    create schema fx_facts;
    create table fx_facts.stores (id int primary key, region text, tenant_id int not null);
    create table fx_facts.sales (
      id int primary key, store_id int not null references fx_facts.stores (id),
      channel text not null, amount numeric(10, 2) not null, tenant_id int not null
    );
    create table fx_facts.refunds (
      id int primary key, sale_id int not null references fx_facts.sales (id),
      amount numeric(10, 2) not null, tenant_id int not null
    );
    insert into fx_facts.stores
    select g, (array['north', 'south', null])[1 + g % 3], 1 + g % 3 from generate_series(1, 12) g;
    insert into fx_facts.sales
    select g, 1 + (g * 7) % 10, (array['web', 'store'])[1 + g % 2], (g * 37) % 100, 1 + (g / 7) % 3
    from generate_series(1, 200) g;
    insert into fx_facts.refunds
    select g, 1 + (g * 13) % 200, (g * 11) % 40, 1 + (g / 5) % 3 from generate_series(1, 40) g;
  `);
  contract = inferContract(await introspect(admin, tables), { tables });
});

afterAll(() => admin.end());

type Spec = Partial<QuerySpec> & Pick<QuerySpec, "measures">;

async function run(spec: Spec, scope: Record<string, unknown>) {
  const valid = validateQuery(querySpec.parse(spec), contract);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const plan = planJoins(valid.query, contract);
  if (!plan.ok) throw new Error(plan.errors.join("; "));
  const compiled = compileQuery(valid.query, plan.plan, policies, scope);
  if (!compiled.ok) throw new Error(compiled.errors.join("; "));
  return executeQuery(admin, compiled.query, { limit: valid.query.limit, settings: {} });
}

/** Each row's measure values by its dimension values; columns are dimensions, then measures. */
function byKey(data: unknown[][], dimensions: number) {
  const rows = new Map<string, (number | null)[]>();
  (data[0] ?? []).forEach((_, r) => {
    const key = JSON.stringify(data.slice(0, dimensions).map((c) => c[r]));
    const values = data.slice(dimensions).map((c) => (c[r] === null ? null : Number(c[r])));
    rows.set(key, values);
  });
  return rows;
}

const region = "fx_facts.stores.region";
const channel = "fx_facts.sales.channel";

describe("several fact tables against each measure alone", () => {
  it("each measure equals its own query, by the same dimensions, filters and scope", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([region, channel]),
        fc.boolean(),
        fc.option(fc.constantFrom("north", "south"), { nil: undefined }),
        fc.subarray([1, 2, 3], { minLength: 1 }),
        async (dims, withStores, regionIs, tenantIds) => {
          // The stores fact reaches no sale, so its count only goes with stores' own fields.
          const counted = withStores && !dims.includes(channel);
          const measures = [
            "SUM(sales.amount)",
            "SUM(refunds.amount)",
            ...(counted ? ["COUNT(stores.id)"] : []),
          ].map((formula) => ({ formula }));
          const spec: Spec = {
            dimensions: dims.map((field) => ({ field })),
            measures,
            filters: regionIs ? [{ field: region, op: "in", values: [regionIs] }] : [],
          };
          const scope = { tenantIds };
          const joined = byKey((await run(spec, scope)).data, dims.length);
          const alone = await Promise.all(
            measures.map(async (m) =>
              byKey((await run({ ...spec, measures: [m] }, scope)).data, dims.length),
            ),
          );
          const keys = new Set(alone.flatMap((a) => [...a.keys()]));
          expect(new Set(joined.keys())).toEqual(keys);
          for (const [key, values] of joined) {
            expect(values).toEqual(alone.map((a) => a.get(key)?.[0] ?? null));
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it("renders a formula across facts over each fact's own total", async () => {
    const scope = { tenantIds: [1, 2, 3] };
    const dimensions = [{ field: region }];
    const net = byKey(
      (
        await run(
          { dimensions, measures: [{ formula: "SUM(sales.amount) - SUM(refunds.amount)" }] },
          scope,
        )
      ).data,
      1,
    );
    const sales = byKey(
      (await run({ dimensions, measures: [{ formula: "SUM(sales.amount)" }] }, scope)).data,
      1,
    );
    const refunds = byKey(
      (await run({ dimensions, measures: [{ formula: "SUM(refunds.amount)" }] }, scope)).data,
      1,
    );
    expect(net.size).toBeGreaterThan(1);
    for (const [key, [value]] of net) {
      const s = sales.get(key)?.[0] ?? null;
      const r = refunds.get(key)?.[0] ?? null;
      expect(value).toBe(s === null || r === null ? null : s - r);
    }
  });
});
