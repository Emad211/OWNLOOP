# OwnLoop v0.1.0 — Dependency-Ordered Backlog

**Status:** Proposed  
**Release type:** Local technical prototype  
**Team size:** One developer  
**Primary integration:** Claude Code  
**Primary stack:** TypeScript, Node.js, React, SQLite

---

## 1. Release objective

Deliver a local prototype that can capture one real Claude Code Task Run, persist a trustworthy event history, reconstruct the baseline-to-final Git change, render a deterministic raw replay, and then generate a small number of evidence-backed Ownership Moments.

The release is not complete merely because it displays AI-generated summaries. Reliable capture and evidence validation are mandatory.

---

## 2. Delivery strategy

The backlog follows strict vertical dependency order:

```text
Project bootstrap
→ Hook ingestion
→ Event persistence
→ Task Run lifecycle
→ Git reconciliation
→ Raw replay
→ Deterministic evidence
→ AI candidate generation
→ Evidence validation
→ Ownership interaction
→ Privacy and hardening
```

Work from a later stage must not begin when its required earlier stage remains unreliable.

---

## 3. Priority definitions

- **P0:** Required for the first trustworthy capture-and-replay vertical slice.
- **P1:** Required for the OwnLoop v0.1.0 product experience.
- **P2:** Useful after v0.1.0 reliability is established.

## 4. Size definitions

Sizes are relative complexity, not delivery promises:

- **XS:** isolated change with low uncertainty;
- **S:** small feature or adapter with known approach;
- **M:** multi-module feature with meaningful tests;
- **L:** broad feature or high uncertainty; should normally be split before implementation.

No backlog item may remain `L` when implementation begins.

---

# Milestone A — Trustworthy capture vertical slice

## OL-001 — Bootstrap TypeScript monorepo

**Priority:** P0  
**Size:** S  
**Depends on:** none

### Scope

Create a minimal workspace containing:

```text
apps/
├── daemon/
└── web/
packages/
├── contracts/
├── event-model/
└── test-fixtures/
tools/
└── hook-adapter/
```

### Acceptance criteria

- Node.js and package-manager versions are pinned.
- TypeScript strict mode is enabled.
- Formatting, linting, unit tests, and type checking have root commands.
- The daemon and web app can start independently.
- Shared packages are imported through workspace references.
- CI runs install, lint, typecheck, and tests.
- No production framework beyond the accepted scope is introduced.

---

## OL-002 — Define runtime contracts for ingress events

**Priority:** P0  
**Size:** S  
**Depends on:** OL-001

### Scope

Implement runtime-validated TypeScript contracts for:

- Claude hook ingress payload wrapper;
- normalized event envelope;
- supported source hook names;
- source metadata;
- event sensitivity;
- structured ingestion response.

### Acceptance criteria

- Runtime validation rejects malformed payloads.
- Unknown source fields do not fail ingestion.
- Contract tests cover valid and invalid fixtures.
- Normalized event types match ADR-0003.
- Contracts contain no business logic for moment generation.

---

## OL-003 — Implement loopback ingestion API

**Priority:** P0  
**Size:** M  
**Depends on:** OL-002

### Scope

Create a Fastify-based local daemon endpoint for hook delivery.

### Acceptance criteria

- Server binds to loopback only.
- Requests require a generated local installation token.
- Request size and timeout limits are configured.
- A valid payload is acknowledged only after durable persistence.
- Malformed payloads return a structured error.
- Logs contain event identifiers but not raw code or prompt content.
- Integration tests send real fixture payloads over HTTP.

---

## OL-004 — Implement fail-open Claude Code Hook Adapter

**Priority:** P0  
**Size:** M  
**Depends on:** OL-002, OL-003

### Scope

Build a small CLI that receives Claude Code hook JSON on stdin and forwards it to the local daemon.

Initially support:

- `SessionStart`;
- `UserPromptSubmit`;
- `PreToolUse`;
- `PostToolUse`;
- `PostToolUseFailure`;
- `PostToolBatch`;
- `Stop`;
- `StopFailure`;
- `SessionEnd`.

### Acceptance criteria

- Reads one JSON payload from stdin.
- Adds adapter version and receipt metadata.
- Removes configured secret fields before delivery.
- Uses a strict delivery timeout.
- Collector unavailability does not block Claude Code.
- Exit behavior is documented and integration-tested.
- A sample `.claude/settings.json` configuration is provided.
- Unsupported hook payloads are diagnosed without crashing.

