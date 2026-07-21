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
12. `docs/adr/0011-evidence-bounded-git-reconciliation.md`
13. `docs/architecture/C4.md`
14. `docs/product/BACKLOG_v0.1.0.md`
15. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over historical backlog order.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, machine-specific paths, raw Git diffs, raw status output, or source-file content.
- Do not weaken type checking, linting, tests, database constraints, privacy limits, evidence attribution, read-only Git guarantees, transactionality, idempotency, append-only guarantees, or sequence integrity to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- Git/filesystem observation occurs outside SQLite transactions. Controlled persistence occurs in one transaction.
- Git execution must remain shell-free, read-only, time-bounded, and output-bounded.
- Current status paths are not automatically agent changes.
- `run_relative` attribution is permitted only from a complete clean baseline and complete current observation.
- A dirty baseline permits only `observed_only` attribution.
- Missing/partial evidence requires `unavailable` attribution.
- If the reliable working-tree fingerprint is unchanged, do not emit per-path file Events.
- Raw porcelain-v2 bytes are ephemeral parser input only and must be released after controlled metadata extraction.
- Sensitive repository paths must have null persisted relative paths and must never appear in safe results, evidence messages, or Event payloads.
- Summary/file Events, Event deduplication, sequence allocation, reconciliation row, entry rows, and optional evidence gap must commit atomically.
- OL-009 must not mutate Workspace, Conversation, Task Run lifecycle status, baseline records, receipt state, or lifecycle/normalization records.
- Results, diagnostics, evidence details, and summary Events must not contain repository paths, commit IDs, Git hashes, raw status/diff bytes, filenames, content, source/session IDs, exceptions, stacks, or secret material.

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

No external runtime dependency is authorized for OL-009. Use Node.js built-ins and existing workspace packages only.

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

Repository reconciliation belongs under `apps/daemon/src/git-reconciliation/`. Shared read-only Git observation may be reused from `apps/daemon/src/git-baseline/`. Persistence changes remain under the existing daemon persistence boundary. Do not create a new package or service.

## Quality gates

Before declaring completion, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-009 tests must prove:

- migration 5→6, fresh migration, reopen, checksum history, SQL constraints, cascades, and immutability;
- strict porcelain-v2 ordinary/unmerged/untracked parsing and invalid-input rejection;
- deterministic entry ordering independent of Git output order;
- sensitive-path privacy;
- clean baseline `run_relative`, dirty baseline `observed_only`, and missing/partial baseline `unavailable` attribution;
- unchanged fingerprint suppression of file Events;
- tool-batch, Stop, and StopFailure boundaries;
- rejection before Git execution for non-eligible/conversation-level triggers;
- contiguous summary/file Event sequences and deterministic deduplication;
- atomic rollback with no Events, reconciliation, entries, evidence, or sequence gap;
- idempotent reprocessing without Git execution;
- bounded deterministic eligible batches;
- file-backed durability and corruption detection;
- safe result/evidence/Event surfaces;
- no lifecycle mutation, Git mutation, finalization, artifacts, AI, or UI behavior.

Never claim a check passed unless it was executed successfully.

## Git and pull-request discipline

- Base work on the active task branch.
- Make focused commits.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep PRs draft until CI and review complete.
- Report files, commands, decisions, checks, limitations, and review findings.

## Current phase restriction

The active issue is `OL-009: Reconcile repository state at tool-batch and stop boundaries` (#23).

Before implementing, read:

- issue #23 and comments;
- ADR-0003, ADR-0009, ADR-0010, and ADR-0011;
- current baseline observation, Event Store, evidence-gap, sequence, migration, and Task Run repositories;
- official Git porcelain-v2 documentation.

Explicitly forbidden in OL-009:

- Git mutation;
- raw diff/status/content persistence;
- claiming exact tracked-path deltas from a dirty or partial baseline;
- Workspace, Conversation, or Task Run lifecycle mutation;
- final snapshots or terminal finalization/recovery;
- Workspace merging;
- artifacts;
- background workers or schedulers;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

OL-009 is complete only when every eligible tool-batch/Stop trigger can produce one deterministic captured or partial reconciliation, with evidence-bounded attribution, privacy-safe path observations, contiguous append-only Events, atomic persistence, idempotent reprocessing, and no false claim that pre-existing dirty state was created by the agent.
