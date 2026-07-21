# OwnLoop content-addressed artifact store

This directory owns durable local storage for **caller-prepared bytes** that are too large or unsuitable for ordinary SQLite rows.

## Prepared-content boundary

The store does not redact, summarize, inspect, or infer whether arbitrary source or Git output is safe. Callers must pass content through an explicit prepared-content API only after applying the policy appropriate to that evidence type.

Public write methods use names such as `putPreparedBytes` and `putPreparedStream`. There is no arbitrary relative-path write API.

## Content identity and layout

Artifact identity is SHA-256 of the prepared bytes.

For digest `sha256:<64 lowercase hexadecimal characters>`, the file is stored beneath the configured artifact root as:

```text
objects/sha256/<first-two-hex>/<remaining-62-hex>
```

SQLite stores only that relative path. The absolute artifact root is never stored in ordinary artifact metadata or returned through safe result objects.

## Atomic write protocol

A new object is materialized through a private temporary file:

1. stream prepared bytes while enforcing the configured maximum size and computing SHA-256;
2. flush and close the temporary file;
3. create the final digest object without replacing an existing object;
4. verify an already-existing object by regular-file type, exact size, and digest;
5. remove the temporary file;
6. transactionally insert or resolve metadata and an optional Task Run reference.

Content may exist briefly without metadata after a crash or metadata failure. Explicit orphan sweeping can remove such objects later. Referenced metadata is never committed before the content object exists.

## Integrity and root isolation

- Object paths are derived internally from validated digests.
- The artifact root is canonicalized and rejected when it overlaps a caller-supplied analyzed repository root in either direction.
- Controlled object directories are revalidated with `lstat` and `realpath`; symlink escapes are rejected.
- Reads use no-follow semantics where supported and verify file type, size, and digest before returning bytes.
- Existing objects are immutable and never replaced in place.
- Directories and files use owner-only POSIX permissions where supported.

## Metadata and references

Version-1 artifact metadata records controlled storage version, digest, relative path, size, kind, media type, sensitivity, and creation time.

- Equal bytes deduplicate to one content object and metadata row.
- Multiple Task Runs and roles may reference the same artifact.
- Duplicate reference insertion is idempotent.
- Content identity fields are immutable.
- Sensitivity may only become more restrictive; downgrade is rejected.
- Legacy metadata remains readable through persistence but is not guessed into the version-1 file layout.

## Garbage collection

Garbage collection is explicit and bounded; no scheduler runs in OL-010.

Metadata-backed collection:

1. selects artifacts with zero Task Run references;
2. transactionally deletes metadata only when it remains unreferenced;
3. removes the derived content object;
4. treats an already-missing object as a controlled result.

Orphan sweeping is restricted to regular files that exactly match the controlled SHA-256 directory layout. It does not traverse arbitrary caller paths or follow symlinks.

Deleting or unlinking one Task Run never removes content while another reference remains.

## Safe result and error boundary

Safe results contain artifact identifiers, digest, size, kind, media type, sensitivity, and reference/collection status only. Errors use stable codes and content-free messages.

They never contain:

- prepared bytes or excerpts;
- the absolute artifact root;
- analyzed repository paths;
- arbitrary filesystem paths;
- exception messages or stacks;
- secrets or credentials.

## Explicit non-ownership

OL-010 does not own:

- Git reconciliation or diff generation;
- redaction or semantic reduction;
- compression, encryption, or cloud replication;
- automatic/background garbage collection;
- artifact rendering;
- Run finalization or recovery;
- AI, analytics, telemetry, billing, or user authentication.
