import { describe, expect, it } from "vitest";
import {
  type CheckEnv,
  check,
  type DataContract,
  type FieldType,
  resolveField,
} from "../../src/index.ts";

const col = (name: string, type: FieldType, role: "id" | "time" | "measure" | "dimension") => ({
  name,
  pgType: type,
  type,
  nullable: false,
  role,
  ...(role === "measure" ? { aggregation: "SUM" as const } : {}),
  distinct: null,
  highCardinality: false,
});
const table = (name: string, columns: ReturnType<typeof col>[]) => ({
  name,
  rowCount: null,
  primaryKey: ["id"],
  columns,
});

const contract: DataContract = {
  contractVersion: "0".repeat(64),
  tables: [
    table("shop.orders", [
      col("id", "number", "id"),
      col("status", "string", "dimension"),
      col("ordered_at", "date", "time"),
      col("refunded", "boolean", "dimension"),
    ]),
    table("shop.order_items", [
      col("id", "number", "id"),
      col("order_id", "number", "id"),
      col("quantity", "number", "measure"),
      col("unit_price", "number", "measure"),
    ]),
    table("shop.customers", [col("id", "number", "id")]),
    table("archive.customers", [col("id", "number", "id")]),
  ],
  relationships: [],
  measures: [],
};

const env: CheckEnv = {
  contract,
  measures: new Map([
    ["Revenue", "SUM(order_items.quantity * order_items.unit_price)"],
    ["Orders", "COUNTDISTINCT(order_items.order_id)"],
    ["A", "[B] * 2"],
    ["B", "[A] + 1"],
    ["Self", "[Self] + 1"],
    ["Broken", "SUM(nope.x)"],
    ["Row", "order_items.quantity"],
  ]),
};

const typed = (source: string) => {
  const result = check(source, env);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  return result.expr;
};

