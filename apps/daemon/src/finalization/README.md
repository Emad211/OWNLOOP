# OwnLoop Run finalization and recovery

This boundary seals accepted lifecycle, baseline, reconciliation, Event, evidence-gap, and artifact-store facts into exactly one immutable terminal Run state.

## Normal finalization

A `Finalizing` Run is eligible only after OwnLoop resolves an accepted Stop boundary. The processor ensures OL-009 reconciliation exists, prepares a canonical privacy-bounded final manifest, materializes it through OL-010, and then performs one synchronous SQLite transaction.

Inside that transaction OwnLoop:

- re-reads the Run and every accepted evidence relationship;
- allocates contiguous Run sequences;
- appends `snapshot.final_captured` when reconciliation exists;
- appends exactly one terminal Run Event;
- records deterministic Event deduplication keys;
- links the prepared manifest artifact to the Run;
- inserts at most one new controlled finalization evidence gap, and only when the Run has no existing evidence gap;
- transitions the Run to its terminal status;
- inserts one immutable `run_finalizations` row.

`Completed` is intentionally strict. It requires a normal Stop, captured baseline, captured reconciliation, reliable final fingerprint, stored final manifest, zero evidence gaps, and consistent Event continuity. Missing or incomplete retainable evidence produces `Partial`; `StopFailure` produces `Failed`.

Persisted reconciliation or artifact-integrity corruption is propagated as a typed failure. Only explicitly recoverable manifest materialization failures become `manifest_unavailable` evidence.

An existing OL-008, OL-009, or earlier controlled evidence gap still prevents `Completed`, but finalization does not duplicate it. The terminal diagnostic remains specific to the finalization classification even when no additional evidence row is inserted.

## Crash recovery

Recovery is an explicit bounded API rather than a timer or background worker.

- stale `Capturing` Runs become `Abandoned` and receive a controlled missing-stop evidence gap only when the Run has no existing gap;
- stale `Finalizing` Runs use the same accepted evidence path, are forced to `Partial`, and receive a restart-recovery gap only when no gap already exists;
- status, staleness, and evidence-row/counter consistency are re-checked inside the write transaction;
- repeated or concurrent recovery is idempotent;
- recovery never invokes, contacts, or resumes Claude Code.

## Artifact and rollback semantics

Manifest bytes are prepared outside SQLite because the OL-010 object store is filesystem-backed. The Run reference is created only inside the finalization transaction. If SQLite rejects the transaction, the Run remains non-terminal, no Event sequence is consumed, no evidence count changes, and the materialized content object remains only as an unreferenced GC-eligible object.

## Database invariants

Migration v8 introduced immutable Run finalization records. Migration v9 validates terminal-status, mode, and diagnostic combinations. Migration v10 adds retained-evidence, complete Event-continuity, and latest-Stop validation while preserving migrations 1–9.

Migrations v8–v10 and repository reads validate:

- one finalization per Run;
- Workspace, Conversation, Run, trigger Event, reconciliation, artifact, snapshot Event, and terminal Event ownership;
- correct source and type for snapshot and terminal Events;
- complete contiguous Event sequences from 1 through the terminal Event, while allowing later derived Events;
- deterministic Event deduplication keys for both final snapshot and terminal Events;
- final-manifest artifact kind, media type, storage version, and Run role;
- terminal Run status, timestamp, fingerprint, evidence counter, and actual evidence-row count consistency;
- normal `Partial` diagnostics are restricted to normal finalization evidence codes;
- recovery `Partial` requires exactly `stale_finalizing_recovered`;
- `source_stop_failure` remains exclusive to normal `Failed`;
- `stale_capturing_recovered` remains exclusive to recovery `Abandoned`;
- strict evidence requirements for `Completed`;
- immutable finalization rows.

Repository reads intentionally repeat critical cross-table checks after insertion. Migration v9 rejects invalid existing v8 mode/diagnostic combinations rather than silently relabeling them. Migration v10 validates existing retained evidence, Event continuity, and latest-Stop linkage before installing the matching insert-time trigger. Regression tests corrupt early sequence continuity, later Stop boundaries, evidence rows, terminal deduplication, and the evidence counter in file-backed databases and verify that restart-time reads reject each case as `invalid_persisted_row`.

Persisted corruption is surfaced as a content-free persistence error rather than silently accepted.

## Privacy boundary

Final manifests contain controlled reconciliation metadata only. Raw Git status, patch or diff bytes, source-file content, absolute repository roots, commit hashes, prompts, source/session identifiers, exceptions, and stacks are excluded from manifests, synthetic Events, evidence messages, and safe results.

## Explicit non-ownership

OL-011 and this invariant hotfix do not implement replay projection or UI, AI summaries, Ownership Moments, cloud replication, analytics, telemetry, billing, user authentication, background scheduling, Git mutation, or agent resumption.
