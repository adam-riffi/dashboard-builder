import {
  type ContractColumn,
  type DashboardSpec,
  dashboardSpec,
  MAX_QUERIES,
} from "@adam-riffi/dash-core";
import { getVisual } from "@adam-riffi/dash-visuals";
import { describe, expect, it } from "vitest";
import {
  accepts,
  addFilter,
  addVisual,
  type Draggable,
  dropItem,
  removeFilter,
  removeItem,
  removeMeasure,
  removeVisual,
  setLayout,
  setVisualOptions,
  setVisualTitle,
  upsertMeasure,
} from "../src/builder-entry.ts";

const column = (
  name: string,
  type: ContractColumn["type"],
  role: ContractColumn["role"],
  highCardinality = false,
): Draggable => ({
  kind: "column",
  table: "dash_demo.orders",
  column: {
    name,
    pgType: type,
    type,
    nullable: false,
    role,
    ...(role === "measure" ? { aggregation: "SUM" as const } : {}),
    distinct: null,
    highCardinality,
  },
});
const status = column("status", "string", "dimension");
const orderedAt = column("ordered_at", "date", "time");
const total = column("total", "number", "measure");
const customerId = column("customer_id", "number", "id");
const email = column("email", "string", "dimension", true);
const revenue: Draggable = { kind: "measure", name: "Revenue" };

const empty: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Untitled",
  layout: [],
  visuals: [],
});
const valid = (spec: DashboardSpec) => expect(dashboardSpec.safeParse(spec).success).toBe(true);
const slot = (type: string, name: string) => {
  const found = getVisual(type)?.slots.find((s) => s.name === name);
  if (!found) throw new Error(`no slot ${type}.${name}`);
  return found;
};

describe("accepts", () => {
  it.each([
    ["a named measure in a measure slot", slot("bar", "value"), revenue, true],
    ["a measure column in a measure slot", slot("bar", "value"), total, true],
    ["a text column in a measure slot", slot("bar", "value"), status, false],
    ["a text column as a category", slot("bar", "category"), status, true],
    ["an id column as a category", slot("bar", "category"), customerId, true],
    ["a measure column as a category", slot("bar", "category"), total, false],
    ["a high-cardinality column as a category", slot("bar", "category"), email, false],
    ["a named measure as a category", slot("bar", "category"), revenue, false],
    ["a date on a time axis", slot("line", "axis"), orderedAt, true],
    ["text on a time axis", slot("line", "axis"), status, false],
  ] as const)("%s: %s", (_, s, item, expected) => {
    expect(accepts(s, item)).toBe(expected);
  });
});

describe("visuals", () => {
  it("adds a visual with an empty slot set, placed below the others", () => {
    const one = addVisual(empty, "kpi");
    const two = addVisual(one.spec, "bar");
    expect(one.id).toBe("kpi-1");
    expect(two.id).toBe("bar-1");
    expect(two.spec.visuals.map((v) => v.id)).toEqual(["kpi-1", "bar-1"]);
    expect(two.spec.layout).toEqual([
      { i: "kpi-1", x: 0, y: 0, w: 4, h: 2 },
      { i: "bar-1", x: 0, y: 2, w: 6, h: 5 },
    ]);
    valid(two.spec);
  });

  it(`stops at ${MAX_QUERIES} visuals, one query each`, () => {
    let spec = empty;
    for (let i = 0; i < MAX_QUERIES; i++) spec = addVisual(spec, "kpi").spec;
    expect(addVisual(spec, "kpi")).toEqual({ spec, id: undefined });
  });

  it("removes a visual with its layout cell", () => {
    const { spec, id } = addVisual(addVisual(empty, "kpi").spec, "bar");
    const left = removeVisual(spec, id ?? "");
    expect(left.visuals.map((v) => v.id)).toEqual(["kpi-1"]);
    expect(left.layout.map((c) => c.i)).toEqual(["kpi-1"]);
    valid(left);
  });

  it("sets a title, clears it when empty, and replaces options", () => {
    const { spec, id = "" } = addVisual(empty, "bar");
    const titled = setVisualTitle(spec, id, "Top categories");
    expect(titled.visuals[0]?.title).toBe("Top categories");
    expect(setVisualTitle(titled, id, "  ").visuals[0]?.title).toBeUndefined();
    expect(setVisualOptions(spec, id, { limit: 10 }).visuals[0]?.options).toEqual({ limit: 10 });
  });

  it("takes the grid's layout for known visuals, kept inside 12 columns", () => {
    const { spec } = addVisual(addVisual(empty, "kpi").spec, "bar");
    const moved = setLayout(spec, [
      { i: "kpi-1", x: 10, y: 0, w: 4, h: 2 },
      { i: "bar-1", x: 0, y: 3, w: 12, h: 4 },
      { i: "ghost", x: 0, y: 0, w: 1, h: 1 },
    ]);
    expect(moved.layout).toEqual([
      { i: "kpi-1", x: 8, y: 0, w: 4, h: 2 },
      { i: "bar-1", x: 0, y: 3, w: 12, h: 4 },
    ]);
    valid(moved);
  });

  it("keeps cells within the spec's bounds, however far the grid pushes them", () => {
    const { spec } = addVisual(empty, "bar");
    const moved = setLayout(spec, [{ i: "bar-1", x: 0, y: 5_000, w: 12, h: 400 }]);
    expect(moved.layout).toEqual([{ i: "bar-1", x: 0, y: 1_000, w: 12, h: 100 }]);
    valid(moved);
  });
});

