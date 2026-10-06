import { readFileSync } from "node:fs";
import { dataContract, type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileQuery, type Policy } from "../../src/query/compile.ts";
import { planJoins } from "../../src/query/paths.ts";
import { validateQuery } from "../../src/query/validate.ts";

const demo = dataContract.parse(
  JSON.parse(
    readFileSync(
      new URL("../integration/fixtures/dash_demo.contract.json", import.meta.url),
      "utf8",
    ),
  ),
);
const tenantPolicies: Policy[] = ["orders", "order_items", "products", "customers"].map((t) => ({
  table: `dash_demo.${t}`,
  column: "tenant_id",
  in: "tenantIds",
}));

/** Validates, plans and compiles, the way the gateway will. */
function compile(
  spec: Partial<QuerySpec> & Pick<QuerySpec, "measures">,
  scope: Record<string, unknown> = { tenantIds: [1, 2] },
  policies = tenantPolicies,
) {
  const valid = validateQuery(querySpec.parse(spec), demo);
  if (!valid.ok) throw new Error(valid.errors.join("; "));
  const planned = planJoins(valid.query, demo);
  if (!planned.ok) throw new Error(planned.errors.join("; "));
  return compileQuery(valid.query, planned.plan, policies, scope);
}

const units = { field: "dash_demo.order_items.quantity" };

