# 0002 — Demo order rate that fits the 50 MB budget

- Status: Proposed
- Date: 2026-10-05
- Proposed by: claude; decided by: Georges

## Context
DESIGN.md §8 asks the `pg_cron` job for "a few orders per tenant every minute", a 90-day retention, and a schema under 50 MB (ENGINEERING.md §11; the shared `portfolio` project has 500 MB for every app). These cannot all hold. The first implementation added about 10 orders and 20 items a minute: at steady state that is about 1.3M orders and 2.6M items, roughly 0.4 GB. It would pass 50 MB in about 10 days and put every portfolio app at risk of the Free plan's read-only mode.

## Decision
- Each run adds **one order for a random tenant** with one or two items, and still deletes orders older than 90 days.
- Estimated steady state: 129,600 orders × ~120 B ≈ 16 MB, ~194,000 items × ~110 B ≈ 21 MB, plus about 4 MB of seed data: **~40 MB** with indexes.
- The job deletes its own `cron.job_run_details` rows older than a day (pg_cron never purges them; 1,440 rows a day otherwise). It only touches rows of `dash_demo_tick`, since the table is shared with other apps.
- Update DESIGN.md §8 to "one order a minute" once accepted.

## Alternatives considered
- **Keep the per-tenant rate with a 7-day window.** Fits the budget, but the line charts would lose the 90-day history the demo script shows.
- **Mark generated orders and keep the seeded history forever.** Needs a schema column and still lets seeded dates go stale.

## Consequences
- A visitor with two tenants sees a new order in about 40% of minutes instead of every minute; the "watch new orders arrive" step of the demo script takes a minute or two.
- Measure the real size after a week with `select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dash_demo'` and revisit if it passes 40 MB.
