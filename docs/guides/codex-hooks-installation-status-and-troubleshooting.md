# Codex Hooks: Installation, Status, Trust, and Troubleshooting

**Status:** Implemented installation and diagnostics guide for OL-027  
**Platform:** Windows 10/11 x64, current-user installation  
**Source boundary:** Official Codex lifecycle command Hooks only

## What OwnLoop installs

OwnLoop adds one exact observer-only command handler for each supported Codex lifecycle event in the current user's file:

```text
%USERPROFILE%\.codex\hooks.json
```

Supported events:

```text
SessionStart
UserPromptSubmit
PreToolUse
PermissionRequest
PostToolUse
PreCompact
PostCompact
SubagentStart
SubagentStop
Stop
SessionEnd
```

The stable Windows launcher is:

```text
%LOCALAPPDATA%\OwnLoop\bin\ownloop-codex-hook.cmd
```

The versioned adapter remains inside the verified OwnLoop release directory. `hooks.json` contains no daemon port, installation token, HMAC key, profile path beyond the required stable launcher, project path, transcript content, or versioned application path.

OwnLoop preserves unrelated top-level settings, unrelated events, and unrelated handlers. Installation and removal are bounded, duplicate-key-safe, backed up before mutation, atomically replaced, idempotent, and fail closed when an OwnLoop-like entry has been modified or duplicated ambiguously.

## Commands

Use the installed stable CLI:

```powershell
$ownloop = "$env:LOCALAPPDATA\OwnLoop\bin\ownloop.cmd"

& $ownloop codex hooks install
& $ownloop codex hooks status
& $ownloop codex doctor
& $ownloop codex hooks remove
```

The generic commands remain available when both Claude Code and Codex should be reconciled together:

```powershell
& $ownloop hooks install
& $ownloop hooks status
& $ownloop hooks remove
```

`codex hooks install` and `codex hooks remove` change only the current user's exact OwnLoop Codex entries. They do not modify Claude Code settings.

## `codex hooks status`

The status command reports only installation reconciliation:

- `installed`: all 11 exact OwnLoop handlers are present and the verified installation manifest owns the stable launcher;
- `missing`: no complete exact Codex installation is present;
- `repair_needed`: the file is invalid, ambiguous, contains modified/duplicate OwnLoop-like entries, or the verified installed release/manifest/secret identity does not reconcile.

A status of `installed` does not claim that Codex has trusted or executed the handlers. Use `codex doctor` for capability and trust diagnostics.

## `codex doctor`

When the OwnLoop daemon is running, `codex doctor` first verifies runtime state, release fingerprint, installation identity, and protected installation secrets. It then reads the authenticated loopback endpoint:

```text
GET /v1/diagnostics/codex
```

When the daemon is stopped or the authenticated capability response cannot be validated, doctor returns a bounded local-only projection instead. The result never includes the installation token, HMAC key, config contents, profile paths, prompts, tool input/output, transcript path, session IDs, tool-use IDs, exceptions, or stacks.

Capability states:

| State | Meaning |
| --- | --- |
| `not_installed` | Exact OwnLoop Codex handlers are absent. |
| `installed_unverified` | Installation exists, but hook engine, trust, managed policy, or daemon-observed capability cannot yet be proven. |
| `needs_trust` | Exact handlers are installed but Codex has not trusted their current canonical hashes. |
| `enabled_no_events_seen` | Exact trusted handlers are enabled, but no controlled Codex Hook event has reached OwnLoop yet. |
| `active` | All supported events and a certified source surface have been observed without current limitations. |
| `partial_surface` | Events are arriving, but coverage, source version, source surface, PostToolUse pairing, or subagent lineage is incomplete. |
| `repair_needed` | Configuration is partial, invalid, or ambiguous. |
| `unsupported` | Hooks are explicitly disabled, unavailable, or managed-only policy prevents current-user Hooks. |

Zero observed events is not proof that no Codex activity occurred.

## Trust ownership

Codex owns Hook trust. OwnLoop never writes or forges Codex trusted hashes and never bypasses the Codex trust review.

OwnLoop reads the current user's explicit Hook state from:

```text
%USERPROFILE%\.codex\config.toml
```

A current handler is reported as trusted only when the explicit Codex state contains the exact canonical hash for that installed handler. Missing or stale state is reported as `needs_trust`.

Approve the handlers through the Codex user interface or command surface provided by the installed Codex version. After approval, run:

```powershell
& $ownloop codex doctor
```

The daemon re-inspects configuration on every authenticated diagnostic request, so a restart is not required merely to observe a newly approved trust state.

## Managed policy

On Windows, OwnLoop reads the official system requirements path when present:

```text
%ProgramData%\OpenAI\Codex\requirements.toml
```

It recognizes only an explicit root-level value:

```toml
allow_managed_hooks_only = true
```

or:

```toml
allow_managed_hooks_only = false
```

Missing, unsafe, malformed, duplicated, or otherwise unprovable policy remains `unknown`. OwnLoop never edits this file, managed Hooks, project-local `.codex` configuration, plugin Hooks, MDM state, or enterprise policy.

## Feature state

