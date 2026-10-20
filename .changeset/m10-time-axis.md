---
"@adam-riffi/dash-core": patch
---

`validateQuery` refuses a query whose measures use `PREVIOUSPERIOD` or `RUNNINGSUM` unless it has exactly one dimension with a time grain, and names the function and the measure.
