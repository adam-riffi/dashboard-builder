import type { DataContract } from "@adam-riffi/dash-core";
import type { Policy } from "./query/compile.ts";

/**
 * Policies on tables outside the allowlist would never be injected, silently dropping a tenant
 * filter; the gateway refuses to start with one.
 */
export function policyConfigErrors(policies: Policy[], tables: string[]): string[] {
  return policies
    .filter((p) => !tables.includes(p.table))
    .map((p) => `policy on ${p.table}: the table is not in the allowlist`);
}

/** A policy whose column the contract lacks fails every query rather than filtering nothing. */
export function policyContractErrors(policies: Policy[], contract: DataContract): string[] {
  return policies.flatMap((p) => {
    const table = contract.tables.find((t) => t.name === p.table);
    return table?.columns.some((c) => c.name === p.column)
      ? []
      : [`policy on ${p.table}: no column ${p.column}`];
  });
}
