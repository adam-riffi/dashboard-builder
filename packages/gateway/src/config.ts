import type { JWTPayload } from "jose";
import postgres from "postgres";
import type { IdentityConfig, Verifier } from "./auth.ts";
import type { Policy } from "./query/compile.ts";

/** Host configuration (DESIGN.md §7); secrets come from environment variables. */
export interface GatewayConfig {
  /** The source database, connected as a read-only role. */
  source: () => postgres.Sql;
  auth: Verifier;
  identity: IdentityConfig;
  /** Allowlisted tables, `schema.table`. */
  tables: string[];
  /** Row policies injected into every query that touches their table (DESIGN.md §6). */
  policies?: Policy[];
  /**
   * The caller's security context, e.g. `{ userId, tenantIds }`. Its entries feed the policies and
   * become transaction-local `app.*` settings for row-level security.
   */
  resolveScope?: (claims: JWTPayload) => Promise<Record<string, unknown>>;
}

/** Typed identity function for `dash.config.ts`. */
export const defineGateway = (config: GatewayConfig): GatewayConfig => config;

/**
 * A lazily opened connection: one per function instance, idle connections closed, and prepared
 * statements off because the Supabase transaction pooler does not support them.
 */
export function postgresSource({ url }: { url: string }): () => postgres.Sql {
  let sql: postgres.Sql | undefined;
  return () => {
    if (!url) throw new Error("postgresSource: the connection URL is empty");
    sql ??= postgres(url, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 20 });
    return sql;
  };
}
