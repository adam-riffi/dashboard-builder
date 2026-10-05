import { describe, expect, it } from "vitest";
import type { CatalogColumn, CatalogTable } from "../../src/contract/catalog.ts";
import { inferTables } from "../../src/contract/infer.ts";

const col = (name: string, pgType: string, extra: Partial<CatalogColumn> = {}): CatalogColumn => ({
  name,
  pgType,
  isEnum: false,
  nullable: false,
  nDistinct: null,
  ...extra,
});

const table = (name: string, extra: Partial<CatalogTable> = {}): CatalogTable => ({
  name,
  rowCount: 1000,
  primaryKey: [],
  columns: [col("label", "text")],
  foreignKeys: [],
  ...extra,
});

const columnsOf = (t: CatalogTable) => inferTables({ tables: [t] }).tables[0]?.columns ?? [];
const only = (c: CatalogColumn, extra: Partial<CatalogTable> = {}) =>
  columnsOf(table("s.t", { columns: [c], ...extra }))[0];

describe("inferTables: types", () => {
  it.each([
    ["int2", "number"],
    ["int4", "number"],
    ["int8", "number"],
    ["float4", "number"],
    ["float8", "number"],
    ["numeric", "number"],
    ["text", "string"],
    ["varchar", "string"],
    ["bpchar", "string"],
    ["uuid", "string"],
    ["bool", "boolean"],
    ["date", "date"],
    ["timestamp", "date"],
    ["timestamptz", "date"],
  ])("%s is a %s", (pgType, type) => {
    expect(only(col("x", pgType))).toMatchObject({ pgType, type });
  });

  it("treats enums as strings", () => {
    expect(only(col("tier", "plan_tier", { isEnum: true }))).toMatchObject({ type: "string" });
  });

  it.each(["jsonb", "json", "_int4", "bytea", "interval", "time", "money"])(
    "omits unsupported %s columns",
    (pgType) => {
      const cols = columnsOf(table("s.t", { columns: [col("keep", "text"), col("x", pgType)] }));
      expect(cols.map((c) => c.name)).toEqual(["keep"]);
    },
  );

  it("omits tables left without supported columns", () => {
    const blobs = table("s.blobs", { columns: [col("payload", "bytea")] });
    expect(inferTables({ tables: [blobs, table("s.t")] }).tables.map((t) => t.name)).toEqual([
      "s.t",
    ]);
  });

  it("keeps nullability and ordinal order", () => {
    const cols = columnsOf(
      table("s.t", { columns: [col("b", "text", { nullable: true }), col("a", "int4")] }),
    );
    expect(cols.map((c) => [c.name, c.nullable])).toEqual([
      ["b", true],
      ["a", false],
    ]);
  });
});

describe("inferTables: roles", () => {
  it("marks primary keys, foreign keys and *_id columns as id", () => {
    const cols = columnsOf(
      table("s.orders", {
        primaryKey: ["id"],
        columns: [col("id", "int8"), col("buyer", "int4"), col("external_id", "text")],
        foreignKeys: [{ columns: ["buyer"], references: "s.orders", referencedColumns: ["id"] }],
      }),
    );
    expect(cols.map((c) => c.role)).toEqual(["id", "id", "id"]);
  });

  it("marks dates and timestamps as time", () => {
    expect(only(col("ordered_at", "timestamptz"))?.role).toBe("time");
    expect(only(col("day", "date"))?.role).toBe("time");
  });

  it("makes non-key numbers measures summed by default", () => {
    expect(only(col("quantity", "int4"))).toMatchObject({ role: "measure", aggregation: "SUM" });
  });

  it.each([
    "unit_price",
    "tax_rate",
    "conversion_ratio",
    "discount_pct",
    "percent_done",
    "score",
    "unitPrice",
    "exchange_rates",
  ])("averages %s", (name) => {
    expect(only(col(name, "numeric"))).toMatchObject({ role: "measure", aggregation: "AVG" });
  });

  // The averaged words must be whole name parts: "duration" contains "ratio".
  it.each(["duration_minutes", "accurate_count", "operators", "scoreboard_rows"])(
    "sums %s",
    (name) => {
      expect(only(col(name, "int4"))).toMatchObject({ role: "measure", aggregation: "SUM" });
    },
  );

  it("does not make numeric keys measures", () => {
    const c = only(col("id", "int4"), { primaryKey: ["id"] });
    expect(c).toMatchObject({ role: "id" });
    expect(c).not.toHaveProperty("aggregation");
  });

  it("makes everything else a dimension", () => {
    expect(only(col("status", "text"))?.role).toBe("dimension");
    expect(only(col("active", "bool"))?.role).toBe("dimension");
    expect(only(col("tier", "plan_tier", { isEnum: true }))?.role).toBe("dimension");
  });
});

