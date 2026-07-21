# ADR-0010: Capture a Privacy-Bounded Deterministic Git Baseline Without Breaking Active Lifecycle

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0008-transactional-receipt-lifecycle-resolution.md`
- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/product/BACKLOG_AMENDMENT_0001_INGRESS_SECURITY_ORDER.md`
- GitHub issue #21

---

## Context

OwnLoop can now:

- receive and durably journal canonical redacted Claude Code Hook receipts;
- resolve Workspace, Conversation, and Task Run lifecycle state;
- normalize lifecycle-resolved receipts into append-only sequenced Events.

The next requirement is a reproducible baseline of repository state at the beginning of a Task Run. Later reconciliation and finalization must compare actual repository state against this baseline rather than trusting tool intent.

A valid baseline must work when:

- the repository is clean;
- staged or unstaged changes already exist;
- untracked files exist;
- the current branch has no commit yet;
- the Hook working directory is a subdirectory of the repository;
- the repository changes while capture is running;
- Git is unavailable or the path is not a repository.

The baseline is a privacy boundary. Raw diffs, status output, untracked sensitive names, and source-file content must not become normal SQLite records. At the same time, OwnLoop needs enough deterministic evidence to distinguish pre-existing state from changes made during the Run.

The historical backlog says an unreliable baseline should mark a Run `Partial`. Applying terminal `Partial` during capture would break the accepted lifecycle model: OL-006 associates Tool and Stop receipts only with `Capturing` or `Finalizing` Runs. A Run that becomes terminal before the agent stops could no longer receive its own later source activity.

Workspace identity is also provisional. OL-006 uses the canonical Hook working directory before Git discovery. OL-008 may discover a different repository root, but it must not rewrite immutable Events, merge Workspaces, or claim that a path-derived identity was always Git-derived.

---

## Decision

OwnLoop will capture one immutable, versioned Git baseline per Task Run.

Capture has two phases:

```text
bounded read-only Git/filesystem observation outside SQLite transaction
→ transactional persistence of baseline, entries, Run/Workspace updates,
  evidence gap when needed, and one synthetic baseline Event
```

The capture API is asynchronous because it performs process and filesystem I/O. Persistence remains synchronous and transactional behind the existing SQLite boundary.

## Read-only Git execution

OwnLoop invokes the system Git executable without a shell.

Every command is structured as:

```text
git -C <workspace-or-root> <fixed-arguments>
```

The executable path may be injected for tests, but callers cannot inject arbitrary command arguments through product data.

The Git environment is reduced to a controlled child environment containing the minimum inherited process variables required to launch Git plus:

```text
LC_ALL=C
LANG=C
GIT_CONFIG_NOSYSTEM=1
GIT_OPTIONAL_LOCKS=0
GIT_TERMINAL_PROMPT=0
GIT_PAGER=cat
GIT_EXTERNAL_DIFF=
```

OwnLoop never executes mutation commands such as:

- `add`;
- `commit`;
- `checkout` or `switch`;
- `reset`;
- `clean`;
- `restore`;
- `stash`;
- `update-index`;
- `apply`.

All command stdout and stderr are bounded. Raw stderr is never returned or persisted.

## Repository discovery

Repository root is discovered with:

```text
git -C <workspace-path> rev-parse --show-toplevel
```

The returned value is decoded as strict UTF-8, trimmed, resolved through `realpath`, and treated as the canonical repository root for the capture.

The root must be an absolute path. Baseline persistence may contain the repository root because it is a local-only operational record required for later Git reconciliation. Safe result objects, diagnostic codes, Event payloads, and evidence-gap details must not contain it.

A non-Git path produces a persisted partial baseline with diagnostic `not_a_git_repository`.

## HEAD policy

OwnLoop runs:

```text
git -C <repository-root> rev-parse --verify HEAD
```

A successful value must be lowercase hexadecimal length 40 or 64.

An unborn branch is valid and represented as:

```text
headCommit = null
```

The absence of HEAD on an otherwise valid repository does not make the baseline partial.

## Status stability guard

OwnLoop captures machine-readable status before and after the other baseline observations:

```text
git -C <repository-root> status --porcelain=v2 -z --untracked-files=all
```

