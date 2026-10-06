import { readFileSync } from "node:fs";
import { dataContract } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { policyConfigErrors, policyContractErrors } from "../../src/policies.ts";

const demo = dataContract.parse(
  JSON.parse(
    readFileSync(
      new URL("../integration/fixtures/dash_demo.contract.json", import.meta.url),
      "utf8",
    ),
  ),
);
const tables = demo.tables.map((t) => t.name);

describe("policy checks", () => {
  it("accepts policies on allowlisted tables and existing columns", () => {
    const policies = tables.map((table) => ({ table, column: "tenant_id", in: "tenantIds" }));
    expect(policyConfigErrors(policies, tables)).toEqual([]);
    expect(policyContractErrors(policies, demo)).toEqual([]);
  });

  it("rejects a policy on a table outside the allowlist", () => {
    const policies = [{ table: "dash_demo.order", column: "tenant_id", in: "tenantIds" }];
    expect(policyConfigErrors(policies, tables)).toEqual([
      "policy on dash_demo.order: the table is not in the allowlist",
    ]);
  });

  it("rejects a policy whose column the contract does not have", () => {
    const policies = [{ table: "dash_demo.orders", column: "tenant", in: "tenantIds" }];
    expect(policyContractErrors(policies, demo)).toEqual([
      "policy on dash_demo.orders: no column tenant",
    ]);
  });
});
