# OwnLoop loopback ingestion

This directory owns the local HTTP transport boundary for Claude Code Hook ingress.

## Endpoint

```text
POST http://127.0.0.1:<port>/v1/ingress/claude
Authorization: Bearer <installation-token>
Content-Type: application/json
```

The server factory does not accept an arbitrary host. It always binds to IPv4 loopback and may use port `0` for tests.

## Meaning of `202 Accepted`

A successful response means that the request:

1. authenticated with the installation token;
2. passed the runtime Claude ingress contract;
3. produced a canonical, redacted `PreparedIngressReceiptV1`;
4. was durably represented in the caller-owned SQLite ingress journal, either as a new receipt or as an exact retry of an existing receipt.

It does not mean that lifecycle resolution, normalized-event creation, sequencing, Git reconciliation, analysis, replay, or Ownership Moment generation has completed.

## Authentication

- Installation tokens are base64url values generated from at least 32 random bytes.
- The server retains only a SHA-256 digest inside the token verifier.
- Presented tokens are digested and compared with `timingSafeEqual`.
- Authentication runs in Fastify's route-level `onRequest` hook before JSON body parsing.
- Missing, repeated, comma-joined, malformed, non-Bearer, and incorrect values return the same structured `401` response.

Token persistence, rotation, installer integration, and operating-system secret storage are outside OL-003.

## Durability and retry semantics

The unique ingress identity is:

```text
(source, source_session_id, deduplication_key)
```

Insertion is transactional:

- a new delivery inserts and returns `duplicate: false`;
- an exact retry returns the original receipt ID and `duplicate: true`;
- the same deduplication identity with a different payload fingerprint returns a structured `409 deduplication_conflict`;
- existing receipts are never replaced or mutated during duplicate resolution.

## Request hardening

- JSON only;
- 1 MiB request-body limit;
- bounded connection, request, handler, keep-alive, and shutdown timeouts;
- prototype and constructor poisoning rejected by the Fastify JSON parser;
- proxy trust and automatic request logging disabled;
- framework, Zod, SQLite, and ingress-security exception messages are not returned to callers.

## Diagnostics

An optional synchronous diagnostics sink receives only allowlisted structured events. It never receives request bodies, authorization values, token digests, HMAC material, payload fingerprints, source/session identifiers, workspace paths, prompts, code, commands, tool data, exception messages, or stacks.

A diagnostics-sink failure is ignored and cannot change request behavior.

## Ownership boundary

The server owns transport and prepared-receipt insertion orchestration only. It does not own:

- Hook stdin forwarding or Claude settings;
- installation-token or HMAC-key storage;
- pending-receipt processing;
- Workspace, Conversation, or Task Run lifecycle;
- normalized events or sequence allocation;
- Git analysis;
- artifact storage;
- AI or UI behavior;
- cloud services, analytics, telemetry, billing, or user authentication.
