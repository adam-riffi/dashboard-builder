import { type DashboardSpec, type DataContract, dashboardSpec } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { type LostRef, lostRefs, remap, replacements } from "../src/builder-entry.ts";
import { shop } from "./shop.ts";

const dashboard = (extra: Partial<DashboardSpec>): DashboardSpec =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Lost",
    layout: (extra.visuals ?? []).map((v, k) => ({ i: v.id, x: 0, y: k, w: 12, h: 2 })),
    visuals: [],
    ...extra,
  });
const visual = (id: string, type: string, slots: DashboardSpec["visuals"][number]["slots"]) => ({
  id,
  type,
  slots,
  options: {},
});

// The shop contract has orders(id, status, ordered_at), order_items(id, order_id, product_id,
// quantity), products(id, category) and the host measure Revenue; everything else here is lost.
const broken = dashboard({
  measures: [
    { name: "Units", formula: "SUM(order_items.qty)" },
    { name: "Ratio", formula: "DIVIDE([Units], [Margin])" },
  ],
  filters: [{ field: "dash_demo.orders.state", op: "in", values: ["paid"] }],
  visuals: [
    visual("bar", "bar", {
      category: [{ field: "dash_demo.products.kind" }],
      value: [{ name: "Revenue" }],
    }),
    visual("paid", "kpi", { value: [{ formula: "COUNT(orders.state)" }] }),
    visual("returns", "kpi", { value: [{ field: "dash_demo.returns.id", aggregation: "COUNT" }] }),
    visual("margin", "kpi", { value: [{ name: "Margin" }] }),
  ],
});
const lost = (name: string) => lostRefs(broken, shop).find((r) => r.name === name) as LostRef;

describe("lostRefs (ADR 0011)", () => {
  it("finds every table, column and measure the contract no longer has, with where each is used", () => {
    expect(lostRefs(broken, shop)).toEqual([
      {
        kind: "field",
        name: "dash_demo.products.kind",
        usages: [{ kind: "slot", visualId: "bar", slot: "category", index: 0 }],
        removable: true,
      },
      {
        kind: "field",
        name: "dash_demo.orders.state",
        usages: [
          { kind: "formula", visualId: "paid", slot: "value", index: 0 },
          { kind: "filter", index: 0 },
        ],
        removable: true,
      },
      {
        kind: "field",
        name: "dash_demo.returns.id",
        usages: [{ kind: "slot", visualId: "returns", slot: "value", index: 0 }],
        removable: true,
      },
      {
        kind: "measure",
        name: "Margin",
        usages: [
          { kind: "slot", visualId: "margin", slot: "value", index: 0 },
          { kind: "measure", name: "Ratio" },
        ],
        removable: false,
      },
      {
        kind: "field",
        name: "dash_demo.order_items.qty",
        usages: [{ kind: "measure", name: "Units" }],
        removable: false,
      },
    ]);
  });

  it("merges the two spellings of a dropped table's field when the contract has one schema", () => {
    const dropped = dashboard({
      visuals: [
        visual("a", "kpi", { value: [{ field: "dash_demo.returns.id", aggregation: "COUNT" }] }),
        visual("b", "kpi", { value: [{ formula: "COUNT(returns.id)" }] }),
      ],
    });
    expect(lostRefs(dropped, shop)).toEqual([
      {
        kind: "field",
        name: "dash_demo.returns.id",
        usages: [
          { kind: "slot", visualId: "a", slot: "value", index: 0 },
          { kind: "formula", visualId: "b", slot: "value", index: 0 },
        ],
        removable: true,
      },
    ]);
  });

  it("finds nothing in a dashboard the contract fully covers", () => {
    const healthy = dashboard({
      measures: [{ name: "Units", formula: "SUM(order_items.quantity)" }],
      filters: [{ field: "dash_demo.orders.status", op: "in", values: ["paid"] }],
      visuals: [
        visual("bar", "bar", {
          category: [{ field: "dash_demo.products.category" }],
          value: [
            { name: "Revenue" },
            { name: "Units" },
            { formula: "COUNT(dash_demo.orders.id)" },
          ],
        }),
      ],
    });
    expect(lostRefs(healthy, shop)).toEqual([]);
  });
});