describe("check", () => {
  it("resolves fields to their table and types the tree", () => {
    expect(typed("SUM(order_items.quantity * order_items.unit_price)")).toEqual({
      kind: "call",
      name: "SUM",
      type: "number",
      level: "aggregate",
      args: [
        {
          kind: "binary",
          op: "*",
          type: "number",
          level: "row",
          left: {
            kind: "column",
            table: "shop.order_items",
            column: "quantity",
            type: "number",
            level: "row",
          },
          right: {
            kind: "column",
            table: "shop.order_items",
            column: "unit_price",
            type: "number",
            level: "row",
          },
        },
      ],
    });
  });

  it.each([
    ["COUNTDISTINCT(shop.orders.status)", "number"],
    ["MIN(orders.ordered_at)", "date"],
    ["MAX(orders.status)", "string"],
    ["DIVIDE(SUM(order_items.quantity), COUNT(orders.id))", "number"],
    ["SUM(IF(orders.refunded, 0, order_items.quantity))", "number"],
    ['COUNT(IF(orders.status = "paid", orders.id))', "number"],
    ["ROUND(AVG(order_items.unit_price), 2)", "number"],
    ['MAX(DATE_TRUNC("month", orders.ordered_at))', "date"],
    ["COALESCE(SUM(order_items.quantity), 0) * -1", "number"],
    ['SUM(order_items.quantity) > 10 AND NOT MAX(orders.status) = "x"', "boolean"],
    ["COUNT(1)", "number"],
    ["[Revenue] / [Orders]", "number"],
    // M10 (ADR 0013)
    ['CALCULATE([Revenue], orders.status = "paid")', "number"],
    ["CALCULATE(MAX(orders.status), orders.refunded, orders.id > 10)", "string"],
    ["CALCULATE([Revenue], ALL(orders.status))", "number"],
    ["DIVIDE([Revenue], CALCULATE([Revenue], ALL(orders.status)))", "number"],
    ["[Revenue] - PREVIOUSPERIOD([Revenue])", "number"],
    ["PREVIOUSPERIOD(MAX(orders.status))", "string"],
    ["RUNNINGSUM([Orders])", "number"],
    ['PREVIOUSPERIOD(CALCULATE([Revenue], orders.status = "paid"))', "number"],
    ['CALCULATE(RUNNINGSUM([Revenue]), orders.status = "paid")', "number"],
  ])("accepts %s as an aggregate %s", (source, type) => {
    expect(typed(source)).toMatchObject({ type, level: "aggregate" });
  });

  it("keeps ALL's field as a CALCULATE condition (ADR 0013)", () => {
    expect(typed("CALCULATE([Orders], ALL(orders.status))")).toMatchObject({
      kind: "call",
      name: "CALCULATE",
      args: [
        { kind: "call", name: "COUNTDISTINCT" },
        {
          kind: "call",
          name: "ALL",
          args: [{ kind: "column", table: "shop.orders", column: "status" }],
        },
      ],
    });
  });

  it("inlines measure references", () => {
    expect(typed("[Revenue] / [Orders]")).toMatchObject({
      kind: "binary",
      left: { kind: "call", name: "SUM" },
      right: { kind: "call", name: "COUNTDISTINCT" },
    });
  });

  it("normalizes DATE_TRUNC grains to lower case", () => {
    expect(typed('MIN(DATE_TRUNC("Month", orders.ordered_at))')).toMatchObject({
      args: [{ kind: "call", name: "DATE_TRUNC", args: [{ kind: "string", value: "month" }, {}] }],
    });
  });

  /** Each error is expected at the last occurrence of `fragment` in the formula. */
  it.each([
    ["orders.id", "a measure must aggregate its rows, e.g. SUM(table.column)", "orders.id"],
    ["1 + 2", "a measure must aggregate its rows, e.g. SUM(table.column)", "1 + 2"],
    ["SUM(orders.nope)", "unknown column orders.nope", "orders.nope"],
    ["SUM(nope.x)", "unknown table nope", "nope.x"],
    ["SUM(shop.nope.x)", "unknown table shop.nope", "shop.nope.x"],
    [
      "COUNT(customers.id)",
      "customers is in archive and shop; write archive.customers.id or shop.customers.id",
      "customers.id",
    ],
    ["SUM(SUM(order_items.quantity))", "aggregates cannot be nested", "SUM(order_items.quantity)"],
    [
      "SUM(order_items.quantity) + order_items.quantity",
      "a row value cannot be mixed with aggregates; aggregate it, e.g. SUM(...)",
      "order_items.quantity",
    ],
    ["SUM(order_items.quantity, 1)", "SUM takes 1 argument", "SUM(order_items.quantity, 1)"],
    ["IF(1)", "IF takes 2 or 3 arguments", "IF(1)"],
    [
      "COALESCE(SUM(order_items.quantity))",
      "COALESCE takes at least 2 arguments",
      "COALESCE(SUM(order_items.quantity))",
    ],
    ["FOO(1)", "unknown function FOO", "FOO"],
    ["SUM(orders.status)", "SUM needs a number, not a string", "orders.status"],
    ["MIN(orders.refunded)", "MIN needs a number, date or string", "orders.refunded"],
    ["SUM(orders.status + 1)", "+ needs numbers, not a string", "orders.status"],
    ["COUNT(orders.status = 1)", "cannot compare a string with a number", "orders.status = 1"],
    [
      "COUNT(orders.refunded < orders.refunded)",
      "< needs numbers, dates or strings",
      "orders.refunded < orders.refunded",
    ],
    [
      "COUNT(IF(orders.status, 1, 0))",
      "IF needs a true/false condition, not a string",
      "orders.status",
    ],
    [
      'SUM(IF(orders.refunded, 1, "x"))',
      "IF's branches must have the same type: number and string",
      '"x"',
    ],
    ["COUNT(orders.refunded AND 1)", "AND needs true/false values, not a number", "1"],
    ["COUNT(NOT orders.status)", "NOT needs a true/false value, not a string", "orders.status"],
    ["SUM(-orders.status)", "- needs a number, not a string", "orders.status"],
    [
      "DIVIDE(SUM(order_items.quantity), MAX(orders.status))",
      "DIVIDE needs numbers, not a string",
      "MAX(orders.status)",
    ],
    [
      "COALESCE(MAX(orders.status), 0)",
      "COALESCE's values must have the same type: string and number",
      "0",
    ],
    [
      "ROUND(SUM(order_items.quantity), 1.5)",
      "ROUND's digits must be a whole number from 0 to 15",
      "1.5",
    ],
    [
      "ROUND(SUM(order_items.quantity), order_items.id)",
      "ROUND's digits must be a whole number from 0 to 15",
      "order_items.id",
    ],
    [
      'MAX(DATE_TRUNC("decade", orders.ordered_at))',
      "DATE_TRUNC's grain is one of day, week, month, quarter, year",
      '"decade"',
    ],
    [
      'MAX(DATE_TRUNC("month", orders.status))',
      "DATE_TRUNC needs a date, not a string",
      "orders.status",
    ],
    [
      "ROUND(SUM(order_items.quantity), 16)",
      "ROUND's digits must be a whole number from 0 to 15",
      "16",
    ],
    [
      "COUNT(order_items.quantity > 100)",
      "COUNT counts every row with a value, true or false; use COUNT(IF(condition, table.column)) or SUM(IF(condition, 1, 0))",
      "order_items.quantity > 100",
    ],
    [
      "COUNT(orders.refunded)",
      "COUNT counts every row with a value, true or false; use COUNT(IF(condition, table.column)) or SUM(IF(condition, 1, 0))",
      "orders.refunded",
    ],
    ["[Nope]", "unknown measure [Nope]", "[Nope]"],
    ["SUM([Revenue])", "aggregates cannot be nested", "[Revenue]"],
    [
      "[Revenue] + order_items.quantity",
      "a row value cannot be mixed with aggregates; aggregate it, e.g. SUM(...)",
      "order_items.quantity",
    ],
    ["[Self]", "in [Self]: circular reference [Self] → [Self]", "[Self]"],
    ["[A]", "in [A]: in [B]: circular reference [A] → [B] → [A]", "[A]"],
    ["[Broken]", "in [Broken]: unknown table nope", "[Broken]"],
    ["[Row]", "in [Row]: a measure must aggregate its rows, e.g. SUM(table.column)", "[Row]"],
    ["SUM(", "unexpected end of formula", ""],
    // M10 (ADR 0013)
    [
      'CALCULATE(orders.id, orders.status = "paid")',
      "CALCULATE needs a measure, e.g. CALCULATE(SUM(table.column), condition)",
      "orders.id",
    ],
    [
      "CALCULATE([Revenue], [Orders] > 1)",
      "CALCULATE's conditions are about each row, not aggregates",
      "[Orders] > 1",
    ],
    [
      "CALCULATE([Revenue], orders.status)",
      "CALCULATE's conditions are true/false values, not a string",
      "orders.status",
    ],
    ["CALCULATE([Revenue])", "CALCULATE takes at least 2 arguments", "CALCULATE([Revenue])"],
    [
      "ALL(orders.status)",
      "ALL only works as a CALCULATE condition, e.g. CALCULATE([Revenue], ALL(table.column))",
      "ALL(orders.status)",
    ],
    ["CALCULATE([Revenue], ALL(1))", "ALL takes a field, e.g. ALL(table.column)", "1"],
    [
      "PREVIOUSPERIOD(order_items.quantity)",
      "PREVIOUSPERIOD needs a measure, e.g. PREVIOUSPERIOD([Revenue])",
      "order_items.quantity",
    ],
    [
      "RUNNINGSUM(MAX(orders.ordered_at))",
      "RUNNINGSUM needs a number, not a date",
      "MAX(orders.ordered_at)",
    ],
    [
      "PREVIOUSPERIOD(RUNNINGSUM([Orders]))",
      "PREVIOUSPERIOD and RUNNINGSUM cannot be nested",
      "RUNNINGSUM([Orders])",
    ],
    ["SUM(PREVIOUSPERIOD([Orders]))", "aggregates cannot be nested", "PREVIOUSPERIOD([Orders])"],
    [
      "PREVIOUSPERIOD(CALCULATE([Revenue], ALL(orders.status)))",
      "ALL and PREVIOUSPERIOD don't combine in one measure yet",
      "CALCULATE([Revenue], ALL(orders.status))",
    ],
    [
      "CALCULATE(PREVIOUSPERIOD([Revenue]), ALL(orders.status))",
      "ALL and PREVIOUSPERIOD don't combine in one measure yet",
      "PREVIOUSPERIOD([Revenue])",
    ],
  ])("rejects %s: %s", (source, message, fragment) => {
    const start = source.lastIndexOf(fragment);
    expect(check(source, env)).toEqual({
      ok: false,
      errors: [{ message, start, end: start + fragment.length }],
    });
  });

  it("reports every error, not only the first", () => {
    const result = check("SUM(orders.nope) + MIN(orders.refunded) + FOO(1)", env);
    expect(result.ok || result.errors.map((e) => e.message)).toEqual([
      "unknown column orders.nope",
      "MIN needs a number, date or string",
      "unknown function FOO",
    ]);
  });

  it("rejects measures that grow too large once expanded, without expanding them", () => {
    const measures = new Map([["M0", "SUM(order_items.quantity)"]]);
    for (let i = 1; i <= 12; i++) measures.set(`M${i}`, `[M${i - 1}] + [M${i - 1}]`);
    const result = check("[M12]", { contract, measures });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("too large");
  });

  it("follows measure references up to 16 levels deep", () => {
    const chain = (n: number) => {
      const measures = new Map([[`M${n}`, "SUM(order_items.quantity)"]]);
      for (let i = n - 1; i >= 0; i--) measures.set(`M${i}`, `[M${i + 1}] * 1`);
      return check("[M0]", { contract, measures });
    };
    expect(chain(15).ok).toBe(true);
    const deep = chain(17);
    expect(deep.ok).toBe(false);
    if (!deep.ok) expect(deep.errors[0]?.message).toContain("references nest more than 16 levels");
  });
});

describe("resolveField", () => {
  it("lists every schema's column for a bare table name that is in several", () => {
    expect(resolveField(["customers", "id"], contract)).toMatchObject({
      ok: false,
      reason: "ambiguous",
      choices: ["archive.customers.id", "shop.customers.id"],
    });
  });
});
