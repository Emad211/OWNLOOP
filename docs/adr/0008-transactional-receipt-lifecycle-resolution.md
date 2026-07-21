# ADR-0008: Resolve Prepared Receipts into Transactional Lifecycle Aggregates Before Event Normalization

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/adr/0006-authenticated-loopback-ingestion.md`
- `docs/adr/0007-fail-open-command-hook-adapter.md`
- `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`
- GitHub issue #17

---

## Context

OwnLoop can now durably journal authenticated, runtime-validated, canonical, redacted Claude Code Hook receipts. The journal intentionally does not yet decide which local Workspace, Agent Conversation, or Task Run owns a receipt.

ADR-0003 requires those aggregate boundaries before normalized Event sequencing. A long-lived Claude conversation may contain multiple user prompts, and each `UserPromptSubmit` becomes a distinct Task Run in v0.1. Tool and stop receipts must be associated with the active Task Run before OL-007 can create append-only events with correct `conversationId`, `runId`, and sequence.

Several failure cases make a mutable "best effort" mapping unsafe:

- the daemon can stop after creating a Run but before marking the receipt processed;
- the same process method can be invoked twice;
- a source session can unexpectedly appear under another Workspace path;
- tool/stop events can arrive without an active Run;
- a new prompt can arrive while a previous Run is still Capturing;
- a conversation can end or later resume;
- Git baseline data does not exist until OL-008.

Lifecycle resolution therefore needs its own durable, idempotent, transactional record. It also needs an explicit provisional Workspace identity that does not pretend a Git repository has already been resolved.

---

## Decision

OL-006 will process one prepared ingress receipt at a time through this transaction:

```text
load pending prepared receipt
→ resolve/create provisional Workspace
→ resolve/create/reactivate Agent Conversation
→ apply Hook-specific Task Run transition or association
→ insert one receipt_lifecycle_resolution row
→ mark receipt processed or failed
→ commit
```

No normalized Event, Event deduplication record, or sequence is created in this phase.

### One receipt, one lifecycle resolution

Migration version 3 creates `receipt_lifecycle_resolutions` keyed by `receipt_id`.

The row records only safe lifecycle metadata:

- receipt ID;
- Workspace ID;
- Conversation ID;
- nullable Run ID;
- controlled outcome;
- controlled action;
- nullable controlled diagnostic code;
- resolution timestamp.

Processing an already-resolved receipt returns the stored resolution and does not replay transitions.

Aggregate changes, resolution insertion, and receipt status update occur in one SQLite transaction. A crash cannot commit only part of the lifecycle decision.

### Outcomes

- `applied` — the receipt created or changed lifecycle state;
- `associated` — lifecycle state already existed and the receipt was linked without a new transition;
- `failed` — an expected lifecycle invariant prevented resolution.

A failed outcome requires a controlled diagnostic code. Non-failed outcomes cannot carry one.

### Actions

- `conversation_started`
- `conversation_resumed`
- `conversation_inferred`
- `run_started`
- `run_associated`
- `run_finalizing`
- `conversation_ended`
- `receipt_failed`

### Diagnostic codes

- `legacy_receipt_unsupported`
- `invalid_redacted_payload`
- `conversation_workspace_conflict`
- `conversation_ended`
- `no_active_run`
- `invalid_transition`
- `lifecycle_processing_failed`

The schema and runtime types are version-controlled. Adding an action or diagnostic requires an explicit migration/contract change.

---

## Provisional Workspace identity

OL-006 has canonical local path metadata but no Git baseline. A Workspace created in this phase uses:

- `canonicalPath`: the prepared receipt's canonical Workspace path;
- `repositoryRoot`: the same canonical path provisionally;
- `gitRemote`: null;
- `initialRepositoryFingerprint`: `path-sha256:<64 lowercase hex>` derived from the canonical path;
- `identityBasis`: `canonical_path_v1`.

Migration version 3 adds `identity_basis` with controlled values:

- `legacy`
- `canonical_path_v1`
- `git_resolved_v1`

Existing rows migrate as `legacy` rather than being mislabeled.

The path-derived digest is an identity aid, not a Git-state fingerprint. The database already stores the canonical path; the digest does not introduce a new disclosure surface. OL-008 may enrich the Workspace with resolved repository data and change the identity basis through a later controlled transition.

Workspace lookup remains the unique canonical path. Every successfully resolved receipt advances `lastObservedAt`.

---

## Agent Conversation lifecycle

Conversation identity is:

```text
(source, sourceSessionId)
```

Conversation statuses for new/updated rows are:

- `Active`
- `Ended`

Migration version 3 adds insert/update validation triggers without rewriting legacy rows.

### Inferred Conversation

Any supported prepared receipt may create an inferred Conversation when `SessionStart` was missed. It starts:

- status `Active`;
- `startMode = null`;
- `startedAt = receivedAt`;
- `endedAt = null`.

This prevents a missed startup hook from making all later receipts unusable.

### SessionStart

- creates a Conversation when absent;
- records the redacted source start mode;
- reactivates an Ended Conversation;
- clears `endedAt` on reactivation;
- preserves the original `startedAt` for an existing Conversation;
- advances `lastObservedAt`.

A repeat SessionStart on an already Active Conversation is an associated resolution unless it changes a valid lifecycle attribute.

### Workspace conflict

A `(source, sourceSessionId)` identity is permanently associated with one Workspace. Seeing it under another canonical path fails atomically with `conversation_workspace_conflict`.

### Activity after end

Non-SessionStart activity on an Ended Conversation fails with `conversation_ended`. A later SessionStart may reactivate it.

A repeated SessionEnd on an Ended Conversation is safely associated.

### SessionEnd

- sets Conversation status `Ended`;
- records `endedAt` and `lastObservedAt`;
- abandons every Capturing Run in that Conversation;
- preserves Finalizing Runs for OL-011 finalization/recovery;
- creates a conversation-level resolution with no Run ID.

---

## Task Run lifecycle

### UserPromptSubmit

Every distinct prepared prompt receipt creates a new Task Run.

Within the transaction:

1. abandon any existing Capturing Run with reason `superseded_by_prompt`;
2. compute `max(runNumber) + 1` for the Conversation;
3. create a Run in `Capturing`;
4. store only the redacted prompt extracted from canonical redacted payload JSON;
5. leave all Git baseline/final fields null;
6. return `run_started`.

Finalizing Runs are not abandoned by a new prompt.

### Tool events

`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `PostToolBatch` associate with the latest Run in `Capturing` or `Finalizing`.

