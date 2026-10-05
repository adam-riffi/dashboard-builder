import { defineGateway, jwtAuth, postgresSource } from "@adam-riffi/dash-gateway";

/** The demo's gateway (DESIGN.md §7); every value comes from the environment (DESIGN.md §12). */
export default defineGateway({
  source: postgresSource({ url: process.env.DASH_SOURCE_URL ?? "" }),
  auth: jwtAuth({
    jwksUrl: process.env.DASH_JWKS_URL ?? "",
    issuer: process.env.DASH_JWT_ISSUER ?? "",
    audience: "authenticated",
  }),
  identity: { claim: "sub", format: "uuid" },
  tables: [
    "dash_demo.orders",
    "dash_demo.order_items",
    "dash_demo.products",
    "dash_demo.customers",
  ],
});