OwnLoop reads the explicit user feature state from `%USERPROFILE%\.codex\config.toml` when it can do so safely. Conflicting `hooks` and legacy `codex_hooks` declarations are reported as unknown rather than guessed.

An explicit disabled state produces `unsupported`. OwnLoop does not enable the feature silently.

## Client capability matrix

| Codex surface | Current OL-027 claim |
| --- | --- |
| CLI/TUI | Installation and capability diagnostics implemented; final `active` certification requires a real observed local run. |
| `codex exec` | Unverified as a distinct source surface until separately observed. |
| Desktop | Unverified; shared config does not imply Hook execution. |
| IDE/app-server client | Unverified; shared config does not imply Hook execution. |
| Subagents | Contracts, lineage, normalization, and coverage diagnostics implemented; live surface behavior must still be observed. |

OwnLoop never upgrades an unverified surface merely because it shares `CODEX_HOME` or the same `hooks.json` file.

## Privacy boundary

OwnLoop does not read:

- Codex transcript files;
- rollout/session JSONL;
- Codex authentication state;
- OpenAI API keys;
- arbitrary environment variables;
- unrelated user, project, plugin, managed, or enterprise Hook contents.

The adapter accepts one bounded JSON object from stdin, validates one of the 11 supported event contracts, drops unknown upstream fields after bounded parsing, redacts controlled sensitive values, performs one short authenticated loopback delivery attempt, emits no ordinary stdout/stderr, and exits successfully on success and all failure modes.

`PreToolUse` is an observed tool intention, not execution evidence. `PermissionRequest` is an observed request, not approval or denial. `PostToolUse` is source-reported completion, not automatically success. Git reconciliation remains authoritative for repository changes, and deterministic exit-code-backed extraction remains authoritative for verification claims.

## Troubleshooting

### `not_installed` or `missing`

Run:

```powershell
& $ownloop codex hooks install
& $ownloop codex hooks status
```

If install returns a controlled error, do not manually delete unrelated Hooks. Preserve the file and inspect `codex doctor` and the exact error code.

### `repair_needed`

This commonly means:

- malformed or duplicate-key JSON;
- an OwnLoop-like handler was edited manually;
- duplicate OwnLoop-like handlers exist;
- the stable launcher differs from the verified manifest;
- release, manifest, or protected secret identity no longer reconciles.

OwnLoop deliberately refuses to overwrite or remove ambiguous entries. Restore from the `.ownloop-backup-*` file or manually resolve only the ambiguous OwnLoop-like entries while preserving all unrelated configuration, then rerun status.

### `needs_trust`

Approve the exact current handlers in Codex. OwnLoop will not perform this action. Then rerun `codex doctor`.

### `unsupported`

Check for:

- an explicitly disabled Hooks feature in user configuration;
- `allow_managed_hooks_only = true` in system requirements;
- a Codex version without the required lifecycle-Hook engine.

Managed-only policy requires an administrator or managed deployment decision. OwnLoop does not bypass it.

### `enabled_no_events_seen`

Start a new Codex CLI session and perform a controlled prompt. This state can also mean that the current Codex client surface does not execute user Hooks. Absence of events must not be interpreted as absence of activity.

### `partial_surface`

Inspect the returned limitations. Typical limitations include:

- `client_surface_unverified`;
- `incomplete_event_coverage`;
- `missing_post_tool_use`;
- `source_version_unknown`;
- `subagent_lineage_partial`.

A partial source can still provide chronology, but Git and deterministic analyzers remain the evidence authority.

### Daemon unavailable

The Hook adapter fails open and never blocks Codex. Start OwnLoop and rerun doctor:

```powershell
& $ownloop start
& $ownloop codex doctor
```

Events emitted while the daemon was unavailable are not inferred or reconstructed from transcript/rollout files.

## Real-client certification checklist

OL-027 must remain open until a real local Codex run demonstrates the complete path:

1. install exact current-user Hooks;
2. approve trust through Codex;
3. start OwnLoop;
4. confirm doctor reports at least `enabled_no_events_seen`;
5. run a controlled Codex CLI prompt in a disposable Git repository;
6. observe lifecycle events through the authenticated Codex ingress;
7. confirm one Task Run is created;
8. confirm real Git baseline and final reconciliation;
9. confirm source-accurate Replay and deterministic verification evidence;
10. confirm no prompt, tool output, transcript content, credentials, or absolute repository path leaks into diagnostics or Replay;
11. rerun doctor and record the observed source surface, source version, event coverage, and limitations.

Desktop, IDE, app-server, `codex exec`, and subagent surface claims require separate observations.

## Related records

- [ADR-0028: Codex Lifecycle-Hook Adapter and Multi-Agent Source Boundary](../adr/0028-codex-lifecycle-hook-adapter-and-multi-agent-source-boundary.md)
- [ADR-0029: Provider-Neutral Codex Event Taxonomy](../adr/0029-codex-provider-neutral-event-taxonomy.md)
- [Codex Lifecycle-Hook Integration Research — July 2026](../research/codex-lifecycle-hook-integration-2026-07.md)
- [Issue #75](https://github.com/Emad211/OWNLOOP/issues/75)
