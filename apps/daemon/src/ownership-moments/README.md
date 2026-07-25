# Read-only Ownership Moment projection

OL-020 joins one existing current-policy OL-019 validation with its exact verified OL-018 Candidate batch and OL-015 Evidence Graph. It is a presentation projection, not a processing stage.

## Data flow

```text
immutable current-policy validation
+ verified source Candidate generation
+ exact Run-owned Evidence Graph
→ strict selected-only projection
→ authenticated existing Replay route
→ page-memory-only React interactions
```

## Invariants

- Only `valid_selected` source indexes cross the presentation boundary.
- Candidate fingerprints, selected ranks, report order, Run/finalization ownership, artifact identities, graph fingerprint, and every exposed Evidence ID are revalidated.
- Rejected, duplicate, and ranked-below-limit Candidate wording is never copied.
- Provider title/claim/importance/confidence remain proposal content and are visually separated from deterministic facts and Evidence.
- Provider confidence is not proof.
- Zero selected Moments and no current validation are valid non-error outcomes.
- The route calls verified read APIs only and never generates, validates, ranks, persists, or emits anything.
- Evidence navigation reuses the existing authenticated Run-scoped resolver.
- Browser responses, acknowledgement, answers, and usefulness feedback remain unsaved React state and reset on Run/validation change, disconnect, unauthorized response, remount, or refresh.

## Public API

```text
GET /v1/replay/runs/:runId/moments
```

The response is `no-store`, strict, same-origin, authenticated, and contains at most seven selected Moments. Raw Candidate/report artifacts are not downloadable through this route.

## Non-ownership

This module does not persist interaction history, create ownership/comprehension records, call a provider, process a missing validation, edit Candidate text, rerank selections, read the repository, add a migration, or widen the loopback/browser trust boundary.
