# ADR-0022: Render Selected Ownership Moments Through a Read-Only Local Projection

**Status:** Proposed  
**Date:** 2026-07-25  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0014-authenticated-deterministic-raw-replay.md`
- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- `docs/adr/0018-strict-evidence-backed-candidate-moment-contracts.md`
- `docs/adr/0020-provider-backed-candidate-generation-boundary.md`
- `docs/adr/0021-deterministic-candidate-validation-and-selection.md`
- GitHub Issue #59

---

## Context

OwnLoop now has:

- an authenticated same-origin Raw Replay viewer;
- stable Run-scoped Evidence IDs and a local Evidence resolver;
- strict provider-proposed Candidate Moment contracts;
- verified Candidate-generation provenance and Candidate artifact read-back;
- deterministic Candidate validation, duplicate grouping, ranking, and selection;
- a maximum of seven `valid_selected` source Candidates per validation.

The browser still cannot render these selected Candidates. The rendering boundary is sensitive because Candidate wording originates from an external provider even after deterministic validation. A selected Candidate is not itself Evidence, proof, user agreement, comprehension, or ownership. Its wording must be displayed separately from the persisted facts that supported validation.

The first rendering stage must also preserve the existing browser-security boundary:

- installation token in page memory only;
- same-origin IPv4 loopback requests only;
- authentication before all persistence/artifact reads;
- no raw Candidate/report artifact download;
- no write endpoint or interaction persistence before OL-021.

---

## Decision

OwnLoop will implement OL-020 as a strict read-only projection that joins one verified current-policy OL-019 validation with its exact verified OL-018 Candidate batch and OL-015 Evidence Graph.

```text
verified OL-018 source Candidates
+ verified OL-019 selected indexes/fingerprints/facts
+ exact OL-015 Evidence Graph
→ strict Ownership Moments projection
→ authenticated existing Replay server
→ accessible finite local UI
```

No new table, migration, artifact, background projector, provider call, or write endpoint is introduced.

## No-side-effect read boundary

A Moment GET may call only verified read APIs. It must not trigger:

- semantic-input preparation;
- Candidate generation;
- Candidate validation;
- Evidence Graph construction;
- verification extraction;
- artifact creation;
- Event emission;
- interaction persistence.

No validation present is a `not_ready` rendering state, not permission to process.

## Current validation selection

The default Run projection chooses one existing validation from the complete current policy-version tuple.

Ordering is deterministic over persisted provenance:

1. Candidate generation completion time descending;
2. generation ID descending;
3. validation creation time descending;
4. validation ID ascending.

An exact optional validation ID may be requested and must be proven to belong to the requested Run.

## Projection integrity

For each selected index the projection verifies:

- the source Candidate exists exactly once;
- its canonical fingerprint matches the validation item;
- the decision is `valid_selected`;
- the selected rank is unique and contiguous;
- the report selected-index order agrees with item ranks;
- every cited, expanded, and fact Evidence ID exists in the exact verified Graph;
- no rejected or valid-unselected Candidate wording is copied.

Projection disagreement is corruption and fails closed.

## Browser contract

The strict projection includes:

- schema version;
- Run/validation/generation identities;
- rendering state and controlled limitations;
- opaque source/report/Graph artifact identities and fingerprints;
- deterministic counts;
- zero to seven ordered Moment items.

Each item includes:

- deterministic opaque Moment ID;
- source index/fingerprint and selected rank;
- exact strict Candidate type, title, claim, importance, confidence basis points, and interaction union;
- cited and expanded graph-owned Evidence IDs;
- controlled OL-019 supporting facts;
- a sorted Evidence-ID navigation union.

It contains no rejected/unselected prose, provider raw response, semantic input, repository/source content, command/output, artifact storage path/digest, exception, stack, or installation token.

## Fact/proposal/signal separation

The UI presents three separate concepts:

1. **AI-proposed, deterministically validated statement** — selected Candidate wording;
2. **Persisted supporting facts** — controlled fact records and Evidence links;
3. **Proposal signals** — provider importance and confidence, explicitly not Evidence or proof.

The UI does not claim correctness, security, completeness, comprehension, agreement, or ownership.

## API

The existing authenticated loopback server adds:

```text
GET /v1/replay/runs/:runId/moments
GET /v1/replay/runs/:runId/moments?validationId=<safe-id>
```

It retains loopback, Bearer authentication, `no-store`, same-origin, content-free errors, no CORS, and no second listener.

Raw Run detail may expose only a privacy-safe Moment summary: state, selected count, limitations, and validation ID. Candidate wording remains exclusive to the detailed Moment endpoint.

## In-memory interaction controls

OL-020 makes interactions usable without persistence:

- strict choice selection for Check, Decision, and Risk interactions;
- acknowledge toggle;
- useful/not-useful feedback.

All state remains in React memory and is cleared on Run switch, disconnect, remount, or refresh. No browser storage or API write is allowed. The UI states that responses are not saved yet.

## Evidence navigation

Every displayed Evidence ID uses the existing authenticated Run-scoped resolver. Resolution focuses an authoritative Replay section when possible or shows a small controlled node/status panel. It does not create semantic explanations or inferred relationships.

## Accessibility and responsive UI

Moment rendering uses semantic card/list structures, keyboard-reachable controls, visible focus, accessible choice groups, live loading/error messages, non-color-only states, mobile-safe layout, and reduced-motion behavior. No external assets, visualization dependency, remote font, or arbitrary HTML is added.

## Consequences

### Positive

- only deterministic OL-019 selections reach the browser;
- provider wording remains visibly distinct from persisted support;
- every displayed Evidence reference resolves locally;
- zero Moment and not-ready states are first-class;
- user controls can be tested before interaction persistence is designed;
- the browser trust boundary remains unchanged.

### Negative

- Moment text is available only after all OL-018/019 read-back checks pass;
- interactions disappear on refresh by design;
- newer verified validations may change the default selected projection;
- OL-020 cannot show rejected Candidate explanations or edit provider wording.

## Alternatives rejected

### Render the raw Candidate artifact

Rejected. It would expose rejected/unselected proposals and bypass OL-019.

### Copy Candidate prose into Raw Replay Run detail or list

Rejected. Run summaries should remain deterministic evidence projections and privacy-bounded.

### Persist feedback immediately

Rejected. Durable interaction semantics and ownership records belong to OL-021.

### Generate/validate on GET

Rejected. Read routes must not mutate or cross provider/processing boundaries.

### Present provider confidence as proof

Rejected. It is only a bounded proposal/ranking signal.

---

## Validation

The decision is accepted when Issue #59 contract, projection, no-side-effect, route, privacy, accessibility, in-memory interaction, evidence-navigation, full regression, and production-build tests pass.

## Reversibility

Durable interactions, ownership records, Moment editing/moderation, provider regeneration, enriched Build Replay, or a changed selection policy require later accepted issues and, where architectural, a superseding ADR.