The raw bounded bytes are streamed into SHA-256 and discarded.

Persisted values:

- `statusBeforeSha256`;
- `statusAfterSha256`.

If the hashes differ, the repository changed during capture. The baseline is persisted as partial with diagnostic:

```text
repository_changed_during_capture
```

Other reliably captured hashes may still be persisted, but downstream claims must treat the baseline as incomplete.

## Staged and unstaged fingerprints

Staged state:

```text
git -C <root> diff --cached --binary --no-ext-diff --no-textconv \
  --no-color --full-index --src-prefix=a/ --dst-prefix=b/
```

Unstaged state:

```text
git -C <root> diff --binary --no-ext-diff --no-textconv \
  --no-color --full-index --src-prefix=a/ --dst-prefix=b/
```

Stdout is streamed directly into SHA-256 and discarded.

Persisted values:

- staged diff SHA-256;
- unstaged diff SHA-256;
- staged dirty boolean;
- unstaged dirty boolean.

A dirty tree is valid. Dirty state does not by itself produce a partial baseline.

External diff drivers and text conversion are disabled so repository-local configuration cannot replace the deterministic byte stream.

## Untracked inventory

OwnLoop obtains ignored-aware untracked paths with:

```text
git -C <root> ls-files --others --exclude-standard -z
```

The NUL-delimited output and entry count are bounded.

Default limits:

- command output: 8 MiB;
- entry count: 10,000;
- regular-file content hashing: 1 MiB per file;
- Git command timeout: 10 seconds;
- complete baseline capture timeout: 30 seconds.

Limits are injectable for tests but not sourced from repository content.

### Path safety

Every untracked path is interpreted relative to the canonical Git root.

OwnLoop:

- rejects absolute paths;
- rejects NUL-containing paths;
- normalizes separators for the host platform;
- rejects traversal outside the root;
- resolves the parent path without following the final entry;
- uses `lstat`, not `stat`, for type classification;
- never follows a symlink to hash target content.

### Sensitive names

Sensitive names include at least:

- `.env` and `.env.*`;
- `.npmrc`, `.pypirc`, and `.netrc`;
- `.aws/credentials`;
- common private-key names and extensions;
- filenames containing controlled credential, secret, password, token, API-key, or private-key terms.

For a sensitive path:

- `relativePath = null`;
- `sensitivity = secret`;
- `hashStatus = sensitive_path`;
- content is not read;
- path identity remains a SHA-256 digest of a versioned normalized relative-path representation.

### Regular files

A regular file within the size limit is hashed only when:

1. pre-read `lstat` succeeds;
2. the file is a regular file;
3. size is within limit;
4. content is read with a no-follow file descriptor where supported;
5. post-read `lstat` matches device, inode when available, size, and modification time.

A mismatch produces:

```text
hashStatus = changed_during_capture
```

The baseline becomes partial with diagnostic `untracked_entry_changed`.

Unreadable files produce `unreadable` and partial diagnostic `untracked_entry_unreadable`.

Files above the hash limit produce `too_large` but do not automatically make the baseline partial; their omission is explicit and counted.

### Symlinks

OwnLoop reads only the symlink target string with `readlink` and hashes that string. It never reads the target file.

A symlink record uses:

- kind `symlink`;
- target-string SHA-256 when readable;
- no target content;
- no path outside the repository.

### Other entry types

Directories and special filesystem entries are retained as metadata with `non_regular` and no content hash.

## Working-tree fingerprint

OwnLoop computes one deterministic versioned digest over controlled baseline facts:

```text
ownloop-git-baseline-v1
head commit or explicit unborn marker
staged diff SHA-256
unstaged diff SHA-256
status-before SHA-256
status-after SHA-256
ordered untracked entry records
```

Each untracked entry contributes controlled fields only:

- path identity SHA-256;
- kind;
- size or null marker;
- content SHA-256 or null marker;
- sensitivity;
- hash status.

The fingerprint does not include:

- absolute paths;
- raw relative paths;
- raw diffs;
- raw status output;
- file content;
- source session identifiers;
- credentials.

## Capture timing and late capture

The baseline record stores:

- `capturedAt` from an injected/default clock;
- `captureDelayMs = max(0, capturedAt - run.startedAt)`.

