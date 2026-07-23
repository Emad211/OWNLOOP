# ADR-0017: Build a Deterministic Locally Resolvable Evidence Graph

**Status:** Proposed  
**Date:** 2026-07-23  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/adr/0011-evidence-bounded-git-reconciliation.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- `docs/adr/0014-deterministic-raw-replay-projection-and-local-viewer.md`
- `docs/adr/0015-deterministic-evidence-backed-change-classification.md`
- `docs/adr/0016-deterministic-verification-evidence-extraction.md`
- GitHub Issue #44

---

## Context

OwnLoop now has accepted Run lifecycle facts, sequenced Events, Git baseline and reconciliation evidence, immutable finalization, evidence gaps, deterministic change classification, and deterministic verification extraction. Later candidate generation and validation require stable evidence references that can be resolved locally without sending the repository, transcript, or opaque storage data to a model or browser.

The current persisted model contains relationships, but they are distributed across SQLite repositories and three immutable artifacts. Raw Replay projects some causal relationships, but it is a view rather than a versioned evidence substrate.

Several boundaries are mandatory:

- graph relationships must be backed by persisted links or validated artifact contents;
- evidence identifiers must be stable and opaque;
- the graph must not infer causality from timestamps, matching text, filenames, tool names, or semantic similarity;
- graph construction must not mutate source evidence;
- public resolution must remain Run-scoped and authenticated;
- graph bytes must be reproducible across restart;
- missing evidence and limitations must remain explicit.

The final-diff manifest intentionally excludes patch and diff bytes. It stores reconciliation summaries and changed-file entries only. Consequently no persisted diff hunk exists today.

---

## Decision

OwnLoop will build Evidence Graph v1 as one canonical, immutable, content-addressed artifact per eligible finalized Run.

```text
accepted persisted Run facts
+ validated classification artifact
+ validated verification artifact
→ pure versioned graph builder
→ canonical OL-010 evidence-graph artifact
→ authenticated Run-scoped evidence resolver
→ factual Raw Replay evidence navigation
```

No graph/node/edge database table, mutable graph cache, background projector, scheduler, AI call, repository read, or source parser is introduced.

## Authoritative inputs

The builder may consume only validated bounded facts:

- Run, Conversation, and Workspace ownership;
- positive contiguous Run Event sequence;
- persisted normalization sibling groups;
- Git baseline and baseline Event;
- reconciliations, triggers, summaries, changed-file entries, and file Events;
- evidence gaps;
- finalization and terminal/snapshot relationships;
- final-manifest artifact reference and metadata;
- OL-013 classification artifact;
- OL-014 verification artifact and derived Events.

Artifact inputs must be loaded through their existing verified read APIs. Missing retainable evidence produces controlled graph limitations. Broken aggregate, Event, artifact, or source linkage is corruption.

## No invented hunk evidence

Evidence Graph v1 has no `diff_hunk` node kind because OwnLoop has retained no hunk source.

When a Run has changed-file evidence, the graph records the limitation `diff_hunks_not_retained`. This limitation describes coverage only. It is not evidence that a hunk did or did not contain any semantic change.

A future hunk model requires a separate observation, privacy, storage, and version decision.

## Canonical graph artifact

The graph artifact contains:

- graph schema version;
- builder version;
- node/edge taxonomy version;
- Run and source-artifact identifiers;
- deterministic outcome, diagnostics, and limitations;
- SHA-256 accepted-input fingerprint;
- canonically ordered nodes;
- canonically ordered directed edges;
- deterministic aggregate counts.

Fixed metadata:

- role and kind: `deterministic-evidence-graph-v1`;
- media type: `application/vnd.ownloop.evidence-graph+json`;
- storage version: `1`;
- sensitivity: `sensitive`;
- maximum nodes: `25000`;
- maximum edges: `50000`;
- maximum canonical bytes: `8 MiB`.

The same accepted inputs and versions produce byte-identical bytes.

## Stable evidence IDs

Every node and edge ID is a domain-separated SHA-256 digest over a canonical tuple containing only controlled kind and accepted internal identifiers.

IDs:

- are deterministic across restart;
- contain no random UUID or wall-clock generation time;
- reveal no path, root, commit, fingerprint, command, output, prompt, session, digest, or storage path;
- use a strict URL-safe opaque format;
- are unique within one graph.

A collision or duplicate semantic identity is corruption.

## Node model

Version 1 node kinds are:

- `run`;
- `event`;
- `baseline`;
- `reconciliation`;
- `changed_file`;
- `evidence_gap`;
- `finalization`;
- `artifact`;
- `classification_entry`;
- `classification_label`;
- `command_observation`;
- `verification_observation`;
- `test_file_change`.

Nodes contain only controlled source locators, type/status metadata, and source schema/analyzer versions. The graph contains no relative path or reduced output excerpt. Those remain in authoritative Replay or artifact surfaces.

## Edge model

