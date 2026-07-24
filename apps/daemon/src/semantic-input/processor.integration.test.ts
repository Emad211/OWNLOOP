import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import { classifyFinalizedRunChanges } from "../change-classification/index.js";
import { buildFinalizedRunEvidenceGraph } from "../evidence-graph/index.js";
import { finalizeRun } from "../finalization/index.js";
import {
  openPersistence,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import { extractFinalizedRunVerificationEvidence } from "../verification-extraction/index.js";
import {
  getRunSemanticAnalysisInput,
  prepareEligibleFinalizedRunSemanticAnalysisInputs,
  prepareFinalizedRunSemanticAnalysisInput,
  REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE,
} from "./index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

type RunSpec = Readonly<{
  suffix: string;
  runNumber: number;
  startedAt: string;
  commandAt: string;
  stoppedAt: string;
  finalizedAt: string;
}>;

const RUN_A: RunSpec = {
  suffix: "a",
  runNumber: 1,
  startedAt: "2026-07-24T10:00:00.000Z",
  commandAt: "2026-07-24T10:00:30.000Z",
  stoppedAt: "2026-07-24T10:01:00.000Z",
  finalizedAt: "2026-07-24T10:02:00.000Z",
};
const RUN_B: RunSpec = {
  suffix: "b",
  runNumber: 2,
  startedAt: "2026-07-24T10:03:00.000Z",
  commandAt: "2026-07-24T10:03:30.000Z",
  stoppedAt: "2026-07-24T10:04:00.000Z",
  finalizedAt: "2026-07-24T10:05:00.000Z",
};

function ids(spec: RunSpec) {
  return {
    workspaceId: `workspace-${spec.suffix}`,
    conversationId: `conversation-${spec.suffix}`,
    runId: `run-${spec.suffix}`,
    baselineId: `baseline-${spec.suffix}`,
    reconciliationId: `reconciliation-${spec.suffix}`,
    baselineEventId: `baseline-event-${spec.suffix}`,
    commandEventId: `command-event-${spec.suffix}`,
    stopEventId: `stop-event-${spec.suffix}`,
    summaryEventId: `summary-event-${spec.suffix}`,
    fileEventId: `file-event-${spec.suffix}`,
    finalizationId: `finalization-${spec.suffix}`,
  };
}

function event(
  spec: RunSpec,
  input: Readonly<{
    eventId: string;
    sequence: number;
    type: NormalizedEventEnvelope["type"];
    source?: NormalizedEventEnvelope["source"];
    sourceEventName?: string | null;
    occurredAt?: string;
    payload?: NormalizedEventEnvelope["payload"];
  }>,
): NormalizedEventEnvelope {
  const value = ids(spec);
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    runId: value.runId,
    sequence: input.sequence,
    type: input.type,
    source: input.source ?? "ownloop",
    sourceEventName: input.sourceEventName ?? null,
    sourceEventId: null,
    occurredAt: input.occurredAt ?? spec.startedAt,
    ingestedAt: input.occurredAt ?? spec.startedAt,
    sensitivity: "normal",
    payload: input.payload ?? {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

function seedFinalizingRun(persistence: OwnLoopPersistence, spec: RunSpec): void {
  const value = ids(spec);
  const repositoryRoot = `/workspace/project-${spec.suffix}`;
  persistence.workspaces.insert({
    workspaceId: value.workspaceId,
    canonicalPath: repositoryRoot,
    repositoryRoot,
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: spec.startedAt,
    lastObservedAt: spec.stoppedAt,
  });
  persistence.conversations.insert({
    conversationId: value.conversationId,
    workspaceId: value.workspaceId,
    source: "claude_code",
    sourceSessionId: `session-${spec.suffix}`,
    startMode: "startup",
    startedAt: spec.startedAt,
    lastObservedAt: spec.stoppedAt,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: value.runId,
    conversationId: value.conversationId,
    runNumber: spec.runNumber,
    redactedPrompt:
      "Verify package.json behavior and contact owner@example.com without exposing /workspace/private.",
    baselineGitCommit: COMMIT,
    baselineWorkingTreeFingerprint: HASH_A,
    startedAt: spec.startedAt,
    endedAt: null,
    status: "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  });
  const sourceEvents: NormalizedEventEnvelope[] = [
    event(spec, {
      eventId: value.baselineEventId,
      sequence: 1,
      type: "snapshot.baseline_captured",
    }),
    event(spec, {
      eventId: value.commandEventId,
      sequence: 2,
      type: "tool.succeeded",
      source: "claude_code",
      sourceEventName: "PostToolUse",
      occurredAt: spec.commandAt,
      payload: {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: {
          exitCode: 0,
          stdout: "PASS /home/alice/project bearer secret-token owner@example.com",
        },
      },
    }),
    event(spec, {
      eventId: value.stopEventId,
      sequence: 3,
      type: "run.stop_observed",
      source: "claude_code",
      sourceEventName: "Stop",
      occurredAt: spec.stoppedAt,
    }),
    event(spec, {
      eventId: value.summaryEventId,
      sequence: 4,
      type: "git.diff_computed",
      occurredAt: spec.stoppedAt,
    }),
    event(spec, {
      eventId: value.fileEventId,
      sequence: 5,
      type: "file.change_observed",
      occurredAt: spec.stoppedAt,
    }),
  ];
  for (const sourceEvent of sourceEvents) persistence.events.append(sourceEvent);
  persistence.gitBaselines.insert({
    baselineId: value.baselineId,
    runId: value.runId,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    baselineEventId: value.baselineEventId,
    outcome: "captured",
    diagnosticCode: null,
    repositoryRoot,
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
    capturedAt: spec.startedAt,
    captureDelayMs: 0,
  });
  persistence.gitReconciliations.insert({
    reconciliationId: value.reconciliationId,
    runId: value.runId,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    baselineId: value.baselineId,
    triggerEventId: value.stopEventId,
    summaryEventId: value.summaryEventId,
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot,
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
    capturedAt: spec.stoppedAt,
  });
  persistence.gitReconciliations.insertEntry({
    reconciliationId: value.reconciliationId,
    entryIndex: 0,
    fileEventId: value.fileEventId,
    pathIdentitySha256: createHash("sha256").update(`path-${spec.suffix}`).digest("hex"),
    relativePath: `src/example-${spec.suffix}.test.ts`,
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity: "normal",
    attribution: "run_relative",
  });
}

type IntegrationContext = Readonly<{
  directory: string;
  artifactRoot: string;
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}>;

async function createContext(
  specs: readonly RunSpec[],
  databasePath: string = ":memory:",
): Promise<IntegrationContext> {
  const directory = await temporaryDirectory("ownloop-semantic-input-integration-");
  const artifactRoot = join(directory, "artifacts");
  const persistence = openPersistence(databasePath);
  for (const spec of specs) seedFinalizingRun(persistence, spec);
  let artifactIndex = 0;
  const artifactStore = await createLocalArtifactStore({
    artifactRoot,
    persistence,
    clock: () => new Date("2026-07-24T10:10:00.000Z"),
    artifactIdGenerator: () => `integration-artifact-${artifactIndex++}`,
  });
  return { directory, artifactRoot, persistence, artifactStore };
}

function dependencies(context: Pick<IntegrationContext, "persistence" | "artifactStore">) {
  return { persistence: context.persistence, artifactStore: context.artifactStore };
}

async function preparePrerequisites(context: IntegrationContext, spec: RunSpec): Promise<void> {
  const value = ids(spec);
  const finalEventIds = [`snapshot-event-${spec.suffix}`, `terminal-event-${spec.suffix}`];
  await finalizeRun(
    {
      persistence: context.persistence,
      artifactStore: context.artifactStore,
      clock: () => new Date(spec.finalizedAt),
      finalizationIdGenerator: () => value.finalizationId,
      eventIdGenerator: () => finalEventIds.shift() ?? `extra-final-${spec.suffix}`,
      evidenceGapIdGenerator: () => `gap-${spec.suffix}`,
    },
    value.runId,
  );
  await classifyFinalizedRunChanges(dependencies(context), value.runId);
  await extractFinalizedRunVerificationEvidence(
    {
      ...dependencies(context),
      clock: () => new Date(spec.finalizedAt),
    },
    value.runId,
  );
  await buildFinalizedRunEvidenceGraph(dependencies(context), value.runId);
}

describe("semantic-analysis input processor integration", () => {
  it("persists once under concurrency and survives file-backed restart", async () => {
    const directory = await temporaryDirectory("ownloop-semantic-input-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext([RUN_A], databasePath);
    await preparePrerequisites(context, RUN_A);
    const runId = ids(RUN_A).runId;
    const [first, second] = await Promise.all([
      prepareFinalizedRunSemanticAnalysisInput(dependencies(context), runId, { enabled: true }),
      prepareFinalizedRunSemanticAnalysisInput(dependencies(context), runId, { enabled: true }),
    ]);
    expect(second).toEqual(first);
    expect(
      await prepareFinalizedRunSemanticAnalysisInput(dependencies(context), runId, {
        enabled: true,
      }),
    ).toEqual(first);
    expect(first).toMatchObject({ runId, outcome: "partial", artifactId: expect.any(String) });
    expect(
      context.persistence.artifacts
        .listForRun(runId)
        .filter((reference) => reference.role === REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE),
    ).toHaveLength(1);
    if (first.artifactId === null) throw new Error("Semantic artifact is missing.");
    const content = await context.artifactStore.readPreparedBytes(first.artifactId);
    const serialized = new TextDecoder().decode(content.bytes);
    expect(serialized).not.toContain("/workspace/private");
    expect(serialized).not.toContain("/home/alice/project");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("pnpm test");
    context.persistence.close();

    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: context.artifactRoot,
      persistence,
    });
    try {
      expect(await getRunSemanticAnalysisInput({ persistence, artifactStore }, runId)).toEqual(
        first,
      );
    } finally {
      persistence.close();
    }
  });

  it("rejects persisted semantic bytes that fail OL-010 integrity", async () => {
    const context = await createContext([RUN_A]);
    try {
      await preparePrerequisites(context, RUN_A);
      const runId = ids(RUN_A).runId;
      const result = await prepareFinalizedRunSemanticAnalysisInput(dependencies(context), runId, {
        enabled: true,
      });
      if (result.artifactId === null) throw new Error("Semantic artifact is missing.");
      const metadata = context.persistence.artifacts.getMetadata(result.artifactId);
      if (metadata === null) throw new Error("Semantic metadata is missing.");
      await writeFile(join(context.artifactRoot, metadata.storagePath), "tampered semantic bytes");
      await expect(getRunSemanticAnalysisInput(dependencies(context), runId)).rejects.toMatchObject(
        {
          code: "artifact_content_corrupt",
        },
      );
    } finally {
      context.persistence.close();
    }
  });

  it("reads its exact role with more than 1000 unrelated references", async () => {
    const context = await createContext([RUN_A]);
    try {
      await preparePrerequisites(context, RUN_A);
      const runId = ids(RUN_A).runId;
      const result = await prepareFinalizedRunSemanticAnalysisInput(dependencies(context), runId, {
        enabled: true,
      });
      for (let index = 0; index < 1001; index += 1) {
        const digestHex = createHash("sha256").update(`semantic-unrelated-${index}`).digest("hex");
        const artifactId = `semantic-unrelated-${index}`;
        context.persistence.artifacts.insertMetadata({
          artifactId,
          digest: `sha256:${digestHex}`,
          storagePath: `objects/sha256/${digestHex.slice(0, 2)}/${digestHex.slice(2)}`,
          sizeBytes: 1,
          kind: "unrelated-artifact",
          sensitivity: "normal",
          storageVersion: 1,
          mediaType: "application/octet-stream",
          createdAt: RUN_A.finalizedAt,
        });
        context.persistence.artifacts.linkToRun({
          runId,
          artifactId,
          role: "unrelated-artifact",
          createdAt: RUN_A.finalizedAt,
        });
      }
      expect(await getRunSemanticAnalysisInput(dependencies(context), runId)).toEqual(result);
    } finally {
      context.persistence.close();
    }
  });

  it("leaves only a GC-eligible object when semantic reference linking fails", async () => {
    const context = await createContext([RUN_A]);
    try {
      await preparePrerequisites(context, RUN_A);
      const runId = ids(RUN_A).runId;
      const failingPersistence = new Proxy(context.persistence, {
        get(target, property, receiver) {
          if (property === "withTransaction") {
            return () => {
              throw new PersistenceError("operation_failed", "forced semantic reference failure");
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as OwnLoopPersistence;
      const failingStore = await createLocalArtifactStore({
        artifactRoot: context.artifactRoot,
        persistence: failingPersistence,
        clock: () => new Date("2026-07-24T10:11:00.000Z"),
        artifactIdGenerator: () => "semantic-failed-artifact",
      });
      await expect(
        prepareFinalizedRunSemanticAnalysisInput(
          { persistence: failingPersistence, artifactStore: failingStore },
          runId,
          { enabled: true },
        ),
      ).rejects.toMatchObject({ code: "artifact_reference_failed" });
      expect(
        context.persistence.artifacts.getRecordForRunRole(
          runId,
          REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE,
        ),
      ).toBeNull();
      expect(context.persistence.artifacts.getMetadata("semantic-failed-artifact")).toBeNull();
      expect(await context.artifactStore.sweepOrphanObjects()).toMatchObject({ objectsDeleted: 1 });
    } finally {
      context.persistence.close();
    }
  });

  it("processes an explicit bounded batch in finalized order", async () => {
    const context = await createContext([RUN_B, RUN_A]);
    try {
      await preparePrerequisites(context, RUN_B);
      await preparePrerequisites(context, RUN_A);
      expect(
        await prepareEligibleFinalizedRunSemanticAnalysisInputs(
          dependencies(context),
          { enabled: true },
          0,
        ),
      ).toEqual([]);
      const results = await prepareEligibleFinalizedRunSemanticAnalysisInputs(
        dependencies(context),
        { enabled: true },
        25,
      );
      expect(results.map((result) => result.runId)).toEqual([ids(RUN_A).runId, ids(RUN_B).runId]);
      expect(
        await prepareEligibleFinalizedRunSemanticAnalysisInputs(
          dependencies(context),
          { enabled: true },
          25,
        ),
      ).toEqual([]);
    } finally {
      context.persistence.close();
    }
  });
});
