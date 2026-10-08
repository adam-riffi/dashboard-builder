import { describe, expect, it } from "vitest";
import { dashboardSpec, MAX_QUERIES } from "../src/index.ts";

const category = { field: "dash_demo.products.category" };
const revenue = { name: "Revenue" };

/** The demo's sample dashboard, trimmed: a KPI and a bar chart. */
const sample = {
  specVersion: 1,
  contractVersion: "a".repeat(64),
  title: "Acme Shop overview",
  measures: [{ name: "Units", formula: "SUM(order_items.quantity)", format: "number" }],
  filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid", "shipped"] }],
  layout: [
    { i: "kpi", x: 0, y: 0, w: 4, h: 2 },
    { i: "bar", x: 4, y: 0, w: 8, h: 4 },
  ],
  visuals: [
    { id: "kpi", type: "kpi", slots: { value: [revenue] } },
    {
      id: "bar",
      type: "bar",
      slots: { category: [category], value: [revenue, { formula: "COUNT(orders.id)" }] },
      options: { sort: "desc" },
    },
  ],
};
const parse = (spec: unknown) => dashboardSpec.safeParse(spec);
const withVisuals = (n: number) => ({
  ...sample,
  layout: Array.from({ length: n }, (_, k) => ({ i: `v${k}`, x: 0, y: k, w: 12, h: 1 })),
  visuals: Array.from({ length: n }, (_, k) => ({
    id: `v${k}`,
    type: "kpi",
    slots: { value: [revenue] },
  })),
});

describe("dashboardSpec", () => {
  it("accepts a dashboard and fills the refresh interval and visual options", () => {
    const spec = dashboardSpec.parse(sample);
    expect(spec.refreshIntervalSec).toBe(60);
    expect(spec.visuals[0]?.options).toEqual({});
    expect(spec.visuals[1]?.slots.value).toEqual([revenue, { formula: "COUNT(orders.id)" }]);
  });

  it("takes fields with time grains and every measure form in slots", () => {
    const line = {
      id: "line",
      type: "line",
      slots: {
        axis: [{ field: "dash_demo.orders.ordered_at", timeGrain: "day" }],
        value: [{ field: "dash_demo.order_items.quantity", aggregation: "SUM" }, revenue],
      },
    };
    const spec = { ...sample, layout: [{ i: "line", x: 0, y: 0, w: 12, h: 4 }], visuals: [line] };
    expect(parse(spec).success).toBe(true);
  });

  it.each([
    ["a later spec version", { specVersion: 2 }],
    ["a contract version that is not a schema hash", { contractVersion: "v1" }],
    ["an empty title", { title: "" }],
    ["a refresh faster than 5 seconds", { refreshIntervalSec: 1 }],
    [
      "an unknown measure format",
      { measures: [{ name: "U", formula: "COUNT(1)", format: "euro" }] },
    ],
    [
      "two measures with one name",
      {
        measures: [
          { name: "U", formula: "COUNT(1)" },
          { name: "U", formula: "COUNT(2)" },
        ],
      },
    ],
    ["unknown keys", { sql: "drop table x" }],
  ])("rejects %s", (_, change) => {
    expect(parse({ ...sample, ...change }).success).toBe(false);
  });

  it("needs one layout cell per visual, inside the 12 columns", () => {
    expect(parse({ ...sample, layout: sample.layout.slice(0, 1) }).success).toBe(false);
    const wide = [sample.layout[0], { i: "bar", x: 6, y: 0, w: 8, h: 4 }];
    expect(parse({ ...sample, layout: wide }).success).toBe(false);
    const stray = [...sample.layout, { i: "ghost", x: 0, y: 9, w: 1, h: 1 }];
    expect(parse({ ...sample, layout: stray }).success).toBe(false);
  });

  it("rejects duplicate visual ids and malformed slot items", () => {
    const twice = { ...sample, visuals: [sample.visuals[0], { ...sample.visuals[1], id: "kpi" }] };
    expect(parse(twice).success).toBe(false);
    const bad = { ...sample.visuals[0], slots: { value: [{ field: "orders.total" }] } };
    expect(parse({ ...sample, visuals: [bad, sample.visuals[1]] }).success).toBe(false);
  });

  it(`holds at most ${MAX_QUERIES} visuals, one query each`, () => {
    expect(parse(withVisuals(MAX_QUERIES)).success).toBe(true);
    expect(parse(withVisuals(MAX_QUERIES + 1)).success).toBe(false);
  });
});

describe("measure formats", () => {
  it("lets dashboard measures carry a display format", () => {
    expect(dashboardSpec.parse(sample).measures[0]?.format).toBe("number");
  });
});
