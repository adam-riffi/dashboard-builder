---
"@adam-riffi/dash-core": minor
"@adam-riffi/dash-gateway": patch
---

`planJoins` plans a query whose measures come from several fact tables, or sum a looked-up table that would repeat, one fact at a time: `JoinPlan.facts` lists each fact with its joins, and every dimension and filter must be reachable from each (ADR 0014). Such a query can't use `PREVIOUSPERIOD`, `RUNNINGSUM` or `ALL` yet. Every plan v1 accepted is unchanged. `AGGREGATES` is exported.
