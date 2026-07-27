# ADR-0029: Provider-Neutral Codex Event Taxonomy

**Status:** Proposed  
**Date:** 2026-07-27  
**Decision owner:** Project founder  
**Related:** ADR-0003, ADR-0009, ADR-0028, Issue #75

## Context

ADR-0028 accepts Codex lifecycle hooks as a second source, but the existing normalized Event taxonomy has no controlled names for permission requests, context compaction, or subagent lineage. Reusing tool or terminal Event types would overstate what Codex observed. Persisting source Hook names directly as internal types would make downstream evidence and replay source-specific.

## Decision

OwnLoop adds exactly five normalized source-fact types:

- `permission.requested` for an observed Codex `PermissionRequest`;
- `context.compaction_started` for `PreCompact`;
- `context.compaction_completed` for `PostCompact`;
- `agent.subagent_started` for `SubagentStart`;
- `agent.subagent_stopped` for `SubagentStop`.

The normalized Event envelope remains schema version 1 because its structure and invariants do not change. SQLite migration v20 rebuilds only the append-only `events` table constraint and preserves all existing rows, references, indexes, triggers, source values, and sequence semantics.

## Lifecycle semantics

These five Hook families require an active Task Run and receive the existing `run_associated` lifecycle resolution. They do not:

- create a Task Run;
- transition a Run to Finalizing or terminal state;
- record a permission answer;
- prove tool execution;
- prove code change or verification;
- create an independent subagent Task Run.

Subagent lineage remains explicit because normalized source Events retain bounded `agent_id` and `agent_type` fields and use distinct start/stop Event types. Association with the parent Run provides chronology without silently converting a subagent observation into main-agent activity.

## Source payload and sensitivity

- `permission.requested` is sensitive because it can contain bounded tool input.
- compaction facts are normal and retain only controlled trigger, turn, model, source-surface, source-version, and optional agent metadata.
- `agent.subagent_started` is normal.
- `agent.subagent_stopped` is sensitive because it can contain a bounded final assistant message.

Provider proposal text, source Hook delivery, permission requests, and subagent messages remain observations only. Git reconciliation and deterministic verification remain authoritative for repository changes and checks.

## Consequences

The downstream pipeline can represent all accepted Codex Hook families without overloading tool, verification, or terminal semantics. Claude Code mappings remain unchanged. Missing paired events remain coverage limitations, not inferred failures or negative facts.