Default late threshold:

```text
30,000 ms
```

A baseline captured after this threshold is persisted as partial with diagnostic `late_capture`, even when Git observations are otherwise stable.

The deterministic fingerprint still represents the observed repository state, but OwnLoop cannot confidently claim it is the immediate pre-agent state.

## Partial outcome without terminal lifecycle transition

OL-008 does not change Run status to `Partial`.

For a partial baseline, the same persistence transaction:

- inserts the baseline and entry records;
- increments `task_runs.evidence_gap_count` once;
- inserts one structured evidence gap with controlled code/message;
- appends the baseline Event;
- keeps Run status unchanged.

OL-011 finalization uses evidence gaps to select terminal `Partial` later.

This supersedes any interpretation of the original backlog that would terminally transition an active Run during baseline capture.

## Workspace upgrade

A Git-discovered baseline upgrades the existing Workspace in place:

- Workspace ID remains unchanged;
- canonical Hook path remains unchanged;
- `repositoryRoot` becomes the canonical Git root;
- `identityBasis` becomes `git_resolved_v1`;
- `initialRepositoryFingerprint` changes to the working-tree fingerprint only if its current value has the provisional `path-sha256:` prefix.

OL-008 does not:

- merge Workspaces;
- rewrite prior Events;
- re-parent Conversations or Runs;
- delete duplicate provisional Workspaces.

Two Workspaces created from different Hook directories may resolve to one Git root in v0.1. Consolidation requires a later ADR.

## Task Run baseline update

For a captured baseline:

- `baselineGitCommit` becomes the HEAD commit or null for unborn branches;
- `baselineWorkingTreeFingerprint` becomes the deterministic working-tree fingerprint;
- Run lifecycle status remains unchanged.

For a partial baseline, fields are set only when their values are trustworthy. A partial record always carries one controlled diagnostic and evidence gap.

Task Run baseline fields are write-once through OL-008 repository methods. A conflicting second baseline is persisted-state corruption.

## Baseline Event

Every persisted baseline appends one synthetic Run-level Event:

```text
snapshot.baseline_captured
```

Properties:

- source `ownloop`;
- source Event name/ID null;
- sensitivity `normal`;
- next positive sequence for the Run;
- occurredAt = Run startedAt;
- ingestedAt = baseline capturedAt;
- metadata collectorVersion = `0.1.0`;
- controlled payload only.

Payload:

```json
{
  "baselineId": "...",
  "outcome": "captured|partial",
  "diagnosticCode": null,
  "headPresent": true,
  "stagedDirty": false,
  "unstagedDirty": false,
  "untrackedCount": 0,
  "untrackedHashedCount": 0,
  "untrackedOmittedCount": 0,
  "captureDelayMs": 17
}
```

The Event payload never includes repository paths, commit IDs, hashes, filenames, raw Git output, or file content.

Event deduplication key:

```text
v1:git-baseline:<run-id>
```

Baseline rows, entries, Workspace upgrade, Run update, evidence gap, Event append, deduplication row, and sequence allocation commit atomically.

## Idempotency

`git_baselines.run_id` is unique.

If a Run already has a baseline, capture returns the persisted safe result and baseline Event ID without:

- executing Git again;
- appending another Event;
- consuming another sequence;
- incrementing evidence gaps again;
- changing Workspace/Run fields.

## Migration version 5

Migration v5 adds:

- `git_baselines`;
- `git_baseline_untracked_entries`;
- immutable update triggers;
- indexes for Run, Workspace, capture time, and baseline entry order.

Migrations 1–4 remain byte-for-byte unchanged.

SQL constraints enforce:

- one baseline per Run;
- Workspace/Conversation/Run composite consistency;
- captured/partial diagnostic consistency;
- lowercase 64-hex SHA-256 values;
- valid optional HEAD commit form;
- integer booleans;
- non-negative counts and delay;
- contiguous entry indices through repository validation;
- immutable baseline and entry rows.

## API boundary

OL-008 exposes explicit asynchronous APIs:

- capture one Run baseline;
- get one baseline and ordered entries;
- list Run IDs lacking a baseline;
- capture a bounded batch sequentially.