---

## OL-005 — Implement SQLite schema and migrations

**Priority:** P0  
**Size:** M  
**Depends on:** OL-001, OL-002

### Scope

Create initial persistence for:

- workspaces;
- agent conversations;
- task runs;
- events;
- deduplication keys;
- evidence gaps;
- artifacts metadata;
- analysis jobs;
- schema migrations.

### Acceptance criteria

- Migrations work on a new database.
- `(run_id, sequence)` is unique.
- source deduplication keys are enforced.
- event rows cannot be updated through the repository interface.
- full Task Run deletion is possible.
- migration and repository tests run against a temporary database.

---

## OL-006 — Implement event normalization, idempotency, and sequencing

**Priority:** P0  
**Size:** M  
**Depends on:** OL-003, OL-005

### Scope

Convert supported hook payloads into normalized append-only events.

### Acceptance criteria

- Duplicate hook delivery creates one normal event.
- Sequence assignment is transactional per Task Run.
- source session and tool-use identifiers are preserved.
- source and ingestion timestamps are stored separately.
- unknown payload fields are ignored safely.
- each supported hook has fixture-based normalization tests.

---

## OL-007 — Implement Workspace, Conversation, and Task Run lifecycle

**Priority:** P0  
**Size:** M  
**Depends on:** OL-006

### Scope

Implement ADR-0003 aggregate creation and state transitions.

### Acceptance criteria

- `SessionStart` creates or resumes an Agent Conversation.
- `UserPromptSubmit` creates a sequential Task Run.
- `Stop` and `StopFailure` enter Finalizing.
- `SessionEnd` closes the conversation.
- invalid state transitions are rejected and diagnosed.
- stale runs are discovered after daemon restart.
- lifecycle tests cover Completed, Partial, Abandoned, and Failed outcomes.

---

## OL-008 — Capture Git baseline with dirty-working-tree support

**Priority:** P0  
**Size:** M  
**Depends on:** OL-007

### Scope

Capture the repository state when a Task Run starts.

### Acceptance criteria

- Detect repository root and canonical path.
- Capture HEAD commit when present.
- Fingerprint staged and unstaged diffs.
- Inventory untracked files subject to size and sensitivity rules.
- Do not require a clean working tree.
- Mark the run Partial when a reliable baseline cannot be captured.
- Tests cover clean, dirty, untracked, unborn branch, and non-Git paths.

---

## OL-009 — Reconcile repository state and compute final run diff

**Priority:** P0  
**Size:** M  
**Depends on:** OL-007, OL-008

### Scope

Reconcile actual repository state after relevant tool batches and at finalization.

### Acceptance criteria

- Created, modified, deleted, and binary paths are detected.
- Pre-existing baseline changes are not silently attributed to the run.
- Final baseline-to-run diff is reproducible.
- Large diffs use artifact references and size limits.
- reconciliation links derived file facts to triggering tool batches when possible.
- command-generated changes are detected even without direct Edit or Write tools.
- tests cover direct edits and indirect generator commands.

---

## OL-010 — Implement content-addressed artifact store

**Priority:** P0  
**Size:** S  
**Depends on:** OL-005

### Scope

Store large immutable redacted content outside SQLite rows.

### Acceptance criteria

- Artifacts are addressed by cryptographic digest.
- Duplicate content is stored once.
- Artifact paths stay outside analyzed repositories.
- reference metadata is stored transactionally.
- unreferenced artifacts can be garbage-collected.
- deletion tests confirm no cross-run artifact loss.

---

## OL-011 — Implement run finalization and crash recovery

**Priority:** P0  
**Size:** M  
**Depends on:** OL-007, OL-008, OL-009, OL-010

### Scope

Finalize runs deterministically and recover stale runs after daemon restart.

### Acceptance criteria

- Finalization captures final Git state and diff.
- Missing boundaries create structured evidence gaps.
- stale Capturing or Finalizing runs are recovered as Partial or Abandoned.
- recovery never resumes Claude Code automatically.
- finalization is idempotent.
- daemon restart tests preserve event and run integrity.

---

## OL-012 — Render deterministic raw Task Run replay

**Priority:** P0  
**Size:** M  
**Depends on:** OL-011

### Scope

