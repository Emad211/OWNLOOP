# ADR-0016: Extract Verification Evidence Deterministically from Observed Commands

**Status:** Proposed  
**Date:** 2026-07-22  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- `docs/adr/0014-deterministic-raw-replay-projection-and-local-viewer.md`
- `docs/adr/0015-deterministic-evidence-backed-change-classification.md`
- GitHub Issue #42

---

## Context

OwnLoop now persists canonical/redacted tool Events, immutable finalized Runs, deterministic Raw Replay, and one versioned path-only classification artifact per eligible Run. The next evidence boundary is verification: whether a test, lint, typecheck, or build command was actually observed and what limited result evidence was retained.

Several distinctions are mandatory:

- a changed test file is not a test execution;
- a command name is not proof that the command ran;
- output text is not allowed to override the persisted Hook outcome;
- absence of an observed execution is not success;
- arbitrary shell text and custom scripts must not be semantically guessed;
- already redacted command output may still contain source-like text and must be reduced before derivative storage;
- later derived Events must remain append-only and contiguous without mutating the terminal Run.

The existing normalized Event model already reserves controlled Event types for command and verification observations. OL-010 provides immutable content-addressed storage for a larger sensitive evidence artifact. OL-013 separately identifies test-file changes without reading file content.

---

## Decision

OwnLoop will implement one explicit deterministic verification-extraction processor for terminal Runs.

```text
accepted canonical/redacted Bash completion Events
+ immutable finalization
+ validated OL-013 classification artifact
→ strict command recognition and output reduction
→ canonical verification-evidence artifact
+ controlled derived verification Events
```

The processor never executes a command, invokes a shell, reads the repository or source files, contacts Claude Code, or calls an AI provider.

## Authoritative input

The processor reads only accepted persisted facts:

- a terminal Task Run and immutable finalization;
- sequenced Run Events;
- `claude_code` `tool.succeeded` and `tool.failed` Events backed by `PostToolUse` and `PostToolUseFailure` source hooks;
- canonical/redacted payload fields already accepted during ingress and normalization;
- the validated OL-013 classification artifact.

A command observation is eligible only when the controlled tool name is Bash and `tool_input.command` is a bounded string. Optional result data is read only from an explicit flat allowlist. The processor does not recursively search arbitrary response objects.

Persisted Event sequence or aggregate corruption is a typed failure. A valid but unsupported command or response shape remains explicit partial/unknown evidence rather than corruption.

## Command recognition policy

Recognition is a pure versioned rule set over one command string. It performs no shell expansion.

Version 1 recognizes exact common single-command forms for:

- npm, pnpm, yarn, and Bun scripts;
- controlled `test`, `lint`, `typecheck`, and `build` script names and controlled colon-suffixed variants;
- unambiguous direct tools such as Vitest, Jest, Node test, TypeScript, ESLint, Biome, Vite, Next, Rollup, and Webpack;
- controlled package-manager wrappers when the wrapped invocation remains unambiguous.

Every rule has a stable ID, verification kind, controlled tool/package-manager family, and explicit precedence.

Compound shell programs, pipelines, substitutions, redirects, background commands, ambiguous custom scripts, missing commands, and arbitrary shell text produce `unknown`. The recognizer does not use output text, prompts, changed paths, timestamps, or other tool names to infer intent.

## Observed status policy

Status is grounded only in persisted observations:

- `tool.succeeded` records a succeeded tool outcome;
- `tool.failed` records a failed tool outcome;
- an explicit integer exit code is retained only when present and consistent;
- no exit code is invented;
- output strings never change the source Event outcome.

Recognized verification observations may be projected as passed, failed, or observed without an explicit exit code according to this controlled policy. Missing recognized execution is `verification_not_observed`.

## Reduced output policy

Only already canonical/redacted flat strings are eligible. Version 1:

- normalizes line endings;
- strips ANSI escape sequences and disallowed controls;
- preserves valid Unicode;
- applies deterministic line, code-point, and UTF-8 byte bounds;
- records original accepted byte count, SHA-256, truncation state, and a small excerpt.

Excerpts remain only inside the sensitive OL-010 artifact. Derived Events and safe results contain no raw command or output text.

## Verification artifact

The canonical artifact is strict versioned UTF-8 JSON containing:

