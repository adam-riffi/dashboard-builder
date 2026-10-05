import type { OutputColumn } from "./compile.ts";

export interface ShapedResult {
  columns: OutputColumn[];
  /** Column-major: `data[i]` holds the values of `columns[i]` (DESIGN.md §7). */
  data: unknown[][];
  truncated: boolean;
}

/** JSON-ready values: numbers for number columns (the driver returns numerics and bigints as
 * strings), ISO strings for dates, nulls kept. */
function toJson(value: unknown, column: OutputColumn): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === "number") return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Shapes driver rows into the response (pure). The compiled query fetches one row more than the
 * limit, so an extra row means the result was cut.
 */
export function shapeResult(
  rows: readonly Record<string, unknown>[],
  columns: OutputColumn[],
  limit: number,
): ShapedResult {
  const kept = rows.slice(0, limit);
  return {
    columns,
    data: columns.map((c) => kept.map((row) => toJson(row[c.key], c))),
    truncated: rows.length > limit,
  };
}
