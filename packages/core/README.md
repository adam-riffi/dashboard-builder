# @adam-riffi/dash-core

The shared core of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder), used by the gateway and the React packages:

- **Schemas** (zod) for the `DataContract`, `QuerySpec`, `QueryRequest` and the stored `DashboardSpec`, with their limits.
- **The formula language:** `lex`, a Pratt `parse`r with `print`, and `check`. `check` types a formula against the contract, inlines `[Measure]` references and reports errors with source spans. Formulas like `DIVIDE([Revenue], [Orders])` compile to SQL in the gateway.
- **Query planning:** `validateQuery` resolves a `QuerySpec` against the contract and `planJoins` finds its fact table and join path. The gateway runs them on every query, and the React package runs them to decide which visuals a selection can filter.

You rarely install it directly: `@adam-riffi/dash-gateway` and `@adam-riffi/dash-react` depend on it.

MIT licensed.
