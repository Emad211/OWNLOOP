# ADR-0028: Codex Lifecycle-Hook Adapter and Multi-Agent Source Boundary

**Status:** Proposed  
**Date:** 2026-07-27  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0002-local-first-claude-code-first-mvp.md`
- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0025-local-settings-and-privacy-controls.md`
- ADR-0027 in GitHub PR #72
- `docs/research/codex-lifecycle-hook-integration-2026-07.md`
- GitHub Issue #75

---

## Context

OwnLoop v0.1 is Claude-Code-first, but its evidence pipeline is intentionally provider-neutral after source ingestion. The next major source expansion is Codex.

Codex now exposes an official lifecycle-hook engine through configuration layers and `hooks.json`. The current official source surface includes:

- `SessionStart`;
- `UserPromptSubmit`;
- `PreToolUse`;
- `PermissionRequest`;
- `PostToolUse`;
- `PreCompact`;
- `PostCompact`;
- `SubagentStart`;
- `SubagentStop`;
- `Stop`;
- `SessionEnd`.

These events provide stronger and more privacy-bounded integration points than reading Codex transcript or rollout files. However, hook coverage and behavior have changed across Codex versions and client surfaces. CLI, Desktop, IDE/app-server sessions, `codex exec`, and subagents must not be assumed equivalent without observed capability evidence.

OwnLoop must add Codex without weakening four accepted properties:

1. the adapter remains outside the coding agent's critical path;
2. source events do not become evidence merely because Codex emitted them;
3. Git reconciliation remains authoritative for repository changes;
4. user trust, permissions, and agent policy stay external to OwnLoop.

## Decision

OwnLoop will add a dedicated fail-open Codex lifecycle-hook adapter and extend the normalized source boundary from Claude-only to explicit multi-agent source identity.

```text
Codex hooks.json command events
→ dedicated silent Codex adapter
→ existing authenticated loopback ingress
→ source-specific strict validation and redaction
→ provider-neutral normalized events
→ existing Task Run, Git, Evidence, Replay, and Ownership pipeline
```

The adapter is observational only. It never blocks a tool, changes input, grants permission, injects context, or returns policy output to Codex.

## Source hierarchy

### Primary source: lifecycle hooks

User-level Codex lifecycle command hooks are the primary integration. OwnLoop installs exact handlers into the current user's Codex `hooks.json` only after OL-025 installation primitives are merged.

### Limited fallback: legacy notify

The legacy `notify` command may be supported as a bounded completion signal for `agent-turn-complete` when lifecycle hooks are unavailable. Notify cannot establish tool activity, file mutation, verification, permission outcome, or complete capture.

### Rejected source: transcript and rollout scraping

OwnLoop will not read Codex transcript paths or rollout/session JSONL in OL-027.

Reasons:

- files can contain complete prompts, model output, tool input/output, and source content;
- persistence and extended-history coverage differ by Codex mode and client;
- files are an implementation detail rather than the lifecycle-hook contract;
- missing or malformed history must not become silent evidence gaps with ambiguous authority;
- reading them would expand retention and privacy boundaries substantially.

An explicit later ADR is required before any transcript or rollout integration.

## Adapter isolation

Add a dedicated workspace:

```text
tools/codex-hook-adapter/
```

The Claude adapter remains source-specific. Shared delivery primitives may be extracted only when their contracts are genuinely identical.

The Codex adapter:

- reads one bounded JSON object from stdin;
- accepts only the 11 supported event names;
- validates event-specific fields;
- ignores bounded unknown upstream fields without persisting them wholesale;
- adds adapter version and receipt metadata;
- applies accepted secret-field redaction before delivery;
- uses one short delivery attempt and no retry;
- produces no ordinary stdout or stderr;
- exits successfully for success, malformed input, unknown event, daemon unavailable, invalid runtime state, timeout, and delivery failure;
- never reads `transcript_path`;
- never writes hook response JSON;
- never places installation credentials in argv.

