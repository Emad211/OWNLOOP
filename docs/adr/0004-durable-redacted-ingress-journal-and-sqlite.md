# ADR-0004: Persist Redacted Ingress Receipts Before Acknowledgment Using Node SQLite

**Status:** Proposed  
**Date:** 2026-07-19  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0002-local-first-claude-code-first-mvp.md`
- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/architecture/C4.md`
- `docs/product/BACKLOG_v0.1.0.md`

---

## Context

OwnLoop receives coding-agent hook payloads on the critical ingestion path. The C4 architecture requires the daemon to acknowledge an ingress request only after durable local persistence. Expensive normalization, repository reconciliation, and analysis must happen later.

The original backlog placed the loopback ingestion API before the SQLite event database. That ordering is not implementable without weakening one of the following guarantees:

- returning `accepted` before data is durable;
- persisting an unredacted raw payload;
- coupling the HTTP endpoint to incomplete normalization and Task Run lifecycle logic;
- hiding data loss behind a successful response.

There is a second dependency problem. A normalized event needs workspace, conversation, and sometimes Task Run identifiers plus transactional sequencing. Those values are produced by lifecycle resolution. Lifecycle resolution itself begins from the source hook payload. Requiring a fully normalized event before durable receipt creates a cycle between ingestion, lifecycle, normalization, and persistence.

OwnLoop therefore needs a durable boundary record that exists before normalized event processing but does not persist unredacted source content.

The project also needs a SQLite implementation choice. The runtime is pinned to Node.js 24.18.0. That release includes the built-in `node:sqlite` module, currently marked as release candidate. Alternatives introduce additional native binaries, cloud-oriented clients, or an ORM and migration tool before the schema has stabilized.

---

## Decision

OwnLoop will introduce a **Durable Redacted Ingress Journal**.

The critical path becomes:

```text
validated adapter envelope
→ deterministic reduction and redaction
→ canonical redacted ingress receipt
→ SQLite transaction commit
→ accepted response
```

The asynchronous processing path becomes:

```text
pending redacted ingress receipt
→ workspace/conversation/run resolution
→ event normalization
→ idempotency and sequence allocation
→ append normalized event
→ mark receipt processed or failed
```

### Meaning of `accepted`

An ingestion response with `status: accepted` means only:

> A validated, canonical, redacted ingress receipt has been durably committed to the local SQLite journal.

It does not mean:

- normalization completed;
- a Task Run was resolved;
- Git reconciliation completed;
- an Ownership Moment exists;
- downstream analysis succeeded.

### Raw payload policy amendment

ADR-0003 remains correct that unredacted raw Claude hook payload storage is disabled by default.

This ADR permits a transient durable record containing the **redacted and reduced ingress envelope**. It is an operational journal, not the canonical event source of record. The normalized append-only event remains the durable analytical record.

The journal must never contain a column or API named as a generic raw payload. Persistence APIs must explicitly require a value named `redactedPayloadJson` or equivalent.

### SQLite implementation

OwnLoop v0.1 will use:

- the built-in `node:sqlite` module;
- `DatabaseSync` inside the single local daemon process;
- explicit SQL;
- prepared statements;
- explicit transactions;
- versioned internal migrations;
- migration checksums recorded in `schema_migrations`;
- no ORM or external SQLite driver.

The persistence implementation must be isolated under the daemon persistence boundary so the driver can be replaced later without changing domain contracts.

### Connection policy

Every database connection must:

- enable foreign-key enforcement;
- configure a bounded busy timeout;
- prefer WAL for file-backed databases when supported;
- use a documented synchronous durability level suitable for a local event journal;
- keep defensive SQLite behavior enabled;
- receive an explicit database path;
- avoid choosing a path inside the analyzed repository automatically.

### Migration policy

Migrations are immutable ordered definitions with:

- a positive integer version;
- a stable name;
- explicit SQL;
- a SHA-256 checksum;
- transactional application;
- checksum verification on later startups.

For v0.1, migration definitions may be TypeScript modules containing immutable SQL strings. This avoids adding an asset-copy pipeline or migration framework while keeping SQL explicit and reviewable.

Runtime-generated schema mutation and `push`-style migration are not allowed.

### Append-only event enforcement

Normalized event rows are append-only at two levels:

1. the repository interface exposes no update operation;
2. a database trigger rejects SQL `UPDATE` statements against the event table.

Explicit aggregate deletion remains permitted for local privacy and cleanup.

### Revised Milestone A execution order

The implementation order is changed to:

