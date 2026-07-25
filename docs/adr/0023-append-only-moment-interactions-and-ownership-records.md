# ADR-0023: Persist Append-Only Moment Interactions Without Claiming Comprehension

**Status:** Proposed  
**Date:** 2026-07-25  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- `docs/adr/0018-strict-evidence-backed-candidate-moment-contracts.md`
- `docs/adr/0021-deterministic-candidate-validation-and-selection.md`
- `docs/adr/0022-read-only-finite-ownership-moment-projection.md`
- GitHub Issue #63

---

## Context

OL-020 renders a finite selected-only Ownership Moment projection and provides acknowledgement, response, answer, and usefulness controls in React page memory. Those controls intentionally disappear on refresh because the semantics of durable interaction history had not yet been accepted.

OL-021 must persist interactions without making unsupported claims. A recorded click or selected response can prove only that OwnLoop durably recorded that action against an exact verified Moment. It cannot prove comprehension, correctness, authorship, legal ownership, agreement, safety, or learning.

History must remain append-only. Repeated views and repeated responses are meaningful chronology and must not be overwritten by a current-state row.

---

## Decision

OwnLoop will persist one append-only interaction row per explicit browser action and derive current state from history.

```text
exact verified OL-020 Moment
+ authenticated strict interaction action
→ append-only interaction history
→ optional bounded ownership record
→ deterministic current-state projection
→ durable UI rehydration
```

No interaction artifact, mutable Moment table, account system, background worker, scheduler, or provider call is introduced.

## Local actor

v0.1 uses one controlled actor literal:

```text
local_user
```

It means only the authenticated user of the local installation. No account, email, remote identity, token hash, device fingerprint, or multi-user authorization is added.

## Exact source verification

Every write is bound to an exact:

- Run ID;
- OL-019 validation ID;
- OL-020 Moment display ID;
- source Candidate index/fingerprint;
- Moment type.

Before insertion, the daemon regenerates the requested validation's verified OL-020 projection and proves that the Moment exists and that the requested action is allowed by the exact Candidate interaction definition. Evidence views must reference one Evidence ID from that Moment's graph-owned Evidence union.

An interaction may target a valid older validation that was already displayed even if a newer validation appears concurrently.

## Interaction identity and idempotency

The browser creates a page-memory cryptographically random ID:

```text
ix_<48 lowercase hexadecimal characters>
```

The ID is reused only to retry the same canonical request.

- same ID and same canonical request: idempotent replay;
- same ID and different request: conflict;
- intentional repeated actions: new IDs and new rows.

## Interaction actions

Version 1 accepts only:

- `moment_viewed`;
- `evidence_viewed` with one exact Moment Evidence ID;
- `acknowledgement_set` with a boolean;
- `decision_response_set` with `confirm | revise | uncertain`;
- `risk_response_set` with `acknowledge | mitigate | dismiss`;
- `check_answer_set` with one exact Candidate choice ID;
- `usefulness_set` with `useful | not_useful | unset`.

No free-form user text is accepted.

## Persistence

Migration v17 preserves migrations 1 through 16 and creates strict tables:

### `moment_interactions`

Stores controlled interaction identity, exact source identity, action/value columns, server UTC timestamp, contract version, and canonical request fingerprint.

It is append-only through repository design and an UPDATE-rejecting trigger. It has no DELETE-blocking trigger so parent Run cascade deletion remains possible.

### `ownership_records`

Stores at most one record for each qualifying explicit state-changing interaction:

- acknowledgement;
- Decision/Risk response;
- Check answer;
- usefulness feedback.

Moment and Evidence views create no Ownership Record.

Each record carries the assertion code `interaction_recorded` and an explicit no-comprehension constraint. It contains no arbitrary statement text.

Both tables cascade from Task Run deletion. Deleting one Run cannot affect another Run.

## Current state

Current state is reduced deterministically from history ordered by:

```text
created_at ASC,
interaction_id ASC
```

Counts retain all views/history, while acknowledgement, response, answer, and usefulness reflect the latest corresponding action.

## API

The existing authenticated Replay server adds:

```text
GET /v1/replay/runs/:runId/moment-interactions?validationId=<validationId>
POST /v1/replay/runs/:runId/moments/:momentId/interactions
```

Authentication precedes reads/writes. The POST transaction inserts the interaction and optional Ownership Record atomically. Exact retries return the same receipt with an idempotent marker. Conflicting ID reuse fails without inserting anything.

No PUT, PATCH, DELETE, CORS, second listener, or interaction-specific deletion route is added.

## UI

The OL-020 controls become durable:

- state is hydrated for the exact displayed validation;
- visible cards append Moment-view history;
- successful Evidence resolution appends Evidence-view history;
- explicit controls persist before showing saved state;
- failed retries reuse the same interaction ID;
- reconnect/remount rehydrates state;
- authorization failure clears all page credentials and projections.

The UI states:

> Recorded interactions show what was selected or viewed. They do not prove comprehension or ownership.

No browser storage or URL serialization is used.

## Consequences

### Positive

- repeated interactions remain auditable history;
- current controls survive refresh and daemon restart;
- retries are idempotent;
- every write is tied to a verified selected Moment;
- Run deletion removes its interaction history;
- ownership wording remains evidence-bounded.

### Negative

- one page load may append several view rows;
- current state requires reduction over bounded history;
- v0.1 has one controlled local actor only;
- individual history rows cannot be edited or deleted.

## Alternatives rejected

### Overwrite one current-state row

Rejected because repeated views and response changes would disappear.

### Treat acknowledgement as comprehension

Rejected because the interaction does not prove understanding.

### Persist free-form notes

Rejected because free text expands privacy, moderation, and schema scope.

### Use browser storage

Rejected because the durable source of truth belongs to the authenticated local daemon.

### Create interaction artifacts

Rejected because controlled relational rows are bounded and need transactional current-state queries.

---

## Validation

The decision is accepted when Issue #63 contract, migration, append-only, idempotency, concurrency, exact-Moment verification, cascade deletion, API, UI rehydration, privacy, accessibility, full-regression, and production-build tests pass.

## Reversibility

Multi-user identity, free-form notes, individual history deletion, interaction export, retention scheduling, or formal comprehension assessment requires a later accepted decision.
