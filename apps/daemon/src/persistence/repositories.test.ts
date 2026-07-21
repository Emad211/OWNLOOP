import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "./database.js";
import { isSqliteConstraintError, PersistenceConstraintError } from "./errors.js";
import {
  type AgentConversation,
  type AnalysisJobRecord,
  type ArtifactMetadata,
  type EvidenceGapRecord,
  type NewPreparedIngressReceipt,
  type OwnLoopPersistence,
  openPersistence,
  type TaskRun,
  type Workspace,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import { AgentConversationRepository } from "./repositories/conversations.js";
import { EventRepository } from "./repositories/events.js";
import { TaskRunRepository } from "./repositories/task-runs.js";
import { WorkspaceRepository } from "./repositories/workspaces.js";

const TIMESTAMP = "2026-07-19T18:00:00.000Z";
const openHandles: OwnLoopPersistence[] = [];
const temporaryDirectories: string[] = [];

function openMemoryPersistence(): OwnLoopPersistence {
  const persistence = openPersistence(":memory:");
  openHandles.push(persistence);
  return persistence;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    workspaceId: "workspace-1",
    canonicalPath: "C:/projects/ownloop",
    repositoryRoot: "C:/projects/ownloop",
    gitRemote: "https://github.com/Emad211/OWNLOOP.git",
    initialRepositoryFingerprint: "workspace-fingerprint-1",
    createdAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
    ...overrides,
  };
}

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    source: "claude_code",
    sourceSessionId: "source-session-1",
    startMode: "startup",
    startedAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
    endedAt: null,
    status: "active",
    ...overrides,
  };
}

function taskRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt: "Implement [REDACTED] safely.",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: TIMESTAMP,
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
    ...overrides,
  };
}

