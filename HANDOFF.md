# Handoff — 2026-10-17 · claude

## State
- `main` at the merge of this PR, on top of the merge of #70 (a database connection whose read never answers is replaced). M5 (builder) and M6 (live and fast) are merged; CI green.
- Production runs all of M6 (deploy of #69 succeeded, smoke included).
- Open PRs: none once this one merges.

## Done this session
- **M5 on production:** after the 2026-10-08 merges capped Vercel's 100 deploys a day, #58 (dependency update, Vercel CLI 63 checked) shipped the rest.
- **The hang on fresh deployments:**
  - #59 logs the stuck stage and caps API routes at 30 s;
  - #70 gives gateway reads a 5 s deadline, replaces the stuck connection and retries once.
- **M6, #60–#69 ([ADR 0010](docs/adr/0010-result-cache-keys-and-freshness.md)):**
  - contract cache; result cache keyed by scope, contract and compiled SQL, fresh within `maxAgeSec`;
  - `304` for unchanged results; interval refresh; the cross-filter coordinator;
  - selectable bars, lines and rows; the "Under the hood" drawer (`explain`, demo only);
  - acceptance e2e and `pnpm bench` (cached p95 15 ms in CI against the 150 ms budget).
- **An independent review of M6** (posted on #67): 1 blocker and 5 should-fixes, fixed in #68 and #69.

## Verified
- **Production, after the M6 merge:**
  - choosing Garden took revenue from $3.17M to $0.99M under a "Category: Garden" chip;
  - the drawer showed scope, SQL and timings;
  - an immediate reload answered every query `cache hit, 0 ms`;
  - Orders went from 11,511 to 11,513 at the next 60 s refresh.
- **The M5 builder on production:** build, save, reload, reopen, delete.

## Next
1. **Watch the next deploys' runtime logs** (Hobby keeps one hour): `database connection replaced` means the fix worked; `request slow` or a 30 s timeout means it did not.
2. **Known M6 limitations:**
   - a selection on a field another visual can't reach turns that visual into an error;
   - after a selection, each refresh is two requests.
3. **M7 (DESIGN.md §9):** start in plan mode. Demo polish, README, GIF, architecture diagram, npm release via Changesets.

## Needs from Georges
- Approval of the M7 plan when it is proposed.

## Notes
- **No local Docker:** integration and e2e run in CI. Fixtures, the builder fixture and screenshots run locally against a production build served on port 3200 (`BASE_URL`); ports 3000 and 3100 belong to another project.
- **Merging a stack:** each PR needs its own CI run after a restack (squash merges conflict otherwise). Waiting on CI in a loop needs the user's go-ahead per stack in this app.
- **Vercel's daily caps:** check the last `deploy` run on `main` after merging.
- **Hobby log retention:** runtime logs last one hour. Read them right after a deploy if something looks wrong.
