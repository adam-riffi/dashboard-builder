# Agent log

Shared memory for every agent and session in this repository. Newest entry first; at most 40 entries (older ones move to `docs/agent-log/YYYY-MM.md`). Rules: `docs/ENGINEERING.md` §5.

Entry format:

```
## YYYY-MM-DD · <agent> · <branch> · #<PR>
- Done: what changed, in one or two lines.
- Tests: what proves it.
- Scope/decisions: deviations from DESIGN.md, with ADR links.
- Next: the next concrete step, open questions, known issues.
```

---

## 2026-10-05 · claude · stack/m1/04-introspect · #10
- Done: `introspect(sql, tables)` reads tables, columns, keys, `reltuples` and `pg_stats` from `pg_catalog` (not `information_schema`, which hides foreign keys from read-only roles), failing with the names of missing or unreadable tables. CI migrates before the integration suites.
- Tests: golden contracts for `saas`, `graph` and `dash_demo` (as `dash_reader`, row counts nulled) via `toMatchFileSnapshot`; RLS hides `pg_stats` from the reader; missing tables named. Goldens generated and checked against PGlite locally (Docker unavailable); CI runs them on real Postgres.
- Scope/decisions: golden review caught `duration_minutes` averaged ("ratio" inside "duration"); #8 now matches whole snake/camelCase name parts. Domains and other unlisted types are omitted.
- Next: stack/m1/05-auth.

## 2026-10-05 · claude · stack/m1/03-schema-hash · #9
- Done: `schemaHash(catalog, config)` (SHA-256 of canonical JSON of the inferred structure plus the sorted allowlist, statistics excluded) and `inferContract(catalog, config)` returning a `DataContract`.
- Tests: `packages/gateway/test/unit/hash.test.ts`: fast-check properties (hex digest; invariant under table, allowlist and foreign-key order and under statistics; changes with type, nullability, primary key, foreign keys and allowlist; inferred contracts parse with the core schema).
- Scope/decisions: the hash covers inferred roles too, so a change in inference rules also bumps the contract version.
- Next: stack/m1/04-introspect.

## 2026-10-05 · claude · stack/m1/02-inference · #8
- Done: Pure `inferTables(catalog)` in `packages/gateway/src/contract/`: pg type → field type (unsupported types omitted, enums as strings), roles and default aggregations per DESIGN.md §6, distinct estimates from `n_distinct`, high-cardinality dimensions, many-to-one relationships from foreign keys inside the allowlist.
- Tests: `packages/gateway/test/unit/infer.test.ts` (47 cases, 100% lines). Gateway tests split into `test/unit` (`pnpm test`, coverage) and `test/integration`.
- Scope/decisions: tables without supported columns are omitted; sorting is by code point so goldens and hashes do not depend on ICU.
- Next: stack/m1/03-schema-hash.

## 2026-10-05 · claude · stack/m1/01-core-contract · #7
- Done: New `packages/core` (`@adam-riffi/dash-core`) with the zod `DataContract` schema and types; coverage tooling with the 90% line threshold from DESIGN.md §10.
- Tests: `packages/core/test/contract.test.ts` (valid contract, version format, roles/types, aggregation only on measures, schema.table names, relationship columns).
- Scope/decisions: M1 plan (6 PRs): core schema → inference → schema hash → introspection with golden fixtures → JWT auth (ADR 0003, Georges chose auth in M1) → `GET /contract`.
- Next: stack/m1/02-inference.

## 2026-10-05 · claude · main · #1–#6 (merge)
- Done: Georges accepted ADRs 0001–0002 (DESIGN.md §8 updated) and asked to merge the M0 stack. Setup finished: Vercel secrets and env vars, anonymous sign-ins on. PR previews deploy and pass the sign-in and header smoke tests.
- Tests: all six required checks green on every PR. PRs 1–4 predate some required CI jobs, so #6→#2 were squash-merged down into #1 (same tree as the tested #6 head) and #1 went to main through the full required checks; the ruleset was not changed.
- Scope/decisions: M0 lands on main as one squash commit; per-PR history stays on #1–#6.
- Next: health smoke stays 503 until `portfolio-infra` ships `bootstrap.sql` (dash roles, `DASH_SOURCE_URL`, `DASH_APP_DATABASE_URL`, `DATABASE_URL_MIGRATIONS`); the production deploy waits on the same secret. Then M1 (contract).

## 2026-10-05 · claude · stack/m0/03..06 · #3–#6 (review fixes)
- Done: Addressed the independent review. #3: tests for `dash.dashboards` owner-only RLS and Data API denial; RLS settings evaluated once per statement; ADR 0001 (`app.user_id`). #4: generator cut to one order a minute (ADR 0002; was ~0.4 GB at steady state), tick purges its own pg_cron run log, tests pause the cron job and refuse non-local databases, seed runs on any Node 24. #5: CSP/Referrer-Policy/nosniff headers, health failures logged as JSON. #6: smoke now runs on PRs, preview comment found by marker (no longer overwrites the meme), Vercel token passed through env.
- Tests: new RLS, tick and header tests (integration/e2e verified in CI; Docker unavailable locally); headers checked against a local `next start`; actionlint clean.
- Scope/decisions: ADRs 0001 and 0002 are Proposed. Skipped nits: composite FK on order_items, ordered_at index for the purge, `@types/node` 24 pin, gateway coverage tooling (M1), `persist-credentials`, dev-only double sign-in, smoke anonymous users (cleanup job per DESIGN.md §14).
- Next: Georges accepts or rejects ADRs 0001–0002 and does the one-time setup below.

