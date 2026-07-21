# OL-005A Normative Clarifications

**Status:** Normative for GitHub issue #10 and `OL-005A_CODEX_TASK.md`  
**Date:** 2026-07-21

These clarifications resolve ambiguities discovered during planning review. When wording conflicts, this file and ADR-0005's core security intent take precedence.

---

## 1. Dedicated canonical workspace path is an intentional exception

`PreparedIngressReceiptV1.canonicalWorkspacePath` intentionally contains a canonical absolute local path because restart-safe Workspace resolution requires it.

Therefore the no-path-leak invariant is:

> The original workspace, transcript, home, and unrelated absolute paths must not occur in `redactedPayloadJson`, `redactionSummary`, error objects, error messages, deduplication keys, fingerprints, or ordinary logs.

The dedicated `canonicalWorkspacePath` property and its dedicated SQLite column are the only permitted absolute-path location in the prepared receipt.

Tests that scan the full prepared receipt must exclude exactly this dedicated property and no other field.

---

## 2. Unknown schema-extension fields versus arbitrary tool data

Unknown Hook-schema extension fields are dropped at policy-controlled object boundaries:

- Hook top level;
- common Hook fields;
- event-specific Hook fields;
- `PostToolBatch` call wrapper fields;
- known structured metadata wrappers.

Arbitrary JSON inside approved data-bearing fields is not dropped merely because its property names are unknown. Examples include:

- `tool_input`;
- `tool_response`;
- `error_details`;
- approved task or cron detail objects when retained by policy.

These arbitrary JSON subtrees are recursively validated, secret-redacted, path-reduced, bounded, and canonicalized.

This distinction is necessary to retain evidence while preventing future Hook schema fields from entering persistence automatically.

---

## 3. Structural arrays are never silently truncated

Arrays whose elements represent source events or structural units must be rejected on limit overflow rather than truncated, including:

- `PostToolBatch.tool_calls`;
- retained background task collections;
- retained session cron collections.

Arbitrary arrays inside tool input/response data may be deterministically truncated only when the truncation marker and summary make the loss explicit.

No truncation may create a payload that appears complete when source structural events were omitted.

---

## 4. Meaning of `outputUtf8Bytes`

`RedactionSummaryV1.outputUtf8Bytes` is the UTF-8 byte size of `redactedPayloadJson` only.

It does not include:

- the prepared-receipt wrapper;
- the summary itself;
- canonical workspace path;
- HMAC fingerprint;
- deduplication key.

The final 256 KiB output limit applies to `redactedPayloadJson`.

Wrapper fields have their own bounded schemas.

---

## 5. Platform-independent path flavor

Path processing must not depend on the operating system running the test.

Determine path flavor explicitly:

- use `path.win32` for Windows drive paths and UNC paths;
- use `path.posix` for POSIX absolute paths;
- reject values that cannot be interpreted consistently for their declared context.

Windows containment comparisons are case-insensitive. POSIX comparisons are case-sensitive.

`canonicalWorkspacePath` preserves the appropriate platform path flavor for later local filesystem use.

Paths placed inside `redactedPayloadJson` use forward slashes and OwnLoop placeholders.

---

## 6. Deduplication ID segment is encoded, not interpolated raw

In the ADR notation:

```text
v1:<hook-name>:id:<source-event-id>
```

`<source-event-id>` means a bounded base64url encoding of the UTF-8 source ID, without padding.

The raw source ID remains available only in the dedicated `sourceEventId` property and persistence column.

This prevents delimiters, control characters, path fragments, or other unexpected source text from entering the deduplication key.

The final deduplication key must satisfy its strict length and character schema.

---

## 7. Fingerprint includes the complete validated source payload

The HMAC fingerprint includes all JSON-compatible fields present in the validated source `payload`, including unknown source fields, before allowlist reduction and redaction.

Consequences:

- object insertion order does not affect the fingerprint;
- `receivedAt` does not affect the fingerprint;
- unknown-field changes do affect the fingerprint;
- two raw payloads that reduce to the same redacted JSON can still have different fingerprints.

If an unknown source value is not JSON-compatible, preparation fails safely rather than omitting it from the fingerprint.

---

## 8. Prepared receipt is the future transport payload

OL-003 will accept and runtime-validate `PreparedIngressReceiptV1`, add receipt identity/status timestamps, and durably insert it.

It will not accept raw `ClaudeAdapterIngress` for ordinary Hook delivery.

The future Hook Adapter will:

1. parse and validate raw Hook JSON;
2. call the shared ingress-security package;
3. send only the prepared receipt over authenticated loopback transport.

The daemon may use the shared package in tests or alternate trusted local entry points, but HTTP transport must not create a second divergent redaction implementation.

---

## 9. Migration version 2 must represent legacy rows honestly

Migration version 2 must not label a pre-version-2 row as having passed redaction policy version 1 if that cannot be proven.

Acceptable designs include:

- nullable preparation metadata for legacy rows plus repository discrimination;
- explicit legacy version/status values outside the v1 prepared-receipt schema;
- transactional table rebuild with a safe legacy representation.

A default that falsely claims canonicalization/redaction version 1 is prohibited.

New inserts after migration version 2 must require complete prepared-receipt metadata.

---

## 10. Redaction errors may name structure, never content

A safe structural path may contain field names such as `password` or array indexes because it identifies policy location, not the rejected value.

Errors must not contain:

- the value at that path;
- neighboring values;
- raw JSON fragments;
- canonical unredacted fragments;
- absolute path values;
- regex match text;
- HMAC key material.

When wrapping an underlying exception, do not retain it as `cause` unless its complete enumerable and message surface is proven content-free.

---

## 11. High-level preparation must be side-effect free

`prepareIngressReceipt` must:

- not mutate the validated input;
- not retain input object references in returned objects;
- not read environment variables;
- not read process-global cwd/home implicitly;
- not access filesystem or network;
- not persist or log;
- not generate receipt IDs or timestamps.

All context and key material are explicit arguments.