## Hook control neutrality

Codex `PreToolUse` and `PermissionRequest` can influence execution. OwnLoop intentionally does not use those control capabilities.

The adapter must not emit:

- permission decisions;
- blocking reasons;
- updated tool input;
- additional model context;
- system messages;
- policy instructions;
- non-zero control exit codes.

`PreToolUse` records intent only. `PermissionRequest` records that Codex requested a decision only. Neither proves execution, approval, safety, understanding, or user authorship.

## Event mapping

### SessionStart

Creates or resumes a source conversation according to the explicit Codex source value (`startup`, `resume`, `clear`, or `compact`). A compact-source start does not create a new user task by itself.

### UserPromptSubmit

Creates one sequential Task Run for the associated session, turn, and agent context. Duplicate delivery is idempotent.

Prompt text remains sensitivity-aware and bounded. It is not automatically provider input.

### PreToolUse

Records a source-reported tool intention correlated by `tool_use_id`. It is not proof that the tool ran.

### PermissionRequest

Records a request for human or policy permission. It is not a recorded answer unless the official payload explicitly contains an observed decision in a later supported contract.

### PostToolUse

Records source-reported tool completion and bounded result metadata. It can support chronology and attribution but does not supersede Git reconciliation or deterministic verification.

Missing `PostToolUse` creates a controlled coverage gap; it never proves failure or non-execution.

### PreCompact and PostCompact

Record context-compaction lifecycle facts. They do not imply code change, verification, understanding, or terminal state.

### SubagentStart and SubagentStop

Create explicit source lineage. Main-agent and subagent events remain distinguishable through agent ID/type and cannot silently collapse into one Task Run.

### Stop

Marks the source turn as ready for OwnLoop finalization processing. Stop is an observed lifecycle signal, not proof that every tool result was captured.

### SessionEnd

Closes the source conversation using the explicit Codex reason where available.

## Source identity and idempotency

Normalized source metadata will distinguish at least:

- source agent family (`claude_code` or `codex`);
- adapter name and version;
- source event name;
- Codex session ID;
- Codex turn ID where present;
- tool-use ID where present;
- subagent ID/type where present;
- source lifecycle discriminator such as start source, compact trigger, or end reason;
- observed source/capability version facts.

Deduplication keys are event-specific. No generic payload-only key may merge distinct turns, tools, or subagents.

Unknown upstream fields are discarded after bounded parsing. They do not enter SQLite as raw JSON merely for future compatibility.

## Capability model

OwnLoop will not maintain a single boolean called "Codex supported." Status must represent observed capability.

Minimum states:

- `not_installed`;
- `installed_unverified`;
- `needs_trust`;
- `enabled_no_events_seen`;
- `active`;
- `partial_surface`;
- `repair_needed`;
- `unsupported`.

Capability facts may include:

- Codex version;
- hooks feature available/enabled/explicitly disabled;
- exact OwnLoop handlers present;
- exact handlers trusted when Codex exposes that fact;
- event names observed in the current process lifetime;
- last controlled successful delivery timestamp;
- source surface only when explicitly known;
- controlled missing-event limitations.

Zero observed events is never proof that no Codex activity occurred.

## Hook trust

Codex owns hook trust. OwnLoop does not write or forge trusted hashes, bypass user review, or modify managed policy.

Installation may create exact OwnLoop entries and report `needs_trust`. Documentation and CLI may direct the user to approve them in Codex.

Managed-only policy, disabled hooks, ambiguous user configuration, or unknown trust state fail closed for installation claims but do not block Codex itself.

## Configuration installation

After OL-025 merges, the Windows installer adds:

```text
%LOCALAPPDATA%\OwnLoop\bin\ownloop-codex-hook.cmd
%LOCALAPPDATA%\OwnLoop\app\<version>\codex-hook-adapter\...
```

