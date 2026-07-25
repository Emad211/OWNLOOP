# ADR-0022: Render a Read-Only Finite Ownership Moment Projection

**Status:** Proposed  
**Date:** 2026-07-25  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0014-authenticated-deterministic-raw-replay.md`
- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- `docs/adr/0018-strict-evidence-backed-candidate-moment-contracts.md`
- `docs/adr/0020-provider-backed-candidate-generation-boundary.md`
- `docs/adr/0021-deterministic-candidate-validation-and-selection.md`
- GitHub Issue #58

---

## Context

OwnLoop now has three separate authoritative layers for Moment presentation:

1. OL-018 stores a verified provider-generated Candidate batch;
2. OL-019 stores a deterministic validation report that rejects unsupported proposals and selects at most seven source Candidate indexes;
3. OL-015 resolves graph-owned Evidence IDs to authoritative local Replay locations.

The browser must not independently join or trust these sources. Provider Candidate text is untrusted proposal content even after it passes the strict OL-016 shape. The validation report deliberately contains no Candidate prose. A safe presentation therefore requires a daemon-side projection that revalidates all source identities before returning selected Moment text.

OL-020 must also support the first interactive Moment experience without preempting OL-021. A user may make temporary selections in the page, but those selections must not be persisted, interpreted as comprehension, or represented as ownership records.

---

## Decision

OwnLoop will expose one read-only finite Ownership Moment projection through the existing authenticated Replay server.

```text
verified Candidate artifact
+ exact current-policy validation report
+ exact Run-owned Evidence Graph
→ strict daemon-side Moment projection
→ authenticated same-origin API
→ accessible page-memory-only UI
```

No Moment, interaction, feedback, acknowledgement, answer, or ownership table is introduced in OL-020.

## Source authority

The projection uses only existing verified read APIs. It requires agreement among:

- requested Run ID;
- immutable finalization ID;
- OL-018 generation ID and successful generation provenance;
- Candidate artifact ID and fingerprint;
- OL-019 validation ID, report artifact, policy tuple, selected count, selected source indexes, source Candidate fingerprints, decisions, and selected ranks;
- OL-015 Evidence Graph artifact ID, input fingerprint, version tuple, and Run/finalization ownership.

Any disagreement is persisted-state corruption. The projection does not repair, regenerate, rerank, or replace sources.

## Current validation selection

For a Run, the default projection chooses the most recent immutable validation using only records matching the current OL-019 policy tuple:

```text
created_at DESC,
validation_id DESC
```

This is a deterministic presentation choice over persisted immutable records. The projection returns the selected validation ID and full controlled source-version tuple. No provider, Candidate-generation, or validation processor is invoked from the HTTP read path.

A Run without a current-policy validation returns a controlled `not_available` projection.

## Projection contract

The strict v1 contract contains:

- schema and projection versions;
- Run, finalization, generation, and validation IDs;
- Candidate artifact ID/fingerprint;
- Evidence Graph artifact ID/input fingerprint;
- validation outcome and limitations;
- projection outcome and diagnostic;
- selected count;
- ordered selected Moments.

Each Moment contains:

- deterministic display ID derived from validation ID, source index, and source Candidate fingerprint;
- selected rank;
- source Candidate index/fingerprint;
- type, title, claim, importance, provider confidence basis points, and interaction from the verified OL-016 Candidate;
- provider-cited Evidence IDs;
- OL-019 expanded Evidence IDs, recognized controlled facts, score components, and total.

Rejected, duplicate, and valid-unselected Candidate prose is never projected.

## Proposal and support distinction

The UI presents two visibly distinct surfaces:

- **Provider proposal:** title, claim, importance, confidence signal, and suggested interaction;
- **Deterministic support:** selected rank, controlled facts, Evidence IDs, score components, outcome, and limitations.

Provider confidence is labeled as a proposal signal. It is not factual confidence, proof, or ownership evidence.

Partial source limitations remain visible and never receive success styling.

## API

The existing authenticated loopback server adds:

```text
GET /v1/replay/runs/:runId/moments
```

The route authenticates before any persistence or artifact read, validates the Run ID, performs no write or generation work, parses the strict output contract, and returns `Cache-Control: no-store`.

Errors are stable and content-free. They do not contain Candidate text, provider response, artifact storage information, paths, commands, source content, exceptions, or stacks.

## Evidence navigation

Every displayed Evidence ID must exist in the exact validated Run-owned OL-015 graph. Evidence actions reuse:

```text
GET /v1/replay/runs/:runId/evidence/:evidenceId
```

The browser navigates only to the resolver-provided Replay section/anchor. It does not infer destinations from Candidate type, wording, filenames, or similarity.

## Ephemeral interaction state

The page may retain, in React memory only:

- Change acknowledgement;
- Decision response: `confirm | revise | uncertain`;
- Risk response: `acknowledge | mitigate | dismiss`;
- one Check choice;
- usefulness: `useful | not_useful | unset`.

State is keyed by validation ID and Moment display ID and clears on disconnect, unauthorized response, Run change, validation change, or refresh.

OL-020 sends no interaction write request and uses no localStorage, sessionStorage, IndexedDB, cookie, URL state, analytics, or telemetry.

An ephemeral selection is only a page choice. It is not durable acknowledgement, comprehension, agreement, or ownership.

## Accessibility and finite experience

The UI preserves OL-019 selected rank, displays no more than seven Moment cards, and accepts zero Moments as a valid outcome.

Cards use semantic ordered lists, headings, fieldsets/radio controls, labels, keyboard-accessible Evidence actions, focus indicators, `aria-live` feedback, responsive layout, and reduced-motion behavior.

No graph library, external asset, remote font, `dangerouslySetInnerHTML`, or new runtime dependency is added.

## Privacy boundary

The projection excludes:

- rejected or unselected Candidate text;
- provider raw response, prompt, request, credentials, errors, usage, or pricing internals;
- repository paths, commits, Git hashes/fingerprints, source content, transcripts, commands, outputs, source-session/tool-use identifiers;
- artifact digests, storage paths, or raw artifact bytes;
- exceptions and stacks;
- persisted or implied user ownership/comprehension claims.

---

## Consequences

### Positive

- the browser receives only deterministically selected, source-verified Moments;
- provider proposal content remains visibly separate from deterministic support;
- every factual support reference navigates to local authoritative Evidence;
- the first interactive experience is available without prematurely defining persistence semantics;
- OL-021 can later persist interactions against stable validation and Moment IDs.

### Negative

- no current validation means no Moment projection;
- page choices disappear on refresh by design;
- the UI must perform additional authenticated reads for Evidence navigation;
- the daemon performs a verified multi-artifact join on projection reads.

## Alternatives rejected

### Join Candidate and validation artifacts in the browser

Rejected. It would move source-identity and tamper validation into a less trusted surface.

### Persist interactions in OL-020

Rejected. Durable interaction and ownership semantics belong to OL-021.

### Render all provider Candidates with rejected badges

Rejected. Rejected and unselected prose must not cross the accepted presentation boundary.

### Automatically run generation or validation from the read route

Rejected. Read routes remain side-effect free and do not contact providers.

### Use provider confidence as evidence confidence

Rejected. Provider confidence is a bounded proposal/ranking signal, never proof.

---

## Validation

The decision is accepted when strict-contract, source-join, latest-current-validation, empty/partial/corruption, authentication, evidence-navigation, ephemeral-interaction, accessibility, privacy, no-write, full-regression, and production-build tests from Issue #58 pass.

## Reversibility

Durable interactions, ownership records, enriched Replay composition, additional Moment versions, server-side preferences, or changed current-validation selection require a later accepted decision.
