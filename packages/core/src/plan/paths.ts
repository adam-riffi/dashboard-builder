import type { DataContract, Relationship } from "../contract.ts";
import { AGGREGATES, calls, children, type Typed } from "../formula/check.ts";
import { tablesOf, type ValidQuery } from "./validate.ts";

/** A fact table and the joins to add, each from a table already in the query. */
export interface FactPlan {
  base: string;
  joins: Relationship[];
}

/**
 * The base (fact) table and its joins. When the measures come from several fact tables,
 * `facts` plans each one on its own, and `base` and `joins` are its first (ADR 0014).
 */
export interface JoinPlan extends FactPlan {
  facts?: FactPlan[];
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
/** What a query over several fact tables can't do yet (ADR 0014). */
const SINGLE_FACT_ONLY = new Set(["PREVIOUSPERIOD", "RUNNINGSUM", "ALL"]);

/**
 * Join-path resolution (DESIGN.md §6, hand-written core). The base (fact) table is the one table
 * read by the measures from which all the others they read are reached through many-to-one
 * relationships; other tables are lookups, like Power BI's RELATED (ADR 0007). Every other table
 * must be reached from the base on the single shortest many-to-one path. Ambiguous paths and
 * fan-out (one-to-many) are rejected with the tables named. Since M11 each aggregate is answered
 * on its own table where it can be, and the plan may hold several fact tables (ADR 0014).
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

  /** The dimensions' and filters' tables, and `read`, other than `base`. */
  const neededFrom = (base: string, read: string[]) =>
    [...new Set([...[...query.dimensions, ...query.filters].map((f) => f.table), ...read])]
      .filter((t) => t !== base)
      .sort(compare);

  /** The joins from `base` to every needed table, or why one can't be reached. */
  const joinsFrom = (base: string, needed: string[]): FactPlan | { errors: string[] } => {
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
    if (unreachable.length > 0) return { errors: unreachable };

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
    return { base, joins: ordered };
  };

  const measureTables = [...new Set(query.measures.flatMap((m) => m.tables))].sort(compare);
  const bases = measureTables.filter((t) => measureTables.every((o) => from(t).depth.has(o)));
  /** v1's fact table: the one table the measures read that reaches all the others. */
  const base = bases.length === 1 ? bases[0] : undefined;
  const needsColumn = ["a query needs a measure that reads a column, to know its fact table"];

  // The time functions and ALL compile in two stages over one fact table: v1's plan (ADR 0013).
  if (query.measures.some((m) => calls(m.expr, SINGLE_FACT_ONLY))) {
    const repeats = query.measures.some((m) => {
      const walk = (t: Typed): boolean =>
        t.kind === "call" && REPEAT_SENSITIVE.has(t.name)
          ? tablesOf(t).length > 0 && base !== undefined && !tablesOf(t).includes(base)
          : children(t).some(walk);
      return walk(m.expr);
    });
    if ((measureTables.length > 0 && base === undefined) || repeats) {
      return {
        ok: false,
        errors: [
          "a query over several fact tables can't use PREVIOUSPERIOD, RUNNINGSUM or ALL yet",
        ],
      };
    }
    if (base === undefined) return { ok: false, errors: needsColumn };
    const planned = joinsFrom(base, neededFrom(base, measureTables));
    return "errors" in planned
      ? { ok: false, errors: planned.errors }
      : { ok: true, plan: planned };
  }

  /**
   * Each aggregate is answered on its own table, the one its argument reads from which its other
   * tables are reached, as it would be queried alone, when that table reaches every dimension,
   * filter and `CALCULATE` condition. Otherwise v1's fact table answers it over its rows, which
   * only COUNTDISTINCT, MIN and MAX allow over a looked-up table (ADR 0007). One plan per fact
   * table; a single one is v1's plan (ADR 0014).
   */
  const errors: string[] = [];
  const read = new Map<string, Set<string>>();
  const add = (fact: string, tables: string[]) =>
    read.set(fact, new Set([...(read.get(fact) ?? []), ...tables]));
  let columnless: string | undefined;
  query.measures.forEach((m, i) => {
    const walk = (t: Typed, around: string[]): void => {
      if (t.kind === "call" && t.name === "CALCULATE") {
        const [inner, ...conditions] = t.args as [Typed, ...Typed[]];
        walk(inner, [...around, ...conditions.flatMap(tablesOf)]);
        return;
      }
      if (!(t.kind === "call" && AGGREGATES.has(t.name))) {
        for (const c of children(t)) walk(c, around);
        return;
      }
      const tables = tablesOf(t);
      const needed = [...tables, ...around];
      if (tables.length === 0) {
        // COUNT(1) counts the fact table's rows: the query must have one.
        columnless ??= `measures[${i}]: ${t.name} reads no column; over several fact tables each aggregate needs one`;
        if (base !== undefined) add(base, needed);
        return;
      }
      const own = tables.find((f) => tables.every((o) => from(f).depth.has(o)));
      if (own === undefined) {
        errors.push(
          `measures[${i}]: ${t.name} reads ${tables.join(" and ")}, which don't reach each other`,
        );
        return;
      }
      const alone = joinsFrom(own, neededFrom(own, needed));
      if (!("errors" in alone)) add(own, needed);
      else if (base !== undefined && (tables.includes(base) || !REPEAT_SENSITIVE.has(t.name))) {
        add(base, needed);
      } else errors.push(...alone.errors);
    };
    walk(m.expr, []);
  });
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  if (read.size === 0) return { ok: false, errors: needsColumn };
  if (read.size > 1 && columnless !== undefined) return { ok: false, errors: [columnless] };

  const facts: FactPlan[] = [];
  for (const fact of [...read.keys()].sort(compare)) {
    const planned = joinsFrom(fact, neededFrom(fact, [...(read.get(fact) ?? [])]));
    if ("errors" in planned) errors.push(...planned.errors);
    else facts.push(planned);
  }
  if (errors.length > 0) return { ok: false, errors };
  const [first] = facts as [FactPlan, ...FactPlan[]];
  return { ok: true, plan: facts.length > 1 ? { ...first, facts } : first };
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
