import { z } from "zod";
import {
  fieldName,
  filter,
  MAX_NAMED_MEASURES,
  MAX_QUERIES,
  measure,
  namedMeasure,
  timeGrain,
} from "./query.ts";

/** Columns of the dashboard grid. */
export const GRID_COLUMNS = 12;

const id = z.string().min(1).max(64);

/** What a visual's slot holds: a field (dimension or time axis) or a measure. */
export const slotItem = z.union([
  z.object({ field: fieldName, timeGrain: timeGrain.optional() }).strict(),
  measure,
]);

const layoutCell = z
  .object({
    i: id,
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative().max(1_000),
    w: z.number().int().positive(),
    h: z.number().int().positive().max(100),
  })
  .strict()
  .refine((c) => c.x + c.w <= GRID_COLUMNS, `a cell must fit in ${GRID_COLUMNS} columns`);

const visual = z
  .object({
    id,
    /** A registered visual plugin, e.g. `kpi`, `bar`, `line`, `table`. */
    type: id,
    slots: z.record(id, z.array(slotItem).max(20)),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/**
 * A saved dashboard (DESIGN.md §7), version 1. Each visual becomes one query, so a dashboard
 * holds at most as many visuals as a request holds queries; every visual has one layout cell.
 */
export const dashboardSpec = z
  .object({
    specVersion: z.literal(1),
    /** The contract version the dashboard was built against. */
    contractVersion: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string().min(1).max(200),
    /** Used by interval refresh (M6). */
    refreshIntervalSec: z.number().int().min(5).max(86_400).default(60),
    measures: z
      .array(namedMeasure)
      .max(MAX_NAMED_MEASURES)
      .refine((list) => new Set(list.map((m) => m.name)).size === list.length, {
        message: "measure names must be unique",
      })
      .default([]),
    /** Applied to every visual. */
    filters: z.array(filter).max(20).default([]),
    layout: z.array(layoutCell).max(MAX_QUERIES),
    visuals: z.array(visual).max(MAX_QUERIES),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = spec.visuals.map((v) => v.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["visuals"], message: "visual ids must be unique" });
    }
    const cells = spec.layout.map((c) => c.i).sort();
    if (JSON.stringify(cells) !== JSON.stringify([...ids].sort())) {
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: "every visual needs exactly one layout cell, and every cell a visual",
      });
    }
  });

export type SlotItem = z.infer<typeof slotItem>;
export type DashboardSpec = z.infer<typeof dashboardSpec>;
export type DashboardVisual = DashboardSpec["visuals"][number];
export type LayoutCell = DashboardSpec["layout"][number];
