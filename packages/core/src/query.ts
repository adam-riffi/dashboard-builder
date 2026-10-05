import { z } from "zod";

/** Rows one query may return and queries one request may carry (DESIGN.md §6). */
export const MAX_ROWS = 10_000;
export const MAX_QUERIES = 20;

const field = z
  .string()
  .regex(/^[^.\s]+\.[^.\s]+\.[^.\s]+$/, "fields are named schema.table.column");

export const timeGrain = z.enum(["day", "week", "month", "quarter", "year"]);
export const measureAggregation = z.enum(["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"]);
export const filterOp = z.enum(["in", "not_in", "between", "gt", "gte", "lt", "lte"]);

/** How many values each operator takes: exactly n, or at least 1 when null. */
const ARITY: Record<z.infer<typeof filterOp>, number | null> = {
  in: null,
  not_in: null,
  between: 2,
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
};

const filter = z
  .object({
    field,
    op: filterOp,
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  })
  .strict()
  .refine((f) => ARITY[f.op] === null || f.values.length === ARITY[f.op], {
    message: "wrong number of values for this operator",
    path: ["values"],
  });

/**
 * One visual's query (DESIGN.md §7). M2 measures are column measures with an optional
 * aggregation (the contract's default otherwise); M3 adds formulas and named measures (ADR 0006).
 */
export const querySpec = z
  .object({
    dimensions: z.array(z.object({ field, timeGrain: timeGrain.optional() }).strict()).default([]),
    measures: z
      .array(z.object({ field, aggregation: measureAggregation.optional() }).strict())
      .min(1),
    filters: z.array(filter).default([]),
    /** Sorts by a dimension or measure, by its position in the spec. */
    sort: z
      .array(
        z
          .object({
            by: z.enum(["dimension", "measure"]),
            index: z.number().int().nonnegative(),
            dir: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .optional(),
    limit: z.number().int().positive().max(MAX_ROWS).optional(),
  })
  .strict();

/** The body of `POST /query`. */
export const queryRequest = z.object({ queries: z.array(querySpec).min(1).max(MAX_QUERIES) });

export type TimeGrain = z.infer<typeof timeGrain>;
export type MeasureAggregation = z.infer<typeof measureAggregation>;
export type FilterOp = z.infer<typeof filterOp>;
export type QuerySpec = z.infer<typeof querySpec>;
export type QueryRequest = z.infer<typeof queryRequest>;
