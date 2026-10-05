import { readFileSync } from "node:fs";
import { dataContract, type QuerySpec, querySpec } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { validateQuery } from "../../src/query/validate.ts";

// The demo contract from M1's golden file: real tables, roles and relationships.
const contract = dataContract.parse(
  JSON.parse(
    readFileSync(
      new URL("../integration/fixtures/dash_demo.contract.json", import.meta.url),
      "utf8",
    ),
  ),
);
const spec = (s: Partial<QuerySpec> & Pick<QuerySpec, "measures">) => querySpec.parse(s);
const errorsOf = (s: QuerySpec) => {
  const result = validateQuery(s, contract);
  return result.ok ? [] : result.errors;
};

const quantity = { field: "dash_demo.order_items.quantity" };

describe("validateQuery", () => {
  it("resolves fields and fills the contract's default aggregation and the row limit", () => {
    const result = validateQuery(
      spec({ dimensions: [{ field: "dash_demo.products.category" }], measures: [quantity] }),
      contract,
    );
    expect(result).toMatchObject({
      ok: true,
      query: {
        dimensions: [{ table: "dash_demo.products", column: { name: "category" } }],
        measures: [
          { table: "dash_demo.order_items", column: { name: "quantity" }, aggregation: "SUM" },
        ],
        filters: [],
        sort: [],
        limit: 10_000,
      },
    });
  });

  it("keeps an explicit aggregation, sort and limit", () => {
    const result = validateQuery(
      spec({
        measures: [{ ...quantity, aggregation: "MAX" }],
        sort: [{ by: "measure", index: 0, dir: "desc" }],
        limit: 5,
      }),
      contract,
    );
    expect(result).toMatchObject({
      ok: true,
      query: { measures: [{ aggregation: "MAX" }], sort: [{ by: "measure", index: 0 }], limit: 5 },
    });
  });

  it("names unknown tables and columns", () => {
    expect(errorsOf(spec({ measures: [{ field: "dash_demo.nope.x" }] }))).toEqual([
      "dash_demo.nope.x: unknown table dash_demo.nope",
    ]);
    expect(errorsOf(spec({ measures: [{ field: "dash_demo.orders.nope" }] }))).toEqual([
      "dash_demo.orders.nope: unknown column",
    ]);
  });

  it("needs an explicit aggregation on columns that are not measures", () => {
    expect(errorsOf(spec({ measures: [{ field: "dash_demo.orders.id" }] }))).toEqual([
      "dash_demo.orders.id: not a measure column; choose an aggregation",
    ]);
    expect(
      errorsOf(spec({ measures: [{ field: "dash_demo.orders.id", aggregation: "COUNT" }] })),
    ).toEqual([]);
  });

  it.each([
    ["SUM", "dash_demo.orders.status", "SUM needs a number column"],
    ["AVG", "dash_demo.orders.ordered_at", "AVG needs a number column"],
  ] as const)("rejects %s on %s", (aggregation, field, message) => {
    expect(errorsOf(spec({ measures: [{ field, aggregation }] }))).toEqual([
      `${field}: ${message}`,
    ]);
  });

  it("allows MIN, MAX and counts on dates and strings", () => {
    const measures = [
      { field: "dash_demo.orders.ordered_at", aggregation: "MIN" },
      { field: "dash_demo.orders.status", aggregation: "MAX" },
      { field: "dash_demo.orders.status", aggregation: "COUNT_DISTINCT" },
    ] as const;
    expect(errorsOf(spec({ measures: [...measures] }))).toEqual([]);
  });

  it("only puts time grains on date columns", () => {
    const dimensions = [{ field: "dash_demo.orders.status", timeGrain: "month" as const }];
    expect(errorsOf(spec({ dimensions, measures: [quantity] }))).toEqual([
      "dash_demo.orders.status: time grains need a date column",
    ]);
  });

  it.each([
    ["dash_demo.order_items.quantity", "gt", ["3"], "values must be numbers"],
    ["dash_demo.orders.status", "in", [1], "values must be strings"],
    ["dash_demo.orders.ordered_at", "gte", ["yesterday"], "values must be ISO dates"],
  ] as const)("checks filter values on %s", (field, op, values, message) => {
    const filters = [{ field, op, values: [...values] }];
    expect(errorsOf(spec({ measures: [quantity], filters }))).toEqual([`${field}: ${message}`]);
  });

  it("accepts well-typed filters", () => {
    const filters = [
      { field: "dash_demo.orders.ordered_at", op: "between", values: ["2026-01-01", "2026-02-01"] },
      { field: "dash_demo.order_items.quantity", op: "gte", values: [2] },
      { field: "dash_demo.orders.status", op: "not_in", values: ["refunded"] },
    ] as const;
    const mutable = filters.map((f) => ({ ...f, values: [...f.values] }));
    expect(errorsOf(spec({ measures: [quantity], filters: mutable }))).toEqual([]);
  });

  it("checks that sort entries point at a dimension or measure", () => {
    const sort = [{ by: "dimension" as const, index: 0, dir: "asc" as const }];
    expect(errorsOf(spec({ measures: [quantity], sort }))).toEqual([
      "sort[0]: there is no dimension 0",
    ]);
  });

  it("reports every problem at once", () => {
    const errors = errorsOf(
      spec({
        dimensions: [{ field: "dash_demo.orders.nope" }],
        measures: [{ field: "dash_demo.orders.status", aggregation: "SUM" }],
      }),
    );
    expect(errors).toHaveLength(2);
  });

  it("handles true/false columns (saas fixture)", () => {
    const saas = dataContract.parse(
      JSON.parse(
        readFileSync(
          new URL("../integration/fixtures/saas.contract.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const active = "fx_saas.accounts.is_active";
    const seats = { field: "fx_saas.invoices.seats" };
    const check = (s: QuerySpec) => {
      const r = validateQuery(s, saas);
      return r.ok ? [] : r.errors;
    };
    expect(check(spec({ measures: [{ field: active, aggregation: "MAX" }] }))).toEqual([
      `${active}: MAX needs a number, date or string column`,
    ]);
    expect(
      check(spec({ measures: [seats], filters: [{ field: active, op: "in", values: [true] }] })),
    ).toEqual([]);
    expect(
      check(spec({ measures: [seats], filters: [{ field: active, op: "gt", values: [true] }] })),
    ).toEqual([`${active}: gt does not apply to true/false columns`]);
    expect(
      check(spec({ measures: [seats], filters: [{ field: active, op: "in", values: ["yes"] }] })),
    ).toEqual([`${active}: values must be true or false`]);
  });
});
