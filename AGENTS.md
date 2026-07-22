# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0015.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, installation tokens, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken strict contracts, runtime validation, type checking, linting, tests, database constraints, append-only evidence, artifact verification, transactionality, idempotency, or version discipline.
- Do not use `any`, `z.any()`, `@ts-ignore`, disabled lint rules, skipped tests, content inference, or hidden I/O without an issue-specific accepted decision.
- OL-013 classification consumes only the immutable finalization-linked OL-009 reconciliation. It must not read repository files, run Git, inspect Event payload text, prompts, commands, or source artifacts.
- Hidden, secret, unsupported, or unmatched entries remain `unknown`; never guess a semantic label.
- Confidence is a fixed deterministic rule strength in basis points, not a probability or correctness claim.
- Every non-unknown label requires stable rule evidence; rule and label ordering must be canonical and reproducible.
- Classification artifacts must omit relative paths, path identity hashes, roots, commits, Git hashes/fingerprints, prompts, commands, source sessions, source content, exceptions, and artifact storage metadata.
- The same accepted input and classifier/rule-set versions must produce byte-identical canonical output.
- Do not use the generic `analysis_jobs` table in OL-013 or introduce a scheduler/background worker.

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

No new runtime dependency is authorized for OL-013.

## Repository placement

- strict classification contracts belong in `packages/contracts/`;
- deterministic rules, canonical artifact preparation, and explicit processors belong in `apps/daemon/src/change-classification/`;
- SQL remains inside existing persistence repositories and migration definitions;
- architectural policy belongs in ADR-0015.

Do not create a new package, service, listener, classifier table, replay cache, or scheduler.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-013 tests must prove:

- strict versioned contracts and rejection of forbidden fields;
- canonical byte identity and stable input fingerprint;
- deterministic multi-label ordering, rule evidence, and fixed confidence;
- every taxonomy category and explicit `unknown` fallback;
- common Node.js/TypeScript, React, API, auth, test, dependency, database, infrastructure, and documentation layouts;
- unsafe/absolute/traversal/secret path corruption rejection;
- 2000-entry and two-MiB bounds;
- no filesystem, Git, network, source-content, prompt, command, or Event-payload reads in the pure classifier;
- migration 10→11, immutable migration history, unique role, metadata, terminal/finalization constraints, and sensitivity preservation;
- OL-010 content-addressed persistence, idempotency, concurrency, rollback, and restart durability;
- tampered content, wrong source linkage/version/fingerprint/metadata, and duplicate-role rejection;
- bounded deterministic batch eligibility;
- five Milestone A fixture outcomes classify or explicitly report unavailable;
- no lifecycle, Event, evidence-gap, Git, finalization, or source-artifact mutation.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-013-deterministic-change-classification` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-013: Build deterministic evidence-backed file and change classifiers` (#40).

Before implementing, read issue #40, ADR-0011 through ADR-0015, the finalization/reconciliation/artifact repositories, migration history, strict contracts, and OL-010 verified artifact API.

Explicitly forbidden:

- source, AST, package-content, prompt, transcript, command, or arbitrary Event-payload analysis;
- repository or Git reads/mutation beyond accepted OL-009 facts;
- probabilistic or AI-generated classification;
- silent classification of hidden or unsupported paths;
- mutable classification tables or generic analysis-job scheduling;
- verification extraction, Evidence Graph, replay UI classification display, or Moment generation;
- lifecycle, Event, evidence-gap, Git, finalization, artifact-source, or replay mutation;
- cloud, analytics, telemetry, billing, or multi-user authentication.

OL-013 is complete only when final-reconciliation entries can be classified reproducibly into the controlled taxonomy with stable evidence and fixed confidence, immutable OL-010 artifacts, explicit partial/unavailable/unknown outcomes, restart-safe validation, and no new observation or AI boundary.
