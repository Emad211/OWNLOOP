# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. The accepted direction is defined by the product scope, C4 architecture, backlog amendments, and ADR-0001 through ADR-0018.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require a new ADR.

## Development policy

- Work on exactly one issue at a time and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, installation tokens, `.env` contents, database files, raw Git output, prepared artifact bytes, source-file content, machine-specific roots, or exception stacks.
- Do not weaken strict contracts, runtime validation, type checking, linting, tests, evidence-addressing, immutability, or version discipline.
- OL-016 is contracts-only and must remain pure, provider-independent, and free of persistence or execution behavior.
- Every Candidate Moment requires one or more strict OL-015 Evidence IDs; missing evidence is malformed input.
- Candidate type and interaction kind must remain compatible and finite.
- Model-authored strings must remain NFC-normalized, bounded plain text without controls, raw markup, URLs, dangerous URI schemes, callbacks, commands, or executable fields.
- Malformed or extra model output is rejected rather than repaired, normalized, stripped, logged, or silently widened.
- Confidence is a structured generator signal, not proof, probability, support validation, or permission to bypass OL-019.
- Do not resolve Evidence IDs, call providers/models, construct prompts, persist candidates, add routes/UI, or introduce scheduling in OL-016.

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

No new runtime dependency is authorized for OL-016.

## Repository placement

- strict Candidate Moment contracts and pure parsers belong in `packages/contracts/`;
- architectural policy belongs in ADR-0018;
- no daemon, persistence, API, UI, artifact, provider, or prompt module is authorized for OL-016.

Do not create a new package, migration, artifact role, service, listener, scheduler, or runtime dependency.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused OL-016 tests must prove all four strict Candidate types, mandatory unique Evidence IDs, type-compatible finite interactions, fixed decision/risk options, bounded check choices, plain-text/URI/HTML/control safety, confidence/importance/count/byte bounds, extra-field rejection, immutable clone helpers, package-root exports, and no I/O/persistence/provider boundary.

Never claim a check passed unless it completed successfully.

## Git and Pull Request discipline

- Base implementation on `agent/ol-016-candidate-moment-contracts` from current `main`.
- Make focused commits and leave the worktree clean.
- Do not push directly to `main`.
- Keep the PR draft until clean-checkout CI and final review pass.
- Remove all temporary export/transfer workflows before review.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-016: Define strict evidence-backed candidate-moment contracts` (#46).

Before implementing, read Issue #46, ADR-0017, ADR-0018, the OL-015 Evidence ID contract, and current `@ownloop/contracts` strict-schema conventions.

Explicitly forbidden:

- candidates without Evidence IDs or free-form citations/paths/URLs as substitutes;
- candidate/interaction mismatches or model-defined executable actions;
- raw HTML, CSS, JavaScript, dangerous URI schemes, callbacks, tool calls, shell commands, or hidden metadata;
- Evidence resolution, support/contradiction validation, deduplication, ranking, or rejection decisions;
- provider/model integration, prompts, credentials, costs, retries, or provenance records;
- database migrations, artifacts, daemon processors, API routes, UI screens, schedulers, cloud, analytics, telemetry, billing, or multi-user authentication.

OL-016 is complete only when untrusted candidate JSON is constrained to a strict, immutable, evidence-addressed, provider-independent four-type contract and every malformed or executable shape fails closed without adding persistence or runtime behavior.
