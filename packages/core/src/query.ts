import { z } from "zod";

/** Rows one query may return and queries one request may carry (DESIGN.md §6). */
export const MAX_ROWS = 10_000;
export const MAX_QUERIES = 20;

/** Caps on request size at the trust boundary. */
const MAX_LIST = 20;
const MAX_VALUES = 1_000;
export const MAX_FORMULA_LENGTH = 2_000;
export const MAX_NAMED_MEASURES = 50;

export const fieldName = z
  .string()
  .max(200)
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

export const filter = z
  .object({
    field: fieldName,
    op: filterOp,
    values: z
      .array(z.union([z.string().max(200), z.number(), z.boolean()]))
      .min(1)
      .max(MAX_VALUES),
  })
  .strict()
  .refine((f) => ARITY[f.op] === null || f.values.length === ARITY[f.op], {
    message: "wrong number of values for this operator",
    path: ["values"],
  });

const formula = z.string().min(1).max(MAX_FORMULA_LENGTH);

/** What `[Name]` refers to in formulas: no brackets, no surrounding spaces. */
export const measureName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^[\]\s](?:[^[\]]*[^[\]\s])?$/, "measure names have no [ ] and no surrounding spaces");

/** A column with an aggregation, a formula, or a named measure (ADR 0006, ADR 0007). */
export const measure = z.union([
  z.object({ field: fieldName, aggregation: measureAggregation.optional() }).strict(),
  z.object({ formula }).strict(),
  z.object({ name: measureName }).strict(),
]);

/** A measure defined by name, by the host's configuration or a dashboard (ADR 0007). */
/** How a measure's numbers are displayed (DESIGN.md §7). */
export const measureFormat = z.enum(["number", "currency", "percent"]);

export const namedMeasure = z
  .object({ name: measureName, formula, format: measureFormat.optional() })
  .strict();

/**
 * One visual's query (DESIGN.md §7). A column measure's aggregation defaults to the contract's.
 */
export const querySpec = z
  .object({
    dimensions: z
      .array(z.object({ field: fieldName, timeGrain: timeGrain.optional() }).strict())
      .max(10)
      .default([]),
    measures: z.array(measure).min(1).max(MAX_LIST),
    filters: z.array(filter).max(MAX_LIST).default([]),
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
      .max(10)
      .optional(),
    limit: z.number().int().positive().max(MAX_ROWS).optional(),
  })
  .strict();

/** The body of `POST /query`: the queries, and the dashboard's own named measures. */
export const queryRequest = z.object({
  measures: z
    .array(namedMeasure)
    .max(MAX_NAMED_MEASURES)
    .refine((list) => new Set(list.map((m) => m.name)).size === list.length, {
      message: "measure names must be unique",
    })
    .optional(),
  queries: z.array(querySpec).min(1).max(MAX_QUERIES),
});

export type TimeGrain = z.infer<typeof timeGrain>;
export type MeasureAggregation = z.infer<typeof measureAggregation>;
export type FilterOp = z.infer<typeof filterOp>;
export type Measure = z.infer<typeof measure>;
export type MeasureFormat = z.infer<typeof measureFormat>;
export type NamedMeasure = z.infer<typeof namedMeasure>;
export type QuerySpec = z.infer<typeof querySpec>;
export type QueryRequest = z.infer<typeof queryRequest>;
