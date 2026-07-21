# ADR-0006: Use an Authenticated Loopback-Only Persist-Before-Acknowledge Ingestion API

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0002-local-first-claude-code-first-mvp.md`
- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`
- GitHub issue #13

---

## Context

OwnLoop now has:

- runtime-validated Claude Code ingress contracts;
- deterministic canonicalization, HMAC fingerprinting, allowlist reduction, secret/path redaction, and strict prepared-receipt contracts;
- a durable SQLite ingress journal that accepts only explicit prepared redacted receipt content.

The next boundary is a local transport that receives Hook deliveries without exposing the daemon to the network or weakening the meaning of `accepted`.

Loopback alone is not authentication. Other processes running as the same local user—or local browser content capable of reaching loopback—may attempt requests. The endpoint therefore needs an installation-scoped bearer secret in addition to a fixed loopback bind.

The endpoint also cannot acknowledge after merely parsing or preparing a request. ADR-0004 defines `accepted` as a durable SQLite commit of a canonical redacted prepared receipt.

Retries require explicit semantics. Source-Hook delivery may repeat. Exact retries must be idempotent and return the original receipt ID. A retry using the same source deduplication identity but different source content is a conflict, not an exact duplicate.

---

## Decision

OwnLoop v0.1 will provide one authenticated loopback endpoint:

```text
POST http://127.0.0.1:<port>/v1/ingress/claude
```

The server will use:

- Fastify `5.10.0`, pinned exactly;
- Node.js `24.18.0`;
- a fixed IPv4 loopback host of `127.0.0.1`;
- an installation-scoped Bearer token supplied by the caller;
- an HMAC `KeyObject` supplied by the caller;
- the existing ingress-security and SQLite persistence boundaries.

The factory must not read environment variables, token files, user configuration, or filesystem state. Installation and secret persistence are deferred to packaging work.

### Critical path

```text
onRequest authentication
→ JSON/content-type/body-limit enforcement
→ ClaudeAdapterIngress runtime validation
→ PreparedIngressReceiptV1 creation
→ transactional insert-or-duplicate resolution
→ durable commit
→ HTTP 202 accepted
```

No lifecycle resolution, event normalization, Git work, or analysis occurs on this path.

### Meaning of HTTP 202

A successful `202` response means only:

> The request authenticated, validated, reduced, redacted, and produced a prepared receipt that is durably represented in the local SQLite journal—either as a new row or an exact previously committed duplicate.

It does not mean:

- a Workspace, Conversation, or Task Run exists;
- a normalized event exists;
- downstream processing succeeded;
- Git reconciliation or analysis completed;
- an Ownership Moment or replay exists.

### Authentication policy

Requests require exactly one header value with this shape:

```text
Authorization: Bearer <installation-token>
```

The installation token:

- is generated from at least 32 random bytes;
- is base64url encoded;
- is injected into the server factory;
- is never persisted or logged by this task;
- is represented inside the server closure only by a SHA-256 digest.

Presented tokens are digested and compared with `timingSafeEqual`.

The endpoint rejects:

- missing Authorization;
- arrays/repeated values;
- comma-joined values;
- non-Bearer schemes;
- empty tokens;
- whitespace-bearing or malformed tokens;
- incorrect tokens.

Authentication runs in `onRequest`, before JSON body parsing.

### Server hardening

The Fastify instance must:

- bind only to `127.0.0.1`;
- expose no arbitrary host configuration;
- accept port `0` for tests;
- disable automatic request logging;
- disable proxy trust;
- enforce a 1 MiB body limit;
- use non-zero connection, request, handler, keep-alive, and shutdown timeouts;
- reject prototype and constructor poisoning;
- return stable structured responses rather than raw Fastify errors.

### Duplicate semantics

The journal's unique identity remains:

```text
(source, source_session_id, deduplication_key)
```

Insertion uses one explicit transaction:

1. attempt an insert without replacement;
2. if inserted, return the new receipt ID and `duplicate: false`;
3. if the unique identity already exists, load the existing receipt;
4. compare the existing and incoming payload fingerprints;
5. if fingerprints match, return the existing receipt ID and `duplicate: true`;
6. if fingerprints differ, throw a typed `deduplication_conflict`.

An existing row is never overwritten or mutated to resolve a duplicate.

### Response policy

OwnLoop-owned response contracts are used for all endpoint outcomes.

Stable mappings:

| HTTP | Code/status | Meaning |
|---:|---|---|
| 202 | accepted | New durable receipt or exact durable duplicate |
| 400 | invalid_payload | Malformed JSON, runtime validation, or ingress-security rejection |
| 400 | unsupported_hook | Unsupported Hook variant |
| 401 | unauthorized | Missing or invalid installation token |
| 409 | deduplication_conflict | Same dedup identity, different payload fingerprint |
| 413 | payload_too_large | Request body exceeds the endpoint limit |
| 415 | unsupported_media_type | Request is not JSON |
| 500 | internal_error | Unexpected safe server failure |
| 503 | persistence_failed | Durable journal operation failed |

Responses never include raw framework, Zod, SQLite, ingress-security, or exception messages.

### Diagnostics policy

The server may emit optional synchronous diagnostic events containing only allowlisted values:

- event name;
- receipt ID after successful persistence;
- supported Hook name after validation;
- duplicate boolean;
- stable error code;
- bound loopback port.

Diagnostics must never include request bodies, authorization data, token digests, HMAC material, fingerprints, session/source IDs, workspace paths, prompts, code, commands, tool data, exception messages, or stacks.

A diagnostics-sink failure is swallowed and cannot change request behavior.

---

## Alternatives considered

## Alternative 1: Rely on loopback without authentication

Rejected because unrelated local processes and browser-to-loopback scenarios remain possible. Loopback limits network exposure but does not establish caller identity.

## Alternative 2: Unix socket or Windows named pipe first

Rejected for the first cross-platform prototype because it adds platform-specific setup and adapter behavior. The transport boundary remains replaceable later.

## Alternative 3: Generate/read token and HMAC secrets inside the server

Rejected because it couples transport to installation, filesystem permissions, secret rotation, and OS storage. The server factory remains deterministic and dependency-injected.

## Alternative 4: Return accepted before SQLite commit

Rejected by ADR-0004 because process failure could lose an acknowledged receipt.

## Alternative 5: Normalize events synchronously before acknowledgment

Rejected because lifecycle and sequencing are downstream concerns and would expand latency and failure modes on the Hook critical path.

## Alternative 6: Treat every unique-key collision as a harmless duplicate

Rejected because source-ID reuse with different content indicates corruption, a source inconsistency, or an attack. Exact fingerprint equality is required.

---

## Consequences

### Positive

- the first real local transport preserves the project's privacy and durability semantics;
- retries are explicitly idempotent;
- conflicting retries are detectable;
- transport remains independently testable through dependency injection;
- later Hook adapters need only a token, endpoint, timeout, and structured response contract;
- no lifecycle or normalization coupling enters the critical path.

### Negative

- the local installation now owns two secrets: bearer token and HMAC key;
- HTTP adds a listening process and request parsing surface;
- Fastify becomes the first external daemon runtime dependency;
- synchronous SQLite writes can briefly block the local daemon event loop;
- secret storage, rotation, and installer integration remain future work.

### Accepted risks

- IPv4 loopback is chosen over dual-stack loopback for deterministic v0.1 behavior;
- bearer authentication is accepted for the single-user local prototype when combined with loopback and high-entropy installation secrets;
- Fastify remains replaceable behind the ingress-server factory.

---

## Implementation constraints

OL-003 must not implement:

- Hook stdin reading or forwarding;
- Claude settings installation;
- token/HMAC-key persistence or rotation;
- receipt processing workers;
- lifecycle aggregates;
- normalized events or sequence allocation;
- Git operations;
- artifact content storage;
- AI or UI behavior;
- cloud services, user authentication, analytics, telemetry, or billing.

---

## Validation

The decision is validated when tests prove:

- the server listens on IPv4 loopback only;
- unauthorized requests are rejected before preparation/persistence;
- valid real-network requests receive 202 only after durable persistence;
- exact retries return the original receipt ID as duplicates;
- fingerprint-conflicting retries return 409;
- malformed/content-type/oversized requests map to safe stable responses;
- diagnostics never expose fixture secrets or identifiers;
- file-backed close/reopen confirms a receipt existed before success was observed;
- standard format, lint, typecheck, tests, and build pass.

---

## Reversibility

The server factory isolates Fastify and the loopback transport. Replacing Fastify, changing the authentication scheme, accepting remote interfaces, returning success before durable commit, or changing duplicate/conflict semantics requires a superseding ADR.

---

## References

- Fastify latest server reference: <https://fastify.dev/docs/latest/Reference/Server/>
- Fastify latest request reference: <https://fastify.dev/docs/latest/Reference/Request/>
- Fastify npm package: <https://www.npmjs.com/package/fastify>
