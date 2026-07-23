# Deterministic Evidence Graph

OL-015 connects accepted Run facts, OL-013 classifications, and OL-014 verification evidence into one immutable, locally resolvable graph. It is an evidence index, not a semantic claim engine or mutable graph database.

## Data flow

```text
terminal Run + immutable finalization
+ sequenced Events, baseline, reconciliations, gaps, and source artifacts
+ validated classification and verification artifacts
→ pure versioned node/edge construction
→ canonical sensitive OL-010 graph artifact
→ authenticated Run-scoped evidence resolution
→ factual Raw Replay section navigation
```

## Invariants

- Every edge is backed by a persisted relationship or a validated source-artifact relationship.
- Evidence IDs are domain-separated SHA-256 identifiers over controlled locators.
- IDs contain no path, root, Git identity, command, output, prompt, source session, digest, or storage path.
- Node and edge order is canonical; duplicate semantic identities and missing endpoints are corruption.
- The graph uses an exact Event prefix captured after OL-013 and OL-014 source artifacts exist.
- Later Events do not invalidate an existing graph.
- Diff hunks are not retained by the current system, so the graph emits no hunk node and records `diff_hunks_not_retained` when changed-file evidence exists.
- The graph artifact, final-manifest, classification, and verification metadata are validated before construction.
- At most one `deterministic-evidence-graph-v1` reference exists per finalized Run.
- Failed artifact-reference creation may leave only an orphan object removable by bounded sweeping.

## Bounds

- source Run Events: 25,000
- graph nodes: 25,000
- graph edges: 50,000
- source artifact records: 4
- canonical graph: 8 MiB
- explicit batch: 25 Runs

## Public APIs

- `buildFinalizedRunEvidenceGraph`
- `buildEligibleFinalizedRunEvidenceGraphs`
- `getRunEvidenceGraph`
- `readValidatedRunEvidenceGraph`
- `resolveRunEvidence`

The authenticated resolver proves that an Evidence ID belongs to the requested Run and returns only a controlled local Replay anchor. Raw Replay exposes graph outcome/limitations and evidence actions; the UI focuses existing factual sections rather than generating explanations.

## Non-ownership

This module does not retain or reconstruct patch hunks, read the repository or source files, run Git or commands, infer relationships from time/text/path similarity, create candidate Moments, call AI, schedule background work, or provide a general graph traversal API.
