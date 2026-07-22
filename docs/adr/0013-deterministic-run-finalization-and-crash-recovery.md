# ADR-0013: Finalize Runs Deterministically and Recover Stale Runs Without Resuming the Agent

**Status:** Proposed  
**Date:** 2026-07-22  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0008-transactional-receipt-lifecycle-resolution.md`
- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
- `docs/adr/0011-evidence-bounded-git-reconciliation.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- GitHub issue #29

---

## Context

OwnLoop now has durable Run lifecycle state, a baseline, append-only normalized Events, evidence-bounded repository reconciliations, and a local content-addressed artifact store. A Run can enter `Finalizing` after a Stop or StopFailure boundary, but no accepted component currently seals the final evidence, selects a terminal status, or recovers active Runs that survived a daemon interruption.

The finalization boundary must preserve several accepted guarantees:

- an apparently successful Run cannot be labeled complete when evidence is missing;
- raw Git status, patch bytes, file content, repository roots, commit IDs, and secrets are not copied into replay-facing surfaces;
- Event sequences remain append-only and contiguous;
- artifact content and SQLite cannot form one physical transaction, so prepared content may become an unreferenced GC candidate after a failed database transaction;
- crash recovery must never invoke, contact, or resume Claude Code;
- reprocessing and concurrent calls must not duplicate terminal Events, artifacts, evidence gaps, or sequence numbers.

A normal finalization should reuse the authoritative Stop/StopFailure Event and OL-009 reconciliation rather than creating a parallel repository-analysis model. If the stop reconciliation is absent, the existing OL-009 reconciler may be invoked before the final database transaction. Stale `Capturing` Runs have no reliable stop boundary and therefore cannot claim a final repository snapshot. Stale `Finalizing` Runs can attempt the normal evidence path, but the restart itself creates uncertainty and forces a terminal `Partial` outcome.

---

## Decision

OwnLoop will implement one immutable finalization record per Task Run and explicit synchronous/async APIs for normal finalization and bounded startup recovery.

### Normal finalization

For a Run in `Finalizing`:

1. resolve the authoritative Run-level source Event:
   - latest `run.stop_observed`, or
   - latest `run.stop_failed`;
2. ensure the OL-009 reconciliation linked to that Event exists, invoking `reconcileGitAtTrigger` when absent;
3. derive a deterministic prepared final-diff manifest from the reconciliation's controlled metadata and entries;
4. store the manifest in OL-010 without linking it to the Run yet;
5. enter one SQLite transaction;
6. re-check Run status and existing finalization;
7. classify the terminal outcome;
8. link the manifest artifact using the controlled role `final-diff-manifest-v1` when available;
9. append a synthetic `snapshot.final_captured` Event when a final reconciliation exists;
10. append exactly one terminal Event;
11. update the Task Run terminal status, `endedAt`, and final fingerprint when reliable;
12. insert controlled evidence gaps and increment the Run evidence-gap count when required;
13. insert the immutable finalization record;
14. commit.

If the database transaction fails after artifact materialization, the object remains unreferenced and is eligible for explicit OL-010 garbage collection. A failed transaction must not leave a terminal Run, Event, artifact reference, evidence counter increment, or sequence gap.

### Terminal classification

A normal Stop may become `Completed` only when all of the following are true:

- the Run is `Finalizing`;
- the authoritative boundary is `run.stop_observed`;
- a captured Git baseline exists;
- a captured stop-boundary reconciliation exists;
- the reconciliation has a non-null final working-tree fingerprint;
- the prepared final-diff manifest is available;
- the Run has no existing evidence gap;
- Event continuity and aggregate ownership are valid.

Otherwise a retainable normal-Stop Run becomes `Partial`.

A `run.stop_failed` boundary becomes terminal `Failed`. Missing or partial evidence remains explicitly represented through a diagnostic and evidence gap; failure is not silently labeled complete.

Persisted metadata, integrity, reconciliation, or artifact corruption propagates as a typed failure and is never hidden as ordinary incomplete evidence.

### Crash recovery

Recovery is explicit and bounded. No timer or background worker is introduced.

For stale Runs selected by `conversation.lastObservedAt < cutoff`:

- the cutoff must be an ISO datetime with an explicit UTC offset and is canonicalized to UTC before SQLite selection and transactional re-check;
- stale `Capturing` → `Abandoned`;
- stale `Finalizing` → attempt normal final evidence resolution but force terminal `Partial`;
- status and staleness are re-checked inside the write transaction;
- a Run that became active/recent before the transaction is skipped;
- deterministic order is oldest conversation observation, conversation ID, then Run number;
- maximum batch size is 25;
- recovery never invokes or resumes Claude Code.

### Final-diff manifest

The final manifest is canonical UTF-8 JSON prepared by the finalization module and handed to OL-010 as opaque prepared bytes.

It contains only controlled fields already accepted by OL-009:

- manifest schema/version;
- internal Run and reconciliation identifiers;
- reconciliation outcome, diagnostic, attribution, baseline comparison, and boundary;
- whether a final fingerprint is available;
- controlled dirty flags and counts;
- ordered entries containing:
  - event index;
  - path identity SHA-256;
  - nullable safe relative path;
  - change kind;
  - staged/unstaged booleans;
  - sensitivity;
  - attribution.

It excludes:

- absolute repository roots;
- HEAD/commit identifiers;
- Git/status/diff hashes;
- raw status or patch bytes;
- file contents;
- prompt or source-session data;
- exception messages or stacks.

Manifest artifact metadata:

- kind: `final-diff-manifest-v1`;
- media type: `application/vnd.ownloop.final-diff+json`;
- sensitivity: `sensitive`;
- Run reference role: `final-diff-manifest-v1`.

Equal manifests deduplicate by OL-010 content digest.

