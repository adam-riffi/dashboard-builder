import { type Checking, check, type DataContract } from "@adam-riffi/dash-core";
import { planJoins } from "../query/paths.ts";
import { tablesOf } from "../query/validate.ts";
import type { Catalog } from "./catalog.ts";
import { type ContractConfig, schemaHash } from "./hash.ts";
import { inferTables } from "./infer.ts";

export type { Catalog } from "./catalog.ts";
export type { ContractConfig } from "./hash.ts";

/**
 * The contract served at `GET /contract`, versioned by its schema hash. Host measures are checked
 * and planned against the inferred tables; one that would fail every query is a configuration
 * error and throws.
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
    const measures = [{ name: m.name, expr: checked.expr, tables: tablesOf(checked.expr) }];
    const plan = planJoins({ dimensions: [], measures, filters: [], sort: [], limit: 1 }, contract);
    if (!plan.ok) throw new Error(`measure ${m.name}: ${plan.errors[0]}`);
    contract.measures.push({ name: m.name, formula: m.formula, type: checked.expr.type });
  }
  return contract;
}
