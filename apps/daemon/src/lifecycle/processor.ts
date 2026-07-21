import { createHash, randomUUID } from "node:crypto";

import type { JsonObject, JsonValue } from "@ownloop/event-model";
import { parseCanonicalJson } from "@ownloop/ingress-security";

import {
  type AgentConversation,
  type LifecycleDiagnosticCode,
  type LifecycleResolutionAction,
  type LifecycleResolutionOutcome,
  type OwnLoopPersistence,
  type PersistenceRepositories,
  PersistenceError,
  type PreparedIngressReceiptRecord,
  type ReceiptLifecycleResolution,
  type Workspace,
} from "../persistence/index.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PENDING_BATCH = 100;

export type LifecycleIdKind = "workspace" | "conversation" | "run";

export type LifecycleProcessorDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  clock?: () => Date;
  workspaceIdGenerator?: () => string;
  conversationIdGenerator?: () => string;
  runIdGenerator?: () => string;
}>;

export type LifecycleProcessingResult = ReceiptLifecycleResolution;

class ExpectedLifecycleFailure extends Error {
  readonly diagnosticCode: LifecycleDiagnosticCode;
  readonly workspaceId: string | null;
  readonly conversationId: string | null;
  readonly runId: string | null;

  constructor(
    diagnosticCode: LifecycleDiagnosticCode,
    aggregateIds: Readonly<{
      workspaceId?: string | null;
      conversationId?: string | null;
      runId?: string | null;
    }> = {},
  ) {
    super("A controlled lifecycle invariant rejected the receipt.");
    this.name = "ExpectedLifecycleFailure";
    this.diagnosticCode = diagnosticCode;
    this.workspaceId = aggregateIds.workspaceId ?? null;
    this.conversationId = aggregateIds.conversationId ?? null;
    this.runId = aggregateIds.runId ?? null;
  }
}

function canonicalTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PersistenceError(
      "operation_failed",
      "Lifecycle processing received an invalid time.",
    );
  }
  return date.toISOString();
}

function safeGeneratedId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PersistenceError(
      "operation_failed",
      "A lifecycle identifier generator returned an unsafe identifier.",
    );
  }
  return value;
}

function pathFingerprint(canonicalPath: string): string {
  return `path-sha256:${createHash("sha256").update(canonicalPath, "utf8").digest("hex")}`;
}

function asObject(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ExpectedLifecycleFailure("invalid_redacted_payload");
  }
  return value;
}

function requiredString(record: JsonObject, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ExpectedLifecycleFailure("invalid_redacted_payload");
  }
  return value;
}

type LifecycleProjection = Readonly<{
  startMode: string | null;
  prompt: string | null;
  stopReason: string | null;
}>;

function projectLifecyclePayload(receipt: PreparedIngressReceiptRecord): LifecycleProjection {
  let parsed: JsonValue;
  try {
    parsed = parseCanonicalJson(receipt.redactedPayloadJson);
  } catch {
    throw new ExpectedLifecycleFailure("invalid_redacted_payload");
  }
  const record = asObject(parsed);

  switch (receipt.sourceEventName) {
    case "SessionStart":
      return { startMode: requiredString(record, "source"), prompt: null, stopReason: null };
    case "UserPromptSubmit":
      return { startMode: null, prompt: requiredString(record, "prompt"), stopReason: null };
    case "StopFailure":
      return { startMode: null, prompt: null, stopReason: requiredString(record, "error") };
    case "SessionEnd":
      requiredString(record, "reason");
      return { startMode: null, prompt: null, stopReason: null };
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch":
    case "Stop":
      return { startMode: null, prompt: null, stopReason: null };
    default:
      throw new ExpectedLifecycleFailure("invalid_transition");
  }
}

function insertResolution(
  persistence: PersistenceRepositories,
  resolution: ReceiptLifecycleResolution,
): ReceiptLifecycleResolution {
  persistence.lifecycleResolutions.insert(resolution);
  const statusUpdated =
    resolution.outcome === "failed"
      ? persistence.ingressReceipts.markFailed(
          resolution.receiptId,
          resolution.resolvedAt,
          resolution.diagnosticCode ?? "lifecycle_processing_failed",
        )
      : persistence.ingressReceipts.markProcessed(resolution.receiptId, resolution.resolvedAt);
  if (!statusUpdated) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The lifecycle receipt status could not be advanced atomically.",
    );
  }
  return resolution;
}

