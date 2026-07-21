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
13. `docs/adr/0012-content-addressed-artifact-store-before-reconciliation.md`
14. `docs/architecture/C4.md`
15. `docs/product/BACKLOG_v0.1.0.md`
16. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

Accepted ADR dependency order takes precedence over the historical numerical backlog order. OL-010 is intentionally implemented before OL-009 because reconciliation requires durable artifact references.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, machine-specific roots, raw Git data, or source-file content.
- Do not weaken type checking, linting, tests, database constraints, content integrity, root containment, transactionality, idempotency, reference safety, or garbage-collection protections to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- The artifact store accepts only caller-declared prepared content. It does not redact or infer whether raw content is safe.
- Artifact object paths are derived internally from validated SHA-256 digests. No caller-controlled storage path is allowed.
- The absolute artifact root must never be persisted in ordinary metadata or exposed in safe results/errors.
- The artifact root must not overlap any analyzed repository root supplied by the caller.
- Artifact objects are immutable and must never be replaced in place.
- Metadata/content conflicts and corruption must fail safely rather than being silently repaired.
- Shared artifact content must survive deletion of any one Task Run while another reference exists.
- Garbage collection is explicit, bounded, reference-aware, and never background-driven in OL-010.
- Results and errors must not contain prepared bytes, absolute roots, analyzed repository paths, arbitrary filesystem paths, exceptions, stacks, or secret material.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP server: Fastify 5.10.0 behind daemon ingress
- Persistence: built-in `node:sqlite` behind daemon repositories
- Artifact content identity: SHA-256 through Node.js built-ins
- Artifact filesystem I/O: Node.js built-ins only
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime dependency is authorized for OL-010.

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

Artifact-store behavior belongs under `apps/daemon/src/artifact-store/` and persistence changes under the existing daemon persistence boundary. Do not create a new service or package for OL-010.

## Quality gates

Before declaring completion, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-010 tests must prove:

- migration 5→6, fresh migration, reopen, checksum history, constraints, and legacy-row preservation;
- atomic prepared-content writes and digest/path derivation;
- bounded byte and streaming writes;
- concurrent content deduplication;
- metadata conflict and sensitivity escalation rules;
- root overlap/path containment/symlink/corruption rejection;
- transactionally safe Run references and shared-content survival;
- explicit bounded metadata/file garbage collection;
- controlled orphan-object sweeping;
- file-backed close/reopen durability;
- no absolute root/content leakage;
- no Git reconciliation, redaction, cloud, background worker, AI, or UI behavior.

Never claim a check passed unless it was executed successfully.

## Git and pull-request discipline

- Base work on the active task branch.
- Make focused commits.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep PRs draft until CI and review complete.
- Report files, commands, decisions, checks, limitations, and review findings.

## Current phase restriction

The active issue is `OL-010: Implement local content-addressed artifact store` (#25).

Before implementing, read:

- issue #25 and comments;
- ADR-0004, ADR-0005, ADR-0010, and ADR-0011;
- current artifact/run-reference schema and repository;
- current transaction, migration, error, Task Run, and Workspace persistence code.

Explicitly forbidden in OL-010:

- Git reconciliation or diff generation;
- content redaction/reduction;
- arbitrary caller-selected relative storage paths;
- writes inside analyzed repositories;
- replacing existing digest objects;
- sensitivity downgrade;
- deleting referenced/shared artifacts;
- automatic/background GC;
- compression, encryption, or cloud replication;
- finalization/recovery;
- artifact UI rendering;
- AI, analytics, telemetry, billing, or user authentication.

OL-010 is complete only when prepared local content can be stored once by SHA-256, verified on read, linked safely to multiple Task Runs, and explicitly garbage-collected only when unreferenced, with no storage-root overlap, content leakage, external runtime dependency, or reconciliation scope.