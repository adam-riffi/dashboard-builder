import { timeGrain } from "@adam-riffi/dash-core";
import { z } from "zod";
import { fieldsOf, measuresOf, type VisualDefinition } from "./plugin.ts";

/** One big number. */
export const kpi: VisualDefinition<Record<string, never>> = {
  type: "kpi",
  label: "KPI",
  icon: "kpi",
  slots: [{ name: "value", label: "Value", accepts: "measure", min: 1, max: 1 }],
  options: z.object({}).strict(),
  toQuery: (slots) => ({ dimensions: [], measures: measuresOf(slots.value), filters: [] }),
};

const barOptions = z
  .object({
    /** By the first measure, or by category name. */
    sort: z.enum(["desc", "asc", "category"]).default("desc"),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Categories compared by one or more measures, top categories first. */
export const bar: VisualDefinition<z.infer<typeof barOptions>> = {
  type: "bar",
  label: "Bar",
  icon: "bar",
  slots: [
    { name: "category", label: "Category", accepts: "dimension", min: 1, max: 1 },
    { name: "value", label: "Value", accepts: "measure", min: 1, max: 5 },
  ],
  options: barOptions,
  toQuery: (slots, options) => ({
    dimensions: fieldsOf(slots.category),
    measures: measuresOf(slots.value),
    filters: [],
    sort: [
      options.sort === "category"
        ? { by: "dimension", index: 0, dir: "asc" }
        : { by: "measure", index: 0, dir: options.sort },
    ],
    limit: options.limit,
  }),
};

const lineOptions = z.object({ grain: timeGrain.default("day") }).strict();

/** Measures over time, at the axis field's grain or the visual's. */
export const line: VisualDefinition<z.infer<typeof lineOptions>> = {
  type: "line",
  label: "Line",
  icon: "line",
  slots: [
    { name: "axis", label: "Axis", accepts: "time", min: 1, max: 1 },
    { name: "value", label: "Value", accepts: "measure", min: 1, max: 5 },
  ],
  options: lineOptions,
  toQuery: (slots, options) => ({
    dimensions: fieldsOf(slots.axis).map((f) => ({
      ...f,
      timeGrain: f.timeGrain ?? options.grain,
    })),
    measures: measuresOf(slots.value),
    filters: [],
    sort: [{ by: "dimension", index: 0, dir: "asc" }],
  }),
};

const tableOptions = z.object({ limit: z.number().int().min(1).max(1_000).default(100) }).strict();

/** Rows grouped by fields, with measure columns, largest first. */
export const table: VisualDefinition<z.infer<typeof tableOptions>> = {
  type: "table",
  label: "Table",
  icon: "table",
  slots: [
    { name: "rows", label: "Rows", accepts: "dimension", min: 0, max: 5 },
    { name: "values", label: "Values", accepts: "measure", min: 1, max: 10 },
  ],
  options: tableOptions,
  toQuery: (slots, options) => ({
    dimensions: fieldsOf(slots.rows),
    measures: measuresOf(slots.values),
    filters: [],
    sort: [{ by: "measure", index: 0, dir: "desc" }],
    limit: options.limit,
  }),
};
