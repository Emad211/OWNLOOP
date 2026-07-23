# Deterministic verification extraction

OL-014 converts already accepted Bash completion Events and OL-013 test-file classifications into deterministic verification evidence. It is observational: it never executes commands, invokes a shell, reads the repository, or infers success from missing evidence.

## Data flow

```text
terminal Run + immutable finalization
+ canonical/redacted Bash completion Events
+ validated OL-013 classification artifact
→ versioned command recognition and output reduction
→ canonical sensitive OL-010 artifact
+ controlled append-only command/verification Events
```

## Invariants

- Only `claude_code` `PostToolUse`/`PostToolUseFailure` Bash completion Events are command sources.
- Compound, redirected, substituted, background, missing, and ambiguous commands remain `unknown`.
- Source Hook outcome and an explicit consistent exit code are the only status evidence.
- Output text never overrides the source Event outcome.
- Test-file changes are retained separately and never represented as executions.
- The artifact stores a stable source-Event prefix count so later derived Events do not invalidate read-back.
- Reduced excerpts remain only in the sensitive artifact; derived Events and safe results contain no command or output text.
- Artifact reference, derived Events, per-Run sequence allocation, and deduplication rows are written in one synchronous SQLite transaction.
- Repeated and concurrent calls do not duplicate references, Events, sequences, or deduplication keys.
- A failed SQLite transaction may leave only an unreferenced OL-010 object eligible for bounded garbage collection.

## Bounds

- source Run Event prefix: 10,000
- accepted Bash observations: 500
- OL-013 test-file references: 2,000
- canonical artifact: 2 MiB
- explicit batch: 25 Runs

## Public APIs

- `extractFinalizedRunVerificationEvidence`
- `extractEligibleFinalizedRunVerificationEvidence`
- `getRunVerificationEvidence`
- `recognizeVerificationCommand`
- `reduceVerificationOutput`

## Non-ownership

This module does not run verification, parse arbitrary shell programs or framework reports, inspect source/AST/package content, infer verification from changed files, build the Evidence Graph, generate Moments, or schedule background work.
