import { readFileSync } from "node:fs";
import {
  check,
  dataContract,
  planJoins,
  type QuerySpec,
  querySpec,
  tablesOf,
  type ValidQuery,
  validateQuery,
} from "@adam-riffi/dash-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileQuery, type Policy } from "../../src/query/compile.ts";

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
          'order by "m0" desc nulls last, 1, 2',
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
    expect(result.ok && result.query.text.split("\n")).toContain(
      'order by "m0" desc nulls last, 1',
    );
  });

  it("sorts rows without a value last in either direction, so a limit keeps values", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.products.category" }],
      measures: [units],
      sort: [{ by: "dimension", index: 0, dir: "asc" }],
    });
    expect(result.ok && result.query.text.split("\n")).toContain('order by "d0" asc nulls last, 1');
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

describe("compileQuery with formulas", () => {
  /** Checks formulas against the demo contract and compiles them as one query's measures. */
  function compileFormulas(...formulas: string[]) {
    const measures = formulas.map((formula) => {
      const checked = check(formula, { contract: demo });
      if (!checked.ok) throw new Error(checked.errors.map((e) => e.message).join("; "));
      return { formula, expr: checked.expr, tables: tablesOf(checked.expr) };
    });
    const query: ValidQuery = { dimensions: [], measures, filters: [], sort: [], limit: 100 };
    const planned = planJoins(query, demo);
    if (!planned.ok) throw new Error(planned.errors.join("; "));
    const compiled = compileQuery(query, planned.plan, tenantPolicies, { tenantIds: [1] });
    if (!compiled.ok) throw new Error(compiled.errors.join("; "));
    return compiled.query;
  }

  it.each([
    [
      "SUM(order_items.quantity * order_items.unit_price)",
      'sum(("t0"."quantity" * "t0"."unit_price"))',
      [],
    ],
    ["SUM(order_items.quantity) / 2", '((sum("t0"."quantity"))::numeric / $2::numeric)', [2]],
    [
      "DIVIDE(SUM(order_items.quantity), COUNTDISTINCT(order_items.order_id))",
      '((sum("t0"."quantity"))::numeric / nullif(count(distinct "t0"."order_id"), 0))',
      [],
    ],
    [
      'COUNT(IF(orders.status = "paid", orders.id))',
      'count(case when ("t0"."status"::text = $2::text) then "t0"."id" end)',
      ["paid"],
    ],
    [
      'SUM(IF(NOT orders.status = "a" OR orders.status <> "b", 1, 0))',
      'sum(case when ((not ("t0"."status"::text = $2::text)) or ("t0"."status"::text <> $3::text)) then $4::numeric else $5::numeric end)',
      ["a", "b", 1, 0],
    ],
    [
      "ROUND(AVG(order_items.unit_price), 2)",
      'round((avg("t0"."unit_price"))::numeric, $2::int)',
      [2],
    ],
    ["ROUND(SUM(order_items.quantity))", 'round((sum("t0"."quantity"))::numeric)', []],
    [
      'MAX(DATE_TRUNC("month", orders.ordered_at))',
      'max(date_trunc($2::text, "t0"."ordered_at"))',
      ["month"],
    ],
    [
      "COALESCE(SUM(order_items.quantity), 0) * -1",
      '(coalesce(sum("t0"."quantity"), $2::numeric) * (-$3::numeric))',
      [0, 1],
    ],
    [
      "MIN(orders.ordered_at) < MAX(orders.ordered_at) AND COUNT(orders.id) >= 1",
      '((min("t0"."ordered_at") < max("t0"."ordered_at")) and (count("t0"."id") >= $2::numeric))',
      [1],
    ],
    // CALCULATE: each aggregate inside gets the conditions as a FILTER clause (ADR 0013).
    [
      "CALCULATE(SUM(order_items.quantity), order_items.quantity > 1)",
      'sum("t0"."quantity") filter (where ("t0"."quantity" > $2::numeric))',
      [1],
    ],
    [
      "CALCULATE(COUNTDISTINCT(order_items.order_id), order_items.quantity > 1)",
      'count(distinct "t0"."order_id") filter (where ("t0"."quantity" > $2::numeric))',
      [1],
    ],
    [
      "CALCULATE(CALCULATE(COUNT(order_items.id), order_items.quantity > 1), order_items.unit_price < 10)",
      'count("t0"."id") filter (where ("t0"."unit_price" < $2::numeric) and ("t0"."quantity" > $3::numeric))',
      [10, 1],
    ],
    [
      "DIVIDE(CALCULATE(SUM(order_items.quantity), order_items.quantity > 1), SUM(order_items.quantity))",
      '((sum("t0"."quantity") filter (where ("t0"."quantity" > $2::numeric)))::numeric / nullif(sum("t0"."quantity"), 0))',
      [1],
    ],
  ])("compiles %s", (formula, sql, values) => {
    const query = compileFormulas(formula);
    expect(query.text.split("\n")[0]).toEqual(`select ${sql} as "m0"`);
    expect(query.params).toEqual([[1], ...values, 101]);
  });

  it("compares enum and uuid columns as text, so string literals match them", () => {
    const saas = dataContract.parse(
      JSON.parse(
        readFileSync(
          new URL("../integration/fixtures/saas.contract.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const sqlOf = (formula: string) => {
      const checked = check(formula, { contract: saas });
      if (!checked.ok) throw new Error(checked.errors.map((e) => e.message).join("; "));
      const measures = [{ formula, expr: checked.expr, tables: tablesOf(checked.expr) }];
      const query: ValidQuery = { dimensions: [], measures, filters: [], sort: [], limit: 10 };
      const planned = planJoins(query, saas);
      if (!planned.ok) throw new Error(planned.errors.join("; "));
      const compiled = compileQuery(query, planned.plan, [], {});
      return compiled.ok ? compiled.query.text.split("\n")[0] : compiled.errors;
    };
    expect(sqlOf('COUNT(IF(plans.tier = "pro", plans.id))')).toEqual(
      'select count(case when ("t0"."tier"::text = $1::text) then "t0"."id" end) as "m0"',
    );
    expect(sqlOf('MAX(COALESCE(accounts.id, accounts.name, "none"))')).toEqual(
      'select max(coalesce("t0"."id"::text, "t0"."name"::text, $1::text)) as "m0"',
    );
  });

  it("echoes the formula and its type in the output columns", () => {
    expect(compileFormulas("MAX(orders.ordered_at)", "COUNT(orders.id)").columns).toEqual([
      { key: "m0", kind: "measure", formula: "MAX(orders.ordered_at)", type: "date" },
      { key: "m1", kind: "measure", formula: "COUNT(orders.id)", type: "number" },
    ]);
  });

  it("binds every literal, never writing it into the SQL", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 10_000_000 }), (s, n) => {
        const value = `zq${s}`;
        const formula = `COUNT(IF(orders.status = "${value.replaceAll('"', '""')}", ${n}))`;
        const query = compileFormulas(formula);
        expect(query.text).not.toContain(value);
        expect(query.text).not.toContain(String(n));
        expect(query.params).toContain(value);
        expect(query.params).toContain(n);
      }),
    );
  });
});

