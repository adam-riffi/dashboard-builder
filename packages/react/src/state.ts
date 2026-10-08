import type { QueryAnswer, QueryResult } from "@adam-riffi/dash-core";
import { labelOf } from "@adam-riffi/dash-visuals";

export type VisualState =
  | { kind: "loading" }
  | { kind: "error"; messages: string[] }
  | { kind: "empty" }
  | { kind: "ready"; result: QueryResult };

/** What a visual shows: its answer, or why there is none yet (DESIGN.md §9, M4). */
export function visualState(
  answer: QueryAnswer | undefined,
  pending: boolean,
  failed: boolean,
): VisualState {
  if (failed)
    return { kind: "error", messages: ["This dashboard could not load. Try again shortly."] };
  if (!answer || pending) return { kind: "loading" };
  if ("errors" in answer) return { kind: "error", messages: answer.errors };
  if ((answer.data[0]?.length ?? 0) === 0) return { kind: "empty" };
  return { kind: "ready", result: answer };
}

/** The visual's own title, or its measures by its fields ("Revenue by Category"). */
export function titleOf(
  visual: { title?: string | undefined },
  result: QueryResult | undefined,
): string {
  if (visual.title) return visual.title;
  if (!result) return "";
  const measures = result.columns.filter((c) => c.kind === "measure").map(labelOf);
  const fields = result.columns.filter((c) => c.kind === "dimension").map(labelOf);
  return fields.length > 0
    ? `${measures.join(" and ")} by ${fields.join(" and ")}`
    : measures.join(" and ");
}
