# 0013 — Formula language additions (M10)

- Status: Accepted
- Date: 2026-10-20
- Proposed by: claude; decided by: Georges (approved the M10 plan)

## Context
DESIGN.md §4 lists time intelligence (`PREVIOUSPERIOD`, running totals) and `CALCULATE`-style filter changes for v1.1. §14 asks for an ADR for every grammar addition.

The v1 compiler renders one flat statement: select, joins, where, group by, order, limit. A measure is one expression over the grouped rows. Comparing a bucket with the previous one, summing across buckets, or computing a total at a coarser grain needs more than one grouped query.

## Decision
**Four functions** (all upper case, like the others):

| Formula | Means |
| --- | --- |
| `CALCULATE(m, condition, …)` | `m` evaluated on the rows that also meet every condition |
| `CALCULATE(m, ALL(field))` | `m` ignoring the grouping and the filters on `field`: a total, for shares |
| `PREVIOUSPERIOD(m)` | `m` for the previous bucket of the query's time axis |
| `RUNNINGSUM(m)` | the sum of `m` over the time axis up to each bucket, per combination of the other dimensions |

**Typing:**
- **Arguments:** `m` must be aggregate-level. `PREVIOUSPERIOD` and `CALCULATE` keep its type, and `RUNNINGSUM` needs a number. All four are aggregate-level, so they combine with other aggregates: `[Revenue] - PREVIOUSPERIOD([Revenue])`.
- **Conditions:** a `CALCULATE` condition is a row-level or constant true/false value, or `ALL(field)`. `ALL` takes one field and is only allowed as a `CALCULATE` condition.
- **Nesting:**
  - `PREVIOUSPERIOD` and `RUNNINGSUM` don't nest inside each other.
  - `CALCULATE` nests with anything, and nested conditions are ANDed. The one exception: `ALL` and `PREVIOUSPERIOD` can't be in the same measure yet, because a previous period of a total would need the total over the previous window too.
  - An aggregate can't contain one of the four (the existing nesting rule).

**The time axis:** a query whose measures use `PREVIOUSPERIOD` or `RUNNINGSUM` needs exactly one dimension with a time grain. The check is in core's `validateQuery`, so the builder's tiles and the gateway report it the same way. A KPI can't use them.

**Filters:**
- **Conditions:** `CALCULATE`'s conditions add to the query's filters, and its row policies always apply.
- **`ALL(field)`:** removes the grouping and the query's filters on that field only. Policies are never removed, and neither are the conditions of an outer `CALCULATE` on the same field, which still filter the total. (Power BI's DAX would lift those too.)
- **`PREVIOUSPERIOD`:** reads the previous bucket even when a filter on the time axis's column cuts it off. Those filters are applied to the column moved one grain later, so they select the previous window.
- **`RUNNINGSUM`:** starts at the first bucket inside the filters.

**SQL:**
- **Single stage:** `CALCULATE` with conditions only renders each aggregate inside it as `agg(x) filter (where …)`. The query stays one statement, so queries without the new functions compile exactly as before, with the same cache keys.
- **Two stages:** queries using `PREVIOUSPERIOD`, `RUNNINGSUM` or `ALL` compile to a grouped CTE `g`, in which every aggregate, with its filter context, becomes a column. An outer query then renders the rest of each measure over those columns:
  - **`PREVIOUSPERIOD`:** reads a second grouped CTE over the shifted window, joined on the time bucket one grain later and the other dimensions (`is not distinct from`). `lag()` would pick the wrong row when a bucket has no data.
  - **`RUNNINGSUM`:** a window, `sum(…) over (partition by <other dimensions> order by <time> rows between unbounded preceding and current row)`.
  - **`ALL(field)`:** a CTE grouped by the remaining dimensions, without the filters on that field, joined back on them.
  - **Sort and limit:** sorting (nulls last) and the limit happen in the outer query, so windows see every bucket.
- **Safety:** every CTE carries the row policies. Grains, aliases and identifiers come from the contract or fixed enums, and values are bound parameters.

## Alternatives considered
- **`lag()` for `PREVIOUSPERIOD`:** shorter SQL, but wrong across buckets without rows, and blind to the bucket before a filtered window.
- **Window functions over the grouped rows for shares:** right only for additive aggregates (`SUM`, `COUNT`), wrong for `AVG` and `COUNTDISTINCT`. A coarser-grain aggregate is right for all of them.
- **Always two stages:** simpler code, but every existing query's SQL, and so every cache entry, would change.

## Consequences
- **What hosts and users can write:** growth (`[Revenue] - PREVIOUSPERIOD([Revenue])`), period-over-period ratios, running totals and shares of a total.
- **Empty buckets:** a bucket without data shows no row, as before. Its `PREVIOUSPERIOD` neighbour compares with nothing (null).
- **More time functions** (`SAMEPERIODLASTYEAR`, `YTD`) and `ALL()` without a field are not included; each needs its own ADR.
- **M11's chasm traps** reuse the same multi-CTE compile.