- schema, extractor, command-rule-set, and reduction-policy versions;
- Run, finalization, and OL-013 classification identifiers;
- outcome and controlled diagnostic;
- deterministic accepted-input fingerprint;
- ordered command observations;
- ordered test-file-change evidence;
- deterministic aggregates.

Command observations contain source normalized Event ID, command fingerprint rather than command text, controlled recognition fields, source tool outcome, nullable explicit exit code, reduced-output evidence, and derived Event IDs.

Test-file-change evidence contains only OL-013 entry index, linked file Event ID, and controlled rule/evidence IDs proving the tests label. It contains no path or path identity hash.

Artifact metadata is fixed:

- role and kind: `deterministic-verification-evidence-v1`;
- media type: `application/vnd.ownloop.verification-evidence+json`;
- sensitivity: `sensitive`;
- storage version: `1`;
- maximum Run Events: `10000`;
- maximum command observations: `500`;
- maximum test-file-change references: `2000`;
- maximum canonical artifact size: `2 MiB`.

The same accepted input and versions produce byte-identical bytes.

## Derived Events

Inside the same SQLite transaction that links the artifact, the processor appends:

- `command.completed` or `command.failed` for each accepted Bash completion;
- `test.observed`, `lint.observed`, `typecheck.observed`, or `build.observed` only for recognized commands.

Unknown commands receive no verification-specific Event.

Derived Event payloads contain only controlled IDs, kind, observed status, nullable exit code, and bounded boolean/count metadata. They contain no command or output excerpt. Sequence allocation is contiguous, deterministic deduplication keys prevent duplicates, and later derived Events do not alter terminal Run state.

## Persistence

Migration v12 preserves migrations 1 through 11 and adds only verification-role constraints:

- at most one v1 verification artifact reference per Run;
- exact storage version, kind, media type, and sensitivity;
- terminal Run and immutable finalization ownership;
- validation of any pre-existing v1 role rows before triggers/indexes are installed.

No verification table, replay cache, scheduler, or mutable analysis-job state is introduced.

Artifact bytes may be materialized before the SQLite transaction. A failed reference/Event transaction may leave only an unreferenced GC-eligible object.

## Explicit processing

The module exposes explicit single-Run, bounded-batch, and verified read APIs. It may explicitly invoke the accepted OL-013 processor when a required classification artifact is absent. No timer, startup worker, or background scheduler is added.

Repeated and concurrent calls must not duplicate artifact references, Events, deduplication keys, or sequences. Read-back verifies OL-010 bytes, strict contracts, source Event linkage, classification linkage, versions, metadata, and the regenerated input fingerprint.

## Privacy boundary

Safe results expose only controlled IDs, versions, outcome/diagnostic, input fingerprint, counts, aggregates, artifact ID, and derived Event IDs.

They exclude raw command/output, path, root, commit/fingerprint, source-session/tool-use identifiers, artifact digest/path, exceptions, and stacks.

## Alternatives rejected

### Infer verification from changed test files

Rejected. File changes prove only that files changed.

### Parse arbitrary shell programs

Rejected. Shell semantics, quoting, substitutions, and pipelines exceed the deterministic v1 boundary.

### Treat successful terminal Runs as verified

Rejected. Terminal lifecycle success is not test/lint/typecheck/build evidence.

### Store output excerpts directly in Events

Rejected. Event payloads should remain controlled and replay-safe; reduced excerpts belong in a sensitive artifact.

### Re-execute verification commands

Rejected. OwnLoop is observational and must not change project state or agent behavior.

---

## Consequences

### Positive

- verification is grounded in actual observed command Hooks;
- absence and ambiguity remain explicit;
- test-file changes cannot masquerade as executions;
- deterministic artifacts can be reprocessed and validated after restart;
- Raw Replay receives controlled verification Events without output leakage.

### Negative

- compound/custom commands remain unknown in v1;
- some Hook response shapes will not expose an exit code;
- reduced excerpts intentionally omit most command output;
- verification extraction adds derived Events after the terminal Event.

## Validation

The decision is accepted when contract, rule, reduction, Event, migration, persistence, concurrency, rollback, restart, corruption, fixture, replay, and full quality-gate tests in Issue #42 pass.

## Reversibility

Broader shell parsing, framework-specific result parsers, additional artifact kinds, background scheduling, source-content analysis, or Evidence Graph integration requires a superseding ADR or later milestone decision.
