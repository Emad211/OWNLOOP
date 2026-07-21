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
8. `docs/adr/0007-fail-open-command-hook-adapter.md`
9. `docs/architecture/C4.md`
10. `docs/product/BACKLOG_v0.1.0.md`
11. `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`

Read the relevant documents before changing code. Do not silently reinterpret, expand, or supersede an accepted architectural decision. When a task conflicts with an ADR or the product scope, stop and report the conflict instead of improvising.

For Milestone A dependency order, accepted ADRs and the backlog amendment take precedence over the historical order in the original backlog.

## Development policy

- Work on exactly one issue or task at a time.
- Keep each pull request small and independently reviewable.
- Do not modify unrelated files.
- Do not add product behavior outside the active issue.
- Prefer the smallest maintainable solution over speculative abstraction.
- Avoid cloud services, remote persistence, user authentication, telemetry, analytics, or billing unless explicitly required.
- Never commit secrets, tokens, credentials, `.env` contents, generated private data, database files, or machine-specific paths.
- Do not weaken type checking, linting, tests, database constraints, canonicalization, redaction, authentication, fail-open semantics, or other security controls to make a task pass.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, or skipped tests without a documented task-specific reason.
- Do not rewrite accepted ADRs as part of implementation work. Architectural changes require a separate ADR.
- Source-boundary schemas may be forward-compatible; OwnLoop-owned contracts remain controlled and versioned.
- Persist-before-acknowledge remains mandatory for accepted daemon receipts.
- Unredacted source payloads must never be written to persistent storage.
- The Hook Adapter must not redact or mutate a validated source payload before authoritative daemon fingerprinting.
- Production Hook Adapter execution must always be fail-open: exit code 0, zero stdout, zero stderr, and no Claude decision output.
- Errors, HTTP responses, adapter outputs, and diagnostics must never contain source values, canonical unredacted JSON, secrets, prompts, commands, source code, absolute paths, authorization values, token digests, fingerprints, session/source IDs, exception messages, stacks, or key material.

## Technical baseline

Unless a later ADR changes this baseline:

- Runtime: Node.js 24.18.0 LTS
- Language: TypeScript 6.0.3 in strict mode
- Package manager: pnpm 11.4.0
- Repository shape: pnpm workspace / modular monolith
- Local UI: React + Vite
- Unit tests: Vitest
- Runtime validation: Zod 4.4.3
- Local HTTP server: Fastify 5.10.0 behind the daemon ingress boundary
- Local persistence: built-in `node:sqlite` behind the daemon persistence boundary
- Ingress fingerprinting: Node.js HMAC-SHA-256 with a secret `KeyObject`
- Canonical parsed JSON: OwnLoop Canonical JSON v1
- Hook transport adapter: Node.js built-ins plus `@ownloop/contracts` only
- CI: GitHub Actions
- Formatting and linting: Biome

Do not add an external runtime dependency for OL-004. The adapter may use only Node.js built-ins and workspace contracts.

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

OL-004 implementation belongs only under `tools/hook-adapter`, except for documentation and workspace dependency metadata. It must not import daemon, persistence, Fastify, ingress-security behavior, Git, or UI code.

## Quality gates

Before declaring a task complete, run and report:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For OL-004 also run focused tests proving:

- all nine supported Hook payloads wrap and deliver unchanged;
- bounded streaming stdin and bounded response handling;
- fixed IPv4-loopback endpoint and strict environment validation;
- redirect, network, timeout, non-202, and invalid-response fail-open behavior;
- child-process exit code 0 with empty stdout/stderr for success and every failure family;
- real child-process delivery to a real OL-003 server with durable persistence;
- duplicate child-process delivery remains idempotent;
- sample settings validity and absence of secrets.

Never claim a check passed if it was not run.

## Git and pull-request discipline

- Base implementation on the active task branch.
- Make focused commits with terse imperative messages.
- Leave the worktree clean.
- Do not push directly to `main`.
- Keep implementation pull requests as drafts until checks and review are complete.
- Summarize files, decisions, checks, failures, limitations, and review requirements.

## Current phase restriction

The active task is `OL-004: Implement fail-open Claude Code command-hook adapter`.

Before implementing OL-004, read:

- GitHub issue #15 and all comments
- ADR-0004
- ADR-0005
- ADR-0006
- ADR-0007
- current Claude Hook source contracts
- current OL-003 endpoint and response contracts
- official Claude Code Hooks and Settings references

For OL-004, the following are explicitly forbidden:

- daemon start/stop orchestration
- arbitrary endpoint URL or non-loopback host configuration
- installation-token or HMAC-key persistence/rotation
- modifying a real `.claude/settings.json`
- adapter-side source payload redaction or mutation
- retries, background queue, disk spool, or local diagnostic log
- non-zero production exit codes
- intentional stdout or stderr output
- Claude decision JSON or context injection
- pending-receipt processing
- Workspace/Conversation/Task Run lifecycle transitions
- normalized events or sequence allocation
- Git baseline/diff/reconciliation
- artifact content storage
- AI or web UI work
- cloud backend, analytics, telemetry, billing, or user authentication

OL-004 is complete only when the built command-hook adapter silently and fail-open reads one bounded source event, validates and wraps it unchanged, attempts one authenticated fixed-loopback delivery under a strict timeout, validates the accepted response, and always exits 0 with no output; real child-process integration and standard quality gates must pass.