Build the first local UI and API projection without AI summaries.

### UI content

- prompt;
- lifecycle status;
- normalized timeline;
- tools and commands;
- changed files;
- final diff;
- tests and builds observed;
- evidence gaps;
- completeness status.

### Acceptance criteria

- A captured run is visible in the browser.
- Timeline order distinguishes storage order from causal links.
- Evidence gaps are visible and cannot be mistaken for success.
- Diff and large artifacts load from references.
- Page refresh and daemon restart preserve the replay.
- no external AI provider is required.

### Milestone A exit gate

Do not proceed to Milestone B until at least five controlled Claude Code Task Runs can be captured and replayed with no unexplained changed files in the test fixtures.

---

# Milestone B — Evidence foundation

## OL-013 — Build deterministic file and change classifiers

**Priority:** P1  
**Size:** M  
**Depends on:** OL-012

### Scope

Create initial multi-label classification for:

- UI;
- behavior;
- tests;
- dependency;
- authentication and authorization;
- public API;
- database and migration;
- configuration and infrastructure;
- documentation;
- unknown.

### Acceptance criteria

- Path and structured-file rules run without AI.
- Classifier emits evidence and confidence.
- Unknown remains an allowed result.
- Fixtures cover common Node.js and TypeScript project layouts.
- classification output is versioned and reproducible.

---

## OL-014 — Extract verification evidence from commands and files

**Priority:** P1  
**Size:** M  
**Depends on:** OL-012, OL-013

### Scope

Recognize common Node.js test, lint, typecheck, and build observations.

### Acceptance criteria

- Detect common package-manager test, lint, typecheck, and build commands.
- Retain exit status and reduced output evidence.
- Do not infer success when no execution was observed.
- mark ambiguous custom commands as unknown.
- identify test-file changes separately from test execution.

---

## OL-015 — Create evidence graph and evidence references

**Priority:** P1  
**Size:** M  
**Depends on:** OL-013, OL-014

### Scope

Connect Task Run facts to files, diff hunks, commands, and verification results.

### Acceptance criteria

- Evidence has a stable identifier.
- Every evidence reference resolves locally.
- Evidence records retain analyzer and schema version.
- unsupported absence claims are not represented as facts.
- the UI can navigate from a fact to source evidence.

---

# Milestone C — Ownership Moment pipeline

## OL-016 — Define structured candidate-moment contract

**Priority:** P1  
**Size:** S  
**Depends on:** OL-015

### Scope

Define runtime schemas for Change, Decision, Risk, and Check candidates.

### Acceptance criteria

- Every factual claim requires evidence references.
- candidate type, title, claim, importance, confidence, and suggested interaction are structured.
- malformed model output is rejected.
- the contract contains no raw HTML or executable content.

---

## OL-017 — Implement reduced and redacted semantic-analysis input

**Priority:** P1  
**Size:** M  
**Depends on:** OL-015, OL-016

### Scope

Create the minimal context package sent to a configured AI provider.

### Acceptance criteria

- Full repository and transcript are never sent.
- secret files and secret-like values are excluded.
- included excerpts link to local evidence IDs.
- request size and cost estimates are recorded.
- semantic analysis can be disabled entirely.
- golden tests verify redaction.

---

## OL-018 — Implement provider abstraction and candidate generation

**Priority:** P1  
**Size:** M  
**Depends on:** OL-016, OL-017

### Scope

Add one initial AI provider behind a typed abstraction using BYOK.

### Acceptance criteria

- Provider credentials are not stored in ordinary application logs.
- Structured output is runtime-validated.
- retries are bounded.
- provider failure does not affect raw replay.
- generated candidates retain model, prompt-template, and generator versions.
- maximum model calls per run are configurable.

---

## OL-019 — Validate, deduplicate, and rank moment candidates

**Priority:** P1  
**Size:** M  
**Depends on:** OL-015, OL-018

### Scope

Reject unsupported candidates and enforce a finite experience.

### Acceptance criteria

- missing evidence rejects the candidate.
- deterministic contradiction rejects the candidate.
- duplicate claims are grouped or removed.
- unsupported absence claims are rejected.
- validated moments are ranked by importance and attention cost.
- maximum displayed moments per run is seven.
- zero moments is a valid outcome.
- every rejection stores a machine-readable reason.

---

## OL-020 — Render Ownership Moments and evidence navigation

