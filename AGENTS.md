# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0014.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, installation tokens, or exception stacks.
- Do not weaken type checking, runtime contracts, linting, tests, database constraints, append-only Events, sequence integrity, artifact integrity, transactionality, idempotency, evidence gating, or replay privacy.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without an issue-specific documented reason.
- Replay is a read-only deterministic projection. It must not repair, mutate, cache, or reinterpret accepted source-of-truth facts.
- Missing verification is displayed as not observed; it is never inferred as success.
- Evidence gaps and terminal diagnostics must remain visible and must not be styled or described as success.
- Replay JSON must exclude repository roots, commits, working-tree fingerprints, raw Event payloads, source/session/tool IDs, artifact digest/storage paths, raw Git output, patches, file content, exceptions, and stacks.
- Artifact reads must be Run-scoped, role/kind/media allowlisted, OL-010 verified, bounded, authenticated, and `no-store`.
- Browser installation-token handling is session-only. Never put it in localStorage, IndexedDB, URLs, rendered output, logs, or compiled assets.

## Technical baseline

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 strict mode
- Package manager: pnpm 11.4.0
- Runtime validation: Zod 4.4.3
- HTTP: Fastify 5.10.0 on IPv4 loopback
- Persistence: built-in `node:sqlite`
- Artifact store: local SHA-256 content-addressed storage
- UI: React 19 and Vite 8
- Tests: Vitest
- CI: GitHub Actions
- Formatting/linting: Biome

No external runtime, UI, router, state, CSS, chart, or testing dependency is authorized for OL-012.

## Repository placement

- Replay contracts belong in `packages/contracts`.
- Replay projection and routes belong under `apps/daemon/src/replay/` and existing persistence repositories.
- UI/client code belongs under `apps/web/src/` and Vite configuration.
- Do not add a new service, database table, replay cache, or background projector.

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

- strict versioned replay contracts and safe error contracts;
- deterministic bounded terminal Run listing;
- complete, partial, failed, and abandoned projections;
- explicit sequence order and no invented causal links;
- deterministic timeline categories/details with bounded redacted strings;
- verification-not-observed behavior;
- changed-file privacy and sensitive-path null preservation;
- evidence-gap visibility and counter consistency;
- finalization/reconciliation/artifact aggregate validation;
- allowlisted Run-scoped verified artifact reads with safe headers and bounds;
- authenticated real-network list/replay/artifact routes;
- identical unauthorized responses and content-free errors;
- file-backed restart replay equality;
- five controlled finalized Run fixtures with no unexplained changed files;
- sessionStorage-only token handling and token absence from URL/render/localStorage;
- React loading, empty, error, complete, partial/gap, artifact, keyboard, and responsive smoke states;
- no source-of-truth mutation, AI, classifier, evidence graph, CORS wildcard, cloud, analytics, telemetry, billing, or user authentication.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-012-build-replay`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-012: Render deterministic raw Task Run Build Replay` (#32).

Before implementing, read issue #32, ADR-0009 through ADR-0014, the current Task Run/Event/finalization/reconciliation/evidence/artifact repositories, OL-003 authentication/server code, OL-010 verified artifact reads, and the current React/Vite application.

Explicitly forbidden:

- replay projection tables or caches;
- lifecycle, Event, Git, finalization, evidence, or artifact metadata mutation;
- raw Event payload or arbitrary artifact browser;
- AI summary, candidate moment, classifier, verification inference, or evidence graph;
- token persistence outside sessionStorage;
- arbitrary remote daemon host or wildcard CORS;
- production installer/static-hosting orchestration;
- cloud replication, analytics, telemetry, billing, or user authentication.

OL-012 is complete only when terminal Runs can be listed and replayed deterministically in the browser from accepted local facts, gaps and missing verification remain explicit, final-diff artifacts are narrow and verified, refresh/restart preserve output, five controlled Runs pass the exit gate, and no AI or source-of-truth mutation is introduced.