function failedResolution(
  persistence: PersistenceRepositories,
  receiptId: string,
  resolvedAt: string,
  failure: ExpectedLifecycleFailure,
): ReceiptLifecycleResolution {
  return insertResolution(persistence, {
    receiptId,
    workspaceId: failure.workspaceId,
    conversationId: failure.conversationId,
    runId: failure.runId,
    outcome: "failed",
    action: "receipt_failed",
    diagnosticCode: failure.diagnosticCode,
    resolvedAt,
  });
}

function resolveWorkspace(
  dependencies: LifecycleProcessorDependencies,
  receipt: PreparedIngressReceiptRecord,
  observedAt: string,
): Workspace {
  const { persistence } = dependencies;
  let workspace = persistence.workspaces.getByCanonicalPath(receipt.canonicalWorkspacePath);
  if (workspace === null) {
    const workspaceId = safeGeneratedId(dependencies.workspaceIdGenerator ?? randomUUID);
    persistence.workspaces.insert({
      workspaceId,
      canonicalPath: receipt.canonicalWorkspacePath,
      repositoryRoot: receipt.canonicalWorkspacePath,
      gitRemote: null,
      initialRepositoryFingerprint: pathFingerprint(receipt.canonicalWorkspacePath),
      identityBasis: "canonical_path_v1",
      createdAt: observedAt,
      lastObservedAt: observedAt,
    });
    workspace = persistence.workspaces.get(workspaceId);
    if (workspace === null) {
      throw new PersistenceError("invalid_persisted_row", "The new Workspace could not be read.");
    }
  } else if (!persistence.workspaces.touch(workspace.workspaceId, observedAt)) {
    throw new PersistenceError("invalid_persisted_row", "The Workspace could not be touched.");
  }
  return workspace;
}

type ConversationResolution = Readonly<{
  conversation: AgentConversation;
  created: boolean;
  reactivated: boolean;
}>;

function resolveConversation(
  dependencies: LifecycleProcessorDependencies,
  receipt: PreparedIngressReceiptRecord,
  workspace: Workspace,
  projection: LifecycleProjection,
  observedAt: string,
): ConversationResolution {
  const { persistence } = dependencies;
  let conversation = persistence.conversations.getBySourceSession(
    receipt.source,
    receipt.sourceSessionId,
  );

  if (conversation !== null && conversation.workspaceId !== workspace.workspaceId) {
    throw new ExpectedLifecycleFailure("conversation_workspace_conflict", {
      workspaceId: workspace.workspaceId,
    });
  }

  if (conversation === null) {
    const conversationId = safeGeneratedId(dependencies.conversationIdGenerator ?? randomUUID);
    persistence.conversations.insert({
      conversationId,
      workspaceId: workspace.workspaceId,
      source: receipt.source,
      sourceSessionId: receipt.sourceSessionId,
      startMode: receipt.sourceEventName === "SessionStart" ? projection.startMode : null,
      startedAt: observedAt,
      lastObservedAt: observedAt,
      endedAt: null,
      status: "Active",
    });
    conversation = persistence.conversations.get(conversationId);
    if (conversation === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The new Agent Conversation could not be read.",
      );
    }
    return { conversation, created: true, reactivated: false };
  }

  if (receipt.sourceEventName === "SessionStart") {
    const reactivated = conversation.status === "Ended";
    if (
      !persistence.conversations.reactivate(
        conversation.conversationId,
        projection.startMode ?? "unknown",
        observedAt,
      )
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Agent Conversation could not be reactivated.",
      );
    }
    const updated = persistence.conversations.get(conversation.conversationId);
    if (updated === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The reactivated Agent Conversation could not be read.",
      );
    }
    return { conversation: updated, created: false, reactivated };
  }

  if (conversation.status === "Ended" && receipt.sourceEventName !== "SessionEnd") {
    throw new ExpectedLifecycleFailure("conversation_ended", {
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
    });
  }

  if (!persistence.conversations.touch(conversation.conversationId, observedAt)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Agent Conversation could not be touched.",
    );
  }
  const updated = persistence.conversations.get(conversation.conversationId);
  if (updated === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Agent Conversation disappeared after touch.",
    );
  }
  return { conversation: updated, created: false, reactivated: false };
}

