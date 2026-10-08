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

## 2026-10-08 · claude · ci/deploy-archive · #42
- Done: `deploy.yml` uploads each prebuilt deploy as one archive (`--archive=tgz`), and gives previews only to ready, non-draft pull requests (`ready_for_review` added to the triggers). DESIGN §11 updated.
- Tests: CI configuration; actionlint is clean. The preview of this PR, once marked ready, and the production deploy after its merge prove the upload.
- Scope/decisions: the M4 merges' production deploys failed on Vercel's free-plan cap of 5,000 file uploads a day ("api-upload-free"), after a day of stacked draft previews; production stayed on #35. Previews for drafts are dropped, a deviation from ENGINEERING §10's "a preview per PR".
- Next: once Vercel accepts uploads again, deploy `main` (M4) and check the sample dashboard on production.

## 2026-10-08 · claude · stack/m4/01..07 · #35–#41 (review fixes)
- Done: addressed the independent review (1 blocker, 2 major, 12 minor, 8 nits; no XSS, nothing sensitive in the fixture route, ECharts loads lazily). Blocker: cards overlapped on phones; cells now come in as CSS variables and cards follow reading order (#39), caught first by the phone screenshot. Majors:
  - `DashProvider` follows the latest `getToken` and rebuilds on transport, gateway or currency changes (#37);
  - charts are drawn once per mount and redrawn only on new options or a color-scheme flip, with memoized formatters (#38, #39).

  Minors:
  - a plugin's throws or invalid queries, and filters past the cap, stay with their visual (#36, #37);
  - an error boundary per visual (#39);
  - answers stay on screen through refreshes (#39);
  - dashboard measures override host formats by name (#39);
  - titles come from the spec (#39);
  - charts carry role=img and a spoken summary (#38);
  - line charts use a time axis (#38);
  - number formatters are built once per column (#38);
  - a failed chart chunk shows a message (#38);
  - the e2e runner is pinned to `ubuntu-24.04` (#41);
  - no retries on 4xx (#37);
  - re-registering a type replaces it (#36);
  - gallery fixtures for a failed request and a throwing renderer (#40).
- Tests: failing tests first for every fix: pure chart options, transport, titles, refreshes, formats, misbehaving plugins, gallery e2e. Unit tests: visuals 47, react 20. Fixture e2e 5/5 locally; screenshot baselines regenerated in CI after the fixes.
- Scope/decisions: renderers keep the raw options (documented in ADR 0008, with the CSP need for the viewer's `<style>`). PR sizes over ~400 lines are noted in their PRs.
- Next: CI green, merge loop #35→#41, `HANDOFF.md`.

## 2026-10-08 · claude · stack/m4/07-visual-tests · #41
- Done: M4 acceptance. `apps/demo/e2e/visual.spec.ts` compares the fixture gallery with screenshot baselines: overview in light and dark, states, loading, and the overview on a 390 px phone. Baselines live in `e2e/__screenshots__` (one set, no platform suffix) and are made on CI's Linux runner. The tests skip elsewhere, since fonts differ. The e2e job uploads new baselines as the `screenshot-baselines` artifact, and they are committed from it.
- Tests: the screenshot tests themselves; tolerance 0.2% of pixels, animations disabled; they skip on Windows locally.
- Scope/decisions: ADR 0008 (CI-generated baselines). To refresh after an intended visual change, delete the baseline and commit the artifact.
- Next: independent review of #35–#41, fixes, merge loop, `HANDOFF.md`.

## 2026-10-08 · claude · stack/m4/06-demo-dashboard · #40
- Done: the home page renders the sample dashboard (`apps/demo/lib/sample-dashboard.ts`): Revenue, Orders and Average order value KPIs, revenue by category, orders by day, and top products, through `DashProvider` with the Supabase session's token. Host measures carry formats (Revenue and Average order value as currency). Public fixture gallery `/fixtures/[name]` (`overview`, `states`, `loading`): recorded answers through the provider's `transport`, no database or sign-in, `noindex`; unknown names are 404. The `--dash-*` CSS variables map to the demo's palette.
- Tests: Playwright: the `@smoke` test expects a ready Revenue KPI with a non-zero dollar amount and a drawn bar chart; `e2e/fixtures.spec.ts` covers six ready visuals and their values, the empty, error and unknown-type states, the loading state, and 404. The fixture tests pass locally against the production build; screenshots in light and dark are on the PR.
- Scope/decisions: the sample spec's contract version is a stand-in until dashboards are saved (M5). Polish found in the gallery went to #38 (compact axis labels, no repeated KPI caption) and #39 (time axes named by grain).
- Next: stack/m4/07-visual-tests (screenshot baselines from CI).

## 2026-10-08 · claude · stack/m4/05-viewer · #39
- Done: `DashboardViewer`: one request for the dashboard; a 12-column grid (72 px rows) that stacks on narrow screens; each visual in its layout cell as a card with a title and its state (loading, "No data for this selection.", errors as an alert, or the plugin's renderer with per-column formatters). Host measure formats come from the contract and are overridden by dashboard measures. Pure `visualState` and `titleOf` (the visual's title, or "Revenue by Category"). Visuals gain an optional `title` in the spec.
- Tests: `packages/react/test/viewer.test.ts`: the five states, titles, and `title` in the spec. The component is covered by the M4 visual tests.
- Scope/decisions: the grid CSS ships in a `<style>` element, since a media query cannot be an inline style (the demo's CSP allows inline styles).
- Next: stack/m4/06-demo-dashboard.

## 2026-10-08 · claude · stack/m4/04-visual-renderers · #38
- Done: renderers for the four built-ins, registered as full plugins. KPI (a monospace numeral; the card title names it) and table (labels, right-aligned numbers, truncation note) in plain React. Horizontal bar and line charts on ECharts (bar, line, grid, legend, tooltip, SVG renderer), imported on first render, with animations off, compact axis labels (`$20K`) and `data-ready` set once drawn. `formatValue` (en-US numbers, currency, percent, dates by grain in UTC, "–" for nulls), `labelOf` (measure name, formula, or words from the field) and `formattersFor` (named measures by their format). Colors come from `--dash-*` CSS variables, which ECharts reads at draw time.
- Tests: `packages/visuals/test/format.test.ts` (21 cases); registry tests now expect renderers. Rendering is checked by the M4 visual tests (PR 7).
- Scope/decisions: renderers get the raw options and one formatter per result column; sorting and limits were already applied by the query.
- Next: stack/m4/05-viewer.

## 2026-10-08 · claude · stack/m4/03-react-provider · #37
- Done: new package `@adam-riffi/dash-react`. `dashboardRequest(spec)` turns a dashboard into one `POST /query` (each visual's `queryOf`, dashboard filters prepended, dashboard measures as request measures), keeping visuals that cannot query out of the request with their reasons. `answersByVisual` maps the answers back by visual id. `DashProvider` (gateway URL and token, or a `transport`; currency; a TanStack Query client), `useContract` and `useDashboardAnswers`.
- Tests: `packages/react/test/request.test.ts`: batched request with measures and filters, unknown types and empty slots kept out, no request without visuals, answers per visual, a missing answer reported. 100% lines on `request.ts`; components are covered by the visual tests (PR 7).
- Scope/decisions: a failed request (401, 429, network) fails the whole dashboard, while per-query errors stay per visual.
- Next: stack/m4/04-visual-renderers.

## 2026-10-08 · claude · stack/m4/02-visual-plugins · #36
- Done: new package `@adam-riffi/dash-visuals`. The plugin contract (slots, an options schema, `toQuery`, and a React `render` in `VisualPlugin`); `checkSlots` (unknown slots, counts, fields vs measures, no grain on measures); `queryOf` (slot and option errors, or the QuerySpec); a module registry (`registerVisual`, `getVisual`, `visuals`); the KPI, bar (top 25 by the first measure), line (time axis at a grain, in time order) and table (top 100) definitions. `ResultColumn`, `QueryResult` and `QueryAnswer` move to core; the gateway's `OutputColumn` is an alias.
- Tests: `packages/visuals/test/plugins.test.ts`: each built-in's query, nine rejected slot and option cases, the registry. 100% lines.
- Scope/decisions: options are typed by `safeParse` only, so visuals with different options share one registry (a zod schema fits).
- Next: stack/m4/03-react-provider.

## 2026-10-08 · claude · stack/m4/01-dashboard-spec · #35
- Done: M4 starts (plan approved). `dashboardSpec` in `packages/core/src/dashboard.ts`: version 1, contract version, title, refresh interval (default 60 s), unique dashboard measures, filters, a 12-column layout with one cell per visual, at most 20 visuals, slots holding fields or measures. `format` (`number`, `currency`, `percent`) on dashboard measures and on host measures (config, contract and version). ADR 0008; DESIGN §7 updated.
- Tests: `packages/core/test/dashboard.test.ts`: defaults, every slot item form, version, hash, title, refresh, formats, duplicate measures and visual ids, layout cells per visual and inside the grid, the visual cap; contract and inference carry formats.
- Scope/decisions: ADR 0008 (React plugins, one request per dashboard, host formats, CI-generated screenshot baselines).
- Next: stack/m4/02-visual-plugins.

## 2026-10-08 · claude · ci/nightly · #34
- Done: `nightly.yml` (daily and by hand): unit and integration suites with `PROPERTY_RUNS_FACTOR=10`, and `pnpm audit --prod --audit-level high`. A vitest setup file in core and gateway sets fast-check's default to 100 cases times the factor; the three tests that pinned their own counts (500, 80, 60) now use it. First `HANDOFF.md`, per the new session protocol (#33). DESIGN §11 nightly row updated.
- Tests: configuration exception to test-first. A throwaway test confirmed 100 runs by default and 1,000 with the factor at 10; unit suites pass at 10×; actionlint is clean.
- Scope/decisions: the audit covers production dependencies only. All 39 advisories over all dependencies sit inside the dev-only `vercel` CLI, with no fixed release. CodeQL already runs through GitHub's default setup.
- Next: run the nightly once by hand, then M4 (viewer) in plan mode.

## 2026-10-06 · claude · stack/m3/01..07 · #22–#29 (review fixes)
- Done: Addressed the independent review (0 blockers, 1 major, 7 minor, 4 nits; no injection or policy bypass). Major: string-typed formula columns (enum, uuid, char) compare as text, so `plans.tier = "pro"` works (#26). #22/#23: exponents in number literals (round trip of 1e-7), numbers out of range rejected, nesting capped at 100 levels. #24: references capped at 16 levels (a chain overflowed the stack), `COUNT` of true/false values refused, `ROUND` digits 0–15. #27: one fact table per query again (per-measure facts rejected Revenue next to `COUNTDISTINCT(orders.customer_id)`; the fan-trap guard covers the risk), 5 errors per measure in responses, one measure memo per request. #28: dashboard measures shadow host measures of the same name instead of a 400; host measures are planned at contract time. #29: a second property arm with orders as the fact table (`/`, DIVIDE, MAX of a date, a customers join). ADR 0007 records each decision.
- Tests: failing tests first for every fix; core 142 and gateway 193 unit tests; enum/uuid formulas and the orders arm ran on PGlite through the real pipeline; mutation check: the orders arm fails when the reference skips the customers policy. Stack rebased onto main (#25).
- Scope/decisions: number literals stay doubles (documented in ADR 0007); the unit test that expected a 400 on a host/dashboard name clash became an integration test of shadowing.
- Next: CI green on all seven, merge loop #22→#29, production screenshot for #28; then the audit follow-ups (nightly.yml) and M4.

## 2026-10-06 · claude · stack/m3/07-formula-properties · #29
- Done: the M2 isolation and equivalence property now draws from five formula measures as well as the column measures: Revenue as a formula and by name (joins products), average units per order with `ROUND(DIVIDE(…, COUNTDISTINCT(orders.id)), 2)`, a conditional `SUM(IF(orders.status = "paid", …))`, and `COUNT(IF(products.category = "Books", …))`. The TypeScript reference joins the tables each formula reads, so their policies apply as in SQL; `fx_iso.products` gains `unit_price`; 80 runs.
- Tests: ran against PGlite locally (no RLS in this fixture, so plain Postgres suffices); mutation checks: a wrong Revenue reference and a reference that skips the products policy (as a planner bug would) both fail with a counterexample. CI authoritative.
- Scope/decisions: none.
- Next: independent review of #22–#29, fixes, CI green, merge loop; production screenshot for #28.

## 2026-10-06 · claude · stack/m3/06-contract-measures · #28
- Done: host measures. `defineGateway({ measures })` (names checked and unique at startup); `inferContract` checks them against the inferred tables, types them and lists them in the contract (`measures: [{ name, formula, type }]`, part of `contractVersion` only when present, so existing versions are unchanged); a host measure that does not check fails the request with a logged 500. `POST /query` resolves names against host and dashboard measures; a dashboard measure with a host name shadows it (review fix, ADR 0007). Demo: Revenue, Orders, Average order value; the page shows revenue by category through `{ name: "Revenue" }`. DESIGN §7 config example and contract row updated (and `resolveScope(claims)` drift fixed).
- Tests: core contract schema; unit hash/inference (types, versioning, unchanged hash without measures, named failure), gateway (startup checks); host measures planned at contract time; integration on `fx_api` (contract serves measures, host and dashboard measures by name, 500 on a bad host measure); goldens gain `"measures": []`; Playwright `@smoke` now expects a dollar amount per category. Demo measures checked and planned against the demo golden contract locally.
- Scope/decisions: no `format` on measures yet (M4 viewer).
- Next: stack/m3/07-formula-properties (formulas in the isolation and equivalence property), then the M3 review and merges.

## 2026-10-06 · claude · stack/m3/05-query-measures · #27
- Done: QuerySpec measures are `{ field, aggregation? } | { formula } | { name }`; `POST /query` takes the dashboard's named measures (`measures`, ≤ 50, unique, names without brackets or surrounding spaces). `validateQuery(spec, contract, named)` checks formulas and names (errors `measures[i]: … (characters a–b)`); the planner gives each measure its own fact table (RELATED-style lookups), requires one per query, and rejects SUM/AVG/COUNT over looked-up tables (fan trap). ADR 0007 records the measure sources, fact-table rule and grammar details; DESIGN §7 updated.
- Tests: core schema (union, names, request measures); validate (formula and named measures, spans, unknown/invalid names); paths (lookups, COUNTDISTINCT allowed, fan guard, one fact table per query, unrelated tables, field-less measures); integration on `fx_exec` (numeric division, DIVIDE by zero, conditional count, ROUND, DATE_TRUNC) and `fx_api` (request measures through `POST /query`, error format). The whole pipeline ran on PGlite with the same expectations.
- Scope/decisions: the fact-table rule is per measure, a refinement of the approved plan that prevents `COUNT(orders.id)` over order items (ADR 0007). The isolation reference is narrowed to column measures until PR 7 adds formulas.
- Next: stack/m3/06-contract-measures (host measures in config and contract, demo revenue by category).

## 2026-10-06 · claude · stack/m3/04-compile-formulas · #26
- Done: `renderFormula` in `packages/gateway/src/query/compile.ts` renders checked formulas as Postgres: every binary operation parenthesized, literals bound with casts (`$n::numeric`, `$n::text`, `$n::int` for ROUND digits), numeric division, `DIVIDE` as `/ nullif(…, 0)`, `IF` as `case`, `COUNTDISTINCT` as `count(distinct …)`. Column measures are now the formula `AGG(field)` (ADR 0006), so every measure takes this path; `ValidMeasure` carries the checked expression, its tables and an echo of the spec for the output columns.
- Tests: `test/unit/compile.test.ts`: golden SQL and parameters for 10 formulas, output columns, and a fast-check property that string and number literals never reach the SQL text; the M2 column-measure goldens are unchanged. The validate test now asserts the new measure shape. Rendered SQL ran on PGlite through postgres.js (7/2 = 3.5, DIVIDE by zero is null, casts resolve).
- Scope/decisions: PR order swapped with the spec PR so each stays green (compile first, then wire formulas into QuerySpec); #24 is 558 lines, explained in its body.
- Next: stack/m3/05-query-measures (QuerySpec formula and named measures, fact-table rule, ADR 0007).

## 2026-10-06 · claude · stack/m3/03-type-check · #24
- Done: `check(source, { contract, measures })` in `packages/core/src/formula/check.ts`: resolves `table.column` (unique across schemas) and `schema.table.column` fields, inlines `[Measure]` references (memoized, cycles named), types every node (number, string, boolean, date) with its level (constant, row, aggregate), checks the 11 functions' arity and argument types, and requires an aggregate top level. Output is the typed tree the gateway will render as SQL.
- Tests: `packages/core/test/formula/check.test.ts`: typed tree, 12 accepted formulas, 36 rejected ones each asserting the exact message and span, multiple errors at once, and a 2^40 measure expansion rejected without being expanded.
- Scope/decisions: formulas expanded through measure references are capped at 1,000 nodes (request-supplied measures must not blow up SQL size); one test expectation was wrong (`MIN` of a boolean is not valid Postgres) and now uses `MAX` of a string.
- Next: stack/m3/04-query-measures (QuerySpec formula and named measures, ADR 0007).

## 2026-10-06 · claude · stack/m3/02-parser · #23
- Done: `parse(source)` in `packages/core/src/formula/parse.ts`: Pratt parser over the lexer's tokens into an `Expr` tree with spans (numbers, strings, `table.column`/`schema.table.column` fields, `[Measure]` references, unary `-`/`NOT`, left-associative binary operators, calls with upper-cased names); the first syntax error is reported at its span (an unclosed `(` points at the parenthesis). `print(expr)` adds only the parentheses precedence needs.
- Tests: `packages/core/test/formula/parse.test.ts`: precedence and associativity in prefix notation, node spans, 13 error spans, printer cases, and the DESIGN §10 round-trip property (fast-check, 500 random trees: `parse(print(tree))` gives the tree back).
- Scope/decisions: arity and function names are left to the type checker so the parser stays grammar-only; `fast-check` added to core's dev dependencies (already used by gateway).
- Next: stack/m3/03-type-check.

## 2026-10-06 · claude · stack/m3/01-lexer · #22
- Done: M3 starts (plan: formulas, named measures from the host config and the dashboard, Georges chose "host + dashboard"). `lex(source)` in `packages/core/src/formula/lex.ts`: numbers, double-quoted strings with `""` escapes, names, `[Measure]` references and operators, each token with its character span; errors carry the span too.
- Tests: `packages/core/test/formula/lex.test.ts` (spans, operators longest first, escapes, whitespace, unterminated string and reference, empty name, unknown character).
- Scope/decisions: no `!=` (use `<>`), no date or boolean literals in v1 formulas.
- Next: stack/m3/02-parser (Pratt parser, printer, round-trip property).

## 2026-10-07 · claude · docs/handoff-steps · pending
- Done: AGENTS.md and the Copilot summary now start every session with `HANDOFF.md` (read it, check it against `main` and the open PRs) and end it by rewriting `HANDOFF.md`, matching ENGINEERING.md §5 from portfolio-infra.
- Tests: Documentation only.
- Scope/decisions: Requested by Georges for every repository; no `HANDOFF.md` exists here yet, so the next session that works here writes the first one.
- Next: Unchanged project work; the next session ends by writing `HANDOFF.md`.

## 2026-10-06 · claude · fix/tick-search-path · pending
- Done: Migration 0003 pins an empty `search_path` on `dash_demo.tick()`, clearing the Supabase advisor warning `function_search_path_mutable` (lint 0011).
- Tests: Red commit adds `db/test/functions.test.ts`: every `dash_demo` function must carry `search_path=""` (live `proconfig` was null), and the tick must still run under it (rolled back). Integration runs in CI; `pnpm check` passes locally.
- Scope/decisions: Ops fix requested from portfolio-infra; no behavior change, since every name in `tick()` is already schema-qualified.
- Next: Merge applies it to production through `deploy.yml`; re-run the Supabase security advisor afterwards.

## 2026-10-06 · codex · codex/m4-dogfood · pending
- Done: Added this documentation-only pull request to dogfood the shared `pr-meme` caller at its released `@v1` tag.
- Tests: M4 acceptance check: the opened PR must receive one automated meme comment within one minute; no product behavior changes.
- Scope/decisions: Configuration/documentation exception to test-first; the existing caller remains byte-for-byte canonical.
- Next: Verify the live comment, review the PR, then merge the dogfood record.

## 2026-10-06 · claude · stack/m2/01..07 · #15–#21 (review fixes)
- Done: Addressed the independent review (no blockers, no injection or leak). #18: boolean `in`/`not_in` bound as text cast to `boolean[]` (postgres.js sent a boolean list as one boolean); sort ties broken by dimensions. #20: policies checked against the allowlist at startup and the contract per request (fail closed), 60 queries/min/user rate limit (DESIGN §13, per instance) with 429 + Retry-After, generic client error for out-of-scope queries, comma-safe RLS scope values, per-query info log with a scope hash; DESIGN §7 response shape. #21: cross-tenant fixture rows and a join-aware reference, so base-only filtering would fail. Nits: request size caps (#15), calendar-valid dates (#16), duplicate FK edges (#17), read-only transactions and a single-connection scope carry-over test (#19).
- Tests: new failing tests first for every fix; unit 163 passing, gateway coverage 92.15%; integration in CI.
- Scope/decisions: rate limit is per function instance (ponytail note; a shared store is v1.1). Skipped: Node TZ dependence of postgres.js date handling (Vercel runs UTC), `tenantsOf` unit tests (demo has no unit runner; covered by e2e), left-join null-FK semantics (fails safe).
- Next: CI green, mark ready, merge #15→#21; then M3 (formulas). Vercel's 100 deployments/day free cap made today's preview deploys fail; the merge deploy may need a retry.

## 2026-10-06 · claude · stack/m2/07-leakage · #21
- Done: M2 acceptance test `test/integration/isolation.test.ts`: fast-check random queries (dimensions from every table incl. day/month grains, SUM/MIN/MAX/COUNT/COUNT DISTINCT, status filters) and random tenant scopes over an `fx_iso` four-tenant fixture without RLS, run as postgres through validate → plan → compile → execute, must equal a TypeScript aggregation of only the scope's rows; an empty scope returns nothing.
- Tests: the property itself (60 runs) plus the empty-scope case; CI authoritative (no local Docker).
- Scope/decisions: running as the table owner without RLS isolates the planner's injected policies as the only protection, which is what the property must prove.
- Next: independent review of #15–#21, fixes, merge; then M3 (formulas).

## 2026-10-06 · claude · stack/m2/06-query-endpoint · #20
- Done: `POST /query` (JWT first, JSON and `queryRequest` checked before any database access, scope from `resolveScope`, per query validate → plan → compile → execute with per-query errors, `private, no-store`); routes declare their methods (405 with Allow); `settingsFor(scope)` maps scope entries to `app.*` RLS settings. Config gains `policies` and `resolveScope`. Demo: tenant policies on all four tables, `tenantsOf` assigns two demo tenants at first sign-in through `dash_app`, page lists units sold by category. CI e2e seeds demo data and has `DASH_APP_DATABASE_URL`.
- Tests: unit (methods, auth before body, 400s without DB, `settingsFor`); integration on an `fx_api` RLS fixture (scoped results, per-query errors, fail-closed scope); Playwright `@smoke` units by category.
- Scope/decisions: queries in one request run sequentially on the instance's single connection; execution errors are logged and returned as "Query failed".
- Next: stack/m2/07-leakage (acceptance).

## 2026-10-06 · claude · stack/m2/05-execute · #19
- Done: `executeQuery(sql, compiled, { limit, settings, timeoutMs })`: one transaction per query with transaction-local `statement_timeout` (2 s default), `TimeZone=UTC` and the RLS settings (`app.tenant_ids`); pure `shapeResult` returns column-major JSON-ready data (numbers from numeric/bigint strings, ISO dates, nulls kept) and drops the extra row to report `truncated`.
- Tests: unit `test/unit/result.test.ts`; integration `test/integration/execute.test.ts` on an `fx_exec` RLS fixture (scoped numbers, RLS without planner policies, truncation, UTC day grains, statement timeout).
- Scope/decisions: settings are local to the transaction, so pooled connections never carry a previous caller's scope. Numbers lose precision past 2^53 (acceptable for dashboards).
- Next: stack/m2/06-query-endpoint.

## 2026-10-06 · claude · stack/m2/04-compile · #18
- Done: `compileQuery(query, plan, policies, scope)`: parameterized Postgres SQL with contract-only quoted identifiers (aliases t0…), `date_trunc` grains from the enum, aggregates (count distinct), left joins on composite keys, a mandatory `column = any($n)` predicate for every query table with a policy (fails closed without the scope list), typed filters, group/order by, `limit` one above the request for truncation; output column descriptors (d0…, m0…).
- Tests: `packages/gateway/test/unit/compile.test.ts`: hand-written expected SQL and params, every operator, fail-closed scope, fast-check property that filter values never reach the SQL text; compile.ts 100% lines.
- Scope/decisions: policies are injected before filters; results default to dimension order for stable output.
- Next: stack/m2/05-execute.

## 2026-10-06 · claude · stack/m2/03-join-paths · #17
- Done: `planJoins(query, contract)` (hand-written core): base = the measures' single fact table; BFS over many-to-one edges counting shortest paths; rejects several fact tables, ambiguous paths (names both relationships), fan-out (reachable only through one-to-many) and unrelated tables; joins ordered nearest first.
- Tests: `packages/gateway/test/unit/paths.test.ts` on the demo and graph golden contracts (multi-hop, composite key, ambiguity at airports, fan-out orders→products, unrelated audit, self reference); paths.ts 100% lines.
- Scope/decisions: self references never become joins in v1 (no table aliases); chasm traps stay v1.1.
- Next: stack/m2/04-compile.

## 2026-10-06 · claude · stack/m2/02-validate · #16
- Done: Pure `validateQuery(spec, contract)`: resolves `schema.table.column` fields, fills the contract's default aggregation and the 10,000-row limit, and reports every problem prefixed with its field (unknown table/column, aggregation vs type, time grains only on dates, typed filter values incl. ISO dates and booleans, sort targets).
- Tests: `packages/gateway/test/unit/validate.test.ts` (demo and saas golden contracts as fixtures); validate.ts 100% lines.
- Scope/decisions: any column may be a dimension; non-measure columns need an explicit aggregation.
- Next: stack/m2/03-join-paths.

## 2026-10-06 · claude · stack/m2/01-query-spec · #15
- Done: `querySpec` and `queryRequest` (zod, `packages/core`): dimensions with time grains, column measures with optional aggregation (ADR 0006), filters with operator arity, sort by dimension/measure index, limit ≤ 10,000, 1–20 queries per request. DESIGN.md §7 updated.
- Tests: `packages/core/test/query.test.ts` (15 cases), core coverage 100%.
- Scope/decisions: M2 plan (7 PRs): spec → validate → join paths → compile with policies → execute with limits → POST /query and demo scope → leakage and equivalence properties (acceptance). Production M0 acceptance reached this session (migrate, seed, deploy, 5/5 smoke on https://dashboard-builder-rose.vercel.app).
- Next: stack/m2/02-validate.

## 2026-10-06 · claude · stack/ops/02-deploy-needs-migrate · #14
- Done: `deploy.yml` deploys production only after `migrate` succeeded (or was skipped on pull requests). A `migrate` job that never got a runner and timed out did not block the deploy before. Session also ran portfolio-infra M5 (bootstrap.sql live on `portfolio`, check.sql 54 rows, 0 mismatches) and merged #13 here.
- Tests: actionlint; the next main deploy exercises it.
- Scope/decisions: none.
- Next: `DATABASE_URL_MIGRATIONS` still fails with "password authentication failed for user postgres" (pooler logs): Georges re-checks the database password in the secret; then migrate, seed, production deploy and smoke ("4 tables available"). Then M2.

## 2026-10-05 · claude · stack/ops/01-history-revoke · #13
- Done: `db/local-roles.sql` mirrors the dash section of portfolio-infra's `bootstrap.sql` (schemas, default privileges), and migration `0002_protect_history` revokes `dash_app` on `dash.__drizzle_migrations` and its sequence.
- Tests: `db/test/rls.test.ts` "migration history is out of reach of dash_app" (red with production-like privileges, green after the migration; checked on PGlite, CI authoritative).
- Scope/decisions: found by the portfolio-infra M5 review (#14 there): default privileges would let the internet-facing role rewrite migration history.
- Next: portfolio-infra M5 merged and bootstrap run on `portfolio`; then the three database secrets and a production deploy.

## 2026-10-05 · claude · stack/m1/02..06 · #8–#12 (review fixes)
- Done: Addressed the independent review (no blockers, 7 should-fix). #8: `percentage` averaged, camelCase `*Id` keys, relationships ordered by target, ADR 0004 (name parts, Proposed). #10: USAGE on the schema required, ADR 0005 (statistics under RLS, Proposed). #11: tokens must carry `exp` (jose only checks it when present), case-insensitive bearer, stateless host regexes, bounded int ids, DESIGN.md §9 M1 row records JWT auth. #12: `/contract` serves no `rowCount`/`distinct` (cross-tenant leak via `reltuples`), RFC 9110 If-None-Match, HEAD, request ids and durations in logs, handler back under the 90% coverage gate with a "no database before auth" test.
- Tests: new failing tests first for every fix; goldens unchanged (rechecked on PGlite); gateway unit coverage 91.6%.
- Scope/decisions: skipped nits: relationship column-length refine (#7), double inference per request and duplicate allowlist entries (#9), partitioned-table stats and domain types (#10), JWKS outage as 503 (#12), last-segment routing (#12).
- Next: Georges accepts or rejects ADRs 0004–0005, then merges #7–#12 bottom-up; then M2.

## 2026-10-05 · claude · stack/m1/06-contract-endpoint · #12
- Done: `defineGateway`, `postgresSource` (lazy, fails loudly on an empty URL), `createGateway` Fetch handler (`/health` public, `/contract` with JWT, ETag/304, 401/404/405/500 with JSON logs). Demo: `dash.config.ts`, catch-all `/api/dash/[...path]`, page shows "N tables available". `jwtAuth` reads its URL lazily (Next evaluates config at build time). Local/CI Supabase signs ES256 from a git-ignored generated key.
- Tests: `test/integration/gateway.test.ts` (health, 401 variants, contract + ETag, 304, 404/405), shared `jwks.ts` helper, unit test for lazy `jwtAuth`, Playwright `@smoke` (4 tables after sign-in, 401 without token). Local `next start` probe without env: 401/500/404/405 as designed.
- Scope/decisions: previews show "Your data is unavailable" until `DASH_SOURCE_URL` exists (bootstrap.sql). M1 acceptance: CI goldens (#10) plus e2e.
- Next: independent review of #7–#12; Georges merges; then M2 (query engine).

## 2026-10-05 · claude · stack/m1/05-auth · #11
- Done: `jwtAuth` (jose, remote JWKS: signature, issuer, audience, expiry) and `authenticate(request, verify, identity)` (bearer token, identity format `uuid`/`int`/regex, fixed 401 messages). ADR 0003: auth in M1 (Georges' decision).
- Tests: `test/unit/auth.test.ts` (header shapes, verifier failures not echoed, each format, missing claim); `test/integration/jwt.test.ts` (local JWKS server, real ES256 tokens: valid, expired, wrong audience/issuer, foreign key, malformed).
- Scope/decisions: `/health` stays public; scopes and row policies stay in M2.
- Next: stack/m1/06-contract-endpoint.

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
