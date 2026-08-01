# Codex Lifecycle-Hook Integration Research — July 2026

**Status:** Research baseline for OL-027  
**Pinned upstream source:** `openai/codex@0896bf6fc05ead454888b90044e1a08f99b6d778`  
**Research date:** 2026-07-27  
**OwnLoop issue:** #75

## Purpose

This note records the official Codex integration surface used to design OwnLoop's first Codex adapter. It separates confirmed upstream contracts from observed compatibility risks and OwnLoop design inferences.

The research uses official OpenAI documentation and the official `openai/codex` repository. Community proposals are not treated as contracts.

## Confirmed official surface

### Hook event names

At the pinned source revision, Codex's public hook event union contains 11 events:

| Codex config name | App-server protocol name | Matcher meaning |
| --- | --- | --- |
| `PreToolUse` | `preToolUse` | canonical tool name and aliases |
| `PermissionRequest` | `permissionRequest` | canonical tool name and aliases |
| `PostToolUse` | `postToolUse` | canonical tool name and aliases |
| `PreCompact` | `preCompact` | compact trigger |
| `PostCompact` | `postCompact` | compact trigger |
| `SessionStart` | `sessionStart` | `startup`, `resume`, `clear`, `compact` |
| `SessionEnd` | `sessionEnd` | session-end reason |
| `UserPromptSubmit` | `userPromptSubmit` | matcher ignored |
| `SubagentStart` | `subagentStart` | agent type/source discriminator |
| `SubagentStop` | `subagentStop` | agent type/source discriminator |
| `Stop` | `stop` | matcher ignored |

Source paths:

- `codex-rs/hooks/src/lib.rs`
- `codex-rs/app-server-protocol/schema/typescript/v2/HookEventName.ts`
- `codex-rs/hooks/src/events/common.rs`

Codex treats omitted, empty, or `*` matchers as match-all. Simple alphanumeric/underscore/pipe matchers are exact alternatives; other matcher strings are regular expressions.

### Hook configuration shape

Codex reads `hooks.json` or hook declarations from configuration layers. A JSON hooks file has this top-level shape:

```json
{
  "description": "optional text",
  "hooks": {
    "SessionStart": [],
    "UserPromptSubmit": [],
    "PreToolUse": [],
    "PermissionRequest": [],
    "PostToolUse": [],
    "PreCompact": [],
    "PostCompact": [],
    "SubagentStart": [],
    "SubagentStop": [],
    "Stop": [],
    "SessionEnd": []
  }
}
```

Each event contains matcher groups:

```json
{
  "matcher": "optional exact alternatives or regex",
  "hooks": [
    {
      "type": "command",
      "command": "portable command",
      "commandWindows": "Windows command",
      "timeout": 5,
      "async": false,
      "statusMessage": "optional UI text",
      "additionalContextLimit": 0
    }
  ]
}
```

The upstream config also defines prompt and agent handler types. OL-027 will install only command handlers.

Important properties:

- unknown top-level fields in `HooksFile` are rejected upstream;
- command handlers support a Windows-specific command;
- handler timeout is configured in seconds;
- hook state can include enabled state and a trusted hash;
- managed requirements can restrict execution to managed hooks only;
- Codex discovers JSON and TOML hooks from ordered config layers and can warn when both representations are used in one layer;
- plugin hooks are a distinct source with their own environment.

Source paths:

- `codex-rs/config/src/hook_config.rs`
- `codex-rs/hooks/src/engine/discovery.rs`
- `docs/config.md`

### Common source fields

Event schemas use combinations of these fields:

- `hook_event_name`;
- `session_id`;
- `turn_id` for turn-scoped hooks;
- `agent_id` and `agent_type` when running in a subagent context;
- `cwd`;
- `transcript_path`, nullable;
- `model`;
- `permission_mode`.

Confirmed permission-mode values at the pinned revision:

- `default`;
- `acceptEdits`;
- `plan`;
- `dontAsk`;
- `bypassPermissions`.

