# Handoff — 2026-10-08 · claude

## State
- `main`: #34 (ci: nightly property runs and dependency audit) on top of `a12723e`, test(gateway): formulas in the isolation and equivalence properties (#29). M3 (formulas) is complete; production deploy and smoke green.
- Open PRs: none once #34 merges.

## Done this session
- M3 formulas, stack #22–#29: lexer, Pratt parser and printer, type checker, SQL rendering, formula and named measures in `POST /query`, host measures in the contract, formulas in the isolation property ([ADR 0007](docs/adr/0007-named-measures-and-formula-semantics.md)).
- Independent review of M3: no blockers; the major and all 7 minors addressed before merge (large number literals stay doubles, documented in ADR 0007).
- Nightly workflow (#34): property tests ×10 with the integration suite, and the production dependency audit.

## Verified
- https://dashboard-builder-rose.vercel.app shows revenue by category from the host measure `Revenue` (screenshot on #28); the deploy runs for #28 and #29 passed migrate, deploy and smoke.
- Formula SQL and both isolation property arms ran on PGlite locally; CI ran them on supabase/postgres.

## Next
1. Run the nightly once by hand (Actions → nightly → Run workflow) and fix anything 10× runs find.
2. M4 viewer (DESIGN.md §9): start in plan mode and propose the PR stack: visual registry; KPI, bar, line, table; viewer from a DashboardSpec; loading, empty and error states; visual tests.

## Needs from Georges
- Approval of the M4 plan when it is proposed.

## Notes
- No local Docker on this machine: integration and e2e run in CI; PGlite from a scratch folder (not in the repo) serves quick SQL checks.
- `pnpm audit` over all dependencies reports 39 advisories, all inside the dev-only `vercel` CLI, with no fixed release (63.1.0 too). The nightly gates on production dependencies only.
- Property tests run 100 cases each; `PROPERTY_RUNS_FACTOR` multiplies them.
- M6 must key the result cache on the compiled SQL and parameters, since request measures change results (ADR 0007).
- The `meme` caller now resolves `portfolio-infra@v1`, so new PRs get their automatic meme comment.
