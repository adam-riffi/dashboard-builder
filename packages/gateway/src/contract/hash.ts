import { createHash } from "node:crypto";
import type { NamedMeasure } from "@adam-riffi/dash-core";
import type { Catalog } from "./catalog.ts";
import { inferTables } from "./infer.ts";

/** The part of the gateway configuration that shapes the contract. */
export interface ContractConfig {
  /** Allowlisted tables, `schema.table`. */
  tables: string[];
  /** Host measures (ADR 0007), in configuration order. */
  measures?: NamedMeasure[];
}

/** JSON with object keys sorted at every level, so equal values always serialize equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The contract version (DESIGN.md §6): SHA-256 of the inferred structure plus the allowlist
 * and the host measures.
 * Statistics are left out so that live inserts and ANALYZE runs do not change the version.
 */
export function schemaHash(catalog: Catalog, config: ContractConfig): string {
  const { tables, relationships } = inferTables(catalog);
  const structure = {
    tables: tables.map((t) => ({
      name: t.name,
      primaryKey: t.primaryKey,
      columns: t.columns.map(({ distinct, highCardinality, ...c }) => c),
    })),
    relationships,
    // Without host measures the key is left out, so earlier versions stay the same.
    config: {
      tables: [...config.tables].sort(),
      measures: config.measures?.length ? config.measures : undefined,
    },
  };
  return createHash("sha256").update(canonical(structure)).digest("hex");
}
