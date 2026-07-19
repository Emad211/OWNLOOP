# OL-002 Codex Task Brief

**Issue:** #4 — Define runtime contracts for ingress events  
**Base branch:** `agent/ol-002-runtime-contracts-plan`  
**Suggested work branch:** `codex/ol-002-runtime-contracts`  
**Task type:** Runtime contracts and fixture tests only

---

## 1. Objective

Convert the event-boundary decisions in ADR-0003 into executable, runtime-validated TypeScript schemas.

The task proves that OwnLoop can safely distinguish supported Claude Code hook payloads from malformed or unsupported input and can represent its internal normalized event envelope without implementing any event transport, persistence, normalization behavior, lifecycle behavior, Git analysis, AI analysis, or UI behavior.

---

## 2. Mandatory reading order

Before editing files, read:

1. `AGENTS.md`
2. this task brief
3. `docs/product/PROJECT_SCOPE.md`
4. `docs/adr/0001-human-ownership-layer.md`
5. `docs/adr/0002-local-first-claude-code-first-mvp.md`
6. `docs/adr/0003-event-schema-and-session-lifecycle.md`
7. `docs/architecture/C4.md`
8. `docs/product/BACKLOG_v0.1.0.md`
9. GitHub issue #4
10. official Claude Code hooks reference: `https://code.claude.com/docs/en/hooks`
11. Zod documentation: `https://zod.dev/`

Then restate the task boundary and the package ownership rules before modifying files.

---

## 3. Fixed technical choices

Use:

- Node.js `24.18.0`
- pnpm `11.4.0`
- TypeScript `6.0.3` in the existing strict configuration
- Zod `4.4.3`, pinned exactly
- Vitest for tests
- existing Biome configuration

Zod is the only new runtime validation dependency allowed by this task.

Do not install:

- semver packages;
- ID-generation packages;
- HTTP frameworks;
- database packages;
- JSON-schema generators;
- code-generation tools;
- alternative validation libraries.

Use a small local SemVer 2.0-compatible string schema for adapter and collector versions. Do not add a dependency solely to validate one string.

---

## 4. Package ownership

### `packages/event-model`

This package owns durable internal data contracts:

- JSON-compatible value/object schemas used by internal event payloads;
- normalized event source values;
- normalized event type values from ADR-0003;
- event sensitivity values;
- normalized event metadata;
- normalized event envelope;
- normalized event schema-version constants;
- inferred TypeScript types.

It must not import `@ownloop/contracts`.

### `packages/contracts`

This package owns external and transport-facing shapes, without implementing transport:

- supported Claude Code hook-name contract;
- common Claude hook source fields;
- event-specific source payload schemas;
- supported payload discriminated union;
- versioned adapter ingress wrapper;
- Claude source metadata contract;
- structured ingestion response contract;
- inferred TypeScript types;
- minimal parse helpers only where they improve stable error classification.

It may depend on `@ownloop/event-model` and Zod.

### `packages/test-fixtures`

This package owns plain, neutral test values:

- one valid payload fixture per supported hook;
- valid forward-compatibility fixtures with unknown fields;
- selected invalid payload fixtures;
- valid and invalid normalized-envelope fixtures;
- valid ingestion response fixtures.

It must not import Zod or contain parsing behavior.

### Applications and tool adapter

`apps/daemon`, `apps/web`, and `tools/hook-adapter` must retain their existing bootstrap behavior. Do not wire the new contracts into executable behavior merely to demonstrate imports.

---

## 5. Recommended source organization

A clear equivalent structure is acceptable, but avoid a single oversized module.

```text
packages/event-model/
├── src/
│   ├── json-value.ts
│   ├── normalized-event.ts
│   └── index.ts
└── tests/
    └── normalized-event.test.ts

packages/contracts/
├── src/
│   ├── claude-hook-common.ts
│   ├── claude-hook-payloads.ts
│   ├── ingress-wrapper.ts
│   ├── source-metadata.ts
│   ├── ingestion-response.ts
│   └── index.ts
└── tests/
    ├── claude-hook-payloads.test.ts
    ├── ingress-wrapper.test.ts
    └── ingestion-response.test.ts

packages/test-fixtures/
└── src/
    ├── claude-hook-fixtures.ts
    ├── normalized-event-fixtures.ts
    ├── ingestion-response-fixtures.ts
    └── index.ts
```

