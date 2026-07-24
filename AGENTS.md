# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0019.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine roots, or exception stacks.
- Do not weaken strict contracts, canonical bytes, evidence ownership, artifact verification, migration history, transactionality, idempotency, or bounded processing.
- OL-017 may read only the persisted ingress-redacted goal, validated OL-015 graph, validated OL-014 verification artifact, and controlled versions.
- `enabled: false` must return before any sensitive read or write.
- Every model-visible factual item must retain graph-owned Evidence IDs.
- Second-pass redaction must fail closed and must not expose paths, URLs, emails, IPs, credentials, commands, source content, or artifact storage metadata.
- Budget reduction must be deterministic and must not convert missing evidence into a claim.
- Do not call providers/models, construct provider prompts, persist Candidates, add jobs/queues/schedulers, or read repository/source/transcript content.

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

No new runtime dependency is authorized for OL-017.

## Repository placement

- strict semantic-input and safe-result contracts belong in `packages/contracts/`;
- pure redaction, reduction, canonical artifact, processor, and read-back logic belong in `apps/daemon/src/semantic-input/`;
- migration v14 may add only artifact-reference invariants in the existing persistence boundary;
- architectural policy belongs in ADR-0019.

Do not create a new package, semantic-input table/cache, provider service, listener, worker, job queue, scheduler, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-017 tests must prove strict contracts, second-pass redaction, evidence ownership, deterministic canonical bytes and estimates, fixed priority reduction, disabled no-read behavior, migration v14 invariants, OL-010 persistence/read-back, restart/tamper detection, bounded batch order, and no repository/network/provider boundary.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-017-reduced-semantic-input` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-017: Build deterministic reduced and redacted semantic-analysis input` (#49).

Before implementing, read Issue #49, ADR-0015 through ADR-0019, OL-010 artifact storage, OL-011 finalization, OL-014 verification, OL-015 Evidence Graph, and OL-016 Candidate contracts.

Explicitly forbidden:

- repository/worktree/source/AST/package-content reads, Git commands, raw transcript, raw Hook receipts, arbitrary Event payloads, commands, patches, or hunks;
- provider/model calls, provider-specific prompts, credentials, pricing, retries, or generation records;
- Candidate generation/persistence, support validation, contradiction detection, deduplication, or ranking;
- unbounded or non-deterministic reduction, inferred relationships, or facts without Evidence IDs;
- semantic-input tables/caches, `analysis_jobs`, workers, timers, schedulers, routes, UI, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-017 is complete only when an explicitly enabled finalized Run can produce one byte-reproducible, second-pass-redacted, Evidence-ID-addressed OL-010 artifact under fixed budgets, while disabled processing performs no sensitive read or write.
