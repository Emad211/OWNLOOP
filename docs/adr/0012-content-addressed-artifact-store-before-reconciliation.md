# ADR-0012: Build the Content-Addressed Artifact Store Before Git Reconciliation

**Status:** Proposed  
**Date:** 2026-07-22  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
- `docs/product/BACKLOG_v0.1.0.md`

---

## Context

The historical backlog lists repository reconciliation before the content-addressed artifact store. That ordering is internally inconsistent: OL-009 requires large diff material to be represented through artifact references, while OL-010 is the component that makes those references durable, deduplicated, and safely garbage-collectable.

Implementing reconciliation first would require either:

- storing large content in SQLite rows;
- introducing a temporary file format and migrating it later;
- dropping large evidence silently;
- or creating artifact behavior inside the reconciliation module.

Each option weakens ownership boundaries and creates avoidable rework.

OwnLoop already has `artifacts` and `run_artifacts` metadata tables, but no file-store implementation, no atomic write protocol, no integrity verification, no controlled garbage collection, and no protection against storing inside analyzed repositories.

The artifact store must also not become a new redaction layer. It handles opaque bytes that a caller explicitly declares to be prepared for durable storage. Reconciliation remains responsible for reducing/redacting any Git-derived content before calling the store.

---

## Decision

OwnLoop will implement OL-010 before OL-009.

The artifact store will be a local, caller-configured, content-addressed filesystem boundary under the daemon. It will use SHA-256 and store each prepared byte sequence once.

### Storage layout

For a lowercase 64-hex SHA-256 digest:

```text
<artifact-root>/objects/sha256/<first-two-hex>/<remaining-62-hex>
```

SQLite stores only the relative path:

```text
objects/sha256/<first-two-hex>/<remaining-62-hex>
```

The absolute artifact root is configuration and is never persisted in ordinary artifact metadata.

### Prepared-content boundary

The public write API must use an explicit name such as `preparedContent` or `preparedBytes`.

The store:

- does not inspect source repositories;
- does not redact content;
- does not accept raw Git output implicitly;
- does not log or return content;
- writes only bytes that the caller explicitly declares ready for durable local storage.

OL-009 must reduce/redact Git-derived material before artifact insertion.

### Atomic and durable write protocol

For a new artifact:

1. create a private temporary file under the artifact root;
2. stream bytes while computing SHA-256 and enforcing a maximum size;
3. flush and close the temporary file;
4. create the final digest path without overwriting an existing object;
5. if another writer already created it, verify the existing size and digest;
6. remove the temporary file;
7. insert or resolve SQLite metadata and optional Run reference transactionally.

A failed metadata transaction may leave an unreferenced content object. Garbage collection is responsible for removing such files later. It is preferable to losing referenced content.

### Deduplication

Artifact identity is content digest.

- equal bytes resolve to one metadata record and one content object;
- callers may add multiple Run references and roles;
- conflicting metadata for the same digest is rejected unless the only change is sensitivity escalation;
- sensitivity may move only toward a more restrictive value;
- an existing artifact is never replaced in place.

### Root isolation

The artifact root must be canonicalized and must not equal, contain, or be contained by any caller-provided analyzed repository root.

The store exposes no arbitrary relative-path write API. All object paths are derived internally from validated digests.

Directories are private and artifact files are owner-readable/writable only where the platform supports POSIX modes.

### Integrity verification

Reads and reuse verify:

- expected file type;
- expected size;
- expected SHA-256 digest;
- containment under the canonical artifact root.

Corruption produces a typed, content-free error. The store does not return corrupted bytes.

### SQLite metadata

A new migration will version artifact-store metadata while preserving legacy rows.

New content-addressed rows require:

- storage version 1;
- `sha256:<64 lowercase hex>` digest;
- canonical relative object path derived from the digest;
- non-empty media type;
- immutable content identity fields.

Run-artifact references remain many-to-many and are immutable.

Sensitivity may escalate but never downgrade.

### Garbage collection

Garbage collection is explicit and bounded.

For each candidate it:

1. transactionally deletes metadata only if the artifact has zero Run references;
2. removes the corresponding object file;
3. reports only safe artifact identifiers/counts.

Deleting one Task Run removes only its reference. Shared artifact metadata and content survive while another reference remains.

A later orphan-file sweep may delete digest objects that have no metadata row. OL-010 may implement this only through the controlled digest layout; it must never traverse arbitrary caller paths.

---

## Alternatives considered

## Alternative 1: Implement OL-009 first and store large diffs in SQLite

Rejected because it violates the intended separation between structured metadata and large immutable content.

## Alternative 2: Let OL-009 own temporary files

Rejected because reconciliation would become responsible for storage layout, integrity, deduplication, and cleanup.

## Alternative 3: Use digest as an absolute storage path

Rejected because it leaks machine-specific locations into SQLite and complicates relocation.

## Alternative 4: Redact inside the artifact store

Rejected because redaction policy depends on content semantics and evidence context. The store is an opaque prepared-content boundary.

## Alternative 5: Delete files before deleting metadata during GC

Rejected because a concurrent or failed metadata operation could leave a referenced artifact without content. Metadata/reference eligibility is decided transactionally first.

---

## Consequences

### Positive

- OL-009 can reference large prepared evidence without inventing storage behavior;
- content is deduplicated by digest;
- shared artifacts survive deletion of one Run;
- storage is relocatable because SQLite paths are relative;
- corruption is detected before bytes are returned;
- artifact cleanup is explicit and bounded;
- the analyzed repository is never used as OwnLoop storage.

### Negative

- filesystem and SQLite operations cannot form one physical transaction;
- a failed metadata insert may temporarily leave an orphan object;
- callers must prepare/redact content before storage;
- local installation must choose and protect an artifact root;
- synchronous metadata operations and asynchronous file I/O require a carefully separated API.

### Accepted risks

- SHA-256 is accepted as the content identity algorithm for v0.1;
- orphan files are acceptable after crashes because they contain prepared local content and can be swept later;
- artifact root overlap is checked against caller-supplied analyzed roots until installation/runtime orchestration can provide a complete Workspace registry automatically.

---

## Implementation constraints

OL-010 must not implement:

- Git reconciliation or diff generation;
- redaction of raw source/Git content;
- cloud/object-storage upload;
- compression/encryption policy beyond existing local filesystem protections;
- background garbage collection;
- artifact rendering in the UI;
- finalization, AI, analytics, telemetry, billing, or user authentication.

---

## Validation

The decision is validated when tests prove:

- identical prepared bytes deduplicate under concurrent writers;
- metadata and Run references are transactional;
- shared content survives deletion of one Run;
- unreferenced content can be garbage-collected safely;
- root overlap and path traversal are rejected;
- oversized input is rejected and temporary files are removed;
- corruption is detected on read/reuse;
- file-backed restart preserves metadata and content;
- legacy artifact rows remain readable;
- no source repository path, content, or secret appears in safe results/errors.

---

## Reversibility

The storage boundary is isolated behind an artifact-store interface. Replacing the filesystem layout, digest algorithm, or adding encryption/compression/cloud replication requires a superseding ADR and storage migration.