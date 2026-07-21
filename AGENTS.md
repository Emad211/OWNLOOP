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
10. `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
11. `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
12. `docs/architecture/C4.md`
13. `docs/product/BACKLOG_v0.1.0.md`
14. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over historical backlog order.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, machine-specific paths, raw Git diffs, raw status output, or source-file content.
- Do not weaken type checking, linting, tests, database constraints, privacy limits, read-only Git guarantees, transactionality, idempotency, append-only guarantees, evidence integrity, or sequence integrity to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- All Git execution must be shell-free, argument-structured, read-only, time-bounded, and output-bounded.
- Dirty working trees are valid and must never be cleaned, reset, staged, committed, stashed, or otherwise mutated.
- Raw diff/status bytes and untracked file content are ephemeral hashing inputs only and must be discarded.
- Symlinks must not be followed for content hashing.
- Sensitive untracked paths must not be persisted as relative paths and their content must not be read.
- A partial baseline must not terminally transition an active Task Run; it records evidence gaps while preserving lifecycle status.
- Git/filesystem observation occurs outside SQLite transactions. Controlled persistence occurs in one transaction.
- Baseline rows, untracked-entry rows, Workspace/Run updates, evidence gap, baseline Event, Event deduplication, and sequence allocation must commit atomically.
- Results, diagnostics, evidence details, and baseline Event payloads must not contain repository paths, commit IDs, diff/status hashes, untracked filenames, file content, Git output, exceptions, stacks, or secret material.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP server: Fastify 5.10.0 behind daemon ingress
- Persistence: built-in `node:sqlite` behind daemon repositories
- Canonical redacted JSON: OwnLoop Canonical JSON v1
- Normalized Event schema: `@ownloop/event-model` v1
- Git integration: system Git through Node.js built-ins only
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime dependency is authorized for OL-008. Use Node.js built-ins and existing workspace packages only.

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

Git baseline behavior belongs under `apps/daemon/src/git-baseline/` and persistence changes under the existing daemon persistence boundary. Do not create a new package or service for OL-008.

## Quality gates

Before declaring completion, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-008 tests must prove:

- migration 4→5, fresh migration, reopen, checksum history, SQL constraints, and immutability;
- clean, staged, unstaged, mixed dirty, untracked, symlink, large-file, sensitive-path, unborn, and non-Git cases;
- missing Git, command/output/timeout failures, repository-change detection, untracked-change detection, and late capture;
- deterministic working-tree fingerprints and change sensitivity;
- Workspace Git-root upgrade without Workspace merging;
- Task Run baseline fields and active lifecycle status preservation;
- one evidence gap for partial capture without duplication;
- atomic baseline/entry/Workspace/Run/evidence/Event/dedup/sequence persistence and rollback;
- one controlled `snapshot.baseline_captured` Event with no paths or hashes;
- idempotent reprocessing without Git execution or sequence consumption;
- deterministic bounded missing-baseline listing and batch capture;
- file-backed close/reopen durability;
- no Git mutation command and no raw diff/status/content persistence;
- no reconciliation, finalization, artifact, AI, or UI behavior.

Never claim a check passed unless it was executed successfully.

## Git and pull-request discipline

- Base work on the active task branch.
- Make focused commits.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep PRs draft until CI and review complete.
- Report files, commands, decisions, checks, limitations, and review findings.

## Current phase restriction

The active issue is `OL-008: Capture a privacy-bounded deterministic Git baseline` (#21).

Before implementing, read:

- issue #21 and comments;
- ADR-0003, ADR-0004, ADR-0008, ADR-0009, and ADR-0010;
- current Workspace, Task Run, evidence-gap, Event Store, transaction, migration, and normalization repositories;
- official Git documentation for status porcelain, diff, ls-files, and rev-parse.

Explicitly forbidden in OL-008:

- any Git mutation command;
- raw diff/status/content persistence;
- following symlinks for content reads;
- Workspace merging or Event re-parenting;
- post-tool or Stop repository reconciliation;
- final snapshots or terminal Run finalization/recovery;
- artifacts;
- background workers or schedulers;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

OL-008 is complete only when each eligible Task Run can obtain one deterministic privacy-bounded captured or partial Git baseline, with explicit provisional Workspace upgrade, controlled evidence, one sequenced synthetic baseline Event, atomic persistence, idempotent reprocessing, and no repository mutation or raw source persistence.
