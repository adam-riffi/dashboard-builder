import { type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferContract } from "../../src/contract/index.ts";
import { introspect } from "../../src/contract/introspect.ts";
import { type CompiledQuery, compileQuery, type Policy } from "../../src/query/compile.ts";
import { executeQuery } from "../../src/query/execute.ts";
import { planJoins } from "../../src/query/paths.ts";
import { validateQuery } from "../../src/query/validate.ts";

const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
  throw new Error("Refusing to create fixture schemas outside a local database");
}
const admin = postgres(adminUrl, { onnotice: () => {} });
const reader = postgres(
  process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
);
const tables = ["fx_exec.sales"];
const policies: Policy[] = [{ table: "fx_exec.sales", column: "tenant_id", in: "tenantIds" }];
let contract: ReturnType<typeof inferContract>;

beforeAll(async () => {
  await admin.unsafe(`
    drop schema if exists fx_exec cascade;
    create schema fx_exec;
    create table fx_exec.sales (
      id int primary key, tenant_id int not null, region text not null,
      amount numeric(10, 2) not null, sold_at timestamptz not null, refunded boolean not null
    );
    insert into fx_exec.sales values
      (1, 1, 'north', 10, '2026-01-01T23:30:00Z', false),
      (2, 1, 'south', 20, '2026-01-02T00:30:00Z', true),
      (3, 2, 'north', 30, '2026-01-02T10:00:00Z', false),
      (4, 3, 'east', 40, '2026-01-03T10:00:00Z', false);
    alter table fx_exec.sales enable row level security;
    create policy scoped on fx_exec.sales for select to dash_reader
      using (tenant_id = any(string_to_array(current_setting('app.tenant_ids', true), ',')::int[]));
    grant usage on schema fx_exec to dash_reader;
    grant select on fx_exec.sales to dash_reader;
  `);
  contract = inferContract(await introspect(reader, tables), { tables });
});

afterAll(() => Promise.all([admin.end(), reader.end()]));

function compiled(
  spec: Partial<QuerySpec> & Pick<QuerySpec, "measures">,
  scope: Record<string, unknown>,
  withPolicies = policies,
): { query: CompiledQuery; limit: number } {
  const valid = validateQuery(querySpec.parse(spec), contract);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const plan = planJoins(valid.query, contract);
  if (!plan.ok) throw new Error(plan.errors.join("; "));
  const result = compileQuery(valid.query, plan.plan, withPolicies, scope);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { query: result.query, limit: valid.query.limit };
}

const amount = { field: "fx_exec.sales.amount" };
const region = { field: "fx_exec.sales.region" };

describe("executeQuery", () => {
  it("returns column-major numbers for the scope's tenants", async () => {
    const { query, limit } = compiled(
      { dimensions: [region], measures: [amount] },
      { tenantIds: [1, 2] },
    );
    const result = await executeQuery(reader, query, {
      limit,
      settings: { "app.tenant_ids": "1,2" },
    });
    expect(result.data).toEqual([
      ["north", "south"],
      [40, 20],
    ]);
    expect(result.meta).toMatchObject({ cache: "miss", truncated: false });
    expect(result.meta.ms).toBeGreaterThanOrEqual(0);
  });

  it("still filters through RLS when the planner adds no policy", async () => {
    const { query, limit } = compiled({ measures: [amount] }, {}, []);
    const scoped = await executeQuery(reader, query, {
      limit,
      settings: { "app.tenant_ids": "1" },
    });
    expect(scoped.data).toEqual([[30]]);
    const unscoped = await executeQuery(reader, query, { limit, settings: {} });
    expect(unscoped.data).toEqual([[null]]);
  });

  it("caps rows at the limit and reports truncation", async () => {
    const { query, limit } = compiled(
      {
        dimensions: [region],
        measures: [{ field: "fx_exec.sales.id", aggregation: "COUNT" }],
        limit: 2,
      },
      { tenantIds: [1, 2, 3] },
    );
    const result = await executeQuery(reader, query, {
      limit,
      settings: { "app.tenant_ids": "1,2,3" },
    });
    expect(result.data[0]).toEqual(["east", "north"]);
    expect(result.meta.truncated).toBe(true);
  });

  it("truncates time grains in UTC", async () => {
    const { query, limit } = compiled(
      {
        dimensions: [{ field: "fx_exec.sales.sold_at", timeGrain: "day" }],
        measures: [{ field: "fx_exec.sales.id", aggregation: "COUNT" }],
      },
      { tenantIds: [1, 2, 3] },
    );
    const result = await executeQuery(reader, query, {
      limit,
      settings: { "app.tenant_ids": "1,2,3" },
    });
    expect(result.data).toEqual([
      ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
      [1, 2, 1],
    ]);
  });

  it("stops statements at the timeout", async () => {
    const slow: CompiledQuery = {
      text: "select pg_sleep(1) as m0",
      params: [],
      columns: [
        { key: "m0", kind: "measure", field: "x.y.z", aggregation: "COUNT", type: "number" },
      ],
    };
    await expect(
      executeQuery(reader, slow, { limit: 1, settings: {}, timeoutMs: 100 }),
    ).rejects.toThrow(/statement timeout/);
  });

  it("filters on true/false columns", async () => {
    const { query, limit } = compiled(
      {
        measures: [amount],
        filters: [{ field: "fx_exec.sales.refunded", op: "in", values: [true] }],
      },
      { tenantIds: [1, 2, 3] },
    );
    const result = await executeQuery(reader, query, {
      limit,
      settings: { "app.tenant_ids": "1,2,3" },
    });
    expect(result.data).toEqual([[20]]);
  });

  it("runs read-only, so a statement can never write", async () => {
    const write: CompiledQuery = {
      text: "insert into fx_exec.sales values (9, 1, 'x', 1, now(), false) returning 1 as m0",
      params: [],
      columns: [
        { key: "m0", kind: "measure", field: "x.y.z", aggregation: "COUNT", type: "number" },
      ],
    };
    await expect(executeQuery(admin, write, { limit: 1, settings: {} })).rejects.toThrow(
      /read-only transaction/,
    );
  });

  it("never carries one caller's scope to the next query on the same connection", async () => {
    const single = postgres(
      process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
      { max: 1 },
    );
    const { query, limit } = compiled({ measures: [amount] }, {}, []);
    try {
      expect(
        (await executeQuery(single, query, { limit, settings: { "app.tenant_ids": "1" } })).data,
      ).toEqual([[30]]);
      expect((await executeQuery(single, query, { limit, settings: {} })).data).toEqual([[null]]);
    } finally {
      await single.end();
    }
  });
});
