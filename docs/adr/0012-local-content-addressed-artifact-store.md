# ADR-0012: Store Prepared Evidence in a Local Content-Addressed Boundary

**Status:** Proposed
**Date:** 2026-07-22
**Decision owner:** Project founder
**Related documents:**

- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
- `docs/adr/0011-evidence-bounded-git-reconciliation.md`
- GitHub issue #25

---

## Context

OwnLoop persists structured evidence in SQLite, but large prepared evidence must not be embedded in
ordinary database rows or written into an analyzed repository. The existing `artifacts` and
`run_artifacts` tables provide metadata and many-to-many Run references, but they do not provide an
object store, atomic content writes, integrity verification, storage-root isolation, or safe garbage
collection.

The artifact boundary must not become a redaction engine. Callers remain responsible for preparing
content before storage. The store accepts opaque bytes only when the caller explicitly declares them
ready for durable local persistence.

OL-009 is already merged and owns migration v6 and ADR-0011. OL-010 therefore extends the current
schema through migration v7 and does not retroactively change reconciliation behavior.

---

## Decision

OwnLoop will provide a local content-addressed artifact store under the daemon. Artifact identity is
the SHA-256 digest of caller-declared prepared bytes.

### Object layout

For lowercase SHA-256 hex `<hex>`, the only valid version-1 object location is:

```text
<artifact-root>/objects/sha256/<hex[0:2]>/<hex[2:]>
```

SQLite stores only the relative path. The canonical absolute artifact root is configuration and is
never persisted in ordinary artifact metadata or returned in safe results.

### Root isolation

At store initialization, OwnLoop canonicalizes the artifact root and every caller-provided analyzed
repository root. The artifact root must not equal, contain, or be contained by an analyzed repository
root.

The store exposes no arbitrary relative-path write API. Object paths are derived internally from a
validated digest. Managed directories are private and object files are owner-readable/writable where
POSIX modes are supported.

### Prepared-content API

Public write operations explicitly name prepared content:

- `putPreparedBytes`;
- `putPreparedStream`;
- `putPreparedArtifactForRun`.

The store does not inspect repositories, infer whether bytes are safe, redact content, generate Git
diffs, or log content.

### Atomic object write

For new prepared content, OwnLoop:

1. creates a private temporary directory and file under the artifact root;
2. streams bytes while computing SHA-256 and enforcing a default 64 MiB limit;
3. flushes and closes the temporary file;
4. materializes the digest object without replacing an existing path;
5. verifies any concurrently existing object by regular-file type, exact size, and digest;
6. removes the temporary file and directory;
7. transactionally inserts or resolves metadata and an optional Run reference.

A failed metadata transaction may leave an unreferenced valid object. Explicit orphan sweeping handles
that case; referenced content is never sacrificed to make filesystem and SQLite commits appear atomic.

### Metadata and deduplication

Migration v7 preserves migrations 1–6 and legacy artifact rows. Version-1 rows require:

- `storage_version = 1`;
- digest `sha256:<64 lowercase hex>`;
- the exact relative path derived from the digest;
- non-empty kind and media type;
- non-negative size;
- immutable content identity fields.

Equal prepared bytes resolve to one object and one metadata row. Multiple Runs and roles may reference
the same artifact. Duplicate reference insertion is idempotent.

A persisted row with the same digest but conflicting size, derived path, storage version, media type,
or kind is corruption and is rejected. Sensitivity may only escalate in the order:

```text
public < normal < sensitive < secret
```

### Verified reads

The file-store read boundary accepts only storage-version-1 rows and verifies:

- digest-derived path and containment;
- non-symlink regular-file type;
- exact size;
- SHA-256 digest.

Corruption returns a typed content-free error and no bytes. Legacy rows remain readable through the
persistence repository but are unsupported by the file-store API.

### Run references

Metadata and an optional Run reference are inserted in one SQLite transaction. Existing artifacts may
be linked idempotently to additional Runs or roles. References are immutable but may be explicitly
unlinked. Deleting one Run removes only its references; shared metadata and content survive while any
other reference remains.

### Explicit garbage collection

OL-010 has no background scheduler.

Metadata garbage collection is explicit and bounded to at most 100 candidates. It deletes metadata
only when the artifact is still unreferenced, then removes the corresponding object. A missing object
is a controlled result. Referenced artifacts are never deleted.

Orphan-object sweeping is also explicit and bounded. It examines only regular files inside the exact
`objects/sha256/<2-hex>/<62-hex>` layout, never follows symlinks, and never traverses arbitrary paths.

### Safe result and error boundary

Safe results and errors may contain controlled identifiers, metadata, counts, and status values. They
must not contain prepared bytes unless returned by an explicit successful read, absolute roots,
analyzed repository paths, arbitrary filesystem paths, exception text, or stacks.

---

## Consequences

### Positive

- large prepared evidence is deduplicated outside SQLite;
- content integrity is independently verifiable;
- analyzed repositories remain isolated from OwnLoop storage;
- shared Run references are safe;
- leaked or abandoned objects have an explicit bounded cleanup path;
- OL-011 and later evidence producers gain one stable local artifact boundary.

### Costs

- filesystem and SQLite cannot be committed in one atomic transaction;
- valid unreferenced objects may temporarily remain after metadata failure;
- reads hash content before returning it;
- callers must prepare/redact content before insertion.

---

## Rejected alternatives

### Store bytes directly in SQLite

Rejected because large evidence would inflate the journal, complicate retention, and weaken streaming
and deduplication behavior.

### Let callers choose storage paths

Rejected because caller-controlled paths create traversal, overlap, overwrite, and privacy risks.

### Replace existing digest objects

Rejected because content-addressed identity requires immutability. Existing objects are verified, not
repaired in place.

### Delete files before metadata

Rejected because a concurrent or remaining reference could lose content. Reference eligibility is
resolved transactionally before object removal.

### Automatic garbage collection

Rejected for OL-010 because background scheduling, lifecycle policy, and retention policy are outside
the current scope.
