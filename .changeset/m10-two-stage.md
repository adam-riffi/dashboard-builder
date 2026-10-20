---
"@adam-riffi/dash-gateway": minor
---

`PREVIOUSPERIOD` and `RUNNINGSUM` compile (ADR 0013): a grouped CTE holds the aggregates, a second one the previous window (with the time axis's filters shifted back one bucket, joined on the bucket one grain later), and the outer query renders each measure, with `RUNNINGSUM` as a window along the time axis. Queries without them compile as before.
