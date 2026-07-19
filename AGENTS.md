# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The current product direction and architecture are defined in:

1. `docs/product/PROJECT_SCOPE.md`
2. `docs/adr/0001-human-ownership-layer.md`
3. `docs/adr/0002-local-first-claude-code-first-mvp.md`
4. `docs/adr/0003-event-schema-and-session-lifecycle.md`
5. `docs/architecture/C4.md`
6. `docs/product/BACKLOG_v0.1.0.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or the product scope, stop and report the conflict instead of improvising.

## Development policy

- Work on exactly one issue or task at a time.
- Keep each pull request small and independently reviewable.
- Do not modify unrelated files.
- Do not add product behavior that is outside the active issue.
- Prefer the smallest maintainable solution over speculative abstraction.
- Avoid cloud services, authentication, telemetry, analytics, billing, or remote persistence unless an issue explicitly requires them.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, or machine-specific paths.
- Do not weaken type checking, linting, tests, or security controls to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented and task-specific reason.
- Do not rewrite ADRs as part of implementation work. Architectural changes require a separate ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned normalized schemas must remain controlled and versioned.

## Technical baseline

Unless a later ADR changes this baseline:

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 in strict mode
- Package manager: pnpm 11.4.0, pinned through `packageManager`
- Repository shape: pnpm workspace / modular monolith
- Local UI: React + Vite
- Unit tests: Vitest
- Runtime validation for OL-002: Zod 4.4.3
- CI: GitHub Actions
- Formatting and linting: Biome

When selecting a dependency, use a stable release compatible with Node.js 24 and TypeScript 6. Pin direct dependencies and commit the lockfile. Avoid experimental packages unless the issue explicitly requires them.

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

The active implementation task is `OL-002: Define runtime contracts for ingress events`.

Before implementing OL-002, read:

- GitHub issue #4
- `docs/tasks/OL-002_CODEX_TASK.md`
- ADR-0003
- the official Claude Code hooks reference linked in the task brief
- the Zod 4 documentation linked in the task brief

For OL-002, the following are explicitly forbidden:

- HTTP servers, endpoints, or clients
- stdin reading or hook forwarding
- executable Claude Code or Codex integration
- SQLite, migrations, repositories, or persistence
- event normalization behavior
- deduplication or sequence allocation
- Task Run lifecycle behavior
- Git baseline, diff, or reconciliation behavior
- redaction or secret-scanning implementation
- AI provider code or API calls
- web UI feature work
- Ownership Moment generation
- Build Replay behavior
- cloud backend or remote storage
- authentication, analytics, billing, or telemetry

OL-002 is complete only when runtime schemas, inferred types, fixtures, and tests satisfy issue #4 and the task brief without introducing executable transport or product behavior.
