# 0003 — JWT authentication lands in M1

- Status: Accepted
- Date: 2026-10-05
- Proposed by: claude; decided by: Georges (chose "auth in M1" when the M1 plan was reviewed on 2026-10-05)

## Context
DESIGN.md §4 puts "JWT auth with JWKS; identity format validation" in v1, but no milestone in §9 names it. The first endpoint that needs it is `GET /contract` (M1): the contract lists the host's allowlisted tables, columns and row estimates, which an embeddable library must not serve to anonymous callers.

## Decision
- M1 adds `jwtAuth({ jwksUrl, issuer, audience })`, which verifies signature, issuer, audience and expiry with `jose` against a remote JWKS. It also adds `authenticate(request, verify, identity)`, which requires a bearer token and checks the identity claim's format (`uuid`, `int` or a regex) before any query runs.
- Every failure is a 401 with a fixed message. jose's reason (expired, bad signature, wrong audience) is never returned to the caller.
- `GET /contract` requires authentication; `GET /health` stays public.

## Alternatives considered
- **Serve `/contract` anonymously until M2.** Simpler, but it would ship an endpoint that leaks the host's schema, and M2 would have to retrofit auth on two routes instead of one.

## Consequences
- The demo needs a signed-in (anonymous) Supabase user before it can read the contract. The page fetches it with the session's access token.
- `resolveScope` and row policies still arrive with `POST /query` in M2. M1 only authenticates.
