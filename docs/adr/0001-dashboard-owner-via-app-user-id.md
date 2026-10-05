# 0001 — Dashboard ownership through `app.user_id`

- Status: Proposed
- Date: 2026-10-05
- Proposed by: claude; decided by: Georges

## Context
DESIGN.md §8 says `dash.dashboards` is "owner only" under RLS but not how Postgres learns who the user is. The gateway does not use the Supabase Data API: it verifies the user's JWT itself (`DASH_JWKS_URL`) and connects as the login role `dash_app` through the transaction pooler. Supabase's usual `auth.uid()` reads `request.jwt.claims`, which only PostgREST sets.

## Decision
- After verifying the JWT, the gateway runs each request in a transaction and calls `set_config('app.user_id', <sub>, true)`, mirroring `app.tenant_ids` for `dash_reader`.
- The `dashboards_owner` policy (role `dash_app`) compares `owner_id` with that setting in both `using` and `with check`. An unset or empty setting matches nothing, so a missing call fails closed.
- `dash.memberships` stays fully readable and writable by `dash_app`: the server assigns tenants at first sign-in and resolves scopes from it.
- `anon` and `authenticated` get no grants on schema `dash`, so the Data API cannot reach it.

## Alternatives considered
- **Set `request.jwt.claims` and use `auth.uid()`.** Same guarantees, but it ties the gateway to Supabase internals that the embeddable library must not assume.
- **Filter by owner in application code only.** No defense in depth, contrary to DESIGN.md §6.

## Consequences
- Every `dash_app` query must run inside a transaction that sets `app.user_id`; the M5 save/load code needs a helper like `asUser` in `db/test/rls.test.ts`.
- `dash_app` can still read every membership, so scope resolution must stay server-side.
- Tests in `db/test/rls.test.ts` pin the behavior: owner-only reads and writes, nothing without a user, no Data API access.
