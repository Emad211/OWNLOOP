# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The current product direction and architecture are defined in:

1. `docs/product/PROJECT_SCOPE.md`
2. `docs/adr/0001-human-ownership-layer.md`
3. `docs/adr/0002-local-first-claude-code-first-mvp.md`
4. `docs/adr/0003-event-schema-and-session-lifecycle.md`
5. `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
6. `docs/architecture/C4.md`
7. `docs/product/BACKLOG_v0.1.0.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or the product scope, stop and report the conflict instead of improvising.

## Development policy

- Work on exactly one issue or task at a time.
- Keep each pull request small and independently reviewable.
- Do not modify unrelated files.
- Do not add product behavior that is outside the active issue.
- Prefer the smallest maintainable solution over speculative abstraction.
- Avoid cloud services, authentication, telemetry, analytics, billing, or remote persistence unless an issue explicitly requires them.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, or security controls to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented and task-specific reason.
- Do not rewrite ADRs as part of implementation work. Architectural changes require a separate ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned normalized schemas must remain controlled and versioned.
- Persist-before-acknowledge is mandatory for accepted ingress receipts.
- Unredacted source payloads must never be written to persistent storage.

## Technical baseline

Unless a later ADR changes this baseline:

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 in strict mode
- Package manager: pnpm 11.4.0, pinned through `packageManager`
- Repository shape: pnpm workspace / modular monolith
- Local UI: React + Vite
- Unit tests: Vitest
- Runtime validation: Zod 4.4.3
- Local persistence: built-in `node:sqlite` behind the daemon persistence boundary
- CI: GitHub Actions
- Formatting and linting: Biome

When selecting a dependency, use a stable release compatible with Node.js 24 and TypeScript 6. Pin direct dependencies and commit the lockfile. Avoid experimental packages unless an ADR or issue explicitly accepts the risk.

`node:sqlite` is accepted for v0.1 despite its release-candidate status because Node.js is pinned exactly and ADR-0004 isolates the driver behind a small persistence boundary. Do not spread direct driver usage outside that boundary.

## Repository structure

```text
apps/
├── daemon/
└── web/
packages/
├── contracts/
├── event-model/
└── test-fixtures/
tools/
└── hook-adapter/
```

Do not create additional applications or packages without explaining why the existing structure cannot support the active task.

## Quality gates

Before declaring a task complete, run the relevant root commands and report their results:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If dependencies cannot be installed because network access is unavailable, still complete all work that can be validated locally and report the exact blocked checks. Never claim a check passed if it was not run.

## Git and pull-request discipline

- Base implementation branches on the branch named in the active task brief.
- Use the exact branch name requested by the task when practical.
- Make focused commits with terse imperative messages.
- Leave the worktree clean.
- Do not push directly to `main`.
- Open implementation pull requests as drafts until checks and human review are complete.
- In the final response, summarize files changed, decisions made, checks run, failures or limitations, and anything requiring human review.

## Current phase restriction

The active implementation task is `OL-005: Implement SQLite persistence foundation and ingress journal`.

Before implementing OL-005, read:

- GitHub issue #7
- `docs/tasks/OL-005_CODEX_TASK.md`
- ADR-0003
- ADR-0004
- C4 architecture
- the official Node.js 24.18.0 SQLite documentation linked in the task brief

For OL-005, the following are explicitly forbidden:

- Fastify or any HTTP server, endpoint, or client
- local token authentication
- stdin reading or Hook forwarding
- executable Claude Code or Codex integration
- redaction or canonicalization implementation
- processing ingress receipts into normalized events
- deduplication decision behavior
- sequence allocation behavior
- Task Run lifecycle transitions
- Git baseline, diff, or reconciliation behavior
- artifact content storage or cleanup
- background worker execution
- AI provider code or API calls
- web UI feature work
- Ownership Moment generation
- Build Replay behavior
- cloud backend or remote storage
- authentication, analytics, billing, or telemetry

OL-005 is complete only when migrations, the initial schema, the durable redacted-ingress journal, append-only event persistence, repository primitives, constraints, deletion behavior, and file-backed durability satisfy issue #7 and the task brief without introducing transport or downstream processing behavior.