describe("inferTables: statistics", () => {
  it("keeps absolute distinct estimates", () => {
    expect(only(col("status", "text", { nDistinct: 3 }))?.distinct).toBe(3);
  });

  it("turns negative n_distinct into a share of the row count", () => {
    const c = only(col("email", "text", { nDistinct: -0.5 }), { rowCount: 30_000 });
    expect(c?.distinct).toBe(15_000);
  });

  it("leaves distinct unknown when statistics or row counts are hidden", () => {
    expect(only(col("status", "text"))?.distinct).toBeNull();
    expect(only(col("email", "text", { nDistinct: -1 }), { rowCount: null })?.distinct).toBeNull();
  });

  it("flags dimensions above 10,000 distinct values as high cardinality", () => {
    expect(only(col("email", "text", { nDistinct: 10_001 }))?.highCardinality).toBe(true);
    expect(only(col("city", "text", { nDistinct: 10_000 }))?.highCardinality).toBe(false);
    expect(only(col("status", "text"))?.highCardinality).toBe(false);
  });

  it("only flags dimensions", () => {
    expect(only(col("amount", "numeric", { nDistinct: 50_000 }))?.highCardinality).toBe(false);
  });

  it("keeps the row count", () => {
    const [t] = inferTables({ tables: [table("s.t", { rowCount: null })] }).tables;
    expect(t?.rowCount).toBeNull();
  });
});

describe("inferTables: relationships", () => {
  const customers = table("s.customers", { primaryKey: ["id"], columns: [col("id", "int4")] });
  const airports = table("s.airports", { primaryKey: ["code"], columns: [col("code", "text")] });
  const describeRels = (tables: CatalogTable[]) =>
    inferTables({ tables }).relationships.map(
      (r) => `${r.from.table}(${r.from.columns}) -> ${r.to.table}(${r.to.columns})`,
    );

  it("turns each foreign key into a many-to-one relationship", () => {
    const orders = table("s.orders", {
      columns: [col("customer_id", "int4")],
      foreignKeys: [
        { columns: ["customer_id"], references: "s.customers", referencedColumns: ["id"] },
      ],
    });
    expect(inferTables({ tables: [orders, customers] }).relationships).toEqual([
      {
        from: { table: "s.orders", columns: ["customer_id"] },
        to: { table: "s.customers", columns: ["id"] },
        kind: "many-to-one",
      },
    ]);
  });

  it("keeps composite and parallel keys apart, in a stable order", () => {
    const flights = table("s.flights", {
      primaryKey: ["carrier", "number"],
      columns: [
        col("carrier", "text"),
        col("number", "int4"),
        col("origin", "text"),
        col("destination", "text"),
      ],
      foreignKeys: [
        { columns: ["origin"], references: "s.airports", referencedColumns: ["code"] },
        { columns: ["destination"], references: "s.airports", referencedColumns: ["code"] },
      ],
    });
    const legs = table("s.legs", {
      columns: [
        col("carrier", "text"),
        col("number", "int4"),
        col("next_carrier", "text"),
        col("next_number", "int4"),
      ],
      foreignKeys: [
        {
          columns: ["next_carrier", "next_number"],
          references: "s.flights",
          referencedColumns: ["carrier", "number"],
        },
        {
          columns: ["carrier", "number"],
          references: "s.flights",
          referencedColumns: ["carrier", "number"],
        },
      ],
    });
    expect(describeRels([legs, flights, airports])).toEqual([
      "s.flights(destination) -> s.airports(code)",
      "s.flights(origin) -> s.airports(code)",
      "s.legs(carrier,number) -> s.flights(carrier,number)",
      "s.legs(next_carrier,next_number) -> s.flights(carrier,number)",
    ]);
  });

  it("keeps self references", () => {
    const staff = table("s.staff", {
      primaryKey: ["id"],
      columns: [col("id", "int4"), col("manager_id", "int4")],
      foreignKeys: [{ columns: ["manager_id"], references: "s.staff", referencedColumns: ["id"] }],
    });
    expect(describeRels([staff])).toEqual(["s.staff(manager_id) -> s.staff(id)"]);
  });

  it("drops foreign keys to tables outside the allowlist but keeps the id role", () => {
    const orders = table("s.orders", {
      columns: [col("warehouse", "int4")],
      foreignKeys: [
        { columns: ["warehouse"], references: "s.warehouses", referencedColumns: ["id"] },
      ],
    });
    const result = inferTables({ tables: [orders] });
    expect(result.relationships).toEqual([]);
    expect(result.tables[0]?.columns[0]?.role).toBe("id");
  });

  it("drops foreign keys through omitted columns", () => {
    const docs = table("s.docs", {
      columns: [col("label", "text"), col("tags", "_text")],
      foreignKeys: [{ columns: ["tags"], references: "s.docs", referencedColumns: ["tags"] }],
    });
    expect(describeRels([docs])).toEqual([]);
  });

  it("sorts tables by name", () => {
    const names = inferTables({ tables: [table("s.b"), table("s.a")] }).tables.map((t) => t.name);
    expect(names).toEqual(["s.a", "s.b"]);
  });
});
