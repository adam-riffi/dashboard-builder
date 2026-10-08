# Handoff — 2026-10-08 · claude

## State
- `main` at the merge of this PR, on top of `41168b3`: ci(deploy): one archive per deploy, previews for ready pull requests (#42). M4 (viewer) is merged; CI green.
- **Production is still on #35** (healthy). The deploys for #36–#42 hit Vercel's free-plan daily caps (5,000 uploads, then 100 deployments). A background retry re-runs the latest `deploy` run on `main` every 30 minutes until Vercel's 24-hour window resets.
- Open PRs: none once this one merges.

## Done this session
- M3 formulas, #22–#29 ([ADR 0007](docs/adr/0007-named-measures-and-formula-semantics.md)); nightly workflow, #34.
- M4 viewer, #35–#41 ([ADR 0008](docs/adr/0008-viewer-plugins-and-visual-tests.md)): DashboardSpec and measure formats; `packages/visuals` (plugins, registry, KPI, bar, line, table on lazily loaded ECharts); `packages/react` (`DashProvider`, one request per dashboard, `DashboardViewer` with loading, empty and error states); sample dashboard on the home page; public fixture gallery `/fixtures/[name]`; six screenshot tests.
- An independent review of M4 (1 blocker, 2 majors, 12 minors) was fixed before merging.
- #42: deploys upload one archive; drafts get no preview.

## Verified
- CI green on every merge, including the six screenshot comparisons against baselines made on the pinned `ubuntu-24.04` runner.
- #42's preview deployed with the archive upload and passed smoke.
- The first nightly run (10× property runs, production audit) passed.

## Next
1. When the retry deploys `main`, open https://dashboard-builder-rose.vercel.app: the sample dashboard should show live revenue, and `/fixtures/overview` should render. If the retry stopped, re-run the latest failed `deploy` run on `main`.
2. M5 builder (DESIGN.md §9): start in plan mode. Visual picker, field wells with drag and drop (dnd-kit), filters, grid layout (react-grid-layout), formula editor with autocomplete (CodeMirror 6, `check` from core), save and load in `dash.dashboards` (RLS via `app.user_id`).

## Needs from Georges
- Approval of the M5 plan when it is proposed.

## Notes
- No local Docker: integration and e2e run in CI. The fixture e2e and screenshots can run locally against `pnpm --filter @dash/demo build` (no database needed); screenshot tests skip off Linux.
- Screenshot baselines come from CI: delete a baseline, push, download the `screenshot-baselines` artifact, check it by eye, commit it.
- On Windows, stop a local `next start` by port (`netstat -ano`, `taskkill //PID … //F`) before rebuilding, or it serves stale chunks.
- `pnpm audit` over all dependencies flags only the dev-only `vercel` CLI; the nightly gates on production dependencies.
- M6 must key the result cache on the compiled SQL and parameters (ADR 0007).