describe("replacements (ADR 0011)", () => {
  it.each([
    // Same table first, then the role the usage needs: a category axis wants a dimension.
    ["dash_demo.products.kind", ["dash_demo.products.category", "dash_demo.products.id"]],
    // A filter on text values takes text columns, never a date column; its table comes first.
    ["dash_demo.orders.state", ["dash_demo.orders.status", "dash_demo.products.category"]],
    // Inside a formula any column fits; the measure column of the same table leads.
    ["dash_demo.order_items.qty", ["dash_demo.order_items.quantity", "dash_demo.order_items.id"]],
  ])("ranks the columns that fit every use of %s", (name, first) => {
    expect(replacements(lost(name), broken, shop).slice(0, 2)).toEqual(first);
  });

  it("ranks columns sharing a part of the lost name first", () => {
    const renamed = dashboard({
      visuals: [
        visual("bar", "bar", {
          category: [{ field: "dash_demo.orders.order_status" }],
          value: [{ name: "Revenue" }],
        }),
      ],
    });
    const [ref] = lostRefs(renamed, shop);
    expect(replacements(ref as LostRef, renamed, shop)[0]).toBe("dash_demo.orders.status");
  });

  it("offers a measure slot only columns its aggregation can read", () => {
    const sums = dashboard({
      visuals: [
        visual("kpi", "kpi", { value: [{ field: "dash_demo.orders.total", aggregation: "SUM" }] }),
      ],
    });
    const [ref] = lostRefs(sums, shop);
    for (const field of replacements(ref as LostRef, sums, shop)) {
      expect([
        "dash_demo.orders.id",
        "dash_demo.order_items.id",
        "dash_demo.order_items.order_id",
        "dash_demo.order_items.product_id",
        "dash_demo.order_items.quantity",
        "dash_demo.products.id",
      ]).toContain(field);
    }
  });

  it("offers the other measures for a lost one, never one that uses it", () => {
    expect(replacements(lost("Margin"), broken, shop)).toEqual(["Revenue", "Units"]);
  });

  it("never offers a measure that uses the lost one through another, and names each once", () => {
    const chained = dashboard({
      measures: [
        { name: "Margin pct", formula: "DIVIDE([Margin], [Revenue])" },
        { name: "Margin ratio", formula: "[Margin pct] * 100" },
        // A dashboard measure the host later defined too: offered once.
        { name: "Revenue", formula: "SUM(order_items.quantity)" },
      ],
      visuals: [visual("kpi", "kpi", { value: [{ name: "Margin" }] })],
    });
    const [margin] = lostRefs(chained, shop);
    expect(replacements(margin as LostRef, chained, shop)).toEqual(["Revenue"]);
  });

  it("offers a date column to a text filter only when its values are dates", () => {
    const since = dashboard({
      filters: [{ field: "dash_demo.orders.placed_at", op: "gte", values: ["2026-09-01"] }],
    });
    const [ref] = lostRefs(since, shop);
    expect(replacements(ref as LostRef, since, shop)).toContain("dash_demo.orders.ordered_at");
  });
});