Maximum batch:

```text
25 Runs
```

No worker, timer, startup hook, or scheduler is added.

Safe results contain only:

- baseline ID;
- Run ID;
- outcome;
- diagnostic code;
- baseline Event ID;
- HEAD-present boolean;
- staged/unstaged dirty booleans;
- untracked counts;
- capture timestamp and delay.

No path, commit ID, hash, filename, Git output, content, exception message, or stack is returned.

---

## Alternatives considered

## Alternative 1: Store raw `git diff`

Rejected because diffs commonly contain proprietary code, credentials, personal data, and large binary patches. Deterministic hashes are sufficient for baseline identity; artifacts are introduced later under explicit retention policy.

## Alternative 2: Require a clean working tree

Rejected because real developer repositories often contain legitimate pre-existing work. OwnLoop must record rather than erase or reject that state.

## Alternative 3: Hash the entire repository recursively

Rejected because it ignores Git semantics, can traverse build/vendor directories, has poor performance, and increases secret exposure.

## Alternative 4: Mark the active Run terminal `Partial`

Rejected because later Hook receipts would lose their active Run association. OL-008 records evidence gaps while preserving active lifecycle state.

## Alternative 5: Follow symlinks

Rejected because a repository symlink may target sensitive data outside the repository.

## Alternative 6: Persist all untracked relative paths

Rejected because filenames can themselves reveal secrets, identities, customer names, and credential locations. Sensitive paths are digest-only.

## Alternative 7: Merge Workspaces after discovering one Git root

Rejected because Conversations and append-only Events already reference existing Workspace IDs. Consolidation requires explicit migration semantics.

## Alternative 8: Run Git inside a long SQLite transaction

Rejected because process and filesystem I/O would hold database write locks. Observation occurs first; only controlled results are committed transactionally.

---

## Consequences

### Positive

- dirty working trees are supported safely;
- baseline claims are based on actual Git/filesystem state;
- raw code and diffs do not enter the core database;
- partial evidence is explicit without breaking lifecycle;
- later reconciliation can compare deterministic fingerprints;
- Workspace Git identity is upgraded without rewriting history;
- baseline capture is idempotent and sequenced in the Event Store.

### Negative

- Git and filesystem capture is more complex than one diff command;
- very large/unreadable untracked files remain explicitly unhashed;
- path-based provisional Workspace duplication can persist;
- synchronous baseline persistence still briefly blocks the daemon event loop;
- repository changes during capture may require later recovery/retry policy.

### Accepted risks

- SHA-256 fingerprints prove byte equality, not semantic equivalence;
- capture timing may be later than the source prompt and is surfaced as partial;
- system Git behavior is pinned through fixed flags and integration tests rather than a bundled Git implementation;
- OL-008 does not automatically retry partial captures.

---

## Implementation constraints

OL-008 must not implement:

- any Git mutation;
- raw diff/status/content persistence;
- post-tool or Stop reconciliation;
- final repository snapshot;
- terminal Run finalization or recovery;
- Workspace consolidation;
- content-addressed artifacts;
- background workers or schedulers;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

---

## Validation

The decision is validated when tests prove:

- migration 4→5 and fresh migration behavior;
- clean, dirty, mixed, untracked, symlink, unborn, and non-Git cases;
- stable deterministic fingerprints;
- sensitive path/content non-persistence;
- repository-change and late-capture partial outcomes;
- active Run lifecycle preservation;
- atomic baseline/Event/evidence/Workspace/Run writes;
- idempotent reprocessing with no sequence consumption;
- file-backed durability;
- no mutation Git command is executed;
- standard quality gates pass.

---

## Reversibility

Baseline schema and fingerprint version are explicit. A future baseline format uses a new version or migration; stored baseline rows and Events are not silently reinterpreted. Bundling Git, storing raw artifacts, consolidating Workspaces, or changing active-Run partial semantics requires a superseding ADR.

---

## References

- Git status porcelain format: <https://git-scm.com/docs/git-status>
- Git diff options: <https://git-scm.com/docs/git-diff>
- Git tracked/untracked listing: <https://git-scm.com/docs/git-ls-files>
- Git revision parsing: <https://git-scm.com/docs/git-rev-parse>
