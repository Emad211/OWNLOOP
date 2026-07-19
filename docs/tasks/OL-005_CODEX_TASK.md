# OL-005 Codex Task Brief

**Issue:** #7 — Implement SQLite persistence foundation and ingress journal  
**Base branch:** `agent/ol-005-persistence-plan`  
**Suggested work branch:** `codex/ol-005-sqlite-persistence`  
**Task type:** Persistence foundation only

---

## Objective

Implement the smallest durable SQLite persistence layer that OwnLoop requires before building its loopback ingestion endpoint.

The result must provide:

- a controlled `node:sqlite` connection boundary;
- explicit versioned migrations with checksum verification;
- the initial persistence schema;
- a durable journal for caller-provided **redacted** ingress receipts;
- append-only normalized event persistence;
- low-level typed repositories;
- constraint, durability, migration, and deletion tests.

Do not implement transport, redaction, event processing, lifecycle behavior, or product features.

---

## Mandatory reading order

Before editing files, read:

1. `AGENTS.md`
2. `docs/product/PROJECT_SCOPE.md`
3. `docs/adr/0001-human-ownership-layer.md`
4. `docs/adr/0002-local-first-claude-code-first-mvp.md`
5. `docs/adr/0003-event-schema-and-session-lifecycle.md`
6. `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
7. `docs/architecture/C4.md`
8. `docs/product/BACKLOG_v0.1.0.md`
9. GitHub issue #7
10. Node.js 24.18.0 SQLite documentation linked by the issue and ADR

Then restate:

- why OL-005 now precedes OL-003;
- what `accepted` will mean later;
- why unredacted source payload persistence is prohibited;
- every explicit out-of-scope capability.

---

## Fixed technical choices

Use:

- Node.js `24.18.0` exactly;
- built-in `node:sqlite`;
- `DatabaseSync`;
- explicit SQL;
- prepared statements;
- explicit transactions;
- immutable ordered migration definitions;
- SHA-256 migration checksums using `node:crypto`;
- Vitest and temporary databases.

Do not add:

- an ORM;
- a SQLite driver package;
- a migration framework;
- a runtime dependency for IDs, timestamps, hashing, or filesystem paths.

No external runtime dependency should be added by OL-005.

---

## Ownership boundary

Implement persistence under:

```text
apps/daemon/src/persistence/
```

A reasonable layout is:

```text
persistence/
├── database.ts
├── migrations.ts
├── migration-definitions.ts
├── transaction.ts
├── errors.ts
├── repositories/
│   ├── ingress-receipts.ts
│   ├── workspaces.ts
│   ├── conversations.ts
│   ├── task-runs.ts
│   └── events.ts
└── index.ts
```

Use fewer files when that is clearer. Do not create another workspace package unless a real build dependency requires it and the PR explains why.

Raw SQL must remain inside the persistence boundary.

---

## Database connection

Expose an explicit function that opens a database from a caller-supplied path.

The function must:

- support `:memory:` for tests;
- support file-backed database paths;
- enable `PRAGMA foreign_keys = ON`;
- configure a bounded busy timeout;
- use WAL for file-backed databases when supported;
- use a documented synchronous setting appropriate for durable local event receipt;
- leave defensive behavior enabled;
- apply migrations before returning a ready persistence handle;
- expose an explicit close operation.

Do not choose an OS-specific default database path in this task.

Do not automatically place the database in the current or analyzed repository.

---

## Migration system

Implement a minimal internal migration runner.

Each migration definition must contain:

- positive integer `version`;
- stable `name`;
- immutable SQL string.

The runner must:

1. create `schema_migrations` when required;
2. calculate a SHA-256 checksum from the migration SQL;
3. read already applied migrations;
4. reject duplicate migration versions or unordered definitions;
5. reject an applied version whose checksum or name differs;
6. apply each pending migration inside a transaction;
7. record version, name, checksum, and applied timestamp;
8. be idempotent on later startup.

Migration SQL may live in TypeScript modules so `tsc` includes it without copying `.sql` assets.

No migration is generated or mutated at runtime.

---

## Initial schema

Implement the tables and constraints required by issue #7 and ADR-0004.

Required tables:

```text
schema_migrations
ingress_receipts
workspaces
agent_conversations
task_runs
events
event_deduplication
evidence_gaps
analysis_jobs
artifacts
run_artifacts
```

### General schema rules

- IDs are non-empty text supplied by callers.
- ISO timestamps are stored as text supplied by callers, except the migration applied timestamp.
- JSON columns use SQLite `json_valid` checks.
- boolean values use integer checks where needed.
- foreign keys use explicit delete behavior.
- indexes are added only for demonstrated access or uniqueness requirements.

### `ingress_receipts`

Must store only a caller-provided `redactedPayloadJson` equivalent.

Must not expose:

- `raw_payload`;
- `original_payload`;
- an ambiguous generic payload insert parameter.

Minimum processing statuses:

```text
pending
processed
failed
```

Enforce receipt deduplication uniqueness within source and source session.

### `task_runs`

Persist the ADR-0003 lifecycle status values as a database constraint:

```text
Capturing
Finalizing
Completed
Partial
Abandoned
Failed
```

This task does not implement transitions between those states.

### `events`

Cover the current `NormalizedEventEnvelope` fields.

Enforce:

- `run_id` and `sequence` both null or both non-null;
- positive integer sequence when present;
- unique `(run_id, sequence)`;
- known normalized source values;
- known sensitivity values;
- valid payload and metadata JSON;
- foreign keys;
- database trigger rejecting every `UPDATE` on an event row.

Do not add an event update repository method.

### Artifacts

Use separate `artifacts` and `run_artifacts` tables so one content-addressed artifact can be referenced by multiple Task Runs.

Deleting one Task Run removes only its reference. Shared artifact metadata must remain while another run still references it.

Do not write or delete artifact files in this task.

---

## Repository API

Expose small typed primitives that are sufficient to prove the persistence boundary.

Expected capabilities include:

- insert and read an ingress receipt;
- insert a workspace;
- insert an agent conversation;
- insert and delete a Task Run;
- append and read a normalized event;
- list run events in sequence order;
- transaction execution where a later task needs atomic writes.

Rules:

- callers provide IDs and timestamps;
- callers provide validated normalized events;
- callers provide a value explicitly named as redacted ingress JSON;
- repositories use prepared statements;
- repository functions map SQLite rows to typed camel-case application values;
- no lifecycle, normalization, redaction, deduplication decision, or sequence allocation logic is introduced;
- no raw SQL is exported outside the persistence module.

Use domain-specific error classes or stable error codes only where tests need to distinguish migration, constraint, or persistence failures. Do not mirror entire SQLite error messages into the public API.

---

## Required tests

Use both in-memory and temporary file-backed databases.

At minimum test:

1. new in-memory database migration;
2. new file-backed database migration;
3. migration rerun idempotency;
4. migration checksum mismatch rejection;
5. migration order and duplicate-version rejection;
6. foreign-key enforcement;
7. redacted ingress receipt insert/read;
8. duplicate ingress receipt key rejection;
9. invalid JSON rejection;
10. Task Run number uniqueness;
11. event `runId`/sequence invariant;
12. event sequence positivity and uniqueness;
13. event update trigger rejection;
14. append and ordered event read;
15. Task Run cascade deletion;
16. conversation-level event survival when deleting a child run;
17. shared artifact metadata survival after one run deletion;
18. explicit workspace cascade deletion;
19. file-backed close/reopen durability;
20. absence of an event update operation from the repository API.

Assertions must target stable outcomes, constraints, and custom error categories. Do not snapshot whole SQLite errors or binary files.

---

## Explicitly out of scope

Do not add or implement:

- Fastify;
- an HTTP server or client;
- local token authentication;
- stdin parsing;
- Hook forwarding;
- `.claude/settings.json`;
- redaction or canonicalization behavior;
- processing journal receipts;
- event normalization;
- deduplication decisions;
- sequence allocation;
- Task Run state transitions;
- Git baseline or reconciliation;
- artifact content storage;
- a background worker;
- AI/provider integration;
- UI changes;
- Ownership Moments;
- Build Replay;
- cloud, authentication, billing, analytics, or telemetry.

Do not modify product scope or accepted ADR content. Report a conflict instead.

---

## Required validation

Run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run a focused file-backed persistence smoke test if it is not already exercised through Vitest.

Do not claim a check passed unless it completed successfully.

---

## Required pull request

Create a draft PR:

```text
codex/ol-005-sqlite-persistence
        ↓
