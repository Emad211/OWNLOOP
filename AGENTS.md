# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The current product direction and architecture are defined in:

1. `docs/product/PROJECT_SCOPE.md`
2. `docs/adr/0001-human-ownership-layer.md`
3. `docs/adr/0002-local-first-claude-code-first-mvp.md`
4. `docs/adr/0003-event-schema-and-session-lifecycle.md`
5. `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
6. `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
7. `docs/adr/0006-authenticated-loopback-ingestion.md`
8. `docs/architecture/C4.md`
9. `docs/product/BACKLOG_v0.1.0.md`
10. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or the product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over the historical order in the original backlog.

## Development policy

- Work on exactly one issue or task at a time.
- Keep each pull request small and independently reviewable.
- Do not modify unrelated files.
- Do not add product behavior that is outside the active issue.
- Prefer the smallest maintainable solution over speculative abstraction.
- Avoid cloud services, remote persistence, user authentication, telemetry, analytics, or billing unless an issue explicitly requires them.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, canonicalization rules, redaction rules, authentication checks, or security controls to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented and task-specific reason.
- Do not rewrite accepted ADRs as part of implementation work. Architectural changes require a separate ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned contracts remain controlled and versioned.
- Persist-before-acknowledge is mandatory for accepted ingress receipts.
- Unredacted source payloads must never be written to persistent storage.
- Unknown source fields may be accepted at parsing but must not be persisted without an explicit policy-version change.
- Errors, HTTP responses, and diagnostics must never contain rejected source values, canonical unredacted JSON, secrets, prompts, commands, source code, absolute paths, authorization values, token digests, fingerprints, session/source IDs, exception messages, stacks, or key material.

## Technical baseline

Unless a later ADR changes this baseline:

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 in strict mode
- Package manager: pnpm 11.4.0, pinned through `packageManager`
- Repository shape: pnpm workspace / modular monolith
- Local UI: React + Vite
- Unit tests: Vitest
- Runtime validation: Zod 4.4.3
- Local HTTP server: Fastify 5.10.0, isolated behind the daemon ingress boundary
- Local persistence: built-in `node:sqlite` behind the daemon persistence boundary
- Ingress fingerprinting: Node.js built-in HMAC-SHA-256 with a secret `KeyObject`
- Canonical parsed JSON: OwnLoop Canonical JSON v1 as defined by ADR-0005
- CI: GitHub Actions
- Formatting and linting: Biome

When selecting a dependency, use a stable release compatible with Node.js 24 and TypeScript 6. Pin direct dependencies and commit the lockfile. Avoid experimental packages unless an ADR or issue explicitly accepts the risk.

`node:sqlite` is accepted for v0.1 despite its release-candidate status because Node.js is pinned exactly and ADR-0004 isolates the driver behind a small persistence boundary. Do not spread direct driver usage outside that boundary.

Fastify is the only external runtime dependency authorized for OL-003. Stop and report before adding another one.

## Repository structure

```text
apps/
├── daemon/
└── web/
packages/
├── contracts/
├── event-model/
├── ingress-security/
└── test-fixtures/
tools/
└── hook-adapter/
```

`packages/ingress-security` is shared by the daemon and future Hook Adapter. HTTP/Fastify code belongs only under the daemon ingress boundary. Do not create another application or package for OL-003.

## Quality gates

Before declaring a task complete, run and report:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For OL-003 also run focused real-network tests proving:

- IPv4 loopback binding;
- authentication before body handling;
- durable insert before 202;
- exact duplicate and conflicting duplicate behavior;
- content-type, malformed JSON, runtime validation, ingress-security, oversized-body, persistence, and internal-error mapping;
- content-free HTTP and diagnostic surfaces;
- file-backed durability and server shutdown behavior.

`Fastify.inject()` may supplement tests but does not replace real `listen()` plus Node `fetch` coverage.

Never claim a check passed if it was not run.

## Git and pull-request discipline

- Base implementation branches on the branch named in the active task.
- Make focused commits with terse imperative messages.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep implementation pull requests as drafts until checks and review are complete.
- Summarize files, decisions, checks, failures, limitations, and review requirements.

## Current phase restriction

The active implementation task is `OL-003: Implement authenticated loopback ingestion API`.

Before implementing OL-003, read:

- GitHub issue #13 and all comments
- ADR-0003
- ADR-0004
- ADR-0005
- ADR-0006
- C4 architecture
- Backlog Amendment 0001
- current contracts, ingress-security, and persistence code
- Fastify 5.10.0 server and request references

For OL-003, the following are explicitly forbidden:

- Hook stdin reading or forwarding
- Claude settings installation
- installation-token or HMAC-key persistence/rotation
- arbitrary/non-loopback host configuration
- raw request logging
- pending-receipt processing or background workers
- Workspace, Conversation, or Task Run lifecycle transitions
- normalized event creation or sequence allocation
- Git baseline, diff, or reconciliation
- artifact content storage or cleanup
- AI provider code or calls
- web UI feature work
- Ownership Moment or Build Replay behavior
- cloud backend or remote storage
- user authentication, analytics, telemetry, billing, or tracking

OL-003 is complete only when an authenticated IPv4-loopback Fastify endpoint validates, prepares, and durably inserts or safely resolves exact duplicate prepared receipts before returning a structured 202 response; conflicting duplicates and all failure classes must map to stable content-free responses, with real-network tests and no downstream processing scope.