function ingressReceipt(
  overrides: Partial<NewPreparedIngressReceipt> = {},
): NewPreparedIngressReceipt {
  return {
    receiptId: "receipt-1",
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "claude_code",
    adapterVersion: "1.2.3",
    sourceSessionId: "source-session-1",
    sourceEventName: "UserPromptSubmit",
    sourceEventId: null,
    canonicalWorkspacePath: "/workspace/project",
    deduplicationKey: `v1:UserPromptSubmit:hmac:${"a".repeat(64)}`,
    receivedAt: TIMESTAMP,
    payloadFingerprint: `hmac-sha256:${"a".repeat(64)}`,
    redactedPayloadJson: JSON.stringify({ prompt: "[REDACTED]" }),
    redactionSummary: {
      policyVersion: 1,
      redactedFieldCount: 0,
      redactedValueCount: 1,
      pathReplacementCount: 0,
      droppedUnknownFieldCount: 0,
      truncatedValueCount: 0,
      rulesApplied: ["string.assignment"],
      outputUtf8Bytes: 23,
    },
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

function normalizedEvent(
  overrides: Partial<NormalizedEventEnvelope> = {},
): NormalizedEventEnvelope {
  return {
    eventId: "event-1",
    schemaVersion: 1,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: 1,
    type: "user.prompt_submitted",
    source: "claude_code",
    sourceEventName: "UserPromptSubmit",
    sourceEventId: null,
    occurredAt: TIMESTAMP,
    ingestedAt: TIMESTAMP,
    sensitivity: "normal",
    payload: { prompt: "[REDACTED]" },
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    artifactId: "artifact-1",
    digest: "sha256:artifact-digest-1",
    storagePath: "artifacts/sha256/artifact-digest-1",
    sizeBytes: 42,
    kind: "redacted-diff",
    sensitivity: "normal",
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

function seedRun(persistence: OwnLoopPersistence): void {
  persistence.workspaces.insert(workspace());
  persistence.conversations.insert(conversation());
  persistence.taskRuns.insert(taskRun());
}

afterEach(() => {
  while (openHandles.length > 0) {
    openHandles.pop()?.close();
  }

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("ingress receipt persistence", () => {
  it("stores and reads only explicitly caller-declared redacted ingress JSON", () => {
    const persistence = openMemoryPersistence();
    const receipt = ingressReceipt();

    persistence.ingressReceipts.insertPrepared(receipt);

    expect(persistence.ingressReceipts.get(receipt.receiptId)).toEqual({
      ...receipt,
      preparationStatus: "prepared",
    });
  });

  it("enforces receipt deduplication within source and source session", () => {
    const persistence = openMemoryPersistence();
    persistence.ingressReceipts.insertPrepared(ingressReceipt());

    expect(() =>
      persistence.ingressReceipts.insertPrepared(
        ingressReceipt({
          receiptId: "receipt-2",
        }),
      ),
    ).toThrowError(PersistenceConstraintError);
  });

  it("permits the same receipt deduplication key in a different source session", () => {
    const persistence = openMemoryPersistence();
    persistence.ingressReceipts.insertPrepared(ingressReceipt());

    expect(() =>
      persistence.ingressReceipts.insertPrepared(
        ingressReceipt({
          receiptId: "receipt-2",
          sourceSessionId: "source-session-2",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects invalid journal JSON", () => {
    const persistence = openMemoryPersistence();

    expect(() =>
      persistence.ingressReceipts.insertPrepared(ingressReceipt({ redactedPayloadJson: "{" })),
    ).toThrowError(expect.objectContaining({ code: "operation_failed" }));
  });
});

describe("aggregate constraints", () => {
  it("enforces foreign keys", () => {
    const persistence = openMemoryPersistence();

    expect(() =>
      persistence.conversations.insert(conversation({ workspaceId: "missing-workspace" })),
    ).toThrowError(PersistenceConstraintError);
  });

  it("enforces Task Run number uniqueness within a conversation", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);

    expect(() => persistence.taskRuns.insert(taskRun({ runId: "run-2" }))).toThrowError(
      PersistenceConstraintError,
    );
  });

  it.each([
    { name: "evidence gap details", kind: "gap" as const },
    { name: "analysis job input", kind: "job" as const },
  ])("rejects invalid JSON in $name", ({ kind }) => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);

    if (kind === "gap") {
      const gap: EvidenceGapRecord = {
        gapId: "gap-1",
        runId: "run-1",
        code: "missing_boundary",
        message: "A required boundary is missing.",
        detailsJson: "{",
        createdAt: TIMESTAMP,
      };
      expect(() => persistence.runSupport.insertEvidenceGap(gap)).toThrowError(
        PersistenceConstraintError,
      );
      return;
    }

    const job: AnalysisJobRecord = {
      jobId: "job-1",
      runId: "run-1",
      kind: "reconciliation",
      status: "pending",
      inputJson: "{",
      attemptCount: 0,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      lastError: null,
    };
    expect(() => persistence.runSupport.insertAnalysisJob(job)).toThrowError(
      PersistenceConstraintError,
    );
  });
});

describe("append-only events", () => {
  it.each([
    { name: "run without sequence", runId: "run-1", sequence: null },
    { name: "sequence without run", runId: null, sequence: 1 },
  ])("rejects $name", ({ runId, sequence }) => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    const invalidEvent = normalizedEvent({ runId, sequence }) as NormalizedEventEnvelope;

    expect(() => persistence.events.append(invalidEvent)).toThrowError(PersistenceConstraintError);
  });

  it.each([0, -1])("rejects non-positive event sequence %s", (sequence) => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);

    expect(() =>
      persistence.events.append(normalizedEvent({ sequence }) as NormalizedEventEnvelope),
    ).toThrowError(PersistenceConstraintError);
  });

  it("enforces unique sequence numbers within a Task Run", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.events.append(normalizedEvent());

    expect(() => persistence.events.append(normalizedEvent({ eventId: "event-2" }))).toThrowError(
      PersistenceConstraintError,
    );
  });

  it("appends events and reads a Task Run in sequence order", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.events.append(normalizedEvent({ eventId: "event-2", sequence: 2 }));
    persistence.events.append(normalizedEvent({ eventId: "event-1", sequence: 1 }));

    expect(persistence.events.listForRun("run-1").map(({ eventId }) => eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
  });

  it("has no event update operation in the repository API", () => {
    const persistence = openMemoryPersistence();

    expect("update" in persistence.events).toBe(false);
    expect("updateEvent" in persistence.events).toBe(false);
  });

  it("rejects direct event updates through the database trigger", () => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      runMigrations(opened.database);
      const repositories = {
        workspaces: new WorkspaceRepository(opened.database),
        conversations: new AgentConversationRepository(opened.database),
        taskRuns: new TaskRunRepository(opened.database),
        events: new EventRepository(opened.database),
      };
      repositories.workspaces.insert(workspace());
      repositories.conversations.insert(conversation());
      repositories.taskRuns.insert(taskRun());
      repositories.events.append(normalizedEvent());

      let updateError: unknown;
      try {
        opened.database
          .prepare("UPDATE events SET sensitivity = ? WHERE event_id = ?")
          .run("public", "event-1");
      } catch (error) {
        updateError = error;
      }

      expect(isSqliteConstraintError(updateError)).toBe(true);
      expect(repositories.events.get("event-1")?.sensitivity).toBe("normal");
    } finally {
      opened.database.close();
    }
  });
});

describe("deletion behavior", () => {
  it("cascades Task Run records and references", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.events.append(normalizedEvent());
    persistence.events.recordDeduplicationKey({
      source: "claude_code",
      sourceSessionId: "source-session-1",
      deduplicationKey: "event-deduplication-1",
      eventId: "event-1",
      createdAt: TIMESTAMP,
    });
    persistence.runSupport.insertEvidenceGap({
      gapId: "gap-1",
      runId: "run-1",
      code: "missing_boundary",
      message: "A required boundary is missing.",
      detailsJson: JSON.stringify({ hook: "Stop" }),
      createdAt: TIMESTAMP,
    });
    persistence.runSupport.insertAnalysisJob({
      jobId: "job-1",
      runId: "run-1",
      kind: "reconciliation",
      status: "pending",
      inputJson: JSON.stringify({ reason: "test" }),
      attemptCount: 0,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      lastError: null,
    });
    persistence.artifacts.insertMetadata(artifact());
    persistence.artifacts.linkToRun({
      runId: "run-1",
      artifactId: "artifact-1",
      role: "final-diff",
      createdAt: TIMESTAMP,
    });

    expect(persistence.taskRuns.delete("run-1")).toBe(true);
    expect(persistence.taskRuns.get("run-1")).toBeNull();
    expect(persistence.events.get("event-1")).toBeNull();
    expect(persistence.events.countDeduplicationKeysForEvent("event-1")).toBe(0);
    expect(persistence.runSupport.countEvidenceGaps("run-1")).toBe(0);
    expect(persistence.runSupport.countAnalysisJobs("run-1")).toBe(0);
    expect(persistence.artifacts.listForRun("run-1")).toEqual([]);
  });

  it("preserves conversation-level events when deleting a child Task Run", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.events.append(
      normalizedEvent({
        eventId: "conversation-event-1",
        runId: null,
        sequence: null,
        type: "conversation.started",
      }),
    );
    persistence.events.append(normalizedEvent());

    persistence.taskRuns.delete("run-1");

    expect(persistence.events.get("event-1")).toBeNull();
    expect(persistence.events.get("conversation-event-1")).not.toBeNull();
  });

  it("preserves shared artifact metadata and the remaining Task Run reference", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.taskRuns.insert(taskRun({ runId: "run-2", runNumber: 2 }));
    persistence.artifacts.insertMetadata(artifact());
    persistence.artifacts.linkToRun({
      runId: "run-1",
      artifactId: "artifact-1",
      role: "final-diff",
      createdAt: TIMESTAMP,
    });
    persistence.artifacts.linkToRun({
      runId: "run-2",
      artifactId: "artifact-1",
      role: "final-diff",
      createdAt: TIMESTAMP,
    });

    persistence.taskRuns.delete("run-1");

    expect(persistence.artifacts.getMetadata("artifact-1")).toEqual(artifact());
    expect(persistence.artifacts.listForRun("run-2")).toEqual([
      {
        runId: "run-2",
        artifactId: "artifact-1",
        role: "final-diff",
        createdAt: TIMESTAMP,
      },
    ]);
  });

  it("cascades conversations, runs, and events on explicit workspace deletion", () => {
    const persistence = openMemoryPersistence();
    seedRun(persistence);
    persistence.events.append(normalizedEvent());

    expect(persistence.workspaces.delete("workspace-1")).toBe(true);
    expect(persistence.workspaces.get("workspace-1")).toBeNull();
    expect(persistence.conversations.get("conversation-1")).toBeNull();
    expect(persistence.taskRuns.get("run-1")).toBeNull();
    expect(persistence.events.get("event-1")).toBeNull();
  });
});

describe("transactions and file-backed durability", () => {
  it("rolls back an explicit transaction when a later operation fails", () => {
    const persistence = openMemoryPersistence();

    expect(() =>
      persistence.withTransaction(({ workspaces }) => {
        workspaces.insert(workspace());
        throw new Error("later operation failed");
      }),
    ).toThrow("later operation failed");
    expect(persistence.workspaces.get("workspace-1")).toBeNull();
  });

  it("preserves data after a file-backed database is closed and reopened", () => {
    const databasePath = temporaryDatabasePath();
    const receipt = ingressReceipt();
    const first = openPersistence(databasePath);
    openHandles.push(first);

    first.ingressReceipts.insertPrepared(receipt);
    first.workspaces.insert(workspace());
    first.close();

    const reopened = openPersistence(databasePath);
    openHandles.push(reopened);

    expect(reopened.connectionInfo).toMatchObject({ fileBacked: true, journalMode: "wal" });
    expect(reopened.ingressReceipts.get("receipt-1")).toEqual({
      ...receipt,
      preparationStatus: "prepared",
    });
    expect(reopened.workspaces.get("workspace-1")).toEqual(workspace());
  });
});
