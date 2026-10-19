import {
  type Checking,
  type DashboardSpec,
  type DataContract,
  lex,
  type NamedMeasure,
  planJoins,
  type QueryRequest,
  type QuerySpec,
  querySpec,
  validateQuery,
} from "@adam-riffi/dash-core";
import { getVisual, queryOf } from "@adam-riffi/dash-visuals";
import { filtersOf, type Selection } from "./crossfilter.ts";

/** Where each visual's answer will be: its query's position, or why it has none. */
export type VisualPlan = { id: string; query: number } | { id: string; errors: string[] };

export interface DashboardPlan {
  request: QueryRequest;
  visuals: VisualPlan[];
}

/**
 * One `POST /query` for a whole dashboard (ADR 0008): every visual that can query becomes a
 * QuerySpec with the dashboard's filters added, and the dashboard's measures travel with it.
 * The cross-filter coordinator (DESIGN.md §6) adds every other visual's selection to each
 * visual's query, when the visual can reach its field; a visual is never filtered by its own
 * selection, which it only highlights.
 */
export function dashboardRequest(
  spec: DashboardSpec,
  selections: Selection[] = [],
  contract?: DataContract,
): DashboardPlan {
  const reachable = reachOf(spec, contract);
  const queries: QueryRequest["queries"] = [];
  const visuals = spec.visuals.map((visual): VisualPlan => {
    const definition = getVisual(visual.type);
    if (!definition) return { id: visual.id, errors: [`unknown visual type ${visual.type}`] };
    const planned = queryOf(definition, visual);
    if (!planned.ok) return { id: visual.id, errors: planned.errors };
    const own = { ...planned.query, filters: [...spec.filters, ...planned.query.filters] };
    const others = selections.filter((s) => s.visualId !== visual.id);
    // The dashboard's filters count against the query's own cap.
    const merged = querySpec.safeParse({
      ...planned.query,
      filters: [
        ...spec.filters,
        ...reachable(own, others).flatMap(filtersOf),
        ...planned.query.filters,
      ],
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

/**
 * The selections a query can take (ADR 0011): those it can still be planned with, by the
 * gateway's own rules. Without the contract, or for a query the gateway will refuse anyway, all
 * of them, so the gateway explains the problem as before.
 */
function reachOf(spec: DashboardSpec, contract: DataContract | undefined) {
  if (!contract) return (_query: QuerySpec, selections: Selection[]) => selections;
  // The dashboard's measures shadow the host's, as in the gateway.
  const named = new Map([...contract.measures, ...spec.measures].map((m) => [m.name, m.formula]));
  const memo = new Map<string, Checking>();
  const plans = (query: QuerySpec) => {
    const valid = validateQuery(query, contract, named, memo);
    return valid.ok && planJoins(valid.query, contract).ok;
  };
  return (query: QuerySpec, selections: Selection[]) =>
    selections.length === 0 || !plans(query)
      ? selections
      : selections.filter((s) => plans({ ...query, filters: [...query.filters, ...filtersOf(s)] }));
}

/** The dashboard measures a query reaches: the ones it names, and the ones their formulas name. */
export function measuresFor(query: QuerySpec, measures: NamedMeasure[]): NamedMeasure[] {
  const byName = new Map(measures.map((m) => [m.name, m]));
  const used = new Set<string>();
  function visit(formula: string) {
    const lexed = lex(formula);
    if (lexed.ok) for (const t of lexed.tokens) if (t.kind === "measure") use(t.value);
  }
  function use(name: string) {
    if (used.has(name)) return;
    used.add(name);
    const named = byName.get(name);
    if (named) visit(named.formula);
  }
  for (const m of query.measures) {
    if ("name" in m) use(m.name);
    else if ("formula" in m) visit(m.formula);
  }
  return measures.filter((m) => used.has(m.name));
}
