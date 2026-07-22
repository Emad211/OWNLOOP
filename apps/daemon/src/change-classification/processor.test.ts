import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalizeJson } from "@ownloop/ingress-security";
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
import { finalizeRun } from "../finalization/index.js";
import { openPersistence, type OwnLoopPersistence } from "../persistence/index.js";
import {
  classifyEligibleFinalizedRuns,
  classifyFinalizedRunChanges,
  DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
  DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
  DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
  getRunChangeClassification,
  prepareDeterministicChangeClassification,
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

function eventForRun(
  runId: string,
  eventId: string,
  type: NormalizedEventEnvelope["type"],
  sequence: number,
  startedAt = STARTED_AT,
  stoppedAt = STOPPED_AT,
): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId,
    sequence,
    type,
    source: type.startsWith("run.stop") ? "claude_code" : "ownloop",
    sourceEventName: type.startsWith("run.stop") ? "Stop" : null,
    sourceEventId: null,
    occurredAt: type.startsWith("run.stop") ? stoppedAt : startedAt,
    ingestedAt: type.startsWith("run.stop") ? stoppedAt : startedAt,
    sensitivity: "normal",
    payload: {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

function event(
  eventId: string,
  type: NormalizedEventEnvelope["type"],
  sequence: number,
): NormalizedEventEnvelope {
  return eventForRun("run-1", eventId, type, sequence);
}

function seedFinalizingRun(persistence: OwnLoopPersistence): void {
  persistence.workspaces.insert({
    workspaceId: "workspace-1",
    canonicalPath: "/workspace/project",
    repositoryRoot: "/workspace/project",
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: STARTED_AT,
    lastObservedAt: STOPPED_AT,
  });
  persistence.conversations.insert({
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    source: "claude_code",
    sourceSessionId: "session-1",
    startMode: "startup",
    startedAt: STARTED_AT,
    lastObservedAt: STOPPED_AT,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: COMMIT,
    baselineWorkingTreeFingerprint: HASH_A,
    startedAt: STARTED_AT,
    endedAt: null,
    status: "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  });

  const events = [
    event("baseline-event", "snapshot.baseline_captured", 1),
    event("stop-event", "run.stop_observed", 2),
    event("summary-event", "git.diff_computed", 3),
    event("file-event-0", "file.change_observed", 4),
    event("file-event-1", "file.change_observed", 5),
    event("file-event-2", "file.change_observed", 6),
  ];
  for (const item of events) {
    persistence.events.append(item);
  }

  persistence.gitBaselines.insert({
    baselineId: "baseline-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineEventId: "baseline-event",
    outcome: "captured",
    diagnosticCode: null,
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
  persistence.gitReconciliations.insert({
    reconciliationId: "reconciliation-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineId: "baseline-1",
    triggerEventId: "stop-event",
    summaryEventId: "summary-event",
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot: "/workspace/project",
    headCommit: COMMIT,
    stagedDiffSha256: HASH_B,
    unstagedDiffSha256: HASH_B,
    statusBeforeSha256: HASH_B,
    statusAfterSha256: HASH_B,
    workingTreeFingerprint: HASH_B,
    stagedDirty: true,
    unstagedDirty: false,
    entryCount: 3,
    createdCount: 0,
    modifiedCount: 3,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: STOPPED_AT,
  });
  const paths: Array<readonly [string | null, "normal" | "secret"]> = [
    ["apps/web/src/App.tsx", "normal"],
    ["pnpm-lock.yaml", "normal"],
    [null, "secret"],
  ];
  for (const [index, [relativePath, sensitivity]] of paths.entries()) {
    persistence.gitReconciliations.insertEntry({
      reconciliationId: "reconciliation-1",
      entryIndex: index,
      fileEventId: `file-event-${index}`,
      pathIdentitySha256: String(index + 1)
        .repeat(64)
        .slice(0, 64),
      relativePath,
      changeKind: "modified",
      staged: true,
      unstaged: false,
      sensitivity,
      attribution: "run_relative",
    });
  }
}

function seedSecondFinalizingRun(persistence: OwnLoopPersistence): void {
  const startedAt = "2026-07-22T09:00:00.000Z";
  const stoppedAt = "2026-07-22T09:01:00.000Z";
  persistence.taskRuns.insert({
    runId: "run-2",
    conversationId: "conversation-1",
    runNumber: 2,
    redactedPrompt: "[REDACTED SECOND]",
    baselineGitCommit: COMMIT,
    baselineWorkingTreeFingerprint: HASH_A,
    startedAt,
    endedAt: null,
    status: "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  });
  for (const item of [
    eventForRun("run-2", "baseline-event-2", "snapshot.baseline_captured", 1, startedAt, stoppedAt),
    eventForRun("run-2", "stop-event-2", "run.stop_observed", 2, startedAt, stoppedAt),
    eventForRun("run-2", "summary-event-2", "git.diff_computed", 3, startedAt, stoppedAt),
    eventForRun("run-2", "file-event-2-0", "file.change_observed", 4, startedAt, stoppedAt),
  ]) {
    persistence.events.append(item);
  }
  persistence.gitBaselines.insert({
    baselineId: "baseline-2",
    runId: "run-2",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineEventId: "baseline-event-2",
    outcome: "captured",
    diagnosticCode: null,
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
    capturedAt: startedAt,
    captureDelayMs: 0,
  });
  persistence.gitReconciliations.insert({
    reconciliationId: "reconciliation-2",
    runId: "run-2",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineId: "baseline-2",
    triggerEventId: "stop-event-2",
    summaryEventId: "summary-event-2",
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot: "/workspace/project",
    headCommit: COMMIT,
    stagedDiffSha256: HASH_B,
    unstagedDiffSha256: HASH_B,
    statusBeforeSha256: HASH_B,
    statusAfterSha256: HASH_B,
    workingTreeFingerprint: HASH_B,
    stagedDirty: true,
    unstagedDirty: false,
    entryCount: 1,
    createdCount: 0,
    modifiedCount: 1,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: stoppedAt,
  });
  persistence.gitReconciliations.insertEntry({
    reconciliationId: "reconciliation-2",
    entryIndex: 0,
    fileEventId: "file-event-2-0",
    pathIdentitySha256: "4".repeat(64),
    relativePath: "apps/daemon/src/routes/health.ts",
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity: "normal",
    attribution: "run_relative",
  });
}

async function createContext(databasePath = ":memory:"): Promise<{
  directory: string;
  artifactRoot: string;
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}> {
  const directory = await temporaryDirectory("ownloop-classification-");
  const artifactRoot = join(directory, "artifacts");
  const persistence = openPersistence(databasePath);
  seedFinalizingRun(persistence);
  const artifactIds = ["manifest-artifact", "classification-artifact", "conflict-artifact"];
  const artifactStore = await createLocalArtifactStore({
    artifactRoot,
    persistence,
    clock: () => new Date(FINALIZED_AT),
    artifactIdGenerator: () => artifactIds.shift() ?? "extra-artifact",
  });
  const eventIds = ["snapshot-event", "terminal-event"];
  await finalizeRun(
    {
      persistence,
      artifactStore,
      clock: () => new Date(FINALIZED_AT),
      finalizationIdGenerator: () => "finalization-1",
      eventIdGenerator: () => eventIds.shift() ?? "extra-event",
      evidenceGapIdGenerator: () => "finalization-gap",
    },
    "run-1",
  );
  return { directory, artifactRoot, persistence, artifactStore };
}

describe("deterministic change classification processor", () => {
  it("persists, validates and reads one immutable classification artifact", async () => {
    const context = await createContext();
    try {
      const result = await classifyFinalizedRunChanges(context, "run-1");
      expect(result).toMatchObject({
        artifactId: "classification-artifact",
        schemaVersion: 1,
        classifierVersion: "0.1.0",
        taxonomyVersion: "ownloop-change-taxonomy-v1",
        ruleSetVersion: "ownloop-node-ts-path-rules-v1",
        runId: "run-1",
        finalizationId: "finalization-1",
        reconciliationId: "reconciliation-1",
        outcome: "classified",
        entryCount: 3,
      });
      expect(result?.aggregateLabels.map((entry) => entry.label)).toEqual([
        "ui",
        "behavior",
        "dependency",
        "unknown",
      ]);
      const records = context.persistence.artifacts
        .listRecordsForRun("run-1")
        .filter((record) => record.reference.role === DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE);
      expect(records).toHaveLength(1);
      expect(records[0]?.artifact).toMatchObject({
        kind: DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
        mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
        sensitivity: "sensitive",
      });
      const content = await context.artifactStore.readPreparedBytes("classification-artifact");
      const text = new TextDecoder().decode(content.bytes);
      expect(text).not.toContain("apps/web/src/App.tsx");
      expect(text).not.toContain("pnpm-lock.yaml");
      expect(text).not.toContain("/workspace/project");
      expect(await getRunChangeClassification(context, "run-1")).toEqual(result);
    } finally {
      context.persistence.close();
    }
  });

  it("reads its role directly when a Run has more than 1000 unrelated artifacts", async () => {
    const context = await createContext();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const digestHex = createHash("sha256").update(`unrelated-${index}`).digest("hex");
        const artifactId = `unrelated-artifact-${index}`;
        context.persistence.artifacts.insertMetadata({
          artifactId,
          digest: `sha256:${digestHex}`,
          storagePath: `objects/sha256/${digestHex.slice(0, 2)}/${digestHex.slice(2)}`,
          sizeBytes: 1,
          kind: "unrelated-test-artifact",
          sensitivity: "normal",
          storageVersion: 1,
          mediaType: "application/octet-stream",
          createdAt: FINALIZED_AT,
        });
        expect(
          context.persistence.artifacts.linkToRun({
            runId: "run-1",
            artifactId,
            role: "unrelated-test-artifact",
            createdAt: FINALIZED_AT,
          }),
        ).toBe(true);
      }

      const result = await classifyFinalizedRunChanges(context, "run-1");
      expect(result?.artifactId).toBe("classification-artifact");
      expect(await getRunChangeClassification(context, "run-1")).toEqual(result);
    } finally {
      context.persistence.close();
    }
  });

  it("is idempotent under repeated and concurrent processing", async () => {
    const context = await createContext();
    try {
      const [first, second] = await Promise.all([
        classifyFinalizedRunChanges(context, "run-1"),
        classifyFinalizedRunChanges(context, "run-1"),
      ]);
      expect(second).toEqual(first);
      expect(await classifyFinalizedRunChanges(context, "run-1")).toEqual(first);
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE),
      ).toHaveLength(1);
    } finally {
      context.persistence.close();
    }
  });

  it("leaves only a GC-eligible object when the reference transaction fails", async () => {
    const context = await createContext();
    const failingReferenceStore = new Proxy(context.artifactStore, {
      get(target, property, receiver) {
        if (property === "putPreparedArtifactForRun") {
          return async (input: Parameters<LocalArtifactStore["putPreparedArtifactForRun"]>[0]) => {
            await target.putPreparedStream({
              preparedStream: input.preparedContent,
              kind: input.kind,
              mediaType: input.mediaType,
              sensitivity: input.sensitivity,
            });
            throw new ArtifactStoreError("artifact_reference_failed");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        classifyFinalizedRunChanges(
          { persistence: context.persistence, artifactStore: failingReferenceStore },
          "run-1",
        ),
      ).rejects.toMatchObject({ code: "operation_failed" });
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE),
      ).toEqual([]);
      expect(context.persistence.artifacts.getMetadata("classification-artifact")).not.toBeNull();
      expect(context.persistence.artifacts.countReferences("classification-artifact")).toBe(0);
      expect(await context.artifactStore.collectUnreferencedArtifacts()).toMatchObject({
        candidates: 1,
        metadataDeleted: 1,
        objectsDeleted: 1,
      });
      expect(context.persistence.artifacts.getMetadata("classification-artifact")).toBeNull();
    } finally {
      context.persistence.close();
    }
  });

  it("processes eligible finalized Runs in a bounded explicit batch", async () => {
    const context = await createContext();
    try {
      expect(await classifyEligibleFinalizedRuns(context, 0)).toEqual([]);
      const results = await classifyEligibleFinalizedRuns(context, 25);
      expect(results).toHaveLength(1);
      expect(results[0]?.runId).toBe("run-1");
      expect(await classifyEligibleFinalizedRuns(context, 25)).toEqual([]);
    } finally {
      context.persistence.close();
    }
  });

  it("processes eligible Runs in deterministic finalized-at then Run-ID order", async () => {
    const directory = await temporaryDirectory("ownloop-classification-order-");
    const persistence = openPersistence(":memory:");
    seedFinalizingRun(persistence);
    seedSecondFinalizingRun(persistence);
    const artifactIds = [
      "manifest-artifact-1",
      "manifest-artifact-2",
      "classification-artifact-2",
      "classification-artifact-1",
    ];
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: join(directory, "artifacts"),
      persistence,
      artifactIdGenerator: () => artifactIds.shift() ?? "extra-artifact",
    });
    try {
      const firstEventIds = ["snapshot-event-1", "terminal-event-1"];
      await finalizeRun(
        {
          persistence,
          artifactStore,
          clock: () => new Date("2026-07-22T10:03:00.000Z"),
          finalizationIdGenerator: () => "finalization-1",
          eventIdGenerator: () => firstEventIds.shift() ?? "extra-event-1",
          evidenceGapIdGenerator: () => "gap-1",
        },
        "run-1",
      );
      const secondEventIds = ["snapshot-event-2", "terminal-event-2"];
      await finalizeRun(
        {
          persistence,
          artifactStore,
          clock: () => new Date("2026-07-22T09:02:00.000Z"),
          finalizationIdGenerator: () => "finalization-2",
          eventIdGenerator: () => secondEventIds.shift() ?? "extra-event-2",
          evidenceGapIdGenerator: () => "gap-2",
        },
        "run-2",
      );
      const results = await classifyEligibleFinalizedRuns({ persistence, artifactStore }, 2);
      expect(results.map((result) => result.runId)).toEqual(["run-2", "run-1"]);
    } finally {
      persistence.close();
    }
  });

  it("survives file-backed close/reopen with byte-identical read-back", async () => {
    const directory = await temporaryDirectory("ownloop-classification-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext(databasePath);
    const first = await classifyFinalizedRunChanges(context, "run-1");
    context.persistence.close();

    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: context.artifactRoot,
      persistence,
    });
    try {
      expect(await getRunChangeClassification({ persistence, artifactStore }, "run-1")).toEqual(
        first,
      );
    } finally {
      persistence.close();
    }
  });

  it("rejects a canonical classification with a forged input fingerprint", async () => {
    const context = await createContext();
    try {
      const finalization = context.persistence.runFinalizations.getByRun("run-1");
      const reconciliation = context.persistence.gitReconciliations.get("reconciliation-1");
      expect(finalization).not.toBeNull();
      expect(reconciliation).not.toBeNull();
      if (finalization === null || reconciliation === null) {
        return;
      }
      const prepared = prepareDeterministicChangeClassification(
        "run-1",
        finalization,
        reconciliation,
      );
      const forged = canonicalizeJson({
        ...prepared.value,
        inputFingerprint: "0".repeat(64),
      });
      await context.artifactStore.putPreparedArtifactForRun({
        preparedContent: [new TextEncoder().encode(forged)],
        runId: "run-1",
        role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
        kind: DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
        mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
        sensitivity: "sensitive",
      });
      await expect(getRunChangeClassification(context, "run-1")).rejects.toMatchObject({
        code: "invalid_persisted_row",
      });
    } finally {
      context.persistence.close();
    }
  });

  it.each([
    ["Run ownership", { runId: "other-run" }],
    ["finalization ownership", { finalizationId: "other-finalization" }],
    ["reconciliation ownership", { reconciliationId: "other-reconciliation" }],
    ["classifier version", { classifierVersion: "0.2.0" }],
    ["rule-set version", { ruleSetVersion: "ownloop-node-ts-path-rules-v2" }],
  ])("rejects a canonical classification with forged %s", async (_name, override) => {
    const context = await createContext();
    try {
      const finalization = context.persistence.runFinalizations.getByRun("run-1");
      const reconciliation = context.persistence.gitReconciliations.get("reconciliation-1");
      expect(finalization).not.toBeNull();
      expect(reconciliation).not.toBeNull();
      if (finalization === null || reconciliation === null) {
        return;
      }
      const prepared = prepareDeterministicChangeClassification(
        "run-1",
        finalization,
        reconciliation,
      );
      const forged = canonicalizeJson({ ...prepared.value, ...override });
      await context.artifactStore.putPreparedArtifactForRun({
        preparedContent: [new TextEncoder().encode(forged)],
        runId: "run-1",
        role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
        kind: DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
        mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
        sensitivity: "sensitive",
      });
      await expect(getRunChangeClassification(context, "run-1")).rejects.toMatchObject({
        code: "invalid_persisted_row",
      });
    } finally {
      context.persistence.close();
    }
  });

  it("rejects a classification reference whose artifact metadata was removed", async () => {
    const directory = await temporaryDirectory("ownloop-classification-missing-metadata-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext(databasePath);
    await classifyFinalizedRunChanges(context, "run-1");
    context.persistence.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("DELETE FROM artifacts WHERE artifact_id = ?").run("classification-artifact");
    raw.close();

    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: context.artifactRoot,
      persistence,
    });
    try {
      await expect(
        getRunChangeClassification({ persistence, artifactStore }, "run-1"),
      ).rejects.toMatchObject({
        code: "invalid_persisted_row",
      });
    } finally {
      persistence.close();
    }
  });

  it("rejects content corruption and a conflicting second v1 role", async () => {
    const context = await createContext();
    try {
      await classifyFinalizedRunChanges(context, "run-1");
      const metadata = context.persistence.artifacts.getMetadata("classification-artifact");
      expect(metadata).not.toBeNull();
      if (metadata === null) {
        return;
      }
      await writeFile(join(context.artifactRoot, metadata.storagePath), "tampered", "utf8");
      await expect(getRunChangeClassification(context, "run-1")).rejects.toMatchObject({
        code: "artifact_content_corrupt",
      });

      await expect(
        context.artifactStore.putPreparedArtifactForRun({
          preparedContent: [new TextEncoder().encode('{"different":true}')],
          runId: "run-1",
          role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
          kind: DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
          mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
          sensitivity: "sensitive",
        }),
      ).rejects.toMatchObject({ code: "artifact_reference_failed" });
    } finally {
      context.persistence.close();
    }
  });

  it("rejects invalid v1 metadata and preserves fixed sensitive classification metadata", async () => {
    const context = await createContext();
    try {
      await expect(
        context.artifactStore.putPreparedArtifactForRun({
          preparedContent: [new TextEncoder().encode('{"invalid":true}')],
          runId: "run-1",
          role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
          kind: "wrong-classification-kind",
          mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
          sensitivity: "sensitive",
        }),
      ).rejects.toMatchObject({ code: "artifact_reference_failed" });

      const result = await classifyFinalizedRunChanges(context, "run-1");
      expect(result).not.toBeNull();
      if (result === null) {
        return;
      }
      expect(() =>
        context.persistence.artifacts.updateSensitivity(result.artifactId, "secret"),
      ).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
      expect(
        context.artifactStore.unlinkArtifactFromRun({
          artifactId: result.artifactId,
          runId: "run-1",
          role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
        }),
      ).toBe(true);
      expect(() =>
        context.persistence.artifacts.updateSensitivity(result.artifactId, "secret"),
      ).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
    } finally {
      context.persistence.close();
    }
  });

  it("returns null for non-terminal and unknown Runs", async () => {
    const context = await createContext();
    try {
      expect(await classifyFinalizedRunChanges(context, "missing-run")).toBeNull();
      expect(await getRunChangeClassification(context, "missing-run")).toBeNull();
    } finally {
      context.persistence.close();
    }
  });
});
