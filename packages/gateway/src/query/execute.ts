import type postgres from "postgres";
import type { CompiledQuery } from "./compile.ts";
import { type ShapedResult, shapeResult } from "./result.ts";

export interface ExecuteOptions {
  /** Rows the caller asked for; the compiled query fetches one more. */
  limit: number;
  /** Transaction-local settings for row-level security, e.g. `app.tenant_ids`. */
  settings: Record<string, string>;
  timeoutMs?: number;
}

export interface QueryResult extends Omit<ShapedResult, "truncated"> {
  meta: { cache: "miss"; ms: number; truncated: boolean };
}

/**
 * Runs one compiled query (DESIGN.md §6). It runs in its own transaction with a statement
 * timeout, UTC time (so time grains do not depend on the server's zone) and the RLS settings,
 * which stay local to the transaction: a later query on the same pooled connection never sees
 * them. The result cache arrives in M6.
 */
export async function executeQuery(
  sql: postgres.Sql,
  query: CompiledQuery,
  { limit, settings, timeoutMs = 2_000 }: ExecuteOptions,
): Promise<QueryResult> {
  const started = performance.now();
  const rows = await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', ${String(timeoutMs)}, true)`;
    await tx`select set_config('TimeZone', 'UTC', true)`;
    for (const [name, value] of Object.entries(settings)) {
      await tx`select set_config(${name}, ${value}, true)`;
    }
    return tx.unsafe(query.text, query.params as postgres.ParameterOrJSON<never>[]);
  });
  const { truncated, ...shaped } = shapeResult(rows, query.columns, limit);
  return {
    ...shaped,
    meta: { cache: "miss", ms: Math.round(performance.now() - started), truncated },
  };
}
