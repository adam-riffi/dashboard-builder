import type { Measure, QueryResult, QuerySpec, SlotItem } from "@adam-riffi/dash-core";
import type { ComponentType } from "react";

/** What a slot accepts (DESIGN.md §7): a field to group by, a time axis, or measures. */
export type SlotKind = "dimension" | "time" | "measure";

export interface SlotDefinition {
  name: string;
  label: string;
  accepts: SlotKind;
  min: number;
  max: number;
}

export type Slots = Record<string, SlotItem[]>;
export type FieldItem = { field: string; timeGrain?: QuerySpec["dimensions"][number]["timeGrain"] };

/** What a visual needs from its options schema (a zod schema fits): parse and fill defaults. */
export interface OptionsSchema<Options> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: Options }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** The query half of a visual: its slots, its options and the query they make. */
export interface VisualDefinition<Options = Record<string, unknown>> {
  type: string;
  label: string;
  icon: string;
  slots: SlotDefinition[];
  /** Parses the visual's options and fills their defaults. */
  options: OptionsSchema<Options>;
  /** Called with slots that passed `checkSlots` and parsed options. */
  toQuery(slots: Slots, options: Options): QuerySpec;
}

/** What a visual's renderer receives. */
export interface VisualProps<Options = Record<string, unknown>> {
  result: QueryResult;
  options: Options;
}

/** A visual plugin (DESIGN.md §7, ADR 0008): the query half plus a React renderer. */
export interface VisualPlugin<Options = Record<string, unknown>> extends VisualDefinition<Options> {
  render: ComponentType<VisualProps<Options>>;
}

/** A field to group by: a `{ field }` with no aggregation. Anything else is a measure. */
export const isField = (item: SlotItem): item is FieldItem =>
  "field" in item && !("aggregation" in item);

/** Every problem with a visual's slots: unknown slots, counts and the kind of each item. */
export function checkSlots(definition: VisualDefinition<unknown>, slots: Slots): string[] {
  const known = new Set(definition.slots.map((s) => s.name));
  const errors = Object.keys(slots)
    .filter((name) => !known.has(name))
    .map((name) => `unknown slot ${name}`);
  for (const slot of definition.slots) {
    const items = slots[slot.name] ?? [];
    const what = slot.accepts === "measure" ? "measure" : "field";
    if (items.length < slot.min) {
      errors.push(`${slot.label}: needs ${slot.min} ${what}${slot.min === 1 ? "" : "s"}`);
    }
    if (items.length > slot.max) {
      errors.push(`${slot.label}: holds at most ${slot.max} ${what}${slot.max === 1 ? "" : "s"}`);
    }
    if (slot.accepts !== "measure" && !items.every(isField)) {
      errors.push(`${slot.label}: holds fields, not measures`);
    }
    if (slot.accepts === "measure" && items.some((i) => "timeGrain" in i)) {
      errors.push(`${slot.label}: a measure has no time grain`);
    }
  }
  return errors;
}

export type VisualQuery = { ok: true; query: QuerySpec } | { ok: false; errors: string[] };

/** A visual's query, or every reason it has none: slot problems and invalid options. */
export function queryOf(
  definition: VisualDefinition<unknown>,
  visual: { slots: Slots; options: Record<string, unknown> },
): VisualQuery {
  const errors = checkSlots(definition, visual.slots);
  const options = definition.options.safeParse(visual.options);
  if (!options.success) {
    for (const issue of options.error.issues) {
      errors.push(`${["options", ...issue.path.map(String)].join(".")}: ${issue.message}`);
    }
  }
  if (errors.length > 0 || !options.success) return { ok: false, errors };
  return { ok: true, query: definition.toQuery(visual.slots, options.data) };
}

/** Measures of a slot that passed `checkSlots`. */
export const measuresOf = (items: SlotItem[] = []) => items as Measure[];
/** Fields of a slot that passed `checkSlots`. */
export const fieldsOf = (items: SlotItem[] = []) => items as FieldItem[];
