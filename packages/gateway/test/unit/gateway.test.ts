import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/auth.ts";
import { matches, settingsFor, withoutStatistics } from "../../src/gateway.ts";
import { createGateway, defineGateway, postgresSource } from "../../src/index.ts";

/** A gateway whose database must not be touched: every test here stops before any query. */
const source = vi.fn(() => {
  throw new Error("the database must not be reached");
});
const handle = createGateway(
  defineGateway({
    source,
    auth: async () => {
      throw new Error("bad signature");
    },
    identity: { claim: "sub", format: "uuid" },
    tables: ["s.t"],
  }),
);
const call = (path: string, init: RequestInit = {}) =>
  handle(new Request(`http://demo.test/api/dash/${path}`, init));

afterEach(() => {
  source.mockClear();
  vi.restoreAllMocks();
});

describe("gateway handler (no database)", () => {
  it("never reaches the database before authentication", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await call("contract")).status).toBe(401);
    const bad = await call("contract", { headers: { authorization: "Bearer t" } });
    expect(await bad.json()).toEqual({ error: "Invalid token" });
    expect(source).not.toHaveBeenCalled();
  });

  it("answers HEAD like GET", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await call("contract", { method: "HEAD" })).status).toBe(401);
  });

  it("answers 404 for unknown routes and 405 with Allow for other methods", async () => {
    expect((await call("nope")).status).toBe(404);
    const res = await call("contract", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("logs unauthorized requests with a request id and duration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call("contract", { headers: { "x-vercel-id": "cdg1::abc" } });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      level: "warn",
      msg: "request unauthorized",
      route: "contract",
      requestId: "cdg1::abc",
      ms: expect.any(Number),
    });
  });

  it("turns unexpected failures into a logged 500 without details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("health");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      route: "health",
      cause: "the database must not be reached",
      requestId: expect.any(String),
    });
  });

  it("keeps AuthError messages for the response", () => {
    expect(new AuthError("Missing bearer token").message).toBe("Missing bearer token");
  });
});

describe("postgresSource", () => {
  it("connects lazily and fails loudly on an empty URL", () => {
    const empty = postgresSource({ url: "" });
    expect(() => empty()).toThrow("postgresSource: the connection URL is empty");
  });

  it("reuses one client per source", () => {
    const get = postgresSource({ url: "postgres://u:p@127.0.0.1:1/db" });
    expect(get()).toBe(get());
  });
});

describe("served contracts", () => {
  it("drop row counts and distinct estimates but keep the high-cardinality flag", () => {
    const contract = withoutStatistics({
      contractVersion: "a".repeat(64),
      relationships: [],
      measures: [],
      tables: [
        {
          name: "s.t",
          rowCount: 1200,
          primaryKey: [],
          columns: [
            {
              name: "email",
              pgType: "text",
              type: "string",
              nullable: false,
              role: "dimension",
              distinct: 12_000,
              highCardinality: true,
            },
          ],
        },
      ],
    });
    expect(contract.tables[0]).toMatchObject({ rowCount: null });
    expect(contract.tables[0]?.columns[0]).toMatchObject({ distinct: null, highCardinality: true });
  });

  it.each([
    ['"v1"', true],
    ['W/"v1"', true],
    ['"v0", W/"v1"', true],
    ["*", true],
    ['"v0"', false],
    [null, false],
  ])("If-None-Match %s matches %s", (header, expected) => {
    expect(matches(header, '"v1"')).toBe(expected);
  });
});

