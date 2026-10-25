# 0014 — Map visual and multi-fact queries (M11)

- Status: Accepted
- Date: 2026-10-25
- Proposed by: claude; decided by: Georges (approved the roadmap in ADR 0012 and asked to continue with M11)

## Context
The roadmap (ADR 0012) puts two v1.1 items in M11:
- **The map visual.** The demo's customers carry an ISO 3166-1 alpha-2 country code (`customers.country`).
- **Chasm-trap handling through pre-aggregation** (DESIGN.md §6). In v1, a query whose measures come from two fact tables is refused ("a query has one fact table"), and so is `SUM`, `AVG` or `COUNT` over a looked-up table: the fan-trap guard of ADR 0007, because each looked-up row repeats once per fact row.

ECharts 6 ships no map geometry.

## Decision
**Map:**
- **The plugin:** `map` has a `region` slot (one dimension of alpha-2 codes) and a `value` slot (one measure). It shades countries by value with ECharts' `MapChart` and `VisualMapComponent`.
- **Selection:** clicking a country cross-filters, like a bar.
- **Unknown codes:** the text alternative lists them; they aren't drawn.
- **Geometry:** Natural Earth's 110 m countries (public domain), through `world-atlas`'s TopoJSON (ISC).
  - A dev-time script writes it into `packages/visuals/src/world.ts`, with each feature named by its alpha-2 code (from `i18n-iso-countries`, MIT, dev only).
  - The visual loads it lazily, in its own chunk, and decodes it with `topojson-client` (ISC, about 4 KB). That is the one new runtime dependency.

**Multi-fact queries:**
- **When they apply:** only when the single-fact plan of v1 fails with "a query has one fact table" or with the fan-trap guard. Every query v1 accepts plans and compiles exactly as before.
- **Planning:**
  - each aggregate gets its own fact table: the table its argument reads from which its other tables are reached many-to-one;
  - aggregates are grouped by fact, and each group plans its joins from its fact;
  - every dimension and filter must be reachable from every fact (conformed dimensions); the error names the fact and the field.
- **SQL:**
  - one grouped CTE per fact, `f0…`, each with the row policies of the tables it joins and all of the query's filters;
  - a CTE `k` holding the union of their dimension keys;
  - the facts joined back on the dimensions with a null-safe equality Postgres can hash;
  - the outer query renders each measure over the facts' columns, then sorts (nulls last) and limits.

  Without dimensions, each fact's CTE is one row (`group by ()`), joined `on true`.
- **What it fixes:**
  - two facts by a shared dimension, e.g. revenue (order items) and refunds (returns) by category;
  - a sum over a looked-up table next to the fact's own measures, e.g. order shipping beside item revenue, each at its own grain.
- **Limit for now:** a multi-fact query can't also use `PREVIOUSPERIOD`, `RUNNINGSUM` or `ALL` (ADR 0013), and the planner says so.
- **Demo data:** a second fact table, `dash_demo.returns`, with returned items and refunded amounts. It joins its order item many-to-one, carries the same RLS policy, and gets a host measure, "Refunds".

## Alternatives considered
- **Fetching the map from a CDN at runtime:** less in the package, but hosts would depend on a third party's uptime and their content security policy.
- **Shipping GeoJSON instead of TopoJSON:** no decoder at runtime, but about six times the bytes.
- **A full outer join of the facts on the dimensions:** null dimension values make the join keys awkward. A union of the keys, then left joins, handles them with the same null-safe equality M10 uses.
- **Always planning per fact:** simpler, but it would change the SQL of every query. `COUNTDISTINCT` over a looked-up table by a dimension only reachable through the fact would stop working.

## Consequences
- **What hosts and users get:** one query can compare measures from different facts, and the demo shows revenue against refunds by category.
- **Bundle size:** the map's geometry (about 110 KB) loads only with a map.
- **Error messages:** queries the fan-trap guard refused now answer at each aggregate's own grain. The guard's message remains for aggregates that still have no fact of their own.