```text
OL-002 runtime contracts
→ OL-005 SQLite persistence foundation and ingress journal
→ ingress reduction/redaction and canonicalization
→ OL-003 loopback ingestion API
→ OL-004 fail-open Claude Code hook adapter
→ lifecycle resolution
→ normalized event processing, idempotency, and sequencing
→ Git baseline and reconciliation
→ deterministic raw replay
```

Numeric issue identifiers do not define implementation order. Dependency correctness takes precedence.

---

## Alternatives considered

## Alternative 1: Build the HTTP endpoint before persistence

### Rejected because

- it cannot satisfy persist-before-acknowledge semantics;
- an in-memory accepted queue can lose events on process exit;
- returning `accepted` would be misleading;
- later retrofitting durability changes the endpoint's core behavior.

## Alternative 2: Normalize synchronously before acknowledgment

### Rejected because

- normalization depends on aggregate and sequence resolution;
- lifecycle resolution and persistence are not yet implemented;
- expensive processing would enter the hook critical path;
- failures would increase agent latency and coupling.

## Alternative 3: Persist the complete unredacted hook payload

### Rejected because

- tool input and response can contain source code, credentials, commands, or secrets;
- it conflicts with the local privacy model and ADR-0003;
- encryption alone does not satisfy the no-secret-persistence requirement;
- raw retention is unnecessary for the first trustworthy vertical slice.

## Alternative 4: Drizzle ORM with `node:sqlite`

### Rejected for v0.1 because

- current official integration documentation uses release-candidate Drizzle packages;
- it adds an ORM and migration tool while the schema is still changing rapidly;
- the project needs SQLite-specific constraints and triggers that remain explicit in SQL;
- the direct schema is small enough to maintain without an ORM.

This decision can be revisited when query complexity or schema evolution creates measurable maintenance cost.

## Alternative 5: `better-sqlite3`

### Rejected for v0.1 because

- it adds a native addon and platform-specific binary concerns;
- Windows and exact Node-version compatibility add operational risk for a one-person team;
- the built-in module already provides the required synchronous API.

## Alternative 6: libSQL or a hosted SQLite service

### Rejected because

- remote synchronization is outside v0.1;
- it expands privacy and network scope;
- cloud features are not needed for a local single-user prototype.

---

## Consequences

### Positive consequences

- the ingestion API can make a truthful durable acknowledgment;
- transport remains separated from normalization and lifecycle logic;
- daemon crashes after acknowledgment do not silently lose the accepted receipt;
- unredacted source payloads remain outside persistence;
- persistence can be tested before any Hook or HTTP integration;
- no external database dependency or native addon is introduced;
- explicit SQL keeps constraints, indexes, and triggers reviewable;
- later processing can retry failed receipts.

### Negative consequences

- `node:sqlite` is still release candidate in Node.js 24.18.0;
- synchronous database calls can block the event loop;
- SQL and row mapping must be maintained manually;
- a redacted ingress journal adds another record type and cleanup responsibility;
- redaction/canonicalization must be implemented before the HTTP endpoint;
- migration tooling is intentionally minimal.

### Accepted risks

- synchronous writes are accepted because ingress records are small and the daemon is a local single-process prototype;
- Node.js is pinned exactly, reducing driver-version variation;
- the persistence boundary must remain small so a future driver replacement is possible;
- automatic journal retention and cleanup may be deferred, but full local deletion must remain possible.

---

## Implementation constraints

The persistence task must not implement:

- HTTP transport;
- stdin handling;
- Hook forwarding;
- ingress redaction logic;
- normalization;
- deduplication decision behavior;
- sequence allocation behavior;
- Task Run state transitions;
- Git reconciliation;
- artifact-file storage;
- AI or UI features.

It may create schema constraints and low-level repositories required by those later behaviors.

---

## Validation

This decision is validated when tests prove:

- migrations apply on new memory and file databases;
- migration checksums prevent silent history changes;
- a file-backed database survives close and reopen;
- a caller-provided redacted receipt is durably stored;
- unredacted payload storage has no schema or repository path;
- event updates are rejected;
- foreign keys, unique constraints, JSON checks, and cascades work;
- a shared artifact record survives deletion of one referencing Task Run.

---

## Reversibility

The persistence driver can be replaced behind the daemon persistence boundary.

Replacing `node:sqlite`, introducing an ORM, changing the journal's security model, or returning `accepted` before durable commit requires a new ADR that supersedes this decision.

---

## References

- Node.js 24 SQLite documentation: <https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>
- Drizzle Node SQLite documentation: <https://orm.drizzle.team/docs/sqlite/connect-node-sqlite>
