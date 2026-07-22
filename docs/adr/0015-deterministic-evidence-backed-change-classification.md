# ADR-0015: Classify Accepted File Changes with Deterministic Evidence-Backed Rules

**Status:** Proposed
**Date:** 2026-07-22
**Decision owner:** Project founder
**Related documents:**

- `docs/product/PROJECT_SCOPE.md`
- `docs/product/BACKLOG_v0.1.0.md`
- `docs/adr/0011-evidence-bounded-git-reconciliation.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- `docs/adr/0014-deterministic-raw-replay-projection-and-local-viewer.md`
- GitHub issue #40

---

## Context

Milestone A established trustworthy capture, finalization, artifact integrity, and a deterministic Raw Replay. Milestone B begins by adding deterministic evidence that later verification extraction, evidence graphs, and candidate-moment generation can consume.

The first required evidence is a bounded multi-label classification of accepted changed-file observations. The classifier must not become an alternate repository scanner or a semantic model. It must operate only on the controlled facts already retained by OL-009 and linked by the immutable OL-011 finalization.

Several risks require explicit control:

- reading repository bytes would create a second observation path and widen the privacy boundary;
- free-form heuristics would be difficult to audit and reproduce;
- probabilistic confidence would falsely imply calibrated likelihood;
- putting mutable classifier output in a generic job row would weaken artifact identity and restart validation;
- copying paths, Git hashes, or source details into the output would make downstream evidence unnecessarily sensitive;
- silently classifying hidden or unmatched files would turn missing evidence into invented semantics.

The existing `analysis_jobs` table is only a generic reserved queue shape. It does not define analyzer versions, immutable output identity, accepted scheduling, or input fingerprints, so OL-013 does not use it.

---

## Decision

OwnLoop will implement one deterministic classifier version over the finalization-linked OL-009 reconciliation.

```text
immutable finalization
+ accepted ordered reconciliation entries
→ versioned path grammar
→ stable rule evidence and fixed confidence
→ canonical classification artifact
→ OL-010 verified immutable storage
```

The classifier is explicit and on demand. No timer, startup scheduler, background worker, AI model, network request, repository read, Git command, or source-file parse is introduced.

### Eligibility and authority

A persisted classification may be generated only for a terminal Run that has one valid immutable finalization.

- If the finalization references a reconciliation, the classifier consumes exactly that reconciliation and its ordered entries.
- A captured reconciliation produces outcome `classified`.
- A partial reconciliation produces outcome `partial` and diagnostic `reconciliation_partial` while preserving all retained entries.
- A finalized Run without reconciliation produces outcome `unavailable`, diagnostic `reconciliation_unavailable`, and zero entries.
- A non-terminal Run is ineligible.
- Missing or mismatched finalization, reconciliation, Run ownership, or entry order is persisted-state corruption.

The authoritative input includes only controlled identifiers, reconciliation outcome and boundary facts, ordered entry index, file Event ID, nullable safe relative path, change kind, staged/unstaged state, sensitivity, and attribution.

### Taxonomy v1

The controlled multi-label taxonomy is:

- `ui`
- `behavior`
- `tests`
- `dependency`
- `authentication_authorization`
- `public_api`
- `database_migration`
- `configuration_infrastructure`
- `documentation`
- `unknown`

`unknown` is an intentional factual result. It is emitted alone with confidence zero when a path is hidden or no supported rule matches.

### Rule discipline

Rules are an ordered immutable set with:

- a stable rule ID;
- one non-unknown taxonomy label;
- one controlled evidence kind;
- a fixed integer confidence in basis points;
- an explicit stable precedence number;
- a pure path predicate.

The v1 grammar uses only:

- exact well-known filenames;
- extensions;
- exact path segments;
- anchored basename and path patterns.

It covers common JavaScript/TypeScript and Node.js layouts including package manifests and lockfiles, React UI files, test/spec layouts, API/routes/controllers/contracts, auth/session/RBAC paths, Prisma/SQL/migrations, TypeScript/Vite/Biome/ESLint configuration, GitHub Actions, Docker/compose, and documentation.

Rules do not inspect arbitrary file text or infer semantics from prompts, commands, Event payloads, or neighboring files.

Confidence is deterministic rule strength, not a probability. For a label supported by multiple rules, the label confidence is the maximum fixed supporting-rule value. Rule evidence and labels use stable ASCII/canonical ordering.

### Input path validation

A retained normal path must be a canonical repository-relative slash-separated path. The classifier rejects absolute paths, drive paths, backslashes, NUL/control characters, traversal/dot segments, repeated/trailing separators, leading/trailing whitespace, and paths over the bound.

A secret entry must have a null path. Exposing a path for a secret entry is persisted-state corruption. A null normal path is classified only as `unknown`.

### Canonical artifact v1

Classification output is strict canonical UTF-8 JSON with:

- schema, classifier, taxonomy, and rule-set versions;
- Run, finalization, and nullable reconciliation IDs;
- controlled outcome and diagnostic;
- SHA-256 input fingerprint over the canonical accepted input;
- ordered entry classifications;
- deterministic aggregate label counts and maximum confidence.

Each entry includes only:

- entry index;
- file Event ID;
- change kind;
- attribution;
- sensitivity;
- ordered assigned labels;
- fixed confidence;
- ordered rule ID and controlled evidence kind.

The artifact excludes repository/workspace roots, relative paths, path identity hashes, commit IDs, Git hashes/fingerprints, prompts, commands, source/session/tool identifiers, file content, exception text, artifact digest/storage path, and generation timestamps.

Artifact metadata is fixed:

- role and kind `deterministic-change-classification-v1`;
- media type `application/vnd.ownloop.change-classification+json`;
- sensitivity `sensitive`;
- storage version 1;
- maximum 2000 entries and two MiB canonical bytes, using a classifier-specific canonical JSON budget rather than the smaller Hook-ingress budget.

### Persistence and migration v11

Migrations 1 through 10 remain immutable. Migration v11 adds no classification table.

It validates existing v1-role references, then installs:

- one partial unique index allowing at most one v1 classification reference per Run;
- an insert trigger requiring accepted metadata, bounded size, a terminal Run, and immutable finalization;
- a trigger preventing classification artifact sensitivity from changing away from `sensitive`.

Artifact bytes may be materialized before the Run-reference transaction. A failed reference transaction may leave only an unreferenced OL-010 GC candidate.

### Processor and read-back

Explicit APIs classify one finalized Run, process at most 25 eligible Runs sequentially, or read a persisted classification.

Read-back always:

1. validates unique Run role and artifact metadata;
2. reads verified bytes through OL-010;
3. requires canonical UTF-8 JSON and the strict shared contract;
4. reloads the authoritative finalization and reconciliation;
5. regenerates the expected canonical artifact;
6. requires byte-identical source correspondence and matching input fingerprint.

A changed accepted input without a classifier/rule-set version change is corruption/version-discipline failure, not silent reuse. Repeated and concurrent classification is idempotent through content addressing and the unique Run role.

---

## Consequences

### Positive

- downstream evidence can rely on stable taxonomy labels and rule IDs;
- classification is reproducible without an AI provider;
- no new repository/content privacy boundary is introduced;
- hidden and unsupported changes remain explicitly unknown;
- immutable artifacts support restart-safe audit and reprocessing;
- future rule sets can coexist through explicit versioning decisions.

### Negative

- path-only classification cannot understand implementation semantics;
- some files intentionally remain unknown;
- confidence values are rule strengths, not calibrated probabilities;
- v1 does not show classification in Raw Replay;
- new project ecosystems require explicit rule-set expansion and version discipline.

### Accepted risks

- the input fingerprint commits to canonical accepted paths even though paths are omitted from output;
- internal Run/finalization/reconciliation/Event IDs are retained for local evidence resolution;
- path grammar may produce multiple valid labels for one entry;
- query-time regeneration performs bounded local reads.

---

## Explicit non-ownership

OL-013 does not implement:

- AST, source-content, package-content, prompt, transcript, or command analysis;
- verification extraction or inference;
- evidence graph construction;
- replay UI classification display;
- candidate or Ownership Moments;
- analysis-job scheduling or background execution;
- repository or Git mutation;
- AI/model/network calls;
- cloud, analytics, telemetry, billing, or multi-user authentication.

---

## Validation

The decision is accepted when tests prove strict contracts, canonical byte identity, stable input fingerprints, deterministic multi-label evidence/confidence, all taxonomy categories, unknown and hidden paths, unsafe-path rejection, entry/artifact bounds, migration 10→11, metadata and unique-role invariants, explicit partial/unavailable outcomes, idempotency/concurrency/rollback/restart, tamper detection, bounded eligibility order, five Milestone A fixture outcomes, no classifier I/O boundary, and all standard quality gates.
