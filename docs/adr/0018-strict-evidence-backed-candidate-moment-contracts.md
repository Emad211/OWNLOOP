# ADR-0018: Define Strict Evidence-Backed Candidate-Moment Contracts

**Status:** Proposed  
**Date:** 2026-07-23  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md`
- GitHub Issue #46

---

## Context

OwnLoop now has a deterministic, locally resolvable Evidence Graph. The next milestone eventually allows a configured AI provider to propose a finite set of candidate Ownership Moments. Model output is untrusted and must be constrained before provider integration, persistence, ranking, or rendering exists.

The contract must prevent several failure modes:

- a candidate factual claim without evidence;
- free-form file paths, URLs, citations, excerpts, or artifact identifiers substituting for Evidence IDs;
- candidate types paired with incompatible or executable interactions;
- arbitrary HTML, JavaScript, shell instructions, callbacks, or dangerous URI schemes;
- malformed output being silently repaired or stripped;
- confidence being interpreted as proof;
- provider/model provenance being mixed into the semantic candidate shape.

OL-016 is intentionally a contracts-only step. It introduces no provider, prompt, model call, persistence, scheduler, daemon processor, route, or UI.

---

## Decision

OwnLoop will define `CandidateMomentV1` as a strict discriminated union in `@ownloop/contracts` with four candidate types:

- `change`
- `decision`
- `risk`
- `check`

Every candidate contains bounded plain text, controlled importance, integer confidence basis points, one or more unique OL-015 Evidence IDs, and a type-compatible interaction.

A candidate that does not satisfy the schema is rejected. The validator does not normalize, repair, remove fields, resolve evidence, log content, or perform I/O.

## Shared candidate fields

All candidate variants contain:

- `type`;
- `title`;
- `claim`;
- `importance`;
- `confidenceBasisPoints`;
- `evidenceIds`;
- `suggestedInteraction`.

### Evidence

`evidenceIds` is a non-empty, bounded, unique array using the exact opaque OL-015 Evidence ID format.

The contract proves only shape and uniqueness. It does not prove:

- that an ID exists;
- that it belongs to a particular Run;
- that it supports the claim;
- that the claim contradicts another fact;
- that a limitation proves absence.

Those checks belong to OL-019.

### Confidence

`confidenceBasisPoints` is an integer from 0 through 10000. It represents a structured generator signal, not probability of correctness, factual support, user understanding, or permission to bypass validation.

### Importance

`importance` is one of:

- `low`
- `medium`
- `high`
- `critical`

It is a candidate ranking input only. It is not verified impact or a user decision.

## Type-compatible interactions

### Change

A Change candidate may only request acknowledgement:

```json
{ "kind": "acknowledge" }
```

### Decision

A Decision candidate uses a bounded plain-text prompt and the fixed option tuple:

```json
{
  "kind": "decision_response",
  "prompt": "...",
  "options": ["confirm", "revise", "uncertain"]
}
```

### Risk

A Risk candidate uses a bounded plain-text prompt and the fixed option tuple:

```json
{
  "kind": "risk_response",
  "prompt": "...",
  "options": ["acknowledge", "mitigate", "dismiss"]
}
```

### Check

A Check candidate contains a bounded question and two through five choices:

```json
{
  "kind": "check_answer",
  "question": "...",
  "choices": [
    { "id": "choice_key", "label": "..." }
  ]
}
```

Choice IDs use a strict local key format and are unique within the interaction. Choice labels are plain text. Choices contain no action, URL, callback, code, or hidden metadata.

A candidate with the wrong interaction kind is invalid.

## Plain-text policy

Model-authored strings are accepted only when they:

- consist only of valid Unicode scalar values and contain no lone UTF-16 surrogate;
- are NFC-normalized;
- contain no NUL or disallowed controls;
- contain no raw `<` or `>` delimiters;
- contain no URL or URI scheme, including HTTP(S), FTP, file, mailto, `javascript:`, `vbscript:`, or `data:`, case-insensitively;
- remain within field-specific code-point and UTF-8 byte limits.

The contract contains no raw HTML, rendered-Markdown instructions, CSS, JavaScript, shell command, tool call, URL, callback, function, or executable-content field.

Ordinary punctuation and plain Markdown-like characters are allowed only when they do not violate the restrictions above. Validation never rewrites text.

### Version 1 bounds

The contract applies independent code-point and UTF-8 byte limits:

- title: 160 code points and 640 bytes;
- claim: 2,000 code points and 8,000 bytes;
- decision/risk prompt and Check question: 500 code points and 2,000 bytes;
- Check choice label: 160 code points and 640 bytes;
- Evidence IDs per Candidate: 1–32;
- Check choices: 2–5;
- Candidates per batch: 0–50;
- canonical JSON representation of one batch: at most 512 KiB.

These limits are validation boundaries, not truncation targets. Oversized values are rejected without repair.

## Candidate batch

`CandidateMomentBatchV1` is a strict object containing:

- `schemaVersion: 1`;
- at most 50 candidates.

The batch does not contain provider credentials, prompt text, source context, token counts, cost, model metadata, generator provenance, Run paths, source content, artifact digest/storage path, or HTML.

Provider, model, prompt-template, and generator provenance will belong to OL-018's generation record, outside the semantic candidate object.

## Pure validation API

The contracts package exposes:

- `CandidateMomentV1Schema`;
- `CandidateMomentBatchV1Schema`;
- `parseCandidateMomentV1`;
- `parseCandidateMomentBatchV1`.

Parsing first validates a cloned strict value, then recursively freezes the clone and returns an immutable value. Input objects are not mutated or frozen. The immutable type mapping preserves fixed tuples, including the exact order and length of Decision and Risk options.

## Consequences

### Positive

- every candidate is evidence-addressed before provider integration;
- interaction behavior is finite and type-compatible;
- malformed or executable model output fails closed;
- future providers share one provider-independent semantic contract;
- later validation/ranking can rely on bounded canonical fields.

### Negative

- free-form interactions and arbitrary choice metadata are unavailable;
- some otherwise readable text containing angle brackets or dangerous schemes is rejected;
- evidence support is not established at contract-parse time;
- generator provenance requires a separate OL-018 envelope.

## Alternatives rejected

### Accept loose JSON and clean it later

Rejected. Silent repair obscures malformed model output and can retain unsupported or executable fields.

### Allow free-form citations or file paths

Rejected. Only OL-015 Evidence IDs provide local, Run-scoped evidence resolution.

### Allow one generic interaction object

Rejected. A discriminated type-compatible interaction prevents a model from attaching arbitrary actions to a candidate.

### Include provider and prompt metadata in each candidate

Rejected. Semantic candidates should remain provider-independent; generation provenance belongs to the generation record.

### Resolve Evidence IDs inside the schema helper

Rejected. Contract parsing is pure. Run ownership and claim support require persistence and Graph validation in OL-019.

---

## Validation

The decision is accepted when Issue #46 contract, safety, boundary, immutability, export, and full quality-gate tests pass.

## Reversibility

New candidate types, interaction kinds, markup policy, choice behavior, or schema versions require a new version and an explicit compatibility decision. OL-016 v1 objects are not silently widened.
