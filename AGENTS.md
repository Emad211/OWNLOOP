# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0022.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require an ADR.

## Development policy

- Work on exactly one issue and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, databases, raw Git output, prepared artifact bytes, source content, machine roots, provider responses, exception messages, or stacks.
- Do not weaken strict contracts, canonical bytes, Evidence ownership, artifact verification, migration history, transactionality, idempotency, bounded processing, or fail-closed read-back.
- Provider confidence and importance are bounded ranking signals, never proof.
- Missing evidence must not be converted into an absence claim.
- Unsupported semantic prose must be rejected rather than interpreted with a hidden model or heuristic similarity.

## Technical baseline

- Node.js 24.18.0
- TypeScript 6.0.3 strict mode
- pnpm 11.4.0
- Zod 4.4.3
- built-in `node:sqlite`
- local SHA-256 content-addressed artifact storage
- Vitest, GitHub Actions, Biome

No new runtime dependency is authorized for OL-020.

## OL-020 placement

- strict browser projection contracts belong in `packages/contracts/src/ownership-moments.ts`;
- read-only verified source joining belongs in `apps/daemon/src/ownership-moments/`;
- current-policy validation lookup remains inside the existing persistence repository;
- the authenticated GET route extends the existing Replay server;
- accessible page-memory-only rendering belongs in `apps/web/`;
- architecture policy belongs in ADR-0022.

Do not create a migration, table, artifact, write endpoint, processor trigger, background worker, scheduler, browser storage, new listener, CORS surface, model call, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-020 tests must prove strict projection contracts, current-policy latest-validation selection, exact OL-018/019/015 joins, selected-only wording, maximum-seven and zero-Moment states, read-only authenticated routes, Run-scoped Evidence navigation, page-memory interactions and resets, proposal/support/signal separation, browser privacy, accessibility, full regression, and production builds.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-020-ownership-moments` from the exact OL-019 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-020: Render finite Ownership Moments with local evidence navigation` (#58).

Explicitly forbidden:

- rendering rejected, duplicate, or valid-unselected Candidate prose;
- treating provider confidence/importance as Evidence, proof, correctness, agreement, comprehension, or ownership;
- Candidate generation, validation, reranking, rewriting, or any other processing side effect from a GET route;
- persistence migrations, Moment/interaction tables, artifact creation, write endpoints, browser storage, workers, timers, or schedulers;
- repository/worktree/source/AST/package-content reads, raw provider responses, semantic input, transcripts, commands, output excerpts, paths, artifact storage metadata, exceptions, or stacks;
- a new listener, CORS, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-020 is complete only when one exact verified current-policy OL-019 validation can be joined with its verified OL-018 source Candidates and OL-015 Evidence Graph into a finite selected-only projection, rendered accessibly with Run-scoped Evidence navigation and explicitly unsaved page-memory interactions.
