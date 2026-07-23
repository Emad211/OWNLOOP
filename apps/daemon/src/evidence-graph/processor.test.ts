import { createHash, createSecretKey } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EvidenceResolutionV1Schema, ReplayErrorResponseSchema } from "@ownloop/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import { classifyFinalizedRunChanges } from "../change-classification/index.js";
import { finalizeRun } from "../finalization/index.js";
import {
  createLoopbackIngressServer,
  generateInstallationToken,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";
import {
  openPersistence,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import { projectRawRunReplay } from "../replay/index.js";
import { extractFinalizedRunVerificationEvidence } from "../verification-extraction/index.js";
import {
  buildEligibleFinalizedRunEvidenceGraphs,
  buildFinalizedRunEvidenceGraph,
  DETERMINISTIC_EVIDENCE_GRAPH_ROLE,
  getRunEvidenceGraph,
  readValidatedRunEvidenceGraph,
  resolveRunEvidence,
} from "./index.js";

const STARTED_AT = "2026-07-22T10:00:00.000Z";
const COMMAND_AT = "2026-07-22T10:00:30.000Z";
const STOPPED_AT = "2026-07-22T10:01:00.000Z";
const FINALIZED_AT = "2026-07-22T10:02:00.000Z";
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

function event(
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
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: input.sequence,
    type: input.type,
    source: input.source ?? "ownloop",
    sourceEventName: input.sourceEventName ?? null,
    sourceEventId: null,
    occurredAt: input.occurredAt ?? STARTED_AT,
    ingestedAt: input.occurredAt ?? STARTED_AT,
    sensitivity: "normal",
    payload: input.payload ?? {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

type SourceCommandFixture = Readonly<{
  command: string | null;
  outcome?: "succeeded" | "failed";
  exitCode?: number | null;
}>;

function seedFinalizingRun(
  persistence: OwnLoopPersistence,
  fixture: SourceCommandFixture = { command: "pnpm test", outcome: "succeeded", exitCode: 0 },
  reconciliationOutcome: "captured" | "partial" = "captured",
): void {
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
  const events: NormalizedEventEnvelope[] = [
    event({ eventId: "baseline-event", sequence: 1, type: "snapshot.baseline_captured" }),
  ];
  let sequence = 2;
  if (fixture.command !== null) {
    const outcome = fixture.outcome ?? "succeeded";
    const exitCode =
      fixture.exitCode === undefined ? (outcome === "succeeded" ? 0 : 1) : fixture.exitCode;
    const response =
      exitCode === null ? { stdout: "observed output" } : { exitCode, stdout: "observed output" };
    events.push(
      event({
        eventId: "bash-event",
        sequence,
        type: outcome === "succeeded" ? "tool.succeeded" : "tool.failed",
        source: "claude_code",
        sourceEventName: outcome === "succeeded" ? "PostToolUse" : "PostToolUseFailure",
        occurredAt: COMMAND_AT,
        payload:
          outcome === "succeeded"
            ? {
                tool_name: "Bash",
                tool_input: { command: fixture.command },
                tool_response: response,
              }
            : {
                tool_name: "Bash",
                tool_input: { command: fixture.command },
                tool_response: response,
                error: "observed command failure",
              },
      }),
    );
    sequence += 1;
  }
  events.push(
    event({
      eventId: "stop-event",
      sequence,
      type: "run.stop_observed",
      source: "claude_code",
      sourceEventName: "Stop",
      occurredAt: STOPPED_AT,
    }),
    event({ eventId: "summary-event", sequence: sequence + 1, type: "git.diff_computed" }),
    event({ eventId: "file-event", sequence: sequence + 2, type: "file.change_observed" }),
  );
  for (const item of events) persistence.events.append(item);
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
    outcome: reconciliationOutcome,
    diagnosticCode: reconciliationOutcome === "partial" ? "baseline_partial" : null,
    attribution: reconciliationOutcome === "partial" ? "unavailable" : "run_relative",
    baselineComparison: reconciliationOutcome === "partial" ? "unavailable" : "changed",
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
    capturedAt: STOPPED_AT,
  });
  persistence.gitReconciliations.insertEntry({
    reconciliationId: "reconciliation-1",
    entryIndex: 0,
    fileEventId: "file-event",
    pathIdentitySha256: "1".repeat(64),
    relativePath: "src/example.test.ts",
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity: "normal",
    attribution: reconciliationOutcome === "partial" ? "unavailable" : "run_relative",
  });
}

async function createContext(
  input: Readonly<{
    databasePath?: string;
    source?: SourceCommandFixture;
    reconciliationOutcome?: "captured" | "partial";
  }> = {},
): Promise<{
  directory: string;
  artifactRoot: string;
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}> {
  const directory = await temporaryDirectory("ownloop-evidence-graph-");
  const artifactRoot = join(directory, "artifacts");
  const persistence = openPersistence(input.databasePath ?? ":memory:");
  seedFinalizingRun(persistence, input.source, input.reconciliationOutcome);
  const artifactIds = [
    "manifest-artifact",
    "classification-artifact",
    "verification-artifact",
    "graph-artifact",
  ];
  const artifactStore = await createLocalArtifactStore({
    artifactRoot,
    persistence,
    clock: () => new Date(FINALIZED_AT),
    artifactIdGenerator: () => artifactIds.shift() ?? "extra-artifact",
  });
  const finalEventIds = ["snapshot-event", "terminal-event"];
  await finalizeRun(
    {
      persistence,
      artifactStore,
      clock: () => new Date(FINALIZED_AT),
      finalizationIdGenerator: () => "finalization-1",
      eventIdGenerator: () => finalEventIds.shift() ?? "extra-final-event",
      evidenceGapIdGenerator: () => "gap-1",
    },
    "run-1",
  );
  await classifyFinalizedRunChanges({ persistence, artifactStore }, "run-1");
  return { directory, artifactRoot, persistence, artifactStore };
}

function dependencies(
  context: Readonly<{ persistence: OwnLoopPersistence; artifactStore: LocalArtifactStore }>,
) {
  return { persistence: context.persistence, artifactStore: context.artifactStore };
}

describe("Evidence Graph processor", () => {
  it("persists one canonical graph and resolves Run-scoped evidence", async () => {
    const context = await createContext();
    try {
      const result = await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      expect(result).toMatchObject({
        artifactId: "graph-artifact",
        runId: "run-1",
        outcome: "partial",
        limitations: ["diff_hunks_not_retained"],
      });
      expect(result?.nodeCount).toBeGreaterThan(0);
      expect(result?.edgeCount).toBeGreaterThan(0);
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_EVIDENCE_GRAPH_ROLE),
      ).toHaveLength(1);

      const graph = await readValidatedRunEvidenceGraph(dependencies(context), "run-1");
      const changedFile = graph?.value.nodes.find((node) => node.kind === "changed_file");
      expect(changedFile).toBeDefined();
      expect(
        await resolveRunEvidence(dependencies(context), "run-1", changedFile?.evidenceId ?? ""),
      ).toMatchObject({
        ok: true,
        runId: "run-1",
        nodeKind: "changed_file",
        anchor: { kind: "changed_file", sectionId: "changed-files", sourceId: "file-event" },
      });
      expect(
        await resolveRunEvidence(dependencies(context), "other-run", changedFile?.evidenceId ?? ""),
      ).toBeNull();

      const serialized = JSON.stringify(graph?.value);
      expect(serialized).not.toContain("/workspace/project");
      expect(serialized).not.toContain("src/example.test.ts");
      expect(serialized).not.toContain("pnpm test");
      expect(serialized).not.toContain(HASH_A);
    } finally {
      context.persistence.close();
    }
  });

  it("is idempotent under repeated and concurrent graph construction", async () => {
    const context = await createContext();
    try {
      const [first, second] = await Promise.all([
        buildFinalizedRunEvidenceGraph(dependencies(context), "run-1"),
        buildFinalizedRunEvidenceGraph(dependencies(context), "run-1"),
      ]);
      expect(second).toEqual(first);
      expect(await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1")).toEqual(first);
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_EVIDENCE_GRAPH_ROLE),
      ).toHaveLength(1);
    } finally {
      context.persistence.close();
    }
  });

  it("survives restart and remains stable after later Events", async () => {
    const directory = await temporaryDirectory("ownloop-evidence-graph-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({ databasePath });
    const first = await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
    const nextSequence = context.persistence.events.nextSequence("run-1");
    context.persistence.events.append(
      event({ eventId: "later-derived-event", sequence: nextSequence, type: "redaction.applied" }),
    );
    context.persistence.close();

    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: context.artifactRoot,
      persistence,
    });
    try {
      expect(await getRunEvidenceGraph({ persistence, artifactStore }, "run-1")).toEqual(first);
    } finally {
      persistence.close();
    }
  });

  it("reads the exact graph role with more than 1000 unrelated references", async () => {
    const context = await createContext();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const digestHex = createHash("sha256").update(`graph-unrelated-${index}`).digest("hex");
        const artifactId = `graph-unrelated-${index}`;
        context.persistence.artifacts.insertMetadata({
          artifactId,
          digest: `sha256:${digestHex}`,
          storagePath: `objects/sha256/${digestHex.slice(0, 2)}/${digestHex.slice(2)}`,
          sizeBytes: 1,
          kind: "unrelated-artifact",
          sensitivity: "normal",
          storageVersion: 1,
          mediaType: "application/octet-stream",
          createdAt: FINALIZED_AT,
        });
        context.persistence.artifacts.linkToRun({
          runId: "run-1",
          artifactId,
          role: "unrelated-artifact",
          createdAt: FINALIZED_AT,
        });
      }
      const result = await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      expect(await getRunEvidenceGraph(dependencies(context), "run-1")).toEqual(result);
    } finally {
      context.persistence.close();
    }
  });

  it("leaves only an unreferenced GC-eligible object when graph linking fails", async () => {
    const context = await createContext();
    try {
      await extractFinalizedRunVerificationEvidence(
        {
          persistence: context.persistence,
          artifactStore: context.artifactStore,
          clock: () => new Date("2026-07-22T10:03:00.000Z"),
        },
        "run-1",
      );
      const failingPersistence = new Proxy(context.persistence, {
        get(target, property, receiver) {
          if (property === "withTransaction") {
            return () => {
              throw new PersistenceError("operation_failed", "forced graph reference failure");
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as OwnLoopPersistence;
      const failingStore = await createLocalArtifactStore({
        artifactRoot: context.artifactRoot,
        persistence: failingPersistence,
        clock: () => new Date("2026-07-22T10:04:00.000Z"),
        artifactIdGenerator: () => "graph-failed-artifact",
      });
      await expect(
        buildFinalizedRunEvidenceGraph(
          { persistence: failingPersistence, artifactStore: failingStore },
          "run-1",
        ),
      ).rejects.toMatchObject({ code: "artifact_reference_failed" });
      expect(
        context.persistence.artifacts.getRecordForRunRole(
          "run-1",
          DETERMINISTIC_EVIDENCE_GRAPH_ROLE,
        ),
      ).toBeNull();
      expect(context.persistence.artifacts.getMetadata("graph-failed-artifact")).toBeNull();
      expect(context.persistence.artifacts.countReferences("graph-failed-artifact")).toBe(0);
      expect(await context.artifactStore.sweepOrphanObjects()).toMatchObject({
        objectsDeleted: 1,
      });
    } finally {
      context.persistence.close();
    }
  });

  it("rejects graph bytes that no longer match OL-010 integrity", async () => {
    const context = await createContext();
    try {
      await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      const metadata = context.persistence.artifacts.getMetadata("graph-artifact");
      expect(metadata).not.toBeNull();
      if (metadata === null) throw new Error("Graph metadata is missing.");
      await writeFile(join(context.artifactRoot, metadata.storagePath), "tampered graph bytes");
      await expect(getRunEvidenceGraph(dependencies(context), "run-1")).rejects.toMatchObject({
        code: "artifact_content_corrupt",
      });
    } finally {
      context.persistence.close();
    }
  });

  it("rejects graph read-back when accepted source Events change", async () => {
    const context = await createContext();
    try {
      await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      const tamperedEvents = new Proxy(context.persistence.events, {
        get(target, property, receiver) {
          if (property === "listForRunPrefixExact") {
            return (runId: string, count: number) =>
              target
                .listForRunPrefixExact(runId, count)
                .map((item) =>
                  item.eventId === "file-event" ? { ...item, type: "file.deleted" as const } : item,
                );
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const tamperedPersistence = {
        ...context.persistence,
        events: tamperedEvents,
      } as OwnLoopPersistence;
      await expect(
        getRunEvidenceGraph(
          { persistence: tamperedPersistence, artifactStore: context.artifactStore },
          "run-1",
        ),
      ).rejects.toMatchObject({ code: "invalid_persisted_row" });
    } finally {
      context.persistence.close();
    }
  });

  it("processes eligible finalized Runs through an explicit bounded batch", async () => {
    const context = await createContext();
    try {
      expect(await buildEligibleFinalizedRunEvidenceGraphs(dependencies(context), 0)).toEqual([]);
      expect(await buildEligibleFinalizedRunEvidenceGraphs(dependencies(context), 25)).toHaveLength(
        1,
      );
      expect(await buildEligibleFinalizedRunEvidenceGraphs(dependencies(context), 25)).toEqual([]);
    } finally {
      context.persistence.close();
    }
  });

  it("authenticates before resolving Run-scoped evidence over loopback", async () => {
    const context = await createContext();
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: context.persistence,
      installationToken: token,
      hmacKey: createSecretKey(Buffer.alloc(32, 7)),
      replay: { persistence: context.persistence, artifactStore: context.artifactStore },
    });
    try {
      await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      const graph = await readValidatedRunEvidenceGraph(dependencies(context), "run-1");
      const evidenceId = graph?.value.nodes.find(
        (node) => node.kind === "changed_file",
      )?.evidenceId;
      expect(evidenceId).toBeDefined();
      const address = await startLoopbackIngressServer(server, 0);

      const replayResponse = await fetch(`${address.url}/v1/replay/runs/run-1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(replayResponse.status).toBe(200);
      const replay = await replayResponse.json();
      expect(replay).toMatchObject({
        evidenceGraph: {
          artifactId: "graph-artifact",
          outcome: "partial",
          limitations: ["diff_hunks_not_retained"],
        },
      });
      expect(replay.reconciliations[0].changedFiles[0].evidenceId).toBe(evidenceId);

      const unauthorized = await fetch(
        `${address.url}/v1/replay/runs/run-1/evidence/${evidenceId ?? "missing"}`,
      );
      expect(unauthorized.status).toBe(401);
      expect(ReplayErrorResponseSchema.parse(await unauthorized.json()).error.code).toBe(
        "unauthorized",
      );

      const resolved = await fetch(
        `${address.url}/v1/replay/runs/run-1/evidence/${evidenceId ?? "missing"}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(resolved.status).toBe(200);
      expect(EvidenceResolutionV1Schema.parse(await resolved.json())).toMatchObject({
        runId: "run-1",
        evidenceId,
        nodeKind: "changed_file",
      });

      const wrongRun = await fetch(
        `${address.url}/v1/replay/runs/other-run/evidence/${evidenceId ?? "missing"}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(wrongRun.status).toBe(404);
      expect(ReplayErrorResponseSchema.parse(await wrongRun.json()).error.code).toBe(
        "evidence_not_found",
      );
    } finally {
      await server.close();
      context.persistence.close();
    }
  });

  it("keeps controlled evidence navigation compatible with Raw Replay", async () => {
    const context = await createContext();
    try {
      await buildFinalizedRunEvidenceGraph(dependencies(context), "run-1");
      const replay = projectRawRunReplay(context.persistence, "run-1");
      expect(replay?.verification.map((item) => item.type)).toEqual([
        "command.completed",
        "test.observed",
      ]);
      expect(JSON.stringify(replay)).not.toContain("pnpm test");
    } finally {
      context.persistence.close();
    }
  });
});