No active Run produces a failed resolution with `no_active_run`.

This phase does not create tool Events.

### Stop

The latest Capturing or Finalizing Run is resolved.

- Capturing → Finalizing;
- Finalizing → Finalizing as an associated idempotent lifecycle boundary;
- controlled stop reason `stop` is recorded only when no stronger source reason exists.

### StopFailure

Same transition as Stop, but the safe redacted error string becomes the source stop reason.

### SessionEnd

Capturing Runs become:

- status `Abandoned`;
- `endedAt` set to the receipt time;
- `sourceStopReason = conversation_ended`.

Finalizing Runs remain unchanged.

### Terminal states

OL-006 does not transition Runs into Completed, Partial, or Failed. Those states require Git/finalization evidence and belong to OL-011.

---

## Receipt processing

### Prepared receipts only

Lifecycle processing accepts only `preparationStatus = prepared` records. Legacy pending receipts are marked failed with `legacy_receipt_unsupported`.

### Safe payload projection

The processor parses only canonical `redactedPayloadJson` and extracts the minimum safe fields:

- SessionStart: `source`;
- UserPromptSubmit: `prompt`;
- StopFailure: `error`;
- SessionEnd: `reason` only when needed for later diagnostics.

It never reconstructs dropped source fields and never accesses unredacted source content.

Invalid canonical/redacted structure fails with `invalid_redacted_payload`.

### Pending ordering

Pending receipts are listed by:

```text
created_at ASC, receipt_id ASC
```

Batch processing has an explicit bounded limit and is invoked by a caller. OL-006 does not create a scheduler or background worker.

### Unexpected failures

Expected lifecycle violations are represented atomically as failed resolutions.