The transcript path is a pointer, not content. OwnLoop will preserve only controlled metadata and will not open the file.

### SessionStart input

Required fields:

- `session_id`;
- `transcript_path`;
- `cwd`;
- `hook_event_name = SessionStart`;
- `model`;
- `permission_mode`;
- `source`.

Confirmed source values:

- `startup`;
- `resume`;
- `clear`;
- `compact`.

Source schema:

- `codex-rs/hooks/schema/generated/session-start.command.input.schema.json`

### UserPromptSubmit input

Required fields:

- common session fields;
- `turn_id`;
- `prompt`.

Optional subagent fields can be present through shared command-input fields.

Source schema:

- `codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json`

### PreToolUse input and control output

Required input fields:

- common session/turn fields;
- `tool_name`;
- `tool_input`;
- `tool_use_id`.

The runtime can aggregate these hook outcomes:

- block/no block;
- block reason;
- additional context;
- updated input.

A code-2 exit with a non-empty stderr can block a tool. Structured JSON can also influence permission or input.

OwnLoop will use none of these control capabilities. The adapter will return no hook output and exit zero.

Source paths:

- `codex-rs/hooks/src/events/pre_tool_use.rs`
- `codex-rs/hooks/schema/generated/pre-tool-use.command.input.schema.json`
- `codex-rs/hooks/schema/generated/pre-tool-use.command.output.schema.json`

### PostToolUse input

Required input fields:

- common session/turn fields;
- `tool_name`;
- `tool_input`;
- `tool_response`;
- `tool_use_id`.

`tool_input` and `tool_response` are arbitrary JSON values in the upstream schema. OwnLoop must bound and redact them before delivery and persistence.

Source schema:

- `codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json`

### PermissionRequest

Permission request is a first-class event distinct from `PreToolUse`. It is potentially policy-affecting. OwnLoop will capture only the request fact and correlation metadata. It will not return a permission decision.

Source paths:

- `codex-rs/hooks/src/events/permission_request.rs`
- generated permission-request schemas.

### Compact events

`PreCompact` and `PostCompact` describe context compaction. They are important for replay chronology and diagnosing context discontinuity but are not evidence of repository mutation or user understanding.

Source paths:

- `codex-rs/hooks/src/events/compact.rs`
- generated compact schemas.

### Subagent events

The current hook system supports both explicit `SubagentStart`/`SubagentStop` and common `agent_id`/`agent_type` fields on normal hooks executed within a subagent.

OwnLoop must keep main-agent and subagent lineage explicit. It must not merge activities only because they share a Codex session or cwd.

Source paths:

- `codex-rs/hooks/src/events/common.rs`
- generated subagent schemas.

### Stop and SessionEnd

`Stop` is turn-oriented. `SessionEnd` is conversation-oriented and has a reason matcher. OwnLoop should use Stop to begin finalization for a Task Run and SessionEnd to close the source conversation.

A Stop event is not proof that every PostToolUse event was delivered.

## Discovery, configuration, and trust

Codex builds hook handlers from a configuration-layer stack. The pinned source supports:

- managed requirement hooks;
- ordinary config layers;
- `hooks.json` in each config folder;
- TOML hooks;
- plugin hook sources;
- enabled state;
- trusted hashes;
- an admin `allow_managed_hooks_only` policy;
- hook trust bypass only through internal/runtime policy inputs, not something OwnLoop should synthesize.

OwnLoop implications:

1. install only in the current user's `~/.codex/hooks.json`;
2. never touch managed or project-local hooks;
3. never forge a trusted hash;
4. detect managed-only policy and report unsupported/needs-administrator rather than claiming installation success;
5. preserve non-OwnLoop hooks and unknown accepted structure;
6. avoid creating simultaneous JSON and TOML OwnLoop hooks in the same layer;
7. report when installed entries have not yet produced observed events.

## Legacy notify

Codex also retains a legacy top-level `notify` command. The documented behavior invokes a configured command with a JSON argument such as an `agent-turn-complete` event.

