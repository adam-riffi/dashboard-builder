import { describe, expect, it } from "vitest";
import {
  MAX_FORMULA_LENGTH,
  MAX_NAMED_MEASURES,
  MAX_QUERIES,
  MAX_ROWS,
  queryRequest,
  querySpec,
} from "../src/index.ts";

const revenue = { field: "dash_demo.order_items.unit_price", aggregation: "SUM" } as const;
const parse = (spec: unknown) => querySpec.safeParse(spec);

describe("querySpec", () => {
  it("accepts a measure-only query and defaults dimensions and filters", () => {
    expect(querySpec.parse({ measures: [revenue] })).toEqual({
      dimensions: [],
      measures: [revenue],
      filters: [],
    });
  });

  it("accepts dimensions with time grains, filters, sort and limit", () => {
    const spec = {
      dimensions: [
        { field: "dash_demo.products.category" },
        { field: "dash_demo.orders.ordered_at", timeGrain: "month" },
      ],
      measures: [{ field: "dash_demo.order_items.quantity" }],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid", "shipped"] }],
      sort: [{ by: "measure", index: 0, dir: "desc" }],
      limit: 50,
    };
    expect(querySpec.parse(spec)).toEqual(spec);
  });

  it("names fields as schema.table.column", () => {
    expect(parse({ measures: [{ field: "orders.total" }] }).success).toBe(false);
    expect(parse({ measures: [{ field: "a.b.c.d" }] }).success).toBe(false);
  });

  it("needs at least one measure", () => {
    expect(parse({ measures: [] }).success).toBe(false);
    expect(parse({ dimensions: [{ field: "dash_demo.products.category" }] }).success).toBe(false);
  });

  it("only knows the M2 aggregations and time grains", () => {
    expect(parse({ measures: [{ ...revenue, aggregation: "MEDIAN" }] }).success).toBe(false);
    const dims = [{ field: "dash_demo.orders.ordered_at", timeGrain: "hour" }];
    expect(parse({ dimensions: dims, measures: [revenue] }).success).toBe(false);
  });

  it.each([
    ["in", [], false],
    ["in", ["a"], true],
    ["not_in", ["a", "b"], true],
    ["between", [1], false],
    ["between", [1, 2], true],
    ["gt", [1], true],
    ["lte", [1, 2], false],
  ] as const)("checks how many values %s takes (%j)", (op, values, ok) => {
    const filters = [{ field: "dash_demo.orders.status", op, values }];
    expect(parse({ measures: [revenue], filters }).success).toBe(ok);
  });

  it(`caps the limit at ${MAX_ROWS} rows`, () => {
    expect(parse({ measures: [revenue], limit: MAX_ROWS }).success).toBe(true);
    expect(parse({ measures: [revenue], limit: MAX_ROWS + 1 }).success).toBe(false);
    expect(parse({ measures: [revenue], limit: 0 }).success).toBe(false);
  });

  it("rejects sort entries that point at nothing sensible and unknown keys", () => {
    expect(
      parse({ measures: [revenue], sort: [{ by: "row", index: 0, dir: "asc" }] }).success,
    ).toBe(false);
    expect(
      parse({ measures: [revenue], sort: [{ by: "measure", index: -1, dir: "asc" }] }).success,
    ).toBe(false);
    expect(parse({ measures: [revenue], sql: "drop table x" }).success).toBe(false);
  });
});

describe("querySpec size caps", () => {
  const many = <T>(n: number, item: T) => Array.from({ length: n }, () => item);

  it("caps list sizes and field length at the trust boundary", () => {
    expect(parse({ measures: many(21, revenue) }).success).toBe(false);
    expect(parse({ measures: many(20, revenue) }).success).toBe(true);
    const dim = { field: "dash_demo.products.category" };
    expect(parse({ measures: [revenue], dimensions: many(11, dim) }).success).toBe(false);
    const filter = { field: "dash_demo.orders.status", op: "in", values: many(1001, "x") };
    expect(parse({ measures: [revenue], filters: [filter] }).success).toBe(false);
    expect(
      parse({ measures: [revenue], filters: many(21, { ...filter, values: ["x"] }) }).success,
    ).toBe(false);
    const sort = { by: "measure", index: 0, dir: "asc" };
    expect(parse({ measures: [revenue], sort: many(11, sort) }).success).toBe(false);
    expect(parse({ measures: [{ field: `a.b.${"c".repeat(200)}` }] }).success).toBe(false);
  });
});

describe("queryRequest", () => {
  it(`takes 1 to ${MAX_QUERIES} queries`, () => {
    const queries = (n: number) => ({
      queries: Array.from({ length: n }, () => ({ measures: [revenue] })),
    });
    expect(queryRequest.safeParse(queries(0)).success).toBe(false);
    expect(queryRequest.safeParse(queries(MAX_QUERIES)).success).toBe(true);
    expect(queryRequest.safeParse(queries(MAX_QUERIES + 1)).success).toBe(false);
  });
});

describe("formula and named measures", () => {
  it("accepts column, formula and named measures side by side", () => {
    const measures = [revenue, { formula: "SUM(order_items.quantity)" }, { name: "Revenue" }];
    expect(querySpec.parse({ measures }).measures).toEqual(measures);
  });

  it("rejects mixed, empty and overlong formulas", () => {
    expect(parse({ measures: [{ formula: "COUNT(1)", name: "X" }] }).success).toBe(false);
    expect(parse({ measures: [{ formula: "" }] }).success).toBe(false);
    const long = "1".repeat(MAX_FORMULA_LENGTH + 1);
    expect(parse({ measures: [{ formula: long }] }).success).toBe(false);
  });

  it.each(["", "a]b", "[x", " Padded", "Padded ", "x".repeat(101)])(
    "rejects the measure name %j",
    (name) => {
      expect(parse({ measures: [{ name }] }).success).toBe(false);
    },
  );

  it(`carries up to ${MAX_NAMED_MEASURES} uniquely named dashboard measures per request`, () => {
    const queries = [{ measures: [{ name: "M0" }] }];
    const named = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `M${i}`, formula: "COUNT(1)" }));
    const request = (measures: unknown) => queryRequest.safeParse({ measures, queries });
    expect(request(named(MAX_NAMED_MEASURES)).success).toBe(true);
    expect(request(named(MAX_NAMED_MEASURES + 1)).success).toBe(false);
    expect(request([...named(1), ...named(1)]).success).toBe(false);
    expect(queryRequest.parse({ queries }).measures).toBeUndefined();
  });
});
