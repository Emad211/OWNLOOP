# ADR-0024: Compose a Deterministic Read-Only Enriched Build Replay

**Status:** Proposed
**Date:** 2026-07-25
**Decision owner:** Project founder
**Related documents:**

- `docs/product/PROJECT_SCOPE.md`
- `docs/product/BACKLOG_v0.1.0.md`
- `docs/adr/0014-authenticated-deterministic-raw-replay.md`
- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- `docs/adr/0021-deterministic-candidate-validation-and-selection.md`
- `docs/adr/0022-read-only-finite-ownership-moment-projection.md`
- `docs/adr/0023-append-only-moment-interactions-and-ownership-records.md`
- GitHub Issue #65

---

## Context

OwnLoop now has three accepted read models needed for an end-of-task replay:

1. OL-012 projects persisted Run facts, changed files, verification observations, Evidence gaps, finalization, and Evidence Graph coverage;
2. OL-020 projects only the finite OL-019-selected Candidate Moments and keeps provider proposal wording separate from deterministic support;
3. OL-021 projects append-only recorded interaction activity and deterministic current state for the exact selected Moments.

The product backlog requires a finite Build Replay containing the original goal, completion status, important changed files, decisions, risks, tests, Evidence gaps, and reviewed versus unreviewed Moments.

That requirement must not create a new source of truth. In particular:

- “important file” must not become a hidden classifier;
- “reviewed” must not imply comprehension or approval;
- no narrative model may rewrite facts;
- no replay cache, table, or artifact should duplicate existing validated data.

## Decision

OwnLoop will produce Build Replay v1 as a pure read-only composite projection.

```text
verified terminal OL-012 Raw Replay
+ exact current-policy OL-020 Ownership Moment projection
+ exact OL-021 interaction state
→ deterministic enriched Build Replay
→ authenticated existing Replay server
→ finite local end-of-task UI
```

No migration, Build Replay table, cache, materialized artifact, worker, scheduler, provider/model call, repository/source read, second listener, or new runtime dependency is introduced.

## Source authority

The projector reads only through accepted verified APIs:

- `projectRawRunReplay`;
- `projectRunOwnershipMoments`;
- `readMomentInteractionState` for the exact validation returned by OL-020.

The projector validates agreement among:

- Run, Conversation, and Workspace identities;
- terminal status and finalization identity;
- current validation identity and policy/source versions;
- selected Moment display IDs, ranks, source indexes, source Candidate fingerprints, and types;
- exact interaction-state identities and counts;
- all exposed OL-015 Evidence IDs.

A disagreement is persisted-state corruption and fails closed. The projector does not repair, regenerate, rerank, or replace a source.

## Terminal and availability policy

Build Replay is an end-of-task surface. Active `Capturing` or `Finalizing` Runs are not eligible.

### Ready

The terminal Raw Replay, current selected-Moment projection, and exact interaction state are fully available without controlled source limitations.

### Partial

A safe replay may still render when facts are available but limitations exist, including:

- terminal status is `Partial`, `Failed`, or `Abandoned`;
- Raw Replay completeness is not complete;
- finalization, reconciliation, verification, or Evidence Graph coverage is partial;
- Evidence gaps exist;
- OL-020 reports partial source coverage;
- no current-policy validation exists.

When no current validation exists, the replay may show deterministic Raw Replay facts but must include no Candidate wording, fabricated Moment state, or automatic processing.

### Not available

No enriched factual sections are returned when the Run is unknown or non-terminal, Raw Replay is corrupt, exact source identities disagree, or strict source validation fails.

## Contract and deterministic identity

`EnrichedBuildReplayV1` contains:

- schema and projector versions;
- deterministic projection fingerprint;
- Run, Conversation, Workspace, finalization, validation, and source identities;
- original persisted redacted goal;
- terminal status, completeness, timestamps, and controlled diagnostics;
- outcome and sorted unique limitations;
- finite section counts and truncation metadata;
- moment-linked changed files;
- selected Moments with proposal, support, review activity, and Evidence kept separate;
- controlled verification observations;
- Evidence gaps;
- review aggregates.

The canonical response is bounded to 1 MiB.

Byte-equivalent verified inputs and identical projector versions must produce byte-identical output and the same fingerprint. A newly appended interaction changes the interaction-state input and therefore yields a new deterministic fingerprint without mutating any prior record.

## Original goal and completion

The replay displays only existing controlled Raw Replay fields:

- full persisted ingress-redacted goal;
- terminal status and completeness;
- started and ended timestamps;
- finalization status, diagnostic, and timestamp where present.

No generated narrative summary is added.

## Moment-linked changed files

A changed file is presented as important only when:

- it appears in an accepted Raw Replay reconciliation;
- it has an OL-015 Evidence ID;
- that Evidence ID appears in at least one selected Moment Evidence union.

