import { z } from "zod";

/** Value types shared by the contract, the formula type checker and visuals (DESIGN.md §6). */
export const fieldType = z.enum(["number", "string", "boolean", "date"]);
export const columnRole = z.enum(["id", "time", "measure", "dimension"]);
export const aggregation = z.enum(["SUM", "AVG"]);

const column = z
  .object({
    name: z.string().min(1),
    pgType: z.string().min(1),
    type: fieldType,
    nullable: z.boolean(),
    role: columnRole,
    aggregation: aggregation.optional(),
    /** Estimated distinct values; null when statistics are not visible to the source role. */
    distinct: z.number().nonnegative().nullable(),
    highCardinality: z.boolean(),
  })
  .refine((c) => (c.role === "measure") === (c.aggregation !== undefined), {
    message: "measures, and only measures, carry a default aggregation",
  });

const columnsOf = z.object({ table: z.string(), columns: z.array(z.string()).min(1) });

/** What the gateway serves at `GET /contract`; `contractVersion` is the schema hash. */
export const dataContract = z.object({
  contractVersion: z.string().regex(/^[0-9a-f]{64}$/),
  tables: z.array(
    z.object({
      name: z.string().regex(/^[^.]+\.[^.]+$/, "tables are named schema.table"),
      rowCount: z.number().int().nonnegative().nullable(),
      primaryKey: z.array(z.string()),
      columns: z.array(column).min(1),
    }),
  ),
  relationships: z.array(
    z.object({ from: columnsOf, to: columnsOf, kind: z.literal("many-to-one") }),
  ),
});

export type FieldType = z.infer<typeof fieldType>;
export type ColumnRole = z.infer<typeof columnRole>;
export type Aggregation = z.infer<typeof aggregation>;
export type DataContract = z.infer<typeof dataContract>;
export type ContractTable = DataContract["tables"][number];
export type ContractColumn = ContractTable["columns"][number];
export type Relationship = DataContract["relationships"][number];
