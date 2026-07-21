import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { describe, expect, it } from "vitest";

import {
  openPersistence,
  type AgentConversation,
  type OwnLoopPersistence,
  PersistenceConstraintError,
  PersistenceError,
  type PersistenceRepositories,
  type TaskRun,
  type Workspace,
} from "./index.js";

const TIMESTAMP = "2026-07-21T08:00:00.000Z";

function workspace(id: string): Workspace {
  return {
    workspaceId: `workspace-${id}`,
    canonicalPath: `/fixtures/${id}`,
    repositoryRoot: `/fixtures/${id}`,
    gitRemote: null,
    initialRepositoryFingerprint: `workspace-fingerprint-${id}`,
    createdAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
  };
}

function conversation(id: string, workspaceId: string): AgentConversation {
  return {
    conversationId: `conversation-${id}`,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `source-session-${id}`,
    startMode: "startup",
    startedAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
    endedAt: null,
    status: "active",
  };
}

function taskRun(id: string, conversationId: string, runNumber = 1): TaskRun {
  return {
    runId: `run-${id}`,
    conversationId,
    runNumber,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: TIMESTAMP,
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  };
}

function event(
  id: string,
  workspaceId: string,
  conversationId: string,
  runId: string | null,
  sequence: number | null,
): NormalizedEventEnvelope {
  return {
    eventId: `event-${id}`,
    schemaVersion: 1,
    workspaceId,
    conversationId,
    runId,
    sequence,
    type: runId === null ? "conversation.started" : "user.prompt_submitted",
    source: "claude_code",
    sourceEventName: runId === null ? "SessionStart" : "UserPromptSubmit",
    sourceEventId: null,
    occurredAt: TIMESTAMP,
    ingestedAt: TIMESTAMP,
    sensitivity: "normal",
    payload: {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  };
}

function withPersistence(operation: (persistence: OwnLoopPersistence) => void): void {
  const persistence = openPersistence(":memory:");
  try {
    operation(persistence);
  } finally {
    persistence.close();
  }
}

if (false) {
  const persistence = openPersistence(":memory:");
  // @ts-expect-error Persistence transaction callbacks must not return PromiseLike values.
  persistence.withTransaction(async () => undefined);
}

describe("Event aggregate consistency", () => {
  it("rejects an Event whose Conversation belongs to another Workspace", () => {
    withPersistence((persistence) => {
      const firstWorkspace = workspace("a");
      const secondWorkspace = workspace("b");
      const secondConversation = conversation("b", secondWorkspace.workspaceId);
      persistence.workspaces.insert(firstWorkspace);
      persistence.workspaces.insert(secondWorkspace);
      persistence.conversations.insert(secondConversation);

      expect(() =>
        persistence.events.append(
          event(
            "workspace-mismatch",
            firstWorkspace.workspaceId,
            secondConversation.conversationId,
            null,
            null,
          ),
        ),
      ).toThrowError(PersistenceConstraintError);
    });
  });

  it("rejects an Event whose Task Run belongs to another Conversation", () => {
    withPersistence((persistence) => {
      const sharedWorkspace = workspace("shared");
      const firstConversation = conversation("first", sharedWorkspace.workspaceId);
      const secondConversation = conversation("second", sharedWorkspace.workspaceId);
      const secondRun = taskRun("second", secondConversation.conversationId);
      persistence.workspaces.insert(sharedWorkspace);
      persistence.conversations.insert(firstConversation);
      persistence.conversations.insert(secondConversation);
      persistence.taskRuns.insert(secondRun);

      expect(() =>
        persistence.events.append(
          event(
            "run-mismatch",
            sharedWorkspace.workspaceId,
            firstConversation.conversationId,
            secondRun.runId,
            1,
          ),
        ),
      ).toThrowError(PersistenceConstraintError);
    });
  });

  it("accepts valid Run-level and Conversation-level Events", () => {
    withPersistence((persistence) => {
      const targetWorkspace = workspace("valid");
      const targetConversation = conversation("valid", targetWorkspace.workspaceId);
      const targetRun = taskRun("valid", targetConversation.conversationId);
      persistence.workspaces.insert(targetWorkspace);
      persistence.conversations.insert(targetConversation);
      persistence.taskRuns.insert(targetRun);

      const conversationEvent = event(
        "conversation-valid",
        targetWorkspace.workspaceId,
        targetConversation.conversationId,
        null,
        null,
      );
      const runEvent = event(
        "run-valid",
        targetWorkspace.workspaceId,
        targetConversation.conversationId,
        targetRun.runId,
        1,
      );

      persistence.events.append(conversationEvent);
      persistence.events.append(runEvent);

      expect(persistence.events.get(conversationEvent.eventId)).toEqual(conversationEvent);
      expect(persistence.events.get(runEvent.eventId)).toEqual(runEvent);
    });
  });

  it("preserves composite-FK cascade behavior", () => {
    withPersistence((persistence) => {
      const targetWorkspace = workspace("cascade");
      const targetConversation = conversation("cascade", targetWorkspace.workspaceId);
      const targetRun = taskRun("cascade", targetConversation.conversationId);
      persistence.workspaces.insert(targetWorkspace);
      persistence.conversations.insert(targetConversation);
      persistence.taskRuns.insert(targetRun);
      persistence.events.append(
        event(
          "conversation-cascade",
          targetWorkspace.workspaceId,
          targetConversation.conversationId,
          null,
          null,
        ),
      );
      persistence.events.append(
        event(
          "run-cascade",
          targetWorkspace.workspaceId,
          targetConversation.conversationId,
          targetRun.runId,
          1,
        ),
      );

      persistence.taskRuns.delete(targetRun.runId);
      expect(persistence.events.get("event-run-cascade")).toBeNull();
      expect(persistence.events.get("event-conversation-cascade")).not.toBeNull();

      persistence.workspaces.delete(targetWorkspace.workspaceId);
      expect(persistence.events.get("event-conversation-cascade")).toBeNull();
    });
  });
});

describe("Synchronous transaction boundary", () => {
  type UnsafeWithTransaction = <Result>(
    operation: (repositories: PersistenceRepositories) => Result,
  ) => Result;

  it("rejects a native async callback before it can write", () => {
    withPersistence((persistence) => {
      const unsafeWithTransaction = persistence.withTransaction as unknown as UnsafeWithTransaction;
      const asyncWorkspace = workspace("native-async");

      expect(() =>
        unsafeWithTransaction(async ({ workspaces }) => {
          workspaces.insert(asyncWorkspace);
        }),
      ).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({
          code: "async_transaction_not_supported",
        }),
      );
      expect(persistence.workspaces.get(asyncWorkspace.workspaceId)).toBeNull();
    });
  });

  it("rolls back synchronous writes when a callback returns a Promise", () => {
    withPersistence((persistence) => {
      const unsafeWithTransaction = persistence.withTransaction as unknown as UnsafeWithTransaction;
      const thenableWorkspace = workspace("thenable");

      expect(() =>
        unsafeWithTransaction(({ workspaces }) => {
          workspaces.insert(thenableWorkspace);
          return Promise.resolve();
        }),
      ).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({
          code: "async_transaction_not_supported",
        }),
      );
      expect(persistence.workspaces.get(thenableWorkspace.workspaceId)).toBeNull();
    });
  });

  it("commits a synchronous transaction", () => {
    withPersistence((persistence) => {
      const committedWorkspace = workspace("committed");

      const result = persistence.withTransaction(({ workspaces }) => {
        workspaces.insert(committedWorkspace);
        return "committed" as const;
      });

      expect(result).toBe("committed");
      expect(persistence.workspaces.get(committedWorkspace.workspaceId)).toEqual(
        committedWorkspace,
      );
    });
  });

  it("rolls back a synchronous exception", () => {
    withPersistence((persistence) => {
      const rolledBackWorkspace = workspace("rolled-back");

      expect(() =>
        persistence.withTransaction(({ workspaces }) => {
          workspaces.insert(rolledBackWorkspace);
          throw new Error("rollback fixture");
        }),
      ).toThrow("rollback fixture");
      expect(persistence.workspaces.get(rolledBackWorkspace.workspaceId)).toBeNull();
    });
  });

  it("continues to reject nested transactions", () => {
    withPersistence((persistence) => {
      expect(() =>
        persistence.withTransaction(() =>
          persistence.withTransaction(() => "nested transaction"),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({
          code: "transaction_already_active",
        }),
      );
    });
  });
});