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

## 2026-10-05 · claude · stack/m0/01-monorepo · (this PR)
- Done: pnpm + Turborepo workspace, strict TypeScript base config, Biome, Vitest, `.nvmrc`, `.env.example`, pr-meme caller, Dependabot.
- Tests: none (scaffolding); `pnpm check` runs clean with zero packages.
- Scope/decisions: `core`, `react` and `visuals` are created in the milestones that first use them, not as empty shells. Turbo's `agentGuidance` is off so it stops rewriting AGENTS.md.
- Next: stack/m0/02-ci (ci.yml). M0 plan: 01 monorepo, 02 ci, 03 db schemas + RLS, 04 seed + pg_cron, 05 demo shell + health, 06 deploy.

## 2026-10-04 · claude · (none) · (none)
- Done: Repository pack created: DESIGN.md, ENGINEERING.md, AGENTS.md, CLAUDE.md, Copilot instructions, PR template, ADR template.
- Tests: none yet.
- Scope/decisions: stack and hosting as stated in the header of `docs/DESIGN.md`.
- Next: milestone M0 (scaffold) from `docs/DESIGN.md` §9, after the one-time setup in `docs/ENGINEERING.md` §16.
