---
"@adam-riffi/dash-gateway": minor
---

Queries whose measures come from several fact tables compile: each fact is grouped in its own CTE, with the row policies of the tables it reads and every filter, and the facts are joined on the union of their dimension values (ADR 0014). A measure's value is the one it has queried alone, or null where its fact has no row for those dimensions. `Stage.column` also receives the aggregate it renders.
