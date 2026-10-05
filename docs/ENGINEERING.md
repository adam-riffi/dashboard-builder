# Engineering standards

> Shared by every portfolio repository. Copy this file unchanged into `docs/ENGINEERING.md`; the canonical version lives in `portfolio-infra/templates/ENGINEERING.md`. Project-specific rules live in `docs/DESIGN.md` and `AGENTS.md`; where they conflict with this file, the project file wins for that repository.
>
> Names used across all documents: GitHub owner `adam-riffi`; npm scope `@adam-riffi`; PyPI and crates.io names prefixed `adam-riffi-` (Python import names `adam_riffi_…`). All were free on 2026-10-04; claim the npm scope by creating the npm account (or npm organization) `adam-riffi` before the first release.

## 1. Documents and their roles

| File | Role | Edited by |
| --- | --- | --- |
| `docs/DESIGN.md` | The specification: scope, architecture, milestones, tests, CI/CD, deployment | Georges; agents propose changes through a PR plus an ADR |
| `docs/ENGINEERING.md` | Workflow rules (this file) | Georges, through `portfolio-infra` |
| `AGENTS.md` | Operating manual for coding agents: commands, rules, definition of done | Agents keep commands current |
| `CLAUDE.md` | Imports `AGENTS.md` for Claude Code, plus Claude-only notes | Rarely |
| `.github/copilot-instructions.md` | Short rule summary for Copilot surfaces that do not read `AGENTS.md` | Rarely |
| `docs/AGENT_LOG.md` | Shared memory between agents and sessions | Every agent, every PR |
| `docs/adr/NNNN-title.md` | Architecture decision records | Whoever makes the decision |

## 2. Development cycle

The unit of planning is a **milestone** (DESIGN.md §9). The unit of delivery is a **pull request**. Each milestone ships as a stack of 2 to 6 small PRs, and the live demo is redeployed at the end of every milestone.

For every PR:

1. **Sync.** Read the latest `docs/AGENT_LOG.md` entries, fetch `main`, restack your branches (§3).
2. **Plan.** Open a draft PR early whose body states what will change and which tests will prove it.
3. **Red.** Write the failing test(s), run them, confirm they fail for the expected reason. Commit `test(<area>): …`.
4. **Green.** Write the minimum code that passes. Commit `feat|fix(<area>): …`.
5. **Refactor.** Improve structure and names with the tests green. Commit `refactor(<area>): …` when non-trivial.
6. **Verify.** Run the full local check (the "Check all" command in `AGENTS.md`), update docs, append an `AGENT_LOG.md` entry.
7. **Review.** Mark the PR ready only when CI is green. A different agent from the author reviews it (correctness, tests, scope, security) and posts findings as a PR review. The author addresses them. Georges approves and merges.
8. **Deploy and verify.** Merging to `main` deploys production. Run the smoke checks in DESIGN.md §12.

Test-first is mandatory except for scaffolding, configuration, documentation and spikes. Spikes live on `spike/<topic>` branches, are never merged, and end with an ADR recording what was learned.

## 3. Stacked pull requests on plain GitHub

No stacking tool is used; plain `git` and `gh` are enough.

**Naming.** `stack/<topic>/<nn>-<slug>`, for example `stack/contract/01-introspection`, `stack/contract/02-inference`. Single PRs outside a stack use `<type>/<slug>`.

**Creating a stack.**
- The first branch starts from `main`; its PR targets `main`.
- Each next branch starts from the previous branch; its PR targets the previous branch (`gh pr create --draft --base stack/contract/01-introspection`).
- Every PR body contains a **Stack** section: the ordered list of PRs, with the current one marked.

**Changing a lower PR.** Commit the fix on the lower branch, then check out the top branch of the stack and run `git rebase --update-refs <lower-branch>`. This rewrites every intermediate branch in one pass. Push each moved branch with `git push --force-with-lease origin <branch>`.

**Merging.** Squash-merge bottom-up, one PR at a time; the PR title becomes the commit message. After the bottom PR merges, check out the top branch and run `git rebase --update-refs --onto origin/main <merged-branch>` to drop the squashed commits, push the moved branches, and retarget the next PR with `gh pr edit <number> --base main` (GitHub may already have retargeted it when the merged branch was deleted). Never merge a PR whose base is not `main`.

**Size.** At most about 400 changed lines per PR, excluding lockfiles, snapshots, fixtures and generated files. Larger changes become a stack.

## 4. Commits and pull requests

