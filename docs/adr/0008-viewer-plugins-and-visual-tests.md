# 0008 — Viewer: visual plugins, batched queries, formats and visual tests

- Status: Accepted
- Date: 2026-10-08
- Proposed by: claude; decided by: Georges (approved the M4 plan)

## Context
M4 (DESIGN.md §9) renders saved dashboards. DESIGN.md §7 gives the DashboardSpec, the React API and the visual plugin contract (`render(result, options, events)`), but leaves open:
- what `render` returns;
- how a dashboard's queries reach the gateway;
- where number formats come from for host measures;
- how "saved fixture specs render identically" is checked on a machine without Docker.

## Decision
**Plugins render React.** A plugin's `render` is a React component taking `{ result, options, formatters }`: one formatter per result column, honoring measure formats. Selection `events` arrive with cross-filtering (M6). A plugin's `toQuery` is host code, so a throw or a query the gateway would refuse becomes that visual's error, and an error boundary keeps a failing renderer inside its card. Registering a type again replaces it (Fast Refresh re-runs modules). The four built-ins live in `packages/visuals`:
- KPI and table are plain React.
- Bar and line draw with Apache ECharts, imported dynamically when a chart first renders (DESIGN.md §13). Animations are off.

**One request per dashboard.** The viewer turns every visual into a QuerySpec with `toQuery(slots, options)`, adds the dashboard filters, and sends them in a single `POST /query`, with the dashboard's measures as request measures. Results and errors come back per visual. A dashboard therefore holds at most 20 visuals (`MAX_QUERIES`); the schema enforces it.

**The DashboardSpec is a zod schema in core.**
- A slot holds fields (`{ field, timeGrain? }`) or measures (any QuerySpec measure); the plugin's slot definition says which.
- The layout is a 12-column grid with exactly one cell per visual.
- `refreshIntervalSec` defaults to 60 and is used from M6.

**Formats.** `format: "number" | "currency" | "percent"` sits on dashboard measures, as in DESIGN.md §7, and also on host measures. Host formats go from the config into the contract, so Revenue displays as money on every dashboard. The currency is the provider's (USD by default). A format change is a config change, so it changes `contractVersion`.

**Visual tests run in CI against fixtures.**
- The demo serves `/fixtures/[name]`: fixture specs rendered with recorded results through the provider's `transport`, with no database or auth.
- Playwright `toHaveScreenshot` compares them with baselines.
- Font rendering differs between machines, so baselines come from CI's Linux runner: the first run uploads them as an artifact and they are committed in the same PR.

**Hosts' CSP.** The viewer ships its grid rules in a `<style>` element (a media query cannot be inline), so the host's Content-Security-Policy needs `style-src 'unsafe-inline'`, as Next.js apps already do.

## Alternatives considered
- **Framework-agnostic `render(element, result)`:** every plugin would manage its own DOM lifecycle, and the builder (M5) is React anyway.
- **One request per visual:** simpler caching per visual, but up to 20 round trips per dashboard; the M6 cache keys per query either way.
- **Screenshot baselines from this machine:** would never match CI's fonts.
- **Storybook for the fixtures:** a new dependency for what one route does.

## Consequences
- A plugin is a React component plus a pure `toQuery`. A new chart type needs no change to the viewer or the gateway.
- `transport` makes the viewer testable without a gateway. The builder (M5) can reuse it for previews.
- Screenshot baselines must be regenerated, from CI, whenever a visual's look changes on purpose, and after a Playwright or runner image upgrade. The e2e job runs on a pinned image (`ubuntu-24.04`) so fonts do not drift underneath the baselines.
