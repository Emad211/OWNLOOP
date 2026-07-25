# Enriched Build Replay

OL-022 composes one terminal Task Run from already verified read models:

- OL-012 Raw Replay facts;
- the exact current-policy OL-020 selected Ownership Moments;
- the exact OL-021 interaction state for that validation.

The module is read-only and deterministic. It creates no table, artifact, cache, event, interaction, background job, provider request, repository read, or generated narrative.

## Verified read order

For an eligible terminal Run, the processor reads the validated Evidence Graph and Raw Replay first, then the current OL-020 Moment projection, and finally OL-021 state for that exact validation ID. Active Runs return before Graph, Moment, or interaction reads. A missing current validation yields an honest partial factual replay and never starts generation or validation.

## Truth surfaces

The output keeps these surfaces separate:

1. persisted Run facts and limitations;
2. provider-proposed Candidate wording that OL-019 selected;
3. deterministic validation support and graph-owned Evidence IDs;
4. recorded OL-021 review activity.

Recorded activity means only that OwnLoop stored a view or explicit response. It is not proof of comprehension, correctness, approval, safety, authorship, or ownership.

## File linkage

A changed file appears in the enriched replay only when its accepted Raw Replay Evidence ID is explicitly referenced by at least one selected Moment. The module does not infer importance from paths, names, extensions, timestamps, confidence, or similarity.

## API

The existing authenticated Replay server exposes:

```text
GET /v1/replay/runs/:runId/build-replay
```

The route is GET-only, no-store, bounded, and side-effect free. Active Runs return a content-free not-available projection. Terminal source disagreement or corruption fails closed.
