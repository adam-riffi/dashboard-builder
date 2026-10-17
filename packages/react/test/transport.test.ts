import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError, gatewayTransport } from "../src/index.ts";

afterEach(() => vi.unstubAllGlobals());

describe("gatewayTransport", () => {
  it("sends the current token on every request and unwraps the results", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ results: [{ errors: ["x"] }] }),
    );
    vi.stubGlobal("fetch", fetch);
    let token = "first";
    const transport = gatewayTransport("/api/dash", () => token);
    expect(await transport.query({ queries: [] })).toEqual([{ errors: ["x"] }]);
    token = "refreshed";
    await transport.contract();
    expect(
      fetch.mock.calls.map(([url, init]) => [url, new Headers(init?.headers).get("authorization")]),
    ).toEqual([
      ["/api/dash/query", "Bearer first"],
      ["/api/dash/contract", "Bearer refreshed"],
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ queries: [] }),
    });
  });

  it("fails with the gateway's status, so 4xx answers are not retried", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429 })),
    );
    const failure = gatewayTransport("/api/dash", () => "t").query({ queries: [] });
    await expect(failure).rejects.toBeInstanceOf(GatewayError);
    await expect(failure).rejects.toMatchObject({ status: 429 });
  });

  it("asks with the last tag, and keeps its results when the gateway answers 304", async () => {
    const results = [{ errors: ["first answer"] }];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get("if-none-match") === '"t1"'
        ? new Response(null, { status: 304, headers: { etag: '"t1"' } })
        : Response.json({ results }, { headers: { etag: '"t1"' } }),
    );
    vi.stubGlobal("fetch", fetch);
    const transport = gatewayTransport("/api/dash", () => "t");
    const request = { queries: [{ dimensions: [], measures: [{ name: "Revenue" }], filters: [] }] };
    expect(await transport.query(request)).toEqual(results);
    expect(await transport.query(request)).toEqual(results);
    expect(
      fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("if-none-match")),
    ).toEqual([null, '"t1"']);
    // Another request has no tag of its own yet.
    await transport.query({ ...request, maxAgeSec: 5 });
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("if-none-match")).toBeNull();
  });
});
