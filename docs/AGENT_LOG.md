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

## 2026-10-19 · claude · docs/handoff-m8 · #85
- Done: HANDOFF.md rewritten after M8 (#78–#84 merged; production checked: one request per refresh after a selection, the scatter built, cross-filtered and deleted). The 48 oldest log entries move to `docs/agent-log/2026-10.md` (ENGINEERING.md §5: at most 40 here).
- Tests: none (docs).
- Scope/decisions: #77 (Dependabot) is left for Georges; the next v1.1 milestone is Georges' choice.
- Next: #77; the next v1.1 milestone in plan mode.

## 2026-10-19 · claude · stack/m8/07-scatter · #84
- Done: the `scatter` built-in (ADR 0011): slots `category`, `x`, `y`; option `limit` (1–1,000, default 200); the categories with the largest x first.
  - `scatterOption`: one series in row order, so click and keyboard selection reuse `SelectableChart`; named value axes with compact labels; an item tooltip with the category and both values, HTML-escaped.
  - `ScatterChart` is registered in the lazy ECharts chunk. The builder offers "Add Scatter", a row limit and a 6×5 cell.
  - Demo fixture `scatter` with a screenshot test.
- Tests: written first (the query, slot errors, the limit cap, the registry's five types, the points, axes, escaped tooltip and selection fade). `builder.png` is deleted so CI regenerates it with the new toolbar button; the Linux baselines (`builder.png`, `scatter.png`) are committed from CI's artifact (ADR 0008).
- Scope/decisions: the live demo dashboard is unchanged. Categories without an x sort first under a limit, as in bars and tables (Postgres puts nulls first when descending); `NULLS LAST` in the compiler is a follow-up (M8 review). Changeset (visuals minor, react patch).
- Next: the M8 review, merges, then HANDOFF.

## 2026-10-19 · claude · stack/m8/06-repair-panel · #83
- Done: `RepairPanel` (`packages/react/src/repair.tsx`), shown by the builder under its toolbar while `lostRefs` finds anything (ADR 0011).
  - Each row reads "Replace … with [best replacement] Apply", with "Used by …" under it, and "Remove it" when only slots and filters use the field.
  - Applying goes through `onChange`; the tile previews update, and the panel disappears once nothing is lost.
  - The demo gains a `lost` fixture (saved before `products.product_category` became `category`, with the answers of its repaired spec) and `/fixtures/builder/<name>`.
- Tests: written first. Five component tests (rows and suggestions, apply, remove, nothing to show, inside the builder until all is fixed), and the e2e "the builder repairs a field the schema lost" (passes locally against a production build on port 3200).
- Scope/decisions: the viewer is unchanged; its tiles already show the gateway's error. From the M8 review: a row works out its choice on each render, so after the options change (an aggregation switched, the contract reloaded) Apply uses what the list shows. Each select is described by its "Used by" line, and labels keep the schema when the contract has several. Changeset (react minor); the react README mentions the panel.
- Next: scatter chart (#84).

## 2026-10-19 · claude · stack/m8/05-broken-refs · #82
- Done: `packages/react/src/remap.ts` (ADR 0011):
  - `lostRefs(spec, contract)` lists every table, column or measure the dashboard names and the contract lacks, with each use: slot item, inline formula, filter, dashboard measure.
  - `replacements` ranks what fits every use: by shared name parts, then the lost field's table, then the role the use asks for.
  - `remap` rewrites slots, filters and formula text, or removes slot items and filters.
  - Core exports `resolveField` (the checker's resolver, now telling missing from ambiguous) and the builder's `renameRefs` is exported.
- Tests: written first. 13 table-driven tests on the shop contract: what is found and where; the ranking per use; rewriting keeps aggregations; formulas get full names; fixing every lost reference leaves a valid, clean dashboard.
- Scope/decisions: a lost measure's replacements never include a measure that uses it, directly or through others (no cycles), and name each measure once. A text filter is offered a date column only when its values are dates. In a single-schema contract both spellings of a dropped table's field are one lost reference. These came from the M8 review. Changeset (core and react minor).
- Next: the builder's repair panel (#83).

## 2026-10-19 · claude · stack/m8/04-one-refresh-timer · #81
- Done: `useDashboardAnswers` drops react-query's per-query `refetchInterval` for one interval per dashboard that refetches every query in the same tick, skipped while the page is hidden and leaving a refresh still on its way alone (ADR 0011). A selection used to restart the other visuals' timers, so refreshes went out as two requests.
- Tests: written first in `refresh.test.tsx`: after a selection three seconds in, the next interval sends one request with both queries; a refresh on its way is not asked again (checked to fail without the change).
- Scope/decisions: the README limitation is removed; changeset (react patch).
- Next: find lost fields and rank replacements (#82).

## 2026-10-19 · claude · stack/m8/03-selection-reach · #80
- Done: `dashboardRequest(spec, selections, contract)` adds a selection to a visual only if the visual's query still validates and plans with it (core's `validateQuery` and `planJoins`, ADR 0011). Without the contract, or when the visual fails anyway, it keeps them as before. The viewer passes the contract through `useDashboardAnswers`.
- Tests: written first. Unit tests on a three-table shop contract, a property (a selection is dropped exactly when the visual can't be planned with it) and a viewer test (counting orders stays ready and unfiltered while Garden is selected).
- Scope/decisions: the README limitation is removed; changeset (react patch).
- Next: one refresh timer per dashboard (#81).

## 2026-10-19 · claude · stack/m8/02-planning-in-core · #79
- Done: `validateQuery`, `tablesOf` and `planJoins` move from `packages/gateway/src/query/` to `packages/core/src/plan/` (ADR 0011); the gateway imports them from core. Their tests moved first and keep reading the gateway's golden contracts.
- Tests: core 194 passed (lines 99%); gateway unit 179 passed, lines 93.15% → 90.02% (the moved files now count in core; no test removed). Core's tests get Node types; its build keeps none, so `src` stays browser-safe.
- Scope/decisions: a pure move, no behaviour change; changeset (core minor, gateway patch).
- Next: selections skip visuals that can't reach their field (#80).

## 2026-10-19 · claude · stack/m8/01-design · #78
- Done: ADR 0011 and DESIGN.md §9 add M8 (schema changes), the first v1.1 milestone; §6 states that a selection only filters the visuals that can reach its field.
- Tests: none (docs).
- Scope/decisions: Georges chose "schema changes" first; the rest of v1.1 stays in §4 for later milestones.
- Next: move query validation and join planning to core (#79).

## 2026-10-18 · claude · docs/handoff-m7 · #76
- Done: HANDOFF.md rewritten after M7 (#71–#75 merged; production and the GitHub README checked; repository description, homepage and topics set).
- Tests: none (docs).
- Scope/decisions: npm publishing deferred and the CV line skipped (Georges); the handoff lists the npm steps and the web-UI items left to Georges.
- Next: npm when Georges is ready; v1.1 in plan mode.

## 2026-10-18 · claude · stack/m7/05-review-fixes · #75
- Done: the M7 review's remaining findings (posted on #74; the blocker and the panel nits went into #73).
  - Gateway README and DESIGN.md §7: a policy on every allowlisted table holding tenant rows (a query is filtered only on the tables it joins), and the Node.js runtime is stated; `engines.node >= 20`.
  - React README: `"use client"`, typed props, installing `react-grid-layout` for its stylesheet. dash-react exports the `DashboardSpec` type.
  - Packaging: published dependencies take caret ranges; dash-react declares `react-dom` as a peer.
  - `record-demo.mjs`: the panel is hidden through storage before load; the drawer is found by its role; deletion waits until the dashboard is gone; paths use `fileURLToPath`; the temp folder is removed even on failure; the cut ends before the cleanup. `docs/demo.gif` was re-recorded (12.6 s, 3.1 MB), ending on the drawer.
  - The README's bench numbers link to the run they came from.
- Tests (written first): the package check asserts ranges, the gateway's engine and dash-react's `react-dom` peer.
- Scope/decisions: checking the installed dependency graph (tarballs into a temp project) waits until publishing is set up.
- Next: CI, then merges (CI waits need Georges' go-ahead), the repository description and topics, HANDOFF.

## 2026-10-18 · claude · stack/m7/04-readme · #74
- Done: the repository README (ENGINEERING.md §15 order; M7 PR 4). It has:
  - the pitch, the demo GIF, the live link and the CI and license badges;
  - three reasons it is interesting (scope-safe analytics, the hand-written core, cached p95 15 ms);
  - two Mermaid diagrams (architecture, security model) and notes on the key algorithms;
  - benchmarks (`pnpm bench`'s method and numbers), the testing approach, running locally, the structure, limitations and next steps, and the license.
- `docs/demo.gif` (12.8 s, 3.2 MB): recorded by `apps/demo/scripts/record-demo.mjs` (`pnpm record-demo`) on the production URL. It plays DESIGN.md §3's script: drag Category and Revenue into a new bar, save, click a bar to cross-filter (revenue $2.9M to $1.2M under "Category: Garden"), open "Under the hood". The run deleted its dashboard; the GIF cuts the sign-in and the cleanup.
- Tests: none new (docs, and a script run by hand); the recording itself checked the demo script on production.
- Scope/decisions: the CV line is left out (Georges' choice); npm publishing waits for npm setup.
- Next: the M7 review, merges, the repository description and topics, then HANDOFF.

## 2026-10-18 · claude · stack/m7/03-demo-onboarding · #73
- Done: a "Try it in a minute" panel on the demo's home page (M7 PR 3). It walks through DESIGN.md §3's script:
  - guest tenants, a new dashboard with a bar of Category and Revenue (drag or click-to-place), and save;
  - click a bar to cross-filter, wait for an order, open "Under the hood";
  - plus a link to the source.

  "Hide" is remembered in `localStorage` (safe if storage is blocked). The panel renders after mount, so server and browser agree.
- Tests (written first): `e2e/onboarding.spec.ts`, six steps, the GitHub link, hiding and a reload (also passes locally: the panel needs no sign-in).
- Scope/decisions: the panel sits outside the signed-in session, so it shows even when sign-in fails.
- Review fix (#74's review): the panel's "Under the hood" text broke `live.spec.ts`'s `getByText` in CI. The drawer test now targets the drawer by its role. The panel is named by its heading, "Hide these steps" hands focus to `main`, and the order rate is stated as it is: one a minute across five tenants.
- Next: #74, the repository README with the demo GIF, diagrams and benchmarks.

## 2026-10-18 · claude · stack/m7/02-package-readmes · #72
- Done: package READMEs and the MIT license (M7 PR 2).
  - Gateway: host setup in 17 lines (`dash.config.ts` and the route), the HTTP API and the security model.
  - React: host setup in 17 lines (provider, viewer, builder from `/builder`, the grid CSS) and what each component does.
  - Core: schemas and the formula language. Visuals: the plugin contract with a custom-visual example.
  - Root `LICENSE` (MIT, Adam Riffi), copied into each package so npm ships it.
- Tests (written first): the package check requires README.md and LICENSE in every tarball, and a "Host setup" section of 1–19 code lines for gateway and react (DESIGN.md §15).
- Scope/decisions: package READMEs point to the repository README for the rest (§4 diagrams, benchmarks).
- Next: #73, the try-it panel on the demo.

## 2026-10-18 · claude · stack/m7/01-package-build · #71
- Done: publishable packages and Changesets (M7 PR 1).
  - **Builds:** each package builds to `dist` (`tsconfig.build.json`, `rewriteRelativeImportExtensions`). The workspace keeps exporting `src`; `publishConfig.exports` points npm at `dist` (`types` and `import`, including `@adam-riffi/dash-react/builder`).
  - **Metadata:** no longer private; description, MIT license, repository, homepage, `files: ["dist"]`.
  - **Changesets:** `@changesets/cli` with the four packages versioned together, the demo and db ignored, and a first-release changeset (minor, so 0.1.0). No release workflow: npm isn't set up yet (Georges' choice).
  - **Erasable syntax:** `erasableSyntaxOnly` is on; two parameter properties became plain fields, so Node's type stripping can load the sources.
- Tests: `scripts/check-packages.mjs` (written first; in `pnpm check` and CI's build job) packs every package and checks it is public, with no `workspace:` dependencies, built JS and `.d.ts` for every export, and no sources or tests; core's and gateway's Node entries load.
- Scope/decisions: the React packages are checked by contents only; Node can't load JSX workspace sources.
- Next: #72, package READMEs and the MIT license.

## 2026-10-17 · claude · docs/handoff-m5 · #57
- Done: HANDOFF.md rewritten after M6 (#60–#69 merged and checked on production) and the hang fix (#70).
- Tests: none (docs).
- Scope/decisions: the M5 and M6 merges waited on CI after each restack, with the user's go-ahead per stack.
- Next: watch deploy logs for `database connection replaced`; M7 in plan mode.

## 2026-10-17 · claude · fix/db-deadline · #70
- Done: the cause of the hang on fresh deployments, found with #59's watchdog, and its fix.
  - **Evidence:** on a preview deploy during the M6 merges (dpl_28mtyozW…, 21:37 UTC), six `/contract` and `/query` requests logged `request slow` at stage `contract`, then hit the 30 s cap. The contract's introspection query never answered. The pooler had shown such connections idle (2026-10-08 and 2026-10-17), so a first query through it can be lost. With one connection per instance, every later read waited behind it.
  - **Fix:** gateway reads (contract introspection, queries, health) get a 5 s deadline. A read that misses it gets a new connection (`postgresSource().reset()`) and one more try, logged as `database connection replaced`. Reads are idempotent.
- Tests (written first): a source whose first connection never answers still serves `/contract` once the connection is replaced; `reset` gives a new client; without `reset`, a stuck read fails the request at 5 s instead of hanging. The #59 watchdog test now uses a stuck `resolveScope`, which has no deadline.
- Scope/decisions: the demo's own `appDb` (memberships, dashboards) has no deadline yet; the evidence pointed at the source connection only.
- Next: watch the next deploys for `database connection replaced` and for timeouts.

## 2026-10-17 · claude · stack/m6/10-client-review · #69
- Done: the client findings of the M6 review (posted on #67): 1 (blocker), 4, 5, 6, 11, 12.
  - A visual shows its last answer only while the next is pending. A failed new query (a refused cross-filter, a 429) shows its error, never the unfiltered numbers under the chip.
  - Refresh intervals are at least 2 s per querying visual, keeping refreshes under half the gateway's 60 queries a minute.
  - Selections reset when the viewer gets another spec, and the demo keys the viewer by dashboard.
  - The keyboard picker applies its choice on Enter or blur, not on each arrow key, and resyncs when the selection changes elsewhere.
  - Chips read "Category: Garden" with the axis's formatting.
  - The live e2e polls for at least `count + 1` and deletes its order in `finally`; a new e2e clicks a real bar (the demo script's path).
- Tests (written first): arrow keys don't filter; Enter and blur do; a refused filtered query shows the error; another spec has no selection; a cleared choice never comes back on blur (found while fixing); the refresh budget for three visuals.
- Scope/decisions: findings 3 (unreachable selections) and 8 (two refresh requests after a selection) stay open, recorded in HANDOFF.
- Next: CI, then merge M6 one PR at a time and check it on production.

## 2026-10-17 · claude · stack/m6/09-gateway-review · #68
- Done: the gateway findings of the M6 review (posted on #67): 2, 7, 9, 10.
  - A cache hit answers with the columns of the query it answers: a host measure asked by name and by its inlined formula compile to one SQL and share an entry, but each keeps its own echo (title, format).
  - `resultsTag` includes the scope hash and whether `explain` is on, so a `304` never replays another caller's meta.
  - `memoryCache` documents that `maxBytes` counts JSON bytes.
- Tests (written first): unit, tags differ by scope and by `explain`; integration (CI), name and formula share an entry with their own columns, and scopes differing only in an attribute no policy binds are separate entries.
- Scope/decisions: finding 3 (selections another visual can't reach) is a known limitation, left out of M6; finding 8 (two refresh requests after a selection) is kept.
- Next: #69, the react and demo findings (1, 4, 5, 6, 11, 12).

## 2026-10-17 · claude · stack/m6/08-m6-acceptance · #67
- Done: M6 acceptance (DESIGN.md §9, §10).
  - `e2e/live.spec.ts`:
    - choosing Garden from the bar's keyboard control changes revenue, the bar keeps every category, and the chip restores revenue;
    - a 5 s-refresh dashboard counts an order the test inserts (admin connection, the visitor's tenant) within 15 s;
    - the drawer shows the security context, `Revenue: cache hit|miss, n ms, 1 row` and the SQL, with its screenshot attached.
  - `e2e/bench.spec.ts` (`@bench`, also in `pnpm test:e2e`): 15 uncached and 25 cached Revenue queries from the browser; prints p50 and p95 and fails if cached p95 ≥ 150 ms, under the 60 queries a minute limit.
  - `pnpm bench` runs only the bench; AGENTS.md lists it.
- Tests: the e2e above (CI, local Supabase).
- Scope/decisions: latency is measured in the browser, so it includes the route and authentication, not just the cache.
- Next: an independent review of M6 (#60–#67), fixes, merges, then a production check (cross-filter, an order arriving within a minute, the drawer, `cache: "hit"` in the logs).

## 2026-10-17 · claude · stack/m6/07-under-the-hood · #66
- Done: the "Under the hood" drawer (DESIGN.md §2, §13; M6 PR 7).
  - The gateway's `explain` option (off by default) adds `meta.explain = { sql, params, scope }` to each answer, on a copy, so cached entries stay as executed.
  - `<DashboardViewer underTheHood>` adds a `<details>` drawer: the security context, then each visual's cache status, time, rows, SQL and parameters.
  - The demo turns `explain` on (its own data, as §13 allows) and shows the drawer under its dashboards. The fixture gallery has no drawer, so its screenshots are unchanged.
- Tests (written first): the drawer shows cache hit, time, rows, SQL and scope, and is absent without the prop; integration (CI), `explain` off gives no `meta.explain`, on gives the SQL, the policy's parameters and the scope.
- Scope/decisions: the scope travels in each answer's `meta.explain` rather than a new top-level field; logs still carry only the scope hash.
- Next: #67, M6 acceptance: cross-filter and live-refresh e2e, the drawer, and the cached-latency script.

## 2026-10-17 · claude · stack/m6/06-cross-filter-visuals · #65
- Done: cross-filtering in the viewer (DESIGN.md §6, M6 PR 6).
  - `VisualProps` gains `selected` and `onSelect` (the `events` of DESIGN.md §7's `render(result, options, events)`).
  - Bars and lines select by click (ECharts `click`) or keyboard: a `<select>` per chart, hidden until focused (`.dash-pick`). The table's first-dimension cells become buttons.
  - Highlighting: unselected bars fade to 35%; a selected period's point grows.
  - `DashboardViewer` keeps one selection per visual. It builds each `Selection` from the result's first dimension column (a bucket at its grain for time columns), hands them to the coordinator (#64), and shows a "Clear filter" chip per selection. The builder passes no `onSelect`, so nothing changes there.
- Tests (written first): options highlight bars and points; in the viewer, a keyboard-chosen category filters the KPI but not the bar and its chip clears it; a table row filters the others and shows as pressed.
- Scope/decisions: one value or bucket per visual; picking the same value again clears it.
- Next: #66, the "Under the hood" drawer.

## 2026-10-17 · claude · stack/m6/05-cross-filter-core · #64
- Done: the cross-filter coordinator (DESIGN.md §6, M6 PR 5, hand-written core).
  - `packages/react/src/crossfilter.ts`: `Selection` is one value of a field, or one time bucket at a grain. `filtersOf` makes an equality (`in`) for a value, and `[start, next start)` (`gte` and `lt`, ISO dates, UTC) for a bucket.
  - `dashboardRequest(spec, selections)` adds every other visual's selection to each visual's query; the source visual's query is untouched.
- Tests (written first): table-driven buckets for every grain, including year and month ends and a leap February; value selections; a property test (fast-check, now a react dev dependency with the shared setup) that a visual carries exactly the other visuals' selections.
- Scope/decisions: buckets compile to `gte` and `lt` rather than `between`, which is inclusive at both ends.
- Next: #65, selectable bars, lines and rows, wired into the viewer.

## 2026-10-17 · claude · stack/m6/04-interval-refresh · #63
- Done: saved dashboards refresh on their interval (DESIGN.md §6, M6 PR 4).
  - `useDashboardAnswers(spec, { refresh })` refetches every visual each `refreshIntervalSec` (at least 5 s). The timers line up, so a refresh is one batched request, usually answered `304` (#62).
  - Requests carry `maxAgeSec` = the interval (#61). The batcher never mixes ages.
  - `DashboardViewer` refreshes; the builder's previews don't.
- Tests: `test/refresh.test.tsx` (written first, fake timers): a refresh every interval, one request with `maxAgeSec`; answers stay on screen while a refresh is pending; builder previews never refetch on a timer. The #54 request assertion now includes `maxAgeSec: 60`.
- Scope/decisions: no debounce or jitter; every visual on a page refreshes together.
- Next: #64, the cross-filter coordinator.

## 2026-10-17 · claude · stack/m6/03-query-etag · #62
- Done: `304` for unchanged query results (DESIGN.md §6, M6 PR 3).
  - `POST /query` answers carry an `ETag` from `resultsTag`: the results without timing and cache status. `If-None-Match` with that tag gets `304` and no body.
  - `gatewayTransport` keeps the last tag and results per request body (at most 100) and returns the kept results on `304`.
- Tests (written first): unit, the tag ignores `ms` and `cache` but changes with data, errors and order; transport, a repeated request sends the kept tag and a `304` yields the kept results; integration (CI), a repeated request with the tag gets `304` with the same tag and no body.
- Scope/decisions: `304` answers a `POST`, as DESIGN.md §6 specifies; the client handles it itself, since browsers don't cache POSTs.
- Next: #63, dashboards refresh on their interval.

## 2026-10-17 · claude · stack/m6/02-result-cache · #61
- Done: the result cache (DESIGN.md §6, M6 PR 2; [ADR 0010](adr/0010-result-cache-keys-and-freshness.md)).
  - `packages/gateway/src/cache.ts`: `memoryCache({ maxBytes })` (LRU by JSON size, freshness by the asker's limit), `resultKey` (scope hash, contract version, compiled SQL, parameters), `scopeHashOf` (independent of key order).
  - The gateway checks the cache before executing and reports `meta.cache` hit or miss. `POST /query` takes `maxAgeSec` (5–86,400, default 60).
  - The demo enables a 50 MB cache.
- Tests (written first):
  - unit: freshness, LRU eviction, oversized entries;
  - property tests: the scope always changes the key; any other part changes it too; scope hashes ignore key order; a request's property order never changes the key;
  - integration (CI): a repeated query is a hit and another scope a miss; both isolation properties run every query twice through one shared cache.
- Scope/decisions: key on the compiled SQL rather than the QuerySpec (ADR 0007); freshness travels with the request.
- Next: #62, `304` for unchanged query results.

## 2026-10-17 · claude · stack/m6/01-contract-cache · #60
- Done: the contract cache (DESIGN.md §6, M6 PR 1).
  - `cachedContract` in `packages/gateway/src/contract/cache.ts`: one introspection at a time, shared by concurrent requests; kept 60 s.
  - After 60 s it checks again while the last contract keeps serving; failures are never kept.
  - `/contract` and `/query` share it, so a request no longer introspects the database.
- Tests: `test/unit/contract-cache.test.ts` (written first): concurrent first requests share one load; nothing reloads within 60 s; the stale contract serves while one check runs; a failed first load is retried; a failed later check keeps the last contract and is retried on the next request.
- Scope/decisions: the cache is per function instance (memory), as planned; the fresh-deployment hang (#59) loses its per-request introspection.
- Next: #61, the result cache scoped by security context.

## 2026-10-17 · claude · fix/gateway-hang · #59
- Done: the first step on the hang on fresh deployments.
  - The gateway logs "request slow" with the request's stage (`auth`, `contract`, `scope`, `query`) after 10 s.
  - The demo's API routes stop at 30 s (`maxDuration`) instead of Vercel's 300 s, and the client retries once.
- Tests: unit tests for the slow log by stage, and for no log on requests that finish (fake timers).
- Scope/decisions:
  - Reproduced on the 2026-10-17 production deploy (#58): the smoke run's 3 `contract` requests and 1 `query` hung to 300 s on the fresh deployment.
  - Supavisor saw the killed instance's only connection idle, so they waited outside the database.
  - Locally, a cold postgres.js client (gateway options) under concurrent first queries never hung against PGlite, with or without 70 ms latency.
- Next: read the stage from the next fresh deployment's logs (within an hour; Hobby keeps one), then fix the cause.

## 2026-10-08 · claude · stack/m5/13-dashboard-cap · #56
- Done: the demo's store findings of the M5 review (finding 3 and nits 13, 14, 17).
  - At most 20 dashboards per user; a new one past the cap gets 409, while existing ones still save.
  - PUT refuses an oversized body from its `content-length` (413) before signing in or reading it.
  - The dashboards page opens the viewer only after a save the store accepted. A 409 says to delete one; anything else says the save failed. Opening a vanished dashboard says so and refreshes the list.
  - ADR 0009 (the host stores dashboards) records M5's §7 changes; DESIGN.md §8 now says the host's store sets `app.user_id`.
- Tests: integration (CI): the cap and updates at the cap. e2e: refused saves (404, 409) reported, with the builder still open (CI, signed in); 413 from the declared size (also passes locally).
- Scope/decisions: the cap is per user (`ponytail:` a global quota if anonymous sign-ups are abused).
- Next: CI green on #52–#56, then the M5 merge loop and a production check.

## 2026-10-08 · claude · stack/m5/12-builder-entry · #55
- Done: the builder has its own entry, `@adam-riffi/dash-react/builder` (M5 review finding 9).
  - The main entry keeps the provider and the viewer; the package declares `"sideEffects": false`.
  - The demo loads the builder with `next/dynamic` when someone edits, so the home page's chunks hold no CodeMirror, react-grid-layout or dnd-kit (checked in the build's client manifest).
  - DESIGN.md §7 names the entry.
- Tests: `test/entry.test.ts` (written first) follows the main entry's imports and finds none of the builder's libraries; the builder entry exports `DashboardBuilder`. The builder fixture e2e passes locally.
- Scope/decisions: `@types/node` is now a dev dependency of the react package, for the test that reads its sources.
- Next: #56, a cap on saved dashboards per user (review finding 3), with the demo store's nits and ADR 0009.

## 2026-10-08 · claude · stack/m5/11-builder-previews · #54
- Done: builder previews no longer refetch the whole dashboard on every edit (M5 review finding 2).
  - Each visual's answer is cached under its own query and the dashboard measures that query reaches (`measuresFor`, through the lexer).
  - Queries asked for in the same tick go out as one request (`batched` in the provider), so a dashboard still loads in one (ADR 0008). An edit asks only for the visuals it changed, and a measure no visual uses asks for nothing.
  - Each visual keeps its latest answer on screen while its next one is on the way, so tiles no longer flash to loading.
- Tests: `test/previews.test.tsx` (written first):
  - one request on load;
  - an edited measure asks again for its one visual, with only its measures;
  - a title or an unused measure asks nothing;
  - the answer stays while an edit is asked for;
  - per-visual answers and reasons (ported from the removed `answersByVisual` tests).
- Scope/decisions: `answersByVisual` is removed (no single request to split any more); Rows is not debounced, since one keystroke now refetches one visual.
- Next: #55, the builder's own entry point (review finding 9).

## 2026-10-08 · claude · stack/m5/10-builder-review-fixes · #53
- Done: the builder findings of the M5 review (posted on #52).
  - Measures: a host measure's name is refused (ADR 0007), "New measure" is disabled at 50, formulas are capped at 2,000 characters, names at 100.
  - Save stamps the contract's version and validates the spec; issues show in an alert instead of reaching the host.
  - The dashboard title follows the host's spec unless it is being edited, and the demo keys the builder by dashboard.
  - Each tile title is a "Select X" button, so the wells can be reached from the keyboard.
  - Smaller fixes:
    - Rows takes whole numbers, and clearing it removes the limit;
    - picked measures show as pressed;
    - the layout is clamped to the spec's bounds;
    - a measure rename goes through the lexer, so strings keep their text.
- Tests: unit and component tests for each finding (`builder`, `fields`, `measures`, `canvas`); the fixture builder e2e passes locally.
- Scope/decisions: none.
- Next: #54, builder previews per visual and a separate builder entry point (review findings 2 and 9).

## 2026-10-08 · claude · stack/m5/09-builder-e2e · #52
- Done: the M5 acceptance test and the builder fixture.
  - `/fixtures/builder`: the builder on the overview fixture with recorded answers (no database, no sign-in). Answers are matched by query (`fixture-transport.ts`), so visuals the builder keeps still find theirs.
  - `fixtureContract` now lists the demo's tables and relationships, so the field list has columns to drag.
  - The "Throws" test plugin is registered only by the gallery page, so the builder's picker doesn't offer it.
  - Fixes found by the first CI run:
    - the properties panel is sticky, so wells stay in reach when the field is far down the list (the acceptance drop missed);
    - KPI values shrink with narrow tiles (`clamp(1rem, 14cqi, 2.25rem)`, unchanged at viewer widths);
    - bar value labels hide overlaps;
    - an unset Rows option is empty, not 0.
- Tests: Playwright `e2e/builder.spec.ts`:
  - fixture: drag Category and Revenue into a new bar's wells; write `SUM(order_items.quantity)` with a completion and drag it in; a measure is refused by the Category well;
  - acceptance (CI, with Supabase): new dashboard, build the bar, save, reload, reopen, delete.

  The visual test adds `builder.png` (CI baseline).
- Scope/decisions: the drag helper scrolls the source into view and waits 100 ms after a drop (dnd-kit ignores clicks for 50 ms after one). The test clicks the completion because CodeMirror ignores Enter for 75 ms after the list opens.
- Next: an independent review of M5 (#44–#52), then the merge loop and a production check.
  - Known issue (pre-M5, task suggested): gateway requests on a fresh deployment can hang to the 300 s function limit. The 2026-10-08 production smoke failed that way; production itself is fine once warm.

## 2026-10-08 · claude · stack/m5/08-demo-builder · #51
- Done: the demo's dashboards page (`apps/demo/app/dashboards.tsx`, inside the signed-in session):
  - "Your dashboards" from `/api/dashboards`;
  - "New dashboard" starts from the sample spec with a fresh UUID and opens the builder;
  - Save `PUT`s and switches to the viewer;
  - an open dashboard has Edit, Delete and Close;
  - with nothing open, the sample dashboard shows, as before.

  The layout imports `react-grid-layout/css/styles.css`, which is now a demo dependency.
- Tests: Playwright `e2e/dashboards.spec.ts` (CI, with Supabase): create, rename, save, reload, reopen with live data, delete, gone after reload.
- Scope/decisions: no deep links (state only); the sample stays the default view, so the smoke test still holds.
- Next: stack/m5/09-builder-e2e (M5 acceptance: drag and drop, the formula editor, builder screenshots).

## 2026-10-08 · claude · stack/m5/07-dashboard-store · #50
- Done: the demo stores dashboards (Georges' choice: the host stores them).
  - `apps/demo/lib/dashboards.ts`: `listDashboards`, `getDashboard`, `saveDashboard` (an upsert; another user's id is "forbidden", from the RLS error 42501), `deleteDashboard`, each as `dash_app` in a transaction with `app.user_id` (ADR 0001). `parseSave` returns 413 above 256 KB, 400 for bad JSON or an invalid spec.
  - Route `/api/dashboards[/id]` (GET list or one, PUT, DELETE): the gateway's own `authenticate` (now exported) and the demo's auth config; ids must be UUIDs; `private, no-store`.
- Tests: `db/test/dashboards.test.ts` in the CI integration suite: the owner saves, updates, lists, reads and deletes; another user sees nothing and changes nothing; request parsing. A Playwright `@smoke` test: the route answers 401 without a token.
- Scope/decisions: the route lives in the demo, not the gateway (DESIGN §7). `@adam-riffi/dash-core` is now a dev dependency of `db` for its test.
- Next: stack/m5/08-demo-builder.

## 2026-10-08 · claude · stack/m5/06-formula-editor · #49
- Done:
  - **`<MeasureEditor>`** in the builder's field column: the dashboard's measures with Edit and Remove; a form with name, format and a CodeMirror 6 formula input.
    - Completions: functions, tables, `table.` columns, `[Measure]` names.
    - The checker's errors are underlined at their spans and listed as text.
    - Apply stays off for invalid or duplicate names and for formulas with errors.
    - Renaming rewrites visuals and formulas through `upsertMeasure`.
  - Pure `completionsAt` and `diagnosticsOf` (the editor's sources).
  - Core exports `FUNCTIONS`.
- Tests: `packages/react/test/formula-editor.test.ts`: completion contexts (columns after a dot, names in brackets, functions/tables/keywords, nothing in strings or after numbers) and diagnostics at spans. `packages/react/test/measures.test.tsx`: apply gating, rename with format, errors shown, name rules, removal. CodeMirror runs in jsdom.
- Scope/decisions: CodeMirror 6 (state, view, autocomplete, lint) added (DESIGN §6). The completion implementation landed in the same commit as the editor tests, after its own failing test commit.
- Next: stack/m5/07-dashboard-store.

## 2026-10-08 · claude · stack/m5/05-filters · #48
- Done: `<FiltersEditor spec contract onChange>` in the builder's side panel: the dashboard's filters listed in words ("Status is one of paid, shipped") with "×" to remove; a new filter is drafted (field, operator, typed inputs: number, date, or a comma-separated list) and enters the spec only once complete. `filterFrom` builds a filter from the inputs (calendar-valid dates, finite numbers, true/false, lists only for true/false columns); `inputsOf` turns one back into inputs.
- Tests: `packages/react/test/filters.test.tsx`: 5 built and 5 refused inputs, inputs from a filter, the draft-then-add flow and removal.
- Scope/decisions: filters are added and removed, not edited in place (ponytail); values are typed, not picked from distinct values (planned skip).
- Next: stack/m5/06-formula-editor.

## 2026-10-08 · claude · stack/m5/04-builder-canvas · #47
- Done: `<DashboardBuilder spec onChange onSave>`:
  - a toolbar with the dashboard title (a draft, never blank), "Add" per registered visual, and Save;
  - the field list, with the picked field pressed;
  - a react-grid-layout canvas on the 12-column grid, with drag by the tile header and resize writing `spec.layout`; each tile previews through the viewer's states and has "×" to remove it;
  - a properties panel for the selected visual: title, wells, and the built-in options (bar sort and rows, line grain, table rows).

  Drag ends with dnd-kit's pointer sensor (a 6 px threshold, so clicks still pick). The viewer now shares `useVisualStates` and `VisualContent` with the builder. DESIGN §7 notes the controlled API and the grid stylesheet hosts import.
- Tests: `packages/react/test/canvas.test.tsx`: build a bar from picked fields and save it; title, sort and remove a visual; rename the dashboard.
- Scope/decisions: the options panel knows the built-in visuals only (ponytail; host plugins could describe their options later); `react-grid-layout` 2.3.0 added (DESIGN §6).
- Next: stack/m5/05-filters.

## 2026-10-08 · claude · stack/m5/03-field-wells · #46
- Done: `<SlotWells spec visualId picked onChange>`: one well per slot of the visual's plugin (dnd-kit droppables), listing items with "×" to remove. While a field is dragged, a well is marked `accepts` or `refuses`. A picked field shows "Add … to …", disabled where the well refuses it. `dropFromEvent` turns a drag end into the spec change. Fields in the list are drag sources (pointer only), so Enter and Space stay a pick for keyboard users.
- Tests: `packages/react/test/wells.test.tsx` (DESIGN §10): wells per slot; a picked field updates the spec; refused fields cannot be added; removal; drops from drag events, outside a well, and on a refusing well.
- Scope/decisions: jsdom has no layout for dnd-kit's collision detection, so real dragging is tested by the M5 Playwright test (PR 9); both paths go through `dropItem`.
- Next: stack/m5/04-builder-canvas.

## 2026-10-08 · claude · stack/m5/02-component-tests · #45
- Done: component tests for the react package: jsdom and Testing Library (react, dom, user-event) as dev dependencies, opted into per file (`@vitest-environment jsdom`), so pure tests stay on Node. `<FieldList contract measures onPick>`: a "Measures" group (the host's, then the dashboard's own), then one group per table with its columns as buttons labelled by name and role ("Status, dimension"). Picking hands a `Draggable` to the builder; drag sources come with PR 3.
- Tests: `packages/react/test/fields.test.tsx`: groups and order, labels, picks as a column or a measure.
- Scope/decisions: none.
- Next: stack/m5/03-field-wells.

## 2026-10-08 · claude · stack/m5/01-builder-model · #44
- Done: M5 starts (plan approved; Georges chose host-side storage: `<DashboardBuilder onSave>`, with the demo storing dashboards). Pure builder operations in `packages/react/src/builder.ts`:
  - `accepts`: measure slots take named measures and measure columns, time slots take dates, other slots take non-measure columns under the high-cardinality mark;
  - `addVisual` (unique id, placed below, sized by type, capped at 20) and `removeVisual`;
  - `setVisualTitle`, `setVisualOptions`, and `setLayout` (clamped to 12 columns);
  - `dropItem` (refusals and duplicates change nothing; single-item slots replace; others stop at their max) and `removeItem`;
  - `addFilter`, `setFilter` and `removeFilter`;
  - `upsertMeasure` (renames rewrite slots and other formulas) and `removeMeasure` (drops its slot items).
- Tests: `packages/react/test/builder.test.ts`: 10 acceptance cases, and every operation keeps a spec `dashboardSpec` accepts. 98% lines.
- Scope/decisions: high-cardinality columns are kept out of every field slot (DESIGN §6 says axis slots; tables included for now).
- Next: stack/m5/02-component-tests.
