---
"@adam-riffi/dash-core": minor
"@adam-riffi/dash-gateway": patch
---

Query validation (`validateQuery`, `tablesOf`) and join planning (`planJoins`) move from the gateway to `@adam-riffi/dash-core`, so the browser can plan queries with the gateway's own rules.
