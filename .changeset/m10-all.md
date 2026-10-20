---
"@adam-riffi/dash-core": patch
"@adam-riffi/dash-gateway": minor
---

`CALCULATE(m, ALL(field))` compiles for shares of a total (ADR 0013): the total is grouped by the other dimensions in its own CTE, without the filters on that field (policies always apply), and joined back. The checker refuses `ALL` and `PREVIOUSPERIOD` in one measure for now.
