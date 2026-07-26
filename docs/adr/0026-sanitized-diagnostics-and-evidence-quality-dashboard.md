# ADR-0026: Sanitized Diagnostics and Evidence-Quality Dashboard

**Status:** Accepted
**Date:** 2026-07-25
**Decision owner:** Project founder
**Related documents:**

- `docs/product/BACKLOG_v0.1.0.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- `docs/adr/0021-deterministic-candidate-validation-and-selection.md`
- `docs/adr/0025-local-settings-and-privacy-controls.md`
- GitHub Issue #69

---

## Context

OwnLoop now records enough trusted local state to explain operational and evidence quality without collecting raw logs. The v0.1 backlog requires a diagnostics dashboard showing hook counts, malformed payloads, duplicates, redactions, Evidence gaps, finalization status, and a sanitized export.

The accepted architecture already provides:

- OL-023 process-lifetime off/counts-only ingress diagnostics;
- validated prepared-ingress redaction summaries;
- Task Run and immutable finalization records;
- persisted Evidence gaps;
- verified OL-019 Candidate-validation reports containing controlled decisions and reason codes but no Candidate prose.

OL-024 must compose these sources without adding a diagnostic store, raw log archive, or data-exfiltration path.

## Decision

OwnLoop will expose diagnostics as a bounded authenticated read-only projection and an on-demand in-memory sanitized JSON bundle.

```text
allowlisted process counters
+ validated persisted redaction summaries
+ strict Run/finalization/Evidence-gap records
+ verified OL-019 validation reports
→ bounded diagnostics dashboard
→ sanitized ephemeral JSON bundle
→ existing authenticated loopback server and local UI
```

No migration, diagnostic table, bundle artifact, background collector, provider/model call, repository/source read, second listener, CORS surface, analytics, telemetry, or runtime dependency is introduced.

## Source authority

The projector reads only through accepted boundaries:

1. an OL-023 process-counter snapshot;
2. validated `PreparedIngressReceiptV1.redactionSummary` metadata;
3. strict Task Run records;
4. validated immutable Run finalizations;
5. bounded Evidence-gap repository reads;
6. current-policy Candidate-validation records and `readValidatedCandidateValidation` artifact read-back.

Raw or redacted ingress payload JSON is never selected. Validation rejection reasons are aggregated only after the OL-019 report artifact, source generation, Evidence Graph provenance, canonical bytes, and report counts have been revalidated.

Any source disagreement or tamper fails closed. The dashboard never repairs state or starts ingestion, finalization, generation, validation, cleanup, or another write.

## Process diagnostics

Process counters remain in memory and are available only when OL-023 diagnostic mode is `counts_only`.

The internal snapshot adds controlled accepted/duplicate counts grouped by supported Claude hook name while preserving the existing public OL-023 diagnostics response.

The dashboard may expose only:

- server start/stop counts;
- accepted, duplicate, and rejected request counts;
- accepted/duplicate counts by controlled hook name;
- rejected counts by controlled ingestion error code.

Counters reset on daemon restart. The dashboard always declares that process counters are process-lifetime and a zero is not proof of absence. Diagnostic mode off returns no process counters and a controlled limitation.

No receipt ID, request body, URL, port, source-session ID, token, prompt, code, path, exception, or stack is exposed.

## Persisted redaction aggregates

The projector aggregates only preparation metadata and `redaction_summary_json` from existing receipts.

It returns exact prepared and legacy receipt totals plus aggregate:

- redacted fields;
- redacted values;
- dropped unknown fields;
- path replacements;
- truncated values;
- prepared receipts grouped by controlled hook name;
- receipts using each controlled redaction rule.

Every summary is parsed through the runtime contract. Legacy receipts are reported separately and never labeled unredacted. Raw payload JSON is neither selected nor parsed. Summary tamper fails closed.

## Run and Evidence quality

The dashboard returns exact global aggregates and at most 100 recent Run-quality rows.

Global aggregates include:

- Runs grouped by lifecycle status;
- finalizations grouped by terminal status, mode, and diagnostic code;
- Evidence gaps grouped by controlled gap code;
- current-policy validations grouped by outcome;
- Candidate source/rejected/duplicate/unselected/selected totals;
- controlled validation-reason counts.

A recent row may expose only Run ID/number/status/timestamps, gap count, finalization status/mode/diagnostic, latest validation ID/outcome/counts, controlled reason counts, and controlled limitations.

Evidence-gap messages/details/IDs and Candidate wording are excluded. Validation reason counts must reconcile exactly with the verified report. Active Runs may appear without fabricated finalization or validation results.

## Deterministic dashboard

The strict dashboard includes schema/projector versions, diagnostic mode, limitations, process counters or null, redaction aggregates, global quality aggregates, recent Runs, exact total/truncation state, and a SHA-256 fingerprint.

The dashboard is canonical and bounded to 1 MiB. Identical persisted state, process counters, settings mode, and projector versions produce byte-identical output and fingerprint. Wall time and export metadata do not enter the dashboard fingerprint.

## Sanitized bundle

The export route creates a strict JSON bundle in memory containing:

- bundle and dashboard version tuples;
- application version tuple;
- server UTC export timestamp;
- dashboard fingerprint and exact dashboard snapshot;
- fixed sanitization declarations;
- a bundle fingerprint over canonical content excluding only the fingerprint field.

The bundle is bounded to 2 MiB, returned as a safe JSON attachment, and never persisted as a database row, OL-010 artifact, Event, managed temporary object, log, or browser-storage entry.

The dashboard and bundle exclude payload JSON, prompts, goals, Candidate prose, Evidence IDs/text, repository content/paths/commits, commands/outputs, provider configuration/requests/secrets, installation credentials, source-session/tool IDs, artifact metadata/bytes, free-form text, exceptions, and stacks.

## API

The existing authenticated loopback server adds:

```text
GET /v1/diagnostics/dashboard
GET /v1/diagnostics/bundle
```

Both routes authenticate before settings, persistence, artifact, or process-counter reads. They are GET-only, accept no query expansion, return no-store and nosniff headers, and expose stable content-free errors. The bundle includes exact content length and a fixed safe filename.

No new listener, CORS, redirect, external URL, write, or processing side effect is introduced.

## UI

The existing local viewer adds a Diagnostics and Evidence Quality experience with:

1. process hooks and rejection codes;
2. redaction aggregates and controlled rules;
3. Run/finalization outcomes;
4. Evidence-gap and validation-quality aggregates;
5. bounded recent Run-quality rows;
6. explicit sanitized bundle download.

Diagnostics-off and restart-reset limitations are prominent. Zero values are described as observed process counts, never proof that nothing occurred.

The UI uses semantic headings/tables, keyboard controls, visible focus, responsive layout, reduced-motion support, and `aria-live` loading/error/export states. Export uses one ephemeral object URL and revokes it immediately. No browser storage, external assets, dangerous HTML, analytics, or telemetry is used.

## Consequences

### Positive

- operators can inspect ingestion and evidence quality without raw logs;
- controlled OL-019 rejection reasons become diagnosable without Candidate prose;
- persisted quality survives restart while process counters remain honestly process-lifetime;
- sanitized support bundles can be downloaded without durable duplication;
- existing authentication and privacy boundaries are reused.

### Negative

- process counters reset on restart;
- diagnostics-off means malformed and duplicate process observations are unavailable;
- verified validation-report aggregation requires bounded artifact reads;
- no raw troubleshooting context is available in v0.1;
- a single corrupt verified source fails the dashboard closed.

## Alternatives rejected

### Persist diagnostic events or bundles

Rejected because it creates a new retention and privacy surface.

### Export raw logs, payloads, prompts, or Evidence text

Rejected because operational support does not justify source or secret exposure.

### Infer validation quality from record counts only

Rejected because controlled rejection reasons must come from the verified OL-019 report.

### Add OpenTelemetry or a metrics server

Rejected because v0.1 is a local single-user prototype with no remote telemetry boundary.

---

## Validation

The decision is accepted when Issue #69 contract, deterministic projection, process-counter, redaction aggregate, Run/finalization/gap, verified validation-reason, restart, tamper, authenticated API, sanitized-bundle, UI, privacy, full-regression, and production-build tests pass.

## Reversibility

Durable diagnostics, raw-log export, tracing, remote support upload, automatic sampling, or telemetry require later accepted decisions.