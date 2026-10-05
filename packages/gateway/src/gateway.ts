import { type DataContract, type QuerySpec, queryRequest } from "@adam-riffi/dash-core";
import { AuthError, authenticate } from "./auth.ts";
import type { GatewayConfig } from "./config.ts";
import { inferContract } from "./contract/index.ts";
import { introspect } from "./contract/introspect.ts";
import { health } from "./health.ts";
import { compileQuery } from "./query/compile.ts";
import { executeQuery, type QueryResult } from "./query/execute.ts";
import { planJoins } from "./query/paths.ts";
import { validateQuery } from "./query/validate.ts";

type Handler = (request: Request) => Promise<Response>;
type Log = (level: "warn" | "error", msg: string, cause: string) => void;
interface Route {
  methods: string[];
  handle: (request: Request, log: Log) => Promise<Response>;
}

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
 * Scope entries as transaction-local settings for row-level security (DESIGN.md §6):
 * `tenantIds: [1, 2]` becomes `app.tenant_ids = '1,2'`. Only lists and plain values are mapped.
 */
export function settingsFor(scope: Record<string, unknown>): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(scope)) {
    const name = `app.${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
    if (Array.isArray(value)) settings[name] = value.join(",");
    else if (["string", "number", "boolean"].includes(typeof value)) settings[name] = String(value);
  }
  return settings;
}

/**
 * The gateway HTTP API (DESIGN.md §7) as a Fetch handler. Routes are matched on the last path
 * segment, so the handler mounts under any prefix (`/api/dash` in the demo).
 */
export function createGateway(config: GatewayConfig): Handler {
  // The contract cache arrives in M6; until then every request introspects.
  const contract = async () =>
    inferContract(await introspect(config.source(), config.tables), { tables: config.tables });

  async function runQuery(
    spec: QuerySpec,
    current: DataContract,
    scope: Record<string, unknown>,
    log: Log,
  ): Promise<QueryResult | { errors: string[] }> {
    const valid = validateQuery(spec, current);
    if (!valid.ok) return { errors: valid.errors };
    const planned = planJoins(valid.query, current);
    if (!planned.ok) return { errors: planned.errors };
    const compiled = compileQuery(valid.query, planned.plan, config.policies ?? [], scope);
    if (!compiled.ok) return { errors: compiled.errors };
    try {
      return await executeQuery(config.source(), compiled.query, {
        limit: valid.query.limit,
        settings: settingsFor(scope),
      });
    } catch (error) {
      log("error", "query failed", error instanceof Error ? error.message : String(error));
      return { errors: ["Query failed"] };
    }
  }

  const routes = new Map<string, Route>([
    [
      "health",
      {
        methods: ["GET", "HEAD"],
        handle: async () => {
          const { status, body } = await health(config.source());
          return json(body, status);
        },
      },
    ],
    [
      "contract",
      {
        methods: ["GET", "HEAD"],
        handle: async (request) => {
          await authenticate(request, config.auth, config.identity);
          // The served body depends only on the schema hash, so the ETag can be strong.
          const served = withoutStatistics(await contract());
          const headers = {
            etag: `"${served.contractVersion}"`,
            "cache-control": "private, no-cache",
          };
          if (matches(request.headers.get("if-none-match"), headers.etag)) {
            return new Response(null, { status: 304, headers });
          }
          return json(served, 200, headers);
        },
      },
    ],
    [
      "query",
      {
        methods: ["POST"],
        handle: async (request, log) => {
          const { claims } = await authenticate(request, config.auth, config.identity);
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ error: "Request body must be JSON" }, 400);
          }
          const parsed = queryRequest.safeParse(body);
          if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
            return json({ error: "Invalid request", issues }, 400);
          }
          const scope = (await config.resolveScope?.(claims)) ?? {};
          const current = await contract();
          const results = [];
          // One connection per instance (max 1), so queries run one after another.
          for (const spec of parsed.data.queries) {
            results.push(await runQuery(spec, current, scope, log));
          }
          return json({ results }, 200, { "cache-control": "private, no-store" });
        },
      },
    ],
  ]);

  return async (request) => {
    const started = performance.now();
    const name = new URL(request.url).pathname.split("/").at(-1) ?? "";
    const route = routes.get(name);
    if (!route) return json({ error: "Not found" }, 404);
    if (!route.methods.includes(request.method)) {
      return json({ error: "Method not allowed" }, 405, { allow: route.methods.join(", ") });
    }
    const log: Log = (level, msg, cause) =>
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
      return await route.handle(request, log);
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