The projector does not infer importance from path, extension, filename, timestamp, provider confidence, or text similarity.

The section is ordered by the lowest selected Moment rank referencing the file, then reconciliation order, entry index, and stable entry ID. It is bounded to 100 items with exact total and truncation state.

## Selected Moments and truth surfaces

Only OL-020-selected Moments are included, preserving selected rank and the hard maximum of seven.

Each replay Moment keeps four surfaces separate:

1. **Provider proposal** — title, claim, interaction, importance, and confidence signal;
2. **Deterministic support** — controlled facts, scores, Evidence IDs, and source limitations;
3. **Recorded review activity** — OL-021 state and counts;
4. **Local Evidence navigation** — exact Run-scoped OL-015 Evidence IDs.

Rejected, duplicate, and valid-unselected Candidate prose never reaches Build Replay.

## Recorded review activity

Activity is derived only from exact OL-021 state:

- `none` — no recorded interaction;
- `viewed` — at least one Moment view and no stronger activity;
- `evidence_opened` — at least one Evidence view and no qualifying Ownership Record;
- `responded` — at least one qualifying state-changing interaction/Ownership Record.

“Reviewed” means only that recorded review activity exists. It does not mean understood, correct, approved, accepted, owned, safe, or complete.

No ownership score, comprehension percentage, completion percentage, learning score, or quality grade is calculated.

## Verification and Evidence gaps

Verification entries are copied only from controlled OL-012 observations. No pass/fail status is inferred from file changes, command names, missing failures, or provider prose.

Evidence gaps and limitations remain coverage statements. Missing data is never converted into an absence claim.

Verification and gap sections are each bounded to 100 items with exact total counts and truncation flags.

## API

The existing authenticated loopback Replay server adds:

```text
GET /v1/replay/runs/:runId/build-replay
```

The route:

- authenticates before persistence or artifact reads;
- accepts one strict Run ID and no query-controlled expansion;
- is GET-only and returns `Cache-Control: no-store`;
- performs no generation, validation, interaction write, or other processing side effect;
- parses the strict output contract at the server boundary;
- returns stable content-free errors;
- exposes no raw artifact, provider, repository, source, command-output, exception, or stack data.

## UI

The existing local viewer adds a finite Build Replay experience.

The UI displays:

1. original goal and completion state;
2. limitations before success-looking sections;
3. moment-linked changed files;
4. selected changes, decisions, risks, and checks;
5. observed verification;
6. Evidence gaps;
7. recorded review activity.

All Evidence actions remain keyboard accessible and resolve through the existing Run-scoped resolver. The UI uses no browser storage, external assets, remote fonts, dangerous HTML, analytics, telemetry, or interaction writes from the Build Replay surface.

## Privacy boundary

The enriched replay excludes:

- rejected or unselected Candidate prose;
- raw provider request/response, credentials, endpoints, prompts, usage, or pricing;
- semantic-input text beyond the approved persisted redacted goal;
- source content, diff hunks, raw commands, outputs, or output hashes;
- repository roots, commits, Git fingerprints, source-session/tool-use identifiers;
- artifact digest/storage paths or raw bytes;
- installation token/hash;
- free-form user text;
- exceptions and stacks;
- comprehension, correctness, authorship, legal ownership, safety, or formal approval claims.

## Consequences

### Positive

- users receive one finite end-of-task surface without duplicating persisted facts;
- original goal, completion, changes, tests, gaps, Moments, and review activity remain connected;
- file importance and review state have explicit deterministic definitions;
- replay regeneration remains reproducible and restart-safe;
- the existing local security boundary is reused.

### Negative

- no current validation produces a factual but limited replay without Moment wording;
- interaction changes legitimately change the replay fingerprint;
- the daemon performs several verified joins for each replay read;
- no generated narrative summary is available in v1.

## Alternatives rejected

### Persist a Build Replay row or artifact

Rejected because all inputs are already immutable or append-only and the replay can be regenerated deterministically.

### Ask a model to summarize the Run

Rejected because it would blur provider proposal and deterministic fact boundaries.

### Rank files by path or provider confidence

Rejected because those signals do not prove importance.

### Treat a view or response as comprehension

Rejected because OL-021 records activity only.

### Compose sources in the browser

Rejected because exact source-identity and tamper validation belongs in the daemon.

---

## Validation

The decision is accepted when Issue #65 contract, identity, determinism, source-tamper, partiality, file-linkage, review-activity, API, UI, privacy, accessibility, full-regression, and production-build tests pass.

## Reversibility

Generated narratives, persisted replay artifacts, new importance policies, comprehension assessment, ownership scoring, export, cloud synchronization, or team review semantics require later accepted decisions.
