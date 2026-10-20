# 0012 — Roadmap to 1.0

- Status: Accepted
- Date: 2026-10-20
- Proposed by: claude; decided by: Georges (approved the roadmap and the M9 plan; chose to delete only this app's data for inactive guests)

## Context
The v1 scope in DESIGN.md §4 is built, and M8 (ADR 0011) started v1.1. Georges asked to:
- finish the follow-ups and the missing features;
- hold npm publishing until there is a working prototype.

Two items were planned and never built:
- the rest of v1.1;
- §14's weekly cleanup of inactive anonymous users.

That cleanup touches a shared Supabase project: its anonymous sign-ins belong to every app on it, and `portfolio-infra` owns its Auth settings.

## Decision
- **Milestones before the first npm release:**
  - **M9 Hardening:** M8's follow-ups, a read deadline for the demo's own database, the inactive-guest cleanup.
  - **M10 Formula power:** a two-stage compile (grouped query, then an outer query), `PREVIOUSPERIOD` and `RUNNINGSUM` over the time axis, `CALCULATE`, and `ALL` for shares of a total. The grammar additions get their own ADR (§14).
  - **M11 Map and multi-fact:** the map visual, and chasm traps through per-fact pre-aggregation.
  - **M12 Your own data:**
    - a Source interface and a DuckDB dialect;
    - relationships declared in config;
    - a REST/JSON source;
    - a DuckDB-WASM transport;
    - CSV upload;
    - Arrow IPC.
  - **M13 Shared cache and push:** a Redis cache adapter, a global rate limit, server-sent events.
  - **M14 Release 1.0:** the release workflow, a docs pass, version 1.0.0, the first publish.
- **Versions:** the packages stay unpublished at 0.x until M14. Changesets accumulate, and M14 bumps them to 1.0.0.
- **Inactive guests:**
  - **What the job deletes:** a weekly pg_cron job deletes this app's own data for guests unseen for 30 days, meaning their memberships and dashboards, plus dashboards that have no membership and haven't been updated for 30 days.
  - **Last seen:** `dash.memberships.last_seen_at` records it, refreshed at most once a day when the guest's scope is resolved.
  - **Auth users:** deleting anonymous users stays with `portfolio-infra`.

## Alternatives considered
- **Publish 0.x to npm now:** Georges wants a working prototype first.
- **Delete anonymous `auth.users` from this app's job:** it would remove other apps' guests on the shared project.
- **Track activity with a write per request:** a date refreshed at most daily is enough for a 30-day limit and keeps reads read-only.

## Consequences
- **Milestone planning:** each milestone still starts in plan mode, and can be reordered when needs change.
- **What each milestone needs from Georges:** M12's CSV storage is decided in its plan; M13 needs an Upstash Redis database; M14 needs an npm account.
- **A returning guest after the cleanup:** they get fresh tenant memberships and no dashboards.
