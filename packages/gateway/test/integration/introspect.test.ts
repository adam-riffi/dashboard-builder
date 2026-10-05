import { fileURLToPath } from "node:url";
import type { DataContract } from "@adam-riffi/dash-core";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { inferContract } from "../../src/contract/index.ts";
import { introspect } from "../../src/contract/introspect.ts";

const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
// These tests create and drop schemas: never against anything but a local database.
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
  throw new Error("Refusing to create fixture schemas outside a local database");
}
const admin = postgres(adminUrl, { onnotice: () => {} });
const reader = postgres(
  process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
);

afterAll(() => Promise.all([admin.end(), reader.end()]));

const golden = (contract: DataContract) => `${JSON.stringify(contract, null, 2)}\n`;

const fixtures = {
  saas: ["fx_saas.plans", "fx_saas.accounts", "fx_saas.invoices", "fx_saas.events"],
  graph: [
    "fx_graph.airports",
    "fx_graph.employees",
    "fx_graph.flights",
    "fx_graph.legs",
    "fx_graph.audit",
  ],
};

describe("introspect", () => {
  it.each(Object.entries(fixtures))(
    "matches the golden contract of the %s fixture",
    async (name, tables) => {
      await admin.file(fileURLToPath(new URL(`fixtures/${name}.sql`, import.meta.url)));
      const contract = inferContract(await introspect(admin, tables), { tables });
      await expect(golden(contract)).toMatchFileSnapshot(`fixtures/${name}.contract.json`);
    },
  );

  it("matches the golden contract of the demo schema, read as dash_reader", async () => {
    const tables = [
      "dash_demo.orders",
      "dash_demo.order_items",
      "dash_demo.products",
      "dash_demo.customers",
    ];
    const catalog = await introspect(reader, tables);
    // Row counts follow the live data; everything else is fixed by the migrations.
    const fixed = { tables: catalog.tables.map((t) => ({ ...t, rowCount: null })) };
    await expect(golden(inferContract(fixed, { tables }))).toMatchFileSnapshot(
      "fixtures/dash_demo.contract.json",
    );
  });

  it("gets no statistics where row-level security applies to the reader", async () => {
    await admin.unsafe(`
      drop schema if exists fx_rls cascade;
      create schema fx_rls;
      create table fx_rls.t as select i % 7 as k from generate_series(1, 100) as i;
      alter table fx_rls.t enable row level security;
      create policy everything on fx_rls.t for select to dash_reader using (true);
      grant usage on schema fx_rls to dash_reader;
      grant select on fx_rls.t to dash_reader;
      analyze fx_rls.t;
    `);
    const distinct = async (sql: postgres.Sql) =>
      (await introspect(sql, ["fx_rls.t"])).tables[0]?.columns[0]?.nDistinct;
    expect(await distinct(admin)).toBe(7);
    expect(await distinct(reader)).toBeNull();
  });

  it("treats tables in schemas the reader cannot use as unreadable", async () => {
    await admin.unsafe(`
      drop schema if exists fx_nousage cascade;
      create schema fx_nousage;
      create table fx_nousage.t (k int);
      grant select on fx_nousage.t to dash_reader;
    `);
    await expect(introspect(reader, ["fx_nousage.t"])).rejects.toThrow(
      "Tables not found or not readable: fx_nousage.t",
    );
  });

  it("names the tables it cannot find or read", async () => {
    await expect(
      introspect(reader, ["dash_demo.orders", "dash.dashboards", "nope.nothing"]),
    ).rejects.toThrow("Tables not found or not readable: dash.dashboards, nope.nothing");
  });
});
