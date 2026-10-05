# 0004 — Match averaged measure names and key names on whole name parts

- Status: Accepted
- Date: 2026-10-05
- Proposed by: claude; decided by: Georges (accepted on 2026-10-05 after the M1 review)

## Context
DESIGN.md §6 averages a measure "when the name matches `price|rate|ratio|pct|percent|score`" and treats "names ending in `_id`" as keys.

Read as a substring match, the averaging rule misfires: the golden contracts in #10 showed `duration_minutes` averaged, because "du**ratio**n" contains `ratio`. Names like `accurate_count`, `operators` and `scoreboard_rows` misfire the same way. Meanwhile the key rule misses camelCase keys such as `customerId`, which then become summed measures.

## Decision
- Split column names into lowercased parts at `_` and at camelCase boundaries, and drop a trailing `s` (`exchange_rates` → `exchange`, `rate`).
- A measure is averaged when any part is one of `price`, `rate`, `ratio`, `pct`, `percent`, `percentage` or `score`.
- A column is a key when its last part is `id` (`customer_id`, `customerId`, `id`), in addition to primary and foreign keys.

## Alternatives considered
- **Substring match, as written.** It keeps the `duration` false positive and others like it.
- **Prefix or suffix match on parts.** It catches run-together names like `unitprice`, but reintroduces `accurate` → `rate` and `scoreboard` → `score`.

## Consequences
- Run-together names without a separator (`unitprice`) are summed. A host can rename the column or, once DashboardSpec measures exist (M3), define the measure explicitly.
- DESIGN.md §6 describes whole-part matching.
