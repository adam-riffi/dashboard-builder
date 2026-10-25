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
    (select count(*)::int from dash_demo.order_items) as items,
    (select count(*)::int from dash_demo.returns) as returns`.then(([row]) => row);

beforeAll(async () => {
  await admin`truncate dash_demo.tenants cascade`;
});

afterAll(() => admin.end());

describe("seed", () => {
  it("fills every demo table for five tenants", async () => {
    await seed(admin);
    const c = await counts();
    expect(c?.tenants).toBe(5);
    for (const n of [c?.customers, c?.products, c?.orders, c?.items, c?.returns]) {
      expect(n).toBeGreaterThan(0);
    }
    const perTenant = await admin`select distinct tenant_id from dash_demo.orders order by 1`;
    expect(perTenant.map((r) => r.tenant_id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns about one item in twenty, whole, after its order and before now", async () => {
    const [r] = await admin`select
      (select count(*)::float from dash_demo.returns)
        / (select count(*) from dash_demo.order_items) as share,
      count(*) filter (where r.quantity <> i.quantity
        or r.refunded_amount <> i.quantity * i.unit_price
        or r.tenant_id <> i.tenant_id
        or r.returned_at < o.ordered_at or r.returned_at > now())::int as wrong
      from dash_demo.returns r
      join dash_demo.order_items i on i.id = r.order_item_id
      join dash_demo.orders o on o.id = i.order_id`;
    expect(r?.share).toBeGreaterThan(0.03);
    expect(r?.share).toBeLessThan(0.07);
    expect(r?.wrong).toBe(0);
  });

  it("is idempotent", async () => {
    const before = await counts();
    await seed(admin);
    expect(await counts()).toEqual(before);
  });
});

describe("dash_demo.tick (pg_cron job)", () => {
  it("adds one order with one or two items per run", async () => {
    const [before] = await admin`select max(id) as id from dash_demo.orders`;
    await admin`select dash_demo.tick()`;
    const added = await admin`select o.id, count(i.id)::int as items
      from dash_demo.orders o left join dash_demo.order_items i on i.order_id = o.id
      where o.id > ${before?.id} group by o.id`;
    expect(added).toHaveLength(1);
    expect([1, 2]).toContain(added[0]?.items);
  });

  it("deletes orders older than 90 days, with their items and returns", async () => {
    const [old] =
      await admin`insert into dash_demo.orders (tenant_id, customer_id, ordered_at, status, channel)
      values (1, 1, now() - interval '91 days', 'paid', 'web') returning id`;
    const [item] =
      await admin`insert into dash_demo.order_items (order_id, tenant_id, product_id, quantity, unit_price)
      values (${old?.id}, 1, 1, 2, 10) returning id`;
    await admin`insert into dash_demo.returns (tenant_id, order_item_id, quantity, refunded_amount, returned_at)
      values (1, ${item?.id}, 2, 20, now() - interval '89 days')`;
    await admin`select dash_demo.tick()`;
    expect(await admin`select 1 from dash_demo.orders where id = ${old?.id}`).toHaveLength(0);
    expect(
      await admin`select 1 from dash_demo.returns where order_item_id = ${item?.id}`,
    ).toHaveLength(0);
  });

  it("returns a recent item of the tenant's on every tenth order", async () => {
    const [before] = await admin`select coalesce(max(id), 0) as id from dash_demo.returns`;
    // Ten runs reach the next multiple of ten, unless a run found no customer and added none.
    for (let run = 0; run < 12; run++) await admin`select dash_demo.tick()`;
    const added =
      await admin`select r.quantity = i.quantity as whole, r.tenant_id = i.tenant_id as same,
        o.ordered_at > now() - interval '30 days' as recent
      from dash_demo.returns r
      join dash_demo.order_items i on i.id = r.order_item_id
      join dash_demo.orders o on o.id = i.order_id
      where r.id > ${before?.id}`;
    expect(added.length).toBeGreaterThan(0);
    for (const r of added) expect(r).toEqual({ whole: true, same: true, recent: true });
  });

  it("keeps one day of its own pg_cron run history and leaves other jobs alone", async () => {
    const [{ jobid } = {}] =
      await admin`select jobid from cron.job where jobname = 'dash_demo_tick'`;
    // Explicit negative run ids: Supabase's postgres role may not use cron.runid_seq.
    const runs = [
      { jobid, runid: -1 },
      { jobid: -1, runid: -2 },
    ];
    for (const run of runs) {
      await admin`insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
        values (${run.jobid}, ${run.runid}, 'succeeded', now() - interval '2 days', now() - interval '2 days')`;
    }
    await admin`select dash_demo.tick()`;
    const left = await admin`select runid::int from cron.job_run_details where runid < 0`;
    expect(left.map((r) => r.runid)).toEqual([-2]);
    await admin`delete from cron.job_run_details where runid < 0`;
  });

  it("is scheduled every minute", async () => {
    const jobs = await admin`select schedule from cron.job where jobname = 'dash_demo_tick'`;
    expect(jobs.map((j) => j.schedule)).toEqual(["* * * * *"]);
  });
});
