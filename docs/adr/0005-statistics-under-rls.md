# 0005 — Column statistics under row-level security

- Status: Proposed
- Date: 2026-10-05
- Proposed by: claude; decided by: Georges

## Context
DESIGN.md §6 reads `pg_stats` for distinct-value estimates and flags dimensions above 10,000 distinct values as `highCardinality`, which keeps them off axis slots. Two facts change the picture:

1. `pg_stats` returns nothing for a table whose row-level security applies to the caller, and that is the setup DESIGN.md §6 recommends (the source role reads through RLS). The introspection test in #10 confirms it. So on an RLS source, `distinct` is always `null` and `highCardinality` is never set.
2. `pg_class.reltuples` (`rowCount`) ignores RLS. Serving it, or a distinct count, would tell any authenticated user how many rows exist across all tenants. That is a cross-tenant leak, and in the shared Supabase project the visitors are users of every portfolio app.

## Decision
- Statistics stay server-side. `GET /contract` serves `rowCount` and `distinct` as `null` (#12), and `highCardinality` is the only statistic-derived value clients see.
- On RLS sources `highCardinality` is `false` until a statistics path exists. This is acceptable for the demo, where the largest dimension is about 250 customer names.
- Follow-up when a host needs it: an optional `statsSource` in the gateway config, either a role exempt from RLS or a `SECURITY DEFINER` function exposing only `n_distinct`. It is used for statistics only, never for data queries.

## Alternatives considered
- **Introspect with a privileged role.** That would give statistics, but it widens what the gateway's credentials can read, against DESIGN.md §6's least-privilege source role.
- **`count(distinct …)` under RLS at introspection time.** This is scoped per caller, so the contract would differ per tenant and stop being one version, and it is expensive on large tables.

## Consequences
- The contract's `rowCount` and `distinct` fields remain for server-side use (later planning and caching), but they are redacted in responses.
- Once accepted, DESIGN.md §6 notes the RLS limitation and the optional statistics source.
