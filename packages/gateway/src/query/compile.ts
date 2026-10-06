import type { FieldType, MeasureAggregation, TimeGrain } from "@adam-riffi/dash-core";
import type { JoinPlan } from "./paths.ts";
import type { ValidQuery } from "./validate.ts";

/** A row policy (DESIGN.md §6): `table.column` must be in the scope list named by `in`. */
export interface Policy {
  table: string;
  column: string;
  in: string;
}

/** One result column, in select order: dimensions `d0…`, then measures `m0…`. */
export type OutputColumn =
  | { key: string; kind: "dimension"; field: string; timeGrain?: TimeGrain; type: FieldType }
  | {
      key: string;
      kind: "measure";
      field: string;
      aggregation: MeasureAggregation;
      type: FieldType;
    };

export interface CompiledQuery {
  text: string;
  params: unknown[];
  columns: OutputColumn[];
}

export type Compilation = { ok: true; query: CompiledQuery } | { ok: false; errors: string[] };

const OPERATORS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

/** Identifiers only ever come from the contract, and are always quoted. */
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteTable = (table: string) => table.split(".").map(quote).join(".");

/**
 * Compiles a validated, planned query to parameterized Postgres SQL (DESIGN.md §6). Every table in
 * the query that has a policy gets a mandatory `column = any($n)` predicate bound to the caller's
 * scope; a policy whose scope list is missing fails closed. Values are never part of the text.
 * The limit is one above the requested rows so the executor can report truncation.
 */
export function compileQuery(
  query: ValidQuery,
  plan: JoinPlan,
  policies: Policy[],
  scope: Record<string, unknown>,
): Compilation {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const tables = [plan.base, ...plan.joins.map((j) => j.to.table)];
  const alias = new Map(tables.map((t, i) => [t, quote(`t${i}`)]));
  const ref = (table: string, column: string) => `${alias.get(table)}.${quote(column)}`;

  const errors: string[] = [];
  const policyPredicates = tables.flatMap((table) =>
    policies
      .filter((p) => p.table === table)
      .flatMap((p) => {
        const values = scope[p.in];
        if (!Array.isArray(values)) {
          errors.push(`scope has no list ${p.in} for the policy on ${table}`);
          return [];
        }
        return [`${ref(table, p.column)} = any(${bind(values)})`];
      }),
  );
  if (errors.length > 0) return { ok: false, errors };

  const columns: OutputColumn[] = [];
  const select = [
    ...query.dimensions.map((d, i) => {
      const key = `d${i}`;
      const column = ref(d.table, d.column.name);
      columns.push({
        key,
        kind: "dimension",
        field: d.field,
        ...(d.timeGrain ? { timeGrain: d.timeGrain } : {}),
        type: d.column.type,
      });
      // The grain comes from a fixed enum, never from free text.
      return `${d.timeGrain ? `date_trunc('${d.timeGrain}', ${column})` : column} as ${quote(key)}`;
    }),
    ...query.measures.map((m, i) => {
      const key = `m${i}`;
      const column = ref(m.table, m.column.name);
      const counted = m.aggregation === "COUNT" || m.aggregation === "COUNT_DISTINCT";
      columns.push({
        key,
        kind: "measure",
        field: m.field,
        aggregation: m.aggregation,
        type:
          counted || m.aggregation === "SUM" || m.aggregation === "AVG" ? "number" : m.column.type,
      });
      const call =
        m.aggregation === "COUNT_DISTINCT"
          ? `count(distinct ${column})`
          : `${m.aggregation.toLowerCase()}(${column})`;
      return `${call} as ${quote(key)}`;
    }),
  ];

  const filterPredicates = query.filters.map((f) => {
    const column = ref(f.table, f.column.name);
    // The driver would send a list of booleans as a single boolean; send text and cast instead.
    const list = () =>
      f.column.type === "boolean" ? `${bind(f.values.map(String))}::boolean[]` : bind(f.values);
    switch (f.op) {
      case "in":
        return `${column} = any(${list()})`;
      case "not_in":
        return `not (${column} = any(${list()}))`;
      case "between":
        return `${column} between ${bind(f.values[0])} and ${bind(f.values[1])}`;
      default:
        return `${column} ${OPERATORS[f.op]} ${bind(f.values[0])}`;
    }
  });

  const lines = [
    `select ${select.join(", ")}`,
    `from ${quoteTable(plan.base)} as ${alias.get(plan.base)}`,
    ...plan.joins.map((j) => {
      const on = j.to.columns
        .map((c, i) => `${ref(j.to.table, c)} = ${ref(j.from.table, j.from.columns[i] as string)}`)
        .join(" and ");
      return `left join ${quoteTable(j.to.table)} as ${alias.get(j.to.table)} on ${on}`;
    }),
  ];
  const where = [...policyPredicates, ...filterPredicates];
  if (where.length > 0) lines.push(`where ${where.join(" and ")}`);
  if (query.dimensions.length > 0) {
    lines.push(`group by ${query.dimensions.map((_, i) => i + 1).join(", ")}`);
  }
  if (query.sort.length > 0) {
    const keys = query.sort.map(
      (s) => `${quote(`${s.by === "dimension" ? "d" : "m"}${s.index}`)} ${s.dir}`,
    );
    // Ties fall back to the dimensions, so the rows kept at the limit are always the same.
    const tiebreak = query.dimensions.map((_, i) => String(i + 1));
    lines.push(`order by ${[...keys, ...tiebreak].join(", ")}`);
  } else if (query.dimensions.length > 0) {
    lines.push(`order by ${query.dimensions.map((_, i) => i + 1).join(", ")}`);
  }
  lines.push(`limit ${bind(query.limit + 1)}`);

  return { ok: true, query: { text: lines.join("\n"), params, columns } };
}