agent/ol-005-persistence-plan
```

The PR body must include:

1. why persistence precedes HTTP ingestion;
2. Node SQLite connection and PRAGMA choices;
3. migration representation and checksum behavior;
4. every table, index, trigger, and delete rule;
5. every public persistence primitive;
6. exact dependency changes;
7. test matrix and results;
8. file-backed durability result;
9. known limitations of synchronous `node:sqlite` and release-candidate status;
10. explicit scope-exclusion confirmation;
11. `Closes #7`.

---

## Copy-paste Codex prompt

```text
Implement GitHub issue #7 (OL-005) in repository Emad211/OWNLOOP.

Base your work on branch `agent/ol-005-persistence-plan`. Use an isolated worktree and create branch `codex/ol-005-sqlite-persistence`.

Before editing, read `AGENTS.md`, `docs/tasks/OL-005_CODEX_TASK.md`, ADR-0004, all referenced ADRs, C4 architecture, the backlog, issue #7, and the official Node.js 24.18.0 SQLite documentation. Restate why durable persistence precedes OL-003 and list every out-of-scope capability.

Implement only the SQLite persistence foundation described by issue #7 and the task brief. Use the built-in `node:sqlite` DatabaseSync API, explicit SQL migrations, prepared statements, explicit transactions, and SHA-256 migration checksums. Add no ORM, SQLite driver, or migration framework dependency.

The database must include a durable journal for caller-provided redacted ingress receipts, initial aggregate and event tables, append-only event enforcement, artifact reference separation, migration history, and the required constraints and cascades. Do not implement redaction, HTTP, stdin, hook forwarding, normalization, lifecycle transitions, deduplication decisions, sequence allocation, Git analysis, artifact file storage, workers, AI, or UI behavior.

Use in-memory and temporary file-backed tests. Run frozen install, format check, lint, typecheck, tests, build, and a file-backed reopen smoke test. Do not claim success for commands not executed.

Create a focused commit and draft PR from `codex/ol-005-sqlite-persistence` into `agent/ol-005-persistence-plan`. Include the required technical report and `Closes #7`.
```
