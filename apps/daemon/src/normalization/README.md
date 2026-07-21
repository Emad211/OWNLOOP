# OwnLoop Event normalization

This directory owns the transactional conversion of durable lifecycle-resolved ingress receipts into append-only OwnLoop Events.

## Critical path

```text
lifecycle-resolved receipt
→ ordered Event specifications
→ per-Run sequence allocation
→ Event and deduplication append
→ immutable receipt normalization and indexed linkage
→ commit
```

Reprocessing a normalized receipt returns its stored normalization and linked Event IDs without replaying Event append or sequence allocation.

## Mapping policy v1

- SessionStart → `conversation.started` or `conversation.resumed`
- UserPromptSubmit → `run.started`, then `user.prompt_submitted`
- PreToolUse → `tool.requested`
- PostToolUse → `tool.succeeded`
- PostToolUseFailure → `tool.failed`
- PostToolBatch → `tool.batch_completed`
- Stop → `run.stop_observed`, then `run.finalization_started`
- StopFailure → `run.stop_failed`, then `run.finalization_started`
- SessionEnd → `conversation.ended`

Prompt and Stop-family receipts intentionally emit two Events because a source observation and an OwnLoop lifecycle boundary are distinct facts.

## Source and synthetic payloads

Source Events retain only the complete canonical redacted payload persisted by OL-005A. They never reconstruct unknown or unredacted source fields.

Synthetic OwnLoop Events contain controlled lifecycle metadata only, such as the trigger Hook, lifecycle action, and optional Run number. They do not contain prompt content, paths, source/session identifiers, fingerprints, or arbitrary source values.

## Time, identity, and sequence semantics

- `occurredAt` comes from the prepared receipt's adapter `receivedAt`.
- `ingestedAt` comes from the journal receipt's server-owned `createdAt`.
- `normalizedAt` comes from the normalization processor clock.
- Event IDs are generated through an injected or default safe identifier generator and runtime-validated before persistence.
- Conversation-level Events have null Run and sequence.
- Run-level Events receive positive contiguous sequences allocated inside the same SQLite transaction as Event, deduplication, normalization, and linkage rows.
- Per-output deduplication keys contain only the prepared receipt's safe deduplication key, controlled Event index, and controlled Event type.

A failed transaction commits no Event, deduplication row, linkage row, or normalization row and creates no sequence gap.

## Durable normalization contract

Each lifecycle-resolved receipt receives at most one immutable normalization row:

- `normalized` with one or more linked Events;
- `skipped` with zero Events for a failed lifecycle resolution;
- `failed` with zero Events and a stable diagnostic code.

`receipt_normalized_events` stores zero-based Event indices. Repository reads verify both the declared Event count and contiguous index order, treating persisted corruption as `invalid_persisted_row`.

Each emitted Event also receives a versioned internal deduplication key derived only from the safe receipt deduplication key, Event index, and controlled Event type.

Normalization does not update ingress receipt status or lifecycle state. Its source of truth is the already-committed prepared receipt plus immutable OL-006 lifecycle resolution.

## Explicit non-ownership

OL-007 does not mutate:

- Workspace, Agent Conversation, or Task Run lifecycle;
- receipt processing state or lifecycle resolutions;
- Git state;
- artifacts;
- finalization or recovery;
- Hook transport;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.
