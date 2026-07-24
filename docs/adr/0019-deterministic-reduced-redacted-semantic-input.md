# ADR-0019: Build Deterministic Reduced and Redacted Semantic Input

**Status:** Proposed  
**Date:** 2026-07-24  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0015-deterministic-evidence-backed-change-classification.md`
- `docs/adr/0016-deterministic-verification-evidence-extraction.md`
- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- `docs/adr/0018-strict-evidence-backed-candidate-moment-contracts.md`
- GitHub Issue #49

---

## Context

OwnLoop now has deterministic classification, verification evidence, a locally resolvable Evidence Graph, and strict Candidate Moment contracts. A future configured provider may propose candidates, but it must not receive the full repository, transcript, raw commands, paths, source content, or arbitrary Event payloads.

The input boundary must solve several problems before provider integration exists:

- include enough factual structure to generate useful candidates;
- preserve OL-015 Evidence IDs for every factual item;
- apply a second deterministic redaction pass to already-redacted prompt and verification excerpts;
- reduce large evidence sets under a fixed priority budget;
- remain byte-reproducible and restart-verifiable;
- record provider-independent size and token estimates without fabricating monetary cost;
- support explicit disablement with no sensitive reads or writes.

Provider-specific prompts, tokenizers, prices, credentials, retries, and generation provenance belong to OL-018 and are not part of this decision.

---

## Decision

OwnLoop will build one strict, canonical `SemanticAnalysisInputV1` artifact for each explicitly enabled eligible Run.

```text
persisted redacted Run goal
+ validated OL-015 Evidence Graph
+ validated OL-014 reduced verification evidence
→ deterministic second-pass redaction
→ priority-bounded evidence reduction
→ immutable OL-010 semantic-input artifact
```

The processor performs no provider/model/network call and reads no repository or source file.

## Explicit enablement

The processor requires an explicit `enabled` option.

When disabled, it returns a controlled disabled result before reading the Run prompt, Evidence Graph, verification artifact, or filesystem. It creates no artifact, reference, Event, job, queue, log body, or deferred work.

Persisted user settings remain assigned to OL-023.

## Authoritative input

For enabled processing, the Run must be terminal and have one immutable finalization and one valid OL-015 graph.

The builder may read only:

- the Run's persisted `redactedPrompt`;
- the verified Evidence Graph artifact;
- the verified OL-014 verification artifact;
- controlled graph metadata, locators, limitations, and edges;
- accepted schema/analyzer versions.

It does not read raw receipts, arbitrary Event payloads, repository files, Git output, patch/hunk content, source text, full transcript, commands, source-session/tool-use identifiers, or object-store paths/digests.

## Semantic input contract

The canonical artifact contains:

- schema, builder, reduction-policy, redaction-policy, and token-estimator versions;
- target Candidate Moment schema version;
- controlled Run/finalization/graph/verification identifiers;
- graph outcome and limitations;
- package outcome and controlled diagnostic;
- deterministic input fingerprint;
- second-pass-redacted goal;
- ordered evidence summaries;
- ordered evidence relations;
- optional ordered second-pass-redacted verification excerpts;
- deterministic counts and estimates.

Artifact metadata is fixed:

- role and kind: `reduced-semantic-analysis-input-v1`;
- media type: `application/vnd.ownloop.semantic-analysis-input+json`;
- storage version: `1`;
- sensitivity: `sensitive`;
- maximum canonical bytes: `512 KiB`;
- maximum summaries: `2000`;
- maximum relations: `4000`;
- maximum excerpts: `100`.

## Second-pass redaction

Ingress redaction is necessary but not sufficient for external eligibility. OL-017 applies a separate versioned policy to the Run goal and accepted verification excerpts.

The policy:

- validates Unicode and requires NFC output;
- normalizes line endings and removes disallowed controls;
- replaces recognized secret assignments, bearer credentials, private-key material, provider/cloud token forms, URLs, email addresses, IP addresses, and Unix/Windows absolute paths with controlled placeholders;
- rejects invalid persisted Unicode rather than repairing it;
- preserves safe ordinary text;
- deterministically records truncation.

The redactor does not recursively inspect arbitrary objects and does not attempt semantic source-code analysis.

## Goal

The goal is derived only from `redactedPrompt`, is bounded to 4000 code points and 16 KiB, and carries the graph's Run Evidence ID. It contains no raw markup delimiters or executable URI scheme.

## Evidence summaries

Evidence summaries are controlled structured records rather than model-authored prose. Supported kinds cover:

- Run and finalization status;
- graph limitations and evidence gaps;
- changed-file kind and attribution;
- deterministic classification labels and confidence;
- verification kind and observed status;
- test-file-change distinction;
- relevant artifact availability.

Every summary carries a primary graph-owned Evidence ID and optional supporting Evidence IDs. Summaries contain no relative path, path identity, root, commit, command, source text, output hash, source session, or artifact storage metadata.

## Evidence relations

Only a reduced allowlist of existing graph edges is included. Relations contain controlled edge type and source/target Evidence IDs. No relation is inferred from time, text, filenames, paths, tool names, or similarity.

## Verification excerpts

Only recognized test, lint, typecheck, and build observations may contribute excerpts. Each excerpt is linked to the matching verification Evidence ID and preserves the observed status.

Excerpts are second-pass-redacted and bounded to 1000 code points and 4 KiB each. Unknown-command output, raw command text, accepted output hashes, source Event IDs, and session/tool identifiers are excluded.

Output text cannot alter the persisted verification status.

## Deterministic reduction

The package uses fixed priority order:

1. graph outcome, limitations, gaps, and finalization;
2. verification statuses;
3. changed-file and classification evidence;
4. optional verification excerpts;
5. lower-priority relations.

When bounds require reduction, selection and truncation are canonical and the package becomes partial with diagnostic `budget_truncated`. Any retained item keeps its Evidence ID.

If a valid graph-backed package cannot be formed without inventing evidence, processing returns unavailable and creates no Run reference.

## Estimates

The artifact records:

- final UTF-8 bytes;
- model-visible code points;
- a deterministic conservative token upper bound;
- estimator version;
- monetary estimate status `provider_not_selected`.

No currency or amount is invented before OL-018 selects a provider/model and pricing basis.

## Persistence

Migration v14 preserves migrations 1 through 13 and adds only role constraints:

- at most one v1 semantic-input reference per Run;
- exact artifact storage version, kind, media type, sensitivity, and size;
- terminal Run with immutable finalization;
- validation of any pre-existing v1 role rows.

No semantic-input table, provider table, job, queue, scheduler, or mutable cache is introduced.

Artifact bytes may be materialized before the SQLite reference transaction. A failed reference transaction may leave only an unreferenced GC-eligible OL-010 object.

## Explicit APIs

The module exposes explicit single-Run, bounded sequential batch, and verified read-back APIs. It has no timer, startup worker, background scheduler, provider call, agent contact, or repository read.

Read-back verifies OL-010 bytes, strict contracts, metadata, source graph/verification identifiers and versions, policy versions, estimates, and the regenerated input fingerprint.

## Privacy boundary

Safe public results contain only controlled IDs, versions, outcome/diagnostic/limitations, artifact ID, fingerprint, counts, byte/token estimate, and monetary-estimate status.

They exclude goal/excerpt text, paths, commands, prompt content, source identifiers, artifact digest/path, exceptions, and stacks.

## Alternatives rejected

### Send the Raw Replay or full graph

Rejected. Both contain more local context than candidate generation requires.

### Send safe relative paths

Rejected for v1. Evidence IDs and controlled classifications provide grounding without external path disclosure.

### Use provider-specific tokenization now

Rejected. Provider/model selection belongs to OL-018.

### Persist mutable prompt/context rows

Rejected. The context is an immutable versioned OL-010 artifact.

### Treat ingress redaction as sufficient

Rejected. External eligibility requires a separate deterministic policy and golden tests.

---

## Consequences

### Positive

- OL-018 receives a finite, evidence-addressed, provider-independent package;
- full repository/transcript exposure is structurally prevented;
- secret-like values receive a deterministic second redaction pass;
- package bytes and budget estimates are reproducible;
- disablement performs no sensitive work;
- later candidates can cite local Evidence IDs without copying evidence content.

### Negative

- removing paths and source excerpts reduces model specificity;
- regex/policy redaction can conservatively replace benign values;
- provider-specific token/cost estimates remain unavailable until OL-018;
- large Runs may produce partial packages under the fixed budget.

## Validation

The decision is accepted when the contract, redaction, reduction, estimation, migration, persistence, concurrency, rollback, restart, tampering, disabled-mode, fixture, and complete repository quality gates in Issue #49 pass.

## Reversibility

Changing external data categories, exposing paths/source excerpts, adding provider-specific formatting, persisting enablement settings, or scheduling semantic input generation requires a superseding ADR or later milestone decision.
