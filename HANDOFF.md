# Handoff — 2026-10-08 · claude

## State
- `main` at the merge of this PR, on top of `83502c1`: fix(demo): a cap on saved dashboards, and refused saves reported (#56). M5 (builder) is merged; CI green.
- Production runs M4 (#43) since 18:54 UTC; each M5 merge deploys again.
- Open PRs: none once this one merges.

## Done this session
- M5 builder, #44–#52 ([ADR 0009](docs/adr/0009-the-host-stores-dashboards.md)):
  - the builder model;
  - field list and wells with drag and drop, plus a click-to-place path;
  - visual picker and 12-column grid;
  - filters editor;
  - CodeMirror measure editor with completions and live errors;
  - the demo's per-user store (`/api/dashboards`, RLS through `app.user_id`) and dashboards page;
  - the Playwright acceptance test and the builder screenshot.
- An independent review of M5 (9 findings, 8 nits) was posted on #52 and fixed in #53–#56:
  - host measure names refused, and specs validated and stamped with the contract version on save;
  - keyboard selection of visuals;
  - previews cached per visual, with queries asked in the same tick batched into one request;
  - the builder's own entry, `@adam-riffi/dash-react/builder`, loaded on demand;
  - at most 20 dashboards per user.
- Production check of M4: the sample dashboard shows live data and `/fixtures/overview` renders.

## Verified
- CI green on every merge, including the builder screenshot against its CI baseline.
- The M5 acceptance test (build, save, reload, reopen, delete) passes in CI against a local Supabase.

## Next
1. Not done yet (usage limit): open https://dashboard-builder-rose.vercel.app and check the builder on production:
   - New dashboard, add a bar, drag Category and Revenue in, Save, reload, Open, Delete.
2. Fix the cold-start hang: on a brand-new deployment, the first `/api/dash/*` requests can hang until the 300 s function limit.
   - Seen 61 times since 2026-10-06; the post-deploy smoke tests flake on it, and rerunning them passes.
   - The pooler showed the connection idle, so the hang is inside the function, before or after the database round trip.
   - Suspects: postgres.js (`max: 1`, no query timeout) on a suspended Fluid instance.
   - A task chip for it was offered in the 2026-10-08 session.
3. M6 (DESIGN.md §9): start in plan mode.

## Needs from Georges
- Approval of the M6 plan when it is proposed.

## Notes
- No local Docker: integration and e2e run in CI. The builder fixture (`/fixtures/builder`), the gallery and the screenshots run locally against a production build of the demo.
- This machine's ports 3000 and 3100 belong to another project (gacha); serve the demo on another port (`next start -p 3200`) and run Playwright with `BASE_URL`.
- Stop a local `next start` by its PID, after checking its command line, before rebuilding, or it serves stale chunks.
- `main`'s ruleset doesn't require up-to-date branches, and merged branches are deleted. After one CI round on a restacked stack, the PRs merge in order without restacking again; squash merges carry only each PR's own changes.
- M6 must key the result cache on the compiled SQL and parameters (ADR 0007). The builder's previews already cache per visual (#54).
