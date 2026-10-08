import {
  type DashboardSpec,
  type DataContract,
  dashboardSpec,
  type QueryAnswer,
  type QueryResult,
  type ResultColumn,
} from "@adam-riffi/dash-core";
import { sampleDashboard } from "../lib/sample-dashboard";

/**
 * A saved spec with recorded answers by visual id (ADR 0008). `pending` never answers; `failed`
 * refuses the whole request, as a gateway answering 401 would.
 */
export interface Fixture {
  spec: DashboardSpec;
  answers: Record<string, QueryAnswer>;
  pending?: boolean;
  failed?: boolean;
}

/** The host measures and their formats, as the demo's contract serves them. */
const column = (
  name: string,
  type: "number" | "string" | "date",
  role: "id" | "time" | "measure" | "dimension",
) => ({
  name,
  pgType: type,
  type,
  nullable: false,
  role,
  ...(role === "measure" ? { aggregation: "SUM" as const } : {}),
  distinct: null,
  highCardinality: false,
});
const table = (name: string, columns: ReturnType<typeof column>[]) => ({
  name: `dash_demo.${name}`,
  rowCount: null,
  primaryKey: ["id"],
  columns,
});

/** The demo's tables and host measures, as its contract serves them (statistics left out). */
export const fixtureContract: DataContract = {
  contractVersion: "0".repeat(64),
  tables: [
    table("order_items", [
      column("id", "number", "id"),
      column("order_id", "number", "id"),
      column("product_id", "number", "id"),
      column("quantity", "number", "measure"),
      column("unit_price", "number", "measure"),
    ]),
    table("orders", [
      column("id", "number", "id"),
      column("customer_id", "number", "id"),
      column("ordered_at", "date", "time"),
      column("status", "string", "dimension"),
      column("channel", "string", "dimension"),
    ]),
    table("products", [
      column("id", "number", "id"),
      column("name", "string", "dimension"),
      column("category", "string", "dimension"),
    ]),
  ],
  relationships: [
    {
      from: { table: "dash_demo.order_items", columns: ["order_id"] },
      to: { table: "dash_demo.orders", columns: ["id"] },
      kind: "many-to-one",
    },
    {
      from: { table: "dash_demo.order_items", columns: ["product_id"] },
      to: { table: "dash_demo.products", columns: ["id"] },
      kind: "many-to-one",
    },
  ],
  measures: [
    {
      name: "Revenue",
      formula: "SUM(order_items.quantity * order_items.unit_price)",
      type: "number",
      format: "currency",
    },
    {
      name: "Orders",
      formula: "COUNTDISTINCT(order_items.order_id)",
      type: "number",
      format: "number",
    },
    {
      name: "Average order value",
      formula: "DIVIDE([Revenue], [Orders])",
      type: "number",
      format: "currency",
    },
  ],
};

const named = (name: string, key = "m0"): ResultColumn => ({
  key,
  kind: "measure",
  type: "number",
  name,
});
const answer = (columns: ResultColumn[], data: unknown[][]): QueryResult => ({
  columns,
  data,
  meta: { cache: "miss", ms: 12, truncated: false },
});
const category: ResultColumn = {
  key: "d0",
  kind: "dimension",
  field: "dash_demo.products.category",
  type: "string",
};
const day: ResultColumn = {
  key: "d0",
  kind: "dimension",
  field: "dash_demo.orders.ordered_at",
  timeGrain: "day",
  type: "date",
};
const product: ResultColumn = {
  key: "d0",
  kind: "dimension",
  field: "dash_demo.products.name",
  type: "string",
};
const units: ResultColumn = {
  key: "m1",
  kind: "measure",
  type: "number",
  field: "dash_demo.order_items.quantity",
  aggregation: "SUM",
};

// Thirty days of orders, ending 2026-10-07, with a weekly rhythm.
const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 8 + i)).toISOString());
const perDay = days.map((_, i) => 58 + ((i * 37) % 17) + (i % 7 === 5 ? 9 : 0));

const products: [string, number, number][] = [
  ["Cast-iron skillet", 18240.5, 304],
  ["Garden kneeler", 15880.2, 529],
  ["Linen apron", 13420.0, 671],
  ["Board game night", 11935.75, 239],
  ["Desk lamp", 10404.0, 204],
  ["Seed starter kit", 9876.45, 451],
  ["Cookbook: Weeknight", 8120.1, 406],
  ["Wireless earbuds", 7999.2, 100],
  ["Puzzle 1000 pieces", 6430.95, 321],
  ["Watering can", 5210.3, 289],
];

const overview: Fixture = {
  spec: sampleDashboard,
  answers: {
    "kpi-revenue": answer([named("Revenue")], [[305386.85]]),
    "kpi-orders": answer([named("Orders")], [[1978]]),
    "kpi-aov": answer([named("Average order value")], [[154.39]]),
    "bar-category": answer(
      [category, named("Revenue")],
      [
        ["Garden", "Kitchen", "Electronics", "Books", "Toys"],
        [83495.78, 77727.75, 53887.44, 50873.08, 39402.8],
      ],
    ),
    "line-orders": answer([day, named("Orders")], [days, perDay]),
    "table-products": answer(
      [product, named("Revenue"), units],
      [products.map((p) => p[0]), products.map((p) => p[1]), products.map((p) => p[2])],
    ),
  },
};

const states: Fixture = {
  spec: dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "States",
    layout: [
      { i: "bar-empty", x: 0, y: 0, w: 6, h: 4 },
      { i: "kpi-broken", x: 6, y: 0, w: 6, h: 2 },
      { i: "pie", x: 6, y: 2, w: 6, h: 2 },
      { i: "kpi-ready", x: 0, y: 4, w: 6, h: 2 },
      { i: "throws", x: 6, y: 4, w: 6, h: 2 },
    ],
    visuals: [
      {
        id: "bar-empty",
        type: "bar",
        title: "Revenue by category, refunded",
        slots: {
          category: [{ field: "dash_demo.products.category" }],
          value: [{ name: "Revenue" }],
        },
      },
      {
        id: "kpi-broken",
        type: "kpi",
        title: "A field the schema lost",
        slots: { value: [{ field: "dash_demo.orders.nope", aggregation: "COUNT" }] },
      },
      { id: "pie", type: "pie", title: "A visual this host lacks", slots: {} },
      { id: "kpi-ready", type: "kpi", slots: { value: [{ name: "Orders" }] } },
      {
        id: "throws",
        type: "throws",
        title: "A renderer with a bug",
        slots: { value: [{ name: "Orders" }] },
      },
    ],
  }),
  answers: {
    "bar-empty": answer([category, named("Revenue")], [[], []]),
    "kpi-broken": { errors: ["dash_demo.orders.nope: unknown column"] },
    "kpi-ready": answer([named("Orders")], [[1978]]),
    throws: answer([named("Orders")], [[1978]]),
  },
};

// Two KPIs side by side, for the states of the whole request.
const pair = (title: string) =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title,
    layout: [
      { i: "kpi-revenue", x: 0, y: 0, w: 6, h: 2 },
      { i: "kpi-orders", x: 6, y: 0, w: 6, h: 2 },
    ],
    visuals: [
      { id: "kpi-revenue", type: "kpi", slots: { value: [{ name: "Revenue" }] } },
      { id: "kpi-orders", type: "kpi", slots: { value: [{ name: "Orders" }] } },
    ],
  });

const loading: Fixture = { spec: pair("Loading"), answers: {}, pending: true };

const failed: Fixture = { spec: pair("Failed"), answers: {}, failed: true };

export const fixtures: Record<string, Fixture> = { overview, states, loading, failed };
