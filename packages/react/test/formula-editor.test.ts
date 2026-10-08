import { dataContract } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { completionsAt, diagnosticsOf } from "../src/builder-entry.ts";

const col = (name: string, type: "number" | "string", role: "measure" | "dimension") => ({
  name,
  pgType: type,
  type,
  nullable: false,
  role,
  ...(role === "measure" ? { aggregation: "SUM" as const } : {}),
  distinct: null,
  highCardinality: false,
});
const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    {
      name: "dash_demo.order_items",
      rowCount: null,
      primaryKey: [],
      columns: [col("quantity", "number", "measure"), col("unit_price", "number", "measure")],
    },
    {
      name: "dash_demo.orders",
      rowCount: null,
      primaryKey: [],
      columns: [col("status", "string", "dimension")],
    },
  ],
  relationships: [],
  measures: [
    {
      name: "Revenue",
      formula: "SUM(order_items.quantity * order_items.unit_price)",
      type: "number",
    },
  ],
});
const measures = [{ name: "Units", formula: "SUM(order_items.quantity)" }];
const at = (doc: string) => completionsAt(doc, doc.length, contract, measures);
const labels = (doc: string) => at(doc)?.options.map((o) => o.label);

describe("completionsAt", () => {
  it("offers a table's columns after its name and a dot", () => {
    expect(at("SUM(order_items.q")).toMatchObject({ from: 16 });
    expect(labels("SUM(order_items.")).toEqual(["quantity", "unit_price"]);
    expect(labels("SUM(dash_demo.orders.")).toEqual(["status"]);
  });

  it("offers measure names inside brackets", () => {
    expect(at("[Rev")).toMatchObject({ from: 1 });
    expect(labels("DIVIDE([")).toEqual(["Revenue", "Units"]);
  });

  it("offers functions, tables and keywords for a word", () => {
    const options = labels("CO") ?? [];
    expect(options).toEqual(
      expect.arrayContaining([
        "COUNT",
        "COUNTDISTINCT",
        "COALESCE",
        "orders",
        "order_items",
        "AND",
      ]),
    );
    expect(at("SUM(ord")).toMatchObject({ from: 4 });
  });

  it("offers nothing inside a string or right after a number", () => {
    expect(at('IF(orders.status = "pa')).toBeNull();
    expect(at("12")).toBeNull();
  });
});

describe("diagnosticsOf", () => {
  it("places the checker's errors at their spans", () => {
    expect(diagnosticsOf("SUM(orders.nope)", contract, measures)).toEqual([
      { from: 4, to: 15, severity: "error", message: "unknown column orders.nope" },
    ]);
  });

  it("has nothing to say about a valid measure, including references to others", () => {
    expect(diagnosticsOf("DIVIDE([Revenue], [Units])", contract, measures)).toEqual([]);
  });
});
