import {
  type DashboardSpec,
  type QueryAnswer,
  type QueryRequest,
  querySpec,
} from "@adam-riffi/dash-core";
import { getVisual, queryOf } from "@adam-riffi/dash-visuals";

/** Where each visual's answer will be: its query's position, or why it has none. */
export type VisualPlan = { id: string; query: number } | { id: string; errors: string[] };

export interface DashboardPlan {
  request: QueryRequest;
  visuals: VisualPlan[];
}

/**
 * One `POST /query` for a whole dashboard (ADR 0008): every visual that can query becomes a
 * QuerySpec with the dashboard's filters added, and the dashboard's measures travel with it.
 */
export function dashboardRequest(spec: DashboardSpec): DashboardPlan {
  const queries: QueryRequest["queries"] = [];
  const visuals = spec.visuals.map((visual): VisualPlan => {
    const definition = getVisual(visual.type);
    if (!definition) return { id: visual.id, errors: [`unknown visual type ${visual.type}`] };
    const planned = queryOf(definition, visual);
    if (!planned.ok) return { id: visual.id, errors: planned.errors };
    // The dashboard's filters count against the query's own cap.
    const merged = querySpec.safeParse({
      ...planned.query,
      filters: [...spec.filters, ...planned.query.filters],
    });
    if (!merged.success) {
      const errors = merged.error.issues.map((i) => `query.${i.path.join(".")}: ${i.message}`);
      return { id: visual.id, errors };
    }
    queries.push(merged.data);
    return { id: visual.id, query: queries.length - 1 };
  });
  return { request: { measures: spec.measures, queries }, visuals };
}

/** Each visual's answer by id: its query's result or errors, or the reasons it never queried. */
export function answersByVisual(plan: DashboardPlan, answers: QueryAnswer[]) {
  return new Map(
    plan.visuals.map((v): [string, QueryAnswer] => [
      v.id,
      "errors" in v
        ? { errors: v.errors }
        : (answers[v.query] ?? { errors: ["No answer for this visual"] }),
    ]),
  );
}
