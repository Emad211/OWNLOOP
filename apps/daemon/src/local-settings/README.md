# Local Settings and Privacy Controls

OL-023 owns the strict local settings and privacy-control boundary for the single-user loopback prototype.

## Durable public settings

Migration v18 stores exactly one revisioned `local_settings` row. It contains only public provider configuration, retention policy, diagnostic mode, the fixed-off raw source-payload policy, and canonical custom secret-field patterns. Updates replace the complete document through compare-and-swap; stale revisions change nothing.

Provider API keys never enter this row. They live only in the `LocalSettingsService` process memory, are exposed only as `absent | loaded`, disappear on daemon restart, and are cleared when external AI is disabled or public provider configuration changes.

## Explicit deletion and retention

Retention is policy plus explicit action, not a scheduler. Preview and apply use deterministic bounded reads, recheck terminal status, delete only eligible terminal Runs, and then invoke bounded OL-010 unreferenced-artifact collection. The single-Run DELETE route uses the same target-only cascade and preserves active Runs, other Runs, shared artifacts, and installation settings.

## Diagnostics and redaction

Diagnostics are process-lifetime `off | counts_only` counters over existing allowlisted ingress observations. They contain no payload, prompt, code, path, provider secret, exception, or stack and are cleared when disabled.

Custom secret patterns match normalized field names only using exact, `prefix*`, or `*suffix` grammar. Built-in secret rules remain mandatory. Updates affect only future ingress preparation and never rewrite historical receipts.

The raw source-payload diagnostic-retention policy is structurally fixed to `off`. The existing canonical redacted ingress journal remains solely because durable normalization and lifecycle depend on it; OL-023 creates no raw diagnostic payload table or artifact.

## Routes

All routes reuse the existing authenticated loopback server and return no-store responses:

```text
GET    /v1/settings
PUT    /v1/settings
POST   /v1/settings/provider-secret
DELETE /v1/settings/provider-secret
GET    /v1/settings/diagnostics
GET    /v1/settings/retention-preview
POST   /v1/settings/apply-retention
DELETE /v1/replay/runs/:runId
```

Authentication runs before settings, persistence, artifact, or secret-memory access. Settings writes commit the complete persisted document before applying memory-only secret cleanup, so a stale compare-and-swap conflict cannot silently change the loaded provider key. Retention and deletion recheck Run status at the write boundary before any cascade or artifact collection is reported.

Settings routes do not contact a provider, start analysis, create background work, or introduce a second listener or CORS surface.