### Events

Finalization appends Events using the existing Event Store and next positive Run sequence.

When a final reconciliation exists:

1. `snapshot.final_captured`
2. terminal Event

When stale `Capturing` recovery has no reliable final snapshot:

1. `run.abandoned`

Terminal mapping:

- `Completed` → `run.completed`
- `Partial` → `run.partial`
- `Failed` → `run.failed`
- `Abandoned` → `run.abandoned`

Events are synthetic OwnLoop Events with normal sensitivity, null source identifiers, controlled payloads only, and deterministic deduplication keys. Payloads may contain finalization ID, outcome, mode, diagnostic, reconciliation/manifest presence, counts, and recovery reason, but no path, Git hash, content, prompt, source identifier, or exception.

### Persistence

Migration v8 adds `run_finalizations`, one immutable row per Run.

The row stores:

- finalization ID;
- Workspace/Conversation/Run ownership;
- terminal status;
- mode `normal | recovery`;
- nullable trigger Event;
- nullable final reconciliation;
- nullable final-manifest artifact;
- nullable final fingerprint;
- nullable final snapshot Event;
- required terminal Event;
- nullable controlled diagnostic;
- finalized timestamp;
- generator version.

Database constraints and repository reads validate:

- terminal status/outcome combinations;
- normal versus recovery requirements;
- aggregate-safe foreign keys;
- trigger Event type and ownership;
- reconciliation ownership and stop-boundary relationship;
- artifact kind, storage version, and Run role;
- snapshot and terminal Event types, sources, ownership, and order;
- final fingerprint consistency with reconciliation;
- immutability and one finalization per Run.

### Diagnostics and evidence gaps

Controlled diagnostics include at least:

- `baseline_missing`
- `baseline_partial`
- `final_reconciliation_missing`
- `final_reconciliation_partial`
- `final_fingerprint_missing`
- `manifest_unavailable`
- `existing_evidence_gaps`
- `source_stop_failure`
- `stale_capturing_recovered`
- `stale_finalizing_recovered`
- `finalization_processing_failed`

Finalization inserts at most one new finalization-specific evidence gap per Run. Existing evidence-gap count still prevents `Completed` but is not duplicated.

### Idempotency and concurrency

- one finalization row per Run is authoritative;
- repeated calls return the persisted safe result and linked Event/artifact identifiers;
- finalization re-checks state inside `BEGIN IMMEDIATE`;
- concurrent calls cannot allocate duplicate sequences or terminal Events;
- prepared artifact materialization may happen more than once, but OL-010 deduplicates content and only one Run reference is committed;
- terminal Runs without a finalization row are persisted-state corruption and are not silently repaired.

---

## Alternatives considered

## Alternative 1: Capture a separate final Git model inside OL-011

Rejected because OL-009 already owns repository reconciliation, attribution, and privacy policy. Finalization selects and seals that evidence.

## Alternative 2: Mark stale Finalizing Runs Completed when reconciliation is complete

Rejected because restart recovery means the original finalization boundary was interrupted. The Run must remain explicitly Partial.

## Alternative 3: Mark baseline/reconciliation failure directly as Run Failed

Rejected because incomplete evidence is different from observed execution failure. `Partial` preserves the captured work while communicating uncertainty.

## Alternative 4: Store manifest JSON in SQLite

Rejected because artifact storage already owns larger immutable prepared content and raw replay needs a durable reference boundary.

## Alternative 5: Link the artifact before preparing terminal database state

Rejected as the final operation; artifact bytes may be materialized first, but the Run reference must be created inside the finalization transaction.

## Alternative 6: Resume Claude or replay hooks during recovery

Rejected. OwnLoop is observational and recovery must not change agent behavior.

---

## Consequences

### Positive

- every terminal Run has one durable explanation of how it ended;
- completeness is evidence-gated;
- restart recovery is explicit and deterministic;
- raw replay receives a stable final manifest reference;
- Event order and sequence integrity remain append-only;
- missing evidence is visible rather than silently inferred;
- repeated or concurrent finalization is safe.

### Negative

- finalization spans asynchronous artifact materialization plus a synchronous SQLite transaction;
- failed transactions may leave GC-eligible unreferenced objects;
- stale Finalizing Runs are conservative `Partial` even if evidence otherwise appears complete;
- no background scheduler invokes recovery automatically in this task;
- finalization relies on existing stop Events and reconciliation policy.

### Accepted risks

- a normal Run with any existing evidence gap cannot be `Completed`;
- final-diff manifest stores safe relative paths for non-sensitive entries;
- explicit startup orchestration will decide when to call recovery later;
- filesystem/SQLite atomicity is approximated through immutable content objects, transactional references, and garbage collection.

---

## Implementation constraints

OL-011 must not implement:

- raw Git patch/status/content capture;
- agent/session resumption;
- automatic timers or background scheduling;
- replay API/UI projection;
- AI summaries or Moments;
- cloud replication;
- analytics, telemetry, billing, or user authentication.

---

## Validation

The decision is validated when tests prove:

- normal complete Stop → Completed;
- incomplete Stop → Partial;
- StopFailure → Failed;
- stale Capturing → Abandoned;
- stale Finalizing → forced Partial;
- final manifests are deterministic, content-addressed, and privacy-bounded;
- final Events are contiguous and idempotent;
- terminal Run, finalization, Events, artifact reference, evidence gap, and counter are atomic;
- rollback leaves no terminal state or sequence gap;
- recovery re-checks staleness and never resumes the agent;
- file-backed restart preserves all relationships;
- safe results/errors contain no sensitive evidence.

---

## Reversibility

The finalization processor and immutable table isolate policy. Changing completion criteria, recovery outcomes, manifest format, or terminal Event policy requires a superseding ADR and migration.