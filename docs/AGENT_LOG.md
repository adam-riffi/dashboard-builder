# Agent log

Shared memory for every agent and session in this repository. Newest entry first; at most 40 entries (older ones move to `docs/agent-log/YYYY-MM.md`). Rules: `docs/ENGINEERING.md` §5.

Entry format:

```
## YYYY-MM-DD · <agent> · <branch> · #<PR>
- Done: what changed, in one or two lines.
- Tests: what proves it.
- Scope/decisions: deviations from DESIGN.md, with ADR links.
- Next: the next concrete step, open questions, known issues.
```

---

## 2026-10-05 · claude · stack/m0/01-monorepo · (this PR)
- Done: pnpm + Turborepo workspace, strict TypeScript base config, Biome, Vitest, `.nvmrc`, `.env.example`, pr-meme caller, Dependabot.
- Tests: none (scaffolding); `pnpm check` runs clean with zero packages.
- Scope/decisions: `core`, `react` and `visuals` are created in the milestones that first use them, not as empty shells. Turbo's `agentGuidance` is off so it stops rewriting AGENTS.md.
- Next: stack/m0/02-ci (ci.yml). M0 plan: 01 monorepo, 02 ci, 03 db schemas + RLS, 04 seed + pg_cron, 05 demo shell + health, 06 deploy.

## 2026-10-04 · claude · (none) · (none)
- Done: Repository pack created: DESIGN.md, ENGINEERING.md, AGENTS.md, CLAUDE.md, Copilot instructions, PR template, ADR template.
- Tests: none yet.
- Scope/decisions: stack and hosting as stated in the header of `docs/DESIGN.md`.
- Next: milestone M0 (scaffold) from `docs/DESIGN.md` §9, after the one-time setup in `docs/ENGINEERING.md` §16.
