# Handoff — 2026-10-18 · claude

## State
- `main` at the merge of this PR, on top of `e244d5d`: fix(packages): policies on every table in the docs, Node runtime, ranges and peers (#75). M7 (ship) is merged; CI green; production runs it (deploy and smoke green).
- v1 is complete apart from npm publishing (deferred by Georges) and the CV line (skipped).
- Open PRs: none once this one merges.

## Done this session
- **M7, #71–#75:**
  - publishable packages: builds to `dist` through `publishConfig`, Changesets (first release 0.1.0) and `pnpm check:packages`;
  - package READMEs (host setup in under 20 lines) and the MIT license;
  - the demo's "Try it in a minute" panel;
  - the repository README (ENGINEERING.md §15) with `docs/demo.gif` (`pnpm record-demo`), the architecture and security-model diagrams, and benchmarks.
- **An independent review of M7** (posted on #74): 1 blocker (the panel's text broke an e2e selector) and 4 should-fixes, notably a gateway README example that filtered one table out of three. Fixed in #73 and #75.
- **Repository metadata:** the description, homepage (the live demo) and ten topics are set.
- **Earlier this session:** M6 (#60–#69) and the fix for the hang on fresh deployments (#59, #70).

## Verified
- **Production:**
  - the panel shows six steps;
  - the recorded demo script ran end to end on the live site (build, save, cross-filter, drawer) and deleted its dashboard.
- **GitHub:** the README renders the GIF and both Mermaid diagrams.
- **The hang fix:** across the M7 deploys there was no `request slow` and no timeout. One `database connection replaced` (preview, 16:41 UTC) recovered on its own.

## Definition of done (DESIGN.md §15)
- [x] **Demo script on production.**
- [x] **Isolation and equivalence property tests in CI.**
- [ ] **npm publishing:** deferred. The packages are publishable.
- [x] **README per ENGINEERING.md §15:** with the security-model diagram and latency numbers.
- [ ] **CV line:** skipped by choice.

## Next
1. **Publish to npm**, when Georges wants it:
   - create the npm account or org `adam-riffi` on npmjs.com;
   - pick trusted publishing (link the repo and workflow on each package's page) or an automation token added as the `NPM_TOKEN` Actions secret (GitHub → Settings → Secrets and variables → Actions);
   - then add a release workflow (`changesets/action`), and the first run publishes 0.1.0.
2. **Georges, in the GitHub web UI:** a social preview image (Settings → General → Social preview) and pinning the repository on the profile.
3. **Known limitations:**
   - a selection on a field another visual can't reach turns that visual into an error;
   - after a selection, each refresh is two requests;
   - the result cache is per instance;
   - the demo's own `appDb` (memberships, dashboards) has no read deadline.
4. **v1.1 (DESIGN.md §4):** start in plan mode.

## Needs from Georges
- **npm and GitHub web UI:** the steps above.
- **v1.1:** whether to start it.

## Notes
- **No local Docker:** integration and e2e run in CI. Locally, fixtures, onboarding and screenshots run against a production build on port 3200 (`BASE_URL`); ports 3000 and 3100 belong to another project.
- **Merging a stack:** each PR needs its own CI run after a restack. Waiting on CI in a loop needs Georges' go-ahead per stack in this app.
- **Vercel and logs:** check the last `deploy` run on `main` after merging (daily caps). Runtime logs last one hour on Hobby.
- **`pnpm record-demo`:** writes to production (a guest dashboard) and deletes it. It warns if the deletion did not go through.