- Commits and PR titles follow Conventional Commits: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`; the scope is the module (`feat(gateway): …`); breaking changes use `!`.
- The PR title type also selects the PR meme category (§14).
- PR bodies follow `.github/pull_request_template.md`: Summary, Stack, Tests, Scope and decisions, Checklist. UI changes include a screenshot or a short GIF.
- Never push to `main`. Never force-push a branch you did not create. Use `--force-with-lease`, never `--force`.

## 5. Agent log protocol

`docs/AGENT_LOG.md` is the shared memory of the repository.

- **Start of session:** read the five newest entries and the open PR list.
- **End of every PR (or session):** prepend one entry, newest first:

```
## 2026-10-05 · codex · stack/contract/02-inference · #14
- Done: what changed, in one or two lines.
- Tests: what proves it.
- Scope/decisions: deviations from DESIGN.md, with ADR links.
- Next: the next concrete step, open questions, known issues.
```

- Keep at most 40 entries; move older ones to `docs/agent-log/YYYY-MM.md`.
- A scope change is never recorded only in the log: it also gets an ADR and, once accepted, an update to DESIGN.md.

## 6. Architecture decision records

Any change to the stack, data model, public API, security model or scope gets an ADR in `docs/adr/NNNN-kebab-title.md` (one page: Context, Decision, Alternatives, Consequences, Status). Agents may write ADRs with status `Proposed`; Georges sets `Accepted`.

## 7. Code standards

**All languages**
- Functional core, imperative shell: core logic is pure (no I/O, no globals, deterministic) and lives in its own package or crate; adapters for the database, network, file system and UI sit at the edges. Core packages never import UI frameworks.
- Inject clocks, random number generators (with seeds) and ID generators so behavior is reproducible in tests.
- Errors are typed and handled; no silent catches; user-facing messages are separate from internal details.
- Public APIs are documented (TSDoc, rustdoc, docstrings). Comments explain why, not what.
- Each project's "hand-written core" (DESIGN.md §6) is implemented in the repository; libraries are allowed only around it. Never copy code from other projects; dependency licenses must be MIT, Apache-2.0, BSD, ISC or MPL-2.0.
- Each demo gets a deliberate visual identity defined in DESIGN.md §7, not a default template look.

**TypeScript**
- Node current LTS (pinned in `.nvmrc`), pnpm (pinned in `packageManager`), ESM only.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; no `any` (use `unknown` and narrow).
- Biome for lint and format; Vitest for unit tests; fast-check for property tests; Playwright for end-to-end tests.
- Monorepos use pnpm workspaces and Turborepo.
- Published packages use the scope `@adam-riffi` (for example `@adam-riffi/signals`); private workspace packages set `"private": true`.
- Validate data at boundaries with zod; React function components only.

**Rust**
- Stable toolchain pinned in `rust-toolchain.toml`, edition 2024, Cargo workspace.
- `#![forbid(unsafe_code)]` in core crates unless an ADR justifies an exception.
- `rustfmt`; `clippy` with `-D warnings`; `thiserror` for library errors, `anyhow` only in binaries; no panics on library paths except asserted invariants.
- proptest for property tests, insta for snapshots, criterion for benchmarks, cargo-deny for licenses and advisories, release-plz for releases.
- Recipes in a `justfile` (`just check`, `just test`, …).
- crates.io has no namespaces: published crates are named `adam-riffi-<name>`; workspace-internal crates set `publish = false`.

**Python**
- Python 3.12 or later, src layout, uv for environments and locking.
- ruff for lint and format (rules E, F, I, B, UP, SIM, RUF); pyright in strict mode.
- pydantic v2 at boundaries, typer for CLIs, pytest and hypothesis for tests.
- Recipes in a `justfile`. Notebooks only under `examples/`, with outputs stripped.
- PyPI has no namespaces: distributions are named `adam-riffi-<name>` and import as `adam_riffi_<name>`.

## 8. Testing standards

| Level | Scope | Rules |
| --- | --- | --- |
| Unit | Pure core logic | Fast (whole suite under 30 s), no network or disk, behavior-named tests |
| Property | Invariants listed in DESIGN.md §10 | Seeded; the failing seed is printed; more cases in the nightly run |
| Contract | One suite run against every implementation of an interface (for example in-memory and Postgres stores) | Required wherever an interface has two or more implementations |
| Integration | Real database or service in a container | Never mock what the repository owns |
| End-to-end | Playwright against a local production build in CI (with a disposable database where needed); a `@smoke` subset runs against every deployed URL | At most 10 critical journeys; traces uploaded on failure |
| Visual | Screenshot comparison of key views | Opt-in per project |
| Performance | Benchmarks and budgets from DESIGN.md §13 | Reported on every PR; gating only where DESIGN.md says so |

- Coverage gates: core packages at least 90% of lines, whole repository at least 80% (UI glue and generated code excluded).
- Snapshot and golden files are reviewed like code and updated only through an explicit command (`just snapshots`, `pnpm test -u`).
- A flaky test is quarantined within a day, with an issue explaining why. A failing test is never deleted or weakened to get a green build.

