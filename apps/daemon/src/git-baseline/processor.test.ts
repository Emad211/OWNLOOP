import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { NORMALIZED_EVENT_SCHEMA_VERSION } from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "../persistence/database.js";
import { MIGRATIONS } from "../persistence/migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "../persistence/migrations.js";
import {
  openPersistence,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import {
  captureGitBaseline,
  captureMissingGitBaselines,
  type GitBaselineCaptureDependencies,
} from "./processor.js";
import { GitCommandError, runGitCommand, type GitCommandRunner } from "./git-runner.js";
import { scanUntrackedEntries } from "./untracked.js";

const execFileAsync = promisify(execFile);
const FIXTURE_START = "2026-07-21T15:00:00.000Z";
const FIXTURE_CAPTURE = "2026-07-21T15:00:01.000Z";
const temporaryDirectories: string[] = [];
const openHandles: OwnLoopPersistence[] = [];

async function temporaryDirectory(prefix = "ownloop-git-baseline-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (openHandles.length > 0) {
    openHandles.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LC_ALL: "C",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

async function createRepository(options: Readonly<{ commit?: boolean }> = {}): Promise<string> {
  const root = await temporaryDirectory();
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["config", "user.name", "OwnLoop Fixture"]);
  if (options.commit !== false) {
    await writeFile(join(root, "tracked.txt"), "initial\n", "utf8");
    await git(root, ["add", "tracked.txt"]);
    await git(root, ["commit", "-m", "fixture baseline"]);
  }
  return await realpath(root);
}

function pathFingerprint(path: string): string {
  return `path-sha256:${createHash("sha256").update(path).digest("hex")}`;
}

function persistence(databasePath = ":memory:"): OwnLoopPersistence {
  const handle = openPersistence(databasePath);
  openHandles.push(handle);
  return handle;
}

let seedCounter = 0;
function seedRun(
  store: OwnLoopPersistence,
  workspacePath: string,
  options: Readonly<{
    workspaceId?: string;
    conversationId?: string;
    runId?: string;
    runNumber?: number;
    startedAt?: string;
  }> = {},
) {
  seedCounter += 1;
  const workspaceId = options.workspaceId ?? `workspace-${seedCounter}`;
  const conversationId = options.conversationId ?? `conversation-${seedCounter}`;
  const runId = options.runId ?? `run-${seedCounter}`;
  store.workspaces.insert({
    workspaceId,
    canonicalPath: workspacePath,
    repositoryRoot: workspacePath,
    gitRemote: null,
    initialRepositoryFingerprint: pathFingerprint(workspacePath),
    identityBasis: "canonical_path_v1",
    createdAt: FIXTURE_START,
    lastObservedAt: FIXTURE_START,
  });
  store.conversations.insert({
    conversationId,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `source-session-${seedCounter}`,
    startMode: "startup",
    startedAt: FIXTURE_START,
    lastObservedAt: FIXTURE_START,
    endedAt: null,
    status: "Active",
  });
  store.taskRuns.insert({
    runId,
    conversationId,
    runNumber: options.runNumber ?? 1,
    redactedPrompt: "Neutral Git baseline prompt.",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: options.startedAt ?? FIXTURE_START,
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  });
  return { workspaceId, conversationId, runId };
}

function dependencies(
  store: OwnLoopPersistence,
  overrides: Partial<GitBaselineCaptureDependencies> = {},
): GitBaselineCaptureDependencies {
  return {
    persistence: store,
    clock: () => new Date(FIXTURE_CAPTURE),
    ...overrides,
  };
}

async function capture(
  store: OwnLoopPersistence,
  runId: string,
  overrides: Partial<GitBaselineCaptureDependencies> = {},
) {
  return await captureGitBaseline(dependencies(store, overrides), runId);
}

function assertSafeResult(result: unknown, forbidden: readonly string[]): void {
  const text = JSON.stringify(result);
  for (const value of forbidden) {
    expect(text).not.toContain(value);
  }
}

describe("Git baseline capture", () => {
  it("captures a clean committed repository, upgrades Workspace, updates Run, and appends one Event", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId);

    expect(result).toMatchObject({
      outcome: "captured",
      diagnosticCode: null,
      headPresent: true,
      stagedDirty: false,
      unstagedDirty: false,
      untrackedCount: 0,
      captureDelayMs: 1_000,
    });
    const baseline = store.gitBaselines.getByRun(seeded.runId);
    expect(baseline?.workingTreeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline?.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 0,
      baselineGitCommit: baseline?.headCommit,
      baselineWorkingTreeFingerprint: baseline?.workingTreeFingerprint,
    });
    expect(store.workspaces.get(seeded.workspaceId)).toMatchObject({
      repositoryRoot: root,
      identityBasis: "git_resolved_v1",
      initialRepositoryFingerprint: baseline?.workingTreeFingerprint,
    });
    const events = store.events.listForRun(seeded.runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: result?.eventId,
      sequence: 1,
      type: "snapshot.baseline_captured",
      source: "ownloop",
      sensitivity: "normal",
    });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(root);
    expect(JSON.stringify(events[0]?.payload)).not.toContain(baseline?.workingTreeFingerprint);
    expect(store.events.countDeduplicationKeysForEvent(result?.eventId ?? "missing")).toBe(1);
  });

  it.each([
    {
      name: "staged only",
      setup: async (root: string) => {
        await appendFile(join(root, "tracked.txt"), "staged\n");
        await git(root, ["add", "tracked.txt"]);
      },
      staged: true,
      unstaged: false,
    },
    {
      name: "unstaged only",
      setup: async (root: string) => {
        await appendFile(join(root, "tracked.txt"), "unstaged\n");
      },
      staged: false,
      unstaged: true,
    },
    {
      name: "mixed",
      setup: async (root: string) => {
        await appendFile(join(root, "tracked.txt"), "staged\n");
        await git(root, ["add", "tracked.txt"]);
        await appendFile(join(root, "tracked.txt"), "unstaged\n");
      },
      staged: true,
      unstaged: true,
    },
  ])("accepts a dirty tree: $name", async ({ setup, staged, unstaged }) => {
    const root = await createRepository();
    await setup(root);
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId);

    expect(result).toMatchObject({
      outcome: "captured",
      stagedDirty: staged,
      unstagedDirty: unstaged,
    });
  });

  it("records bounded untracked regular, sensitive, large, and symlink entries", async () => {
    const root = await createRepository();
    await writeFile(join(root, "note.txt"), "neutral", "utf8");
    await writeFile(join(root, ".env.secret"), "DO_NOT_PERSIST", "utf8");
    await writeFile(join(root, "large.bin"), Buffer.alloc(128, 7));
    await symlink("tracked.txt", join(root, "link-to-tracked"));
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId, {
      limits: {
        commandTimeoutMs: 10_000,
        maximumCommandOutputBytes: 8 * 1024 * 1024,
        maximumUntrackedEntries: 100,
        maximumUntrackedHashBytes: 32,
      },
    });

    expect(result).toMatchObject({
      outcome: "captured",
      untrackedCount: 4,
      untrackedHashedCount: 2,
      untrackedOmittedCount: 2,
    });
    const baseline = store.gitBaselines.getByRun(seeded.runId);
    expect(baseline?.entries).toHaveLength(4);
    const sensitive = baseline?.entries.find((entry) => entry.sensitivity === "secret");
    expect(sensitive).toMatchObject({
      relativePath: null,
      contentSha256: null,
      hashStatus: "sensitive_path",
    });
    const large = baseline?.entries.find((entry) => entry.relativePath === "large.bin");
    expect(large).toMatchObject({ contentSha256: null, hashStatus: "too_large" });
    const link = baseline?.entries.find((entry) => entry.relativePath === "link-to-tracked");
    expect(link).toMatchObject({ kind: "symlink", hashStatus: "hashed" });
    assertSafeResult(result, [root, ".env.secret", "DO_NOT_PERSIST"]);
  });

  it("captures an unborn repository with a null HEAD", async () => {
    const root = await createRepository({ commit: false });
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId);

    expect(result).toMatchObject({ outcome: "captured", headPresent: false });
    expect(store.gitBaselines.getByRun(seeded.runId)?.headCommit).toBeNull();
    expect(store.taskRuns.get(seeded.runId)?.baselineWorkingTreeFingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("records a non-Git path as partial without ending the active Run", async () => {
    const root = await temporaryDirectory();
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId);

    expect(result).toMatchObject({ outcome: "partial", diagnosticCode: "not_a_git_repository" });
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 1,
      baselineWorkingTreeFingerprint: null,
    });
    expect(store.workspaces.get(seeded.workspaceId)?.identityBasis).toBe("canonical_path_v1");
    expect(store.runSupport.listEvidenceGaps(seeded.runId)).toEqual([
      expect.objectContaining({ code: "git_baseline_not_a_git_repository", detailsJson: null }),
    ]);
  });

  it("records a missing Git executable as a safe partial baseline", async () => {
    const root = await temporaryDirectory();
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId, {
      executable: "ownloop-missing-git-fixture",
    });

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "git_executable_unavailable",
    });
    assertSafeResult(result, [root, "ownloop-missing-git-fixture"]);
  });

  it("detects repository changes between status snapshots", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    let statusCalls = 0;
    const runner: GitCommandRunner = async (request) => {
      const result = await runGitCommand(request);
      if (request.args.includes("status")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          await writeFile(join(root, "changed-during-capture.txt"), "change", "utf8");
        }
      }
      return result;
    };

    const result = await capture(store, seeded.runId, { runner });

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "repository_changed_during_capture",
    });
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 1,
      baselineWorkingTreeFingerprint: null,
    });
    expect(store.workspaces.get(seeded.workspaceId)).toMatchObject({
      identityBasis: "git_resolved_v1",
      repositoryRoot: root,
    });
  });

  it("detects an untracked file changing during content hashing", async () => {
    const root = await createRepository();
    await writeFile(join(root, "moving.txt"), "before", "utf8");
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId, {
      scanHooks: {
        afterRegularFileRead: async (relativePath) => {
          if (relativePath === "moving.txt") {
            await appendFile(join(root, relativePath), "-after", "utf8");
          }
        },
      },
    });

    expect(result).toMatchObject({ outcome: "partial", diagnosticCode: "untracked_entry_changed" });
    expect(store.gitBaselines.getByRun(seeded.runId)?.entries[0]).toMatchObject({
      hashStatus: "changed_during_capture",
      contentSha256: null,
    });
  });

  it("marks late capture partial but retains reliable Run baseline fields", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId, {
      clock: () => new Date("2026-07-21T15:01:00.000Z"),
      lateCaptureThresholdMs: 30_000,
    });

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "late_capture",
      captureDelayMs: 60_000,
    });
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 1,
    });
    expect(store.taskRuns.get(seeded.runId)?.baselineWorkingTreeFingerprint).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("maps output bounds and later Git failures to controlled partial diagnostics", async () => {
    const root = await createRepository();
    const firstStore = persistence();
    const first = seedRun(firstStore, root);
    const outputLimited = await capture(firstStore, first.runId, {
      limits: {
        commandTimeoutMs: 10_000,
        maximumCommandOutputBytes: 1,
        maximumUntrackedEntries: 100,
        maximumUntrackedHashBytes: 1024,
      },
    });
    expect(outputLimited?.diagnosticCode).toBe("git_output_limit_exceeded");

    const secondStore = persistence();
    const second = seedRun(secondStore, root);
    let call = 0;
    const runner: GitCommandRunner = async (request) => {
      call += 1;
      if (call > 1) {
        throw new GitCommandError("exit_nonzero");
      }
      return await runGitCommand(request);
    };
    const failed = await capture(secondStore, second.runId, { runner });
    expect(failed?.diagnosticCode).toBe("git_command_failed");
  });

  it("maps a Git timeout to a controlled partial baseline", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    const runner: GitCommandRunner = async () => {
      throw new GitCommandError("timeout");
    };

    const result = await capture(store, seeded.runId, { runner });

    expect(result).toMatchObject({ outcome: "partial", diagnosticCode: "git_command_timeout" });
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 1,
    });
  });

  it("bounds an oversized untracked inventory and records truncation explicitly", async () => {
    const root = await createRepository();
    await writeFile(join(root, "one.txt"), "one", "utf8");
    await writeFile(join(root, "two.txt"), "two", "utf8");
    const store = persistence();
    const seeded = seedRun(store, root);

    const result = await capture(store, seeded.runId, {
      limits: {
        commandTimeoutMs: 10_000,
        maximumCommandOutputBytes: 8 * 1024 * 1024,
        maximumUntrackedEntries: 1,
        maximumUntrackedHashBytes: 1024,
      },
    });

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "untracked_inventory_limit_exceeded",
      untrackedCount: 2,
      untrackedHashedCount: 1,
      untrackedOmittedCount: 1,
    });
    expect(store.gitBaselines.getByRun(seeded.runId)?.entries).toHaveLength(1);
  });

  it("rejects a nested path whose parent symlink escapes the repository root", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory("ownloop-parent-symlink-outside-");
    await writeFile(join(outside, "public.txt"), "outside-secret-content");
    await symlink(outside, join(root, "escape"));

    const result = await scanUntrackedEntries(root, Buffer.from("escape/public.txt\0", "utf8"), {
      maximumEntries: 10,
      maximumHashBytes: 1024,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      relativePath: "escape/public.txt",
      contentSha256: null,
      hashStatus: "unreadable",
    });
    expect(result.diagnostics).toContain("untracked_entry_unreadable");
    expect(JSON.stringify(result)).not.toContain("outside-secret-content");
  });

  it("hashes only a symlink target string and never follows an outside target", async () => {
    const root = await createRepository();
    const outside = await temporaryDirectory("ownloop-outside-secret-");
    const secretPath = join(outside, "outside-secret.txt");
    await writeFile(secretPath, "OUTSIDE_SECRET_CONTENT", "utf8");
    await symlink(secretPath, join(root, "outside-link"));
    const store = persistence();
    const seeded = seedRun(store, root);

    await capture(store, seeded.runId);

    const entry = store.gitBaselines.getByRun(seeded.runId)?.entries[0];
    expect(entry).toMatchObject({ kind: "symlink", hashStatus: "hashed" });
    expect(entry?.contentSha256).toBe(createHash("sha256").update(secretPath).digest("hex"));
    expect(entry?.contentSha256).not.toBe(
      createHash("sha256").update("OUTSIDE_SECRET_CONTENT").digest("hex"),
    );
  });

  it("is idempotent and does not execute Git or consume another sequence twice", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    let calls = 0;
    const runner: GitCommandRunner = async (request) => {
      calls += 1;
      return await runGitCommand(request);
    };
    const deps = dependencies(store, { runner });

    const first = await captureGitBaseline(deps, seeded.runId);
    const firstCalls = calls;
    const second = await captureGitBaseline(deps, seeded.runId);

    expect(second).toEqual(first);
    expect(calls).toBe(firstCalls);
    expect(store.gitBaselines.countAll()).toBe(1);
    expect(store.events.listForRun(seeded.runId)).toHaveLength(1);
  });

  it("continues an existing Run sequence and persists a controlled Event payload", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    store.events.append({
      eventId: "existing-event",
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
      runId: seeded.runId,
      sequence: 5,
      type: "user.prompt_submitted",
      source: "claude_code",
      sourceEventName: "UserPromptSubmit",
      sourceEventId: null,
      occurredAt: FIXTURE_START,
      ingestedAt: FIXTURE_START,
      sensitivity: "sensitive",
      payload: {},
      metadata: { collectorVersion: "0.1.0", sourceVersion: null },
    });

    const result = await capture(store, seeded.runId);
    const event = store.events.get(result?.eventId ?? "missing");

    expect(event?.sequence).toBe(6);
    expect(event?.payload).toEqual({
      baselineId: result?.baselineId,
      outcome: "captured",
      diagnosticCode: null,
      headPresent: true,
      stagedDirty: false,
      unstagedDirty: false,
      untrackedCount: 0,
      untrackedHashedCount: 0,
      untrackedOmittedCount: 0,
      captureDelayMs: 1_000,
    });
  });

  it("rolls back baseline, Event, evidence, Run, and Workspace changes on persistence failure", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);

    await expect(
      capture(store, seeded.runId, { eventIdGenerator: () => "unsafe event id" }),
    ).rejects.toBeInstanceOf(PersistenceError);

    expect(store.gitBaselines.getByRun(seeded.runId)).toBeNull();
    expect(store.events.countAll()).toBe(0);
    expect(store.taskRuns.get(seeded.runId)).toMatchObject({
      baselineWorkingTreeFingerprint: null,
      evidenceGapCount: 0,
      status: "Capturing",
    });
    expect(store.workspaces.get(seeded.workspaceId)).toMatchObject({
      identityBasis: "canonical_path_v1",
      repositoryRoot: root,
    });
    expect(store.runSupport.countEvidenceGaps(seeded.runId)).toBe(0);
  });

  it("keeps separate provisional Workspaces when subdirectories resolve to one Git root", async () => {
    const root = await createRepository();
    const left = join(root, "left");
    const right = join(root, "right");
    await mkdir(left);
    await mkdir(right);
    const store = persistence();
    const first = seedRun(store, left, {
      workspaceId: "workspace-left",
      conversationId: "conversation-left",
      runId: "run-left",
    });
    const second = seedRun(store, right, {
      workspaceId: "workspace-right",
      conversationId: "conversation-right",
      runId: "run-right",
    });

    await capture(store, first.runId);
    await capture(store, second.runId);

    expect(store.workspaces.get(first.workspaceId)).toMatchObject({
      workspaceId: "workspace-left",
      repositoryRoot: root,
      identityBasis: "git_resolved_v1",
    });
    expect(store.workspaces.get(second.workspaceId)).toMatchObject({
      workspaceId: "workspace-right",
      repositoryRoot: root,
      identityBasis: "git_resolved_v1",
    });
  });

  it("produces equal fingerprints for equal repository state and a different fingerprint after change", async () => {
    const root = await createRepository();
    const store = persistence();
    const first = seedRun(store, root, {
      workspaceId: "workspace-shared",
      conversationId: "conversation-shared",
      runId: "run-a",
      runNumber: 1,
    });
    const firstResult = await capture(store, first.runId);
    store.taskRuns.insert({
      runId: "run-b",
      conversationId: first.conversationId,
      runNumber: 2,
      redactedPrompt: "Second prompt",
      baselineGitCommit: null,
      baselineWorkingTreeFingerprint: null,
      startedAt: FIXTURE_START,
      endedAt: null,
      status: "Capturing",
      finalGitFingerprint: null,
      sourceStopReason: null,
      evidenceGapCount: 0,
    });
    const secondResult = await capture(store, "run-b");
    expect(
      store.gitBaselines.get(firstResult?.baselineId ?? "missing")?.workingTreeFingerprint,
    ).toBe(store.gitBaselines.get(secondResult?.baselineId ?? "missing")?.workingTreeFingerprint);

    await appendFile(join(root, "tracked.txt"), "changed\n");
    store.taskRuns.insert({
      runId: "run-c",
      conversationId: first.conversationId,
      runNumber: 3,
      redactedPrompt: "Third prompt",
      baselineGitCommit: null,
      baselineWorkingTreeFingerprint: null,
      startedAt: FIXTURE_START,
      endedAt: null,
      status: "Capturing",
      finalGitFingerprint: null,
      sourceStopReason: null,
      evidenceGapCount: 0,
    });
    await capture(store, "run-c");
    expect(store.gitBaselines.getByRun("run-c")?.workingTreeFingerprint).not.toBe(
      store.gitBaselines.getByRun("run-a")?.workingTreeFingerprint,
    );
  });

  it("lists and captures missing baselines deterministically with a bounded batch", async () => {
    const root = await createRepository();
    const store = persistence();
    const first = seedRun(store, root, {
      workspaceId: "batch-workspace",
      conversationId: "batch-conversation",
      runId: "batch-run-1",
      runNumber: 1,
      startedAt: "2026-07-21T15:00:00.000Z",
    });
    store.taskRuns.insert({
      runId: "batch-run-2",
      conversationId: first.conversationId,
      runNumber: 2,
      redactedPrompt: "Second batch prompt",
      baselineGitCommit: null,
      baselineWorkingTreeFingerprint: null,
      startedAt: "2026-07-21T15:00:01.000Z",
      endedAt: null,
      status: "Capturing",
      finalGitFingerprint: null,
      sourceStopReason: null,
      evidenceGapCount: 0,
    });

    expect(store.gitBaselines.listRunIdsMissingBaseline(1)).toEqual(["batch-run-1"]);
    const results = await captureMissingGitBaselines(dependencies(store), 1);
    expect(results.map((result) => result.runId)).toEqual(["batch-run-1"]);
    expect(store.gitBaselines.listRunIdsMissingBaseline(25)).toEqual(["batch-run-2"]);
  });

  it("persists baseline state and Event order across file-backed reopen", async () => {
    const root = await createRepository();
    const databaseDirectory = await temporaryDirectory("ownloop-git-baseline-db-");
    const databasePath = join(databaseDirectory, "ownloop.sqlite");
    const firstStore = persistence(databasePath);
    const seeded = seedRun(firstStore, root);
    const result = await capture(firstStore, seeded.runId);
    firstStore.close();
    openHandles.splice(openHandles.indexOf(firstStore), 1);

    const reopened = persistence(databasePath);
    expect(reopened.gitBaselines.getByRun(seeded.runId)?.baselineId).toBe(result?.baselineId);
    expect(reopened.events.listForRun(seeded.runId).map((event) => event.eventId)).toEqual([
      result?.eventId,
    ]);
    expect(reopened.workspaces.get(seeded.workspaceId)?.identityBasis).toBe("git_resolved_v1");
  });

  it("preserves Task Run cascade deletion after a baseline Event exists", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    const result = await capture(store, seeded.runId);

    expect(store.taskRuns.delete(seeded.runId)).toBe(true);
    expect(store.gitBaselines.getByRun(seeded.runId)).toBeNull();
    expect(store.events.get(result?.eventId ?? "missing")).toBeNull();
  });

  it("uses only the approved read-only Git command families", async () => {
    const root = await createRepository();
    const store = persistence();
    const seeded = seedRun(store, root);
    const commands: string[][] = [];
    const runner: GitCommandRunner = async (request) => {
      commands.push([...request.args]);
      return await runGitCommand(request);
    };

    await capture(store, seeded.runId, { runner });

    const commandNames = commands.map((args) => args[2]);
    expect(
      commandNames.every((command) =>
        ["rev-parse", "status", "diff", "ls-files"].includes(command ?? ""),
      ),
    ).toBe(true);
    const serialized = JSON.stringify(commands);
    for (const forbidden of [
      "add",
      "commit",
      "checkout",
      "switch",
      "reset",
      "clean",
      "restore",
      "stash",
      "update-index",
      "apply",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});

describe("Git baseline migration constraints", () => {
  it("upgrades a version-4 database to version 5 idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 4));
      expect(readAppliedMigrations(opened.database)).toHaveLength(4);
      runMigrations(opened.database);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects baseline and entry updates after file-backed capture", async () => {
    const root = await createRepository();
    const databaseDirectory = await temporaryDirectory("ownloop-git-baseline-immutable-");
    const databasePath = join(databaseDirectory, "ownloop.sqlite");
    const store = persistence(databasePath);
    const seeded = seedRun(store, root);
    await writeFile(join(root, "immutable-untracked.txt"), "fixture", "utf8");
    const result = await capture(store, seeded.runId);
    if (result === null) {
      throw new Error("The Git baseline fixture did not produce a result.");
    }
    await writeFile(join(root, "later.txt"), "later", "utf8");
    store.close();
    openHandles.splice(openHandles.indexOf(store), 1);

    const opened = openConfiguredDatabase(databasePath);
    try {
      runMigrations(opened.database);
      expect(() =>
        opened.database
          .prepare("UPDATE git_baselines SET capture_delay_ms = 2 WHERE baseline_id = ?")
          .run(result.baselineId),
      ).toThrow();
      const entry = opened.database
        .prepare("SELECT baseline_id, entry_index FROM git_baseline_untracked_entries LIMIT 1")
        .get();
      if (entry !== undefined) {
        const baselineId = entry.baseline_id;
        const entryIndex = entry.entry_index;
        if (typeof baselineId !== "string" || typeof entryIndex !== "number") {
          throw new Error("The persisted baseline entry fixture has invalid identifiers.");
        }
        expect(() =>
          opened.database
            .prepare(
              "UPDATE git_baseline_untracked_entries SET hash_status = 'unreadable' WHERE baseline_id = ? AND entry_index = ?",
            )
            .run(baselineId, entryIndex),
        ).toThrow();
      }
    } finally {
      opened.database.close();
    }
  });
});
