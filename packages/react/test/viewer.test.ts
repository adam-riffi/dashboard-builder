import { dashboardSpec, type QueryAnswer, type QueryResult } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { titleOf, visualState } from "../src/index.ts";

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
  it("uses the visual's own title first", () => {
    expect(titleOf({ title: "Top sellers" }, result([category, revenue], [[], []]))).toBe(
      "Top sellers",
    );
  });

  it("names the measures by the fields otherwise", () => {
    expect(titleOf({}, result([category, revenue, units], [[], [], []]))).toBe(
      "Revenue and Total quantity by Category",
    );
    expect(titleOf({}, result([revenue], [[]]))).toBe("Revenue");
    expect(titleOf({}, undefined)).toBe("");
  });
});

describe("titles of time axes", () => {
  it("names a time axis by its grain", () => {
    const day = {
      key: "d0",
      kind: "dimension",
      field: "dash_demo.orders.ordered_at",
      timeGrain: "day",
      type: "date",
    } as const;
    expect(titleOf({}, result([day, revenue], [[], []]))).toBe("Revenue by day");
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
