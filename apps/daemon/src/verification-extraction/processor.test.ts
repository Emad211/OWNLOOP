import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import { classifyFinalizedRunChanges } from "../change-classification/index.js";
import { finalizeRun } from "../finalization/index.js";
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
import {
  DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
  extractEligibleFinalizedRunVerificationEvidence,
  extractFinalizedRunVerificationEvidence,
  getRunVerificationEvidence,
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
  const directory = await temporaryDirectory("ownloop-verification-");
  const artifactRoot = join(directory, "artifacts");
  const persistence = openPersistence(input.databasePath ?? ":memory:");
  seedFinalizingRun(persistence, input.source, input.reconciliationOutcome);
  const artifactIds = ["manifest-artifact", "classification-artifact", "verification-artifact"];
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
  return {
    persistence: context.persistence,
    artifactStore: context.artifactStore,
    clock: () => new Date("2026-07-22T10:03:00.000Z"),
  };
}

describe("verification extraction processor", () => {
  it("stores one canonical artifact and appends controlled replay-safe Events", async () => {
    const context = await createContext();
    try {
      const result = await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
      expect(result).toMatchObject({
        artifactId: "verification-artifact",
        outcome: "extracted",
        commandObservationCount: 1,
        recognizedCommandCount: 1,
        unknownCommandCount: 0,
        testFileChangeCount: 1,
      });
      expect(result?.aggregateKinds).toEqual([
        {
          kind: "test",
          observationCount: 1,
          passedCount: 1,
          failedCount: 0,
          observedWithoutExitCodeCount: 0,
        },
      ]);
      const events = context.persistence.events.listForRun("run-1");
      expect(events.map((item) => item.sequence)).toEqual(events.map((_, index) => index + 1));
      expect(events.slice(-2).map((item) => item.type)).toEqual([
        "command.completed",
        "test.observed",
      ]);
      expect(JSON.stringify(events.slice(-2))).not.toContain("pnpm test");
      expect(JSON.stringify(events.slice(-2))).not.toContain("2 tests passed");

      const replay = projectRawRunReplay(context.persistence, "run-1");
      expect(replay?.verification.map((item) => item.type)).toEqual([
        "command.completed",
        "test.observed",
      ]);
      expect(replay?.verification[0]?.payload).toMatchObject({
        observationIndex: 0,
        verificationKind: "test",
        recognized: true,
        exitCode: 0,
      });
      expect(replay?.verification[0]?.payload).not.toHaveProperty("command");
      expect(replay?.verification[0]?.payload).not.toHaveProperty("output");
    } finally {
      context.persistence.close();
    }
  });

  it("keeps ambiguous commands unknown and separate from test-file changes", async () => {
    const context = await createContext({ source: { command: "npm run verify" } });
    try {
      const result = await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
      expect(result).toMatchObject({
        recognizedCommandCount: 0,
        unknownCommandCount: 1,
        testFileChangeCount: 1,
      });
      expect(context.persistence.events.listForRun("run-1").slice(-1)[0]?.type).toBe(
        "command.completed",
      );
      expect(projectRawRunReplay(context.persistence, "run-1")?.verification).toHaveLength(1);
    } finally {
      context.persistence.close();
    }
  });

  it("covers five controlled evidence outcomes without inferred success", async () => {
    const fixtures = [
      {
        source: { command: "pnpm test", outcome: "succeeded", exitCode: 0 } as const,
        expected: {
          commandObservationCount: 1,
          recognizedCommandCount: 1,
          kind: "test",
          status: "passed",
        },
      },
      {
        source: { command: "pnpm lint", outcome: "succeeded", exitCode: null } as const,
        expected: {
          commandObservationCount: 1,
          recognizedCommandCount: 1,
          kind: "lint",
          status: "observed_without_exit_code",
        },
      },
      {
        source: { command: "npm run verify", outcome: "succeeded", exitCode: 0 } as const,
        expected: {
          commandObservationCount: 1,
          recognizedCommandCount: 0,
          kind: null,
          status: null,
        },
      },
      {
        source: { command: "pnpm build", outcome: "failed", exitCode: 1 } as const,
        expected: {
          commandObservationCount: 1,
          recognizedCommandCount: 1,
          kind: "build",
          status: "failed",
        },
      },
      {
        source: { command: null } as const,
        expected: {
          commandObservationCount: 0,
          recognizedCommandCount: 0,
          kind: null,
          status: null,
        },
      },
    ];

    for (const fixture of fixtures) {
      const context = await createContext({ source: fixture.source });
      try {
        const result = await extractFinalizedRunVerificationEvidence(
          dependencies(context),
          "run-1",
        );
        expect(result).toMatchObject({
          commandObservationCount: fixture.expected.commandObservationCount,
          recognizedCommandCount: fixture.expected.recognizedCommandCount,
          testFileChangeCount: 1,
        });
        const replay = projectRawRunReplay(context.persistence, "run-1");
        const observed = replay?.verification.find((item) => item.type.endsWith(".observed"));
        if (fixture.expected.kind === null) {
          expect(observed).toBeUndefined();
        } else {
          expect(observed?.type).toBe(`${fixture.expected.kind}.observed`);
          expect(observed?.payload.status).toBe(fixture.expected.status);
        }
      } finally {
        context.persistence.close();
      }
    }
  });

  it("propagates a partial final reconciliation into verification outcome", async () => {
    const context = await createContext({ reconciliationOutcome: "partial" });
    try {
      const result = await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
      expect(result).toMatchObject({
        outcome: "partial",
        diagnosticCode: "classification_partial",
        recognizedCommandCount: 1,
        testFileChangeCount: 1,
      });
      expect(context.persistence.taskRuns.get("run-1")?.status).toBe("Partial");
    } finally {
      context.persistence.close();
    }
  });

  it("is idempotent under repeated and concurrent extraction", async () => {
    const context = await createContext();
    try {
      const [first, second] = await Promise.all([
        extractFinalizedRunVerificationEvidence(dependencies(context), "run-1"),
        extractFinalizedRunVerificationEvidence(dependencies(context), "run-1"),
      ]);
      expect(second).toEqual(first);
      expect(await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1")).toEqual(
        first,
      );
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE),
      ).toHaveLength(1);
      expect(
        context.persistence.events
          .listForRun("run-1")
          .filter((event) => event.source === "ownloop" && event.type === "test.observed"),
      ).toHaveLength(1);
    } finally {
      context.persistence.close();
    }
  });

  it("survives file-backed restart and remains stable after later Events", async () => {
    const directory = await temporaryDirectory("ownloop-verification-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext({ databasePath });
    const first = await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
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
      expect(await getRunVerificationEvidence({ persistence, artifactStore }, "run-1")).toEqual(
        first,
      );
    } finally {
      persistence.close();
    }
  });

  it("reads its exact role with more than 1000 unrelated references", async () => {
    const context = await createContext();
    try {
      for (let index = 0; index < 1001; index += 1) {
        const digestHex = createHash("sha256").update(`unrelated-${index}`).digest("hex");
        const artifactId = `unrelated-${index}`;
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
      const result = await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
      expect(await getRunVerificationEvidence(dependencies(context), "run-1")).toEqual(result);
    } finally {
      context.persistence.close();
    }
  });

  it("rolls back references and derived Events when the SQLite transaction fails", async () => {
    const context = await createContext();
    const failingPersistence = new Proxy(context.persistence, {
      get(target, property, receiver) {
        if (property === "withTransaction") {
          return () => {
            throw new PersistenceError(
              "operation_failed",
              "forced verification transaction failure",
            );
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OwnLoopPersistence;
    try {
      await expect(
        extractFinalizedRunVerificationEvidence(
          { persistence: failingPersistence, artifactStore: context.artifactStore },
          "run-1",
        ),
      ).rejects.toMatchObject({ code: "operation_failed" });
      expect(
        context.persistence.artifacts
          .listForRun("run-1")
          .filter((reference) => reference.role === DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE),
      ).toEqual([]);
      expect(context.persistence.events.listForRun("run-1")).toHaveLength(7);
      expect(context.persistence.artifacts.getMetadata("verification-artifact")).not.toBeNull();
      expect(context.persistence.artifacts.countReferences("verification-artifact")).toBe(0);
      expect(await context.artifactStore.collectUnreferencedArtifacts()).toMatchObject({
        candidates: 1,
        metadataDeleted: 1,
        objectsDeleted: 1,
      });
    } finally {
      context.persistence.close();
    }
  });

  it("rejects read-back when accepted source command evidence changes", async () => {
    const context = await createContext();
    try {
      await extractFinalizedRunVerificationEvidence(dependencies(context), "run-1");
      const tamperedEvents = new Proxy(context.persistence.events, {
        get(target, property, receiver) {
          if (property === "listForRunPrefixExact") {
            return (runId: string, count: number) =>
              target.listForRunPrefixExact(runId, count).map((item) =>
                item.eventId === "bash-event"
                  ? {
                      ...item,
                      payload: {
                        ...item.payload,
                        tool_input: { command: "pnpm build" },
                      },
                    }
                  : item,
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
        getRunVerificationEvidence(
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
      expect(
        await extractEligibleFinalizedRunVerificationEvidence(dependencies(context), 0),
      ).toEqual([]);
      expect(
        await extractEligibleFinalizedRunVerificationEvidence(dependencies(context), 25),
      ).toHaveLength(1);
      expect(
        await extractEligibleFinalizedRunVerificationEvidence(dependencies(context), 25),
      ).toEqual([]);
    } finally {
      context.persistence.close();
    }
  });
});
