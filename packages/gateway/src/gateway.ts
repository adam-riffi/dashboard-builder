import { createHash } from "node:crypto";
import { type DataContract, type QuerySpec, queryRequest } from "@adam-riffi/dash-core";
import { AuthError, authenticate } from "./auth.ts";
import type { GatewayConfig } from "./config.ts";
import { inferContract } from "./contract/index.ts";
import { introspect } from "./contract/introspect.ts";
import { health } from "./health.ts";
import { policyConfigErrors, policyContractErrors } from "./policies.ts";
import { compileQuery } from "./query/compile.ts";
import { executeQuery, type QueryResult } from "./query/execute.ts";
import { planJoins } from "./query/paths.ts";
import { validateQuery } from "./query/validate.ts";
import { createRateLimiter, QUERIES_PER_MINUTE } from "./ratelimit.ts";

type Handler = (request: Request) => Promise<Response>;
type Log = (
  level: "info" | "warn" | "error",
  msg: string,
  details: Record<string, unknown>,
) => void;
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
    if (Array.isArray(value)) {
      // A comma inside a value would add entries to the list the RLS policy reads: fail closed.
      const safe = value.every(
        (v) => typeof v === "number" || (typeof v === "string" && !v.includes(",")),
      );
      if (!safe) throw new Error(`scope list ${key} holds a value RLS settings cannot carry`);
      settings[name] = value.join(",");
    } else if (["string", "number", "boolean"].includes(typeof value))
      settings[name] = String(value);
  }
  return settings;
}

/**
 * The gateway HTTP API (DESIGN.md §7) as a Fetch handler. Routes are matched on the last path
 * segment, so the handler mounts under any prefix (`/api/dash` in the demo).
 */
export function createGateway(config: GatewayConfig): Handler {
  const policies = config.policies ?? [];
  const misconfigured = policyConfigErrors(policies, config.tables);
  if (misconfigured.length > 0) throw new Error(misconfigured.join("; "));
  const limiter = createRateLimiter({ limit: QUERIES_PER_MINUTE, windowMs: 60_000 });

  // The contract cache arrives in M6; until then every request introspects.
  const contract = async () =>
    inferContract(await introspect(config.source(), config.tables), { tables: config.tables });

  async function runQuery(
    spec: QuerySpec,
    current: DataContract,
    scope: Record<string, unknown>,
    scopeHash: string,
    log: Log,
  ): Promise<QueryResult | { errors: string[] }> {
    const valid = validateQuery(spec, current);
    if (!valid.ok) return { errors: valid.errors };
    const planned = planJoins(valid.query, current);
    if (!planned.ok) return { errors: planned.errors };
    const compiled = compileQuery(valid.query, planned.plan, policies, scope);
    if (!compiled.ok) {
      // The policy and scope names stay in the logs.
      log("warn", "query outside scope", { cause: compiled.errors.join("; ") });
      return { errors: ["This query is outside your data scope"] };
    }
    try {
      const result = await executeQuery(config.source(), compiled.query, {
        limit: valid.query.limit,
        settings: settingsFor(scope),
      });
      // DESIGN.md §13: a scope hash, never the tenant ids.
      log("info", "query", {
        scopeHash,
        cache: result.meta.cache,
        rows: result.data[0]?.length ?? 0,
        truncated: result.meta.truncated,
        ms: result.meta.ms,
      });
      return result;
    } catch (error) {
      log("error", "query failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
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
          const { id, claims } = await authenticate(request, config.auth, config.identity);
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
          const allowed = limiter.take(id, parsed.data.queries.length);
          if (!allowed.ok) {
            return json({ error: "Too many queries; try again shortly" }, 429, {
              "retry-after": String(allowed.retryAfterSeconds),
            });
          }
          const scope = (await config.resolveScope?.(claims)) ?? {};
          const scopeHash = createHash("sha256")
            .update(JSON.stringify(Object.entries(scope).sort()))
            .digest("hex")
            .slice(0, 16);
          const current = await contract();
          const broken = policyContractErrors(policies, current);
          if (broken.length > 0) throw new Error(broken.join("; "));
          const results = [];
          // One connection per instance (max 1), so queries run one after another.
          for (const spec of parsed.data.queries) {
            results.push(await runQuery(spec, current, scope, scopeHash, log));
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
    const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
    const log: Log = (level, msg, details) =>
      console[level](
        JSON.stringify({
          level,
          msg,
          route: name,
          requestId,
          ms: Math.round(performance.now() - started),
          ...details,
        }),
      );
    try {
      return await route.handle(request, log);
    } catch (error) {
      if (error instanceof AuthError) {
        const cause = error.cause instanceof Error ? error.cause.message : error.message;
        log("warn", "request unauthorized", { cause });
        return json({ error: error.message }, 401, { "www-authenticate": "Bearer" });
      }
      log("error", "gateway request failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
      return json({ error: "Internal error" }, 500);
    }
  };
}