The target is only the current user's:

```text
%USERPROFILE%\.codex\hooks.json
```

Requirements:

- bounded JSON and duplicate-key rejection;
- preserve all non-OwnLoop entries and unknown top-level keys;
- one exact OwnLoop handler per supported event;
- stable launcher path, with `commandWindows` when required;
- no token, port, HMAC key, project path, or versioned app path in Codex config;
- backup before mutation;
- temporary file plus atomic replace;
- idempotent install and repair;
- ambiguous modified OwnLoop entries are never overwritten or removed silently;
- removal deletes only exact entries recorded by the current installation;
- project-local, managed, and policy hooks are untouched;
- Codex trust state is untouched.

## Coverage and evidence gaps

Codex lifecycle-hook availability can vary by version, client surface, and tool handler. OwnLoop will model this explicitly.

Examples:

- a tool has `PreToolUse` but no `PostToolUse`;
- Desktop or IDE does not execute user hooks in a particular version;
- hooks are installed but awaiting trust;
- apply-patch coverage exists while another internal tool lacks hooks;
- subagent events are observed but main/subagent distinction is incomplete in an older version.

Such states create controlled source-coverage limitations. OwnLoop must not infer missing activity.

Git baseline/final reconciliation remains the authority for actual repository change. Verification evidence remains deterministic and independent of source hook completeness.

## Privacy

The Codex adapter does not read:

- transcript files;
- rollout/session history;
- Codex authentication state;
- OpenAI API keys;
- arbitrary environment variables;
- unrelated Codex configuration.

No source payload is uploaded to a provider merely because it originated from Codex.

Diagnostics exclude prompt text, tool input/output, transcript path, repository path, session/tool IDs, credentials, exceptions, and stacks unless an already accepted bounded diagnostic contract explicitly permits a controlled identifier.

## Packaging

The OL-025 deterministic Windows package will add the Codex adapter and launcher. Package verification remains:

- symlink-free;
- traversal-safe;
- canonical and byte-reproducible;
- free of developer paths and generated package-manager metadata;
- free of credentials, runtime state, Codex config, transcripts, and session history.

## Consequences

### Positive

- OwnLoop becomes explicitly multi-agent without duplicating the evidence pipeline;
- Codex capture uses an official lifecycle contract rather than log scraping;
- permission, compaction, and subagent facts become observable without control authority;
- source coverage gaps remain honest and diagnosable;
- Claude Code behavior remains isolated and regression-testable.

### Negative

- Codex hook support varies across releases and clients;
- user trust may require a manual Codex action;
- 11 event types materially increase contracts and fixtures;
- installer must safely merge a second external configuration format;
- absence of transcript reading limits recovery when hooks were not active;
- capability status is more complex than an installed/not-installed boolean.

## Alternatives rejected

### Reuse only legacy notify

Rejected because turn completion cannot reconstruct tool chronology, permission requests, subagents, or context compaction.

### Scrape rollout JSONL

Rejected because it is privacy-heavy, implementation-specific, and mode-dependent.

### Proxy or launch every Codex session through OwnLoop

Rejected for OL-027 because it would place OwnLoop in the agent execution path and exclude ordinary Desktop/IDE use.

### Add blocking guardrails

Rejected because OwnLoop is an ownership/evidence layer, not a policy enforcement product in this release.

### Merge Claude and Codex payloads into one permissive source schema

Rejected because source-specific validity and semantics would be lost.

## Validation

This decision is accepted when Issue #75's source-contract, adapter, normalization, idempotency, subagent, permission, compaction, trust, installation, launcher, package, Windows smoke, real-Codex capture, Git reconciliation, privacy, Claude-regression, and full repository tests pass.

## Reversibility

Transcript/rollout ingestion, app-server ownership, blocking hooks, managed enterprise hooks, project-local installation, macOS/Linux packaging, or automatic trust changes require later ADRs.