# 0011 — M8: schema changes

- Status: Accepted
- Date: 2026-10-19
- Proposed by: claude; decided by: Georges (chose "schema changes" as the first v1.1 milestone and approved the M8 plan)

## Context
DESIGN.md §4 lists v1.1 but §9 plans no milestone for it. The first slice covers:
- guided remapping of broken fields;
- a scatter visual;
- two v1 limitations:
  - **Unreachable selections:** the cross-filter coordinator adds a selection to every other visual, so a visual whose fact table can't reach the selected field gets the gateway's join error instead of its numbers.
  - **Refresh timers out of step:** each visual's query refreshes on its own timer. A selection restarts every timer except the source visual's, so each refresh interval sends two requests from then on.

## Decision
- **Milestone:** M8 in §9, made of the items in this ADR.
- **Shared planning:**
  - query validation (`validateQuery`, `tablesOf`) and join planning (`planJoins`) move from the gateway to core;
  - they are pure and read only the contract;
  - the browser now uses exactly the gateway's rules, and the gateway still checks every query.
- **Cross-filter reach:** a selection filters another visual only when that visual's query still validates and plans with the selection's filters. A visual that can't use it stays unfiltered. If the visual can't be planned even without the selection, or the contract hasn't loaded, the filters are kept, and the gateway reports the problem as before.
- **One refresh timer:** the viewer refreshes all of a dashboard's queries on one interval per dashboard, paused while the page is hidden, so a refresh is one request.
- **Broken references:**
  - **What counts:** a slot field, a `{ name }` slot item, a field or `[Name]` inside a formula (inline or a dashboard measure), or a dashboard filter field that names a table, column or measure the current contract lacks.
  - **Not covered:** a column whose type changed. The gateway already reports that per visual.
  - **Fields in formulas:** they resolve the way the formula checker resolves them, as `table.column` or `schema.table.column`.
- **Remapping:**
  - The candidates for a lost field are the columns that fit every place it is used:
    - a slot, by the builder's existing rule for what a slot accepts;
    - a filter, by a type that fits its stored values.
  - The candidates for a lost measure are the other measures.
  - **Ranking:** by name parts shared with the lost name (split at `_` and camelCase), then by being in the same table, then in contract order.
  - **Applying:** the user picks one, or "Remove it" when every usage allows removal. The choice rewrites slots, filters and formula text in place.
  - **Where:** in the builder, while anything is broken. The viewer keeps showing the gateway's error in the affected tiles.
- **Scatter:**
  - one dimension (`category`) and two measures (`x`, `y`), plotted as one point per category value;
  - a `limit` option, 1–1,000, default 200;
  - selecting a point cross-filters, like a bar.

## Alternatives considered
- **An "optional" flag on cross-filter clauses, dropped by the gateway when unreachable:** the browser would no longer need the planner, but it changes the wire schema and the cache key for a decision the browser can make with the same code.
- **A reachability check written again in the react package:** smaller, but it would duplicate the ambiguity and fan-out rules and drift from the gateway.
- **Aligning the per-query timers:** keeping every query on the same phase would mean re-keying the source visual on each selection and refetching it for nothing.
- **Fuzzy name matching for candidates:** shared name parts handle renames like `channel` → `sales_channel`, and the user picks from the list anyway.

## Consequences
- **Bundle size:** the react package ships the query validator and join planner (pure TypeScript, a few hundred lines).
- **Unfiltered visuals:** after a selection, a visual that can't reach the field shows unfiltered numbers. The selection chip shows the filter is on.
- **Repair:** a dashboard broken by a schema change can be repaired in the builder without editing JSON. A changed column type still has to be fixed by hand, guided by the tile's error.
