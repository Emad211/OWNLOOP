# ADR-0014: Project a Deterministic Raw Replay Through the Existing Authenticated Loopback Server

**Status:** Proposed
**Date:** 2026-07-22
**Decision owner:** Project founder
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0006-authenticated-loopback-ingestion.md`
- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
- `docs/adr/0011-evidence-bounded-git-reconciliation.md`
- `docs/adr/0012-local-content-addressed-artifact-store.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- GitHub issue #37

---

## Context

OwnLoop now persists accepted ingress receipts, lifecycle relationships, normalized Run Events, Git baselines, repository reconciliations, evidence gaps, content-addressed artifacts, and terminal finalization records. Those facts are durable, but a user cannot yet inspect them as one coherent replay.

The first viewer must not introduce a second truth model. In particular it must not:

- infer causal relationships from time proximity;
- relabel missing verification as success;
- copy persistence-only paths, hashes, source-session identifiers, or artifact storage metadata into browser contracts;
- persist a derived replay cache that can drift from accepted facts;
- create a second network listener or a permissive CORS surface;
- persist the installation token in browser storage, cookies, URLs, HTML, logs, or error text;
- read artifact files directly instead of using OL-010 integrity verification.

A browser is a less trusted display surface than the daemon. The replay boundary therefore needs an explicit contract that is narrower than the underlying database model and runtime validation on both the server and client.

---

## Decision

OwnLoop will implement OL-012 as a deterministic, read-only query-time projection named Raw Replay v1.

```text
accepted persisted Run facts
→ bounded deterministic projection
→ strict Raw Replay v1 contracts
→ authenticated existing loopback server
→ same-origin local React viewer
```

No replay table, replay cache, or projection migration is introduced.

### Authoritative inputs

The projection may read only persisted accepted relationships:

- Task Run and Conversation ownership;
- Run-level normalized Events and their positive sequence;
- receipt-to-normalized-Event links;
- Git baseline and its synthetic Event;
- every Git reconciliation, trigger, summary Event, and file Event;
- evidence gaps and the persisted Run counter;
- immutable Run finalization relationships;
- Run artifact references and OL-010 verified artifact content.

The projection must never infer a causal edge from timestamps, matching labels, filenames, or payload similarity.

### Supported Run states

The list and detail APIs support:

- `Capturing` and `Finalizing` as `in_progress`;
- `Completed` as `complete` only when its accepted finalization remains valid;
- `Partial` as `partial`;
- `Failed` as `failed`;
- `Abandoned` as `abandoned`.

A terminal Run without a consistent immutable finalization is persisted-state corruption, not an incomplete replay.

### Deterministic ordering and pagination

Run listing order is:

```text
started_at DESC,
conversation_id ASC,
run_number DESC,
run_id ASC
```

The cursor is strict base64url-encoded JSON containing only the ordering tuple and schema version. It contains no token, path, prompt, source-session identifier, hash, or artifact information. Invalid or non-canonical cursors are rejected without querying persistence.

Run Event order is the persisted positive Run sequence. The projection verifies contiguous sequence ownership and applies a bounded read.

### Raw Replay v1 contract

Shared strict Zod contracts live in `@ownloop/contracts` and are parsed at both API and browser boundaries.

The list response contains safe Run identity, status, completeness, a code-point-bounded prompt preview, timestamps, evidence-gap count, and evidence-presence booleans.

The detail response contains:

- the safe Run summary and full persisted redacted prompt;
- all bounded Run-level Events with controlled payload fields only;
- persisted causal links;
- privacy-safe baseline summary;
- every bounded reconciliation and changed-file observation;
- observed verification Events, without a success inference;
- evidence gaps;
- finalization status and relationships;
- safe replay-readable artifact references.

The contract intentionally has no field for:

- canonical or repository paths;
- commit IDs;
- Git hashes or working-tree fingerprints;
- source-session or source-event identifiers;
- artifact digest or storage path;
- sensitive changed-file path;
- raw receipt content, raw Git output, patch bytes, or file content;
- installation token.

### Controlled Event payload projection

The timeline does not expose arbitrary persisted JSON wholesale. Only a small controlled set of status, outcome, boundary, attribution, count, and presence fields is projected. Prompt payloads are empty because the redacted prompt already has a dedicated Run field. Unknown keys, paths, hashes, source identifiers, and nested arbitrary objects are omitted.

### Persisted causal links

Causal links are emitted only when backed by a persisted relationship:

- Events normalized from the same receipt;
- baseline Event to baseline;
- reconciliation trigger Event to reconciliation;
- reconciliation to summary and file Events;
- finalization trigger/reconciliation to finalization;
- finalization to final snapshot Event, terminal Event, and manifest artifact.

