import type {
  DashboardVisual,
  MeasureFormat,
  QueryAnswer,
  QueryResult,
} from "@adam-riffi/dash-core";
import { getVisual, itemLabel } from "@adam-riffi/dash-visuals";

export type VisualState =
  | { kind: "loading" }
  | { kind: "error"; messages: string[] }
  | { kind: "empty" }
  | { kind: "ready"; result: QueryResult };

/**
 * What a visual shows (DESIGN.md §9, M4). An answer stays on screen while it refreshes and when
 * a refresh fails; without one, the request's failure or a loading state shows.
 */
export function visualState(
  answer: QueryAnswer | undefined,
  pending: boolean,
  failed: boolean,
): VisualState {
  if (answer) {
    if ("errors" in answer) return { kind: "error", messages: answer.errors };
    if ((answer.data[0]?.length ?? 0) === 0) return { kind: "empty" };
    return { kind: "ready", result: answer };
  }
  if (failed && !pending) {
    return { kind: "error", messages: ["This dashboard could not load. Try again shortly."] };
  }
  return { kind: "loading" };
}

/**
 * The visual's own title, or its measures by its fields, read from the spec so that loading and
 * failed visuals are named too ("Revenue by Category", "Orders by day").
 */
export function titleOf(
  visual: Pick<DashboardVisual, "type" | "slots" | "options"> & { title?: string | undefined },
): string {
  if (visual.title) return visual.title;
  const plugin = getVisual(visual.type);
  if (!plugin) return `A ${visual.type} visual`;
  const options = plugin.options.safeParse(visual.options);
  const grain = options.success ? (options.data as { grain?: unknown }).grain : undefined;
  const measures: string[] = [];
  const fields: string[] = [];
  for (const slot of plugin.slots) {
    for (const item of visual.slots[slot.name] ?? []) {
      if (slot.accepts === "measure") measures.push(itemLabel(item));
      else if (slot.accepts === "time") {
        const own = "timeGrain" in item ? item.timeGrain : undefined;
        fields.push(own ?? (typeof grain === "string" ? grain : itemLabel(item)));
      } else fields.push(itemLabel(item));
    }
  }
  const named = measures.join(" and ") || `A ${plugin.label} visual`;
  return fields.length > 0 ? `${named} by ${fields.join(" and ")}` : named;
}

/** Display formats by measure name: the host's, overridden by the dashboard's measures (ADR 0007). */
export function formatsOf(
  host: { name: string; format?: MeasureFormat | undefined }[],
  dashboard: { name: string; format?: MeasureFormat | undefined }[],
): Map<string, MeasureFormat> {
  const formats = new Map<string, MeasureFormat>();
  for (const m of host) if (m.format) formats.set(m.name, m.format);
  for (const m of dashboard) {
    if (m.format) formats.set(m.name, m.format);
    else formats.delete(m.name);
  }
  return formats;
}
