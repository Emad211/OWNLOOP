# ADR-0009: Normalize Lifecycle-Resolved Receipts into Transactional Sequenced Events

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/adr/0008-transactional-receipt-lifecycle-resolution.md`
- GitHub issue #19

---

## Context

OL-006 now gives every processable ingress receipt a durable, immutable lifecycle resolution identifying its Workspace, Conversation, and optional Task Run. The append-only Event Store already exists, but no processor currently translates source Hook observations into versioned normalized Events or allocates per-Run sequence numbers.

A one-receipt/one-event assumption is insufficient. Some source observations represent both a lifecycle boundary and a source fact:

- a prompt begins a Run and submits prompt content;
- Stop observes a source stop and begins finalization;
- StopFailure observes a failed stop and begins finalization.

These facts need stable ordering while remaining separately queryable. Normalization must therefore support multiple Events from one receipt.

Normalization must also remain crash-atomic. A process failure cannot append an Event without its deduplication key, linkage, sequence, or receipt-normalization record.

---

## Decision

OL-007 processes one lifecycle-resolved receipt through one SQLite transaction:

```text
load receipt + lifecycle resolution
→ return existing normalization when already processed
→ skip failed lifecycle resolution or build ordered Event specifications
→ allocate Run sequences in specification order
→ append Event rows
→ append per-Event deduplication rows
→ insert receipt normalization row
→ insert indexed receipt/Event links
→ commit
```

No lifecycle aggregate is mutated in this phase.

### One receipt normalization record

Migration version 4 creates `receipt_event_normalizations` keyed by `receipt_id`.

Outcomes:

- `normalized`
- `skipped`
- `failed`

Diagnostics:

- `lifecycle_failed`
- `legacy_receipt_unsupported`
- `invalid_redacted_payload`
- `missing_lifecycle_resolution`
- `invalid_event_mapping`
- `normalization_processing_failed`

A normalized row requires at least one Event and no diagnostic. Skipped/failed rows require zero Events and a diagnostic. Rows are immutable.

### Multi-Event linkage

`receipt_normalized_events` links a receipt normalization to zero or more Event rows using a zero-based `event_index`.

For normalized receipts, indices are inserted contiguously from zero in deterministic mapping order. Event IDs are globally unique and linked to only one receipt.

### Event mapping policy v1

| Hook | Ordered Event output |
|---|---|
| SessionStart | `conversation.started` or `conversation.resumed`, selected from lifecycle action |
| UserPromptSubmit | `run.started`, then `user.prompt_submitted` |
| PreToolUse | `tool.requested` |
| PostToolUse | `tool.succeeded` |
| PostToolUseFailure | `tool.failed` |
| PostToolBatch | `tool.batch_completed` |
| Stop | `run.stop_observed`, then `run.finalization_started` |
| StopFailure | `run.stop_failed`, then `run.finalization_started` |
| SessionEnd | `conversation.ended` |

SessionStart and SessionEnd produce Conversation-level Events with null Run and sequence. All other outputs are Run-level and require the lifecycle resolution's Run ID.

### Source Events

Source Events use:

- `source = claude_code`;
- source Event name/ID from the prepared receipt;
- the complete canonical redacted payload object;
- sensitivity `normal` for SessionStart/SessionEnd;
- sensitivity `sensitive` for Prompt, Tool, Stop, and StopFailure.

The payload is never reconstructed from unredacted data.

### Synthetic OwnLoop Events

`run.started` and `run.finalization_started` are OwnLoop synthetic events:

- `source = ownloop`;
- null source Event name/ID;
- sensitivity `normal`;
- payload containing only controlled lifecycle fields such as trigger Hook, lifecycle action, and Run number.

Synthetic payloads never contain prompt content, source/session identifiers, paths, fingerprints, or arbitrary source values.

### Time model

- `occurredAt` is the prepared receipt `receivedAt`, canonicalized to UTC;
- `ingestedAt` is receipt `createdAt`, canonicalized separately;
- `normalizedAt` is the processor clock;
- Event metadata collector version is receipt adapter version;
- source version is null in v1.

These timestamps are deliberately distinct.

### Per-Run sequencing

For each Run-level Event:

```text
next sequence = max(existing sequence for Run) + 1
```

Allocation occurs inside the same `BEGIN IMMEDIATE` transaction as Event append, deduplication, normalization, and linkage. Multiple Events from one receipt receive adjacent sequences in event-index order.

Conversation-level Events retain null sequence.

A failed transaction leaves no committed sequence gap because no sequence counter is stored separately from committed Events.

### Per-output deduplication

Each emitted Event receives an internal key:

```text
v1:<receipt-deduplication-key>:event:<event-index>:<event-type>
```

The key contains only the already-safe receipt key and controlled output fields. It is stored in the existing `event_deduplication` table with the Event row in the same transaction.

A collision without an existing matching receipt normalization is persisted-state corruption, not a harmless retry.

### Failed lifecycle resolutions

A lifecycle resolution with outcome `failed` emits no Events. OL-007 inserts a skipped normalization with diagnostic `lifecycle_failed` and does not alter receipt or lifecycle state.

### Unexpected failures

Expected mapping/payload failures become immutable failed normalization rows with no Events.

Unexpected persistence/programming failures roll back the entire transaction. A separate bounded transaction may record `normalization_processing_failed`, but it must not claim that any Events were committed.

---

## Consequences

### Positive

- replay order is deterministic within each Run;
- source facts and synthetic lifecycle boundaries remain separately queryable;
- receipt normalization is auditable and idempotent;
- Event/dedup/link/sequence state is crash-atomic;
- source Events retain canonical redacted evidence;
- failed lifecycle receipts cannot leak partial Events.

### Negative

- one receipt can produce multiple Event rows;
- migration version 4 adds two durable tables;
- source payloads may be large even after reduction;
- conversation-level Events have no numeric sequence and require timestamp/event-ID ordering in later queries;
- normalization remains synchronous with `node:sqlite`.

### Accepted risks

- Run ordering follows durable receipt processing order rather than perfect external causality;
- synthetic Event payloads are intentionally minimal;
- receipt-level ingress dedup makes most Event-key collisions signs of corruption rather than normal retries.

---

## Explicitly out of scope

OL-007 does not implement:

- Workspace, Conversation, or Task Run lifecycle mutation;
- Git discovery, baseline, status, diff, or reconciliation;
- finalization/recovery;
- artifact storage;
- Evidence Graph, Ownership Moments, or Build Replay;
- background workers;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

---

## Validation

The decision is validated when tests prove:

- migration 3→4/fresh/reopen behavior;
- all nine Hook mappings;
- multi-Event output order;
- contiguous transactional sequence allocation;
- Event/dedup/link atomicity and rollback;
- normalization idempotency;
- lifecycle-failed skip behavior;
- source/synthetic payload, metadata, sensitivity, and timestamps;
- file-backed replay order;
- content-free results/errors;
- no lifecycle or Git mutation;
- standard quality gates.

---

## Reversibility

Mapping order, synthetic Event semantics, normalization outcomes, diagnostics, and deduplication-key format are persisted contracts. Changes require a new migration and superseding ADR. The processor implementation remains replaceable behind explicit persistence repositories.
