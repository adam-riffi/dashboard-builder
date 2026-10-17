import { createHash } from "node:crypto";
import type { QueryResult } from "./query/execute.ts";

/**
 * The result cache (DESIGN.md §6). An entry serves a request only while it is younger than that
 * request's limit (its dashboard's refresh interval), so the TTL is the smallest interval among
 * the visuals asking.
 */
export interface ResultCache {
  get(key: string, maxAgeMs: number): QueryResult | undefined;
  set(key: string, result: QueryResult): void;
}

/**
 * Results in memory, per function instance; the least recently used go first past `maxBytes`.
 * Sizes are the results' JSON bytes: the objects in memory take a few times more, so leave room.
 */
export function memoryCache({
  maxBytes,
  now = Date.now,
}: {
  maxBytes: number;
  now?: () => number;
}): ResultCache {
  // A Map iterates in insertion order: re-inserting on use keeps the least recently used first.
  const entries = new Map<string, { result: QueryResult; bytes: number; at: number }>();
  let total = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    total -= entry.bytes;
    entries.delete(key);
  };
  return {
    get(key, maxAgeMs) {
      const entry = entries.get(key);
      if (!entry || now() - entry.at > maxAgeMs) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.result;
    },
    set(key, result) {
      drop(key);
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes > maxBytes) return;
      entries.set(key, { result, bytes, at: now() });
      total += bytes;
      for (const oldest of entries.keys()) {
        if (total <= maxBytes) break;
        drop(oldest);
      }
    },
  };
}

/**
 * The key of a query's result: the caller's scope first, then everything that decides the rows.
 * It hashes the compiled SQL and its parameters, not the QuerySpec, because a dashboard measure
 * may share a name with another dashboard's (ADR 0007). Leaving out the scope would serve one
 * tenant's rows to another: the property tests guard it.
 */
export function resultKey(parts: {
  scopeHash: string;
  contractVersion: string;
  sql: string;
  params: readonly unknown[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify([parts.scopeHash, parts.contractVersion, parts.sql, parts.params]))
    .digest("hex");
}

/** A security scope's hash: the same entries in any order give the same hash. */
export const scopeHashOf = (scope: Record<string, unknown>): string =>
  createHash("sha256")
    .update(JSON.stringify(Object.entries(scope).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
    .digest("hex");