describe("slots", () => {
  const { spec: withBar, id: bar = "" } = addVisual(empty, "bar");

  it("drops accepted fields into a slot as slot items", () => {
    const filled = dropItem(dropItem(withBar, bar, "category", status), bar, "value", revenue);
    expect(filled.visuals[0]?.slots).toEqual({
      category: [{ field: "dash_demo.orders.status" }],
      value: [{ name: "Revenue" }],
    });
    valid(filled);
  });

  it("refuses fields a slot does not accept, and duplicates", () => {
    expect(dropItem(withBar, bar, "category", total)).toBe(withBar);
    const once = dropItem(withBar, bar, "value", revenue);
    expect(dropItem(once, bar, "value", revenue)).toBe(once);
  });

  it("replaces the item of a single-item slot, and stops a slot at its maximum", () => {
    const first = dropItem(withBar, bar, "category", status);
    const replaced = dropItem(first, bar, "category", customerId);
    expect(replaced.visuals[0]?.slots.category).toEqual([
      { field: "dash_demo.orders.customer_id" },
    ]);
    let full = withBar;
    for (const name of ["A", "B", "C", "D", "E", "F"]) {
      full = dropItem(full, bar, "value", { kind: "measure", name });
    }
    expect(full.visuals[0]?.slots.value).toHaveLength(5);
  });

  it("removes an item by position", () => {
    const filled = dropItem(dropItem(withBar, bar, "value", revenue), bar, "value", total);
    expect(removeItem(filled, bar, "value", 0).visuals[0]?.slots.value).toEqual([
      { field: "dash_demo.orders.total" },
    ]);
  });
});

describe("filters", () => {
  const paid = { field: "dash_demo.orders.status", op: "in" as const, values: ["paid"] };

  it("adds and removes dashboard filters", () => {
    const one = addFilter(empty, paid);
    expect(one.filters).toEqual([paid]);
    expect(removeFilter(one, 0).filters).toEqual([]);
    valid(one);
  });
});

describe("measures", () => {
  const units = { name: "Units", formula: "SUM(order_items.quantity)" };
  const { spec: withBar, id: bar = "" } = addVisual(empty, "bar");
  const using = dropItem(upsertMeasure(withBar, units), bar, "value", {
    kind: "measure",
    name: "Units",
  });

  it("adds a measure, and replaces one of the same name", () => {
    expect(using.measures).toEqual([units]);
    const changed = upsertMeasure(using, { ...units, format: "number" });
    expect(changed.measures).toEqual([{ ...units, format: "number" }]);
  });

  it("renames a measure everywhere: in slots and in other measures' formulas", () => {
    const double = { name: "Double", formula: "[Units] * 2" };
    const renamed = upsertMeasure(
      upsertMeasure(using, double),
      { ...units, name: "Items" },
      "Units",
    );
    expect(renamed.measures).toEqual([
      { name: "Items", formula: "SUM(order_items.quantity)" },
      { name: "Double", formula: "[Items] * 2" },
    ]);
    expect(renamed.visuals[0]?.slots.value).toEqual([{ name: "Items" }]);
    valid(renamed);
  });

  it("renames references only, never text inside a string", () => {
    const quoted = { name: "Quoted", formula: '[Units] + LEN("[Units]")' };
    const renamed = upsertMeasure(
      upsertMeasure(using, quoted),
      { ...units, name: "Items" },
      "Units",
    );
    expect(renamed.measures[1]?.formula).toBe('[Items] + LEN("[Units]")');
  });

  it("removes a measure and the slot items that used it", () => {
    const removed = removeMeasure(using, "Units");
    expect(removed.measures).toEqual([]);
    expect(removed.visuals[0]?.slots.value).toEqual([]);
  });
});
