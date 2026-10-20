import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway, defineGateway, memoryCache } from "../../src/index.ts";

const USER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
type Run = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * A client for a database with one table, `s.t (id int4, n numeric)`: it answers introspection
 * and `select 1`, and runs compiled queries with `run`, the way postgres.js does inside a
 * read-only transaction.
 */
function client(run: Run) {
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("from pg_class")) {
      return Promise.resolve([{ oid: "1", name: "s.t", reltuples: 0 }]);
    }
    if (text.includes("from pg_attribute")) {
      return Promise.resolve([
        { oid: "1", name: "id", pg_type: "int4", is_enum: false, nullable: false },
        { oid: "1", name: "n", pg_type: "numeric", is_enum: false, nullable: false },
      ]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(() => Promise.resolve([]), { unsafe: run });
  return Object.assign(sql, {
    begin: async (_mode: string, fn: (t: typeof tx) => unknown) => fn(tx),
    end: async () => {},
  });
}

function gateway(run: Run, options: { explain?: boolean } = {}) {
  const db = client(run);
  return createGateway(
    defineGateway({
      source: () => db as never,
      auth: async () => ({ sub: USER }),
      identity: { claim: "sub", format: "uuid" },
      tables: ["s.t"],
      cache: memoryCache({ maxBytes: 1_000_000 }),
      ...options,
    }),
  );
}

const total = { measures: [{ field: "s.t.n" }] };
const post = (handle: ReturnType<typeof gateway>, body: unknown, headers = {}) =>
  handle(
    new Request("http://demo.test/api/dash/query", {
      method: "POST",
      headers: { authorization: "Bearer t", ...headers },
      body: JSON.stringify(body),
    }),
  );
const get = (handle: ReturnType<typeof gateway>, path: string, headers = {}) =>
  handle(
    new Request(`http://demo.test/api/dash/${path}`, {
      headers: { authorization: "Bearer t", ...headers },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe("POST /query on a database (DESIGN.md §7)", () => {
  it("answers a query, serves it again from the cache, and 304s when nothing changed", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const run = vi.fn<Run>(async () => [{ m0: "3.5" }]);
    const handle = gateway(run);

    const first = await post(handle, { queries: [total] });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.results[0]).toMatchObject({ data: [[3.5]], meta: { cache: "miss" } });
    expect(run.mock.calls[0]?.[0]).toContain('sum("t0"."n")');

    const again = await (await post(handle, { queries: [total] })).json();
    expect(again.results[0]).toMatchObject({ data: [[3.5]], meta: { cache: "hit" } });
    expect(run).toHaveBeenCalledTimes(1);

    const etag = first.headers.get("etag") ?? "";
    expect((await post(handle, { queries: [total] }, { "if-none-match": etag })).status).toBe(304);
    // DESIGN.md §13: each query is logged with a scope hash, its cache status and rows.
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      msg: "query",
      cache: "miss",
      rows: 1,
      scopeHash: expect.any(String),
    });
  });

  it("answers each query on its own: an invalid one gets its errors, the others their data", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handle = gateway(async () => [{ m0: "1" }]);
    const body = await (
      await post(handle, { queries: [{ measures: [{ field: "s.t.nope" }] }, total] })
    ).json();
    expect(body.results[0]).toEqual({ errors: ["s.t.nope: unknown column"] });
    expect(body.results[1]).toMatchObject({ data: [[1]] });
  });

  it("explains the SQL, its parameters and the scope when configured", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handle = gateway(async () => [{ m0: "2" }], { explain: true });
    const body = await (await post(handle, { queries: [total] })).json();
    expect(body.results[0].meta.explain).toMatchObject({
      sql: expect.stringContaining('from "s"."t"'),
      params: expect.any(Array),
      scope: {},
    });
  });

  it("turns a failed query into an error for that visual, and logs the cause", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = gateway(async () => {
      throw new Error("canceling statement due to statement timeout");
    });
    const body = await (await post(handle, { queries: [total] })).json();
    expect(body.results[0]).toEqual({ errors: ["Query failed"] });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      msg: "query failed",
      cause: "canceling statement due to statement timeout",
    });
  });
});

describe("GET /contract and /health on a database", () => {
  it("serves the contract with its version as ETag, and 304s when unchanged", async () => {
    const handle = gateway(async () => []);
    const first = await get(handle, "contract");
    expect(first.status).toBe(200);
    expect((await first.json()).tables[0].name).toBe("s.t");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect((await get(handle, "contract", { "if-none-match": etag })).status).toBe(304);
  });

  it("answers health ok when the database answers", async () => {
    const res = await get(
      gateway(async () => []),
      "health",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });
});
