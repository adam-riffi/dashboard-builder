import { type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import fc from "fast-check";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferContract } from "../../src/contract/index.ts";
import { introspect } from "../../src/contract/introspect.ts";
import { compileQuery, type Policy } from "../../src/query/compile.ts";
import { executeQuery } from "../../src/query/execute.ts";
import { planJoins } from "../../src/query/paths.ts";
import { validateQuery } from "../../src/query/validate.ts";

// M2 acceptance (DESIGN.md §9, §10): random queries over a four-tenant fixture must equal a plain
// TypeScript aggregation of only the scope's rows. The fixture has no RLS and the test connects as
// postgres, so the planner's injected policies are the only thing keeping tenants apart.

const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
  throw new Error("Refusing to create fixture schemas outside a local database");
}
const admin = postgres(adminUrl, { onnotice: () => {} });

const TENANTS = [1, 2, 3, 4];
const STATUSES = ["paid", "shipped", "refunded"];
const customers = TENANTS.flatMap((t) =>
  [0, 1].map((k) => ({ id: t * 10 + k, tenant: t, segment: ["smb", "enterprise"][k] as string })),
);
const products = TENANTS.flatMap((t) =>
  [0, 1].map((k) => ({ id: t * 10 + k, tenant: t, category: ["Books", "Toys"][k] as string })),
);
const orders = [
  ...TENANTS.flatMap((t) =>
    [0, 1, 2].map((k) => ({
      id: t * 100 + k,
      tenant: t,
      customer: t * 10 + (k % 2),
      status: STATUSES[k] as string,
      orderedAt: new Date(Date.UTC(2026, k % 2, 1 + k + t, 10 + k)),
    })),
  ),
  // Cross-tenant: a tenant 1 order for tenant 2's customer. Policies on joined tables must drop it.
  {
    id: 199,
    tenant: 1,
    customer: 21,
    status: "paid",
    orderedAt: new Date(Date.UTC(2026, 0, 9, 9)),
  },
];
const items = [
  ...orders
    .filter((o) => o.id !== 199)
    .flatMap((o) =>
      [0, 1].map((j) => ({
        id: o.id * 10 + j,
        tenant: o.tenant,
        order: o.id,
        product: o.tenant * 10 + j,
        quantity: o.tenant * 7 + (o.id % 10) * 3 + j + 1,
      })),
    ),
  // Cross-tenant references: only the policies on the joined tables keep these out.
  { id: 90_001, tenant: 1, order: 200, product: 30, quantity: 101 },
  { id: 90_002, tenant: 2, order: 199, product: 20, quantity: 103 },
  { id: 90_003, tenant: 3, order: 300, product: 10, quantity: 107 },
];

const tables = ["fx_iso.customers", "fx_iso.products", "fx_iso.orders", "fx_iso.order_items"];
const policies: Policy[] = tables.map((table) => ({ table, column: "tenant_id", in: "tenantIds" }));
let contract: ReturnType<typeof inferContract>;

beforeAll(async () => {
  await admin.unsafe(`
    drop schema if exists fx_iso cascade;
    create schema fx_iso;
    create table fx_iso.customers (id int primary key, tenant_id int not null, segment text not null);
    create table fx_iso.products (id int primary key, tenant_id int not null, category text not null);
    create table fx_iso.orders (id int primary key, tenant_id int not null,
      customer_id int not null references fx_iso.customers (id), status text not null,
      ordered_at timestamptz not null);
    create table fx_iso.order_items (id int primary key, tenant_id int not null,
      order_id int not null references fx_iso.orders (id),
      product_id int not null references fx_iso.products (id), quantity int not null);
  `);
  for (const c of customers) {
    await admin`insert into fx_iso.customers values (${c.id}, ${c.tenant}, ${c.segment})`;
  }
  for (const p of products) {
    await admin`insert into fx_iso.products values (${p.id}, ${p.tenant}, ${p.category})`;
  }
  for (const o of orders) {
    await admin`insert into fx_iso.orders values (${o.id}, ${o.tenant}, ${o.customer}, ${o.status}, ${o.orderedAt})`;
  }
  for (const i of items) {
    await admin`insert into fx_iso.order_items values (${i.id}, ${i.tenant}, ${i.order}, ${i.product}, ${i.quantity})`;
  }
  contract = inferContract(await introspect(admin, tables), { tables });
});

afterAll(() => admin.end());

const DIMENSIONS = [
  { field: "fx_iso.customers.segment" },
  { field: "fx_iso.products.category" },
  { field: "fx_iso.orders.status" },
  { field: "fx_iso.orders.ordered_at", timeGrain: "day" },
  { field: "fx_iso.orders.ordered_at", timeGrain: "month" },
] as const;
const MEASURES = [
  { field: "fx_iso.order_items.quantity" },
  { field: "fx_iso.order_items.quantity", aggregation: "MIN" },
  { field: "fx_iso.order_items.quantity", aggregation: "MAX" },
  { field: "fx_iso.order_items.id", aggregation: "COUNT" },
  { field: "fx_iso.order_items.product_id", aggregation: "COUNT_DISTINCT" },
] as const;