Do not create new workspace packages.

---

## 6. Runtime schema design rules

### 6.1 Source-boundary objects

Use `z.looseObject` for Claude source objects so unknown source fields are accepted and preserved.

Known required fields must still fail when:

- absent;
- null when not permitted;
- the wrong primitive/container type;
- an empty string where a source identifier is required.

### 6.2 Internal normalized objects

Use normal or strict object schemas for OwnLoop-owned normalized structures. OwnLoop controls these schemas and should not silently accept misspelled internal fields.

### 6.3 No `any`

Do not use `any`, `z.any()`, `@ts-ignore`, or disabled lint rules.

Use:

- `unknown` for intentionally opaque source values;
- a recursive JSON-compatible value schema for internal persisted payload data;
- typed loose object schemas for forward-compatible source objects.

### 6.4 Export schemas and types

For every public schema, export an inferred TypeScript type using `z.infer` or `z.input`/`z.output` where input and output differ.

Avoid separate handwritten interfaces that can drift from schemas.

### 6.5 Schema versions

Export literal constants:

- normalized event schema version `1`;
- Claude ingress contract version `1`.

The corresponding runtime fields must be literals, not arbitrary positive integers.

---

## 7. Supported Claude Code hook contracts

The v0.1 supported hook-name set is exactly:

```text
SessionStart
UserPromptSubmit
PreToolUse
PostToolUse
PostToolUseFailure
PostToolBatch
Stop
StopFailure
SessionEnd
```

Export:

- a readonly constant list;
- a Zod enum/schema;
- the inferred union type.

Do not add other currently documented Claude hook names in this issue.

### 7.1 Common fields

Required on every supported payload:

- `session_id`: non-empty string
- `transcript_path`: non-empty string
- `cwd`: non-empty string
- `hook_event_name`: the matching discriminant

Optional when supplied by Claude Code:

- `prompt_id`: UUID string
- `permission_mode`: non-empty string
- `effort`: loose object with non-empty `level`
- `agent_id`: non-empty string
- `agent_type`: non-empty string

Do not make optional common fields required merely because some official examples include them.

### 7.2 `SessionStart`

Require:

- `source`: non-empty string

Allow optional strings:

- `model`
- `agent_type`
- `session_title`

Export current known source values separately if useful, but do not reject a future non-empty source string.

### 7.3 `UserPromptSubmit`

Require:

- `prompt`: string

Do not impose a product-specific minimum prompt length.

### 7.4 `PreToolUse`

Require:

- `tool_name`: non-empty string
- `tool_input`: JSON object
- `tool_use_id`: non-empty string

Keep tool-specific input fields opaque in OL-002.

### 7.5 `PostToolUse`

Require:

- `tool_name`
- `tool_input`
- `tool_response`: JSON-compatible source value
- `tool_use_id`

Allow optional:

- `duration_ms`: finite non-negative number

### 7.6 `PostToolUseFailure`

Require:

- `tool_name`
- `tool_input`
- `tool_use_id`
- `error`: non-empty string

Allow optional:

- `is_interrupt`: boolean
- `duration_ms`: finite non-negative number

### 7.7 `PostToolBatch`

Require:

- `tool_calls`: array

Each tool-call entry requires:

- `tool_name`
- `tool_input`
- `tool_use_id`
- `tool_response`

Each entry must also be forward-compatible with unknown fields.

### 7.8 `Stop`

Require:

- `stop_hook_active`: boolean
- `last_assistant_message`: string

Allow optional:

- `background_tasks`: array of loose source objects
- `session_crons`: array of loose source objects

Do not model all background-task variants in this issue.

### 7.9 `StopFailure`

Require:

- `error`: non-empty string

Allow optional:

- `error_details`: JSON-compatible source value
- `last_assistant_message`: string

Export the currently documented error values as readonly constants, but accept future non-empty error strings.

### 7.10 `SessionEnd`

Require:

- `reason`: non-empty string

Export currently documented reasons as readonly constants:

