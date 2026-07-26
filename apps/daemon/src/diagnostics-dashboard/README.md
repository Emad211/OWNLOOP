# Diagnostics and Evidence-Quality Dashboard

OL-024 composes one bounded, authenticated, read-only operational snapshot from existing trusted sources:

- OL-023 process-lifetime allowlisted counters;
- validated prepared-ingress redaction summaries;
- strict Task Run, finalization, and Evidence-gap facts;
- verified current-policy OL-019 Candidate-validation reports.

The projector creates no Event, table, artifact, log archive, worker, provider request, repository read, or background task.

## Truth and privacy boundaries

Process counters are available only in `counts_only` mode and reset when the daemon restarts. A zero process count is an observed process-lifetime value, not proof that an event never occurred.

Persisted aggregates select controlled metadata only. Dashboard queries never select receipt payload JSON, prompts, repository paths or content, Evidence messages or IDs, Candidate prose, commands, provider data, secrets, exceptions, or stacks.

Validation outcomes and rejection reasons are counted only after the current OL-019 validation record and canonical report artifact pass existing read-back verification. Any provenance, artifact, count, or canonical-byte disagreement fails closed.

## Routes

The existing authenticated loopback server exposes:

```text
GET /v1/diagnostics/dashboard
GET /v1/diagnostics/bundle
```

Both routes are GET-only, reject query-controlled expansion, and return `Cache-Control: no-store` plus `X-Content-Type-Options: nosniff`.

The bundle is canonical sanitized JSON generated in process memory for the current request. It has a fixed safe filename, an exact content length, a 2 MiB bound, and fixed declarations for excluded data classes. OwnLoop does not persist it as a database row, artifact, Event, temporary managed object, log, or browser-storage value.

## Determinism

The dashboard fingerprint binds the complete controlled snapshot and projector versions, excluding wall time. Identical persisted state, diagnostic mode, process counters, and projector versions produce byte-identical canonical dashboard output and the same fingerprint.

The bundle adds a server UTC export timestamp, application-version tuple, exact dashboard snapshot, and its own fingerprint. Export does not modify the dashboard or any persisted source.
