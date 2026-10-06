import type { DataContract, Relationship } from "@adam-riffi/dash-core";
import type { ValidQuery } from "./validate.ts";

/** The base (fact) table and the joins to add, each from a table already in the query. */
export interface JoinPlan {
  base: string;
  joins: Relationship[];
}

export type JoinPlanning = { ok: true; plan: JoinPlan } | { ok: false; errors: string[] };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const via = (r: Relationship) => `${r.from.table}(${r.from.columns})`;

/**
 * Join-path resolution (DESIGN.md §6, hand-written core). The base table is the measures'
 * table; every other table must be reached from it by following many-to-one relationships, on
 * the single shortest path. Ambiguous paths and fan-out (one-to-many) are rejected with the
 * tables named.
 */
export function planJoins(query: ValidQuery, contract: DataContract): JoinPlanning {
  const factTables = [...new Set(query.measures.map((m) => m.table))].sort(compare);
  const [base] = factTables;
  if (base === undefined || factTables.length > 1) {
    return {
      ok: false,
      errors: [`measures come from ${factTables.join(" and ")}; a query has one fact table`],
    };
  }
  const needed = [...new Set([...query.dimensions, ...query.filters].map((f) => f.table))]
    .filter((t) => t !== base)
    .sort(compare);

  // Breadth-first over many-to-one edges, counting shortest paths into each table.
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

  const errors = needed.flatMap((table) => {
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
  if (errors.length > 0) return { ok: false, errors };

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