## 2026-10-05 · claude · stack/m0/06-deploy · #6 (setup)
- Done: Triaged failing checks (no code faults). Created Vercel project `dashboard-builder` (team Wuxinggraph, root `apps/demo`, `cdg1`, default Vercel Authentication kept). Repo settings: squash only with PR title, delete head branches, Actions read-only; ruleset `main` (PR, linear history, squash, required checks from DESIGN.md §11). Confirmed the `portfolio` JWKS URL.
- Tests: none (configuration).
- Scope/decisions: `meme` fails until `portfolio-infra` reaches its M4 (`v1` tag); `bootstrap.sql` is its M5.
- Next: Georges sets GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `DATABASE_URL_MIGRATIONS` and the Vercel env vars from DESIGN.md §12; then a different agent reviews PRs 1–6 and Georges merges bottom-up.

## 2026-10-05 · claude · stack/m0/06-deploy · #6
- Done: Mode B `deploy.yml` (migrate + seed on main → Vercel prebuilt deploy, preview URL comment → Playwright `@smoke`); `apps/demo/vercel.json` pinned to `cdg1`; AGENTS.md commands table now describes real scripts.
- Tests: actionlint; the `@smoke` subset from PR 05 runs against each deployment.
- Scope/decisions: smoke check for the seeded sample dashboard waits for M4. Local roles now load through Supabase's seed config.
- Next: M0 acceptance blocked on one-time setup (ENGINEERING.md §16): Vercel project + `VERCEL_*` secrets, bootstrap.sql + `DATABASE_URL_MIGRATIONS`, Vercel env vars, repo settings and ruleset. The pr-meme caller fails until `portfolio-infra` publishes the `v1` tag. Docker Desktop did not start on the dev machine; integration and e2e were verified in CI only.

## 2026-10-05 · claude · stack/m0/05-demo-health · #5
- Done: `@adam-riffi/dash-gateway` `health()`; Next.js demo shell (anonymous sign-in, `/api/dash/health`); local Supabase config; `e2e` CI job (supabase start + Playwright).
- Tests: `packages/gateway/test/health.test.ts` (ok, unreachable → 503 without leaking errors); Playwright `@smoke` sign-in and health.
- Scope/decisions: `@supabase/supabase-js` added for demo auth (not in §6 list). Gateway exports TS source via `transpilePackages` until the M7 release build.
- Next: stack/m0/06-deploy.

## 2026-10-05 · claude · stack/m0/04-seed · #4
- Done: Deterministic idempotent seed (`pnpm db:seed`, SQL with `setseed`) and the `dash_demo_tick` pg_cron job (orders every minute, 90-day retention).
- Tests: `db/test/seed.test.ts`: seed fills all tenants, rerun changes nothing, tick adds orders with items, old orders deleted, job scheduled.
- Scope/decisions: retention deletes all orders older than 90 days, seeded ones included.
- Next: stack/m0/05-demo-health.

## 2026-10-05 · claude · stack/m0/03-db · #3
- Done: First migration (hand-written SQL applied by Drizzle Kit, history table in `dash`): the `dash` and `dash_demo` tables from DESIGN.md §8 with RLS; `integration` CI job on `supabase/postgres:17.11.0.003`.
- Tests: `db/test/rls.test.ts`: dash_reader sees only rows in `app.tenant_ids`, nothing without a scope, and cannot write.
- Scope/decisions: `dash.dashboards` owner-only is enforced for dash_app through `app.user_id` (needs confirmation before M5). Docker Desktop did not start locally, so the integration tests ran in CI only.
- Next: stack/m0/04-seed.

## 2026-10-05 · claude · stack/m0/02-ci · #2
- Done: `ci.yml` with `lint`, `typecheck`, `test` and `build` jobs (read-only permissions, concurrency, 15-minute timeouts, pnpm cache, SHA-pinned third-party actions).
- Tests: actionlint clean; the workflow runs on this PR.
- Scope/decisions: `integration` and `e2e` jobs land with their first tests (PRs 03 and 05).
- Next: stack/m0/03-db.

## 2026-10-05 · claude · stack/m0/01-monorepo · #1
- Done: pnpm + Turborepo workspace, strict TypeScript base config, Biome, Vitest, `.nvmrc`, `.env.example`, pr-meme caller, Dependabot.
- Tests: none (scaffolding); `pnpm check` runs clean with zero packages.
- Scope/decisions: `core`, `react` and `visuals` are created in the milestones that first use them, not as empty shells. Turbo's `agentGuidance` is off so it stops rewriting AGENTS.md.
- Next: stack/m0/02-ci (ci.yml). M0 plan: 01 monorepo, 02 ci, 03 db schemas + RLS, 04 seed + pg_cron, 05 demo shell + health, 06 deploy.

## 2026-10-04 · claude · (none) · (none)
- Done: Repository pack created: DESIGN.md, ENGINEERING.md, AGENTS.md, CLAUDE.md, Copilot instructions, PR template, ADR template.
- Tests: none yet.
- Scope/decisions: stack and hosting as stated in the header of `docs/DESIGN.md`.
- Next: milestone M0 (scaffold) from `docs/DESIGN.md` §9, after the one-time setup in `docs/ENGINEERING.md` §16.
