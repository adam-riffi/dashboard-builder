import {
  type ContractColumn,
  children,
  type DataContract,
  type FilterOp,
  MAX_ROWS,
  type MeasureAggregation,
  type QuerySpec,
  type TimeGrain,
  type Typed,
} from "@adam-riffi/dash-core";

/** A field resolved to its contract table and column. */
export interface ResolvedField {
  field: string;
  table: string;
  column: ContractColumn;
}

/**
 * A measure ready to compile: its checked expression, the tables it reads, and what the spec
 * asked for, echoed in the output columns. A column measure is the formula `AGG(field)` (ADR 0006).
 */
export type ValidMeasure = { expr: Typed; tables: string[] } & (
  | { field: string; aggregation: MeasureAggregation }
  | { formula: string }
  | { name: string }
);

export interface ValidQuery {
  dimensions: (ResolvedField & { timeGrain?: TimeGrain })[];
  measures: ValidMeasure[];
  filters: (ResolvedField & { op: FilterOp; values: (string | number | boolean)[] })[];
  sort: NonNullable<QuerySpec["sort"]>;
  limit: number;
}

export type Validation = { ok: true; query: ValidQuery } | { ok: false; errors: string[] };

const NUMERIC_ONLY = new Set<MeasureAggregation>(["SUM", "AVG"]);

/** The tables a checked expression reads, sorted. */
export function tablesOf(expr: Typed): string[] {
  const found = new Set<string>();
  const walk = (t: Typed): void => {
    if (t.kind === "column") found.add(t.table);
    else children(t).forEach(walk);
  };
  walk(expr);
  return [...found].sort();
}

/** The formula a column measure stands for: `AGG(table.column)`. */
function columnMeasure(r: ResolvedField, aggregation: MeasureAggregation): Typed {
  const keepsType = aggregation === "MIN" || aggregation === "MAX";
  return {
    kind: "call",
    name: aggregation === "COUNT_DISTINCT" ? "COUNTDISTINCT" : aggregation,
    args: [
      { kind: "column", table: r.table, column: r.column.name, type: r.column.type, level: "row" },
    ],
    type: keepsType ? r.column.type : "number",
    level: "aggregate",
  };
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO date or timestamp whose calendar date exists: Date.parse rolls 2026-02-30 into March. */
function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    return false;
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Checks a QuerySpec against the contract (pure). Every problem is reported, each prefixed with
 * the field it is about; on success the fields are resolved and the defaults filled in.
 */
export function validateQuery(spec: QuerySpec, contract: DataContract): Validation {
  const errors: string[] = [];
  const tables = new Map(contract.tables.map((t) => [t.name, t]));

  const resolve = (field: string): ResolvedField | undefined => {
    const dot = field.lastIndexOf(".");
    const tableName = field.slice(0, dot);
    const table = tables.get(tableName);
    if (!table) {
      errors.push(`${field}: unknown table ${tableName}`);
      return undefined;
    }
    const column = table.columns.find((c) => c.name === field.slice(dot + 1));
    if (!column) {
      errors.push(`${field}: unknown column`);
      return undefined;
    }
    return { field, table: tableName, column };
  };

  const dimensions = spec.dimensions.flatMap((d) => {
    const r = resolve(d.field);
    if (!r) return [];
    if (d.timeGrain && r.column.type !== "date") {
      errors.push(`${d.field}: time grains need a date column`);
    }
    return [d.timeGrain ? { ...r, timeGrain: d.timeGrain } : r];
  });

  const measures = spec.measures.flatMap((m) => {
    const r = resolve(m.field);
    if (!r) return [];
    const aggregation = m.aggregation ?? r.column.aggregation;
    if (!aggregation) {
      errors.push(`${m.field}: not a measure column; choose an aggregation`);
      return [];
    }
    if (NUMERIC_ONLY.has(aggregation) && r.column.type !== "number") {
      errors.push(`${m.field}: ${aggregation} needs a number column`);
    } else if (r.column.type === "boolean" && (aggregation === "MIN" || aggregation === "MAX")) {
      errors.push(`${m.field}: ${aggregation} needs a number, date or string column`);
    }
    return [
      { field: m.field, aggregation, expr: columnMeasure(r, aggregation), tables: [r.table] },
    ];
  });

  const filters = spec.filters.flatMap((f) => {
    const r = resolve(f.field);
    if (!r) return [];
    const message = valuesProblem(r.column, f.op, f.values);
    if (message) errors.push(`${f.field}: ${message}`);
    return [{ ...r, op: f.op, values: f.values }];
  });

  const sort = spec.sort ?? [];
  sort.forEach((s, i) => {
    const count = s.by === "dimension" ? spec.dimensions.length : spec.measures.length;
    if (s.index >= count) errors.push(`sort[${i}]: there is no ${s.by} ${s.index}`);
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    query: { dimensions, measures, filters, sort, limit: spec.limit ?? MAX_ROWS },
  };
}

function valuesProblem(
  column: ContractColumn,
  op: FilterOp,
  values: (string | number | boolean)[],
): string | undefined {
  switch (column.type) {
    case "number":
      return values.every((v) => typeof v === "number" && Number.isFinite(v))
        ? undefined
        : "values must be numbers";
    case "string":
      return values.every((v) => typeof v === "string") ? undefined : "values must be strings";
    case "date":
      return values.every(isIsoDate) ? undefined : "values must be ISO dates";
    case "boolean":
      if (op !== "in" && op !== "not_in") return `${op} does not apply to true/false columns`;
      return values.every((v) => typeof v === "boolean")
        ? undefined
        : "values must be true or false";
  }
}
