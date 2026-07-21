import { randomUUID } from "node:crypto";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  NormalizedEventEnvelopeSchema,
  type JsonObject,
} from "@ownloop/event-model";

import {
  type GitBaseline,
  type GitBaselineDiagnosticCode,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import {
  DEFAULT_LATE_CAPTURE_THRESHOLD_MS,
  GIT_BASELINE_COLLECTOR_VERSION,
  GIT_BASELINE_EVENT_DEDUPLICATION_VERSION,
  MAX_GIT_BASELINE_BATCH,
} from "./constants.js";
import {
  DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS,
  type GitBaselineObservationLimits,
  observeGitBaseline,
} from "./observation.js";
import type { GitCommandRunner } from "./git-runner.js";
import type { UntrackedScanHooks } from "./untracked.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type GitBaselineCaptureDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  clock?: () => Date;
  executable?: string;
  runner?: GitCommandRunner;
  limits?: GitBaselineObservationLimits;
  lateCaptureThresholdMs?: number;
  baselineIdGenerator?: () => string;
  eventIdGenerator?: () => string;
  evidenceGapIdGenerator?: () => string;
  scanHooks?: UntrackedScanHooks;
}>;

export type GitBaselineCaptureResult = Readonly<{
  baselineId: string;
  runId: string;
  outcome: "captured" | "partial";
  diagnosticCode: GitBaselineDiagnosticCode | null;
  eventId: string;
  headPresent: boolean;
  stagedDirty: boolean;
  unstagedDirty: boolean;
  untrackedCount: number;
  untrackedHashedCount: number;
  untrackedOmittedCount: number;
  capturedAt: string;
  captureDelayMs: number;
}>;

function safeGeneratedId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PersistenceError(
      "operation_failed",
      "A Git baseline identifier generator returned an unsafe identifier.",
    );
  }
  return value;
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError(
      "operation_failed",
      "Git baseline capture received an invalid time.",
    );
  }
  return value.toISOString();
}

function safeResult(baseline: GitBaseline): GitBaselineCaptureResult {
  return {
    baselineId: baseline.baselineId,
    runId: baseline.runId,
    outcome: baseline.outcome,
    diagnosticCode: baseline.diagnosticCode,
    eventId: baseline.baselineEventId,
    headPresent: baseline.headCommit !== null,
    stagedDirty: baseline.stagedDirty,
    unstagedDirty: baseline.unstagedDirty,
    untrackedCount: baseline.untrackedCount,
    untrackedHashedCount: baseline.untrackedHashedCount,
    untrackedOmittedCount: baseline.untrackedOmittedCount,
    capturedAt: baseline.capturedAt,
    captureDelayMs: baseline.captureDelayMs,
  };
}

function evidenceMessage(code: GitBaselineDiagnosticCode): string {
  switch (code) {
    case "late_capture":
      return "Git baseline capture occurred after the immediate Run boundary.";
    case "not_a_git_repository":
      return "The Task Run workspace was not a Git repository during baseline capture.";
    case "repository_changed_during_capture":
      return "The Git repository changed while the baseline was being captured.";
    default:
      return "Git baseline capture was partial and requires cautious downstream interpretation.";
  }
}

function baselineEventPayload(
  input: Readonly<{
    baselineId: string;
    outcome: "captured" | "partial";
    diagnosticCode: GitBaselineDiagnosticCode | null;
    headPresent: boolean;
    stagedDirty: boolean;
    unstagedDirty: boolean;
    untrackedCount: number;
    untrackedHashedCount: number;
    untrackedOmittedCount: number;
    captureDelayMs: number;
  }>,
): JsonObject {
  return {
    baselineId: input.baselineId,
    outcome: input.outcome,
    diagnosticCode: input.diagnosticCode,
    headPresent: input.headPresent,
    stagedDirty: input.stagedDirty,
    unstagedDirty: input.unstagedDirty,
    untrackedCount: input.untrackedCount,
    untrackedHashedCount: input.untrackedHashedCount,
    untrackedOmittedCount: input.untrackedOmittedCount,
    captureDelayMs: input.captureDelayMs,
  };
}

