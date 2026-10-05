import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);
const reader = postgres(
  process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
);
const app = postgres(
  process.env.DASH_APP_DATABASE_URL ?? "postgres://dash_app:password@localhost:54322/postgres",
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

/** Runs `query` as dash_app for the given user, the way the gateway will. */
function asUser<T>(userId: string | null, query: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    if (userId !== null) await sql`select set_config('app.user_id', ${userId}, true)`;
    return query(sql);
  });
}

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";

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
  await admin`truncate dash.dashboards`;
  for (const owner of [alice, bob]) {
    await admin`insert into dash.dashboards (owner_id, title, spec, contract_version)
      values (${owner}, 'd', '{}', 'v0')`;
  }
});

afterAll(async () => {
  await admin`truncate dash_demo.tenants cascade`;
  await admin`truncate dash.dashboards`;
  await Promise.all([admin.end(), reader.end(), app.end()]);
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

describe("dash.dashboards row-level security", () => {
  it("dash_app sees only the dashboards owned by app.user_id", async () => {
    const rows = await asUser(alice, (sql) => sql`select owner_id from dash.dashboards`);
    expect(rows.map((r) => r.owner_id)).toEqual([alice]);
  });

  it("dash_app sees nothing without app.user_id", async () => {
    expect(await asUser(null, (sql) => sql`select 1 from dash.dashboards`)).toHaveLength(0);
  });

  it("dash_app cannot create a dashboard for another user", async () => {
    await expect(
      asUser(
        alice,
        (sql) => sql`insert into dash.dashboards (owner_id, title, spec, contract_version)
          values (${bob}, 'd', '{}', 'v0')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("dash_app cannot hand a dashboard to another user", async () => {
    await expect(
      asUser(alice, (sql) => sql`update dash.dashboards set owner_id = ${bob}`),
    ).rejects.toThrow(/row-level security/);
  });

  it.each([
    ["anon", "dashboards"],
    ["anon", "memberships"],
    ["authenticated", "dashboards"],
    ["authenticated", "memberships"],
  ])("the Data API role %s cannot read dash.%s", async (role, table) => {
    await expect(
      admin.begin(async (sql) => {
        await sql.unsafe(`set local role ${role}`);
        return sql`select 1 from ${sql("dash")}.${sql(table)}`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