Edges are emitted only from explicit persisted or artifact-backed relationships. Version 1 types include:

- Run containment;
- Event normalization sibling linkage;
- baseline Event linkage;
- reconciliation trigger, summary, and changed-file linkage;
- finalization trigger, reconciliation, Event, and artifact linkage;
- evidence-gap ownership;
- changed-file classification entry and label linkage;
- classification rule-evidence linkage;
- command source and derived Event linkage;
- command-to-verification linkage;
- verification derived Event linkage;
- test-file-change classification linkage;
- Run artifact linkage.

Every endpoint must exist. Self-edges and duplicate semantic edges are invalid. Node and edge ordering is canonical.

## Outcome and limitations

Controlled graph outcomes:

- `complete`: all required source artifacts are valid and no partial/gap limitation exists;
- `partial`: a valid graph is retained with evidence gaps or partial/unavailable source coverage;
- `unavailable`: no valid graph can be retained without inventing evidence.

Controlled limitations include:

- `diff_hunks_not_retained`;
- `final_manifest_unavailable`;
- `classification_partial`;
- `classification_unavailable`;
- `verification_partial`;
- `verification_unavailable`;
- `evidence_gaps_present`.

Limitations cannot support absence claims.

## Persistence

Migration v13 preserves migrations 1 through 12 and adds only graph-role invariants:

- at most one v1 graph reference per Run;
- exact kind, media type, storage version, sensitivity, and size;
- terminal Run with immutable finalization;
- validation of any pre-existing v1 rows before installing the unique index and triggers.

No graph table or mutable analysis state is introduced.

Graph bytes may be materialized before the SQLite transaction. A failed reference transaction may leave only an unreferenced GC-eligible object.

## Explicit processing and read-back

The module exposes explicit single-Run, bounded-batch, verified read, and resolution APIs. Batch size is at most 25 and processing is sequential in deterministic order.

The processor may explicitly call accepted OL-013 and OL-014 processors when required artifacts are absent. There is no timer, startup worker, or background scheduler.

Repeated and concurrent calls must not duplicate references or create conflicting graph bytes. Read-back verifies:

- artifact integrity and metadata;
- strict contract and versions;
- Run/finalization/source-artifact identifiers;
- regenerated input fingerprint;
- canonical nodes/edges and aggregate counts;
- endpoint existence and source relationships.

## Local evidence resolution

The existing authenticated loopback Replay server will expose one Run-scoped evidence resolution route.

Resolution proves that an evidence ID belongs to the requested Run's validated graph and returns a strict safe contract containing controlled node facts and local Replay anchors only.

The resolver never returns graph bytes, artifact digest/storage path, path identity hash, command, output excerpt, source-session/tool-use identifier, or secret path. Authentication occurs before persistence or filesystem reads.

## Raw Replay and UI integration

Raw Replay may expose graph status/limitations and evidence IDs on factual sections. The UI offers keyboard-accessible Evidence actions that resolve and focus existing authoritative sections.

OL-015 adds no graph visualization library, canvas, external asset, semantic explanation, or graph editor.

## Privacy boundary

Graph artifacts and safe results exclude:

- roots and relative paths;
- commits, Git hashes/fingerprints, and path identity hashes;
- raw Git status/diff/patch/hunks;
- prompts, commands, outputs, source sessions/tool uses;
- source/file content;
- artifact digest/storage path;
- exceptions/stacks;
- unsupported absence claims.

## Alternatives rejected

### Mutable graph tables

Rejected because they introduce a second source of truth and invalidation path before graph semantics stabilize.

### Reuse Raw Replay causal links as the complete graph

Rejected because Replay causal links omit classification, verification, gaps, source versions, and durable evidence identifiers.

### Reconstruct diff hunks from the repository

Rejected because graph construction must not create new observation or read mutable repository state.

### Infer relationships from timestamps or text

Rejected because similarity is not evidence.

### Return the full graph artifact to the browser

Rejected because the browser needs safe resolution and navigation, not unrestricted sensitive graph data.

---

## Consequences

### Positive

- later claims can require locally resolvable stable evidence IDs;
- deterministic source relationships are consolidated without duplicating source truth;
- uncertainty and unretained evidence remain visible;
- restart and reprocessing can detect source/graph drift;
- Raw Replay can navigate facts without exposing persistence-only data.

### Negative

- graph construction performs several verified bounded reads;
- v1 cannot provide hunk-level evidence;
- evidence navigation is factual and not a visual graph experience;
- graph artifacts may be several MiB for large bounded Runs.

## Validation

The decision is accepted when the contracts, builder, migration, persistence, resolver, Replay/UI integration, restart/corruption, privacy, capacity, fixture, and full quality-gate tests defined in Issue #44 pass.

## Reversibility

Persisted graph tables, hunk evidence, broader traversal, visual graph layouts, source-content analysis, or semantic claim generation requires a superseding ADR or later milestone decision.
