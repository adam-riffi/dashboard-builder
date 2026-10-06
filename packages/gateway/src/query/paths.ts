import { children, type DataContract, type Relationship, type Typed } from "@adam-riffi/dash-core";
import { tablesOf, type ValidQuery } from "./validate.ts";

/** The base (fact) table and the joins to add, each from a table already in the query. */
export interface JoinPlan {
  base: string;
  joins: Relationship[];
}

export type JoinPlanning = { ok: true; plan: JoinPlan } | { ok: false; errors: string[] };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const via = (r: Relationship) => `${r.from.table}(${r.from.columns})`;

/** Breadth-first over many-to-one edges from `base`, counting shortest paths into each table. */
function reach(base: string, outgoing: Map<string, Relationship[]>) {
  const depth = new Map([[base, 0]]);
  const paths = new Map([[base, 1]]);
  const incoming = new Map<string, Relationship[]>();
  const queue = [base];
  for (const table of queue) {
    for (const r of outgoing.get(table) ?? []) {
      const d = (depth.get(table) ?? 0) + 1;
      const known = depth.get(r.to.table);
      if (known === undefined) {
        depth.set(r.to.table, d);
        paths.set(r.to.table, paths.get(table) ?? 0);
        incoming.set(r.to.table, [r]);
        queue.push(r.to.table);
      } else if (known === d) {
        paths.set(r.to.table, (paths.get(r.to.table) ?? 0) + (paths.get(table) ?? 0));
        incoming.get(r.to.table)?.push(r);
      }
    }
  }
  return { depth, paths, incoming };
}

/** Aggregates whose result changes when the same row is seen several times. */
const REPEAT_SENSITIVE = new Set(["SUM", "AVG", "COUNT"]);

/**
 * Join-path resolution (DESIGN.md §6, hand-written core). Each measure's fact table is the one of
 * its tables that reaches the others through many-to-one relationships (lookups, like Power BI's
 * RELATED); all measures of a query share it, and it becomes the base (ADR 0007). Every other
 * table must be reached from the base on the single shortest many-to-one path. Ambiguous paths,
 * fan-out (one-to-many), and SUM/AVG/COUNT over a looked-up table are rejected with the tables
 * named.
 */
export function planJoins(query: ValidQuery, contract: DataContract): JoinPlanning {
  const outgoing = new Map<string, Relationship[]>();
  const seen = new Set<string>();
  for (const r of contract.relationships) {
    if (r.from.table === r.to.table) continue; // a self reference never leads elsewhere
    // Identical foreign key constraints are one relationship, not two paths.
    const key = `${via(r)}->${r.to.table}(${r.to.columns})`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.set(r.from.table, [...(outgoing.get(r.from.table) ?? []), r]);
  }
  const reached = new Map<string, ReturnType<typeof reach>>();
  const from = (table: string) => {
    let r = reached.get(table);
    if (!r) {
      r = reach(table, outgoing);
      reached.set(table, r);
    }
    return r;
  };

  const errors: string[] = [];
  const facts = new Set<string>();
  query.measures.forEach((m, i) => {
    if (m.tables.length === 0) return; // only constants: it takes the query's fact table
    const candidates = m.tables.filter((t) => m.tables.every((o) => from(t).depth.has(o)));
    if (candidates.length === 1) facts.add(candidates[0] as string);
    else if (candidates.length === 0) {
      const all = m.tables.length === 2 ? "both" : "all";
      errors.push(
        `measures[${i}]: ${m.tables.join(" and ")} are not ${all} reached from one table through many-to-one relationships`,
      );
    } else {
      errors.push(
        `measures[${i}]: ${candidates.join(" and ")} reach each other; the fact table is ambiguous`,
      );
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  const factTables = [...facts].sort(compare);
  const [base] = factTables;
  if (factTables.length > 1) {
    return {
      ok: false,
      errors: [`measures come from ${factTables.join(" and ")}; a query has one fact table`],
    };
  }
  if (base === undefined) {
    return {
      ok: false,
      errors: ["a query needs a measure that reads a column, to know its fact table"],
    };
  }

  // A looked-up row is repeated once per fact row, which SUM, AVG and COUNT would count again.
  query.measures.forEach((m, i) => {
    const walk = (t: Typed): void => {
      if (t.kind === "call" && REPEAT_SENSITIVE.has(t.name)) {
        const tables = tablesOf(t);
        if (tables.length > 0 && !tables.includes(base)) {
          errors.push(
            `measures[${i}]: ${t.name} over ${tables.join(" and ")} would count each of its rows once per ${base} row; use COUNTDISTINCT, MIN or MAX, or a column of ${base}`,
          );
        }
      } else children(t).forEach(walk);
    };
    walk(m.expr);
  });
  if (errors.length > 0) return { ok: false, errors };

  const needed = [
    ...new Set([
      ...[...query.dimensions, ...query.filters].map((f) => f.table),
      ...query.measures.flatMap((m) => m.tables),
    ]),
  ]
    .filter((t) => t !== base)
    .sort(compare);
  const { depth, paths, incoming } = from(base);

  const unreachable = needed.flatMap((table) => {
    if (!depth.has(table)) {
      return connected(base, table, contract)
        ? [
            `${table}: reachable from ${base} only through one-to-many relationships (fan-out would repeat rows)`,
          ]
        : [`${table}: not related to ${base}`];
    }
    const count = paths.get(table) ?? 0;
    if (count === 1) return [];
    const edges = (incoming.get(table) ?? []).map((r) => `via ${via(r)}`).sort(compare);
    return [
      `${table}: ${count === 2 ? "two" : count} equally short paths from ${base} (${edges.join(", ")}); the join is ambiguous`,
    ];
  });
  if (unreachable.length > 0) return { ok: false, errors: unreachable };

  // Walk each needed table back to the base; a table's single shortest edge is shared by all.
  const joins = new Map<string, Relationship>();
  for (const table of needed) {
    for (let t = table; t !== base; ) {
      const [edge] = incoming.get(t) ?? [];
      if (!edge) break;
      joins.set(t, edge);
      t = edge.from.table;
    }
  }
  const ordered = [...joins.values()].sort(
    (a, b) =>
      (depth.get(a.to.table) ?? 0) - (depth.get(b.to.table) ?? 0) || compare(via(a), via(b)),
  );
  return { ok: true, plan: { base, joins: ordered } };
}

/** Whether two tables are related at all, ignoring the direction of relationships. */
function connected(from: string, to: string, contract: DataContract): boolean {
  const seen = new Set([from]);
  const queue = [from];
  for (const table of queue) {
    for (const r of contract.relationships) {
      const next =
        r.from.table === table ? r.to.table : r.to.table === table ? r.from.table : undefined;
      if (next !== undefined && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.has(to);
}