describe("POST /query (no database)", () => {
  const USER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const signedIn = createGateway(
    defineGateway({
      source,
      auth: async () => ({ sub: USER }),
      identity: { claim: "sub", format: "uuid" },
      tables: ["s.t"],
      measures: [{ name: "Revenue", formula: "SUM(t.n)" }],
    }),
  );
  const post = (body: string, path = "query") =>
    signedIn(
      new Request(`http://demo.test/api/dash/${path}`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body,
      }),
    );

  it("allows only POST on /query and only GET or HEAD on /contract", async () => {
    const get = await signedIn(new Request("http://demo.test/api/dash/query"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const postContract = await post("{}", "contract");
    expect(postContract.status).toBe(405);
    expect(postContract.headers.get("allow")).toBe("GET, HEAD");
  });

  it("authenticates before reading the body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("query", { method: "POST", body: "not json" });
    expect(res.status).toBe(401);
    expect(source).not.toHaveBeenCalled();
  });

  it.each([
    ["not json", "Request body must be JSON"],
    [JSON.stringify({ queries: [] }), "Invalid request"],
    [
      JSON.stringify({
        queries: Array.from({ length: 21 }, () => ({ measures: [{ field: "s.t.c" }] })),
      }),
      "Invalid request",
    ],
    [
      JSON.stringify({ queries: [{ measures: [{ field: "s.t.c" }], sql: "drop table t" }] }),
      "Invalid request",
    ],
  ])("answers 400 to a bad body without touching the database (%#)", async (body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
    expect(source).not.toHaveBeenCalled();
  });
});

describe("settingsFor", () => {
  it("maps scope entries to transaction-local app.* settings for RLS", () => {
    expect(
      settingsFor({ tenantIds: [1, 2], userId: "u-1", region: "eu", nested: { a: 1 } }),
    ).toEqual({
      "app.tenant_ids": "1,2",
      "app.user_id": "u-1",
      "app.region": "eu",
    });
  });
});

describe("POST /query guards (no database)", () => {
  const USER = "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const body = (n: number) =>
    JSON.stringify({
      queries: Array.from({ length: n }, () => ({ measures: [{ field: "s.t.c" }] })),
    });
  const gateway = (extra: Partial<Parameters<typeof defineGateway>[0]> = {}) =>
    createGateway(
      defineGateway({
        source,
        auth: async () => ({ sub: USER }),
        identity: { claim: "sub", format: "uuid" },
        tables: ["s.t"],
        ...extra,
      }),
    );
  const post = (handler: ReturnType<typeof createGateway>, n: number) =>
    handler(
      new Request("http://demo.test/api/dash/query", {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: body(n),
      }),
    );

  it("refuses to start with a policy on a table outside the allowlist", () => {
    expect(() =>
      gateway({ policies: [{ table: "s.other", column: "tenant_id", in: "tenantIds" }] }),
    ).toThrow("policy on s.other: the table is not in the allowlist");
  });

  it("limits each user to 60 queries a minute before touching the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = gateway();
    for (let i = 0; i < 3; i++) expect((await post(handler, 20)).status).toBe(500);
    const limited = await post(handler, 1);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: "Too many queries; try again shortly" });
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("answers 500 without touching the database when the scope cannot be resolved", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(
      gateway({
        resolveScope: async () => {
          throw new Error("memberships database is down");
        },
      }),
      1,
    );
    expect(res.status).toBe(500);
    expect(source).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain("memberships database is down");
  });

  it("refuses scope values that would widen a comma-separated RLS list", () => {
    expect(() => settingsFor({ tenantIds: ["1,2"] })).toThrow("tenantIds");
    expect(() => settingsFor({ tenantIds: [{ id: 1 }] })).toThrow("tenantIds");
  });
});

describe("host measures in the configuration (ADR 0007)", () => {
  const config = (measures: { name: string; formula: string }[]) =>
    defineGateway({
      source,
      auth: async () => ({ sub: "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }),
      identity: { claim: "sub", format: "uuid" },
      tables: ["s.t"],
      measures,
    });

  it("refuses duplicate or unusable names at startup", () => {
    const m = { name: "Revenue", formula: "SUM(t.n)" };
    expect(() => createGateway(config([m, m]))).toThrow("host measure names must be unique");
    expect(() => createGateway(config([{ ...m, name: "a]b" }]))).toThrow();
  });

  it("refuses dashboard measures that reuse a host measure's name, before any query", async () => {
    const res = await createGateway(config([{ name: "Revenue", formula: "SUM(t.n)" }]))(
      new Request("http://demo.test/api/dash/query", {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({
          measures: [{ name: "Revenue", formula: "COUNT(t.n)" }],
          queries: [{ measures: [{ name: "Revenue" }] }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid request",
      issues: ["measures: Revenue is already defined by the host"],
    });
    expect(source).not.toHaveBeenCalled();
  });
});
