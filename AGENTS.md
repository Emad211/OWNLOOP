# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0021.

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

No new runtime dependency is authorized for OL-019.

## OL-019 placement

- contracts/report/provenance belong in `packages/contracts/src/candidate-validation.ts`;
- pure validation, canonical artifact, processor, and read-back belong in `apps/daemon/src/candidate-validation/`;
- immutable provenance belongs in the existing SQLite persistence boundary through migration v16;
- architecture policy belongs in ADR-0021.

Do not create a new package, background worker, job queue, scheduler, model judge, embedding index, vector store, route, UI, mutable validation cache, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-019 tests must prove strict contracts, exact Evidence resolution, type support, conservative claim grammar, contradiction and absence rejection, duplicate grouping, integer ranking, maximum-seven selection, deterministic canonical report bytes, migration v16 invariants, persistence/read-back, concurrency, restart, tamper detection, orphan GC, exact lookup, bounded batch order, and no repository/network/model boundary.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-019-candidate-validation` from the exact OL-018 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-019: Validate, deduplicate, rank, and select Candidate Moments` (#56).

Explicitly forbidden:

- provider/model calls, embeddings, vector similarity, model-based judging, broad natural-language entailment, or Candidate rewriting;
- repository/worktree/source/AST/package-content reads, raw transcript, raw Hook receipts, arbitrary Event payloads, commands, patches, or hunks;
- inferred Evidence relationships from path, time, wording, or similarity;
- absence/completeness/security/correctness claims without an explicit future graph-owned absence fact;
- mutable validation state, `analysis_jobs`, workers, timers, schedulers, routes, UI, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-019 is complete only when verified OL-018 Candidates are deterministically rejected, deduplicated, ranked, and selected from exact OL-015 Evidence, with byte-reproducible OL-010 report bytes and strict restart/tamper validation.
