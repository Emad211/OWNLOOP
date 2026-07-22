import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStoreError,
  createLocalArtifactStore,
  type LocalArtifactStore,
} from "../artifact-store/index.js";
import {
  type OwnLoopPersistence,
  openPersistence,
  type PersistenceError,
} from "../persistence/index.js";
import {
  FINAL_DIFF_MANIFEST_ROLE,
  finalizeRun,
  getRunFinalization,
  type RunFinalizationDependencies,
  recoverStaleRuns,
} from "./index.js";

const STARTED_AT = "2026-07-22T10:00:00.000Z";
const STOPPED_AT = "2026-07-22T10:01:00.000Z";
const FINALIZED_AT = "2026-07-22T10:02:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function event(
  input: Readonly<{
    eventId: string;
    type: NormalizedEventEnvelope["type"];
    sequence: number;
    at?: string;
  }>,
): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    source: input.type.startsWith("run.stop") ? "claude_code" : "ownloop",
    sourceEventName: input.type.startsWith("run.stop") ? "Stop" : null,
    sourceEventId: null,
    occurredAt: input.at ?? STARTED_AT,
    ingestedAt: input.at ?? STARTED_AT,
    sensitivity: "normal",
    payload: {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

function seedAggregates(
  persistence: OwnLoopPersistence,
  input: Readonly<{
    status?: "Capturing" | "Finalizing";
    lastObservedAt?: string;
    stopFailure?: boolean;
    baselineOutcome?: "captured" | "partial" | "missing";
    reconciliationOutcome?: "captured" | "partial" | "missing";
    existingGap?: boolean;
  }> = {},
): void {
  const status = input.status ?? "Finalizing";
  persistence.workspaces.insert({
    workspaceId: "workspace-1",
    canonicalPath: "/workspace/project",
    repositoryRoot: "/workspace/project",
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: STARTED_AT,
    lastObservedAt: input.lastObservedAt ?? STOPPED_AT,
  });
  persistence.conversations.insert({
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    source: "claude_code",
    sourceSessionId: "session-1",
    startMode: "startup",
    startedAt: STARTED_AT,
    lastObservedAt: input.lastObservedAt ?? STOPPED_AT,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: input.baselineOutcome === "missing" ? null : COMMIT,
    baselineWorkingTreeFingerprint: input.baselineOutcome === "missing" ? null : HASH_A,
    startedAt: STARTED_AT,
    endedAt: null,
    status,
    finalGitFingerprint: null,
    sourceStopReason: input.stopFailure
      ? "controlled failure"
      : status === "Finalizing"
        ? "stop"
        : null,
    evidenceGapCount: input.existingGap ? 1 : 0,
  });

  if (status === "Capturing") {
    return;
  }

  const baselineEvent = event({
    eventId: "baseline-event",
    type: "snapshot.baseline_captured",
    sequence: 1,
  });
  const stopEvent = event({
    eventId: "stop-event",
    type: input.stopFailure ? "run.stop_failed" : "run.stop_observed",
    sequence: 2,
    at: STOPPED_AT,
  });
  persistence.events.append(baselineEvent);
  persistence.events.append(stopEvent);

  if (input.baselineOutcome !== "missing") {
    persistence.gitBaselines.insert({
      baselineId: "baseline-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
      baselineEventId: "baseline-event",
      outcome: input.baselineOutcome ?? "captured",
      diagnosticCode: input.baselineOutcome === "partial" ? "late_capture" : null,
      repositoryRoot: "/workspace/project",
      headCommit: COMMIT,
      stagedDiffSha256: HASH_A,
      unstagedDiffSha256: HASH_A,
      statusBeforeSha256: HASH_A,
      statusAfterSha256: HASH_A,
      workingTreeFingerprint: HASH_A,
      stagedDirty: false,
      unstagedDirty: false,
      untrackedCount: 0,
      untrackedHashedCount: 0,
      untrackedOmittedCount: 0,
      capturedAt: STARTED_AT,
      captureDelayMs: 0,
    });
  }

  if (input.reconciliationOutcome !== "missing") {
    const summaryEvent = event({
      eventId: "summary-event",
      type: "git.diff_computed",
      sequence: 3,
      at: STOPPED_AT,
    });
    persistence.events.append(summaryEvent);
    const captured = (input.reconciliationOutcome ?? "captured") === "captured";
    persistence.gitReconciliations.insert({
      reconciliationId: "reconciliation-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
      baselineId: input.baselineOutcome === "missing" ? null : "baseline-1",
      triggerEventId: "stop-event",
      summaryEventId: "summary-event",
      boundary: input.stopFailure ? "stop_failure" : "stop",
      outcome: captured ? "captured" : "partial",
      diagnosticCode: captured ? null : "baseline_partial",
      attribution: captured ? "run_relative" : "unavailable",
      baselineComparison: captured ? "changed" : "unavailable",
      repositoryRoot: "/workspace/project",
      headCommit: COMMIT,
      stagedDiffSha256: HASH_B,
      unstagedDiffSha256: HASH_B,
      statusBeforeSha256: HASH_B,
      statusAfterSha256: HASH_B,
      workingTreeFingerprint: captured ? HASH_B : null,
      stagedDirty: true,
      unstagedDirty: false,
      entryCount: 0,
      createdCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      typeChangedCount: 0,
      unmergedCount: 0,
      capturedAt: STOPPED_AT,
    });
  }

  if (input.existingGap) {
    persistence.runSupport.insertEvidenceGap({
      gapId: "existing-gap",
      runId: "run-1",
      code: "earlier_gap",
      message: "Earlier controlled evidence gap.",
      detailsJson: null,
      createdAt: STARTED_AT,
    });
  }
}

async function createContext(
  input: Parameters<typeof seedAggregates>[1] = {},
  databasePath = ":memory:",
): Promise<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  dependencies: RunFinalizationDependencies;
  directory: string;
}> {
  const directory = await temporaryDirectory("ownloop-finalization-");
  const persistence = openPersistence(databasePath);
  seedAggregates(persistence, input);
  const artifactStore = await createLocalArtifactStore({
    artifactRoot: join(directory, "artifacts"),
    persistence,
    clock: () => new Date(FINALIZED_AT),
    artifactIdGenerator: () => "artifact-1",
  });
  const ids = ["snapshot-event", "terminal-event"];
  return {
    persistence,
    artifactStore,
    directory,
    dependencies: {
      persistence,
      artifactStore,
      clock: () => new Date(FINALIZED_AT),
      finalizationIdGenerator: () => "finalization-1",
      eventIdGenerator: () => ids.shift() ?? "extra-event",
      evidenceGapIdGenerator: () => "finalization-gap",
    },
  };
}