Link IDs are deterministic from controlled node kinds and internal IDs. Receipt IDs themselves are not exposed.

### Loopback API

The existing IPv4-loopback Fastify server is extended with:

- `GET /v1/replay/runs`
- `GET /v1/replay/runs/:runId`
- `GET /v1/replay/artifacts/:artifactId`

Every JSON and artifact route uses the existing installation Bearer-token verifier before any replay persistence or filesystem read. Responses use `Cache-Control: no-store` and stable content-free errors.

No CORS middleware or second listener is introduced.

### Artifact content

The artifact endpoint is limited to a version-1 final-diff manifest that:

- is referenced by a persisted Run with the controlled final-manifest role;
- has the accepted kind and media type;
- is below the replay response bound;
- is read and verified through OL-010.

The response is an attachment with `no-store` and `nosniff`. The browser parses it through the shared manifest contract before rendering.

### Same-origin browser viewer

The optional built web root is served by the existing loopback server only when it is a valid canonical directory with a regular `index.html`.

Static delivery:

- follows no symlink;
- rejects traversal, encoded traversal, NUL, and root escape;
- serves regular contained files only;
- provides SPA fallback for client routes;
- provides no directory listing;
- adds CSP, frame denial, `nosniff`, `no-referrer`, and `no-store` headers;
- remains disabled rather than breaking APIs when the configured root is missing or invalid.

The static HTML/JavaScript shell contains no token and is safe to fetch without authentication.

### Browser token boundary

The React viewer accepts the installation token through a password input, copies it into page memory only, clears the input, and sends it only as an Authorization header to `window.location.origin`.

The token is never written to:

- localStorage;
- sessionStorage;
- IndexedDB;
- cookies;
- URL/query/hash/history state;
- DOM text or attributes;
- logs or displayed errors.

Disconnect clears the in-memory credential and replay state. Any authenticated replay or artifact request that receives a 401 response performs the same immediate credential and state reset before returning to the connection screen.

### UI behavior

The viewer provides:

- connection and disconnect states;
- deterministic Run list with pagination;
- direct safe Run deep links;
- loading, empty, error, in-progress, complete, partial, failed, and abandoned states;
- redacted prompt, timeline, changed files, verification, evidence gaps, evidence structure, finalization, causal links, and artifacts;
- semantic HTML, keyboard controls, focus indication, responsive layout, and reduced-motion behavior;
- no external asset, analytics, remote font, or `dangerouslySetInnerHTML` use.

---

## Consequences

### Positive

- users can inspect what was persisted without creating a parallel source of truth;
- terminal and in-progress work use the same bounded replay model;
- causality and completeness remain evidence-backed;
- browser contracts cannot represent most persistence-only secrets;
- the existing token and loopback listener remain the only local network trust boundary;
- artifact integrity remains owned by OL-010;
- the projection can evolve independently because its schema version is explicit.

### Negative

- query-time projection performs multiple local repository reads;
- the first viewer is a factual evidence browser rather than an explanatory narrative;
- only controlled Event payload fields are displayed;
- users must re-enter the installation token after refresh by design;
- large Event histories and artifacts are rejected by explicit bounds rather than streamed in v1.

### Accepted risks

- safe non-sensitive repository-relative paths may be shown in changed-file observations;
- internal opaque IDs are displayed and used in deep links;
- optional static serving is synchronous for the small local shell and remains outside artifact/content storage;
- list pagination can observe newly inserted Runs between pages because no snapshot cursor is introduced in v1.

---

## Explicit non-ownership

OL-012 does not implement:

- Decision Moments, Ownership Moments, Evidence Graph, clustering, classification, scoring, or AI summaries;
- replay persistence, caching, background refresh, scheduler, or startup recovery orchestration;
- Git mutation or new Git observation;
- artifact creation or garbage collection;
- CORS, HTTPS, remote access, second listener, multi-user authentication, or token persistence;
- cloud, analytics, telemetry, billing, or external assets.

---

## Validation

The decision is validated when tests prove:

- strict contracts reject persistence-only fields;
- terminal and in-progress Run projections remain deterministic;
- cursor ordering and invalid-cursor rejection;
- privacy absence for roots, commits, hashes, digests, sessions, raw prompts, and sensitive paths;
- persisted causal links only;
- authentication occurs before replay reads;
- list, detail, artifact, and safe error routes work over a real loopback listener;
- artifacts are verified and bounded;
- static traversal, encoded traversal, symlink, and root escape are rejected;
- missing static root does not break APIs;
- CSP and browser security headers are present;
- UI renders factual states, uncertainty, no-verification state, and memory-only token controls;
- full format, lint, typecheck, test, and production build gates pass.