Unexpected database/programming failures roll back the transaction. The processor may make a separate bounded attempt to mark the receipt failed with `lifecycle_processing_failed`; it must not expose exception content or pretend partial aggregate work succeeded.

---

## Stale discovery

A Run is stale when:

- its status is Capturing or Finalizing; and
- its Conversation `lastObservedAt` is older than a caller-provided canonical UTC cutoff.

This is discoverable through a deterministic repository query and survives file-backed database close/reopen.

OL-006 does not automatically mutate stale Runs. OL-011 will define recovery/finalization decisions.

---

## Result and error surfaces

Lifecycle processing returns only:

- receipt ID;
- Workspace ID;
- Conversation ID;
- nullable Run ID;
- outcome;
- action;
- nullable diagnostic code.

It never returns or logs:

- prompt content;
- canonical path;
- source session/source event ID;
- payload or fingerprint;
- exception message or stack;
- secret material.

---

## Alternatives considered

## Alternative 1: Normalize Events while resolving lifecycle

Rejected because Event sequence requires a stable Run boundary, and combining both phases recreates the dependency cycle corrected by Backlog Amendment 0001.

## Alternative 2: Store lifecycle fields directly on ingress receipts

Rejected because receipt content and preparation metadata are intentionally immutable, and one resolution table provides an auditable one-to-one processing boundary.

## Alternative 3: Use Git identity immediately

Rejected because Git discovery/baseline is OL-008. A path-based identity is explicit and upgradeable without making an unsupported Git claim.

## Alternative 4: Fail every receipt missing SessionStart

Rejected because Hook delivery is best-effort and a missed startup event should not make later Prompt/Tool/Stop receipts permanently unusable.

## Alternative 5: Allow multiple Capturing Runs

Rejected for v0.1 because later tool receipts would be ambiguous. A new prompt abandons the previous Capturing Run before creating the next.

## Alternative 6: Attach tool receipts to the latest Run regardless of status

Rejected because terminal Runs must not receive new source activity and a stale latest terminal Run is not an active task boundary.

---

## Consequences

### Positive

- lifecycle processing is crash-atomic and idempotent;
- each receipt has an auditable aggregate resolution;
- Event normalization receives stable Workspace/Conversation/Run IDs;
- missed SessionStart can be recovered safely;
- Workspace identity does not overclaim Git knowledge;
- invalid transitions become explicit safe diagnostics;
- stale active work is discoverable after restart.

### Negative

- migration version 3 adds another durable table and multiple repository methods;
- inferred Conversations can have incomplete start metadata;
- abandoning Capturing Runs on a new prompt may split some logically continuous work;
- path-based Workspace identity can later require reconciliation if repository roots differ;
- lifecycle processing remains synchronous with `node:sqlite`.

### Accepted risks

- canonical path is accepted as provisional Workspace identity for v0.1;
- receipt order is ingestion order, not perfect causal order;
- tool receipts arriving after a Run becomes Finalizing remain associated with that Run;
- unexpected failures may leave a failed receipt without a resolution if even the bounded failure-mark attempt cannot commit.

---

## Implementation constraints

OL-006 must not implement:

- normalized Event creation;
- Event sequence allocation or Event deduplication;
- Git repository discovery, baseline, status, diff, or reconciliation;
- final snapshot or finalization completion;
- automatic stale recovery transitions;
- artifact content storage;
- background workers or scheduling;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

---

## Validation

The decision is validated when tests prove:

- migration 2→3 and fresh/reopen behavior;
- provisional Workspace identity and reuse;
- create/infer/resume/end Conversation behavior;
- sequential Prompt Run creation and Capturing abandonment;
- tool association and no-active-run failure;
- Stop/StopFailure Finalizing transitions;
- SessionEnd behavior;
- Workspace conflict and Ended Conversation rejection;
- atomic receipt status/resolution/aggregate changes;
- repeated processing idempotency;
- stale active Run discovery after reopen;
- zero Event rows and zero sequence allocation;
- content-free results/errors;
- standard quality gates.

---

## Reversibility

Lifecycle rules, Workspace identity-basis values, resolution actions, and diagnostic codes are persisted contracts. Changing their meaning requires a new migration and superseding ADR. The processor boundary itself remains replaceable because it operates through explicit persistence repositories.
