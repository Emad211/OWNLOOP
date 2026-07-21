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
11. `docs/architecture/C4.md`
12. `docs/product/BACKLOG_v0.1.0.md`
13. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over the historical order in the original backlog.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, canonicalization, redaction, authentication, fail-open semantics, transactionality, idempotency, append-only guarantees, or sequence integrity to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned contracts remain controlled and versioned.
- Persist-before-acknowledge remains mandatory.
- Unredacted source payloads must never be written to persistent storage.
- Event normalization may read only prepared receipt metadata, canonical redacted payload JSON, and immutable lifecycle resolution.
- Event append, per-output deduplication, sequence allocation, receipt normalization, and receipt/Event linkage must commit in one transaction.
- OL-007 must not mutate Workspace, Conversation, Task Run, receipt processing status, lifecycle resolution, Git state, or artifacts.
- Source Events may persist only canonical redacted payload objects.
- Synthetic Events may contain controlled lifecycle fields only.
- Results, diagnostics, and errors must not contain prompt content, paths, source/session IDs, payloads, fingerprints, exceptions, stacks, or secret material.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP server: Fastify 5.10.0 behind daemon ingress
- Persistence: built-in `node:sqlite` behind daemon repositories
- Canonical redacted JSON: OwnLoop Canonical JSON v1
- Normalized Event schema: `@ownloop/event-model` v1
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime dependency is authorized for OL-007. Use Node.js built-ins and existing workspace packages only.

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

Normalization behavior belongs under `apps/daemon/src/normalization/` and persistence changes under the existing daemon persistence boundary. Do not create a new package or service for OL-007.

## Quality gates

Before declaring completion, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-007 tests must prove:

- migration 3→4, fresh migration, reopen, and checksum behavior;
- all nine Hook mappings and multi-Event order;
- source versus synthetic payload, sensitivity, metadata, and timestamp policy;
- positive contiguous per-Run sequence allocation and continuation;
- Event/dedup/link/normalization atomicity and rollback without gaps;
- repeated processing idempotency;
- failed lifecycle skip behavior;
- invalid payload/mapping controlled failures;
- deterministic bounded eligible batches;
- file-backed close/reopen replay order;
- append-only Event and normalization immutability;
- content-free results/errors;
- zero lifecycle, Git, or artifact mutation.

Never claim a check passed unless it was executed successfully.

## Git and pull-request discipline

- Base work on the active task branch.
- Make focused commits.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep PRs draft until CI and review complete.
- Report files, decisions, checks, limitations, and review findings.

## Current phase restriction

The active issue is `OL-007: Normalize lifecycle-resolved receipts into sequenced Events` (#19).

Before implementing, read:

- issue #19 and comments;
- ADR-0003, ADR-0004, ADR-0005, ADR-0008, and ADR-0009;
- current prepared receipt, lifecycle resolution, Event Store, transaction, migration, and Event-model code.

Explicitly forbidden in OL-007:

- Workspace, Conversation, or Task Run mutation;
- receipt lifecycle or processing-status mutation;
- Git discovery, baseline, status, diff, or reconciliation;
- finalization/recovery;
- artifacts;
- Evidence Graph, Ownership Moments, or Build Replay;
- background worker/scheduler;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

OL-007 is complete only when every supported non-failed lifecycle-resolved receipt deterministically produces the defined append-only Event sequence—or an immutable controlled skip/failure—while Event append, deduplication, sequence allocation, normalization, and linkage remain transactionally atomic and idempotent.