describe("remap (ADR 0011)", () => {
  it("rewrites every use of a lost field, keeping how each use reads it", () => {
    const fixed = remap(broken, lost("dash_demo.orders.state"), "dash_demo.orders.status", shop);
    expect(fixed.filters).toEqual([
      { field: "dash_demo.orders.status", op: "in", values: ["paid"] },
    ]);
    expect(fixed.visuals[1]?.slots.value).toEqual([{ formula: "COUNT(dash_demo.orders.status)" }]);
    expect(lostRefs(fixed, shop).map((r) => r.name)).not.toContain("dash_demo.orders.state");
  });

  it("rewrites a field inside a dashboard measure and keeps a slot item's aggregation", () => {
    const units = remap(
      broken,
      lost("dash_demo.order_items.qty"),
      "dash_demo.order_items.quantity",
      shop,
    );
    expect(units.measures[0]).toEqual({
      name: "Units",
      formula: "SUM(dash_demo.order_items.quantity)",
    });
    const returns = remap(broken, lost("dash_demo.returns.id"), "dash_demo.orders.id", shop);
    expect(returns.visuals[2]?.slots.value).toEqual([
      { field: "dash_demo.orders.id", aggregation: "COUNT" },
    ]);
  });

  it("renames a lost measure in slots and formulas", () => {
    const fixed = remap(broken, lost("Margin"), "Revenue", shop);
    expect(fixed.visuals[3]?.slots.value).toEqual([{ name: "Revenue" }]);
    expect(fixed.measures[1]?.formula).toBe("DIVIDE([Units], [Revenue])");
  });

  it("removes the slot items and filters that used a removable field", () => {
    const fixed = remap(broken, lost("dash_demo.orders.state"), null, shop);
    expect(fixed.filters).toEqual([]);
    expect(fixed.visuals[1]?.slots.value).toEqual([]);
  });

  it("leaves a dashboard whose lost references are all fixed valid and clean", () => {
    let fixed = broken;
    for (const ref of lostRefs(broken, shop)) {
      fixed = remap(fixed, ref, replacements(ref, fixed, shop)[0] ?? null, shop);
    }
    expect(lostRefs(fixed, shop)).toEqual([]);
    expect(dashboardSpec.safeParse(fixed).success).toBe(true);
  });
});

describe("ambiguous references (M9)", () => {
  // Another schema gains an `orders` table: `orders.id` in a formula no longer names one table.
  const orders = shop.tables.find(
    (t) => t.name === "dash_demo.orders",
  ) as DataContract["tables"][number];
  const twoSchemas: DataContract = {
    ...shop,
    tables: [...shop.tables, { ...orders, name: "archive.orders" }],
  };
  const counted = dashboard({
    measures: [{ name: "Count", formula: "COUNT(orders.id)" }],
    visuals: [visual("kpi", "kpi", { value: [{ name: "Count" }] })],
  });

  // With nothing else in the dashboard to tell the schemas apart, they come alphabetically.
  it("reports a table.column that became ambiguous, each schema's column first", () => {
    const [ref] = lostRefs(counted, twoSchemas);
    expect(ref).toEqual({
      kind: "field",
      name: "orders.id",
      usages: [{ kind: "measure", name: "Count" }],
      removable: false,
    });
    expect(replacements(ref as LostRef, counted, twoSchemas).slice(0, 2)).toEqual([
      "archive.orders.id",
      "dash_demo.orders.id",
    ]);
  });

  it("offers first the schema the dashboard already reads", () => {
    const withBar = dashboard({
      measures: counted.measures,
      visuals: [
        ...counted.visuals,
        visual("bar", "bar", {
          category: [{ field: "dash_demo.products.category" }],
          value: [{ name: "Count" }],
        }),
      ],
    });
    const [ref] = lostRefs(withBar, twoSchemas);
    expect(replacements(ref as LostRef, withBar, twoSchemas).slice(0, 2)).toEqual([
      "dash_demo.orders.id",
      "archive.orders.id",
    ]);
  });

  it("rewrites it to the chosen schema's column", () => {
    const [ref] = lostRefs(counted, twoSchemas);
    const fixed = remap(counted, ref as LostRef, "dash_demo.orders.id", twoSchemas);
    expect(fixed.measures[0]?.formula).toBe("COUNT(dash_demo.orders.id)");
    expect(lostRefs(fixed, twoSchemas)).toEqual([]);
  });
});