describe("Run finalization", () => {
  it("finalizes a complete normal Stop as Completed with contiguous Events and manifest", async () => {
    const context = await createContext();
    try {
      const result = await finalizeRun(context.dependencies, "run-1");
      expect(result).toMatchObject({
        terminalStatus: "Completed",
        diagnosticCode: null,
        finalSnapshotEventId: "snapshot-event",
        terminalEventId: "terminal-event",
        manifestArtifactId: "artifact-1",
      });
      const run = context.persistence.taskRuns.get("run-1");
      expect(run).toMatchObject({
        status: "Completed",
        endedAt: FINALIZED_AT,
        finalGitFingerprint: HASH_B,
        evidenceGapCount: 0,
      });
      const events = context.persistence.events.listForRun("run-1");
      expect(events.map((entry) => [entry.sequence, entry.type])).toEqual([
        [1, "snapshot.baseline_captured"],
        [2, "run.stop_observed"],
        [3, "git.diff_computed"],
        [4, "snapshot.final_captured"],
        [5, "run.completed"],
      ]);
      expect(context.persistence.artifacts.listRecordsForRun("run-1")[0]?.reference.role).toBe(
        FINAL_DIFF_MANIFEST_ROLE,
      );
      const manifest = await context.artifactStore.readPreparedBytes("artifact-1");
      const text = new TextDecoder().decode(manifest.bytes);
      expect(text).not.toContain("/workspace/project");
      expect(text).not.toContain(COMMIT);
      expect(text).not.toContain("raw patch");

      const repeated = await finalizeRun(context.dependencies, "run-1");
      expect(repeated).toEqual(result);
      expect(context.persistence.events.listForRun("run-1")).toHaveLength(5);
    } finally {
      context.persistence.close();
    }
  });

  it("finalizes incomplete normal Stops as Partial without duplicating existing gaps", async () => {
    const context = await createContext({ existingGap: true });
    try {
      const result = await finalizeRun(context.dependencies, "run-1");
      expect(result).toMatchObject({
        terminalStatus: "Partial",
        diagnosticCode: "existing_evidence_gaps",
      });
      expect(context.persistence.runSupport.countEvidenceGaps("run-1")).toBe(1);
      expect(context.persistence.taskRuns.get("run-1")?.evidenceGapCount).toBe(1);
      expect(context.persistence.events.listForRun("run-1").at(-1)?.type).toBe("run.partial");
    } finally {
      context.persistence.close();
    }
  });

  it("maps StopFailure to Failed and records one controlled evidence gap", async () => {
    const context = await createContext({ stopFailure: true });
    try {
      const result = await finalizeRun(context.dependencies, "run-1");
      expect(result).toMatchObject({
        terminalStatus: "Failed",
        diagnosticCode: "source_stop_failure",
      });
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Failed");
      expect(context.persistence.runSupport.listEvidenceGaps("run-1")).toEqual([
        expect.objectContaining({ code: "source_stop_failure", detailsJson: null }),
      ]);
      expect(context.persistence.events.listForRun("run-1").at(-1)?.type).toBe("run.failed");
    } finally {
      context.persistence.close();
    }
  });

  it("uses Partial for a partial reconciliation and keeps the active lifecycle evidence explicit", async () => {
    const context = await createContext({ reconciliationOutcome: "partial" });
    try {
      const result = await finalizeRun(context.dependencies, "run-1");
      expect(result).toMatchObject({
        terminalStatus: "Partial",
        diagnosticCode: "final_reconciliation_partial",
      });
      expect(context.persistence.taskRuns.get("run-1")?.finalGitFingerprint).toBeNull();
      expect(context.persistence.runSupport.countEvidenceGaps("run-1")).toBe(1);
    } finally {
      context.persistence.close();
    }
  });

  it("propagates artifact integrity corruption instead of downgrading it to Partial", async () => {
    const context = await createContext();
    const corruptedStore = new Proxy(context.artifactStore, {
      get(target, property, receiver) {
        if (property === "putPreparedBytes") {
          return async (..._args: Parameters<LocalArtifactStore["putPreparedBytes"]>) => {
            throw new ArtifactStoreError("artifact_content_corrupt");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        finalizeRun({ ...context.dependencies, artifactStore: corruptedStore }, "run-1"),
      ).rejects.toMatchObject({ code: "artifact_content_corrupt" });
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Finalizing");
      expect(context.persistence.runFinalizations.getByRun("run-1")).toBeNull();
      expect(context.persistence.events.listForRun("run-1")).toHaveLength(3);
    } finally {
      context.persistence.close();
    }
  });

  it("uses Partial for a recoverable prepared-manifest write failure", async () => {
    const context = await createContext();
    const failingStore = new Proxy(context.artifactStore, {
      get(target, property, receiver) {
        if (property === "putPreparedBytes") {
          return async (..._args: Parameters<LocalArtifactStore["putPreparedBytes"]>) => {
            throw new ArtifactStoreError("artifact_write_failed");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      const result = await finalizeRun(
        { ...context.dependencies, artifactStore: failingStore },
        "run-1",
      );
      expect(result).toMatchObject({
        terminalStatus: "Partial",
        diagnosticCode: "manifest_unavailable",
        manifestArtifactId: null,
      });
      expect(context.persistence.runSupport.listEvidenceGaps("run-1")).toEqual([
        expect.objectContaining({ code: "manifest_unavailable" }),
      ]);
    } finally {
      context.persistence.close();
    }
  });

  it("rolls back terminal state, Events, reference, evidence and sequence on transaction failure", async () => {
    const context = await createContext();
    const failingDependencies: RunFinalizationDependencies = {
      ...context.dependencies,
      eventIdGenerator: () => "duplicate-event",
    };
    try {
      await expect(finalizeRun(failingDependencies, "run-1")).rejects.toBeInstanceOf(Error);
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Finalizing");
      expect(context.persistence.runFinalizations.getByRun("run-1")).toBeNull();
      expect(context.persistence.events.listForRun("run-1")).toHaveLength(3);
      expect(context.persistence.artifacts.listForRun("run-1")).toEqual([]);
      expect(context.persistence.runSupport.countEvidenceGaps("run-1")).toBe(0);

      const retryIds = ["snapshot-retry", "terminal-retry"];
      const retried = await finalizeRun(
        { ...context.dependencies, eventIdGenerator: () => retryIds.shift() ?? "extra" },
        "run-1",
      );
      expect(retried?.terminalStatus).toBe("Completed");
      expect(
        context.persistence.events
          .listForRun("run-1")
          .slice(-2)
          .map((e) => e.sequence),
      ).toEqual([4, 5]);
    } finally {
      context.persistence.close();
    }
  });

  it("is safe under concurrent finalization", async () => {
    const context = await createContext();
    try {
      const [first, second] = await Promise.all([
        finalizeRun(context.dependencies, "run-1"),
        finalizeRun(context.dependencies, "run-1"),
      ]);
      expect(first).toEqual(second);
      expect(context.persistence.events.listForRun("run-1")).toHaveLength(5);
      expect(context.persistence.artifacts.listForRun("run-1")).toHaveLength(1);
    } finally {
      context.persistence.close();
    }
  });

  it("recovers stale Capturing as Abandoned without a final snapshot", async () => {
    const context = await createContext({
      status: "Capturing",
      lastObservedAt: "2026-07-22T09:00:00.000Z",
    });
    try {
      const results = await recoverStaleRuns(context.dependencies, "2026-07-22T09:30:00.000Z");
      expect(results).toEqual([
        expect.objectContaining({
          terminalStatus: "Abandoned",
          diagnosticCode: "stale_capturing_recovered",
          finalSnapshotEventId: null,
        }),
      ]);
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Abandoned");
      expect(context.persistence.events.listForRun("run-1").map((entry) => entry.type)).toEqual([
        "run.abandoned",
      ]);
    } finally {
      context.persistence.close();
    }
  });

  it("rejects stale Capturing recovery after a persisted Stop boundary", async () => {
    const context = await createContext({
      status: "Capturing",
      lastObservedAt: "2026-07-22T09:00:00.000Z",
    });
    context.persistence.events.append(
      event({
        eventId: "unexpected-stop",
        type: "run.stop_observed",
        sequence: 1,
        at: "2026-07-22T09:01:00.000Z",
      }),
    );
    try {
      await expect(
        recoverStaleRuns(context.dependencies, "2026-07-22T09:30:00.000Z"),
      ).rejects.toMatchObject({ code: "invalid_persisted_row" });
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Capturing");
      expect(context.persistence.runFinalizations.getByRun("run-1")).toBeNull();
    } finally {
      context.persistence.close();
    }
  });

  it("canonicalizes an offset recovery cutoff before SQLite ordering", async () => {
    const context = await createContext({
      status: "Capturing",
      lastObservedAt: "2026-07-22T09:00:00.000Z",
    });
    try {
      const results = await recoverStaleRuns(context.dependencies, "2026-07-22T08:30:00-01:00");
      expect(results[0]?.terminalStatus).toBe("Abandoned");
    } finally {
      context.persistence.close();
    }
  });

  it("rejects recovery cutoffs without an explicit timezone", async () => {
    const context = await createContext({
      status: "Capturing",
      lastObservedAt: "2026-07-22T09:00:00.000Z",
    });
    try {
      const results = await recoverStaleRuns(context.dependencies, "2026-07-22T09:30:00");
      expect(results).toEqual([]);
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Capturing");
      expect(context.persistence.events.listForRun("run-1")).toEqual([]);
    } finally {
      context.persistence.close();
    }
  });

  it("recovers stale Finalizing as forced Partial", async () => {
    const context = await createContext({ lastObservedAt: "2026-07-22T09:00:00.000Z" });
    try {
      const results = await recoverStaleRuns(context.dependencies, "2026-07-22T09:30:00.000Z");
      expect(results[0]).toMatchObject({
        terminalStatus: "Partial",
        mode: "recovery",
        diagnosticCode: "stale_finalizing_recovered",
      });
      expect(context.persistence.runSupport.countEvidenceGaps("run-1")).toBe(1);
    } finally {
      context.persistence.close();
    }
  });

  it("re-checks staleness after async manifest preparation", async () => {
    const context = await createContext({ lastObservedAt: "2026-07-22T09:00:00.000Z" });
    const wrappedStore = new Proxy(context.artifactStore, {
      get(target, property, receiver) {
        if (property === "putPreparedBytes") {
          return async (...args: Parameters<LocalArtifactStore["putPreparedBytes"]>) => {
            context.persistence.conversations.touch("conversation-1", "2026-07-22T09:45:00.000Z");
            return target.putPreparedBytes(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      const results = await recoverStaleRuns(
        { ...context.dependencies, artifactStore: wrappedStore },
        "2026-07-22T09:30:00.000Z",
      );
      expect(results).toEqual([]);
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Finalizing");
      expect(context.persistence.runFinalizations.getByRun("run-1")).toBeNull();
    } finally {
      context.persistence.close();
    }
  });

  it("persists finalization safely across file-backed restart", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-db-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({}, databasePath);
    const result = await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(getRunFinalization(reopened, "run-1")).toEqual(result);
      expect(reopened.taskRuns.get("run-1")?.status).toBe("Completed");
      expect(
        reopened.events
          .listForRun("run-1")
          .slice(-2)
          .map((entry) => entry.type),
      ).toEqual(["snapshot.final_captured", "run.completed"]);
    } finally {
      reopened.close();
    }
  });

  it("detects an Event sequence gap earlier than the finalization predecessor", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-early-gap-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({}, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("DELETE FROM events WHERE event_id = ?").run("baseline-event");
    raw.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(() => getRunFinalization(reopened, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      reopened.close();
    }
  });

  it("detects a later Stop boundary after the persisted finalization trigger", async () => {
    const context = await createContext();
    try {
      await finalizeRun(context.dependencies, "run-1");
      context.persistence.events.append(
        event({
          eventId: "later-stop",
          type: "run.stop_failed",
          sequence: 6,
          at: "2026-07-22T10:03:00.000Z",
        }),
      );
      expect(() => getRunFinalization(context.persistence, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      context.persistence.close();
    }
  });

  it("detects corrupted terminal Event deduplication after restart", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-dedup-corruption-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({}, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("DELETE FROM event_deduplication WHERE event_id = ?").run("terminal-event");
    raw.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(() => getRunFinalization(reopened, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      reopened.close();
    }
  });

  it("detects corrupted predecessor continuity after restart", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-sequence-corruption-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({}, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("DELETE FROM events WHERE event_id = ?").run("summary-event");
    raw.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(() => getRunFinalization(reopened, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      reopened.close();
    }
  });

  it("detects a corrupted evidence-gap counter after restart", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-evidence-corruption-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({}, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE task_runs SET evidence_gap_count = 1 WHERE run_id = ?").run("run-1");
    raw.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(() => getRunFinalization(reopened, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      reopened.close();
    }
  });

  it("rejects invalid Partial mode and diagnostic combinations at the database boundary", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-partial-combination-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({ reconciliationOutcome: "partial" }, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    const persisted = raw
      .prepare("SELECT * FROM run_finalizations WHERE run_id = ?")
      .get("run-1") as Record<string, unknown>;
    raw.prepare("DELETE FROM run_finalizations WHERE run_id = ?").run("run-1");
    expect(() =>
      raw
        .prepare(
          `INSERT INTO run_finalizations (
             finalization_id, run_id, conversation_id, workspace_id, terminal_status, mode,
             trigger_event_id, reconciliation_id, manifest_artifact_id, final_fingerprint,
             final_snapshot_event_id, terminal_event_id, diagnostic_code, finalized_at, generator_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          persisted.finalization_id as string,
          persisted.run_id as string,
          persisted.conversation_id as string,
          persisted.workspace_id as string,
          persisted.terminal_status as string,
          "recovery",
          persisted.trigger_event_id as string | null,
          persisted.reconciliation_id as string | null,
          persisted.manifest_artifact_id as string | null,
          persisted.final_fingerprint as string | null,
          persisted.final_snapshot_event_id as string | null,
          persisted.terminal_event_id as string,
          persisted.diagnostic_code as string,
          persisted.finalized_at as string,
          persisted.generator_version as string,
        ),
    ).toThrow();
    raw.close();
  });

  it("detects non-Completed finalization evidence rows removed after restart", async () => {
    const directory = await temporaryDirectory("ownloop-finalization-missing-evidence-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({ reconciliationOutcome: "partial" }, databasePath);
    await finalizeRun(context.dependencies, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("DELETE FROM evidence_gaps WHERE run_id = ?").run("run-1");
    raw.prepare("UPDATE task_runs SET evidence_gap_count = 0 WHERE run_id = ?").run("run-1");
    raw.close();

    const reopened = openPersistence(databasePath);
    try {
      expect(() => getRunFinalization(reopened, "run-1")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      reopened.close();
    }
  });

  it("rejects a terminal Run that has no immutable finalization record", async () => {
    const context = await createContext();
    try {
      expect(
        context.persistence.taskRuns.transitionToTerminal(
          "run-1",
          "Finalizing",
          "Partial",
          FINALIZED_AT,
          null,
        ),
      ).toBe(true);
      await expect(finalizeRun(context.dependencies, "run-1")).rejects.toMatchObject({
        code: "invalid_persisted_row",
      } satisfies Partial<PersistenceError>);
    } finally {
      context.persistence.close();
    }
  });
});
