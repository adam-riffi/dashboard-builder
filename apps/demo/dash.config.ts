import { defineGateway, jwtAuth, postgresSource } from "@adam-riffi/dash-gateway";
import { tenantsOf } from "./lib/tenants";

const tables = [
  "dash_demo.orders",
  "dash_demo.order_items",
  "dash_demo.products",
  "dash_demo.customers",
];
/** App data (memberships) as `dash_app`; demo data is read as `dash_reader` through `source`. */
const appDb = postgresSource({ url: process.env.DASH_APP_DATABASE_URL ?? "" });

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
    return { userId, tenantIds: await tenantsOf(appDb(), userId) };
  },
  // Every dashboard can use these (ADR 0007); all three share order_items as their fact table.
  measures: [
    { name: "Revenue", formula: "SUM(order_items.quantity * order_items.unit_price)" },
    { name: "Orders", formula: "COUNTDISTINCT(order_items.order_id)" },
    { name: "Average order value", formula: "DIVIDE([Revenue], [Orders])" },
  ],
});