## 9. Continuous integration (GitHub Actions)

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | Pull requests, pushes to `main` | Jobs `lint`, `typecheck`, `test`, `integration` (if any), `build`, `e2e` (if any UI); these job names are the required checks |
| `smoke.yml` | Successful Vercel deployment (`deployment_status`), mode A only | The `@smoke` Playwright subset against the deployed URL |
| `deploy.yml` | Pull requests, pushes to `main` | Mode B only (§10): migrations, prebuilt deployment, smoke subset |
| `release.yml` | Tags or Changesets / release-plz pull requests | Publishing libraries to npm, crates.io or PyPI |
| `nightly.yml` | Daily schedule | Long property runs, dependency audits, benchmarks, security scans |
| `pr-meme.yml` | Pull requests opened or reopened | Standard caller (§14); never a required check |

Practices:
- Default `permissions: contents: read`; widen per job only.
- `concurrency` group per ref with `cancel-in-progress: true` on pull requests.
- `timeout-minutes` on every job (15 by default).
- Cache dependencies (pnpm store, cargo registry and target, uv cache).
- Pin third-party actions to a commit SHA; first-party `actions/*` may use major tags.
- Run `actionlint` whenever workflows change.
- Branch ruleset on `main`: pull request required, required checks as listed in DESIGN.md §11, linear history, squash merge only.
- Dependabot weekly for the package ecosystem and GitHub Actions, with grouped updates.

## 10. Continuous delivery and Vercel

One Vercel project per repository, on the Hobby plan. Functions that query the database run in Paris, next to it (§11): set `"regions": ["cdg1"]` in `vercel.json`, since Vercel otherwise runs functions in Washington, D.C. (`iad1`).

**Mode A, Git integration (TypeScript repositories without a database).** Vercel builds each push: a preview per PR and production on `main`; the Vercel bot comments the preview URL on the PR. `smoke.yml` runs on `deployment_status` events with state `success` against the reported URL.

**Mode B, prebuilt from GitHub Actions (repositories that need Rust, WebAssembly, Python or Pyodide assets at build time, and every app with database migrations, so migrations always run before the production deploy).** `vercel.json` disables Git deployments (`"git": { "deploymentEnabled": false }`). `deploy.yml` installs the toolchains, runs the `migrate` job on `main` (§11), then `vercel pull --yes --environment=<preview|production>`, `vercel build [--prod]` and `vercel deploy --prebuilt [--prod]`; it posts the preview URL as a PR comment and runs the smoke subset against the deployment. Required secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

Rules for both modes:
- Environment variables are defined in Vercel per environment (Development, Preview, Production). `.env.example` lists every variable with a comment; local development uses `vercel env pull .env.local`. Only non-secret values may use client-exposed prefixes (`NEXT_PUBLIC_`, `VITE_`).
- If preview Deployment Protection is enabled, Playwright sends the "Protection Bypass for Automation" secret header.
- After each production deploy, run the smoke checks from DESIGN.md §12; the uptime job in `portfolio-infra` repeats them every six hours.
- Rollback uses Vercel's instant rollback. Database migrations are expand/contract so the previous release keeps working.

## 11. Database (Supabase)

