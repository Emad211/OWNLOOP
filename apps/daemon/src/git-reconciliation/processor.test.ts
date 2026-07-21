import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  NormalizedEventEnvelopeSchema,
  type NormalizedEventType,
} from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import { captureGitBaseline } from "../git-baseline/processor.js";
import { runGitCommand, type GitCommandRunner } from "../git-baseline/git-runner.js";
import { openConfiguredDatabase } from "../persistence/database.js";
import { MIGRATIONS } from "../persistence/migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "../persistence/migrations.js";
import {
  openPersistence,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import {
  getGitReconciliation,
  listEligibleUnreconciledGitTriggerIds,
  reconcileEligibleGitTriggers,
  reconcileGitAtTrigger,
  type GitReconciliationDependencies,
} from "./processor.js";

const execFileAsync = promisify(execFile);
const START = "2026-07-21T15:00:00.000Z";
const BASELINE_TIME = "2026-07-21T15:00:01.000Z";
const TRIGGER_TIME = "2026-07-21T15:00:02.000Z";
const RECONCILIATION_TIME = "2026-07-21T15:00:03.000Z";
const temporaryDirectories: string[] = [];
const openHandles: OwnLoopPersistence[] = [];
let fixtureCounter = 0;

async function temporaryDirectory(prefix = "ownloop-git-reconciliation-"): Promise<string> {
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
    env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const root = await temporaryDirectory();
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["config", "user.name", "OwnLoop Fixture"]);
  await writeFile(join(root, "tracked.txt"), "initial\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  return await realpath(root);
}

function pathFingerprint(path: string): string {
  return `path-sha256:${createHash("sha256").update(path).digest("hex")}`;
}

function persistence(path = ":memory:"): OwnLoopPersistence {
  const store = openPersistence(path);
  openHandles.push(store);
  return store;
}

function seedRun(store: OwnLoopPersistence, root: string, idPrefix = "fixture") {
  fixtureCounter += 1;
  const suffix = `${idPrefix}-${fixtureCounter}`;
  const workspaceId = `workspace-${suffix}`;
  const conversationId = `conversation-${suffix}`;
  const runId = `run-${suffix}`;
  store.workspaces.insert({
    workspaceId,
    canonicalPath: root,
    repositoryRoot: root,
    gitRemote: null,
    initialRepositoryFingerprint: pathFingerprint(root),
    identityBasis: "canonical_path_v1",
    createdAt: START,
    lastObservedAt: START,
  });
  store.conversations.insert({
    conversationId,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `source-${suffix}`,
    startMode: "startup",
    startedAt: START,
    lastObservedAt: START,
    endedAt: null,
    status: "Active",
  });
  store.taskRuns.insert({
    runId,
    conversationId,
    runNumber: 1,
    redactedPrompt: "Neutral reconciliation prompt.",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: START,
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  });
  return { workspaceId, conversationId, runId };
}

async function captureBaseline(store: OwnLoopPersistence, runId: string, executable = "git") {
  return await captureGitBaseline(
    {
      persistence: store,
      executable,
      clock: () => new Date(BASELINE_TIME),
      lateCaptureThresholdMs: 30_000,
    },
    runId,
  );
}

function appendTrigger(
  store: OwnLoopPersistence,
  aggregate: ReturnType<typeof seedRun>,
  type: Extract<
    NormalizedEventType,
    "tool.batch_completed" | "run.stop_observed" | "run.stop_failed"
  >,
  eventId = `trigger-${fixtureCounter}-${type.replaceAll(".", "-")}`,
): string {
  const event = NormalizedEventEnvelopeSchema.parse({
    eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: aggregate.workspaceId,
    conversationId: aggregate.conversationId,
    runId: aggregate.runId,
    sequence: store.events.nextSequence(aggregate.runId),
    type,
    source: "claude_code",
    sourceEventName:
      type === "tool.batch_completed"
        ? "PostToolBatch"
        : type === "run.stop_observed"
          ? "Stop"
          : "StopFailure",
    sourceEventId: null,
    occurredAt: TRIGGER_TIME,
    ingestedAt: TRIGGER_TIME,
    sensitivity: "sensitive",
    payload: {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
  store.events.append(event);
  return eventId;
}

function appendOwnLoopSummaryEvent(
  store: OwnLoopPersistence,
  aggregate: ReturnType<typeof seedRun>,
  eventId: string,
): string {
  store.events.append(
    NormalizedEventEnvelopeSchema.parse({
      eventId,
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      workspaceId: aggregate.workspaceId,
      conversationId: aggregate.conversationId,
      runId: aggregate.runId,
      sequence: store.events.nextSequence(aggregate.runId),
      type: "git.diff_computed",
      source: "ownloop",
      sourceEventName: null,
      sourceEventId: null,
      occurredAt: RECONCILIATION_TIME,
      ingestedAt: RECONCILIATION_TIME,
      sensitivity: "normal",
      payload: {},
      metadata: { collectorVersion: "0.1.0", sourceVersion: null },
    }),
  );
  return eventId;
}

function dependencies(
  store: OwnLoopPersistence,
  overrides: Partial<GitReconciliationDependencies> = {},
): GitReconciliationDependencies {
  return {
    persistence: store,
    clock: () => new Date(RECONCILIATION_TIME),
    ...overrides,
  };
}

function assertSafe(value: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const item of forbidden) {
    expect(serialized).not.toContain(item);
  }
}

describe("Git reconciliation processor", () => {
  it.each([
    ["tool.batch_completed", "tool_batch"],
    ["run.stop_observed", "stop"],
    ["run.stop_failed", "stop_failure"],
  ] as const)("reconciles %s as %s", async (eventType, boundary) => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, eventType);
    await captureBaseline(store, aggregate.runId);
    await appendFile(join(root, "tracked.txt"), `${eventType}\n`);
    const triggerEventId = appendTrigger(store, aggregate, eventType);

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);

    expect(result).toMatchObject({
      triggerEventId,
      outcome: "captured",
      diagnosticCode: null,
      attribution: "run_relative",
      baselineComparison: "changed",
      entryCount: 1,
      modifiedCount: 1,
    });
    const reconciliation = store.gitReconciliations.getByTriggerEvent(triggerEventId);
    expect(reconciliation?.boundary).toBe(boundary);
    expect(reconciliation?.entries[0]).toMatchObject({
      relativePath: "tracked.txt",
      changeKind: "modified",
      attribution: "run_relative",
    });
  });

  it("suppresses file Events when the reliable fingerprint is unchanged", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "unchanged");
    await captureBaseline(store, aggregate.runId);
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);

    expect(result).toMatchObject({
      outcome: "captured",
      attribution: "run_relative",
      baselineComparison: "unchanged",
      entryCount: 0,
      fileEventIds: [],
    });
    const events = store.events.listForRun(aggregate.runId);
    expect(events.at(-1)?.type).toBe("git.diff_computed");
    expect(events.filter((event) => event.type === "file.change_observed")).toHaveLength(0);
  });

  it("labels changes observed-only when the captured baseline was dirty", async () => {
    const root = await createRepository();
    await appendFile(join(root, "tracked.txt"), "pre-existing\n");
    const store = persistence();
    const aggregate = seedRun(store, root, "dirty");
    await captureBaseline(store, aggregate.runId);
    await writeFile(join(root, "new.txt"), "new", "utf8");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);

    expect(result).toMatchObject({
      outcome: "captured",
      attribution: "observed_only",
      baselineComparison: "changed",
      entryCount: 2,
    });
    expect(
      store.gitReconciliations
        .getByTriggerEvent(triggerEventId)
        ?.entries.every((entry) => entry.attribution === "observed_only"),
    ).toBe(true);
  });

  it("records baseline-missing evidence without changing Run lifecycle", async () => {
    const root = await createRepository();
    await writeFile(join(root, "untracked.txt"), "neutral", "utf8");
    const store = persistence();
    const aggregate = seedRun(store, root, "missing");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "baseline_missing",
      attribution: "unavailable",
      baselineComparison: "unavailable",
      entryCount: 1,
    });
    expect(store.taskRuns.get(aggregate.runId)).toMatchObject({
      status: "Capturing",
      evidenceGapCount: 1,
    });
    expect(store.runSupport.listEvidenceGaps(aggregate.runId)).toHaveLength(1);
  });

  it("uses baseline-partial attribution and increments evidence exactly once", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "partial");
    await captureBaseline(store, aggregate.runId, "definitely-missing-git-executable");
    const triggerEventId = appendTrigger(store, aggregate, "run.stop_observed");

    const first = await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    const second = await reconcileGitAtTrigger(
      dependencies(store, {
        runner: async () => {
          throw new Error("Idempotent reconciliation must not execute Git.");
        },
      }),
      triggerEventId,
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      outcome: "partial",
      diagnosticCode: "baseline_partial",
      attribution: "unavailable",
      baselineComparison: "unavailable",
    });
    expect(store.taskRuns.get(aggregate.runId)?.status).toBe("Capturing");
    expect(store.taskRuns.get(aggregate.runId)?.evidenceGapCount).toBe(2);
    expect(store.runSupport.listEvidenceGaps(aggregate.runId)).toHaveLength(2);
  });

  it("rejects non-eligible and conversation-level Events before Git execution", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "reject");
    const eventId = "non-eligible-event";
    store.events.append(
      NormalizedEventEnvelopeSchema.parse({
        eventId,
        schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
        workspaceId: aggregate.workspaceId,
        conversationId: aggregate.conversationId,
        runId: null,
        sequence: null,
        type: "conversation.ended",
        source: "claude_code",
        sourceEventName: "SessionEnd",
        sourceEventId: null,
        occurredAt: TRIGGER_TIME,
        ingestedAt: TRIGGER_TIME,
        sensitivity: "normal",
        payload: {},
        metadata: { collectorVersion: "0.1.0", sourceVersion: null },
      }),
    );
    let calls = 0;
    const result = await reconcileGitAtTrigger(
      dependencies(store, {
        runner: async () => {
          calls += 1;
          return { stdout: Buffer.alloc(0), stdoutSha256: "0".repeat(64), stdoutBytes: 0 };
        },
      }),
      eventId,
    );
    expect(result).toBeNull();
    expect(calls).toBe(0);
    expect(store.gitReconciliations.countAll()).toBe(0);
  });

  it("persists summary and file Events in contiguous deterministic sequence order", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "sequence");
    await captureBaseline(store, aggregate.runId);
    await writeFile(join(root, "z.txt"), "z", "utf8");
    await writeFile(join(root, "a.txt"), "a", "utf8");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    const events = store.events.listForRun(aggregate.runId);
    const emitted = events.filter(
      (event) =>
        event.eventId === result?.summaryEventId || result?.fileEventIds.includes(event.eventId),
    );
    expect(emitted.map((event) => event.sequence)).toEqual([3, 4, 5]);
    expect(emitted.map((event) => event.type)).toEqual([
      "git.diff_computed",
      "file.change_observed",
      "file.change_observed",
    ]);
    expect(
      store.gitReconciliations
        .getByTriggerEvent(triggerEventId)
        ?.entries.map((entry) => entry.pathIdentitySha256),
    ).toEqual(
      [...(store.gitReconciliations.getByTriggerEvent(triggerEventId)?.entries ?? [])]
        .map((entry) => entry.pathIdentitySha256)
        .sort(),
    );
  });

  it("keeps sensitive paths out of results, evidence, and file Event payloads", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "secret");
    await captureBaseline(store, aggregate.runId);
    await writeFile(join(root, ".env.production"), "TOP_SECRET_VALUE", "utf8");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    const reconciliation = store.gitReconciliations.getByTriggerEvent(triggerEventId);
    expect(reconciliation?.entries[0]).toMatchObject({
      relativePath: null,
      sensitivity: "secret",
    });
    const fileEvent = store.events.get(result?.fileEventIds[0] ?? "missing");
    const summaryEvent = store.events.get(result?.summaryEventId ?? "missing");
    expect(fileEvent).toMatchObject({ sensitivity: "secret" });
    expect(fileEvent?.payload).toMatchObject({ relativePath: null });
    expect(summaryEvent?.payload).toEqual({
      reconciliationId: result?.reconciliationId,
      boundary: "tool_batch",
      outcome: "captured",
      diagnosticCode: null,
      attribution: "run_relative",
      baselineComparison: "changed",
      headChanged: false,
      stagedDirty: false,
      unstagedDirty: false,
      entryCount: 1,
      createdCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      typeChangedCount: 0,
      unmergedCount: 0,
    });
    const baseline = store.gitBaselines.getByRun(aggregate.runId);
    assertSafe(
      {
        result,
        summaryEvent,
        fileEvent,
        gaps: store.runSupport.listEvidenceGaps(aggregate.runId),
      },
      [
        root,
        ".env.production",
        "TOP_SECRET_VALUE",
        baseline?.headCommit ?? "missing-head",
        baseline?.workingTreeFingerprint ?? "missing-fingerprint",
      ],
    );
  });

  it("converts malformed status output into a controlled partial reconciliation", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "invalid-status");
    await captureBaseline(store, aggregate.runId);
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    const runner: GitCommandRunner = async (request) => {
      if (request.args.includes("--no-renames")) {
        const stdout = Buffer.from("unsupported\0", "utf8");
        return {
          stdout,
          stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
          stdoutBytes: stdout.length,
        };
      }
      return await runGitCommand(request);
    };

    const result = await reconcileGitAtTrigger(dependencies(store, { runner }), triggerEventId);
    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "invalid_status_output",
      attribution: "unavailable",
      baselineComparison: "unavailable",
      entryCount: 0,
    });
  });

  it("detects a repository change between fingerprint capture and status attribution", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "race");
    await captureBaseline(store, aggregate.runId);
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    let mutated = false;
    const runner: GitCommandRunner = async (request) => {
      if (request.args.includes("--no-renames") && !mutated) {
        mutated = true;
        await writeFile(join(root, "late-change.txt"), "late", "utf8");
      }
      return await runGitCommand(request);
    };

    const result = await reconcileGitAtTrigger(dependencies(store, { runner }), triggerEventId);

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "repository_changed_during_capture",
      attribution: "unavailable",
      baselineComparison: "unavailable",
      entryCount: 1,
    });
  });

  it("persists a deterministic bounded prefix when the status entry limit is exceeded", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "entry-limit");
    await captureBaseline(store, aggregate.runId);
    await writeFile(join(root, "one.txt"), "one", "utf8");
    await writeFile(join(root, "two.txt"), "two", "utf8");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");

    const result = await reconcileGitAtTrigger(
      dependencies(store, {
        limits: {
          commandTimeoutMs: 10_000,
          maximumCommandOutputBytes: 8 * 1024 * 1024,
          maximumUntrackedEntries: 10_000,
          maximumUntrackedHashBytes: 1024 * 1024,
          maximumStatusEntries: 1,
        },
      }),
      triggerEventId,
    );

    expect(result).toMatchObject({
      outcome: "partial",
      diagnosticCode: "status_entry_limit_exceeded",
      attribution: "unavailable",
      baselineComparison: "unavailable",
      entryCount: 1,
    });
    expect(store.taskRuns.get(aggregate.runId)?.evidenceGapCount).toBe(1);
  });

  it("rolls back Events, reconciliation, entries, evidence, and sequence on failure", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "rollback");
    await captureBaseline(store, aggregate.runId);
    await writeFile(join(root, "new.txt"), "new", "utf8");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    const beforeEvents = store.events.countAll();
    const beforeGaps = store.taskRuns.get(aggregate.runId)?.evidenceGapCount;

    await expect(
      reconcileGitAtTrigger(
        dependencies(store, { eventIdGenerator: () => "unsafe event id" }),
        triggerEventId,
      ),
    ).rejects.toBeInstanceOf(PersistenceError);

    expect(store.events.countAll()).toBe(beforeEvents);
    expect(store.gitReconciliations.getByTriggerEvent(triggerEventId)).toBeNull();
    expect(store.taskRuns.get(aggregate.runId)?.evidenceGapCount).toBe(beforeGaps);
    expect(store.events.nextSequence(aggregate.runId)).toBe(3);
  });

  it("lists and reconciles eligible triggers in a bounded deterministic batch", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "batch");
    await captureBaseline(store, aggregate.runId);
    const first = appendTrigger(store, aggregate, "tool.batch_completed", "trigger-batch-a");
    const second = appendTrigger(store, aggregate, "run.stop_observed", "trigger-batch-b");

    expect(await listEligibleUnreconciledGitTriggerIds(store, 1)).toEqual([first]);
    const results = await reconcileEligibleGitTriggers(dependencies(store), 1);
    expect(results.map((result) => result.triggerEventId)).toEqual([first]);
    expect(await getGitReconciliation(store, results[0]?.reconciliationId ?? "missing")).toEqual(
      results[0],
    );
    expect(store.gitReconciliations.listEligibleUnreconciledTriggerEventIds(25)).toEqual([second]);
    expect(await reconcileEligibleGitTriggers(dependencies(store), 26)).toEqual([]);
  });

  it("preserves reconciliation relationships across file-backed reopen and Run cascade deletion", async () => {
    const root = await createRepository();
    const databaseDirectory = await temporaryDirectory("ownloop-reconciliation-db-");
    const databasePath = join(databaseDirectory, "ownloop.sqlite");
    const store = persistence(databasePath);
    const aggregate = seedRun(store, root, "durable");
    await captureBaseline(store, aggregate.runId);
    await appendFile(join(root, "tracked.txt"), "changed\n");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    store.close();
    openHandles.splice(openHandles.indexOf(store), 1);

    const reopened = persistence(databasePath);
    expect(reopened.gitReconciliations.getByTriggerEvent(triggerEventId)).toMatchObject({
      reconciliationId: result?.reconciliationId,
      summaryEventId: result?.summaryEventId,
      entryCount: 1,
    });
    expect(reopened.taskRuns.delete(aggregate.runId)).toBe(true);
    expect(reopened.gitReconciliations.getByTriggerEvent(triggerEventId)).toBeNull();
    expect(reopened.events.get(result?.summaryEventId ?? "missing")).toBeNull();
  });

  it("uses only approved read-only Git command families", async () => {
    const root = await createRepository();
    const store = persistence();
    const aggregate = seedRun(store, root, "commands");
    await captureBaseline(store, aggregate.runId);
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    const commands: readonly string[][] = [];
    const mutableCommands = commands as string[][];
    const runner: GitCommandRunner = async (request) => {
      mutableCommands.push([...request.args]);
      return await runGitCommand(request);
    };
    await reconcileGitAtTrigger(dependencies(store, { runner }), triggerEventId);
    const names = mutableCommands.map((args) => args[2]);
    expect(
      names.every((name) => ["rev-parse", "status", "diff", "ls-files"].includes(name ?? "")),
    ).toBe(true);
    const serialized = JSON.stringify(mutableCommands);
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

describe("Git reconciliation migration constraints", () => {
  it("upgrades a version-5 database to version 6 and reopens idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 5));
      expect(readAppliedMigrations(opened.database)).toHaveLength(5);
      runMigrations(opened.database);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("detects non-contiguous persisted entry linkage corruption", async () => {
    const root = await createRepository();
    const databaseDirectory = await temporaryDirectory("ownloop-reconciliation-corrupt-");
    const databasePath = join(databaseDirectory, "ownloop.sqlite");
    const store = persistence(databasePath);
    const aggregate = seedRun(store, root, "corrupt");
    await captureBaseline(store, aggregate.runId);
    await appendFile(join(root, "tracked.txt"), "changed\n");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    store.close();
    openHandles.splice(openHandles.indexOf(store), 1);

    const opened = openConfiguredDatabase(databasePath);
    try {
      runMigrations(opened.database);
      opened.database.exec("DROP TRIGGER git_reconciliation_entries_reject_update");
      opened.database.exec(
        "UPDATE git_reconciliation_entries SET entry_index = 1 WHERE entry_index = 0",
      );
    } finally {
      opened.database.close();
    }

    const reopened = persistence(databasePath);
    expect(() => reopened.gitReconciliations.getByTriggerEvent(triggerEventId)).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });

  it("rejects cross-aggregate Event ownership and invalid partial attribution", async () => {
    const root = await createRepository();
    const secondRoot = await createRepository();
    const store = persistence();
    const first = seedRun(store, root, "constraint-first");
    const second = seedRun(store, secondRoot, "constraint-second");
    await captureBaseline(store, first.runId);
    await captureBaseline(store, second.runId);
    const triggerEventId = appendTrigger(
      store,
      first,
      "tool.batch_completed",
      "constraint-trigger",
    );
    const foreignSummaryEventId = appendOwnLoopSummaryEvent(
      store,
      second,
      "constraint-foreign-summary",
    );
    const baseline = store.gitBaselines.getByRun(first.runId);
    if (baseline === null) {
      throw new Error("The constraint fixture baseline is missing.");
    }

    expect(() =>
      store.gitReconciliations.insert({
        reconciliationId: "constraint-cross-aggregate",
        runId: first.runId,
        workspaceId: first.workspaceId,
        conversationId: first.conversationId,
        baselineId: baseline.baselineId,
        triggerEventId,
        summaryEventId: foreignSummaryEventId,
        boundary: "tool_batch",
        outcome: "captured",
        diagnosticCode: null,
        attribution: "run_relative",
        baselineComparison: "unchanged",
        repositoryRoot: root,
        headCommit: baseline.headCommit,
        stagedDiffSha256: baseline.stagedDiffSha256,
        unstagedDiffSha256: baseline.unstagedDiffSha256,
        statusBeforeSha256: baseline.statusBeforeSha256,
        statusAfterSha256: baseline.statusAfterSha256,
        workingTreeFingerprint: baseline.workingTreeFingerprint,
        stagedDirty: false,
        unstagedDirty: false,
        entryCount: 0,
        createdCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        typeChangedCount: 0,
        unmergedCount: 0,
        capturedAt: RECONCILIATION_TIME,
      }),
    ).toThrowError(expect.objectContaining({ code: "constraint_violation" }));

    const localSummaryEventId = appendOwnLoopSummaryEvent(store, first, "constraint-local-summary");
    expect(() =>
      store.gitReconciliations.insert({
        reconciliationId: "constraint-invalid-partial",
        runId: first.runId,
        workspaceId: first.workspaceId,
        conversationId: first.conversationId,
        baselineId: null,
        triggerEventId,
        summaryEventId: localSummaryEventId,
        boundary: "tool_batch",
        outcome: "partial",
        diagnosticCode: "baseline_missing",
        attribution: "observed_only",
        baselineComparison: "unavailable",
        repositoryRoot: root,
        headCommit: null,
        stagedDiffSha256: null,
        unstagedDiffSha256: null,
        statusBeforeSha256: null,
        statusAfterSha256: null,
        workingTreeFingerprint: null,
        stagedDirty: false,
        unstagedDirty: false,
        entryCount: 0,
        createdCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        typeChangedCount: 0,
        unmergedCount: 0,
        capturedAt: RECONCILIATION_TIME,
      }),
    ).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
  });

  it("rejects reconciliation and entry updates", async () => {
    const root = await createRepository();
    const databaseDirectory = await temporaryDirectory("ownloop-reconciliation-immutable-");
    const databasePath = join(databaseDirectory, "ownloop.sqlite");
    const store = persistence(databasePath);
    const aggregate = seedRun(store, root, "immutable");
    await captureBaseline(store, aggregate.runId);
    await appendFile(join(root, "tracked.txt"), "changed\n");
    const triggerEventId = appendTrigger(store, aggregate, "tool.batch_completed");
    const result = await reconcileGitAtTrigger(dependencies(store), triggerEventId);
    store.close();
    openHandles.splice(openHandles.indexOf(store), 1);

    const opened = openConfiguredDatabase(databasePath);
    try {
      runMigrations(opened.database);
      expect(() =>
        opened.database
          .prepare("UPDATE git_reconciliations SET captured_at = ? WHERE reconciliation_id = ?")
          .run(RECONCILIATION_TIME, result?.reconciliationId ?? "missing"),
      ).toThrow();
      expect(() =>
        opened.database
          .prepare(
            "UPDATE git_reconciliation_entries SET change_kind = 'deleted' WHERE reconciliation_id = ? AND entry_index = 0",
          )
          .run(result?.reconciliationId ?? "missing"),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });
});
