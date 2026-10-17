import { createHash } from "node:crypto";
import {
  type Checking,
  type DataContract,
  namedMeasure,
  type QuerySpec,
  queryRequest,
} from "@adam-riffi/dash-core";
import { AuthError, authenticate } from "./auth.ts";
import { resultKey, scopeHashOf } from "./cache.ts";
import type { GatewayConfig } from "./config.ts";
import { cachedContract } from "./contract/cache.ts";
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
/** Names the part of a request now running, for the slow-request log. */
type Step = (stage: "auth" | "contract" | "scope" | "query") => void;
interface Route {
  methods: string[];
  handle: (request: Request, log: Log, step: Step) => Promise<Response>;
}

/** A request still running after this long is logged with the stage it is in. */
const SLOW_MS = 10_000;

/** A request without `maxAgeSec` accepts results this old: a dashboard's default refresh. */
const DEFAULT_MAX_AGE_SEC = 60;

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

/**
 * The ETag of a `POST /query` answer: its results without timing and cache status, so a
 * refresh that finds the same rows gets `304` (DESIGN.md §6).
 */
export function resultsTag(results: (QueryResult | { errors: string[] })[]): string {
  const stable = results.map((r) =>
    "errors" in r ? r : { columns: r.columns, data: r.data, truncated: r.meta.truncated },
  );
  return `"${createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32)}"`;
}

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
  const hostMeasures = (config.measures ?? []).map((m) => namedMeasure.parse(m));
  const host = new Map(hostMeasures.map((m) => [m.name, m.formula]));
  if (host.size !== hostMeasures.length) throw new Error("host measure names must be unique");
  const limiter = createRateLimiter({ limit: QUERIES_PER_MINUTE, windowMs: 60_000 });

  // One contract per instance, checked again every minute (DESIGN.md §6).
  const contract = cachedContract(async () =>
    inferContract(await introspect(config.source(), config.tables), {
      tables: config.tables,
      measures: hostMeasures,
    }),
  );

  async function runQuery(
    spec: QuerySpec,
    current: DataContract,
    named: ReadonlyMap<string, string>,
    memo: Map<string, Checking>,
    scope: Record<string, unknown>,
    scopeHash: string,
    maxAgeMs: number,
    log: Log,
  ): Promise<QueryResult | { errors: string[] }> {
    const valid = validateQuery(spec, current, named, memo);
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
      const started = performance.now();
      const key = resultKey({
        scopeHash,
        contractVersion: current.contractVersion,
        sql: compiled.query.text,
        params: compiled.query.params,
      });
      const cached = config.cache?.get(key, maxAgeMs);
      const result: QueryResult = cached
        ? {
            ...cached,
            meta: { ...cached.meta, cache: "hit", ms: Math.round(performance.now() - started) },
          }
        : await executeQuery(config.source(), compiled.query, {
            limit: valid.query.limit,
            settings: settingsFor(scope),
          });
      if (!cached) config.cache?.set(key, result);
      // DESIGN.md §13: a scope hash, never the tenant ids.
      log("info", "query", {
        scopeHash: scopeHash.slice(0, 16),
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
        handle: async (request, _log, step) => {
          await authenticate(request, config.auth, config.identity);
          step("contract");
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
        handle: async (request, log, step) => {
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
          step("scope");
          const scope = (await config.resolveScope?.(claims)) ?? {};
          const scopeHash = scopeHashOf(scope);
          // Results no older than the dashboard's refresh interval (DESIGN.md §6, ADR 0010).
          const maxAgeMs = (parsed.data.maxAgeSec ?? DEFAULT_MAX_AGE_SEC) * 1000;
          step("contract");
          const current = await contract();
          const broken = policyContractErrors(policies, current);
          if (broken.length > 0) throw new Error(broken.join("; "));
          const results = [];
          // The host's measures and the dashboard's own, which shadow host ones of the same name
          // so that saved dashboards keep working when a host adds a measure (ADR 0007).
          const named = new Map([
            ...host,
            ...(parsed.data.measures ?? []).map((m): [string, string] => [m.name, m.formula]),
          ]);
          // One connection per instance (max 1), so queries run one after another.
          const memo = new Map<string, Checking>();
          step("query");
          for (const spec of parsed.data.queries) {
            results.push(
              await runQuery(spec, current, named, memo, scope, scopeHash, maxAgeMs, log),
            );
          }
          const headers = { etag: resultsTag(results), "cache-control": "private, no-store" };
          if (matches(request.headers.get("if-none-match"), headers.etag)) {
            return new Response(null, { status: 304, headers });
          }
          return json({ results }, 200, headers);
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
    // Every route starts by verifying the token. A request that has not finished after SLOW_MS
    // is logged with the stage it is in, so a hang shows where it is stuck.
    let stage = "auth";
    const slow = setTimeout(() => log("warn", "request slow", { stage }), SLOW_MS);
    try {
      return await route.handle(request, log, (next) => {
        stage = next;
      });
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
    } finally {
      clearTimeout(slow);
    }
  };
}
