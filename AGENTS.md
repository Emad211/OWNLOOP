# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0016.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, installation tokens, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken strict contracts, runtime validation, type checking, linting, tests, database constraints, append-only evidence, sequence continuity, artifact verification, transactionality, idempotency, or version discipline.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, skipped tests, semantic guessing, arbitrary payload traversal, or hidden I/O without an accepted issue-specific decision.
- OL-014 may consume only immutable finalization, sequenced canonical/redacted Events, and validated OL-013 classification evidence.
- It must not execute commands, invoke a shell, read repository/source files, run Git, inspect prompts/transcripts, or contact an agent/model.
- Changed test files are not test executions. Missing execution is not success. Ambiguous commands remain `unknown`.
- Output text cannot override the persisted Hook outcome or explicit consistent exit status.
- Reduced output excerpts belong only in the sensitive OL-010 artifact; derived Events and safe results contain no raw command/output.
- Derived Events must be deterministic, contiguous, deduplicated, replay-safe, and transactionally consistent with the artifact reference.
- Do not use `analysis_jobs` or add a scheduler/background worker.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- Persistence: built-in `node:sqlite`
- Artifact store: local SHA-256 content-addressed storage
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No new runtime dependency is authorized for OL-014.

## Repository placement

- strict verification contracts belong in `packages/contracts/`;
- command recognition, output reduction, canonical artifact preparation, and explicit processors belong in `apps/daemon/src/verification-extraction/`;
- SQL remains inside persistence repositories and migration definitions;
- Replay may project only controlled derived Event payloads;
- architectural policy belongs in ADR-0016.

Do not create a new package, service, listener, verification table, replay cache, scheduler, or command runner.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-014 tests must prove strict contracts, deterministic recognition/reduction/artifact bytes, source-backed outcomes, explicit unknown/no-observation semantics, test-file separation, bounds, migration v12, controlled derived Events, contiguous sequences, idempotency/concurrency, rollback/GC, restart/tamper detection, bounded batches, Raw Replay privacy, and no execution/repository/AI boundary.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-014-verification-extraction` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-014: Extract deterministic verification evidence from observed commands and classified files` (#42).

Before implementing, read Issue #42, ADR-0009 and ADR-0012 through ADR-0016, the Event, finalization, OL-013, artifact-store, migration, and Raw Replay code.

Explicitly forbidden:

- command execution, retries, shell interpretation, or project mutation;
- source, AST, package-content, prompt, transcript, or arbitrary output semantics;
- verification inference from changed files, terminal status, or absence of failure;
- repository/Git reads or mutation;
- raw command/output in derived Events or safe results;
- verification tables, generic analysis-job scheduling, background workers, or startup processing;
- Evidence Graph, replay UI evidence navigation, candidate Moments, AI, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-014 is complete only when accepted command executions and test-file changes produce reproducible, privacy-bounded, source-backed verification evidence with immutable OL-010 artifacts, controlled derived Events, explicit unknown/not-observed outcomes, restart-safe validation, and no execution or semantic-inference boundary.
