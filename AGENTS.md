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
13. `docs/adr/0012-local-content-addressed-artifact-store.md`
14. `docs/architecture/C4.md`
15. `docs/product/BACKLOG_v0.1.0.md`
16. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over historical backlog order.

## Development policy

- Work on exactly one issue at a time.
- Keep each pull request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Prefer the smallest maintainable solution.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, machine-specific roots, raw Git data, prepared artifact bytes, or source-file content.
- Do not weaken type checking, linting, tests, database constraints, content integrity, root containment, transactionality, idempotency, immutable object identity, reference safety, or garbage-collection protections to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented issue-specific reason.
- Accepted ADRs are immutable implementation inputs. Architectural changes require a new ADR.
- The artifact store accepts only caller-declared prepared content. It does not redact or infer whether raw content is safe.
- Artifact paths are internally derived from validated SHA-256 digests; caller-selected storage paths are forbidden.
- The canonical artifact root must not overlap an analyzed repository root and must never be persisted in ordinary metadata or exposed in safe results/errors.
- Artifact objects are immutable and must never be replaced in place. Existing objects are verified by type, size, and digest.
- Sensitivity may escalate but never downgrade.
- Shared artifact content must survive deletion or unlinking of any one Run reference while another reference exists.
- Garbage collection and orphan sweeping are explicit, bounded, reference-aware, and never background-driven in OL-010.
- Safe errors must not contain prepared bytes, roots, analyzed paths, arbitrary filesystem paths, exception text, or stacks.

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

No external runtime dependency is authorized for OL-010. Use Node.js built-ins and existing workspace packages only.

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

Artifact-store behavior belongs under `apps/daemon/src/artifact-store/`. Persistence changes remain under the existing daemon persistence boundary. Do not create a new package or service.

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

- migration 6→7, fresh migration, reopen, immutable checksum history, constraints, and legacy-row preservation;
- atomic bounded prepared-byte and prepared-stream writes;
- concurrent identical-content deduplication;
- digest/path derivation, root overlap rejection, containment, symlink rejection, and corruption detection;
- immutable content identity, metadata conflict detection, and sensitivity escalation without downgrade;
- idempotent transactional Run references and shared-content survival;
- verified reads and rejection of unsupported legacy rows;
- explicit bounded reference-aware GC and controlled missing-object handling;
- orphan sweeping restricted to the exact digest layout without following symlinks;
- file-backed close/reopen durability and private permissions where supported;
- safe result/error surfaces;
- no Git reconciliation, redaction, finalization, background scheduler, cloud, AI, or UI behavior.

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

- issue #25 and its execution-correction comment;
- ADR-0004, ADR-0010, ADR-0011, and ADR-0012;
- current artifact/run-reference schema, transaction boundary, migration history, Task Run repository, and persistence errors.

Explicitly forbidden in OL-010:

- Git reconciliation or diff generation;
- content redaction or reduction;
- arbitrary caller-selected storage paths;
- writes inside analyzed repositories;
- replacing existing digest objects;
- sensitivity downgrade;
- deleting referenced or shared artifacts;
- automatic/background GC;
- compression, encryption, or cloud replication;
- finalization/recovery;
- artifact UI rendering;
- AI, analytics, telemetry, billing, or user authentication.

OL-010 is complete only when prepared local content can be stored once by SHA-256, verified on read, linked safely to multiple Task Runs, and explicitly garbage-collected only when unreferenced, with no storage-root overlap, content leakage, external runtime dependency, or reconciliation scope.
