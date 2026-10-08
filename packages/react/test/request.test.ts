import { type DashboardSpec, dashboardSpec, type QueryAnswer } from "@adam-riffi/dash-core";
import { kpi as kpiDefinition, registerVisual } from "@adam-riffi/dash-visuals";
import { describe, expect, it } from "vitest";
import { answersByVisual, dashboardRequest } from "../src/index.ts";

const category = { field: "dash_demo.products.category" };
const revenue = { name: "Revenue" };
const paid = { field: "dash_demo.orders.status", op: "in" as const, values: ["paid"] };

const spec = (visuals: DashboardSpec["visuals"], extra: Partial<DashboardSpec> = {}) =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "a".repeat(64),
    title: "Overview",
    layout: visuals.map((v, k) => ({ i: v.id, x: 0, y: k, w: 12, h: 2 })),
    visuals,
    ...extra,
  });

const kpi = { id: "kpi", type: "kpi", slots: { value: [revenue] }, options: {} };
const bar = {
  id: "bar",
  type: "bar",
  slots: { category: [category], value: [revenue] },
  options: {},
};

describe("dashboardRequest", () => {
  it("asks for every visual in one request, with the dashboard's measures and filters", () => {
    const units = { name: "Units", formula: "SUM(order_items.quantity)" };
    const plan = dashboardRequest(spec([kpi, bar], { measures: [units], filters: [paid] }));
    expect(plan.request).toEqual({
      measures: [units],
      queries: [
        { dimensions: [], measures: [revenue], filters: [paid] },
        {
          dimensions: [category],
          measures: [revenue],
          filters: [paid],
          sort: [{ by: "measure", index: 0, dir: "desc" }],
          limit: 25,
        },
      ],
    });
    expect(plan.visuals).toEqual([
      { id: "kpi", query: 0 },
      { id: "bar", query: 1 },
    ]);
  });

  it("keeps visuals that cannot query out of the request, with their reasons", () => {
    const broken = { id: "pie", type: "pie", slots: {}, options: {} };
    const empty = { id: "empty", type: "kpi", slots: {}, options: {} };
    const plan = dashboardRequest(spec([broken, kpi, empty]));
    expect(plan.request.queries).toHaveLength(1);
    expect(plan.visuals).toEqual([
      { id: "pie", errors: ["unknown visual type pie"] },
      { id: "kpi", query: 0 },
      { id: "empty", errors: ["Value: needs 1 measure"] },
    ]);
  });

  it("sends no request when no visual can query", () => {
    expect(dashboardRequest(spec([])).request.queries).toEqual([]);
  });
});

describe("dashboard filters on custom visuals", () => {
  it("reports a visual whose filters and the dashboard's together exceed the cap", () => {
    const filtered = {
      ...kpiDefinition,
      type: "filtered",
      toQuery: () => ({ dimensions: [], measures: [revenue], filters: [paid] }),
      render: () => null,
    };
    registerVisual(filtered);
    const twenty = Array.from({ length: 20 }, () => paid);
    const plan = dashboardRequest(
      spec([{ id: "f", type: "filtered", slots: { value: [revenue] }, options: {} }], {
        filters: twenty,
      }),
    );
    expect(plan.request.queries).toEqual([]);
    expect(plan.visuals[0]).toMatchObject({
      id: "f",
      errors: [expect.stringContaining("filters")],
    });
  });
});

describe("answersByVisual", () => {
  it("gives each visual its own answer, or its reasons for having none", () => {
    const broken = { id: "pie", type: "pie", slots: {}, options: {} };
    const plan = dashboardRequest(spec([broken, kpi, bar]));
    const result: QueryAnswer = {
      columns: [],
      data: [],
      meta: { cache: "miss", ms: 3, truncated: false },
    };
    const answers: QueryAnswer[] = [result, { errors: ["Query failed"] }];
    expect(answersByVisual(plan, answers)).toEqual(
      new Map<string, QueryAnswer>([
        ["pie", { errors: ["unknown visual type pie"] }],
        ["kpi", result],
        ["bar", { errors: ["Query failed"] }],
      ]),
    );
  });

  it("reports a missing answer instead of rendering nothing", () => {
    const plan = dashboardRequest(spec([kpi]));
    expect(answersByVisual(plan, []).get("kpi")).toEqual({ errors: ["No answer for this visual"] });
  });
});
