import { type Checking, check, type DataContract } from "@adam-riffi/dash-core";
import type { Catalog } from "./catalog.ts";
import { type ContractConfig, schemaHash } from "./hash.ts";
import { inferTables } from "./infer.ts";

export type { Catalog } from "./catalog.ts";
export type { ContractConfig } from "./hash.ts";

/**
 * The contract served at `GET /contract`, versioned by its schema hash. Host measures are checked
 * against the inferred tables; one that does not check is a configuration error and throws.
 */
export function inferContract(catalog: Catalog, config: ContractConfig): DataContract {
  const contract: DataContract = {
    contractVersion: schemaHash(catalog, config),
    ...inferTables(catalog),
    measures: [],
  };
  const host = config.measures ?? [];
  const env = { contract, measures: new Map(host.map((m) => [m.name, m.formula])) };
  const memo = new Map<string, Checking>();
  for (const m of host) {
    const checked = check(m.formula, env, memo);
    if (!checked.ok) {
      const [e] = checked.errors;
      throw new Error(`measure ${m.name}: ${e?.message} (characters ${e?.start}–${e?.end})`);
    }
    contract.measures.push({ name: m.name, formula: m.formula, type: checked.expr.type });
  }
  return contract;
}
