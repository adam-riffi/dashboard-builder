# @adam-riffi/dash-core

The shared core of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder), used by the gateway and the React packages:

- **Schemas** (zod) for the `DataContract`, `QuerySpec`, `QueryRequest` and the stored `DashboardSpec`, with their limits.
- **The formula language:** `lex`, a Pratt `parse`r with `print`, and `check`. `check` types a formula against the contract, inlines `[Measure]` references and reports errors with source spans. Formulas like `DIVIDE([Revenue], [Orders])` compile to SQL in the gateway. Other functions:
  - `CALCULATE([Revenue], orders.channel = "web")` evaluates a measure on matching rows only;
  - `CALCULATE([Revenue], ALL(products.category))` gives a total, for shares;
  - `PREVIOUSPERIOD([Revenue])` is the measure for the previous bucket of the time axis;
  - `RUNNINGSUM([Orders])` is a running total.

  The two time functions need a query with one time axis, a date field grouped by day, week, month, quarter or year.
- **Query planning:** `validateQuery` resolves a `QuerySpec` against the contract and `planJoins` finds its fact table and join path. When the measures need several fact tables, `plan.facts` lists each fact with its own joins ([ADR 0014](../../docs/adr/0014-map-and-multi-fact.md)). The gateway runs them on every query, and the React package runs them to decide which visuals a selection can filter.

You rarely install it directly: `@adam-riffi/dash-gateway` and `@adam-riffi/dash-react` depend on it.

MIT licensed.
