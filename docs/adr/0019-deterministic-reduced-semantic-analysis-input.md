# ADR-0019: Deterministic Reduced and Redacted Semantic-Analysis Input

**Status:** Proposed  
**Date:** 2026-07-24  
**Decision owner:** Project founder  
**Related documents:** ADR-0015 through ADR-0018; GitHub Issue #49

## Context

OwnLoop has deterministic change classification, verification evidence, a locally resolvable Evidence Graph, and strict Candidate Moment contracts. A later provider may propose Candidate Moments, but it must never receive the repository, full transcript, raw commands, arbitrary Event payloads, or artifact storage metadata.

The provider-independent input therefore needs its own deterministic boundary before any provider, prompt template, model call, pricing, or generation record exists.

## Decision

OL-017 builds at most one immutable `reduced-semantic-analysis-input-v1` OL-010 artifact for an explicitly enabled, terminal finalized Run.

The authoritative sources are limited to:

- the persisted ingress-redacted Run goal;
- the validated OL-015 Evidence Graph;
- the validated OL-014 verification artifact;
- controlled version constants.

The processor performs a second deterministic redaction pass, converts only graph-backed controlled metadata into evidence-addressed summaries and allowlisted relations, optionally retains bounded redacted verification excerpts, applies a fixed priority budget, and emits canonical UTF-8 JSON.

## Disabled boundary

`enabled: false` returns a controlled `disabled` result before reading persistence, artifacts, the goal, Evidence Graph, verification evidence, or filesystem state. It creates no artifact, reference, Event, queue item, log body, or deferred work.

## Privacy boundary

Model-visible free text is restricted to the goal and recognized verification excerpts. Both are second-pass redacted for credentials, private keys, provider tokens, secret assignments, absolute paths, URLs, email addresses, IP addresses, markup, and controls. Invalid Unicode fails closed; values are never repaired silently.

Every factual summary, relation, goal, and excerpt carries graph-owned OL-015 Evidence IDs. The package contains no relative path, path hash, repository root, commit, raw command, output hash, source session/tool identifier, artifact digest/path, source content, or inferred relationship.

## Deterministic package

The v1 package records schema, builder, reduction, redaction, token-estimator, and target Candidate schema versions; exact OL-013 classification, OL-014 verification, and OL-015 Evidence Graph version tuples; classification, verification, and graph artifact IDs and fingerprints; graph outcome and limitations; deterministic input fingerprint; bounded evidence summaries, relations, and excerpts; aggregate redaction/drop counts; exact byte count; visible-text code-point count; a conservative byte-based token upper bound equal to the canonical byte count for estimator v1; and monetary status `provider_not_selected`.

Strict read-back validation rejects non-canonical or tampered text, source versions, source identities, redaction aggregates, estimates, Run/finalization status summaries, and verification excerpts that no longer match a graph-backed verification summary. Controlled placeholders may expand beyond the original sensitive substring; retained counts describe the redacted output rather than pretending to be bounded by source length.

Canonical size is limited to 512 KiB. The fixed reduction order removes lower-priority relations, optional excerpts, then lower-priority summaries while retaining graph outcome, limitations, gaps, and finalization whenever a valid package remains. Truncation yields `partial` with `budget_truncated`; an evidence-free package is `unavailable` and is not referenced.

## Persistence

Migration v14 preserves migrations 1–13 and adds only artifact-reference invariants:

- at most one v1 semantic-input role per Run;
- exact storage version, kind, media type, sensitivity, and a non-empty 512 KiB size limit;
- terminal Run with immutable finalization;
- pre-existing-role validation and sensitivity preservation.

No semantic-input table, provider table, job, queue, or mutable cache is added. Artifact materialization may precede the SQLite reference transaction; failed references may leave only an unreferenced GC-eligible object.

## Explicit non-ownership

OL-017 does not add a provider abstraction, credential handling, prompt template, model call, retry, pricing, Candidate generation/persistence, support validation, contradiction detection, ranking, UI, scheduler, repository/source read, cloud, analytics, telemetry, billing, or multi-user authentication.

## Consequences

The next provider layer receives a small, reproducible, evidence-addressed package rather than raw development context. The tradeoff is deliberate information loss: unsupported prose and lower-priority evidence are omitted rather than guessed or silently widened.
