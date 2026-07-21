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
7. `docs/adr/0006-authenticated-loopback-ingestion.md`
8. `docs/adr/0007-fail-open-command-hook-adapter.md`
9. `docs/adr/0008-transactional-receipt-lifecycle-resolution.md`
10. `docs/architecture/C4.md`
11. `docs/product/BACKLOG_v0.1.0.md`
12. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over the historical order in the original backlog.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, canonicalization, redaction, authentication, fail-open semantics, transactionality, or idempotency to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned contracts remain controlled and versioned.
- Persist-before-acknowledge remains mandatory.
- Unredacted source payloads must never be written to persistent storage.
- Lifecycle processing may read only prepared receipt metadata and canonical redacted payload JSON.
- Aggregate mutations, receipt lifecycle resolution, and receipt status update must commit in one transaction.
- OL-006 must not create normalized Events, Event deduplication records, or sequence numbers.
- Results, diagnostics, and errors must not contain prompt content, paths, source/session IDs, payloads, fingerprints, exceptions, stacks, or secret material.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP server: Fastify 5.10.0 behind daemon ingress
- Persistence: built-in `node:sqlite` behind daemon persistence repositories
- Canonical redacted JSON: OwnLoop Canonical JSON v1
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime dependency is authorized for OL-006. Use Node.js built-ins and existing workspace packages only.

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

Lifecycle behavior belongs under `apps/daemon/src/lifecycle/` and persistence changes under the existing daemon persistence boundary. Do not create a new package or service for OL-006.

## Quality gates

Before declaring completion, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-006 tests must prove:

- migration 2→3, fresh migration, reopen, and checksum behavior;
- provisional Workspace identity and exact path reuse;
- Conversation create/infer/resume/end and workspace conflict;
- sequential Run creation and Capturing abandonment;
- tool association and no-active-run failure;
- Stop/StopFailure Finalizing transitions;
- SessionEnd abandonment behavior;
- receipt resolution/status/aggregate atomicity;
- repeated processing idempotency;
- deterministic pending order and bounded batches;
- stale active Run discovery after file-backed reopen;
- safe result/error surfaces;
- zero normalized Event insertion and zero sequence allocation.

Never claim a check passed unless it was executed successfully.

## Git and pull-request discipline

- Base work on the active task branch.
- Make focused commits.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep PRs draft until CI and review complete.
- Report files, decisions, checks, limitations, and review findings.

## Current phase restriction

The active issue is `OL-006: Implement Workspace, Conversation, and Task Run lifecycle` (#17).

Before implementing, read:

- issue #17 and comments;
- ADR-0003 through ADR-0008;
- Backlog Amendment 0001;
- current prepared receipt, Workspace, Conversation, Task Run, transaction, migration, and error repositories.

Explicitly forbidden in OL-006:

- normalized Event creation;
- Event sequence allocation or Event deduplication;
- Git discovery, baseline, status, diff, or reconciliation;
- final snapshot and Completed/Partial finalization;
- automatic stale recovery mutation;
- artifacts;
- background worker/scheduler;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

OL-006 is complete only when every supported prepared receipt can be transactionally and idempotently resolved to safe Workspace/Conversation/Run lifecycle state or a controlled failed resolution, stale active Runs are discoverable, and no Event or sequence is created.
