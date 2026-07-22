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
- inserts any new controlled evidence gap and updates the evidence counter;
- transitions the Run to its terminal status;
- inserts one immutable `run_finalizations` row.

`Completed` is intentionally strict. It requires a normal Stop, captured baseline, captured reconciliation, reliable final fingerprint, stored final manifest, zero evidence gaps, and consistent Event continuity. Missing or incomplete retainable evidence produces `Partial`; `StopFailure` produces `Failed`.

## Crash recovery

Recovery is an explicit bounded API rather than a timer or background worker.

- stale `Capturing` Runs become `Abandoned` with one controlled missing-stop evidence gap and one `run.abandoned` Event;
- stale `Finalizing` Runs use the same accepted evidence path but are forced to `Partial` with a restart-recovery evidence gap;
- status and staleness are re-checked inside the write transaction;
- repeated or concurrent recovery is idempotent;
- recovery never invokes, contacts, or resumes Claude Code.

## Artifact and rollback semantics

Manifest bytes are prepared outside SQLite because the OL-010 object store is filesystem-backed. The Run reference is created only inside the finalization transaction. If SQLite rejects the transaction, the Run remains non-terminal, no Event sequence is consumed, no evidence count changes, and the materialized content object remains only as an unreferenced GC-eligible object.

## Database invariants

Migration v8 and repository reads validate:

- one finalization per Run;
- Workspace, Conversation, Run, trigger Event, reconciliation, artifact, snapshot Event, and terminal Event ownership;
- correct source and type for snapshot and terminal Events;
- adjacent final snapshot and terminal sequences with predecessor continuity;
- deterministic Event deduplication keys;
- final-manifest artifact kind, media type, storage version, and Run role;
- terminal Run status, timestamp, fingerprint, and evidence count consistency;
- strict evidence requirements for `Completed`;
- immutable finalization rows.

Persisted corruption is surfaced as a content-free persistence error rather than silently accepted.

## Privacy boundary

Final manifests contain controlled reconciliation metadata only. Raw Git status, patch or diff bytes, source-file content, absolute repository roots, commit hashes, prompts, source/session identifiers, exceptions, and stacks are excluded from manifests, synthetic Events, evidence messages, and safe results.

## Explicit non-ownership

OL-011 does not implement replay projection or UI, AI summaries, Ownership Moments, cloud replication, analytics, telemetry, billing, user authentication, background scheduling, Git mutation, or agent resumption.
