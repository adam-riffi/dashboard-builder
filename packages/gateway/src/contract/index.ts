import type { DataContract } from "@adam-riffi/dash-core";
import type { Catalog } from "./catalog.ts";
import { type ContractConfig, schemaHash } from "./hash.ts";
import { inferTables } from "./infer.ts";

export type { Catalog } from "./catalog.ts";
export type { ContractConfig } from "./hash.ts";

/** The contract served at `GET /contract`, versioned by its schema hash. */
export function inferContract(catalog: Catalog, config: ContractConfig): DataContract {
  return { contractVersion: schemaHash(catalog, config), ...inferTables(catalog) };
}
