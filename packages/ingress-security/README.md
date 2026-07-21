# @ownloop/ingress-security

Pure deterministic preparation of runtime-validated Claude Code Hook ingress for OwnLoop's local durable journal.

The package owns:

- parsed-value Canonical JSON v1;
- HMAC-SHA-256 source-payload fingerprints;
- versioned source-ID or HMAC deduplication keys;
- explicit per-Hook persisted-field allowlists;
- recursive exact-field and strong-pattern secret redaction;
- platform-independent POSIX and Windows path reduction;
- bounded string/array reduction and safe aggregate diagnostics.

It performs no filesystem, environment, network, persistence, logging, HTTP, lifecycle, Git, AI, ID-generation, or UI work.

## Privacy boundary

`canonicalWorkspacePath` is intentionally retained as dedicated local-sensitive routing metadata. Absolute source paths are not permitted in `redactedPayloadJson`, summaries, errors, fingerprints, or deduplication keys.

Unknown Hook-schema extension fields are dropped. Arbitrary JSON inside approved evidence-bearing fields such as `tool_input`, `tool_response`, and `error_details` is retained only after recursive validation and reduction.

Object keys are reduced as well as values. If two keys become identical after secret or path reduction, preparation fails with a content-free policy error rather than silently overwriting data.

## Validation boundary

The package accepts only runtime-validated ingress values and returns a strict, versioned `PreparedIngressReceiptV1`. It never writes the source payload itself. Persistence receives only the prepared receipt's canonical redacted JSON, keyed fingerprint, deduplication key, dedicated routing metadata, and content-free aggregate summary.

Additional defensive guarantees include:

- unterminated private-key blocks are redacted through the end of the retained string;
- RSA, EC, DSA, OpenSSH, and encrypted private-key blocks are recognized by policy v1;
- POSIX, Windows-drive, and UNC `file://` URIs are reduced using the same path policy as ordinary absolute paths;
- malformed or credential-bearing `file://` values fail closed to a non-reversible invalid-path marker;
- dedicated identifiers reject `file://`, URI credentials, absolute paths, control characters, secret assignments, and strong provider-token formats;
- bounded strong-secret patterns consume the complete retained input up to the one-mebibyte source limit rather than leaking suffixes beyond a smaller regex cap;
- prepared receipt content and preparation metadata become immutable after insertion, while processing status may still advance independently.

## Limitations

Policy v1 uses an exact secret-field denylist and bounded strong string patterns. It intentionally does not use entropy heuristics and cannot guarantee detection of every proprietary or novel secret format.

Path recognition is deterministic and conservative. Structured path fields receive full POSIX/Windows handling; unstructured strings recognize bounded absolute-path tokens while ordinary URLs remain intact. Filesystem realpath, symlink resolution, and Git-root discovery are deferred.

Changing canonicalization, redaction, fingerprint, or deduplication semantics requires a new version and compatibility decision.
