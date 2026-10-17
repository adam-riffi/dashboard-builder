import { readFileSync } from "node:fs";
import { dataContract, type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { memoryCache, resultKey, scopeHashOf } from "../../src/cache.ts";
import { compileQuery } from "../../src/query/compile.ts";
import type { QueryResult } from "../../src/query/execute.ts";
import { planJoins } from "../../src/query/paths.ts";
import { validateQuery } from "../../src/query/validate.ts";

const result = (n: number): QueryResult => ({
  columns: [{ key: "m0", kind: "measure", name: "n", type: "number" }],
  data: [[n]],
  meta: { cache: "miss", ms: 1, truncated: false },
});
const bytes = (r: QueryResult) => Buffer.byteLength(JSON.stringify(r));

describe("memoryCache (DESIGN.md §6)", () => {
  it("serves an entry only while it is younger than the asker's limit", () => {
    let now = 0;
    const cache = memoryCache({ maxBytes: 10_000, now: () => now });
    cache.set("k", result(1));
    now = 5_000;
    expect(cache.get("k", 5_000)).toEqual(result(1));
    now = 5_001;
    expect(cache.get("k", 5_000)).toBeUndefined();
    // A visual refreshing less often still accepts it: the limit belongs to the asker.
    expect(cache.get("k", 60_000)).toEqual(result(1));
  });

  it("drops the least recently used entries once their size passes maxBytes", () => {
    const cache = memoryCache({ maxBytes: bytes(result(1)) * 2 });
    cache.set("a", result(1));
    cache.set("b", result(2));
    cache.get("a", 60_000); // a is now the most recently used
    cache.set("c", result(3));
    expect(cache.get("a", 60_000)).toEqual(result(1));
    expect(cache.get("b", 60_000)).toBeUndefined();
    expect(cache.get("c", 60_000)).toEqual(result(3));
  });

  it("never keeps a result larger than the whole cache", () => {
    const cache = memoryCache({ maxBytes: bytes(result(1)) - 1 });
    cache.set("a", result(1));
    expect(cache.get("a", 60_000)).toBeUndefined();
  });
});

const parts = fc.record({
  scopeHash: fc.string(),
  contractVersion: fc.string(),
  sql: fc.string(),
  params: fc.array(fc.oneof(fc.string(), fc.integer(), fc.array(fc.integer()))),
});

// Scope keys are the host's own names (`tenantIds`); `__proto__` would set a prototype instead.
const name = fc.string().filter((s) => s !== "__proto__");

describe("result cache key (DESIGN.md §6: missing the scope is release-blocking)", () => {
  it("changes whenever the scope changes, whatever the query", () => {
    fc.assert(
      fc.property(parts, fc.string(), (p, other) => {
        fc.pre(other !== p.scopeHash);
        expect(resultKey({ ...p, scopeHash: other })).not.toBe(resultKey(p));
      }),
    );
  });

  it("changes with the contract version, the SQL and its parameters", () => {
    fc.assert(
      fc.property(parts, parts, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(resultKey(a)).not.toBe(resultKey(b));
      }),
    );
  });

  it("hashes a scope the same in any key order, and differently for any other value", () => {
    fc.assert(
      fc.property(
        fc.dictionary(name, fc.array(fc.integer())),
        name,
        fc.integer(),
        (scope, key, value) => {
          const reversed = Object.fromEntries(Object.entries(scope).reverse());
          expect(scopeHashOf(reversed)).toBe(scopeHashOf(scope));
          const changed = {
            ...scope,
            [key]: [...(Object.hasOwn(scope, key) ? (scope[key] ?? []) : []), value],
          };
          expect(scopeHashOf(changed)).not.toBe(scopeHashOf(scope));
        },
      ),
    );
  });
});

const demo = dataContract.parse(
  JSON.parse(
    readFileSync(
      new URL("../integration/fixtures/dash_demo.contract.json", import.meta.url),
      "utf8",
    ),
  ),
);
const policies = ["orders", "order_items", "products", "customers"].map((t) => ({
  table: `dash_demo.${t}`,
  column: "tenant_id",
  in: "tenantIds",
}));

/** The key the gateway computes for a request's QuerySpec. */
function keyOf(spec: unknown, scope: Record<string, unknown>) {
  const valid = validateQuery(querySpec.parse(spec), demo);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const planned = planJoins(valid.query, demo);
  if (!planned.ok) throw new Error(planned.errors.join("; "));
  const compiled = compileQuery(valid.query, planned.plan, policies, scope);
  if (!compiled.ok) throw new Error(compiled.errors.join("; "));
  return resultKey({
    scopeHash: scopeHashOf(scope),
    contractVersion: demo.contractVersion,
    sql: compiled.query.text,
    params: compiled.query.params,
  });
}

/** The same JSON with every object's properties in reverse order. */
const reorder = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reorder)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reorder(v)]),
        )
      : value;

describe("cache key normalization", () => {
  const specs: Partial<QuerySpec>[] = [
    {
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [{ field: "dash_demo.order_items.quantity", aggregation: "SUM" }],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid"] }],
      sort: [{ by: "measure", index: 0, dir: "desc" }],
      limit: 10,
    },
    {
      dimensions: [{ field: "dash_demo.orders.ordered_at", timeGrain: "day" }],
      measures: [{ formula: "COUNTDISTINCT(order_items.order_id)" }],
    },
  ];

  it.each(specs)("does not change with the order of a request's properties (%#)", (spec) => {
    const scope = { tenantIds: [1, 2] };
    expect(keyOf(reorder(spec), scope)).toBe(keyOf(spec, scope));
  });

  it.each(specs)("changes with the scope (%#)", (spec) => {
    expect(keyOf(spec, { tenantIds: [3] })).not.toBe(keyOf(spec, { tenantIds: [1, 2] }));
  });
});
