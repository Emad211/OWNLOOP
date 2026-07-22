# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0014.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, installation tokens, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken strict contracts, runtime validation, authentication, type checking, linting, tests, database constraints, append-only Events, sequence integrity, artifact verification, transactionality, idempotency, evidence gating, or recovery safety.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, skipped tests, arbitrary HTML injection, or external browser assets without an issue-specific accepted decision.
- Raw Replay is a read-only projection. It must not mutate lifecycle, Events, evidence, Git, artifacts, finalizations, or receipts.
- Causality may be displayed only from persisted relationships. Do not infer edges from time, text, filenames, or similarity.
- Missing verification is not success. Missing or inconsistent terminal evidence is not silently repaired.
- Browser contracts and output must not contain repository roots, commit IDs, Git hashes/fingerprints, source-session IDs, artifact digests/storage paths, sensitive filenames, raw source, or tokens.
- Browser installation tokens are memory-only and may be sent only to `window.location.origin` as a Bearer header.
- Do not add localStorage, sessionStorage, IndexedDB, cookies, URL token transport, CORS, or a second network listener.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP: Fastify 5.10.0 on authenticated IPv4 loopback
- Persistence: built-in `node:sqlite`
- UI: React 19.2.7 and Vite 8.1.5
- Artifact store: local SHA-256 content-addressed storage
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No new runtime dependency is authorized for OL-012.

## Repository placement

- shared replay contracts belong in `packages/contracts/`;
- read-only projection, routes, cursor handling, and contained static delivery belong in `apps/daemon/src/replay/`;
- SQL remains inside persistence repositories;
- browser viewer and same-origin client belong in `apps/web/`;
- architectural policy belongs in ADR-0014.

Do not create a new service, listener, database table, replay cache, or package.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-012 tests must prove:

- strict Raw Replay v1 list, detail, error, causal-link, changed-file, evidence, finalization, artifact, and manifest contracts;
- deterministic list ordering, code-point prompt preview, cursor pagination, and malformed cursor rejection;
- `Capturing`, `Finalizing`, `Completed`, `Partial`, `Failed`, and `Abandoned` display semantics;
- contiguous bounded Event reads and persisted causal relationships only;
- absence of paths, roots, commits, hashes, fingerprints, source-session identifiers, artifact digest/storage paths, sensitive filenames, raw payloads, and tokens;
- authentication before every replay read;
- real loopback list/detail/artifact routes and content-free errors;
- OL-010 verified and bounded artifact delivery;
- static root containment, traversal/encoded traversal/symlink rejection, SPA fallback, and security headers;
- missing/invalid web root does not break API routes;
- browser token is memory-only, API origin is same-origin, and UI uses no dangerous HTML or external assets;
- functional accessible loading, empty, error, in-progress, complete, partial, failed, abandoned, evidence-gap, no-verification, and artifact states;
- no persistence mutation or new migration.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-012-raw-replay` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-012: Implement the deterministic Raw Replay API and local browser viewer` (#37). Issue #32 and PR #34 are superseded and must not be reused.

Before implementing, read issue #37, ADR-0003, ADR-0006, ADR-0009 through ADR-0014, and the current ingress auth/server, persistence repositories, artifact store, finalization, contracts, and web code.

Explicitly forbidden:

- replay database/cache or projection migration;
- inferred causality or success;
- raw receipt/Git/source/artifact metadata exposure;
- direct artifact filesystem reads;
- lifecycle, Event, evidence, Git, artifact, or finalization mutation;
- token persistence or arbitrary browser API host;
- CORS, second listener, remote binding, HTTPS termination, or multi-user auth;
- AI summaries, classification, Moments, Evidence Graph, cloud, analytics, telemetry, or billing.

OL-012 is complete only when accepted persisted facts can be viewed through a deterministic, bounded, privacy-safe, authenticated Raw Replay contract and same-origin local viewer without creating a second truth model or widening the local security boundary.