function reliableForRunFields(diagnosticCode: GitBaselineDiagnosticCode | null): boolean {
  return diagnosticCode === null || diagnosticCode === "late_capture";
}

function persistBaseline(
  dependencies: GitBaselineCaptureDependencies,
  input: Readonly<{
    runId: string;
    capturedAt: string;
    captureDelayMs: number;
    observation: Awaited<ReturnType<typeof observeGitBaseline>>;
    diagnosticCode: GitBaselineDiagnosticCode | null;
  }>,
): GitBaselineCaptureResult | null {
  const { persistence } = dependencies;
  return persistence.withTransaction((repositories) => {
    const existing = repositories.gitBaselines.getByRun(input.runId);
    if (existing !== null) {
      return safeResult(existing);
    }
    const run = repositories.taskRuns.get(input.runId);
    if (run === null) {
      return null;
    }
    const conversation = repositories.conversations.get(run.conversationId);
    if (conversation === null) {
      throw new PersistenceError("invalid_persisted_row", "The baseline Run has no Conversation.");
    }
    const workspace = repositories.workspaces.get(conversation.workspaceId);
    if (workspace === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The baseline Conversation has no Workspace.",
      );
    }

    const baselineId = safeGeneratedId(dependencies.baselineIdGenerator ?? randomUUID);
    const eventId = safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID);
    const outcome = input.diagnosticCode === null ? "captured" : "partial";
    const sequence = repositories.events.nextSequence(run.runId);
    const event = NormalizedEventEnvelopeSchema.parse({
      eventId,
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      runId: run.runId,
      sequence,
      type: "snapshot.baseline_captured",
      source: "ownloop",
      sourceEventName: null,
      sourceEventId: null,
      occurredAt: run.startedAt,
      ingestedAt: input.capturedAt,
      sensitivity: "normal",
      payload: baselineEventPayload({
        baselineId,
        outcome,
        diagnosticCode: input.diagnosticCode,
        headPresent: input.observation.headCommit !== null,
        stagedDirty: input.observation.stagedDirty,
        unstagedDirty: input.observation.unstagedDirty,
        untrackedCount: input.observation.untrackedCount,
        untrackedHashedCount: input.observation.untrackedHashedCount,
        untrackedOmittedCount: input.observation.untrackedOmittedCount,
        captureDelayMs: input.captureDelayMs,
      }),
      metadata: {
        collectorVersion: GIT_BASELINE_COLLECTOR_VERSION,
        sourceVersion: null,
      },
    });
    repositories.events.append(event);
    repositories.events.recordDeduplicationKey({
      source: "ownloop",
      sourceSessionId: conversation.conversationId,
      deduplicationKey: `${GIT_BASELINE_EVENT_DEDUPLICATION_VERSION}:${run.runId}`,
      eventId,
      createdAt: input.capturedAt,
    });

    repositories.gitBaselines.insert({
      baselineId,
      runId: run.runId,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      baselineEventId: eventId,
      outcome,
      diagnosticCode: input.diagnosticCode,
      repositoryRoot: input.observation.repositoryRoot,
      headCommit: input.observation.headResolved ? input.observation.headCommit : null,
      stagedDiffSha256: input.observation.stagedDiffSha256,
      unstagedDiffSha256: input.observation.unstagedDiffSha256,
      statusBeforeSha256: input.observation.statusBeforeSha256,
      statusAfterSha256: input.observation.statusAfterSha256,
      workingTreeFingerprint: input.observation.workingTreeFingerprint,
      stagedDirty: input.observation.stagedDirty,
      unstagedDirty: input.observation.unstagedDirty,
      untrackedCount: input.observation.untrackedCount,
      untrackedHashedCount: input.observation.untrackedHashedCount,
      untrackedOmittedCount: input.observation.untrackedOmittedCount,
      capturedAt: input.capturedAt,
      captureDelayMs: input.captureDelayMs,
    });
    input.observation.entries.forEach((entry, entryIndex) => {
      repositories.gitBaselines.insertEntry({ baselineId, entryIndex, ...entry });
    });

    if (input.observation.repositoryDiscovered) {
      if (
        !repositories.workspaces.upgradeGitIdentity(
          workspace.workspaceId,
          input.observation.repositoryRoot,
          reliableForRunFields(input.diagnosticCode)
            ? input.observation.workingTreeFingerprint
            : null,
        )
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The Workspace Git identity was not updated.",
        );
      }
    }
    if (
      input.observation.workingTreeFingerprint !== null &&
      reliableForRunFields(input.diagnosticCode)
    ) {
      if (
        !repositories.taskRuns.applyBaseline(
          run.runId,
          input.observation.headResolved ? input.observation.headCommit : null,
          input.observation.workingTreeFingerprint,
        )
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The Task Run baseline fields were not updated.",
        );
      }
    }
    if (input.diagnosticCode !== null) {
      const gapId = safeGeneratedId(dependencies.evidenceGapIdGenerator ?? randomUUID);
      repositories.runSupport.insertEvidenceGap({
        gapId,
        runId: run.runId,
        code: `git_baseline_${input.diagnosticCode}`,
        message: evidenceMessage(input.diagnosticCode),
        detailsJson: null,
        createdAt: input.capturedAt,
      });
      if (!repositories.taskRuns.incrementEvidenceGapCount(run.runId)) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The Task Run evidence count was not updated.",
        );
      }
    }

    const persisted = repositories.gitBaselines.getByRun(run.runId);
    if (persisted === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git baseline could not be read after insertion.",
      );
    }
    return safeResult(persisted);
  });
}

