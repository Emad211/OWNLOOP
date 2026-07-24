# ADR-0020: Provider-Backed Candidate Generation Boundary

**Status:** Proposed
**Date:** 2026-07-24
**Decision owner:** Project founder
**Related documents:** ADR-0017 through ADR-0019; GitHub Issue #54

## Context

OL-017 produces one verified, privacy-bounded, Evidence-ID-addressed semantic-analysis artifact. OwnLoop now needs its first explicit model boundary, but provider output must remain untrusted and provider credentials must never enter durable state.

The provider layer may propose Candidate Moments. It may not establish evidence existence, Run ownership, factual support, contradiction, deduplication, ranking, or selection; those responsibilities remain with OL-019.

## Decision

OL-018 introduces a provider-neutral generation core and one concrete `responses_json_v1` HTTPS adapter. A generation call is explicit, synchronous, bounded, and disabled by default.

```text
verified OL-017 artifact
→ deterministic public generation identity
→ bounded Responses-compatible request
→ strict OL-016 Candidate parse
→ canonical sensitive OL-010 Candidate artifact
→ immutable content-free generation provenance
```

## Secret and network boundary

The provider secret is an in-memory call argument. It is used only in the Authorization header and is excluded from request fingerprints, artifacts, SQLite, Events, logs, errors, snapshots, and safe results.

The adapter accepts only a normalized HTTPS endpoint whose fixed route is `/v1/responses`. Redirects, URL credentials, query strings, fragments, literal IP endpoints, loopback/private/reserved DNS results, tools, streaming, remote files, web search, code execution, and provider-side conversation state are rejected or disabled.

DNS results are validated before connection and the selected public address is pinned while TLS continues to verify the configured hostname. IPv4 and IPv6 special-use ranges are evaluated independently, including mapped IPv4, NAT64, 6to4, documentation, benchmarking, link-local, private, multicast, and reserved networks.

Each attempt has one wall-clock deadline covering DNS resolution, connection establishment, request upload, response headers, and response body. Socket activity cannot extend the deadline. Connection pooling is disabled so a later call cannot bypass fresh DNS validation by reusing an earlier socket. Abort and timeout outcomes are settled before destroying the request, preventing a synchronous socket error from replacing the controlled outcome.

## Deterministic request

The public generation identity binds:

- verified semantic-input artifact ID and fingerprint;
- public provider configuration and fingerprint;
- provider family, model, optional revision, timeout, response limit, and retry policy;
- prompt-template version;
- response JSON-schema version and fingerprint;
- target OL-016 Candidate schema version.

The secret is not part of this identity. The same accepted semantic input and public configuration produce byte-identical canonical request bytes and the same generation key.

The provider request uses strict JSON Schema structured output, `store: false`, `background: false`, and `stream: false`. Zero Candidates is valid. The product boundary rejects more than seven generated Candidates even though the reusable OL-016 batch contract has a wider structural maximum.

## Output validation

Provider envelopes and Candidate JSON are never repaired. Markdown fences, trailing prose, coercible values, unknown fields, invalid Evidence IDs, mismatched interactions, unsafe text, or oversized output fail closed. Only an exact JSON media type is accepted; prefix lookalikes such as JSONP are rejected. Raw provider response and error bodies are not persisted.

A valid OL-016 Candidate is still only a proposal. OL-019 must resolve and validate every Evidence ID and factual claim before a Candidate becomes an Ownership Moment.

## Retry boundary

Retries occur only inside the explicit call. The default is two attempts and the hard maximum is three. Only controlled transient HTTP and transport failures retry. Authentication, permanent HTTP failure, refusal, invalid envelope, invalid Candidate JSON, unsafe resolution, or response-size failure do not retry.

Attempt provenance contains only controlled outcome, status, safe request ID, timestamps, and bounded delay. Attempt numbers are contiguous, timestamps describe valid instants in chronological order, retry delays agree with outcomes, and the final provider request ID agrees with the final attempt. There is no background worker, hidden queue, startup retry, or scheduler.

A bounded explicit batch stops after an `aborted` result and does not inspect, contact a provider for, or persist results for later Runs.

## Persistence

Migration v15 adds an immutable `candidate_generations` provenance table and no job, queue, provider-secret, prompt, or raw-response table.

Candidate text exists only in a sensitive OL-010 artifact. SQLite stores controlled provenance and a canonical strict record. A successful generation requires:

- a terminal Run and immutable finalization;
- the exact verified OL-017 semantic-input reference;
- one exact Candidate artifact reference and generation-specific role;
- strict artifact metadata and non-empty bounded bytes;
- a unique successful deterministic generation key.

The indexed provenance columns, status, timestamps, attempt count, semantic-input identity, Candidate identity, and canonical JSON record must agree. Read-back revalidates the OL-010 metadata and bytes rather than trusting SQLite alone.

Failure records contain no Candidate artifact. Candidate artifact materialization may precede the reference transaction, so a failed transaction may leave only an unreferenced GC-eligible object.

## Pricing

Pricing is unavailable unless an explicit immutable source is present. Amounts use integer minor units or fixed-scale strings, never floating-point arithmetic. OL-018 initially records `unavailable`; future configured or provider-reported prices require strict table/version provenance and do not rewrite historical generations.

## Validation boundary

Validation covers pure protocol behavior and the real persistence pipeline:

- strict contracts reject extra fields, inconsistent statuses, invalid attempt chronology, mismatched request IDs, malformed usage/pricing, incorrect Candidate roles, and impossible success/failure shapes;
- deterministic request tests verify prompt, JSON Schema, model/public-config identity, generation key, and absence of the secret;
- endpoint and transport tests verify HTTPS-only policy, public DNS selection, TLS hostname preservation, blocked special-use IP ranges, wall-clock DNS/response deadlines, no socket reuse, redirect rejection, strict media type, abort behavior, and response-size limits;
- adapter tests verify structured-output settings, zero-to-seven Candidate acceptance, refusal and malformed-envelope rejection, bounded retry policy, safe request IDs, token usage, and no raw response persistence;
- migration tests cover immutable history through v15, direct-SQL constraints, exact artifact roles and metadata, terminal Run/finalization ownership, canonical-record agreement, unique successful generation keys, and failure-without-artifact rules;
- processor integration executes the real `finalize → classify → verify → Evidence Graph → semantic input → Candidate generation` chain against SQLite and the local OL-010 store;
- integration verifies concurrent idempotency, one successful generation, secret/Candidate-text absence from SQLite, file-backed restart and read-back, Candidate-byte tamper rejection, exact role lookup beyond 1,000 unrelated references, failed-transaction orphan cleanup, and deterministic bounded-batch order.

All integration provider behavior uses a controlled in-process transport. No live credential, external provider, repository read, raw transcript, background queue, or hidden network call is used by the test suite.

## Explicit non-ownership

OL-018 does not perform Evidence support validation, contradiction detection, unsupported-absence rejection, deduplication, ranking, Ownership Moment persistence, interaction recording, Build Replay composition, provider settings UI, credential storage, model-selection UI, scheduling, fallback routing, cloud sync, analytics, telemetry, billing, or multi-user authentication.