function appliedResolution(
  input: Readonly<{
    receiptId: string;
    workspaceId: string;
    conversationId: string;
    runId?: string | null;
    outcome: LifecycleResolutionOutcome;
    action: LifecycleResolutionAction;
    resolvedAt: string;
  }>,
): ReceiptLifecycleResolution {
  return {
    receiptId: input.receiptId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    runId: input.runId ?? null,
    outcome: input.outcome,
    action: input.action,
    diagnosticCode: null,
    resolvedAt: input.resolvedAt,
  };
}

function resolveRunAction(
  dependencies: LifecycleProcessorDependencies,
  receipt: PreparedIngressReceiptRecord,
  workspace: Workspace,
  conversationResolution: ConversationResolution,
  projection: LifecycleProjection,
  observedAt: string,
  resolvedAt: string,
): ReceiptLifecycleResolution {
  const { persistence } = dependencies;
  const conversation = conversationResolution.conversation;

  switch (receipt.sourceEventName) {
    case "SessionStart":
      return appliedResolution({
        receiptId: receipt.receiptId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        outcome:
          conversationResolution.created || conversationResolution.reactivated
            ? "applied"
            : "associated",
        action: conversationResolution.created ? "conversation_started" : "conversation_resumed",
        resolvedAt,
      });

    case "UserPromptSubmit": {
      persistence.taskRuns.abandonCapturing(
        conversation.conversationId,
        observedAt,
        "superseded_by_prompt",
      );
      const runId = safeGeneratedId(dependencies.runIdGenerator ?? randomUUID);
      const runNumber = persistence.taskRuns.nextRunNumber(conversation.conversationId);
      persistence.taskRuns.insert({
        runId,
        conversationId: conversation.conversationId,
        runNumber,
        redactedPrompt: projection.prompt ?? "",
        baselineGitCommit: null,
        baselineWorkingTreeFingerprint: null,
        startedAt: observedAt,
        endedAt: null,
        status: "Capturing",
        finalGitFingerprint: null,
        sourceStopReason: null,
        evidenceGapCount: 0,
      });
      return appliedResolution({
        receiptId: receipt.receiptId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        runId,
        outcome: "applied",
        action: "run_started",
        resolvedAt,
      });
    }

    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch": {
      const activeRun = persistence.taskRuns.getLatestActive(conversation.conversationId);
      if (activeRun === null) {
        throw new ExpectedLifecycleFailure("no_active_run", {
          workspaceId: workspace.workspaceId,
          conversationId: conversation.conversationId,
        });
      }
      return appliedResolution({
        receiptId: receipt.receiptId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        runId: activeRun.runId,
        outcome: "associated",
        action: "run_associated",
        resolvedAt,
      });
    }

    case "Stop":
    case "StopFailure": {
      const activeRun = persistence.taskRuns.getLatestActive(conversation.conversationId);
      if (activeRun === null) {
        throw new ExpectedLifecycleFailure("no_active_run", {
          workspaceId: workspace.workspaceId,
          conversationId: conversation.conversationId,
        });
      }
      const wasCapturing = activeRun.status === "Capturing";
      const reason =
        receipt.sourceEventName === "StopFailure" ? (projection.stopReason ?? "unknown") : "stop";
      if (!persistence.taskRuns.transitionToFinalizing(activeRun.runId, reason)) {
        throw new ExpectedLifecycleFailure("invalid_transition", {
          workspaceId: workspace.workspaceId,
          conversationId: conversation.conversationId,
          runId: activeRun.runId,
        });
      }
      return appliedResolution({
        receiptId: receipt.receiptId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        runId: activeRun.runId,
        outcome: wasCapturing ? "applied" : "associated",
        action: "run_finalizing",
        resolvedAt,
      });
    }

    case "SessionEnd": {
      const alreadyEnded = conversation.status === "Ended";
      if (!alreadyEnded) {
        persistence.taskRuns.abandonCapturing(
          conversation.conversationId,
          observedAt,
          "conversation_ended",
        );
        if (!persistence.conversations.end(conversation.conversationId, observedAt)) {
          throw new PersistenceError(
            "invalid_persisted_row",
            "The Agent Conversation could not be ended.",
          );
        }
      }
      return appliedResolution({
        receiptId: receipt.receiptId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        outcome: alreadyEnded ? "associated" : "applied",
        action: "conversation_ended",
        resolvedAt,
      });
    }

    default:
      throw new ExpectedLifecycleFailure("invalid_transition", {
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
      });
  }
}

