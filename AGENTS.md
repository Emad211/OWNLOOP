# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0025.

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

No new runtime dependency is authorized for OL-023.

## OL-023 placement

- strict local settings/privacy contracts belong in `packages/contracts/src/local-settings.ts`;
- migration v18 and compare-and-swap persistence belong in the existing SQLite boundary;
- memory-only provider secrets, diagnostics, retention/deletion orchestration, and routes belong in `apps/daemon/src/local-settings/`;
- custom field-name redaction extends `packages/ingress-security/` without disabling built-in rules;
- the accessible settings/privacy experience belongs in `apps/web/`;
- architecture policy belongs in ADR-0025.

Do not persist provider secrets, accept arbitrary regex/value patterns, create a background retention worker, raw source-payload archive, account system, new listener, CORS surface, browser storage, cloud, analytics, telemetry, billing, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-023 tests must prove strict settings and API contracts, migration v18 defaults/invariants, compare-and-swap concurrency, restart durability, memory-only provider-secret behavior, disabled generation until complete configuration, explicit bounded retention preview/apply, terminal-only Run deletion, target-only cascades and artifact GC, off/counts-only diagnostics, fixed-off raw source-payload retention, bounded exact/prefix/suffix custom field-name redaction, authenticated no-store route behavior, accessible settings UI states, and absence of secret persistence, background scheduling, browser storage, cloud, analytics, telemetry, billing, accounts, or multi-user authentication.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-023-local-settings-privacy` from the exact OL-022 merge commit.
- Make focused commits and leave the final diff free of transfer/export workflows.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-023: Implement local settings and privacy controls` (#67).

Explicitly forbidden:

- persisting provider API keys, key-derived hashes, installation tokens, raw source payloads, prompts, repository/source content, artifact paths, exceptions, or stacks;
- automatic provider calls, generation scheduling, provider fallback routing, or provider marketplace behavior;
- background retention workers, timers, startup purges, TTL triggers, soft delete, or individual Event/interaction/Evidence deletion;
- arbitrary regular expressions, value-pattern secret matching, disabling built-in redaction, or retroactive receipt rewriting;
- raw diagnostic payload tables/artifacts, diagnostic bundle export, or exception-bearing diagnostics;
- a new listener, CORS, browser storage, cloud, analytics, telemetry, billing, accounts, roles, teams, or remote authentication.

OL-023 is complete only when one strict revisioned local settings document, process-memory provider secret, explicit retention/deletion flow, custom future-ingress field redaction, and allowlisted diagnostic counts are authenticated, restart-safe, privacy-bounded, accessible, and fully tested without adding hidden background behavior or durable secrets.
