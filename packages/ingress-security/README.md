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

## Limitations

Policy v1 uses an exact secret-field denylist and bounded strong string patterns. It intentionally does not use entropy heuristics and cannot guarantee detection of every proprietary or novel secret format.

Path recognition is deterministic and conservative. Structured path fields receive full POSIX/Windows handling; unstructured strings recognize bounded absolute-path tokens while ordinary URLs remain intact. Filesystem realpath, symlink resolution, and Git-root discovery are deferred.

Changing canonicalization, redaction, fingerprint, or deduplication semantics requires a new version and compatibility decision.
