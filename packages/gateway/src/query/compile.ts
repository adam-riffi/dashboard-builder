import type { ResultColumn, Typed } from "@adam-riffi/dash-core";
import type { JoinPlan } from "./paths.ts";
import type { ValidQuery } from "./validate.ts";

/** A row policy (DESIGN.md §6): `table.column` must be in the scope list named by `in`. */
export interface Policy {
  table: string;
  column: string;
  in: string;
}

/** One result column, in select order: dimensions `d0…`, then measures `m0…`. */
export type OutputColumn = ResultColumn;

export interface CompiledQuery {
  text: string;
  params: unknown[];
  columns: OutputColumn[];
}

export type Compilation = { ok: true; query: CompiledQuery } | { ok: false; errors: string[] };

const OPERATORS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
const AGGREGATES = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT"]);

/**
 * Renders a checked formula as a Postgres expression (DESIGN.md §6). Every binary operation is
 * parenthesized; literals are bound with a cast so Postgres never infers an integer type for
 * them; division is numeric so integers do not truncate, and `DIVIDE` returns null on zero.
 */
export function renderFormula(
  t: Typed,
  ref: (table: string, column: string) => string,
  bind: (value: unknown) => string,
): string {
  const r = (e: Typed) => renderFormula(e, ref, bind);
  switch (t.kind) {
    case "number":
      return `${bind(t.value)}::numeric`;
    case "string":
      return `${bind(t.value)}::text`;
    case "column":
      // The contract types enum, uuid and char columns as strings; as text they compare with
      // string literals and with each other (a no-op for text columns).
      return t.type === "string" ? `${ref(t.table, t.column)}::text` : ref(t.table, t.column);
    case "unary":
      return t.op === "-" ? `(-${r(t.operand)})` : `(not ${r(t.operand)})`;
    case "binary":
      if (t.op === "/") return `((${r(t.left)})::numeric / ${r(t.right)})`;
      return `(${r(t.left)} ${t.op === "AND" || t.op === "OR" ? t.op.toLowerCase() : t.op} ${r(t.right)})`;
    case "call": {
      const [a, b, c] = t.args as [Typed, Typed | undefined, Typed | undefined];
      if (AGGREGATES.has(t.name)) return `${t.name.toLowerCase()}(${r(a)})`;
      switch (t.name) {
        case "COUNTDISTINCT":
          return `count(distinct ${r(a)})`;
        case "DIVIDE":
          return `((${r(a)})::numeric / nullif(${r(b as Typed)}, 0))`;
        case "IF":
          return `case when ${r(a)} then ${r(b as Typed)}${c ? ` else ${r(c)}` : ""} end`;
        case "COALESCE":
          return `coalesce(${t.args.map(r).join(", ")})`;
        case "ROUND":
          // The checker only lets a whole-number literal through as the digits.
          return `round((${r(a)})::numeric${b?.kind === "number" ? `, ${bind(b.value)}::int` : ""})`;
        case "DATE_TRUNC":
          return `date_trunc(${r(a)}, ${r(b as Typed)})`;
      }
      throw new Error(`no SQL for function ${t.name}`);
    }
  }
}

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
      const echo =
        "field" in m
          ? { field: m.field, aggregation: m.aggregation }
          : "formula" in m
            ? { formula: m.formula }
            : { name: m.name };
      columns.push({ key, kind: "measure", ...echo, type: m.expr.type });
      return `${renderFormula(m.expr, ref, bind)} as ${quote(key)}`;
    }),
  ];

  const filterPredicates = query.filters.map((f) => {
    const column = ref(f.table, f.column.name);
    // postgres.js mangles boolean lists (a list of booleans is typed as one boolean, and strings
    // in an inferred boolean[] all become 'f'), so booleans go as a ready-made array literal.
    const list = () =>
      f.column.type === "boolean"
        ? `${bind(`{${f.values.map((v) => (v === true ? "t" : "f")).join(",")}}`)}::boolean[]`
        : bind(f.values);
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