- **One shared Supabase project: `portfolio`**, region Paris (`eu-west-3`), reference `fztysvgkmauozxfyscaj`, URL `https://fztysvgkmauozxfyscaj.supabase.co`. A Supabase project is one Postgres database with its own Auth (sign-in), Storage, API keys and URL. "Shared" means every database-backed app lives in this one project, each in its own schema with its own database role, so no app can read another app's tables.
- **Why shared.** The Free plan allows two active projects and pauses a project after one week without activity; one project keeps every demo free. The uptime job in `portfolio-infra` keeps it active.
- **Isolation.** One Postgres schema per app (named in DESIGN.md §8) and one login role per app (`<schema>_app`) with privileges limited to its schema. Both are created by `portfolio-infra/supabase/bootstrap.sql`, run once by Georges; passwords are set by hand and never committed.
- **Shared sign-in.** Auth settings apply to the whole project: anonymous sign-ins (dashboard builder) and the GitHub provider (agent trace viewer) are enabled for every app, and all apps share one user list. Apps therefore authorize through their own membership tables, never on "the user is signed in". The Auth redirect allowlist holds every app's production and preview domains. `portfolio-infra` owns these settings (its DESIGN.md §8).
- **When to split.** An app moves to its own Supabase project when it needs its own sign-in settings, has real users, or outgrows the shared limits. Its schema, role and migrations move with it unchanged; only connection strings change.
- **Migrations** are owned by each repository as committed SQL files and applied by the repository's own tool, with its history table inside the app schema: Drizzle Kit for TypeScript, Alembic with `version_table_schema` for Python. Never run `supabase db push` against the shared project: its single migration history would collide across repositories. The Supabase CLI is used for local development only (`supabase start`).
- **Migration delivery.** A `migrate` job runs on pushes to `main` before the production deploy, using the `DATABASE_URL_MIGRATIONS` secret (session pooler or direct connection).
- **Previews share the production schemas** (database branching is not on the Free plan). Migrations are therefore expand/contract, preview deployments of a PR that adds a migration may be degraded until merge, and E2E tests run against a disposable local database in CI, never against previews.
- **Connections from Vercel Functions** use the transaction-mode pooler connection string, one connection per function instance, with prepared statements disabled when the driver requires it in transaction mode.
- **Row-level security** is enabled on every table; any table reachable through the Supabase Data API needs explicit policies. Server code connects as the app role, never with a Supabase secret API key (the former `service_role` key), admin scripts excepted.
- **Data.** Seeds are idempotent scripts; demo data stays under 50 MB per app (the Free plan allows 500 MB per project). Demos store no personal data beyond auth identifiers; logs hash IP addresses.
- **Tests.** Integration tests use a disposable Postgres service container matching Supabase's Postgres major version, or `supabase start` when Supabase Auth or RLS behavior is under test.

## 12. Security baseline

- Secrets only in GitHub Actions secrets and Vercel environment variables; least-privilege tokens; nothing secret in client bundles.
- Validate every input at the boundary; SQL is always parameterized; identifiers come from allowlists.
- Web demos send security headers (Content-Security-Policy, `frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`).
- Endpoints that cost money (LLM or embedding calls) are rate-limited per user or IP, and provider keys have spend caps.
- Never log tokens, credentials or raw secrets; redact before persisting traces or prompts.
- Nightly: `pnpm audit`, `cargo deny check`, `pip-audit`. CodeQL default setup on TypeScript and Python repositories.

## 13. Observability and performance budgets

- Functions write structured JSON logs (`level`, `msg`, `requestId`, durations).
- Demos enable Vercel Web Analytics and Speed Insights within free quotas.
- Every view has explicit loading, empty and error states.
- Budgets unless DESIGN.md §13 overrides: initial JavaScript at most 200 KB gzipped (heavy engines such as WebAssembly modules, Pyodide or DuckDB load lazily after first paint), Largest Contentful Paint at most 2.5 s on desktop broadband, input response under 100 ms, animations at 60 fps.

## 14. PR meme pipeline

Every pull request in every repository receives one meme comment, chosen from Georges's Google Drive folder `My Drive/PR`. The pipeline lives in `portfolio-infra` (its DESIGN.md has the full design). Each repository only adds this caller, which needs no secrets and does nothing in forks:

```yaml
# .github/workflows/pr-meme.yml
name: pr-meme
on:
  pull_request:
    types: [opened, reopened]
permissions:
  pull-requests: write
jobs:
  meme:
    if: >-
      github.repository_owner == 'adam-riffi' &&
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: adam-riffi/portfolio-infra/actions/pr-meme@v1
```

- Never a required check; the action exits successfully even when the image source is unreachable.
- Add the label `no-meme` to a PR to skip it.

## 15. README and presentation

Every repository's README follows this order:
1. Name and one-line pitch.
2. Demo GIF (10 to 20 s, under 8 MB), live demo link, CI and license badges.
3. Why it is interesting: three bullets (the hard problem, the approach, a measured result).
4. How it works: architecture diagram (Mermaid) and notes on the key algorithms.
5. Benchmarks or evaluation: numbers and method.
6. Testing approach.
7. Running locally.
8. Project structure.
9. Limitations and next steps.
10. License: MIT for TypeScript and Python, MIT OR Apache-2.0 for Rust.

Also set the repository description, topics and social preview image, and pin the repository on the GitHub profile once it is portfolio-ready.

## 16. One-time repository setup (Georges)

1. Create the repository under `adam-riffi` from the pack.
2. Settings: squash merge only with the PR title as message, automatically delete head branches, Actions default permissions read-only.
3. Ruleset on `main` with the required checks from DESIGN.md §11.
4. Secrets and variables from DESIGN.md §12.
5. Create and link the Vercel project (mode A or B per DESIGN.md §12).
6. If the app uses the database: run its section of `portfolio-infra/supabase/bootstrap.sql` and set the app role password.
7. Enable Dependabot alerts and CodeQL default setup.
8. Add the repository's demo URLs to `portfolio-infra/uptime/targets.json`.
