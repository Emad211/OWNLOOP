# ADR-0025: Local Settings and Privacy Controls

**Status:** Accepted
**Date:** 2026-07-25
**Decision owner:** Project founder
**Related documents:**

- `docs/product/BACKLOG_v0.1.0.md`
- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/adr/0006-authenticated-loopback-ingestion.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0020-provider-backed-candidate-generation-boundary.md`
- `docs/adr/0023-append-only-moment-interactions-and-ownership-records.md`
- `docs/adr/0024-deterministic-enriched-build-replay.md`
- GitHub Issue #67

---

## Context

OwnLoop now has a trustworthy capture, evidence, Moment, interaction, and enriched-replay pipeline. The v0.1 backlog next requires local settings and privacy controls.

The settings surface must not become a new source of secrets, a cloud account system, or a hidden scheduler. Existing boundaries already establish that:

- external provider generation is explicit and disabled when callers pass `{ enabled: false }`;
- provider credentials are in-memory call arguments and never belong in ordinary durable state;
- the loopback server authenticates with a memory-only browser token;
- full Task Run deletion exists at the persistence boundary;
- OL-010 can collect bounded unreferenced artifacts;
- ingress stores a canonical redacted journal required for normalization and lifecycle, not an optional raw source-payload diagnostic archive;
- ingress diagnostics are allowlisted observations and must remain fail-open.

OL-023 must expose these controls without weakening them.

## Decision

OwnLoop will add one strict persisted singleton settings row, one process-memory provider-secret holder, explicit retention/deletion actions, allowlisted in-memory diagnostic counters, and bounded custom secret-field patterns.

```text
strict persisted public settings
+ memory-only provider secret
+ explicit terminal-Run deletion
+ bounded artifact GC
+ future-ingress-only custom field redaction
+ allowlisted in-memory diagnostic counts
→ authenticated existing loopback server
→ accessible local settings UI
```

No account, remote identity, cloud state, scheduler, background retention worker, raw source-payload archive, provider call from settings routes, or new listener is introduced.

## Persisted settings

Migration v18 creates exactly one `local_settings` row with ID `local`.

The row stores controlled columns only:

- schema version;
- monotonic revision;
- external-AI enabled state;
- normalized public provider options or null;
- retention policy;
- diagnostic mode;
- raw source-payload retention literal `off`;
- canonical sorted custom secret-field patterns;
- canonical UTC update timestamp.

A fresh database inserts revision 1 with AI disabled, no provider public config, `keep_until_deleted`, diagnostics off, raw source payload retention off, and no custom patterns.

The row contains no provider API key, installation token, prompt, Event content, source payload, repository path, Candidate wording, Evidence text, artifact path, free-form note, exception, or arbitrary JSON object.

Updates are complete replacements using compare-and-swap revision checks. One successful update increments the revision by exactly one. A stale revision changes nothing.

## Provider configuration and secret

Persisted provider fields are limited to the existing OL-018 public options:

- validated HTTPS base URL;
- model ID;
- optional model revision;
- timeout;
- maximum response bytes;
- bounded retry policy.

The provider API key is held only in daemon process memory.

- It is validated by the existing OL-018 validator.
- API responses expose only `absent` or `loaded`.
- It is never written to SQLite, artifact storage, Events, diagnostics, logs, browser storage, URL state, cookies, errors, or snapshots.
- Daemon restart resets it to absent.
- Disabling external AI or clearing public configuration clears it after the persisted settings transaction commits.
- Current generation options resolve to `{ enabled: false }` until external AI is enabled, public configuration is complete, and a valid in-memory key is loaded.
- Settings routes never trigger generation or provider contact.

OS keychain integration is deferred.

## Retention and deletion

Version 1 retention policies are:

- `keep_until_deleted`;
- `delete_terminal_after_7_days`;
- `delete_terminal_after_30_days`;
- `delete_terminal_after_90_days`.

No timer, worker, cron job, startup purge, TTL trigger, or hidden cleanup runs.

The user explicitly requests a preview and explicitly applies cleanup. Only terminal Runs older than the selected cutoff are eligible. Ordering is deterministic. Every Run is rechecked immediately before deletion.

An authenticated explicit DELETE route also permits deletion of one selected terminal Run. Active Runs return a conflict and remain untouched.

Task Run deletion reuses existing cascade relationships. Afterwards OL-010 performs bounded unreferenced-artifact collection. Shared referenced artifacts remain.

No soft delete, tombstone table, individual Event deletion, or undo model is added.

## Diagnostics

Version 1 diagnostic modes are:

- `off`;
- `counts_only`.

Counts-only diagnostics aggregate only existing allowlisted ingress events:

- starts and stops;
- accepted receipts;
- duplicate receipts;
- rejected requests grouped by controlled code.

Counters are in process memory and disappear on restart. Switching to off clears them. No diagnostic table, artifact, provider secret, prompt, code, request body, source/session identifier, path, exception, stack, analytics, or telemetry is stored.

Sanitized diagnostic bundle export remains OL-024.

## Raw source payload retention

OL-023 exposes the policy as the fixed literal:

```text
rawSourcePayloadRetention = off
```

The existing canonical redacted ingress journal remains because normalization and lifecycle depend on it. It is not a second optional source-specific raw diagnostic store.

OL-023 adds no unredacted payload persistence and no optional raw source-payload artifact/table. Enabling such a mode requires a later ADR with bounded retention and deletion semantics.

## Custom secret-field patterns

The user may extend field-name redaction only. Secret values and arbitrary regular expressions are not accepted.

Pattern grammar:

- normalized lowercase field names only;
- normalization removes `.`, `_`, `-`, and whitespace;
- exact token, `prefix*`, or `*suffix`;
- ASCII lowercase letters and digits plus at most one edge wildcard;
- 3–64 non-wildcard characters;
- maximum 32 unique patterns;
- canonical sorted order;
- no internal wildcard, regex metacharacter, path, URL, control, newline, or Unicode confusable.

Built-in rules remain mandatory. Custom patterns can only increase redaction. They apply only to future ingress preparation. A matching field value becomes the existing stable redaction marker. Redaction summaries record a controlled custom-field rule code and count, never the pattern text.

The UI warns users not to enter an actual credential value.

## API

The existing authenticated loopback server adds:

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

All routes authenticate before settings, persistence, artifact, or secret-memory access. Responses are no-store and use stable content-free errors. Body size, method, media type, and ID validation remain strict.

No CORS, redirect, external URL, second listener, or processing side effect is added.

## UI

The existing authenticated React viewer adds a local Settings and Privacy experience containing:

1. external-AI public configuration and memory-only key status;
2. retention policy, preview, and explicit apply action;
3. off/counts-only diagnostics;
4. bounded custom secret-field pattern editing;
5. visible fixed-off raw source-payload policy;
6. explicit terminal-Run deletion.

The UI uses semantic controls, visible focus, keyboard operation, responsive layout, reduced-motion support, and `aria-live` pending/saved/error feedback. It does not claim persistence before a server receipt.

Provider key inputs are password fields with autocomplete off and are cleared after submission. Authorization failures clear the installation token, settings, replay, and secret-status UI state.

No localStorage, sessionStorage, IndexedDB, cookie, URL serialization, remote asset, dangerous HTML, analytics, or telemetry is used.

## Privacy boundary

The settings system never persists or returns:

- provider API keys or key-derived hashes;
- installation token/hash;
- prompts, Candidate wording, interaction text, Evidence text;
- repository roots, paths, commits, Git fingerprints, or source content;
- source-session/tool-use identifiers;
- raw source payloads;
- artifact digest/storage paths;
- actual secret values or arbitrary regular expressions;
- exceptions/stacks;
- account, email, remote identity, device fingerprint, analytics, or telemetry identifiers.

## Consequences

### Positive

- external AI remains visibly disabled until explicitly and completely configured;
- provider secrets stay memory-only;
- privacy and retention choices survive restart without a background scheduler;
- terminal Runs can be deleted completely from the UI;
- custom field-name patterns extend future redaction safely;
- raw source diagnostic retention remains structurally off;
- existing loopback/authentication and artifact boundaries are reused.

### Negative

- provider keys must be reloaded after daemon restart;
- retention cleanup requires explicit user action;
- diagnostics counters reset on restart;
- custom patterns cannot redact arbitrary value patterns;
- settings add migration v18 and several authenticated write routes.

## Alternatives rejected

### Persist provider keys in SQLite

Rejected because ordinary durable storage expands credential risk and contradicts OL-018.

### Browser localStorage for settings or secrets

Rejected because the daemon is the local source of truth and browser credentials remain memory-only.

### Background retention scheduler

Rejected because the backlog requires controls, not hidden deletion timing, and v0.1 has no scheduler boundary.

### Arbitrary user regular expressions

Rejected because patterns may be unsafe, expensive, non-deterministic, or accidentally contain secret values.

### Enable raw diagnostic payload retention

Rejected for OL-023 because it needs a separate bounded artifact, retention, visual-indicator, and source-schema decision.

---

## Validation

The decision is accepted when Issue #67 contract, migration, compare-and-swap, memory-only secret, generation-disable, retention preview/apply, Run deletion, artifact GC, diagnostic counts, custom redaction, authenticated API, UI, privacy, accessibility, restart, concurrency, full-regression, and production-build tests pass.

## Reversibility

OS keychain storage, automatic cleanup, raw diagnostic payload artifacts, value-pattern redaction, diagnostic export, accounts, cloud, or team settings require later accepted decisions.