describe("compileQuery", () => {
  it("compiles a single measure with the base table's policy", () => {
    expect(compile({ measures: [units] })).toEqual({
      ok: true,
      query: {
        text: [
          'select sum("t0"."quantity") as "m0"',
          'from "dash_demo"."order_items" as "t0"',
          'where "t0"."tenant_id" = any($1)',
          "limit $2",
        ].join("\n"),
        params: [[1, 2], 10_001],
        columns: [
          { key: "m0", kind: "measure", field: units.field, aggregation: "SUM", type: "number" },
        ],
      },
    });
  });

  it("compiles dimensions, time grains, joins, policies on every joined table, filters and sort", () => {
    const result = compile({
      dimensions: [
        { field: "dash_demo.customers.segment" },
        { field: "dash_demo.orders.ordered_at", timeGrain: "month" },
      ],
      measures: [units, { field: "dash_demo.order_items.id", aggregation: "COUNT" }],
      filters: [
        { field: "dash_demo.orders.status", op: "in", values: ["paid"] },
        { field: "dash_demo.order_items.quantity", op: "gte", values: [2] },
      ],
      sort: [{ by: "measure", index: 0, dir: "desc" }],
      limit: 10,
    });
    expect(result).toEqual({
      ok: true,
      query: {
        text: [
          'select "t2"."segment" as "d0", date_trunc(\'month\', "t1"."ordered_at") as "d1", sum("t0"."quantity") as "m0", count("t0"."id") as "m1"',
          'from "dash_demo"."order_items" as "t0"',
          'left join "dash_demo"."orders" as "t1" on "t1"."id" = "t0"."order_id"',
          'left join "dash_demo"."customers" as "t2" on "t2"."id" = "t1"."customer_id"',
          'where "t0"."tenant_id" = any($1) and "t1"."tenant_id" = any($2) and "t2"."tenant_id" = any($3) and "t1"."status" = any($4) and "t0"."quantity" >= $5',
          "group by 1, 2",
          'order by "m0" desc, 1, 2',
          "limit $6",
        ].join("\n"),
        params: [[1, 2], [1, 2], [1, 2], ["paid"], 2, 11],
        columns: [
          { key: "d0", kind: "dimension", field: "dash_demo.customers.segment", type: "string" },
          {
            key: "d1",
            kind: "dimension",
            field: "dash_demo.orders.ordered_at",
            timeGrain: "month",
            type: "date",
          },
          { key: "m0", kind: "measure", field: units.field, aggregation: "SUM", type: "number" },
          {
            key: "m1",
            kind: "measure",
            field: "dash_demo.order_items.id",
            aggregation: "COUNT",
            type: "number",
          },
        ],
      },
    });
  });

  it.each([
    ["not_in", ["refunded"], 'not ("t1"."status" = any($1))'],
    ["between", ["a", "m"], '"t1"."status" between $1 and $2'],
    ["lt", ["m"], '"t1"."status" < $1'],
    ["gt", ["m"], '"t1"."status" > $1'],
    ["lte", ["m"], '"t1"."status" <= $1'],
  ] as const)("compiles the %s operator", (op, values, predicate) => {
    const result = compile(
      {
        measures: [units],
        filters: [{ field: "dash_demo.orders.status", op, values: [...values] }],
      },
      {},
      [],
    );
    expect(result.ok && result.query.text).toContain(`where ${predicate}`);
  });

  it("keeps MIN and MAX in the column's type and counts distinct values", () => {
    const result = compile({
      measures: [
        { field: "dash_demo.order_items.unit_price", aggregation: "MIN" },
        { field: "dash_demo.order_items.product_id", aggregation: "COUNT_DISTINCT" },
      ],
    });
    expect(result.ok && result.query.text).toContain(
      'select min("t0"."unit_price") as "m0", count(distinct "t0"."product_id") as "m1"',
    );
  });

  it("orders by the dimensions when no sort is given, so results are stable", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [units],
    });
    expect(result.ok && result.query.text.split("\n").slice(-3)).toEqual([
      "group by 1",
      "order by 1",
      "limit $3",
    ]);
  });

  it("fails closed when the scope lacks a policy's key", () => {
    expect(compile({ measures: [units] }, { userId: "u" })).toEqual({
      ok: false,
      errors: ["scope has no list tenantIds for the policy on dash_demo.order_items"],
    });
    expect(compile({ measures: [units] }, { tenantIds: "1,2" })).toMatchObject({ ok: false });
  });

  it("never puts a filter value in the SQL text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 4 }),
        (values) => {
          const result = compile({
            measures: [units],
            filters: [{ field: "dash_demo.orders.status", op: "in", values }],
          });
          if (!result.ok) throw new Error("expected a compiled query");
          expect(result.query.params).toContainEqual(values);
          for (const v of values.filter((x) => x.length > 3)) {
            expect(result.query.text).not.toContain(v);
          }
        },
      ),
    );
  });

  it("binds true/false lists as a Postgres array literal cast to boolean[]", () => {
    const saas = dataContract.parse(
      JSON.parse(
        readFileSync(
          new URL("../integration/fixtures/saas.contract.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    for (const op of ["in", "not_in"] as const) {
      const valid = validateQuery(
        querySpec.parse({
          measures: [{ field: "fx_saas.accounts.churn_score" }],
          filters: [{ field: "fx_saas.accounts.is_active", op, values: [true, false] }],
        }),
        saas,
      );
      if (!valid.ok) throw new Error(valid.errors.join("; "));
      const plan = planJoins(valid.query, saas);
      if (!plan.ok) throw new Error(plan.errors.join("; "));
      const result = compileQuery(valid.query, plan.plan, [], {});
      expect(result.ok && result.query.text).toContain('"t0"."is_active" = any($1::boolean[])');
      expect(result.ok && result.query.params[0]).toBe("{t,f}");
    }
  });

  it("breaks sort ties by the dimensions, so cuts at the limit are stable", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [units],
      sort: [{ by: "measure", index: 0, dir: "desc" }],
    });
    expect(result.ok && result.query.text.split("\n")).toContain('order by "m0" desc, 1');
  });

  it("escapes double quotes in identifiers", () => {
    const odd = dataContract.parse({
      contractVersion: "a".repeat(64),
      relationships: [],
      tables: [
        {
          name: "s.t",
          rowCount: null,
          primaryKey: [],
          columns: [
            {
              name: 'we"ird',
              pgType: "text",
              type: "string",
              nullable: false,
              role: "dimension",
              distinct: null,
              highCardinality: false,
            },
            {
              name: "n",
              pgType: "int4",
              type: "number",
              nullable: false,
              role: "measure",
              aggregation: "SUM",
              distinct: null,
              highCardinality: false,
            },
          ],
        },
      ],
    });
    const valid = validateQuery(
      querySpec.parse({ dimensions: [{ field: 's.t.we"ird' }], measures: [{ field: "s.t.n" }] }),
      odd,
    );
    if (!valid.ok) throw new Error(valid.errors.join("; "));
    const plan = planJoins(valid.query, odd);
    if (!plan.ok) throw new Error(plan.errors.join("; "));
    const result = compileQuery(valid.query, plan.plan, [], {});
    expect(result.ok && result.query.text).toContain('select "t0"."we""ird" as "d0"');
  });
});
