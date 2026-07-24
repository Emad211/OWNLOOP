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

DNS results are validated before connection and the selected public address is pinned while TLS continues to verify the configured hostname.

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

Provider envelopes and Candidate JSON are never repaired. Markdown fences, trailing prose, coercible values, unknown fields, invalid Evidence IDs, mismatched interactions, unsafe text, or oversized output fail closed. Raw provider response and error bodies are not persisted.

A valid OL-016 Candidate is still only a proposal. OL-019 must resolve and validate every Evidence ID and factual claim before a Candidate becomes an Ownership Moment.

## Retry boundary

Retries occur only inside the explicit call. The default is two attempts and the hard maximum is three. Only controlled transient HTTP and transport failures retry. Authentication, permanent HTTP failure, refusal, invalid envelope, invalid Candidate JSON, unsafe resolution, or response-size failure do not retry.

Attempt provenance contains only controlled outcome, status, safe request ID, timestamps, and bounded delay. There is no background worker, hidden queue, startup retry, or scheduler.

## Persistence

Migration v15 adds an immutable `candidate_generations` provenance table and no job, queue, provider-secret, prompt, or raw-response table.

Candidate text exists only in a sensitive OL-010 artifact. SQLite stores controlled provenance and a canonical strict record. A successful generation requires:

- a terminal Run and immutable finalization;
- the exact verified OL-017 semantic-input reference;
- one exact Candidate artifact reference;
- strict artifact metadata and non-empty bounded bytes;
- a unique successful deterministic generation key.

Failure records contain no Candidate artifact. Candidate artifact materialization may precede the reference transaction, so a failed transaction may leave only an unreferenced GC-eligible object.

## Pricing

Pricing is unavailable unless an explicit immutable source is present. Amounts use integer minor units or fixed-scale strings, never floating-point arithmetic. OL-018 initially records `unavailable`; future configured or provider-reported prices require strict table/version provenance and do not rewrite historical generations.

## Explicit non-ownership

OL-018 does not perform Evidence support validation, contradiction detection, unsupported-absence rejection, deduplication, ranking, Ownership Moment persistence, interaction recording, Build Replay composition, provider settings UI, credential storage, model-selection UI, scheduling, fallback routing, cloud sync, analytics, telemetry, billing, or multi-user authentication.
