import { describe, expect, it } from "vitest";
import { type CheckEnv, check, type DataContract, type FieldType } from "../../src/index.ts";

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
  ])("accepts %s as an aggregate %s", (source, type) => {
    expect(typed(source)).toMatchObject({ type, level: "aggregate" });
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
      "ROUND's digits must be a whole number like 2",
      "1.5",
    ],
    [
      "ROUND(SUM(order_items.quantity), order_items.id)",
      "ROUND's digits must be a whole number like 2",
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
    for (let i = 1; i <= 40; i++) measures.set(`M${i}`, `[M${i - 1}] + [M${i - 1}]`);
    const result = check("[M40]", { contract, measures });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("too large");
  });
});
