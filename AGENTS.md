# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The current product direction and architecture are defined in:

1. `docs/product/PROJECT_SCOPE.md`
2. `docs/adr/0001-human-ownership-layer.md`
3. `docs/adr/0002-local-first-claude-code-first-mvp.md`
4. `docs/adr/0003-event-schema-and-task-run-lifecycle.md`
5. `docs/architecture/C4_ARCHITECTURE.md`
6. `docs/planning/V0.1.0_BACKLOG.md`

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
- Do not use `any`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented and task-specific reason.
- Do not rewrite ADRs as part of implementation work. Architectural changes require a separate ADR.

## Technical baseline

Unless a later ADR changes this baseline:

- Runtime: Node.js 24 LTS
- Language: TypeScript 6 in strict mode
- Package manager: pnpm 11.4.0, pinned through `packageManager`
- Repository shape: pnpm workspace / modular monolith
- Local UI: React + Vite
- Unit tests: Vitest
- CI: GitHub Actions
- Formatting and linting: use the minimum practical toolchain; do not install overlapping tools

When selecting a dependency, use a stable release compatible with Node.js 24 and TypeScript 6. Pin direct dependencies and commit the lockfile. Avoid experimental packages unless the issue explicitly requires them.

## Planned repository structure

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

- Base implementation branches on the latest accepted documentation branch or `main`, as instructed by the task.
- Use a branch name such as `codex/ol-001-bootstrap`.
- Make focused commits with terse imperative messages.
- Leave the worktree clean.
- In the final response, summarize files changed, decisions made, checks run, failures or limitations, and anything requiring human review.

## Current phase restriction

The first implementation task is `OL-001: Bootstrap the TypeScript monorepo`.

For OL-001, the following are explicitly forbidden:

- Claude Code or Codex event integration
- hook behavior beyond a buildable empty CLI entry point
- SQLite schema or migrations
- AI provider code or API calls
- Ownership Moment generation
- Build Replay behavior
- cloud backend or remote storage
- authentication or user accounts
- production observability or telemetry

OL-001 is complete only when the workspace, minimal applications, shared-package imports, root scripts, tests, build, documentation, and CI are working without introducing product behavior.
