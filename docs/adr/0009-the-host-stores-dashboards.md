# 0009 — The host stores dashboards

- Status: Accepted
- Date: 2026-10-08
- Proposed by: claude; decided by: Georges (chose "the host stores them" for M5)

## Context

DESIGN.md §4 asks for "dashboards saved per user", and §8 lists `dash.dashboards` with owner-only RLS through `app.user_id` (ADR 0001). It did not say who saves them. There were two options: endpoints in the gateway, or the host's own storage behind a builder that only hands specs over.

## Decision

The host stores dashboards. `<DashboardBuilder spec onChange onSave />` is controlled and storage-agnostic. Save validates the spec, stamps the contract version it was built on, and calls `onSave`; the host decides where it goes. The gateway gets no dashboard endpoints.

The demo stores them in `dash.dashboards` through its own route (`/api/dashboards[/id]`):
- authentication is the gateway's `authenticate`;
- each statement runs as `dash_app` in a transaction with `app.user_id` set to the token's subject, so the ADR 0001 policy applies;
- specs are capped at 256 KB (checked from `content-length` before the body is read);
- each user may keep at most 20 dashboards, which bounds what an anonymous sign-in can store in the shared database.

The builder ships from its own entry, `@adam-riffi/dash-react/builder`, so pages that only view dashboards never load its editors.

## Consequences

- Hosts with their own persistence (files, another database, an API) need nothing from the gateway.
- `app.user_id` is set by the host's store, not by the gateway; DESIGN.md §8 says so.
- Per-user caps don't stop many anonymous sign-ins. Supabase rate-limits anonymous sign-ins per IP, and DESIGN.md §14 plans a weekly cleanup of inactive anonymous users and their dashboards. A global quota is the next step if that isn't enough.
