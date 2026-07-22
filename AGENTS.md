# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0013.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken type checking, linting, tests, database constraints, append-only Events, sequence integrity, artifact integrity, transactionality, idempotency, evidence gating, or recovery safety.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without an issue-specific documented reason.
- Completion is evidence-gated. Missing evidence is represented as `Partial`, `Failed`, or `Abandoned`; it is never inferred away.
- Finalization may consume only accepted lifecycle, baseline, reconciliation, Event, evidence-gap, and artifact-store boundaries.
- Raw Git status, patch/diff bytes, commit hashes, repository roots, prompts, source/session IDs, and file contents must not enter final manifests, synthetic Events, safe results, or evidence messages.
- Artifact bytes may be materialized before the SQLite transaction, but the Run reference must be created inside the finalization transaction. A failed transaction may leave only an unreferenced GC-eligible object.
- A terminal Run, immutable finalization row, terminal Event, final snapshot Event when applicable, artifact reference, final fingerprint, evidence gaps, and sequence allocation must be transactionally consistent.
- Crash recovery must never invoke, contact, or resume Claude Code.
- Repeated and concurrent finalization/recovery must not duplicate Events, sequences, artifact references, or evidence gaps.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP: Fastify 5.10.0 behind daemon ingress
- Persistence: built-in `node:sqlite`
- Artifact store: local SHA-256 content-addressed storage
- Git integration: read-only system Git through Node.js built-ins
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime dependency is authorized for OL-011.

## Repository placement

Finalization behavior belongs under `apps/daemon/src/finalization/`. Persistence changes stay inside the existing daemon persistence boundary. Do not create a new package or service.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-011 tests must prove:

- migration 7→8, fresh migration, reopen, checksum history, SQL constraints, aggregate linkage, and immutability;
- normal complete Stop → Completed;
- incomplete normal Stop → Partial;
- StopFailure → Failed;
- deterministic privacy-bounded manifest creation and artifact deduplication;
- contiguous final snapshot/terminal Event sequences and deterministic deduplication;
- terminal Run/finalization/Event/artifact/evidence writes are atomic;
- rollback leaves no terminal state, reference, Event, evidence increment, or sequence gap;
- idempotent and concurrent finalization;
- stale Capturing → Abandoned and stale Finalizing → forced Partial;
- stale status/time re-check inside the write transaction;
- bounded deterministic recovery after file-backed restart;
- corruption detection for aggregate, trigger Event, reconciliation, artifact, snapshot Event, and terminal Event linkage;
- safe results/errors and manifest/Event/evidence surfaces contain no sensitive values;
- no agent resume, Git mutation, raw patch persistence, background scheduler, replay UI, AI, cloud, analytics, telemetry, billing, or authentication behavior.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-011-finalization-recovery`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-011: Implement deterministic run finalization and crash recovery` (#29).

Before implementing, read issue #29, ADR-0003, ADR-0008 through ADR-0013, and the current Task Run, Event, Git baseline, Git reconciliation, evidence-gap, artifact-store, transaction, migration, and persistence error code.

Explicitly forbidden:

- raw Git status/patch/content capture;
- a parallel repository-analysis model;
- agent/session probing or resume;
- automatic timers/background scheduling;
- arbitrary terminal-status inference;
- terminal Run mutation without an immutable finalization row;
- artifact content or paths in safe results/errors;
- replay API/UI projection;
- AI summaries or Ownership Moments;
- cloud replication, analytics, telemetry, billing, or user authentication.

OL-011 is complete only when every eligible Run can be finalized or recovered deterministically into exactly one terminal state with immutable evidence-backed finalization metadata, contiguous append-only terminal Events, an optional prepared final-manifest artifact, explicit evidence gaps, idempotency, crash durability, and no agent resumption.