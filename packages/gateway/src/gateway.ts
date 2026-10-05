import type { DataContract } from "@adam-riffi/dash-core";
import { AuthError, authenticate } from "./auth.ts";
import type { GatewayConfig } from "./config.ts";
import { inferContract } from "./contract/index.ts";
import { introspect } from "./contract/introspect.ts";
import { health } from "./health.ts";

type Handler = (request: Request) => Promise<Response>;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

/** Statistics stay server-side (ADR 0005): `reltuples` ignores RLS and would leak row totals. */
export const withoutStatistics = (contract: DataContract): DataContract => ({
  ...contract,
  tables: contract.tables.map((t) => ({
    ...t,
    rowCount: null,
    columns: t.columns.map((c) => ({ ...c, distinct: null })),
  })),
});

/** `If-None-Match` per RFC 9110: a list of tags, weak comparison, or `*`. */
export const matches = (header: string | null, etag: string) =>
  (header ?? "").split(",").some((tag) => {
    const t = tag.trim();
    return t === "*" || t.replace(/^W\//, "") === etag;
  });

/**
 * The gateway HTTP API (DESIGN.md §7) as a Fetch handler. Routes are matched on the last path
 * segment, so the handler mounts under any prefix (`/api/dash` in the demo).
 */
export function createGateway(config: GatewayConfig): Handler {
  const routes = new Map<string, Handler>([
    [
      "health",
      async () => {
        const { status, body } = await health(config.source());
        return json(body, status);
      },
    ],
    [
      "contract",
      async (request) => {
        await authenticate(request, config.auth, config.identity);
        const catalog = await introspect(config.source(), config.tables);
        // The served body depends only on the schema hash, so the ETag can be strong.
        const contract = withoutStatistics(inferContract(catalog, { tables: config.tables }));
        // The contract cache arrives in M6; until then every request introspects.
        const headers = {
          etag: `"${contract.contractVersion}"`,
          "cache-control": "private, no-cache",
        };
        if (matches(request.headers.get("if-none-match"), headers.etag)) {
          return new Response(null, { status: 304, headers });
        }
        return json(contract, 200, headers);
      },
    ],
  ]);

  return async (request) => {
    const started = performance.now();
    const name = new URL(request.url).pathname.split("/").at(-1) ?? "";
    const route = routes.get(name);
    if (!route) return json({ error: "Not found" }, 404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405, { allow: "GET, HEAD" });
    }
    const log = (level: "warn" | "error", msg: string, cause: string) =>
      console[level](
        JSON.stringify({
          level,
          msg,
          route: name,
          requestId: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
          ms: Math.round(performance.now() - started),
          cause,
        }),
      );
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof AuthError) {
        const cause = error.cause instanceof Error ? error.cause.message : error.message;
        log("warn", "request unauthorized", cause);
        return json({ error: error.message }, 401, { "www-authenticate": "Bearer" });
      }
      log(
        "error",
        "gateway request failed",
        error instanceof Error ? error.message : String(error),
      );
      return json({ error: "Internal error" }, 500);
    }
  };
}