export async function captureGitBaseline(
  dependencies: GitBaselineCaptureDependencies,
  runId: string,
): Promise<GitBaselineCaptureResult | null> {
  const existing = dependencies.persistence.gitBaselines.getByRun(runId);
  if (existing !== null) {
    return safeResult(existing);
  }
  const run = dependencies.persistence.taskRuns.get(runId);
  if (run === null) {
    return null;
  }
  const conversation = dependencies.persistence.conversations.get(run.conversationId);
  if (conversation === null) {
    throw new PersistenceError("invalid_persisted_row", "The baseline Run has no Conversation.");
  }
  const workspace = dependencies.persistence.workspaces.get(conversation.workspaceId);
  if (workspace === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The baseline Conversation has no Workspace.",
    );
  }

  const observation = await observeGitBaseline({
    workspacePath: workspace.canonicalPath,
    limits: dependencies.limits ?? DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS,
    ...(dependencies.executable === undefined ? {} : { executable: dependencies.executable }),
    ...(dependencies.runner === undefined ? {} : { runner: dependencies.runner }),
    ...(dependencies.scanHooks === undefined ? {} : { scanHooks: dependencies.scanHooks }),
  });
  const capturedAt = canonicalTimestamp((dependencies.clock ?? (() => new Date()))());
  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new PersistenceError("invalid_persisted_row", "The Task Run has an invalid start time.");
  }
  const captureDelayMs = Math.max(0, Date.parse(capturedAt) - startedAtMs);
  const lateThreshold = dependencies.lateCaptureThresholdMs ?? DEFAULT_LATE_CAPTURE_THRESHOLD_MS;
  const diagnosticCode =
    observation.diagnosticCode ?? (captureDelayMs > lateThreshold ? "late_capture" : null);

  return persistBaseline(dependencies, {
    runId,
    capturedAt,
    captureDelayMs,
    observation,
    diagnosticCode,
  });
}

export async function captureMissingGitBaselines(
  dependencies: GitBaselineCaptureDependencies,
  limit = MAX_GIT_BASELINE_BATCH,
): Promise<GitBaselineCaptureResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GIT_BASELINE_BATCH) {
    return [];
  }
  const runIds = dependencies.persistence.gitBaselines.listRunIdsMissingBaseline(limit);
  const results: GitBaselineCaptureResult[] = [];
  for (const runId of runIds) {
    const result = await captureGitBaseline(dependencies, runId);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