function processInsideTransaction(
  dependencies: LifecycleProcessorDependencies,
  receiptId: string,
  resolvedAt: string,
): ReceiptLifecycleResolution | null {
  const { persistence } = dependencies;
  const existingResolution = persistence.lifecycleResolutions.get(receiptId);
  if (existingResolution !== null) {
    return existingResolution;
  }

  const receipt = persistence.ingressReceipts.get(receiptId);
  if (receipt === null) {
    return null;
  }
  if (receipt.processingStatus !== "pending") {
    throw new PersistenceError(
      "invalid_persisted_row",
      "An unresolved lifecycle receipt is not pending.",
    );
  }
  if (receipt.preparationStatus !== "prepared") {
    return failedResolution(
      persistence,
      receiptId,
      resolvedAt,
      new ExpectedLifecycleFailure("legacy_receipt_unsupported"),
    );
  }

  try {
    const observedAt = canonicalTimestamp(receipt.receivedAt);
    const projection = projectLifecyclePayload(receipt);
    const workspace = resolveWorkspace(dependencies, receipt, observedAt);
    const conversationResolution = resolveConversation(
      dependencies,
      receipt,
      workspace,
      projection,
      observedAt,
    );
    const resolution = resolveRunAction(
      dependencies,
      receipt,
      workspace,
      conversationResolution,
      projection,
      observedAt,
      resolvedAt,
    );
    return insertResolution(persistence, resolution);
  } catch (error) {
    if (error instanceof ExpectedLifecycleFailure) {
      return failedResolution(persistence, receiptId, resolvedAt, error);
    }
    throw error;
  }
}

function markUnexpectedFailure(
  dependencies: LifecycleProcessorDependencies,
  receiptId: string,
  resolvedAt: string,
): ReceiptLifecycleResolution | null {
  return dependencies.persistence.withTransaction((persistence) => {
    const existing = persistence.lifecycleResolutions.get(receiptId);
    if (existing !== null) {
      return existing;
    }
    const receipt = persistence.ingressReceipts.get(receiptId);
    if (receipt === null) {
      return null;
    }
    if (receipt.processingStatus !== "pending") {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A non-pending receipt is missing its lifecycle resolution.",
      );
    }
    return failedResolution(
      persistence,
      receiptId,
      resolvedAt,
      new ExpectedLifecycleFailure("lifecycle_processing_failed"),
    );
  });
}

export function processLifecycleReceipt(
  dependencies: LifecycleProcessorDependencies,
  receiptId: string,
): LifecycleProcessingResult | null {
  const resolvedAt = canonicalTimestamp((dependencies.clock ?? (() => new Date()))());
  try {
    return dependencies.persistence.withTransaction(() =>
      processInsideTransaction(dependencies, receiptId, resolvedAt),
    );
  } catch {
    try {
      return markUnexpectedFailure(dependencies, receiptId, resolvedAt);
    } catch {
      throw new PersistenceError("operation_failed", "Lifecycle receipt processing failed safely.");
    }
  }
}

export function processPendingLifecycleReceipts(
  dependencies: LifecycleProcessorDependencies,
  limit = 100,
): LifecycleProcessingResult[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PENDING_BATCH) {
    return [];
  }
  const receiptIds = dependencies.persistence.ingressReceipts.listPendingReceiptIds(limit);
  const results: LifecycleProcessingResult[] = [];
  for (const receiptId of receiptIds) {
    const resolution = processLifecycleReceipt(dependencies, receiptId);
    if (resolution !== null) {
      results.push(resolution);
    }
  }
  return results;
}
