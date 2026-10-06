import { dataContract } from "@adam-riffi/dash-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGateway, defineGateway, jwtAuth, postgresSource } from "../../src/index.ts";
import { AUDIENCE, ISSUER, startJwks, USER } from "./jwks.ts";

const jwks = await startJwks();
afterAll(() => jwks.close());

const tables = ["dash_demo.orders", "dash_demo.customers"];
const handle = createGateway(
  defineGateway({
    source: postgresSource({
      url:
        process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
    }),
    auth: jwtAuth({ jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE }),
    identity: { claim: "sub", format: "uuid" },
    tables,
  }),
);

const call = (path: string, init: RequestInit = {}) =>
  handle(new Request(`http://demo.test/api/dash/${path}`, init));
const bearer = async () => ({ authorization: `Bearer ${await jwks.sign({ sub: USER })}` });

describe("gateway handler", () => {
  it("serves /health without authentication", async () => {
    const res = await call("health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("refuses /contract without a token", async () => {
    const res = await call("contract");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({ error: "Missing bearer token" });
  });

  it("refuses /contract with a token it cannot verify", async () => {
    const res = await call("contract", { headers: { authorization: "Bearer not.a.jwt" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid token" });
  });

  it("logs why a token was rejected without returning the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = await jwks.sign({ sub: USER }, { exp: "-1m" });
    const res = await call("contract", { headers: { authorization: `Bearer ${token}` } });
    expect(await res.json()).toEqual({ error: "Invalid token" });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      msg: "request unauthorized",
      route: "contract",
      cause: expect.stringContaining("exp"),
    });
    warn.mockRestore();
  });

  it("refuses /contract when the identity claim is malformed", async () => {
    const token = await jwks.sign({ sub: "42" });
    const res = await call("contract", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("serves the contract of the allowlisted tables, tagged with its version", async () => {
    const res = await call("contract", { headers: await bearer() });
    expect(res.status).toBe(200);
    const contract = dataContract.parse(await res.json());
    expect(contract.tables.map((t) => t.name)).toEqual(["dash_demo.customers", "dash_demo.orders"]);
    expect(res.headers.get("etag")).toBe(`"${contract.contractVersion}"`);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("serves no statistics, which ignore RLS and would leak across tenants (ADR 0005)", async () => {
    const res = await call("contract", { headers: await bearer() });
    const contract = dataContract.parse(await res.json());
    for (const t of contract.tables) {
      expect(t.rowCount).toBeNull();
      expect(t.columns.every((c) => c.distinct === null)).toBe(true);
    }
  });

  it("matches If-None-Match lists, weak tags and *", async () => {
    const first = await call("contract", { headers: await bearer() });
    const etag = first.headers.get("etag") as string;
    for (const header of [`W/"old", ${etag}`, `W/${etag}`, "*"]) {
      const res = await call("contract", {
        headers: { ...(await bearer()), "if-none-match": header },
      });
      expect(res.status).toBe(304);
    }
    const stale = await call("contract", {
      headers: { ...(await bearer()), "if-none-match": '"old"' },
    });
    expect(stale.status).toBe(200);
  });

  it("answers 304 when the client already has this version", async () => {
    const first = await call("contract", { headers: await bearer() });
    const etag = first.headers.get("etag") as string;
    const res = await call("contract", { headers: { ...(await bearer()), "if-none-match": etag } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("answers 404 for unknown routes and 405 for other methods", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("contract", { method: "POST", headers: await bearer() })).status).toBe(405);
  });
});

describe("POST /query", () => {
  const adminUrl =
    process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(adminUrl).hostname)) {
    throw new Error("Refusing to create fixture schemas outside a local database");
  }
  const admin = postgres(adminUrl, { onnotice: () => {} });
  let scope: Record<string, unknown> = { tenantIds: [1, 2] };
  const api = createGateway(
    defineGateway({
      source: postgresSource({
        url:
          process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
      }),
      auth: jwtAuth({ jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE }),
      identity: { claim: "sub", format: "uuid" },
      tables: ["fx_api.sales"],
      policies: [{ table: "fx_api.sales", column: "tenant_id", in: "tenantIds" }],
      resolveScope: async () => scope,
    }),
  );
  const query = async (body: unknown) =>
    api(
      new Request("http://demo.test/api/dash/query", {
        method: "POST",
        headers: { ...(await bearer()), "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const byRegion = {
    dimensions: [{ field: "fx_api.sales.region" }],
    measures: [{ field: "fx_api.sales.amount" }],
  };

  beforeAll(async () => {
    await admin.unsafe(`
      drop schema if exists fx_api cascade;
      create schema fx_api;
      create table fx_api.sales (id int primary key, tenant_id int not null, region text not null, amount numeric(10, 2) not null);
      insert into fx_api.sales values (1, 1, 'north', 10), (2, 1, 'south', 20), (3, 2, 'north', 30), (4, 3, 'east', 40);
      alter table fx_api.sales enable row level security;
      create policy scoped on fx_api.sales for select to dash_reader
        using (tenant_id = any(string_to_array(current_setting('app.tenant_ids', true), ',')::int[]));
      grant usage on schema fx_api to dash_reader;
      grant select on fx_api.sales to dash_reader;
    `);
  });
  afterAll(() => admin.end());

  it("answers every query with column-major results for the caller's scope", async () => {
    scope = { tenantIds: [1, 2] };
    const res = await query({
      queries: [byRegion, { measures: [{ field: "fx_api.sales.id", aggregation: "COUNT" }] }],
    });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0]).toMatchObject({
      columns: [
        { key: "d0", kind: "dimension" },
        { key: "m0", kind: "measure", aggregation: "SUM" },
      ],
      data: [
        ["north", "south"],
        [40, 20],
      ],
      meta: { cache: "miss", truncated: false },
    });
    expect(results[1].data).toEqual([[3]]);
  });

  it("reports invalid queries one by one, next to valid ones", async () => {
    const res = await query({
      queries: [{ measures: [{ field: "fx_api.sales.nope" }] }, byRegion],
    });
    const { results } = await res.json();
    expect(results[0]).toEqual({ errors: ["fx_api.sales.nope: unknown column"] });
    expect(results[1].data[0]).toEqual(["north", "south"]);
  });

  it("answers formula and named measures, taking the dashboard's measures from the request", async () => {
    scope = { tenantIds: [1, 2] };
    const res = await query({
      measures: [{ name: "Doubled", formula: "SUM(sales.amount) * 2" }],
      queries: [
        {
          dimensions: [{ field: "fx_api.sales.region" }],
          measures: [{ name: "Doubled" }, { formula: "COUNT(sales.id) / 2" }],
        },
        { measures: [{ formula: "SUM(sales.nope)" }] },
      ],
    });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0]).toMatchObject({
      columns: [
        { key: "d0", kind: "dimension" },
        { key: "m0", kind: "measure", name: "Doubled", type: "number" },
        { key: "m1", kind: "measure", formula: "COUNT(sales.id) / 2", type: "number" },
      ],
      data: [
        ["north", "south"],
        [80, 40],
        [1, 0.5],
      ],
    });
    expect(results[1]).toEqual({
      errors: ["measures[0]: unknown column sales.nope (characters 4–14)"],
    });
  });

  it("fails closed when the scope lacks a policy's list, without naming the policy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scope = { userId: "x" };
    const res = await query({ queries: [byRegion] });
    expect((await res.json()).results[0]).toEqual({
      errors: ["This query is outside your data scope"],
    });
    expect(String(warn.mock.calls[0]?.[0])).toContain("scope has no list tenantIds");
    warn.mockRestore();
    scope = { tenantIds: [1, 2] };
  });

  it("logs each query with a scope hash, rows and duration, never the tenant ids", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    scope = { tenantIds: [1, 2] };
    await query({ queries: [byRegion] });
    const line = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(line).toMatchObject({ level: "info", msg: "query", cache: "miss", rows: 2 });
    expect(line.scopeHash).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof line.ms).toBe("number");
    expect(JSON.stringify(line)).not.toContain("tenant");
    info.mockRestore();
  });

  it("fails the request when a policy's column does not exist", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const typo = createGateway(
      defineGateway({
        source: postgresSource({
          url:
            process.env.DASH_SOURCE_URL ??
            "postgres://dash_reader:password@localhost:54322/postgres",
        }),
        auth: jwtAuth({ jwksUrl: jwks.url, issuer: ISSUER, audience: AUDIENCE }),
        identity: { claim: "sub", format: "uuid" },
        tables: ["fx_api.sales"],
        policies: [{ table: "fx_api.sales", column: "tenant", in: "tenantIds" }],
        resolveScope: async () => ({ tenantIds: [1] }),
      }),
    );
    const res = await typo(
      new Request("http://demo.test/api/dash/query", {
        method: "POST",
        headers: { ...(await bearer()), "content-type": "application/json" },
        body: JSON.stringify({ queries: [byRegion] }),
      }),
    );
    expect(res.status).toBe(500);
    expect(String(error.mock.calls[0]?.[0])).toContain("policy on fx_api.sales: no column tenant");
    error.mockRestore();
  });
});