/** Runs a spec through the real pipeline: validate, plan, compile with policies, execute. */
async function run(spec: QuerySpec, tenantIds: number[]) {
  const valid = validateQuery(spec, contract);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const plan = planJoins(valid.query, contract);
  if (!plan.ok) throw new Error(plan.errors.join("; "));
  const compiled = compileQuery(valid.query, plan.plan, policies, { tenantIds });
  if (!compiled.ok) throw new Error(compiled.errors.join("; "));
  const result = await executeQuery(admin, compiled.query, {
    limit: valid.query.limit,
    settings: {},
  });
  const rowCount = result.data[0]?.length ?? 0;
  return Array.from({ length: rowCount }, (_, r) => result.data.map((column) => column[r]));
}

/** The same query computed in TypeScript over only the scope's rows. */
function reference(spec: QuerySpec, tenantIds: number[]) {
  const inScope = (tenant: number) => tenantIds.includes(tenant);
  const statusFilter = spec.filters[0]?.values as string[] | undefined;
  // A related table's policy applies only when the query joins it (customers go through orders).
  const uses = (table: string) =>
    spec.dimensions.some((d) => d.field.startsWith(`fx_iso.${table}.`));
  const joinsCustomers = uses("customers");
  const joinsOrders = joinsCustomers || uses("orders") || statusFilter !== undefined;
  const joinsProducts = uses("products");
  const rows = items.flatMap((item) => {
    const order = orders.find((o) => o.id === item.order);
    const product = products.find((p) => p.id === item.product);
    const customer = customers.find((c) => c.id === order?.customer);
    if (!order || !product || !customer || !inScope(item.tenant)) return [];
    if (joinsOrders && !inScope(order.tenant)) return [];
    if (joinsProducts && !inScope(product.tenant)) return [];
    if (joinsCustomers && !inScope(customer.tenant)) return [];
    if (statusFilter && !statusFilter.includes(order.status)) return [];
    return [{ item, order, product, customer }];
  });
  const dimension = (row: (typeof rows)[number], d: (typeof DIMENSIONS)[number]) => {
    if (d.field === "fx_iso.customers.segment") return row.customer.segment;
    if (d.field === "fx_iso.products.category") return row.product.category;
    if (d.field === "fx_iso.orders.status") return row.order.status;
    const t = row.order.orderedAt;
    const truncated =
      "timeGrain" in d && d.timeGrain === "month"
        ? Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)
        : Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    return new Date(truncated).toISOString();
  };
  const groups = new Map<string, typeof rows>();
  if (spec.dimensions.length === 0) groups.set("[]", []);
  for (const row of rows) {
    const key = JSON.stringify(
      spec.dimensions.map((d) => dimension(row, d as (typeof DIMENSIONS)[number])),
    );
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, group]) => [
    ...(JSON.parse(key) as unknown[]),
    ...spec.measures.map((m) => {
      if (!("field" in m)) throw new Error("the reference aggregates column measures only");
      const values = group.map((g) =>
        m.field === "fx_iso.order_items.id"
          ? g.item.id
          : m.field === "fx_iso.order_items.product_id"
            ? g.item.product
            : g.item.quantity,
      );
      switch (m.aggregation ?? "SUM") {
        case "COUNT":
          return values.length;
        case "COUNT_DISTINCT":
          return new Set(values).size;
        case "MIN":
          return values.length ? Math.min(...values) : null;
        case "MAX":
          return values.length ? Math.max(...values) : null;
        default:
          return values.length ? values.reduce((a, b) => a + b, 0) : null;
      }
    }),
  ]);
}

const sorted = (rows: unknown[][]) => rows.map((r) => JSON.stringify(r)).sort();

const randomQuery = fc.record({
  dimensions: fc.subarray([...DIMENSIONS], { maxLength: 2 }),
  measures: fc.subarray([...MEASURES], { minLength: 1, maxLength: 3 }),
  statuses: fc.option(fc.subarray(STATUSES, { minLength: 1 }), { nil: undefined }),
  tenantIds: fc.subarray(TENANTS),
});

describe("tenant isolation (M2 acceptance)", () => {
  it("returns exactly the aggregation of the scope's rows, for random queries and scopes", async () => {
    await fc.assert(
      fc.asyncProperty(randomQuery, async ({ dimensions, measures, statuses, tenantIds }) => {
        const spec = querySpec.parse({
          dimensions,
          measures,
          filters: statuses ? [{ field: "fx_iso.orders.status", op: "in", values: statuses }] : [],
        });
        expect(sorted(await run(spec, tenantIds))).toEqual(sorted(reference(spec, tenantIds)));
      }),
      { numRuns: 60 },
    );
  });

  it("returns nothing from any tenant for an empty scope", async () => {
    const spec = querySpec.parse({
      dimensions: [{ field: "fx_iso.products.category" }],
      measures: [{ field: "fx_iso.order_items.id", aggregation: "COUNT" }],
    });
    expect(await run(spec, [])).toEqual([]);
  });
});
