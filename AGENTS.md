# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0017.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, installation tokens, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken strict contracts, runtime validation, type checking, linting, tests, database constraints, append-only evidence, artifact verification, transactionality, idempotency, or version discipline.
- OL-015 may consume only accepted persisted Run relationships and validated OL-013/OL-014 artifacts.
- Graph edges must be persisted or artifact-backed; timestamp, text, filename, tool-name, and similarity inference are forbidden.
- Diff hunks are not retained. Do not create hunk nodes or hunk-level support claims.
- Evidence IDs must remain stable, opaque, Run-scoped, and free of paths, hashes, commands, output, prompts, sessions, digests, and storage paths.
- Graph artifacts and safe resolution responses must remain privacy-bounded and deterministic.
- Do not add graph tables, caches, schedulers, repository/source reads, Git/command execution, AI/model calls, CORS, or a second listener.

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

No new runtime dependency is authorized for OL-015.

## Repository placement

- strict graph and resolution contracts belong in `packages/contracts/`;
- pure construction, canonical artifacts, explicit processors, and resolution belong in `apps/daemon/src/evidence-graph/`;
- SQL remains inside migration definitions and existing persistence repositories;
- authenticated resolution extends the existing Replay server;
- UI changes are factual evidence navigation only;
- architectural policy belongs in ADR-0017.

Do not create a graph database/table, mutable edge cache, new package/service/listener, scheduler, or visualization dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-015 tests must prove strict graph/resolution contracts, stable IDs and canonical bytes, persisted/artifact-backed relationships only, explicit limitations, migration v13, idempotency/concurrency, rollback/orphan cleanup, restart/tamper detection, Run-scoped authenticated resolution, Raw Replay evidence IDs, accessible UI navigation, and no repository/AI boundary.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-015-evidence-graph` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-015: Build a deterministic locally resolvable evidence graph` (#44).

Before implementing, read Issue #44, ADR-0009 and ADR-0011 through ADR-0017, the Event, reconciliation, finalization, OL-013, OL-014, artifact-store, migration, Replay server, and web viewer code.

Explicitly forbidden:

- invented diff-hunk evidence or unsupported absence claims;
- relationships inferred from timestamp, text, filenames, tool names, or similarity;
- repository/source/AST/package-content reads or Git/command execution;
- raw paths, hashes, commands, output, sessions, artifact storage metadata, or exceptions in Graph/public resolution;
- graph/node/edge tables, mutable caches, arbitrary graph traversal APIs, background workers, or startup processing;
- semantic claim generation, candidate Moments, AI, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-015 is complete only when accepted Run facts and deterministic artifacts are connected by stable locally resolvable evidence IDs, every relationship is source-backed, limitations remain explicit, and Raw Replay navigates to authoritative evidence without widening privacy or execution boundaries.
