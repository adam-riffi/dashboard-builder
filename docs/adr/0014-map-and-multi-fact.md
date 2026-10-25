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
- **Planning** (amended after the M11 review):
  - Each aggregate is answered on its own table, the table its argument reads from which its other tables are reached many-to-one, whenever that table reaches every dimension, filter and `CALCULATE` condition. A measure then has the value it has queried alone, whatever the other measures in the visual.
  - Otherwise v1's fact table answers it over its rows, as before. Over a looked-up table that is only allowed for `COUNTDISTINCT`, `MIN` and `MAX` (ADR 0007): the customers who bought in a category, say.
  - Aggregates are grouped by table. One group is v1's single-fact plan; several are planned each from its own fact. Every dimension and filter must be reachable from every fact (conformed dimensions); the error names the fact and the field.
  - Queries with `PREVIOUSPERIOD`, `RUNNINGSUM` or `ALL` keep v1's plan.
- **SQL:**
  - one grouped CTE per fact, `f0…`, each with the row policies of the tables it joins and all of the query's filters;
  - a CTE `k` holding the union of their dimension keys;
  - the facts joined back on the dimensions with a null-safe equality Postgres can hash;
  - the outer query renders each measure over the facts' columns, then sorts (nulls last) and limits. Where a fact has no row for a key that another fact has, its sums are null and its counts 0.

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
- **Per fact only where v1 refused** (this ADR as first accepted): it changed no v1 plan, but a measure's value depended on the other measures. The review found it with the demo: Orders next to Refunds was planned on `returns`, so it counted only the orders that had a return, until Revenue joined the visual and moved Orders to its own table.
- **Always planning on each aggregate's own table:** `COUNTDISTINCT` over a looked-up table by a dimension only reachable through the fact, like customers by category, would stop working.

## Consequences
- **What hosts and users get:** one query can compare measures from different facts, and the demo shows revenue against refunds by category.
- **Bundle size:** the map's geometry (about 110 KB) loads only with a map.
- **Error messages:** queries the fan-trap guard refused now answer at each aggregate's own grain. Its two messages ("a query has one fact table" and "would repeat each of its rows") are gone. An aggregate that can't be answered anywhere gets the reachability error of its own table.
- **Changed v1 plans:** `COUNTDISTINCT`, `MIN` or `MAX` over a looked-up table that reaches every dimension and filter now runs on that table. For example, distinct orders by status count every order, not only the orders that have items. The measure-alone meaning holds for every aggregate that has its own plan.
- **Known ceilings:**
  - An aggregate that falls back to v1's fact table still counts over that table's rows, so which table that is can depend on the other measures.
  - Keys join as text (the M10 `sameKey`), so a type whose equality differs from its text (`citext`, unconstrained `numeric` with trailing zeros) could leave a key's values on two rows.
  - `pnpm bench` has no multi-fact query yet; production timings are checked after the deploy against DESIGN.md §13.
