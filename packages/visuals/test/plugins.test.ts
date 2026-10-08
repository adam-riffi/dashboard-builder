import type { SlotItem } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import {
  bar,
  getVisual,
  kpi,
  line,
  queryOf,
  registerVisual,
  table,
  visuals,
} from "../src/index.ts";

const category = { field: "dash_demo.products.category" };
const day = { field: "dash_demo.orders.ordered_at" };
const revenue = { name: "Revenue" };
const units = { field: "dash_demo.order_items.quantity" };
const visual = (slots: Record<string, SlotItem[]>, options: Record<string, unknown> = {}) => ({
  slots,
  options,
});

describe("built-in visuals", () => {
  it("asks a KPI for its single measure", () => {
    expect(queryOf(kpi, visual({ value: [revenue] }))).toEqual({
      ok: true,
      query: { dimensions: [], measures: [revenue], filters: [] },
    });
  });

  it("asks a bar chart for the top categories by its first measure", () => {
    expect(queryOf(bar, visual({ category: [category], value: [revenue, units] }))).toEqual({
      ok: true,
      query: {
        dimensions: [category],
        measures: [revenue, units],
        filters: [],
        sort: [{ by: "measure", index: 0, dir: "desc" }],
        limit: 25,
      },
    });
    const byName = queryOf(
      bar,
      visual({ category: [category], value: [revenue] }, { sort: "category", limit: 5 }),
    );
    expect(byName).toMatchObject({
      ok: true,
      query: { sort: [{ by: "dimension", index: 0, dir: "asc" }], limit: 5 },
    });
  });

  it("asks a line chart for its time axis at the chosen grain, in time order", () => {
    expect(queryOf(line, visual({ axis: [day], value: [revenue] }, { grain: "month" }))).toEqual({
      ok: true,
      query: {
        dimensions: [{ ...day, timeGrain: "month" }],
        measures: [revenue],
        filters: [],
        sort: [{ by: "dimension", index: 0, dir: "asc" }],
      },
    });
    // A grain set on the field itself wins; the default grain is a day.
    const week = queryOf(line, visual({ axis: [{ ...day, timeGrain: "week" }], value: [revenue] }));
    expect(week).toMatchObject({ ok: true, query: { dimensions: [{ timeGrain: "week" }] } });
    const daily = queryOf(line, visual({ axis: [day], value: [revenue] }));
    expect(daily).toMatchObject({ ok: true, query: { dimensions: [{ timeGrain: "day" }] } });
  });

  it("asks a table for its rows and values, largest first", () => {
    expect(queryOf(table, visual({ rows: [category], values: [revenue, units] }))).toEqual({
      ok: true,
      query: {
        dimensions: [category],
        measures: [revenue, units],
        filters: [],
        sort: [{ by: "measure", index: 0, dir: "desc" }],
        limit: 100,
      },
    });
    expect(queryOf(table, visual({ values: [revenue] }))).toMatchObject({
      ok: true,
      query: { dimensions: [] },
    });
  });

  it.each([
    ["a KPI without a value", kpi, visual({}), ["Value: needs 1"]],
    ["a KPI with two values", kpi, visual({ value: [revenue, units] }), ["Value: holds at most 1"]],
    [
      "a measure in a category slot",
      bar,
      visual({ category: [revenue], value: [units] }),
      ["Category: holds fields, not measures"],
    ],
    [
      "an aggregated column in a category slot",
      bar,
      visual({ category: [{ ...units, aggregation: "SUM" }], value: [units] }),
      ["Category: holds fields, not measures"],
    ],
    [
      "a time grain on a measure",
      kpi,
      visual({ value: [{ ...day, timeGrain: "day" }] }),
      ["Value: a measure has no time grain"],
    ],
    [
      "a measure on a time axis",
      line,
      visual({ axis: [revenue], value: [units] }),
      ["Axis: holds fields, not measures"],
    ],
    [
      "a slot the visual does not have",
      kpi,
      visual({ value: [revenue], colour: [category] }),
      ["unknown slot colour"],
    ],
    [
      "options out of range",
      bar,
      visual({ category: [category], value: [revenue] }, { limit: 0 }),
      ["options.limit: Too small: expected number to be >=1"],
    ],
    [
      "an unknown option",
      kpi,
      visual({ value: [revenue] }, { colour: "red" }),
      ['options: Unrecognized key: "colour"'],
    ],
  ])("rejects %s", (_, definition, v, errors) => {
    const result = queryOf(definition, v);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(errors.length);
      result.errors.forEach((e, i) => expect(e).toContain(errors[i]));
    }
  });
});

describe("registry", () => {
  it("knows the four built-ins by type", () => {
    expect(visuals().map((v) => v.type)).toEqual(["kpi", "bar", "line", "table"]);
    expect(getVisual("line")).toBe(line);
    expect(getVisual("pie")).toBeUndefined();
  });

  it("registers a new visual, and refuses a type that is taken", () => {
    const gauge = { ...kpi, type: "gauge", label: "Gauge" };
    registerVisual(gauge);
    expect(getVisual("gauge")).toBe(gauge);
    expect(() => registerVisual({ ...kpi })).toThrow("a visual of type kpi is already registered");
  });
});
