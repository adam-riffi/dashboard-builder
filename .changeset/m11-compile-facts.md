---
"@adam-riffi/dash-gateway": minor
"@adam-riffi/dash-core": minor
---

Queries whose measures come from several fact tables compile: each fact is grouped in its own CTE, with the row policies of the tables it reads and every filter, and the facts are joined on the union of their dimension values (ADR 0014). A measure's value is the one it has queried alone, or null where its fact has no row for those dimensions (a count: 0). `Stage.column` also receives the aggregate it renders.

`planJoins` answers each aggregate on its own table whenever that table reaches every dimension, filter and `CALCULATE` condition, so a measure keeps its value next to others: `COUNTDISTINCT`, `MIN` and `MAX` over a looked-up table are no longer computed over the query's fact table there. Queries with `PREVIOUSPERIOD`, `RUNNINGSUM` or `ALL` keep the single-fact plan.
