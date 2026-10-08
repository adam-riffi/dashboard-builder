import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError, gatewayTransport } from "../src/index.ts";

afterEach(() => vi.unstubAllGlobals());

describe("gatewayTransport", () => {
  it("sends the current token on every request and unwraps the results", async () => {
    const fetch = vi.fn(async () => Response.json({ results: [{ errors: ["x"] }] }));
    vi.stubGlobal("fetch", fetch);
    let token = "first";
    const transport = gatewayTransport("/api/dash", () => token);
    expect(await transport.query({ queries: [] })).toEqual([{ errors: ["x"] }]);
    token = "refreshed";
    await transport.contract();
    expect(
      fetch.mock.calls.map(([url, init]) => [
        url,
        (init?.headers as Record<string, string>).authorization,
      ]),
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
});