describe("compileQuery in two stages (ADR 0013)", () => {
  const month = { field: "dash_demo.orders.ordered_at", timeGrain: "month" as const };
  const from = [
    'from "dash_demo"."order_items" as "t0"',
    'left join "dash_demo"."orders" as "t1" on "t1"."id" = "t0"."order_id"',
  ];

  it("reads PREVIOUSPERIOD from a CTE over the window one grain earlier", () => {
    const result = compile({
      dimensions: [month],
      measures: [{ formula: "PREVIOUSPERIOD(SUM(order_items.quantity))" }],
      filters: [{ field: month.field, op: "gte", values: ["2026-01-01"] }],
    });
    expect(result.ok && result.query.text).toBe(
      [
        'with "g" as (',
        `select date_trunc('month', "t1"."ordered_at") as "d0"`,
        ...from,
        'where "t0"."tenant_id" = any($1) and "t1"."tenant_id" = any($2) and "t1"."ordered_at" >= $3',
        "group by 1",
        '), "p" as (',
        `select date_trunc('month', "t1"."ordered_at") as "d0", sum("t0"."quantity") as "b0"`,
        ...from,
        `where "t0"."tenant_id" = any($4) and "t1"."tenant_id" = any($5) and ("t1"."ordered_at" + interval '1 month') >= $6`,
        "group by 1",
        ")",
        'select "g"."d0" as "d0", "p"."b0" as "m0"',
        'from "g"',
        `left join "p" on ("p"."d0" + interval '1 month') = "g"."d0"`,
        "order by 1",
        "limit $7",
      ].join("\n"),
    );
    expect(result.ok && result.query.params).toEqual([
      [1, 2],
      [1, 2],
      "2026-01-01",
      [1, 2],
      [1, 2],
      "2026-01-01",
      10_001,
    ]);
  });

  it("sums RUNNINGSUM along the time axis per combination of the other dimensions", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.orders.status" }, month],
      measures: [{ formula: "RUNNINGSUM(SUM(order_items.quantity))" }],
      sort: [{ by: "measure", index: 0, dir: "desc" }],
    });
    expect(result.ok && result.query.text).toBe(
      [
        'with "g" as (',
        `select "t1"."status" as "d0", date_trunc('month', "t1"."ordered_at") as "d1", sum("t0"."quantity") as "a0"`,
        ...from,
        'where "t0"."tenant_id" = any($1) and "t1"."tenant_id" = any($2)',
        "group by 1, 2",
        ")",
        'select "g"."d0" as "d0", "g"."d1" as "d1", sum("g"."a0") over (partition by "g"."d0" order by "g"."d1" rows between unbounded preceding and current row) as "m0"',
        'from "g"',
        'order by "m0" desc nulls last, 1, 2',
        "limit $3",
      ].join("\n"),
    );
  });

  it("joins the previous period on the other dimensions too, nulls included", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.orders.status" }, month],
      measures: [
        { formula: "SUM(order_items.quantity) - PREVIOUSPERIOD(SUM(order_items.quantity))" },
      ],
    });
    const lines = result.ok ? result.query.text.split("\n") : [];
    expect(lines).toContain(
      'select "g"."d0" as "d0", "g"."d1" as "d1", ("g"."a0" - "p"."b0") as "m0"',
    );
    expect(lines).toContain(
      // Null-safe and hashable: `is not distinct from` would force a nested loop (M10 review).
      `left join "p" on ("p"."d1" + interval '1 month') = "g"."d1" and coalesce("p"."d0"::text, '') = coalesce("g"."d0"::text, '') and ("p"."d0" is null) = ("g"."d0" is null)`,
    );
  });

  it("keeps a date column's shifted filter a date, so a timestamp value compares as before", () => {
    // A Postgres `date` column: plus an interval it becomes a timestamp, so it is cast back.
    const dated = dataContract.parse({
      ...demo,
      tables: demo.tables.map((t) =>
        t.name !== "dash_demo.orders"
          ? t
          : {
              ...t,
              columns: t.columns.map((c) =>
                c.name === "ordered_at" ? { ...c, pgType: "date" } : c,
              ),
            },
      ),
    });
    const valid = validateQuery(
      querySpec.parse({
        dimensions: [month],
        measures: [{ formula: "PREVIOUSPERIOD(SUM(order_items.quantity))" }],
        filters: [{ field: month.field, op: "gte", values: ["2026-01-01"] }],
      }),
      dated,
    );
    if (!valid.ok) throw new Error(valid.errors.join("; "));
    const planned = planJoins(valid.query, dated);
    if (!planned.ok) throw new Error(planned.errors.join("; "));
    const result = compileQuery(valid.query, planned.plan, tenantPolicies, { tenantIds: [1, 2] });
    expect(result.ok && result.query.text).toContain(
      `(("t1"."ordered_at" + interval '1 month'))::date >= $6`,
    );
  });

  it("computes ALL's total in its own CTE, grouped by the other dimensions", () => {
    const result = compile({
      dimensions: [{ field: "dash_demo.orders.status" }],
      measures: [
        {
          formula:
            "DIVIDE(SUM(order_items.quantity), CALCULATE(SUM(order_items.quantity), ALL(orders.status)))",
        },
      ],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid", "shipped"] }],
    });
    expect(result.ok && result.query.text).toBe(
      [
        'with "g" as (',
        'select "t1"."status" as "d0", sum("t0"."quantity") as "a0"',
        ...from,
        'where "t0"."tenant_id" = any($1) and "t1"."tenant_id" = any($2) and "t1"."status" = any($3)',
        "group by 1",
        '), "w0" as (',
        'select sum("t0"."quantity") as "c0"',
        ...from,
        // ALL lifts the filter on its own field, never a policy.
        'where "t0"."tenant_id" = any($4) and "t1"."tenant_id" = any($5)',
        "group by ()",
        ")",
        'select "g"."d0" as "d0", (("g"."a0")::numeric / nullif("w0"."c0", 0)) as "m0"',
        'from "g"',
        'left join "w0" on true',
        "order by 1",
        "limit $6",
      ].join("\n"),
    );
  });

  it("joins ALL's total back on the dimensions it keeps", () => {
    const result = compile({
      dimensions: [month, { field: "dash_demo.orders.status" }],
      measures: [{ formula: "CALCULATE(SUM(order_items.quantity), ALL(orders.status))" }],
    });
    const lines = result.ok ? result.query.text.split("\n") : [];
    expect(lines).toContain(
      `select date_trunc('month', "t1"."ordered_at") as "d0", sum("t0"."quantity") as "c0"`,
    );
    expect(lines).toContain(
      `left join "w0" on coalesce("w0"."d0"::text, '') = coalesce("g"."d0"::text, '') and ("w0"."d0" is null) = ("g"."d0" is null)`,
    );
    expect(lines).toContain('select "g"."d0" as "d0", "g"."d1" as "d1", "w0"."c0" as "m0"');
  });

  it("groups a measure that is only ALL's total into one row, matches or not", () => {
    const result = compile({
      measures: [{ formula: "CALCULATE(SUM(order_items.quantity), ALL(orders.status))" }],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid"] }],
    });
    expect(result.ok && result.query.text).toBe(
      [
        'with "g" as (',
        "select",
        ...from,
        'where "t0"."tenant_id" = any($1) and "t1"."tenant_id" = any($2) and "t1"."status" = any($3)',
        "group by ()",
        '), "w0" as (',
        'select sum("t0"."quantity") as "c0"',
        ...from,
        'where "t0"."tenant_id" = any($4) and "t1"."tenant_id" = any($5)',
        "group by ()",
        ")",
        'select "w0"."c0" as "m0"',
        'from "g"',
        'left join "w0" on true',
        "limit $6",
      ].join("\n"),
    );
  });

  it("compiles queries without time functions in one statement, as before", () => {
    const result = compile({ dimensions: [month], measures: [units] });
    expect(result.ok && result.query.text.startsWith("select ")).toBe(true);
  });
});
