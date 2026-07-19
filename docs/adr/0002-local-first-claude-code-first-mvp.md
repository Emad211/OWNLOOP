# ADR-0002: Use a Local-First, Claude-Code-First, Event-Driven MVP

**Status:** Proposed  
**Date:** 2026-07-19  
**Decision owner:** Project founder  
**Related documents:**

- `docs/product/PROJECT_SCOPE.md`
- `docs/adr/0001-human-ownership-layer.md`

---

## Context

OwnLoop needs verifiable data from real coding-agent sessions, including the task, agent activity, file changes, commands, Git diff, and test results.

The initial implementation must respect the following constraints:

- the development team consists of one person;
- private repositories may be analyzed;
- OwnLoop must not interrupt or break the coding agent;
- the MVP must avoid maintaining multiple agent integrations;
- infrastructure and operational overhead must remain low;
- stored data must be replayable and debuggable;
- the initial product must be useful without a cloud account.

---

## Decision

OwnLoop v0.1 will use a local-first, event-driven architecture with Claude Code as the first and only coding-agent adapter.

```text
Claude Code hooks
        ↓
Local event collector
        ↓
Append-only event store
        ↓
Deterministic analyzers
        ↓
AI candidate-moment generator
        ↓
Evidence validator and ranker
        ↓
Local web interface
```

### Initial platform choices

- Primary implementation language: TypeScript
- Runtime: Node.js
- First coding-agent adapter: Claude Code
- Initial project languages: JavaScript and TypeScript
- User interface: React local web application
- Local HTTP API: Fastify or an equivalent lightweight server
- Local database: SQLite
- Database access: a lightweight typed layer such as Drizzle ORM
- Git integration: Git command-line interface
- TypeScript analysis: TypeScript Compiler API or `ts-morph`
- AI integration: provider abstraction using a user-provided API key
- Source repository permissions: read-only

Specific libraries may change without a new ADR if the architectural constraints in this record remain unchanged.

---

## Why Claude Code first

Claude Code is selected because:

- it works directly with local repositories;
- lifecycle hooks can expose useful events;
- the first prototype does not require building a full IDE extension;
- the adapter can remain separate from the internal event model;
- it supports realistic terminal-based development workflows.

Codex, Cursor, and other coding-agent integrations will not be implemented until the internal event and evidence models are stable.

---

## Why local-first

Local-first processing is selected to:

- reduce concerns about private source code;
- avoid early backend, account, and DevOps work;
- simplify access to Git and repository files;
- make debugging and event inspection easier;
- allow complete local deletion;
- reduce operating cost for a one-person team.

Cloud synchronization and team workspaces are not part of v0.1.

---

## Why a local web application

The following alternatives were considered:

- VS Code extension;
- Electron application;
- native desktop application;
- hosted web application;
- local browser-based application.

A local web application is selected because it:

- is faster to build and debug;
- avoids early editor-extension constraints;
- allows standard React development;
- remains independent of a single IDE;
- can later be embedded in an extension or desktop shell;
- can run beside the developer's existing tools.

A small IDE extension may be added later for navigation and notifications only.

---

## Event-driven model

Source data is stored as immutable, append-only events.

Initial event families include:

```text
session.started
session.completed
session.failed
task.received
agent.plan_observed
tool.requested
tool.completed
file.read
file.created
file.modified
file.deleted
command.started
command.completed
test.completed
build.completed
```

A normalized event contains at least:

```json
{
  "eventId": "evt_001",
  "sessionId": "ses_001",
  "type": "file.modified",
  "occurredAt": "2026-07-19T12:00:00Z",
  "source": "claude_code",
  "schemaVersion": 1,
  "payload": {}
}
```

The exact schema and session-state machine are defined separately in ADR-0003.

---

## Why append-only storage

Append-only source events provide:

- session replay;
- regeneration of moments after analyzer changes;
- easier debugging;
- preservation of event order;
- separation of source facts from derived interpretations;
- future auditability.

Derived records such as candidate moments, validated moments, rankings, and summaries may be deleted and regenerated.

Source events are not edited after ingestion except for explicit redaction, data migration, or complete user-requested deletion.

---

## Analysis strategy

### Layer 1: deterministic analysis

This layer derives verifiable facts, including:

- changed files and diff size;
- test and build outcomes;
- dependency changes;
- migrations;
- public API routes or contracts;
- authentication-related files;
- configuration changes;
- evidence references.

### Layer 2: AI semantic analysis

This layer may:

- group related events;
- explain a conceptual change;
- propose candidate Ownership Moments;
- identify a possible implementation decision;
- generate a project-specific understanding check;
- suggest importance and difficulty.

AI output is treated as a proposal rather than a source of truth.

---

## Evidence-first rule

A candidate Ownership Moment must reference evidence.

```json
{
  "momentId": "mom_001",
  "sessionId": "ses_001",
  "type": "risk",
  "title": "Server-side validation was not added",
  "claim": "Email validation exists only in the client change.",
  "evidenceRefs": ["evd_001", "evd_002"],
  "confidence": 0.88,
  "status": "candidate"
}
```

A moment may be displayed only after validation confirms that:

1. referenced evidence exists;
2. the evidence belongs to the same session;
3. the claim does not contradict deterministic facts;
4. the confidence and importance thresholds are met;
5. the moment is not a duplicate;
6. the session moment limit is not exceeded.

---

## Failure isolation

OwnLoop is an observer in v0.1 and must remain outside the coding agent's critical path.

Failures in the collector, database, analyzer, AI provider, or UI must not stop the Claude Code process.

When possible, hook delivery should use short timeouts, local buffering, and fail-open behavior.

---

## Data privacy

By default:

- events are stored locally;
- the full repository is not sent to an external provider;
- only necessary, reduced, and redacted content may be sent to a model;
- known secret files and values are excluded;
- a session can be deleted completely;
- model credentials belong to the user.

---

## Alternatives considered

### Cloud-first SaaS

Rejected for v0.1 because it introduces authentication, backend operations, hosting cost, privacy concerns, and compliance work before product value is proven.

### VS Code extension as the complete application

Rejected for the prototype because it increases extension-specific development and debugging complexity and couples the product to one editor.

### Python backend

Rejected because a TypeScript-only stack reduces cognitive and maintenance overhead, aligns with the first target projects, and provides direct access to the TypeScript analysis ecosystem.

### Electron desktop application

Rejected because packaging, distribution, updating, and desktop-specific maintenance are unnecessary for the first prototype.

### Multiple coding-agent adapters

Rejected because every agent has a different event lifecycle and the internal model must stabilize before adapter expansion.

---

## Consequences

### Positive

- Suitable scope for a one-person team.
- Private source data remains local by default.
- Sessions are replayable and reprocessable.
- Agent-specific details are isolated behind an adapter.
- Deterministic facts and AI interpretation are separated.
- The UI remains independent from the coding agent and editor.

### Negative

- A local daemon creates installation friction.
- The first interface may feel less integrated than an IDE extension.
- Team features will require future cloud or network architecture.
- Initial language and agent support is narrow.
- Claude Code hook behavior may change.
- BYOK adds onboarding friction.

---

## Reversibility

The local API may later be embedded in a desktop shell or IDE extension. Event synchronization may later be added with user consent, and SQLite may be complemented by a team backend.

The event-driven, evidence-first, and non-blocking observer principles remain binding until superseded by a future ADR.
