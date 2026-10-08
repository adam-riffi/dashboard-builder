import type { ResultColumn } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { formattersFor, formatValue, labelOf } from "../src/index.ts";

const dim = (
  field: string,
  type: ResultColumn["type"],
  timeGrain?: "day" | "month" | "quarter" | "week" | "year",
): ResultColumn => ({
  key: "d0",
  kind: "dimension",
  field,
  type,
  ...(timeGrain ? { timeGrain } : {}),
});

describe("formatValue", () => {
  it.each([
    [1234.5, { format: "number" }, "1,234.5"],
    [0.123456, { format: "number" }, "0.12"],
    [1234.5, { format: "currency", currency: "USD" }, "$1,234.50"],
    [1234.5, { format: "currency", currency: "EUR" }, "€1,234.50"],
    [0.256, { format: "percent" }, "25.6%"],
    [null, { format: "number" }, "–"],
    [undefined, { format: "currency", currency: "USD" }, "–"],
  ] as const)("shows %s as %j → %s", (value, options, expected) => {
    expect(formatValue(value, { type: "number", ...options })).toBe(expected);
  });

  it.each([
    ["2026-01-03T00:00:00.000Z", "day", "Jan 3, 2026"],
    ["2026-01-05T00:00:00.000Z", "week", "Week of Jan 5, 2026"],
    ["2026-02-01T00:00:00.000Z", "month", "Feb 2026"],
    ["2026-04-01T00:00:00.000Z", "quarter", "Q2 2026"],
    ["2026-01-01T00:00:00.000Z", "year", "2026"],
    ["2026-01-03T23:30:00.000Z", undefined, "Jan 3, 2026"],
  ] as const)("shows the date %s at grain %s as %s, in UTC", (value, timeGrain, expected) => {
    expect(formatValue(value, { type: "date", ...(timeGrain ? { timeGrain } : {}) })).toBe(
      expected,
    );
  });

  it("shows text as is and true/false as Yes/No", () => {
    expect(formatValue("Books", { type: "string" })).toBe("Books");
    expect(formatValue(true, { type: "boolean" })).toBe("Yes");
    expect(formatValue(false, { type: "boolean" })).toBe("No");
  });
});

describe("labelOf", () => {
  it.each([
    [dim("dash_demo.products.category", "string"), "Category"],
    [dim("dash_demo.orders.ordered_at", "date", "month"), "Ordered at (month)"],
    [{ key: "m0", kind: "measure", type: "number", name: "Revenue" }, "Revenue"],
    [
      { key: "m0", kind: "measure", type: "number", formula: "COUNT(orders.id)" },
      "COUNT(orders.id)",
    ],
    [
      {
        key: "m0",
        kind: "measure",
        type: "number",
        field: "dash_demo.order_items.unit_price",
        aggregation: "AVG",
      },
      "Average unit price",
    ],
    [
      {
        key: "m0",
        kind: "measure",
        type: "number",
        field: "dash_demo.orders.customer_id",
        aggregation: "COUNT_DISTINCT",
      },
      "Distinct customer id",
    ],
  ] as [ResultColumn, string][])("names %j %s", (column, expected) => {
    expect(labelOf(column)).toBe(expected);
  });
});

describe("formattersFor", () => {
  it("formats named measures by their format and everything else by its type", () => {
    const columns: ResultColumn[] = [
      dim("dash_demo.orders.ordered_at", "date", "month"),
      { key: "m0", kind: "measure", type: "number", name: "Revenue" },
      { key: "m1", kind: "measure", type: "number", name: "Margin" },
      { key: "m2", kind: "measure", type: "number", formula: "COUNT(orders.id)" },
    ];
    const formats = new Map([
      ["Revenue", "currency" as const],
      ["Margin", "percent" as const],
    ]);
    const [date, revenue, margin, count] = formattersFor(columns, formats, "USD");
    expect(date?.("2026-02-01T00:00:00.000Z")).toBe("Feb 2026");
    expect(revenue?.(12.5)).toBe("$12.50");
    expect(margin?.(0.5)).toBe("50%");
    expect(count?.(1200)).toBe("1,200");
  });
});