- `clear`
- `resume`
- `logout`
- `prompt_input_exit`
- `bypass_permissions_disabled`
- `other`

Do not reject future non-empty reason strings.

---

## 8. Versioned ingress wrapper

Define a schema with:

```text
contractVersion: 1
source: "claude_code"
adapterVersion: SemVer string
receivedAt: ISO 8601 datetime with timezone
payload: supported Claude hook payload union
```

Use Zod's ISO datetime validation with timezone offsets allowed where appropriate.

This task defines data only. It must not create current timestamps or adapter versions in executable code.

---

## 9. Claude source metadata contract

Represent:

- `source`: literal `claude_code`
- `sourceSessionId`
- `sourceEventName`
- nullable/optional `sourceEventId`
- nullable/optional `promptId`
- `transcriptPath`
- `cwd`
- nullable/optional `permissionMode`
- nullable/optional `effortLevel`
- nullable/optional `agentId`
- nullable/optional `agentType`
- `adapterVersion`
- nullable/optional `sourceVersion`

This is a schema only. Do not add a function that converts hook payloads into normalized metadata; normalization belongs to OL-006.

---

## 10. Normalized event model

### 10.1 Sources

Exactly:

- `claude_code`
- `ownloop`

### 10.2 Sensitivity

Exactly:

- `public`
- `normal`
- `sensitive`
- `secret`

### 10.3 Event types

Implement the complete initial taxonomy from ADR-0003, without renaming or adding values:

```text
conversation.started
conversation.resumed
conversation.ended
run.started
run.stop_observed
run.stop_failed
run.finalization_started
run.completed
run.partial
run.abandoned
run.failed
user.prompt_submitted
agent.plan_observed
agent.summary_observed
tool.requested
tool.succeeded
tool.failed
tool.batch_completed
file.read_observed
file.write_requested
file.created
file.modified
file.deleted
file.change_observed
command.started
command.completed
command.failed
test.observed
build.observed
lint.observed
typecheck.observed
snapshot.baseline_captured
snapshot.final_captured
git.diff_computed
git.commit_observed
evidence.gap_detected
event.duplicate_ignored
event.source_unrecognized
redaction.applied
```

### 10.4 Envelope fields

Require:

- `eventId`: non-empty string
- `schemaVersion`: literal `1`
- `workspaceId`: non-empty string
- `conversationId`: non-empty string
- `runId`: non-empty string or null
- `sequence`: positive integer or null
- `type`: normalized event type
- `source`: normalized event source
- `sourceEventName`: non-empty string or null
- `sourceEventId`: non-empty string or null
- `occurredAt`: ISO datetime with timezone
- `ingestedAt`: ISO datetime with timezone
- `sensitivity`: event sensitivity
- `payload`: JSON object
- `metadata`: strict OwnLoop-owned object with:
  - `collectorVersion`: SemVer string
  - `sourceVersion`: non-empty string or null/optional

Enforce:

- `runId` and `sequence` are both non-null or both null;
- a present sequence is greater than or equal to 1;
- `ingestedAt` must not be earlier than `occurredAt` only if this can be implemented without rejecting legitimate clock-skewed source events. For OL-002, do not enforce timestamp ordering; record only syntactic validity.

---

## 11. Structured ingestion responses

Define a discriminated union.

### Accepted

```text
ok: true
status: "accepted"
receiptId: non-empty string
duplicate: boolean
```

### Rejected

```text
ok: false
status: "rejected"
error:
  code: typed error code
  message: non-empty string
  issues: optional array of stable issue summaries
```

Initial codes:

- `invalid_payload`
- `unsupported_hook`
- `persistence_failed`
- `internal_error`

A stable validation issue summary may contain:

- path segments as strings or numbers;
- a stable code string;
- a human-readable message.

Do not expose or snapshot Zod's full internal error object as the public contract.

The response schema does not prove that persistence exists. No function in OL-002 may return an accepted response after doing actual I/O.

---

## 12. Tests and fixtures

### 12.1 Valid supported hooks

Provide at least one valid fixture and a passing table-driven parse test for each of the nine supported hooks.

### 12.2 Forward compatibility

Test unknown fields at:

