import { type DataContract, dataContract } from "@adam-riffi/dash-core";

type Role = "id" | "measure" | "dimension" | "time";
const column = (name: string, type: "number" | "string" | "date", role: Role) => ({
  name,
  pgType: { number: "int4", string: "text", date: "timestamptz" }[type],
  type,
  nullable: false,
  role,
  ...(role === "measure" ? { aggregation: "SUM" } : {}),
  distinct: null,
  highCardinality: false,
});
const table = (name: string, ...columns: ReturnType<typeof column>[]) => ({
  name,
  rowCount: null,
  primaryKey: ["id"],
  columns: [column("id", "number", "id"), ...columns],
});
const toOne = (from: string, key: string, to: string) => ({
  from: { table: from, columns: [key] },
  to: { table: to, columns: ["id"] },
  kind: "many-to-one",
});

/**
 * Orders, their items and products: from items both orders and products are many-to-one,
 * while orders reach products only through their items (fan-out), so never.
 */
export const shop: DataContract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    table(
      "dash_demo.orders",
      column("status", "string", "dimension"),
      column("ordered_at", "date", "time"),
    ),
    table(
      "dash_demo.order_items",
      column("order_id", "number", "id"),
      column("product_id", "number", "id"),
      column("quantity", "number", "measure"),
    ),
    table("dash_demo.products", column("category", "string", "dimension")),
  ],
  relationships: [
    toOne("dash_demo.order_items", "order_id", "dash_demo.orders"),
    toOne("dash_demo.order_items", "product_id", "dash_demo.products"),
  ],
  measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
});
