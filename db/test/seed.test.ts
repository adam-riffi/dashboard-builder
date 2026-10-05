import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../seed.ts";

const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);

const counts = () =>
  admin`select
    (select count(*)::int from dash_demo.tenants) as tenants,
    (select count(*)::int from dash_demo.customers) as customers,
    (select count(*)::int from dash_demo.products) as products,
    (select count(*)::int from dash_demo.orders) as orders,
    (select count(*)::int from dash_demo.order_items) as items`.then(([row]) => row);

beforeAll(async () => {
  await admin`truncate dash_demo.tenants cascade`;
});

afterAll(() => admin.end());

describe("seed", () => {
  it("fills every demo table for five tenants", async () => {
    await seed(admin);
    const c = await counts();
    expect(c?.tenants).toBe(5);
    for (const n of [c?.customers, c?.products, c?.orders, c?.items]) expect(n).toBeGreaterThan(0);
    const perTenant = await admin`select distinct tenant_id from dash_demo.orders order by 1`;
    expect(perTenant.map((r) => r.tenant_id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is idempotent", async () => {
    const before = await counts();
    await seed(admin);
    expect(await counts()).toEqual(before);
  });
});

describe("dash_demo.tick (pg_cron job)", () => {
  it("adds orders with items for every tenant", async () => {
    const before =
      await admin`select tenant_id, count(*)::int as n from dash_demo.orders group by 1 order by 1`;
    await admin`select dash_demo.tick()`;
    const after =
      await admin`select tenant_id, count(*)::int as n from dash_demo.orders group by 1 order by 1`;
    for (const [i, row] of after.entries()) expect(row.n).toBeGreaterThan(before[i]?.n ?? 0);
    const orphans = await admin`select count(*)::int as n from dash_demo.orders o
      where not exists (select from dash_demo.order_items i where i.order_id = o.id)`;
    expect(orphans[0]?.n).toBe(0);
  });

  it("deletes orders older than 90 days", async () => {
    const [old] =
      await admin`insert into dash_demo.orders (tenant_id, customer_id, ordered_at, status, channel)
      values (1, 1, now() - interval '91 days', 'paid', 'web') returning id`;
    await admin`select dash_demo.tick()`;
    expect(await admin`select 1 from dash_demo.orders where id = ${old?.id}`).toHaveLength(0);
  });

  it("is scheduled every minute", async () => {
    const jobs = await admin`select schedule from cron.job where jobname = 'dash_demo_tick'`;
    expect(jobs.map((j) => j.schedule)).toEqual(["* * * * *"]);
  });
});
