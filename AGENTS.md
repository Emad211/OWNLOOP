# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0024.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require an ADR.

## Development policy

- Work on exactly one issue and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, databases, raw Git output, prepared artifact bytes, source content, machine roots, provider responses, exception messages, or stacks.
- Do not weaken strict contracts, canonical identities, Evidence ownership, artifact verification, migration history, transactionality, idempotency, append-only history, bounded reads, or fail-closed read-back.
- A recorded interaction proves only that the explicit action was stored. It does not prove comprehension, correctness, agreement, authorship, safety, or legal ownership.
- Provider confidence and importance remain proposal/ranking signals, never proof.

## Technical baseline

- Node.js 24.18.0
- TypeScript 6.0.3 strict mode
- pnpm 11.4.0
- Zod 4.4.3
- built-in `node:sqlite`
- local SHA-256 content-addressed artifact storage
- Vitest, GitHub Actions, Biome

No new runtime dependency is authorized for OL-022.

## OL-022 placement

- strict enriched Build Replay contracts belong in `packages/contracts/src/enriched-build-replay.ts`;
- pure deterministic composition belongs in `apps/daemon/src/enriched-replay/`;
- the authenticated GET route extends the existing Replay server;
- the finite read-only end-of-task UI belongs in `apps/web/`;
- architecture policy belongs in ADR-0024.

Do not create a migration, Build Replay table/cache/artifact, generated narrative, importance classifier, interaction write, new listener, CORS surface, background worker, scheduler, provider/model call, repository/source read, browser storage, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-022 tests must prove strict contracts, complete source identity, deterministic canonical fingerprinting, terminal gating, exact Raw Replay/Moment/interaction joins, selected-only wording, explicit Evidence-linked files, review-activity semantics, truncation and byte bounds, restart stability, interaction-driven fingerprint updates, source tamper detection, authenticated no-store GET behavior, accessible finite UI states, and absence of persistence or processing side effects.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-022-enriched-build-replay` from the exact OL-021 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-022: Produce deterministic enriched Build Replay` (#65).

Explicitly forbidden:

- generated prose summaries, hidden semantic interpretation, Candidate rewriting, ranking, deduplication, or filler content;
- inferring file importance from paths, extensions, timestamps, provider signals, or similarity;
- treating recorded views/responses as comprehension, correctness, approval, safety, authorship, or ownership;
- replay persistence, materialized cache/artifact, migration, background projection, or interaction writes from Build Replay;
- repository/worktree/source/AST/package reads, raw provider data, raw commands/output, diff hunks, artifact storage metadata, tokens, exceptions, or stacks;
- a new listener, CORS, workers, timers, schedulers, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-022 is complete only when a terminal Run can be deterministically composed from verified OL-012, OL-020, and OL-021 sources into one finite replay with explicit source identities, limitations, Evidence navigation, and recorded activity semantics, without introducing new persistence or factual inference.
