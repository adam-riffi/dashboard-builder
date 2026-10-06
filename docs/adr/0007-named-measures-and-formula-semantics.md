# 0007 — Named measures and formula semantics

- Status: Accepted
- Date: 2026-10-06
- Proposed by: claude; decided by: Georges (chose "host + dashboard" for named measures when the M3 plan was reviewed; approved the plan)

## Context
M3 adds the formula language (DESIGN.md §6) and the `{ name }` and `{ formula }` measures of §7. Several things are left open by the design:
- where named measures such as the demo's "Revenue" are defined;
- how a formula that reads several tables picks its fact table;
- a few details of the grammar.

The gateway is stateless about dashboards, so it can only resolve a dashboard's measures if the request carries them.

## Decision
**Named measures come from two places.**
- **The host:** `dash.config.ts` `measures: [{ name, formula }]`, served in the contract as `measures: [{ name, formula, type }]` and part of `contractVersion`. The demo defines Revenue, Orders and Average order value, so a new user can use them at once.
- **The dashboard:** `POST /query` takes `{ measures?: [{ name, formula }], queries }`, up to 50 measures with unique names. A dashboard measure may refer to host measures; a name used by both is an error.
- **Names:** a name has no `[` or `]` and no surrounding spaces, so `[Name]` always parses.
- **References:** they are resolved by name, cycles are reported (`circular reference [A] → [B] → [A]`), and an error inside a referenced measure surfaces at the reference as `in [Name]: …`.
- **Size cap:** a formula expanded through its references is capped at 1,000 nodes. The cap is computed on shared nodes, so request-supplied measures cannot blow up SQL size.

**Fact tables.**
- **Per measure:** a measure's fact table is the one of its tables from which the others are reached through many-to-one relationships. Row expressions are evaluated per fact-table row, with other tables looked up (like Power BI's `RELATED`), e.g. `SUM(order_items.quantity * products.unit_price)`.
- **Per query:** all measures of a query share one fact table, which becomes the base of the join plan. Measures that read no column (`COUNT(1)`) take the query's fact table; a query needs at least one measure that reads a column.
- **Fan-trap guard:** `SUM`, `AVG` and `COUNT` whose argument reads only looked-up tables are rejected, because each looked-up row repeats once per fact row. `COUNTDISTINCT`, `MIN` and `MAX` are insensitive to repeats and stay allowed (`SUM(order_items.quantity) / COUNTDISTINCT(orders.id)` is average units per order).

**Grammar and SQL details.**
- Strings use double quotes with `""` as the escape (DAX style).
- Fields are `table.column`, where the table name must be unique across the allowlist, or `schema.table.column`.
- `<>` is the only not-equal operator; there are no date or boolean literals in v1, since filters cover date ranges.
- The checker's output, a resolved and typed tree, is the SQL expression tree that the gateway renders for Postgres. A separate SQL AST would have one dialect and no second user; DuckDB in v1.1 renders the same tree.
- Literals are bound parameters with casts. `/` divides as numeric (no integer truncation), and `DIVIDE(a, b)` is `a / nullif(b, 0)`.
- API errors name the measure and, for a formula sent in the query, the characters: `measures[1]: unknown column orders.nope (characters 4–15)`.

## Alternatives considered
- **Dashboard measures only, with a starter dashboard providing Revenue:** less code, but the contract would not describe the host's business measures, and every dashboard would copy them.
- **Host measures only, with dashboard measures inlined as `{ formula }`:** dashboard measures could not refer to each other, and the client would need to expand references itself.
- **One fact table per query, as in M2, where a query's measures could span looked-up tables:** this allows `COUNT(orders.id)` over order items, which counts items, not orders.

## Consequences
- The M6 result cache key must cover the request's named measures, for example by hashing the compiled SQL and parameters rather than the raw QuerySpec.
- The M5 measure editor runs the same `check` in the browser (it lives in `core`) for live error spans.
- Chasm traps across two fact tables stay v1.1 (DESIGN.md §6).
