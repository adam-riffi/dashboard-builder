import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);
const reader = postgres(
  process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
);

/** Runs `query` as dash_reader with the given tenant scope, the way the gateway will. */
function asTenants<T>(
  tenantIds: string | null,
  query: (sql: postgres.TransactionSql) => Promise<T>,
) {
  return reader.begin(async (sql) => {
    if (tenantIds !== null) await sql`select set_config('app.tenant_ids', ${tenantIds}, true)`;
    return query(sql);
  });
}

beforeAll(async () => {
  await admin`truncate dash_demo.tenants cascade`;
  for (const id of [1, 2, 3, 4, 5]) {
    await admin`insert into dash_demo.tenants (id, name, region) values (${id}, ${`T${id}`}, 'eu')`;
    await admin`insert into dash_demo.customers (id, tenant_id, name, country, segment)
      values (${id}, ${id}, 'c', 'FR', 'smb')`;
    await admin`insert into dash_demo.products (id, tenant_id, name, category, unit_price)
      values (${id}, ${id}, 'p', 'cat', 10)`;
    await admin`insert into dash_demo.orders (id, tenant_id, customer_id, ordered_at, status, channel)
      values (${id}, ${id}, ${id}, now(), 'paid', 'web')`;
    await admin`insert into dash_demo.order_items (id, order_id, tenant_id, product_id, quantity, unit_price)
      values (${id}, ${id}, ${id}, ${id}, 1, 10)`;
  }
});

afterAll(async () => {
  await admin`truncate dash_demo.tenants cascade`;
  await Promise.all([admin.end(), reader.end()]);
});

const tables = ["tenants", "customers", "products", "orders", "order_items"] as const;

describe("dash_demo row-level security", () => {
  it.each(tables)("%s: dash_reader sees only rows of tenants in app.tenant_ids", async (table) => {
    const tenantColumn = table === "tenants" ? "id" : "tenant_id";
    const rows = await asTenants(
      "1,2",
      (sql) => sql`select ${sql(tenantColumn)} as tenant from ${sql("dash_demo")}.${sql(table)}`,
    );
    expect(rows.map((r) => r.tenant).sort()).toEqual([1, 2]);
  });

  it.each(tables)("%s: dash_reader sees nothing without a tenant scope", async (table) => {
    const rows = await asTenants(
      null,
      (sql) => sql`select 1 from ${sql("dash_demo")}.${sql(table)}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("dash_reader cannot write", async () => {
    await expect(
      asTenants("1", (sql) => sql`update dash_demo.orders set status = 'x' where tenant_id = 1`),
    ).rejects.toThrow(/permission denied/);
  });
});
