# ADR-0021: Deterministic Candidate Validation and Selection

**Status:** Proposed
**Date:** 2026-07-24
**Decision owner:** Project founder
**Related documents:** ADR-0017 through ADR-0020; GitHub Issue #56

## Context

OL-018 can persist a structurally valid provider-proposed Candidate batch, but provider prose, confidence, importance, and Evidence IDs remain untrusted. OwnLoop must not render a proposal merely because it passed JSON validation.

A deterministic boundary is required to prove that every selected Candidate belongs to the exact Run Evidence Graph, uses an authorized evidence kind, states only controlled facts represented in graph metadata, does not contradict those facts, and does not infer absence from missing evidence.

## Decision

OL-019 validates one successful OL-018 generation against the exact OL-015 Evidence Graph and persists one immutable validation report.

```text
verified Candidate generation
+ exact Evidence Graph
→ Evidence-ID resolution and bounded graph closure
→ type-specific support
→ controlled fact grammar
→ contradiction and absence rejection
→ deterministic duplicate grouping
→ integer ranking and finite selection
→ canonical OL-010 validation report
```

The report references source Candidate indexes and fingerprints. It does not copy Candidate title, claim, choices, provider output, source content, paths, commands, prompt text, or artifact storage metadata. OL-020 may join selected indexes with the separately verified Candidate artifact.

## Conservative semantic boundary

V1 does not attempt general natural-language entailment. It recognizes only a finite English fact grammar derived from controlled graph metadata:

- terminal status;
- change kind and attribution;
- classification label;
- recognized verification kind/status;
- evidence-gap code;
- explicit plan/summary decision observation;
- source graph partiality.

Every recognized assertion must match cited or allowlisted-expanded graph evidence. Unknown meaningful vocabulary, unsupported behavior/security/performance/causal claims, or text without an appropriate recognized fact rejects the Candidate.

This policy intentionally accepts false negatives. It does not accept unsupported factual prose as evidence-backed.

## Type-specific support

- **Change** requires changed-file or connected deterministic classification evidence.
- **Decision** requires an explicit graph event for `agent.plan_observed` or `agent.summary_observed`.
- **Risk** requires an evidence gap, failed/unknown verification, or non-completed terminal evidence.
- **Check** requires supported Change, Decision, or Risk context.

A classification label alone does not prove a Risk. A changed file or provider explanation alone does not prove a Decision.

## Absence and contradiction

V1 rejects absence, universal, completeness, and certainty claims. Missing nodes never prove that no test, risk, change, dependency, API effect, or other fact exists.

Controlled contradictions reject, including verification-status, change-kind, terminal-status, classification-label, source-partiality, and type/evidence mismatches. Contradiction is derived only from controlled metadata, never from a second model.

## Evidence closure

Provider-cited Evidence IDs must exist in the exact graph and form one graph-connected support context. A bounded supporting closure may be expanded only through an explicit edge allowlist. Expanded Evidence IDs remain graph-owned and are recorded separately from provider-cited IDs.

No timestamp, path, filename, prose similarity, embedding, or model judgment creates an edge.

## Deduplication and ranking

Valid Candidates of the same type with the same support/fact signature are deterministic duplicates. Representative selection uses evidence strength, lower attention cost, bounded provider importance/confidence tie-breaks, and source index. Provider prose is never merged or rewritten.

Ranking is integer-only and records every component. Evidence strength and explicit gap/failure urgency dominate provider signals. Attention cost is a deterministic penalty. Selection is stable, allows zero, and never exceeds seven.

## Persistence

Migration v16 adds immutable Candidate-validation provenance. It preserves migrations 1–15 and adds no job, queue, scheduler, model, embedding, or text cache.

A completed validation requires the exact successful generation, source Candidate artifact, same Run/finalization, exact Evidence Graph artifact, one strict report artifact, and canonical-record/index agreement. Report materialization may precede the SQLite reference transaction; failed transactions may leave only an unreferenced GC-eligible object.

## Read-back

Read-back revalidates source OL-018 and OL-015 artifacts, reconstructs the deterministic validation input, regenerates report bytes, and compares identities, policy versions, facts, decisions, reasons, duplicate groups, score components, selected ranks, counts, artifact metadata, and fingerprint.

Any disagreement fails closed.

## Explicit non-ownership

OL-019 does not call a provider/model, use embeddings, interpret arbitrary semantics, rewrite Candidate prose, read repository/source/transcript/commands, render Ownership Moments, persist user interactions, compose Build Replay, configure credentials, schedule work, or add cloud, analytics, telemetry, billing, or multi-user behavior.
