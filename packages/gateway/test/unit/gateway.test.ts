import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/auth.ts";
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
