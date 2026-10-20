# Handoff — 2026-10-20 · claude

## State
- `main` at the merge of this PR, on top of `1a03de3` (#98). M9 (hardening) and M10 (formula power) of the roadmap to 1.0 ([ADR 0012](docs/adr/0012-roadmap-to-1-0.md)) are merged. CI is green, and production runs both (migrate, deploy and smoke green).
- Open PRs: none once this one merges.

## Done this session
- **#77:** Dependabot's 15 updates, including Vercel CLI 64, merged with Georges' go-ahead. The deploy's flags are unchanged.
- **The roadmap to the first npm release** (#86, ADR 0012):

  | Milestone | What |
  | --- | --- |
  | M9 | Hardening |
  | M10 | Formula power |
  | M11 | Map and multi-fact |
  | M12 | Your own data |
  | M13 | Shared cache and push |
  | M14 | Release 1.0 |

  The packages stay unpublished at 0.x until M14, as Georges wants a working prototype first.
- **M9, #87–#91:**
  - a limited bar, table or scatter keeps rows that have values (`nulls last`);
  - the gateway's unit coverage is back to 98.89%, with a 93% floor;
  - the repair panel fixes a field that became ambiguous and prefers the schema the dashboard uses;
  - `withDeadline` is exported, so the demo's own reads give up after 5 s;
  - a weekly pg_cron job deletes the memberships and dashboards of guests unseen for 30 days. Only this app's data; the anonymous auth users stay with `portfolio-infra` (Georges' choice).
- **M10, #92–#98 ([ADR 0013](docs/adr/0013-formula-additions-m10.md)):**
  - **`CALCULATE(m, condition)`** compiles to `FILTER (WHERE …)`.
  - **`PREVIOUSPERIOD(m)` and `RUNNINGSUM(m)`** use a two-stage compile. It is right across buckets without data, and reads the window before a date filter. Both need one time axis.
  - **`CALCULATE(m, ALL(field))`** gives a total, for shares.
  - **New demo host measures:** "Revenue, previous period", "Revenue growth", "Running orders" and "Share of revenue".
- **Independent reviews** were posted on #84, #91 and #98, and all their findings were fixed or documented before merging. M10's blocker was that a measure that is only `ALL`'s total answered one row per fact row. M10's should-fixes included the null-safe joins, which forced nested loops, now hashable.

## Verified on production
- **M9:**
  - the cleanup job is scheduled for Mondays at 04:00 UTC;
  - `last_seen_at` exists;
  - `dash_app` can't run the cleanup function;
  - the demo loads, filters, saves and deletes.
- **M10:** a line of Revenue and Revenue growth by day, built in the builder. Growth equals revenue minus the day before on all 11 days shown, and the share-of-revenue table sums to 100.0%. The check dashboard was deleted. A first run, which failed on my own number parsing, may have left one guest's "M10 check" dashboard; the weekly cleanup removes it after 30 days.

## Next
1. **M11, map and multi-fact (DESIGN.md §9), in plan mode:**
   - the map visual: ECharts map, GeoJSON loaded lazily, ISO country codes from `customers.country`;
   - chasm traps through per-fact pre-aggregation, reusing the two-stage compile, with a second fact table in the demo.
2. **Follow-ups:**
   - a two-stage query in `pnpm bench`;
   - `ALL` together with `PREVIOUSPERIOD` in one measure (refused for now, ADR 0013);
   - more time functions (`SAMEPERIODLASTYEAR`, `YTD`) if asked for.
3. **Then:** M12 (your own data), M13 (needs an Upstash Redis database from Georges), and M14 (release 1.0, needs an npm account).

## Needs from Georges
- **M13:** an Upstash Redis database, with its keys in Vercel (web UI).
- **M14:** an npm account or org; the social preview image and the profile pin (web UI).

## Notes
- **Merging a stack:**
  - `gh pr merge N --squash` without `--delete-branch`, because the repository deletes merged branches and retargets the PRs stacked on them;
  - restack each branch from the previous branch's tip before that branch was restacked;
  - wait until required checks are reported before watching them.
- **Before Check all after switching branches:** remove `apps/demo/.next/types`.
- **Agent log:** at most 40 entries. Older ones move to `docs/agent-log/YYYY-MM.md` (ENGINEERING.md §5).
- **No local Docker:** integration tests and e2e run in CI. The fixture pages run locally against a production build on port 3200 (`BASE_URL`); ports 3000 and 3100 belong to another project.
- **Visual baselines:** they come from CI's `screenshot-baselines` artifact (ADR 0008).
