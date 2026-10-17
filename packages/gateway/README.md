# @adam-riffi/dash-gateway

The server half of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder). It lets your app's users build live dashboards on their own data:
- it reads your Postgres tables into a data contract;
- verifies each caller's JWT;
- injects your row policies into every query;
- compiles dashboard queries to SQL, and caches results per security scope.

## Host setup

```ts
// dash.config.ts: secrets from the environment, a read-only database role
import { defineGateway, jwtAuth, memoryCache, postgresSource } from "@adam-riffi/dash-gateway";
import { tenantsOf } from "./tenants"; // your lookup: the tenants this user may see

const tables = ["shop.orders", "shop.order_items", "shop.products"];
export default defineGateway({
  source: postgresSource({ url: process.env.DASH_SOURCE_URL! }),
  auth: jwtAuth({ jwksUrl: process.env.DASH_JWKS_URL!, issuer: process.env.DASH_JWT_ISSUER!, audience: "authenticated" }),
  identity: { claim: "sub", format: "uuid" },
  tables,
  resolveScope: async (claims) => ({ tenantIds: await tenantsOf(String(claims.sub)) }),
  policies: tables.map((table) => ({ table, column: "tenant_id", in: "tenantIds" })),
  cache: memoryCache({ maxBytes: 50_000_000 }),
});

// app/api/dash/[...path]/route.ts: a Node.js route (the default; not the Edge runtime)
import { createGateway } from "@adam-riffi/dash-gateway";
import config from "../../../../dash.config";
export const GET = createGateway(config), POST = GET;
```

- **Policies:** give every allowlisted table that holds tenant rows a policy. A query is filtered only on the tables it joins.
- **Runtime:** the gateway runs on Node.js 20 or later. It uses `node:crypto`, `Buffer` and a TCP connection to Postgres, so it doesn't run on Edge or Workers runtimes.

Then render the builder and viewer from [`@adam-riffi/dash-react`](https://www.npmjs.com/package/@adam-riffi/dash-react).

## HTTP API

| Route | What it does |
| --- | --- |
| `GET /contract` | The tables, columns, relationships and host measures the caller may use. `ETag` is the schema hash. |
| `POST /query` | `{ measures?, queries, maxAgeSec? }` gives one result per query, scoped to the caller. `If-None-Match` with the last `ETag` gets `304`. |
| `GET /health` | `{ status, db }` after `select 1`. |

## Security model

- **Identifiers and values:** identifiers come only from the contract; values are always bound parameters. Queries run read-only, with a 2 s statement timeout.
- **Policies:** each policy adds its predicate to every query that touches its table. The caller's scope also becomes transaction-local `app.*` settings for Postgres row-level security.
- **Result cache:** results are cached under the scope hash, the contract version, and the compiled SQL with its parameters. One scope is never served another's rows, and property tests check it.
- **`explain: true`:** adds the SQL, its parameters and the scope to answers. Use it for development or demo data only.

MIT licensed.
