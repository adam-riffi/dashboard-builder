# Copilot instructions — Dashboard builder

`AGENTS.md` at the repository root is the authoritative instruction file; follow it. Summary:

- Specification: `docs/DESIGN.md`. Workflow: `docs/ENGINEERING.md`. Shared memory: `docs/AGENT_LOG.md` (read the newest entries first; add an entry at the end of every PR).
- Test-driven development: failing test first, then implementation, then refactor.
- Small stacked PRs on plain GitHub (`stack/<topic>/<nn>-<slug>`), Conventional Commits, never push to `main`.
- Stack: TypeScript monorepo (pnpm + Turborepo), Next.js demo, postgres.js, Drizzle Kit, Vitest, fast-check, Playwright. Check all: `pnpm check`.
- No dependencies outside `docs/DESIGN.md` §6 without justification; never commit secrets.
