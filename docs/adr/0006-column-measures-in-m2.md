# 0006 — Column measures in M2

- Status: Accepted
- Date: 2026-10-06
- Proposed by: claude; decided by: Georges (chose "column measures now" when the M2 plan was reviewed)

## Context
DESIGN.md §7 defines QuerySpec measures as `{ name } | { formula }`. Both need the formula language: `name` refers to a DashboardSpec measure defined by a formula, and that language arrives in M3. M2 (query engine) still needs a way to ask for "sum of quantity" so that validation, join paths, policies, compilation and execution can be built and tested end to end.

## Decision
- M2 adds a third measure form, a **column measure**: `{ field: "schema.table.column", aggregation? }`. `aggregation` is one of `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNT_DISTINCT`; when omitted it is the contract's default for that column.
- `sort` is `[{ by: "dimension" | "measure", index, dir }]` (DESIGN.md leaves its shape open).
- M3 adds `{ formula }` and `{ name }` next to column measures. A column measure stays valid; it is the same as a formula `AGG(table.column)`.

## Alternatives considered
- **A minimal `SUM(table.column)` formula parser in M2.** It matches DESIGN.md's API now, but it is a throwaway parser that M3's Pratt parser replaces.

## Consequences
- DESIGN.md §7's QuerySpec lists column measures and the sort shape (updated with this ADR).
- The formula compiler in M3 can lower `AGG(field)` to the same SQL path as column measures.
