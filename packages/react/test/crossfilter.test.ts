import { type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dashboardRequest, filtersOf, type Selection } from "../src/index.ts";

describe("filtersOf (DESIGN.md §6: a selection becomes a filter clause on its field)", () => {
  it("turns a selected value into an equality on its field", () => {
    expect(
      filtersOf({ visualId: "bar", field: "dash_demo.products.category", value: "Garden" }),
    ).toEqual([{ field: "dash_demo.products.category", op: "in", values: ["Garden"] }]);
  });

  it.each([
    ["day", "2026-09-12T00:00:00.000Z", "2026-09-12", "2026-09-13"],
    ["day", "2026-12-31", "2026-12-31", "2027-01-01"],
    ["week", "2026-09-07T00:00:00.000Z", "2026-09-07", "2026-09-14"],
    ["month", "2026-12-01T00:00:00.000Z", "2026-12-01", "2027-01-01"],
    ["month", "2028-02-01", "2028-02-01", "2028-03-01"],
    ["quarter", "2026-10-01T00:00:00.000Z", "2026-10-01", "2027-01-01"],
    ["year", "2026-01-01T00:00:00.000Z", "2026-01-01", "2027-01-01"],
  ] as const)("turns a %s bucket starting %s into [%s, %s)", (grain, bucket, from, to) => {
    expect(
      filtersOf({ visualId: "line", field: "dash_demo.orders.ordered_at", bucket, grain }),
    ).toEqual([
      { field: "dash_demo.orders.ordered_at", op: "gte", values: [from] },
      { field: "dash_demo.orders.ordered_at", op: "lt", values: [to] },
    ]);
  });
});

const kpi = (id: string) => ({
  id,
  type: "kpi",
  slots: { value: [{ name: "Revenue" }] },
  options: {},
});
const spec = (ids: string[], filters: DashboardSpec["filters"] = []): DashboardSpec =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Cross-filtered",
    filters,
    layout: ids.map((i, k) => ({ i, x: 0, y: k, w: 12, h: 2 })),
    visuals: ids.map(kpi),
  });

/** The filters a visual's query carries, from the plan. */
const filtersFor = (plan: ReturnType<typeof dashboardRequest>, id: string) => {
  const visual = plan.visuals.find((v) => v.id === id);
  if (!visual || !("query" in visual)) throw new Error(`no query for ${id}`);
  return plan.request.queries[visual.query]?.filters ?? [];
};

describe("the coordinator in dashboardRequest", () => {
  const paid = { field: "dash_demo.orders.status", op: "in" as const, values: ["paid"] };

  it("filters every other visual by a selection, and only highlights the source", () => {
    const garden: Selection = {
      visualId: "a",
      field: "dash_demo.products.category",
      value: "Garden",
    };
    const plan = dashboardRequest(spec(["a", "b", "c"], [paid]), [garden]);
    expect(filtersFor(plan, "a")).toEqual([paid]);
    expect(filtersFor(plan, "b")).toEqual([paid, ...filtersOf(garden)]);
    expect(filtersFor(plan, "c")).toEqual([paid, ...filtersOf(garden)]);
  });

  it("never filters a visual by its own selection, always by everyone else's", () => {
    const ids = ["a", "b", "c", "d"];
    const selection = fc.record({
      visualId: fc.constantFrom(...ids),
      field: fc.constantFrom("dash_demo.products.category", "dash_demo.orders.status"),
      value: fc.string({ minLength: 1, maxLength: 8 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(selection, { selector: (s) => s.visualId, maxLength: 4 }),
        (selections) => {
          const plan = dashboardRequest(spec(ids), selections);
          for (const id of ids) {
            const others = selections.filter((s) => s.visualId !== id).flatMap(filtersOf);
            expect(filtersFor(plan, id)).toEqual(others);
          }
        },
      ),
    );
  });

  it("asks what it asked before when nothing is selected", () => {
    expect(dashboardRequest(spec(["a", "b"]), [])).toEqual(dashboardRequest(spec(["a", "b"])));
  });
});