This surface is too weak for primary capture because it does not provide the lifecycle and tool chronology required by OwnLoop. It can be used only as an optional completion fallback and diagnostic limitation.

Source path:

- `codex-rs/core/src/config/mod.rs`

## Client-surface findings

### CLI/TUI

The official lifecycle engine, hook discovery, trust review, and hook browser are implemented in the CLI/TUI codebase. This is the first required live acceptance surface for OL-027.

### Desktop

Codex Desktop shares core/app-server infrastructure, but official issue history shows versions where user/project hooks failed to execute. OwnLoop must require observed events before reporting Desktop capture as active.

### IDE extension and app-server clients

Official issue history shows that legacy notify can be ignored in extension app-server sessions. Lifecycle support must be capability-tested rather than inferred from a shared config file.

### `codex exec`

Exec-mode persistence can differ from TUI extended history. This reinforces the decision not to use rollout files. Lifecycle-hook capture must be tested separately for exec mode before claiming support.

### Subagents

Hooks can run in subagents and provide agent ID/type. OL-027 must preserve lineage and prevent duplicate Task Runs when SessionStart/UserPromptSubmit ordering or subagent behavior varies.

## Known compatibility risks from official issue history

The following are upstream risks, not OwnLoop facts:

- SessionStart and UserPromptSubmit timing changed during hook development;
- some Codex versions/surfaces have failed to execute user hooks;
- user and plugin PostToolUse behavior has had reported inconsistencies;
- apply-patch tool-hook coverage changed over time;
- some internal read/search tools have lacked complete tool-hook coverage in particular versions;
- hook trust may require interactive user review;
- feature naming moved from `codex_hooks` toward `hooks`;
- legacy notify has not covered every human-intervention state;
- session/rollout persistence can be incomplete or corrupted independently of hooks.

OwnLoop response:

- capability probe instead of broad version claims;
- explicit observed-event counters;
- controlled partial-surface status;
- source-coverage Evidence gaps;
- Git reconciliation independent of hook completeness;
- no transcript/rollout fallback;
- adapter fixtures pinned to official schemas plus forward-compatible unknown-field handling.

## Proposed OwnLoop event mapping

| Codex event | OwnLoop normalized role | Evidence interpretation |
| --- | --- | --- |
| SessionStart | conversation open/resume | source lifecycle fact |
| UserPromptSubmit | Task Run start | user prompt submission fact, not understanding |
| PreToolUse | tool intent | not proof of execution |
| PermissionRequest | intervention request | not approval/denial unless separately observed |
| PostToolUse | source-reported tool completion | chronology/support only; Git remains authoritative |
| PreCompact | compaction start | context-management fact |
| PostCompact | compaction completion | context-management fact |
| SubagentStart | subagent lineage open | source lineage fact |
| SubagentStop | subagent lineage close | source lineage fact |
| Stop | Task Run finalization signal | terminal source fact with coverage limits |
| SessionEnd | conversation close | source lifecycle fact |

## Proposed idempotency inputs

### SessionStart

```text
codex + session_id + SessionStart + source
```

### UserPromptSubmit

```text
codex + session_id + turn_id + agent_id-or-main + UserPromptSubmit
```

### Tool and permission events

```text
codex + session_id + turn_id + agent_id-or-main + tool_use_id + hook_event_name
```

### Compact events

```text
codex + session_id + turn_id-if-present + compact trigger + hook_event_name + bounded source fingerprint
```

### Subagent events

```text
codex + session_id + turn_id-if-present + agent_id + hook_event_name
```

### Stop

```text
codex + session_id + turn_id + agent_id-or-main + Stop
```

### SessionEnd

```text
codex + session_id + SessionEnd + reason + bounded source fingerprint
```

The implementation must validate these assumptions against the generated schemas before contracts are accepted.

## Installation design baseline

