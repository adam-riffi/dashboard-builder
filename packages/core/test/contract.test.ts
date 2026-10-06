import { describe, expect, it } from "vitest";
import { type DataContract, dataContract } from "../src/index.ts";

const valid: DataContract = {
  contractVersion: "a".repeat(64),
  tables: [
    {
      name: "shop.orders",
      rowCount: 120,
      primaryKey: ["id"],
      columns: [
        {
          name: "id",
          pgType: "int8",
          type: "number",
          nullable: false,
          role: "id",
          distinct: 120,
          highCardinality: false,
        },
        {
          name: "ordered_at",
          pgType: "timestamptz",
          type: "date",
          nullable: false,
          role: "time",
          distinct: null,
          highCardinality: false,
        },
        {
          name: "total",
          pgType: "numeric",
          type: "number",
          nullable: true,
          role: "measure",
          aggregation: "SUM",
          distinct: 80,
          highCardinality: false,
        },
        {
          name: "status",
          pgType: "text",
          type: "string",
          nullable: false,
          role: "dimension",
          distinct: 3,
          highCardinality: false,
        },
      ],
    },
  ],
  relationships: [
    {
      from: { table: "shop.orders", columns: ["customer_id"] },
      to: { table: "shop.customers", columns: ["id"] },
      kind: "many-to-one",
    },
  ],
  measures: [],
};

const withColumn = (patch: object) => ({
  ...valid,
  tables: [{ ...valid.tables[0], columns: [{ ...valid.tables[0]?.columns[0], ...patch }] }],
});

describe("dataContract", () => {
  it("accepts a well-formed contract", () => {
    expect(dataContract.parse(valid)).toEqual(valid);
  });

  it("rejects a contract version that is not a SHA-256 hex digest", () => {
    expect(dataContract.safeParse({ ...valid, contractVersion: "v1" }).success).toBe(false);
  });

  it("rejects unknown roles and types", () => {
    expect(dataContract.safeParse(withColumn({ role: "key" })).success).toBe(false);
    expect(dataContract.safeParse(withColumn({ type: "json" })).success).toBe(false);
  });

  it("requires an aggregation on measures and only on measures", () => {
    expect(dataContract.safeParse(withColumn({ role: "measure" })).success).toBe(false);
    expect(dataContract.safeParse(withColumn({ aggregation: "SUM" })).success).toBe(false);
    expect(
      dataContract.safeParse(withColumn({ role: "measure", aggregation: "AVG" })).success,
    ).toBe(true);
  });

  it("names tables as schema.table", () => {
    const bare = { ...valid, tables: [{ ...valid.tables[0], name: "orders" }] };
    expect(dataContract.safeParse(bare).success).toBe(false);
  });

  it("rejects relationships without columns", () => {
    const rel = {
      from: { table: "shop.orders", columns: [] },
      to: { table: "shop.customers", columns: ["id"] },
      kind: "many-to-one",
    };
    expect(dataContract.safeParse({ ...valid, relationships: [rel] }).success).toBe(false);
  });

  it("lists the host's measures, none by default", () => {
    expect(dataContract.parse(valid).measures).toEqual([]);
    const revenue = { name: "Revenue", formula: "SUM(order_items.amount)", type: "number" };
    expect(dataContract.parse({ ...valid, measures: [revenue] }).measures).toEqual([revenue]);
    const bad = { ...revenue, name: "[Revenue]" };
    expect(dataContract.safeParse({ ...valid, measures: [bad] }).success).toBe(false);
  });
});
