# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The current product direction and architecture are defined in:

1. `docs/product/PROJECT_SCOPE.md`
2. `docs/adr/0001-human-ownership-layer.md`
3. `docs/adr/0002-local-first-claude-code-first-mvp.md`
4. `docs/adr/0003-event-schema-and-session-lifecycle.md`
5. `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
6. `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
7. `docs/architecture/C4.md`
8. `docs/product/BACKLOG_v0.1.0.md`
9. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or the product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over the historical order in the original backlog.

## Development policy

- Work on exactly one issue or task at a time.
- Keep each pull request small and independently reviewable.
- Do not modify unrelated files.
- Do not add product behavior that is outside the active issue.
- Prefer the smallest maintainable solution over speculative abstraction.
- Avoid cloud services, authentication, telemetry, analytics, billing, or remote persistence unless an issue explicitly requires them.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, canonicalization rules, redaction rules, or security controls to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented and task-specific reason.
- Do not rewrite accepted ADRs as part of implementation work. Architectural changes require a separate ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned contracts remain controlled and versioned.
- Persist-before-acknowledge is mandatory for accepted ingress receipts.
- Unredacted source payloads must never be written to persistent storage.
- Unknown source fields may be accepted at parsing but must not be persisted without an explicit policy-version change.
- Errors and diagnostics must never contain rejected source values, canonical unredacted JSON, secrets, prompts, commands, source code, absolute paths, or key material.

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
- Ingress fingerprinting: Node.js built-in HMAC-SHA-256 with a secret `KeyObject`
- Canonical parsed JSON: OwnLoop Canonical JSON v1 as defined by ADR-0005
- CI: GitHub Actions
- Formatting and linting: Biome

When selecting a dependency, use a stable release compatible with Node.js 24 and TypeScript 6. Pin direct dependencies and commit the lockfile. Avoid experimental packages unless an ADR or issue explicitly accepts the risk.

`node:sqlite` is accepted for v0.1 despite its release-candidate status because Node.js is pinned exactly and ADR-0004 isolates the driver behind a small persistence boundary. Do not spread direct driver usage outside that boundary.

OL-005A permits no new external runtime dependency. Stop and report before adding one.

## Repository structure

```text
apps/
├── daemon/
└── web/
packages/
├── contracts/
├── event-model/
├── ingress-security/
└── test-fixtures/
tools/
└── hook-adapter/
```

`packages/ingress-security` is authorized by ADR-0005 because the daemon and future Hook Adapter must share one pure deterministic security policy. Do not create any other application or package without explaining why the existing structure cannot support the active task.

## Quality gates

Before declaring a task complete, run the relevant root commands and report their results:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For OL-005A also run focused tests for:

- canonicalization and JSON rejection cases;
- secret and path absence;
- HMAC and deduplication behavior;
- adversarial long strings;
- migration version-1 to version-2 upgrade.

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

The active implementation task is `OL-005A: Canonicalize and redact ingress before journaling`.

Before implementing OL-005A, read:

- GitHub issue #10
- `docs/tasks/OL-005A_CODEX_TASK.md`
- ADR-0003
- ADR-0004
- ADR-0005
- C4 architecture
- the backlog amendment
- RFC 8785 and its verified errata
- Node.js 24 Crypto documentation
- OWASP Logging Cheat Sheet data-exclusion guidance

For OL-005A, the following are explicitly forbidden:

- Fastify or any HTTP server, endpoint, or client
- local installation-token generation
- receipt ID generation or durable insertion orchestration
- stdin reading or Hook forwarding
- executable Claude Code or Codex integration
- Claude settings files
- pending-receipt processing
- Workspace, Conversation, or Task Run lifecycle transitions
- normalized event creation
- database deduplication decisions
- sequence allocation
- Git baseline, diff, or reconciliation behavior
- artifact content storage or cleanup
- background worker execution
- AI provider code or API calls
- web UI feature work
- Ownership Moment generation
- Build Replay behavior
- cloud backend or remote storage
- authentication, analytics, billing, or telemetry

OL-005A is complete only when the versioned prepared-receipt contracts, shared deterministic ingress-security package, canonicalization, HMAC fingerprinting, allowlist reduction, secret/path redaction, safe bounded diagnostics, migration version 2, repository mapping, and all required tests satisfy issue #10, ADR-0005, and the task brief without introducing transport or downstream processing behavior.
