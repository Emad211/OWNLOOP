# Backlog Amendment 0001 — Ingress Security and Milestone A Dependency Order

**Status:** Proposed  
**Date:** 2026-07-21  
**Applies to:** `docs/product/BACKLOG_v0.1.0.md`  
**Related ADRs:** ADR-0003, ADR-0004, ADR-0005

---

## Purpose

This amendment corrects dependency contradictions in the original v0.1.0 backlog without renumbering all later backlog items.

ADR-0004 established that:

- persistence must exist before an ingestion endpoint can truthfully acknowledge a request;
- redaction and canonicalization must happen before journaling;
- lifecycle resolution must happen before normalized event sequencing.

The original backlog still lists:

- OL-003 before the redaction/canonicalization boundary;
- OL-006 normalization before OL-007 lifecycle;
- an immediate order that omits ingress security.

This amendment supersedes only those conflicting sections.

---

## Authoritative Milestone A order

```text
OL-001 Bootstrap
→ OL-002 Runtime contracts
→ OL-005 SQLite persistence foundation
→ OL-005A Canonical ingress reduction, redaction, and fingerprinting
→ OL-003 Loopback ingestion API
→ OL-004 Fail-open Claude Code Hook Adapter
→ OL-006 Workspace, Conversation, and Task Run lifecycle
→ OL-007 Event normalization, idempotency, and sequencing
→ OL-008 Git baseline
→ OL-009 Repository reconciliation
→ OL-010 Artifact store
→ OL-011 Finalization and recovery
→ OL-012 Deterministic raw replay
```

Numeric identifiers do not imply execution order.

---

## OL-005A — Canonicalize and redact ingress before journaling

**Priority:** P0  
**Size:** M  
**Depends on:** OL-002, OL-005

### Scope

Implement the shared deterministic ingress-security boundary defined by ADR-0005:

- canonical parsed-JSON representation;
- source-payload HMAC fingerprinting;
- source-event ID and deduplication-key derivation;
- Hook-specific allowlist reduction;
- secret-field and strong-pattern redaction;
- path reduction;
- bounded processing and safe diagnostics;
- versioned prepared-receipt contract;
- migration version 2 for prepared receipt metadata.

### Acceptance criteria

- only prepared redacted receipt content can reach journal persistence;
- unknown source fields are dropped and counted;
- canonicalization and fingerprints are reproducible;
- source secrets and absolute paths do not occur in prepared payloads, summaries, or errors;
- migration version 1 remains immutable;
- migration version 2 upgrades existing databases;
- no HTTP, Hook forwarding, lifecycle, normalized event, Git, AI, or UI behavior is introduced.

---

## Superseded OL-003 dependency

Replace the original OL-003 dependency with:

```text
Depends on: OL-002, OL-005, OL-005A
```

OL-003 owns:

- loopback-only Fastify transport;
- local installation-token authentication;
- request limits and structured responses;
- prepared-receipt durable insertion;
- truthful acknowledgment after commit.

OL-003 does not own redaction policy, canonicalization, lifecycle resolution, or normalized event creation.

---

## Corrected OL-006

## OL-006 — Implement Workspace, Conversation, and Task Run lifecycle

**Priority:** P0  
**Size:** M  
**Depends on:** OL-003, OL-005, OL-005A

### Scope

Process pending prepared receipts sufficiently to resolve ADR-0003 aggregates and lifecycle state.

### Acceptance criteria

- `SessionStart` creates or resumes an Agent Conversation;
- `UserPromptSubmit` creates a sequential Task Run;
- `Stop` and `StopFailure` enter Finalizing;
- `SessionEnd` closes the conversation;
- invalid transitions are rejected and diagnosed;
- stale runs are discoverable after daemon restart;
- lifecycle behavior is transactional and idempotent;
- no normalized Event sequence is allocated by this item.

This definition supersedes the original OL-007 lifecycle section.

---

## Corrected OL-007

## OL-007 — Implement Event normalization, idempotency, and sequencing

**Priority:** P0  
**Size:** M  
**Depends on:** OL-006

### Scope

Convert lifecycle-resolved prepared receipts into normalized append-only events.

### Acceptance criteria

- duplicate Hook delivery creates one normal event;
- source deduplication and Event append occur transactionally;
- sequence assignment is transactional per Task Run;
- source session and source event identifiers are preserved;
- source and ingestion timestamps remain distinct;
- each supported Hook has fixture-based normalization tests;
- processed and failed receipt states are updated safely;
- unknown dropped fields are represented only through safe diagnostics, not reconstructed.

This definition supersedes the original OL-006 normalization section.

---

## Downstream dependencies

Unless a later ADR changes them:

- OL-008 continues after OL-007;
- OL-009 continues after OL-008 and lifecycle availability;
- OL-010 remains dependent on OL-005;
- OL-011 remains dependent on lifecycle, Git reconciliation, and artifacts;
- OL-012 remains dependent on finalization.

---

## Document precedence

For Milestone A dependency questions, use this order:

1. accepted ADRs;
2. this amendment;
3. the original `BACKLOG_v0.1.0.md`;
4. individual issue numbers or historical PR descriptions.

When the original backlog is next rewritten as a whole, this amendment should be incorporated and then marked superseded.