Expected user configuration:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "ownloop-codex-hook",
            "commandWindows": "\"%LOCALAPPDATA%\\OwnLoop\\bin\\ownloop-codex-hook.cmd\"",
            "timeout": 2,
            "async": false,
            "statusMessage": "OwnLoop capture"
          }
        ]
      }
    ]
  }
}
```

The final command syntax must be verified on native Windows Codex. The config must never contain the daemon port, installation token, HMAC key, project path, or versioned app path.

Although Codex supports async handlers, OL-027 must test process lifetime and delivery reliability on Windows before choosing async. A very short synchronous fail-open adapter may be safer for durable local delivery while still remaining outside the practical critical path. The ADR intentionally does not finalize async mode before a live probe.

## Live probe plan

Before production implementation is accepted, run a disposable local Codex probe that logs only event names and field names, never prompt/tool content.

Required probes:

1. CLI new session;
2. CLI resumed session;
3. one prompt with no tool;
4. shell tool;
5. apply-patch tool;
6. permission-request path;
7. manual/automatic compaction where reproducible;
8. subagent spawn/stop;
9. Stop;
10. SessionEnd;
11. `codex exec`;
12. Desktop session;
13. IDE extension session if installed.

For each surface record:

- Codex version;
- hook feature state;
- whether trust was requested;
- events observed;
- field names observed;
- ordering;
- duplicates;
- missing expected events;
- exit behavior;
- no-output behavior;
- whether the surface is supported, partial, or unverified.

Probe logs must not enter the repository if they include local paths or payload content.

## Security and privacy threat model

### Threat: hook config command injection

Mitigation:

- exact stable launcher command;
- no user-controlled command fragments;
- strict merge and exact removal;
- ambiguous entries fail closed.

### Threat: OwnLoop changes Codex behavior

Mitigation:

- no output JSON;
- exit zero;
- no control fields;
- strict timeout;
- no retry;
- no trust bypass.

### Threat: payload contains secrets or source content

Mitigation:

- bounded stdin;
- event-specific parsing;
- accepted redaction before delivery;
- unknown fields dropped;
- no transcript reading;
- sensitivity classification for prompt/tool values.

### Threat: missing hook coverage creates false confidence

Mitigation:

- active status requires observed events;
- partial-surface limitations;
- no absence inference;
- Git reconciliation remains authoritative.

### Threat: source IDs collide between agents

Mitigation:

- explicit source family in all deduplication and conversation keys;
- subagent ID/type preservation;
- no cross-source session-ID equality assumptions.

### Threat: Codex update changes schema

Mitigation:

- adapter version and capability snapshot;
- bounded unknown-field tolerance;
- strict required-field validation;
- controlled unsupported diagnostics;
- pinned fixture refresh process from official schemas.

## First implementation slices

The OL-027 implementation should be split before code begins:

### OL-027A — Source contracts and recorded fixtures

- 11 event contracts;
- source metadata;
- sensitivity/redaction policy;
- idempotency key derivation;
- recorded synthetic fixtures derived from official schemas;
- no installer changes.

### OL-027B — Fail-open Codex adapter and ingress

- dedicated workspace;
- stdin parser;
- existing authenticated ingress wrapper;
- delivery timeout/no retry/no output;
- normalization and lifecycle integration;
- Claude regression.

### OL-027C — Codex configuration and Windows launcher

- safe `hooks.json` merge/status/remove;
- stable launcher;
- trust/capability diagnostics;
- OL-025 package integration;
- local CLI surface.

### OL-027D — Real client certification

- CLI/TUI required;
- exec separately classified;
- Desktop and IDE capability results;
- full Git/evidence/replay pipeline;
- privacy and packaging audit.

No slice may remain broad enough to hide a client-surface or trust assumption.

## Research conclusion

Codex's official lifecycle-hook engine is sufficient to build a trustworthy first-class OwnLoop adapter without scraping session history. The correct integration is not a direct Claude payload clone: Codex adds permission, compaction, and subagent semantics and has its own trust and configuration layers.

The safest v1 is an observer-only adapter that captures official hook facts, keeps source semantics explicit, reports partial coverage honestly, and relies on OwnLoop's existing Git and deterministic evidence boundaries for truth.