**Priority:** P1  
**Size:** M  
**Depends on:** OL-019

### Scope

Display the four moment types in the local UI.

### Acceptance criteria

- Moments are finite and ordered.
- Every factual claim has visible evidence access.
- Check answers can be selected.
- users can mark a moment useful or not useful.
- explanations distinguish fact from inference.
- keyboard navigation and basic accessibility are supported.

---

## OL-021 — Persist user interactions and ownership records

**Priority:** P1  
**Size:** S  
**Depends on:** OL-020

### Scope

Persist moment views, evidence views, answers, acknowledgements, and decision responses.

### Acceptance criteria

- interactions are timestamped and tied to user, run, and moment.
- repeated views do not overwrite history.
- ownership records avoid claiming formal comprehension.
- the user can delete interaction history with the run.

---

## OL-022 — Produce enriched Build Replay

**Priority:** P1  
**Size:** M  
**Depends on:** OL-019, OL-021

### Scope

Combine deterministic run data and validated moments into a finite end-of-task replay.

### Acceptance criteria

- Original goal and completion status are visible.
- important changed files, decisions, risks, tests, and evidence gaps are included.
- reviewed and unreviewed moments are distinguished.
- Partial runs clearly communicate limitations.
- replay regeneration is deterministic for the same generator versions.

---

# Milestone D — Privacy, diagnostics, and release hardening

## OL-023 — Implement local settings and privacy controls

**Priority:** P1  
**Size:** M  
**Depends on:** OL-012, OL-018

### Acceptance criteria

- External AI is disabled until configured.
- user can select retention and diagnostic options.
- full Task Run deletion works from the UI.
- secret patterns can be extended locally.
- raw hook payload retention remains off by default.

---

## OL-024 — Add diagnostics and evidence-quality dashboard

**Priority:** P1  
**Size:** S  
**Depends on:** OL-011, OL-019

### Acceptance criteria

- display hook counts, malformed payloads, duplicates, redactions, evidence gaps, and finalization status.
- diagnostics contain no raw code or prompt text by default.
- developer can export a sanitized diagnostic bundle.

---

## OL-025 — Package local installation and Claude hook setup

**Priority:** P1  
**Size:** M  
**Depends on:** all P0 items, OL-023

### Acceptance criteria

- one documented installation path exists for the founder's target operating system.
- daemon start and stop behavior is defined.
- hook configuration can be installed and removed safely.
- uninstall preserves or explicitly removes user data by choice.
- version compatibility is checked at startup.

---

## OL-026 — Create end-to-end acceptance suite

**Priority:** P1  
**Size:** M  
**Depends on:** OL-025

### Scenarios

- direct file edit;
- command-generated file changes;
- dirty working tree;
- failed tool call;
- failed test;
- daemon unavailable during one hook;
- duplicate hook delivery;
- daemon restart during active run;
- secret-containing file event;
- run producing zero valid moments.

### Acceptance criteria

- tests run from fixtures without external model calls where possible.
- provider-dependent tests use recorded structured responses.
- acceptance suite verifies the ten technical criteria in PROJECT_SCOPE.

---

## 5. v0.1.0 definition of done

OwnLoop v0.1.0 is done when:

1. All P0 and P1 backlog items are complete or explicitly removed through a scope change.
2. Five controlled real Claude Code Task Runs replay correctly.
3. Changed-file detection meets the controlled-test target in PROJECT_SCOPE.
4. Raw replay functions with external AI disabled.
5. Every displayed moment resolves to evidence.
6. Unsupported candidate moments are rejected and diagnosable.
7. A run can be deleted completely.
8. Daemon or provider failure does not stop Claude Code.
9. Installation and removal are documented for the supported environment.
10. Known limitations are documented in the release notes.

---

## 6. Immediate implementation order

The next coding work must follow this order:

```text
OL-001 Bootstrap
OL-002 Contracts
OL-005 Database
OL-003 Ingestion API
OL-004 Hook Adapter
OL-006 Normalization
OL-007 Lifecycle
OL-008 Baseline
OL-009 Reconciliation
OL-010 Artifacts
OL-011 Finalization
OL-012 Raw Replay
```

The first implementation Pull Request should include only **OL-001** and the minimal repository documentation needed to run the checks. It must not include Claude integration, AI calls, or product UI behavior.
