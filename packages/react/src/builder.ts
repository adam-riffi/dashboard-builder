import {
  type ContractColumn,
  type DashboardSpec,
  type DashboardVisual,
  GRID_COLUMNS,
  type LayoutCell,
  MAX_QUERIES,
  type NamedMeasure,
  type SlotItem,
} from "@adam-riffi/dash-core";
import { getVisual, type SlotDefinition } from "@adam-riffi/dash-visuals";

type Filter = DashboardSpec["filters"][number];

/** Something the user drags into a slot: a contract column or a named measure. */
export type Draggable =
  | { kind: "column"; table: string; column: ContractColumn }
  | { kind: "measure"; name: string };

/**
 * Whether a slot takes a dragged field (DESIGN.md §7: the builder only offers fields a slot
 * accepts). Measure slots take named measures and measure columns; time slots take dates; other
 * slots take any non-measure column below the high-cardinality mark (DESIGN.md §6).
 */
export function accepts(slot: SlotDefinition, item: Draggable): boolean {
  if (slot.accepts === "measure") return item.kind === "measure" || item.column.role === "measure";
  if (item.kind !== "column") return false;
  if (slot.accepts === "time") return item.column.type === "date";
  return item.column.role !== "measure" && !item.column.highCardinality;
}

const itemOf = (d: Draggable): SlotItem =>
  d.kind === "measure" ? { name: d.name } : { field: `${d.table}.${d.column.name}` };

const same = (a: SlotItem, b: SlotItem) => JSON.stringify(a) === JSON.stringify(b);

const mapVisual = (
  spec: DashboardSpec,
  id: string,
  f: (v: DashboardVisual) => DashboardVisual,
) => ({
  ...spec,
  visuals: spec.visuals.map((v) => (v.id === id ? f(v) : v)),
});

/** The size a new visual of each built-in type starts with; others take a medium cell. */
const SIZES: Record<string, { w: number; h: number }> = {
  kpi: { w: 4, h: 2 },
  bar: { w: 6, h: 5 },
  line: { w: 6, h: 5 },
  table: { w: 12, h: 5 },
};

/** Adds an empty visual below the others; at the visual cap, nothing changes and `id` is unset. */
export function addVisual(
  spec: DashboardSpec,
  type: string,
): { spec: DashboardSpec; id: string | undefined } {
  if (spec.visuals.length >= MAX_QUERIES) return { spec, id: undefined };
  const taken = new Set(spec.visuals.map((v) => v.id));
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  const id = `${type}-${n}`;
  const y = Math.max(0, ...spec.layout.map((c) => c.y + c.h));
  const { w, h } = SIZES[type] ?? { w: 6, h: 4 };
  return {
    id,
    spec: {
      ...spec,
      layout: [...spec.layout, { i: id, x: 0, y, w, h }],
      visuals: [...spec.visuals, { id, type, slots: {}, options: {} }],
    },
  };
}

export const removeVisual = (spec: DashboardSpec, id: string): DashboardSpec => ({
  ...spec,
  layout: spec.layout.filter((c) => c.i !== id),
  visuals: spec.visuals.filter((v) => v.id !== id),
});

/** A visual's own title; blank clears it, so the title is derived again. */
export const setVisualTitle = (spec: DashboardSpec, id: string, title: string) =>
  mapVisual(spec, id, ({ title: _, ...v }) => (title.trim() ? { ...v, title: title.trim() } : v));

export const setVisualOptions = (
  spec: DashboardSpec,
  id: string,
  options: Record<string, unknown>,
) => mapVisual(spec, id, (v) => ({ ...v, options }));

/** The grid's layout for the dashboard's visuals, each cell kept inside the 12 columns. */
export function setLayout(spec: DashboardSpec, cells: LayoutCell[]): DashboardSpec {
  const ids = new Set(spec.visuals.map((v) => v.id));
  return {
    ...spec,
    layout: cells
      .filter((c) => ids.has(c.i))
      .map((c) => {
        const w = Math.min(Math.max(1, c.w), GRID_COLUMNS);
        return {
          i: c.i,
          x: Math.min(Math.max(0, c.x), GRID_COLUMNS - w),
          y: Math.max(0, c.y),
          w,
          h: Math.max(1, c.h),
        };
      }),
  };
}

/**
 * Drops a field into a slot. A refused field or a duplicate changes nothing; a single-item slot
 * takes the new field in place of the old one; other slots stop at their maximum.
 */
export function dropItem(
  spec: DashboardSpec,
  visualId: string,
  slotName: string,
  d: Draggable,
): DashboardSpec {
  const visual = spec.visuals.find((v) => v.id === visualId);
  const slot = visual && getVisual(visual.type)?.slots.find((s) => s.name === slotName);
  if (!visual || !slot || !accepts(slot, d)) return spec;
  const item = itemOf(d);
  const items = visual.slots[slotName] ?? [];
  if (items.some((i) => same(i, item))) return spec;
  const next = slot.max === 1 ? [item] : items.length < slot.max ? [...items, item] : items;
  if (next === items) return spec;
  return mapVisual(spec, visualId, (v) => ({ ...v, slots: { ...v.slots, [slotName]: next } }));
}

export const removeItem = (
  spec: DashboardSpec,
  visualId: string,
  slotName: string,
  index: number,
) =>
  mapVisual(spec, visualId, (v) => ({
    ...v,
    slots: { ...v.slots, [slotName]: (v.slots[slotName] ?? []).filter((_, i) => i !== index) },
  }));

export const addFilter = (spec: DashboardSpec, filter: Filter): DashboardSpec => ({
  ...spec,
  filters: [...spec.filters, filter],
});

export const setFilter = (spec: DashboardSpec, index: number, filter: Filter): DashboardSpec => ({
  ...spec,
  filters: spec.filters.map((f, i) => (i === index ? filter : f)),
});

export const removeFilter = (spec: DashboardSpec, index: number): DashboardSpec => ({
  ...spec,
  filters: spec.filters.filter((_, i) => i !== index),
});

/** Slot items, across every visual, with references to one measure rewritten or dropped. */
function mapMeasureRefs(spec: DashboardSpec, name: string, to: string | undefined) {
  return spec.visuals.map((v) => ({
    ...v,
    slots: Object.fromEntries(
      Object.entries(v.slots).map(([slot, items]) => [
        slot,
        items.flatMap((i) => ("name" in i && i.name === name ? (to ? [{ name: to }] : []) : [i])),
      ]),
    ),
  }));
}

/**
 * Adds or changes a dashboard measure. Renaming (`previous`) rewrites the slots and the other
 * measures' formulas that refer to it; names never hold brackets, so `[Name]` is a whole token.
 */
export function upsertMeasure(
  spec: DashboardSpec,
  measure: NamedMeasure,
  previous = measure.name,
): DashboardSpec {
  const renamed = previous !== measure.name;
  const measures = spec.measures.some((m) => m.name === previous)
    ? spec.measures.map((m) => (m.name === previous ? measure : m))
    : [...spec.measures, measure];
  if (!renamed) return { ...spec, measures };
  return {
    ...spec,
    measures: measures.map((m) => ({
      ...m,
      formula: m.formula.replaceAll(`[${previous}]`, `[${measure.name}]`),
    })),
    visuals: mapMeasureRefs(spec, previous, measure.name),
  };
}

/** Removes a dashboard measure and the slot items that used it. */
export const removeMeasure = (spec: DashboardSpec, name: string): DashboardSpec => ({
  ...spec,
  measures: spec.measures.filter((m) => m.name !== name),
  visuals: mapMeasureRefs(spec, name, undefined),
});
