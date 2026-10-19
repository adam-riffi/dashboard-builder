# Handoff — 2026-10-19 · claude

## State
- `main` at the merge of this PR, on top of `f0eb416` (#84, the scatter chart). M8 (schema changes), the first v1.1 milestone, is merged; CI is green; production runs it (migrate, deploy and smoke green).
- Open PRs: #77 (Dependabot, 15 updates including Vercel CLI 64) once this one merges.

## Done this session
- **The M7 handoff** (#76).
- **M8, #78–#84 ([ADR 0011](docs/adr/0011-schema-changes-milestone.md)):**
  - query validation and join planning moved to core (#79);
  - a selection skips the visuals that can't reach its field (#80);
  - one refresh timer per dashboard, so one request per refresh after a selection (#81);
  - lost fields and measures found, with ranked replacements and a rewrite (#82);
  - the builder's "Fields this dashboard lost" panel (#83);
  - a scatter visual (#84).
- **An independent review of M8** (posted on #84): 1 blocker (missing Linux baselines), 4 should-fixes (indirect measure cycles, date columns offered to text filters, a stale repair choice, a null-sorting comment) and 10 nits. All were fixed or documented before the merges.

## Verified
- **Production:**
  - after choosing a category, 125 s brought two `POST /query` requests, one per 60 s interval (at 55 s and 115 s);
  - selecting a product in the table filters the bar to its category;
  - a scatter of Revenue against Orders by Category was built in the builder, saved, reopened and cross-filtered ("Category: Garden"), then deleted.
- **CI:** the repair e2e (`/fixtures/builder/lost`) and the scatter screenshot pass.

## Next
1. **#77 (Dependabot):** Vercel CLI 64 keeps every flag the deploy uses, and the required checks are green. Its `deploy` check fails only because Dependabot runs without the deploy secrets, as on #58. The app blocked my merge without review, so it needs Georges' merge or an explicit "merge #77".
2. **Follow-ups found in M8:**
   - `NULLS LAST` in the compiler, so a limit on a bar, table or scatter keeps rows with values first;
   - the gateway's unit-test line coverage is 90.02% (it was 93.15% before the planner moved to core); `gateway.ts` is 75% covered by unit tests and relies on integration tests;
   - the repair panel doesn't report a `table.column` that became ambiguous.
3. **Known limitations:** the result cache is per instance, and the demo's own `appDb` (memberships, dashboards) has no read deadline.
4. **The next v1.1 milestone, in plan mode.** Georges picks among:
   - formula power (time intelligence, `CALCULATE`);
   - bring your own data (CSV, REST/JSON with DuckDB-WASM, Arrow);
   - infra (Redis cache, server-sent events);
   - the map visual.
5. **npm publishing:** when Georges wants it. The steps are unchanged: an npm account or org, then trusted publishing or an `NPM_TOKEN` secret, then a `changesets/action` release workflow. The changesets for M8 are waiting in `.changeset/`.

## Needs from Georges
- #77: merge it, or tell me to.
- Which v1.1 milestone comes next.
- npm, the social preview image and the profile pin (GitHub web UI), when wanted.

## Notes
- **Merging a stack:**
  - `gh pr merge N --squash` without `--delete-branch`: the repository deletes merged branches and retargets the PRs stacked on them, while `--delete-branch` makes GitHub close them;
  - restack each branch from the previous branch's tip before that branch was restacked;
  - wait until `gh pr checks --required` reports checks before watching them.
- **Switching branches locally:** remove `apps/demo/.next/types` first, because route types from another branch's build fail `typecheck`.
- **No local Docker:** integration and e2e run in CI. The fixture pages (`/fixtures/*`, `/fixtures/builder/<name>`) run locally against a production build on port 3200 (`BASE_URL`); ports 3000 and 3100 belong to another project.
- **Visual baselines:** they come from CI's `screenshot-baselines` artifact (ADR 0008). A new or changed baseline fails CI once, then gets committed from the artifact.
