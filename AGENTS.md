# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0026.

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

No new runtime dependency is authorized for OL-024.

## OL-024 placement

- strict diagnostics dashboard and sanitized-bundle contracts belong in `packages/contracts/src/diagnostics-dashboard.ts`;
- persisted redaction/Run/finalization/Evidence-gap aggregate reads belong in the existing SQLite repository boundary and must never select payload JSON, prompts, paths, gap messages/details, or Candidate prose;
- deterministic aggregation, verified OL-019 report read-back, fingerprints, and in-memory bundle preparation belong in `apps/daemon/src/diagnostics-dashboard/`;
- authenticated GET-only diagnostics routes reuse the existing loopback server;
- the accessible read-only dashboard and ephemeral export belong in `apps/web/`;
- architecture policy belongs in ADR-0026.

Do not add a migration, diagnostic table, durable bundle, raw-log archive, worker, scheduler, provider/model call, repository/source read, new listener, CORS surface, browser storage, cloud, analytics, telemetry, billing, accounts, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-024 tests must prove strict dashboard/bundle contracts, deterministic fingerprints, process hook and rejection-code counts, diagnostics-off and restart-reset semantics, validated redaction aggregates without payload reads, Run/finalization/Evidence-gap aggregates, verified OL-019 outcome and reason counts, recent-Run ordering/truncation, authenticated no-store/nosniff routes, exact bundle headers/length, ephemeral export URL revocation, accessible dashboard states, and absence of payloads, prompts, paths, Candidate prose, Evidence IDs/text, provider data, secrets, durable bundles, background work, browser storage, cloud, analytics, telemetry, billing, accounts, or multi-user authentication.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-024-diagnostics-dashboard` from the exact OL-023 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-024: Add diagnostics and evidence-quality dashboard` (#69).

Explicitly forbidden:

- selecting or exporting raw/redacted payload JSON, prompts, original goals, repository/source content, paths, commits, commands, outputs, Candidate prose, Evidence IDs/text, provider data/secrets, installation credentials, source-session/tool-use IDs, artifact metadata/bytes, free-form text, exceptions, or stacks;
- aggregating validation reasons without verified OL-019 report/artifact/provenance read-back;
- interpreting a zero process counter as proof that no event occurred;
- modifying ingestion, finalization, validation, Evidence, settings, retention, deletion, or replay state from diagnostics routes/UI;
- a migration, diagnostic table, durable bundle artifact, raw-log archive, background collector, worker, scheduler, automatic export, provider/model call, repository/source read, new listener, CORS, browser storage, cloud, analytics, telemetry, billing, accounts, roles, teams, or remote authentication.

OL-024 is complete only when one bounded deterministic dashboard and one ephemeral sanitized JSON bundle are authenticated, privacy-bounded, tamper-aware, accessible, restart-honest, and fully tested without adding a new storage or processing surface.
