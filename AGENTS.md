# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0023.

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

No new runtime dependency is authorized for OL-021.

## OL-021 placement

- strict action, request, receipt, history, state, and Ownership Record contracts belong in `packages/contracts/src/moment-interactions.ts`;
- exact-Moment verification and interaction processing belong in `apps/daemon/src/moment-interactions/`;
- migration v17 and append-only relational access belong in the existing persistence boundary;
- authenticated GET/POST routes extend the existing Replay server;
- durable hydration and interaction controls belong in `apps/web/`;
- architecture policy belongs in ADR-0023.

Do not create an interaction artifact, mutable Moment/current-state table, free-form text field, account system, new listener, CORS surface, background worker, scheduler, provider call, browser storage, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-021 tests must prove strict contracts, migration 16→17, append-only history, exact validation/Moment/Evidence/choice verification, idempotent retries and conflicting reuse, atomic interaction/record writes, concurrency, restart durability, direct-SQL tamper detection, bounded recent history, deterministic current-state reduction, Run-scoped cascade deletion, authenticated GET/POST behavior, durable UI hydration, honest pending/saved/error states, and absence of browser storage or sensitive text.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-021-moment-interactions` from the exact OL-020 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-021: Persist append-only Moment interactions and bounded ownership records` (#63).

Explicitly forbidden:

- free-form notes, comments, arbitrary JSON, account/profile/device identity, or remote user identity;
- claiming that acknowledgement, response, answer, feedback, or views prove understanding, agreement, correctness, authorship, safety, learning, or ownership;
- interaction UPDATE, individual-row deletion, standalone history purge, mutable current-state rows, or browser persistence;
- Candidate generation, validation, ranking, rewriting, graph mutation, repository/source reads, provider/model calls, or artifact creation from an interaction route;
- raw Candidate prose, provider content, repository paths, commands, output, tokens, artifact storage metadata, exceptions, or stacks in interaction persistence or responses;
- a new listener, CORS, workers, timers, schedulers, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-021 is complete only when explicit actions against exact verified OL-020 Moments are stored as immutable append-only history, qualifying actions create bounded no-comprehension Ownership Records atomically, current state rehydrates deterministically, and full Run deletion remains the only deletion boundary.
