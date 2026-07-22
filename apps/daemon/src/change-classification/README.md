# Deterministic change classification

OL-013 classifies the accepted changed-file entries already linked to a finalized Run. It is a deterministic evidence component, not a repository scanner or semantic analysis service.

## Data flow

```text
Run finalization
→ final OL-009 reconciliation and ordered entries
→ pure versioned path rules
→ canonical strict classification JSON
→ OL-010 content-addressed artifact
→ immutable Run role
```

## Invariants

- Only terminal Runs with a valid finalization are eligible.
- The classifier consumes the finalization-linked reconciliation exactly; it never runs Git or reads repository files.
- Hidden or secret paths are not guessed and produce `unknown`.
- Unsafe persisted paths are corruption.
- Every supported label carries stable rule evidence and a fixed confidence in basis points.
- Confidence is rule strength, not probability.
- Output contains no relative path, path identity hash, root, commit, fingerprint, prompt, command, source session, file content, exception, artifact path, or generation timestamp.
- The same accepted input and versions produce byte-identical canonical output.
- OL-010 verifies persisted bytes; read-back regenerates and compares the complete canonical artifact.
- At most one `deterministic-change-classification-v1` reference exists per Run.
- Batches are explicit, sequential, and bounded to 25. No scheduler is introduced.

## Public APIs

- `classifyFinalizedRunChanges`
- `classifyEligibleFinalizedRuns`
- `getRunChangeClassification`

Safe results expose only controlled IDs, schema/classifier/taxonomy/rule-set versions, outcome/diagnostic, input fingerprint, entry count, and aggregate labels.

## Non-ownership

This module does not parse source code or package contents, infer verification, construct an Evidence Graph, modify Raw Replay, generate Moments, contact an AI provider, or schedule background work.
