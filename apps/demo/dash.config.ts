import {
  defineGateway,
  jwtAuth,
  memoryCache,
  postgresSource,
  withDeadline,
} from "@adam-riffi/dash-gateway";
import { tenantsOf } from "./lib/tenants";

const tables = [
  "dash_demo.orders",
  "dash_demo.order_items",
  "dash_demo.products",
  "dash_demo.customers",
  "dash_demo.returns",
];
/** App data (memberships) as `dash_app`; demo data is read as `dash_reader` through `source`. */
export const appDb = postgresSource({ url: process.env.DASH_APP_DATABASE_URL ?? "" });

/** The demo's gateway (DESIGN.md §7); every value comes from the environment (DESIGN.md §12). */
export default defineGateway({
  source: postgresSource({ url: process.env.DASH_SOURCE_URL ?? "" }),
  auth: jwtAuth({
    jwksUrl: process.env.DASH_JWKS_URL ?? "",
    issuer: process.env.DASH_JWT_ISSUER ?? "",
    audience: "authenticated",
  }),
  identity: { claim: "sub", format: "uuid" },
  tables,
  policies: tables.map((table) => ({ table, column: "tenant_id", in: "tenantIds" })),
  resolveScope: async (claims) => {
    const userId = String(claims.sub);
    // The gateway's own deadline and one retry: a first sign-in's insert is safe to repeat.
    const tenantIds = await withDeadline(appDb, "scope", (sql) => tenantsOf(sql, userId));
    return { userId, tenantIds };
  },
  // Every dashboard can use these (ADR 0007); all but Refunds have order_items as their fact table.
  measures: [
    {
      name: "Revenue",
      formula: "SUM(order_items.quantity * order_items.unit_price)",
      format: "currency",
    },
    { name: "Orders", formula: "COUNTDISTINCT(order_items.order_id)", format: "number" },
    { name: "Average order value", formula: "DIVIDE([Revenue], [Orders])", format: "currency" },
    // M10 (ADR 0013): time intelligence and shares, for a line by day or a table by category.
    {
      name: "Revenue, previous period",
      formula: "PREVIOUSPERIOD([Revenue])",
      format: "currency",
    },
    {
      name: "Revenue growth",
      formula: "[Revenue] - PREVIOUSPERIOD([Revenue])",
      format: "currency",
    },
    { name: "Running orders", formula: "RUNNINGSUM([Orders])", format: "number" },
    {
      name: "Share of revenue",
      formula: "DIVIDE([Revenue], CALCULATE([Revenue], ALL(products.category)))",
      format: "percent",
    },
    // M11 (ADR 0014): a second fact table, so Revenue and Refunds by category are pre-aggregated
    // on order_items and returns, then joined.
    { name: "Refunds", formula: "SUM(returns.refunded_amount)", format: "currency" },
  ],
  // Per function instance; keyed by scope and compiled query (DESIGN.md §6, ADR 0010).
  cache: memoryCache({ maxBytes: 50_000_000 }),
  // The demo's own data, so its SQL may be shown (DESIGN.md §13).
  explain: true,
});
