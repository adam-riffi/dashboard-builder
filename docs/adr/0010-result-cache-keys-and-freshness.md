# 0010 — Result cache: keys and freshness

- Status: Accepted
- Date: 2026-10-17
- Proposed by: claude; decided by: Georges (approved the M6 plan)

## Context
DESIGN.md §6 keys the result cache on `sha256(normalized QuerySpec + contract version + scope hash)`, with a TTL of "the smallest refresh interval among requesting visuals (minimum 5 s)". Two things were left open:
- **Names:** a QuerySpec names dashboard measures. Two dashboards can define `[Margin]` differently, so the same QuerySpec can mean two different queries (ADR 0007 asked M6 to key on the compiled SQL).
- **Refresh interval:** the gateway never learned a visual's refresh interval; `POST /query` carried no such field.

## Decision
- **Key:** `sha256([scopeHash, contractVersion, compiled SQL, parameters])`.
  - The compiled SQL inlines every named measure, so a name means one thing per key.
  - The scope hash is in the key even though the policies' parameters usually carry the scope. Missing the scope would serve one tenant's rows to another, and its property test asserts the scope always changes the key.
  - A request's property order never changes the compiled SQL, so it never changes the key.
- **Freshness:** `POST /query` takes an optional `maxAgeSec` (5–86,400; default 60, the DashboardSpec default). An entry serves a request only while it is younger than that request's limit. The TTL is therefore the asker's own refresh interval, and two dashboards refreshing at different rates share entries.
- **Storage:** `memoryCache({ maxBytes })` keeps results per function instance, least recently used first out, sized by their JSON. Hits come from warm instances; a shared store (Redis) is v1.1.
- **Reporting:** `meta.cache` reports `hit` or `miss`; logs carry the first 16 characters of the scope hash, never the scope.

## Consequences
- New data shows up within one refresh interval: an entry older than the asker's interval is computed again.
- A cache hit doesn't touch the database, but authentication, the contract and compilation still run on every request.