- common source-payload level;
- event-specific payload level;
- nested tool-call level.

Assert they do not cause validation failure.

### 12.3 Invalid inputs

Cover at least:

- missing `session_id`;
- wrong `hook_event_name` type;
- unsupported hook name;
- missing `prompt` for UserPromptSubmit;
- non-object `tool_input`;
- missing `tool_use_id`;
- negative `duration_ms`;
- invalid PostToolBatch entry;
- missing Stop fields;
- invalid adapter SemVer;
- invalid ISO datetime;
- invalid normalized event type;
- invalid sensitivity;
- `runId` without sequence;
- sequence without `runId`;
- zero or negative sequence;
- malformed accepted/rejected responses.

### 12.4 Test style

- Prefer table-driven tests.
- Assert public semantic behavior, not Zod implementation details.
- Do not snapshot full schema or error objects.
- Do not create tests that pass only by asserting exported constant names.

---

## 13. Explicitly out of scope

Do not implement or add dependencies for:

- HTTP servers or clients;
- Fastify;
- local installation tokens;
- reading stdin;
- forwarding hook payloads;
- timestamps generated at runtime;
- SQLite, Drizzle, migrations, repositories, or persistence;
- event normalization functions;
- event ID generation;
- deduplication;
- sequence allocation;
- Task Run lifecycle;
- Git status, baselines, diffs, or reconciliation;
- redaction/scanning logic;
- Claude settings files;
- AI providers or model calls;
- web UI changes;
- Ownership Moments;
- Build Replay.

Do not edit product scope or ADR content as part of the implementation PR. If a genuine contradiction is found, stop and report it.

---

## 14. Required validation

Run from repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

After modifying dependencies, first update the lockfile with the pinned package, then re-run frozen installation to prove reproducibility.

Do not claim a command passed unless it completed successfully.

---

## 15. Pull-request requirements

Create a draft PR:

```text
codex/ol-002-runtime-contracts
        ↓
agent/ol-002-runtime-contracts-plan
```

The PR body must include:

- package ownership and schema summary;
- exact Zod version;
- supported hook list;
- fixture/test matrix;
- external references consulted;
- validation commands and results;
- explicit out-of-scope confirmation;
- `Closes #4`.

---

## 16. Required final report

Report:

1. files changed;
2. every exported schema, constant, and inferred type;
3. dependency changes;
4. fixture coverage by hook;
5. invalid cases covered;
6. commands run and exact results;
7. any official Claude field intentionally represented more loosely and why;
8. known limitations;
9. explicit confirmation that no transport, persistence, normalization behavior, lifecycle behavior, Git analysis, AI, or product UI behavior was implemented.

---

## 17. Copy-paste Codex prompt

```text
Implement GitHub issue #4 (OL-002) in repository Emad211/OWNLOOP.

Base your work on branch `agent/ol-002-runtime-contracts-plan`. Use an isolated worktree and create a working branch named `codex/ol-002-runtime-contracts`.

Before changing files:

1. Read `AGENTS.md`.
2. Read `docs/tasks/OL-002_CODEX_TASK.md` completely.
3. Read the product scope, ADRs, C4 document, and backlog referenced there.
4. Read GitHub issue #4.
5. Consult the official Claude Code hook reference and Zod 4 documentation linked in the task brief.
6. Restate the package ownership rules and the explicit out-of-scope boundary.

Implement only runtime-validated contracts and fixture-based tests for OL-002.

Use Zod 4.4.3 exactly. Do not add any other runtime dependency. Keep Claude source schemas forward-compatible with unknown fields, while keeping OwnLoop-owned normalized schemas controlled. Export inferred TypeScript types from schemas rather than duplicating handwritten interfaces.

Do not implement HTTP, stdin handling, hook forwarding, persistence, SQLite, normalization behavior, lifecycle behavior, IDs, sequencing, Git analysis, redaction, AI, UI features, Ownership Moments, or Build Replay.

Run and report:

- `pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Create a focused commit and a draft PR from `codex/ol-002-runtime-contracts` into `agent/ol-002-runtime-contracts-plan`. Include `Closes #4` and the required schema/test/out-of-scope report.
```
