import { dashboardSpec, type QueryAnswer, type QueryResult } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { formatsOf, titleOf, visualState } from "../src/index.ts";

const result = (columns: QueryResult["columns"], data: unknown[][]): QueryResult => ({
  columns,
  data,
  meta: { cache: "miss", ms: 4, truncated: false },
});
const category = {
  key: "d0",
  kind: "dimension",
  field: "dash_demo.products.category",
  type: "string",
} as const;
const revenue = { key: "m0", kind: "measure", type: "number", name: "Revenue" } as const;
const units = {
  key: "m1",
  kind: "measure",
  type: "number",
  field: "dash_demo.order_items.quantity",
  aggregation: "SUM",
} as const;

describe("visualState", () => {
  const ready = result([category, revenue], [["Books"], [12]]);

  it.each([
    [
      "the request failed",
      { answer: undefined, pending: false, failed: true },
      { kind: "error", messages: ["This dashboard could not load. Try again shortly."] },
    ],
    [
      "the answer is on its way",
      { answer: undefined, pending: true, failed: false },
      { kind: "loading" },
    ],
    [
      "the query has errors",
      { answer: { errors: ["Query failed"] } as QueryAnswer, pending: false, failed: false },
      { kind: "error", messages: ["Query failed"] },
    ],
    [
      "no rows came back",
      { answer: result([category, revenue], [[], []]), pending: false, failed: false },
      { kind: "empty" },
    ],
    [
      "rows came back",
      { answer: ready, pending: false, failed: false },
      { kind: "ready", result: ready },
    ],
  ] as const)("shows %s", (_, input, expected) => {
    expect(visualState(input.answer, input.pending, input.failed)).toEqual(expected);
  });
});

describe("titleOf", () => {
  const bar = {
    type: "bar",
    slots: {
      category: [{ field: "dash_demo.products.category" }],
      value: [
        { name: "Revenue" },
        { field: "dash_demo.order_items.quantity", aggregation: "SUM" as const },
      ],
    },
    options: {},
  };

  it("uses the visual's own title first", () => {
    expect(titleOf({ ...bar, title: "Top sellers" })).toBe("Top sellers");
  });

  it("names the measures by the fields from the spec, before any answer", () => {
    expect(titleOf(bar)).toBe("Revenue and Total quantity by Category");
    expect(titleOf({ type: "kpi", slots: { value: [{ name: "Revenue" }] }, options: {} })).toBe(
      "Revenue",
    );
    // A column in a measure slot is a measure, even without an aggregation.
    expect(
      titleOf({
        type: "kpi",
        slots: { value: [{ field: "dash_demo.order_items.quantity" }] },
        options: {},
      }),
    ).toBe("Quantity");
  });

  it("names a time axis by its grain, from the field or the visual's options", () => {
    const axis = { field: "dash_demo.orders.ordered_at" };
    const line = (grain: object, options: object) => ({
      type: "line",
      slots: { axis: [{ ...axis, ...grain }], value: [{ name: "Orders" }] },
      options,
    });
    expect(titleOf(line({}, { grain: "month" }))).toBe("Orders by month");
    expect(titleOf(line({ timeGrain: "week" }, {}))).toBe("Orders by week");
    expect(titleOf(line({}, {}))).toBe("Orders by day");
  });

  it("still names a visual of an unknown type", () => {
    expect(titleOf({ type: "pie", slots: {}, options: {} })).toBe("A pie visual");
  });
});

describe("refreshes", () => {
  const ready = result([category, revenue], [["Books"], [12]]);

  it("keeps an answer on screen while it refreshes, and when a refresh fails", () => {
    expect(visualState(ready, true, false)).toEqual({ kind: "ready", result: ready });
    expect(visualState(ready, false, true)).toEqual({ kind: "ready", result: ready });
  });
});

describe("formatsOf", () => {
  it("takes host formats, overridden by the dashboard's measures of the same name", () => {
    const host = [
      { name: "Revenue", format: "currency" as const },
      { name: "Orders", format: "number" as const },
      { name: "Margin" },
    ];
    const dashboard = [
      { name: "Revenue", formula: "COUNT(orders.id)" },
      { name: "Share", formula: "SUM(order_items.quantity)", format: "percent" as const },
    ];
    expect(formatsOf(host, dashboard)).toEqual(
      new Map([
        ["Orders", "number"],
        ["Share", "percent"],
      ]),
    );
  });
});

describe("visual titles in the spec", () => {
  it("accepts an optional title on each visual", () => {
    const spec = dashboardSpec.parse({
      specVersion: 1,
      contractVersion: "a".repeat(64),
      title: "Overview",
      layout: [{ i: "kpi", x: 0, y: 0, w: 4, h: 2 }],
      visuals: [
        {
          id: "kpi",
          type: "kpi",
          title: "Revenue this year",
          slots: { value: [{ name: "Revenue" }] },
        },
      ],
    });
    expect(spec.visuals[0]?.title).toBe("Revenue this year");
  });
});
