---
"@adam-riffi/dash-gateway": minor
---

`CALCULATE(m, condition, …)` compiles: every aggregate inside gets the conditions as `filter (where …)`, nested `CALCULATE`s join theirs, and the query stays one statement (ADR 0013).
