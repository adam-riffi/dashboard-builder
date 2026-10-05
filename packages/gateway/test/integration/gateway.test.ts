import { dataContract } from "@adam-riffi/dash-core";
import { afterAll, describe, expect, it, vi } from "vitest";
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
