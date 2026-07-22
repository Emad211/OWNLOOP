# ADR-0014: Build Replay as a Deterministic Read-Only Projection

**Status:** Proposed  
**Date:** 2026-07-22  
**Decision owner:** Project founder  
**Related:** ADR-0003, ADR-0009, ADR-0011, ADR-0012, ADR-0013, Issue #32

## Context

OwnLoop now owns a durable append-only Event history, explicit evidence gaps, privacy-bounded Git reconciliation, verified content-addressed artifacts, and one immutable terminal finalization per completed Run. The next product boundary is the first browser-visible Build Replay.

The replay must be useful without becoming a second source of truth. Persisting a replay cache now would introduce invalidation, migration, and corruption paths before the projection is stable. Likewise, “raw replay” must mean deterministic and non-AI—not unrestricted payload or artifact disclosure.

The browser also needs local authenticated access. Wildcard CORS or embedding the installation token in build output, URLs, localStorage, or logs would weaken the accepted loopback security boundary.

## Decision

OL-012 will build Build Replay on demand from accepted persisted facts.

```text
terminal Run + immutable finalization
+ append-only sequenced Events
+ accepted reconciliation entries
+ evidence gaps
+ Run-linked artifact metadata
→ strict BuildReplayV1 projection
→ authenticated loopback API
→ local React UI
```

No replay table, cache, background projector, AI model, or source-of-truth mutation is introduced.

## Projection authority

The projection reads only:

- terminal Task Run state;
- immutable Run finalization;
- sequenced normalized Events;
- accepted OL-009 reconciliation and ordered entries;
- evidence gaps;
- Run-linked OL-010 artifact metadata.

Any cross-table inconsistency is a persistence failure. The projection never repairs, fills, or guesses missing evidence.

## Replay completeness

Completeness is derived only from persisted terminal status, finalization diagnostic, evidence-gap count, final-diff availability, and actually observed verification Event types.

Controlled states:

- `complete`
- `partial`
- `failed`
- `abandoned`

The UI must explicitly show absent verification as “not observed.” It must not infer success from command names, changed test files, terminal status, or absence of failure.

## Timeline policy

Timeline order is `sequence ASC`. Each item displays storage sequence and timestamps. No causal edge is invented.

Event payload access is rule-based and bounded:

- redacted tool name may be shown;
- bounded redacted Bash-like command may be shown when already present;
- full prompt is shown only once in the Run header;
- source/session/tool identifiers are not exposed;
- unknown Events remain `other`.

## Changed-file policy

Changed files come from the accepted final reconciliation linked by finalization, not by reparsing Git or reading the repository.

Sensitive paths remain null and are rendered as a controlled placeholder. Replay JSON excludes repository roots, commits, working-tree fingerprints, raw Git output, patches, and file content.

## Artifact policy

The replay JSON exposes metadata only. Artifact bytes require a separate authenticated Run-scoped route.

OL-012 initially permits only:

- role `final-diff-manifest-v1`;
- kind `final-diff-manifest-v1`;
- media type `application/vnd.ownloop.final-diff+json`;
- maximum 2 MiB.

The daemon proves the Run reference and metadata before calling the verified OL-010 read API. Arbitrary artifact browsing is prohibited.

## Browser transport

Replay routes reuse the OL-003 installation-token verifier and IPv4-loopback Fastify server.

The Vite development server proxies relative `/api` requests to a validated `127.0.0.1` daemon port. No daemon wildcard CORS is added.

The UI stores the token only in `sessionStorage`; never in localStorage, IndexedDB, URL, rendered output, logs, or compiled assets.

Production static serving and installer orchestration are deferred.

## Consequences

### Positive

- refresh and restart reproduce the same replay;
- no projection invalidation or duplicate source of truth;
- no AI dependency;
- evidence gaps and uncertainty remain visible;
- artifact access stays narrow and auditable;
- the first UI exercises the real local security boundary.

### Negative

- replay requests perform multiple verified reads;
- Vite development requires a configured daemon port;
- no production static-hosting experience yet;
- raw Event payload details are intentionally reduced;
- verification extraction remains sparse until OL-014.

## Validation

The decision is accepted when five controlled terminal Runs replay deterministically, sequence and evidence corruption are rejected, artifact access is allowlisted and Run-scoped, browser token handling is session-only, UI states are accessible, and standard quality gates pass.

## Reversibility

A future persisted replay cache, additional artifact kinds, production static serving, causal graph, AI summary, or external access requires a superseding ADR.