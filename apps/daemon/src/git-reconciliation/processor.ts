import { randomUUID } from "node:crypto";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  NormalizedEventEnvelopeSchema,
  type JsonObject,
  type NormalizedEventEnvelope,
} from "@ownloop/event-model";

import type { GitCommandRunner } from "../git-baseline/index.js";
import {
  type GitBaseline,
  type GitBaselineComparison,
  type GitReconciliation,
  type GitReconciliationAttribution,
  type GitReconciliationBoundary,
  type GitReconciliationDiagnosticCode,
  type GitReconciliationEntry,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import {
  GIT_RECONCILIATION_COLLECTOR_VERSION,
  GIT_RECONCILIATION_EVENT_DEDUPLICATION_VERSION,
  MAX_GIT_RECONCILIATION_BATCH,
} from "./constants.js";
import {
  DEFAULT_GIT_RECONCILIATION_OBSERVATION_LIMITS,
  observeGitReconciliation,
  type GitReconciliationObservation,
  type GitReconciliationObservationLimits,
} from "./observation.js";
import type { ParsedGitStatusEntry } from "./status-parser.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

const ELIGIBLE_BOUNDARIES = Object.freeze({
  "tool.batch_completed": "tool_batch",
  "run.stop_observed": "stop",
  "run.stop_failed": "stop_failure",
} satisfies Readonly<Record<string, GitReconciliationBoundary>>);

export type GitReconciliationDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  clock?: () => Date;
  executable?: string;
  runner?: GitCommandRunner;
  limits?: GitReconciliationObservationLimits;
  reconciliationIdGenerator?: () => string;
  eventIdGenerator?: () => string;
  evidenceGapIdGenerator?: () => string;
}>;

export type GitReconciliationResult = Readonly<{
  reconciliationId: string;
  runId: string;
  triggerEventId: string;
  outcome: "captured" | "partial";
  diagnosticCode: GitReconciliationDiagnosticCode | null;
  attribution: GitReconciliationAttribution;
  baselineComparison: GitBaselineComparison;
  summaryEventId: string;
  fileEventIds: readonly string[];
  entryCount: number;
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  typeChangedCount: number;
  unmergedCount: number;
  capturedAt: string;
}>;

function safeGeneratedId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PersistenceError(
      "operation_failed",
      "A Git reconciliation identifier generator returned an unsafe identifier.",
    );
  }
  return value;
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError("operation_failed", "Git reconciliation received an invalid time.");
  }
  return value.toISOString();
}

function safeResult(reconciliation: GitReconciliation): GitReconciliationResult {
  return {
    reconciliationId: reconciliation.reconciliationId,
    runId: reconciliation.runId,
    triggerEventId: reconciliation.triggerEventId,
    outcome: reconciliation.outcome,
    diagnosticCode: reconciliation.diagnosticCode,
    attribution: reconciliation.attribution,
    baselineComparison: reconciliation.baselineComparison,
    summaryEventId: reconciliation.summaryEventId,
    fileEventIds: reconciliation.entries.map((entry) => entry.fileEventId),
    entryCount: reconciliation.entryCount,
    createdCount: reconciliation.createdCount,
    modifiedCount: reconciliation.modifiedCount,
    deletedCount: reconciliation.deletedCount,
    typeChangedCount: reconciliation.typeChangedCount,
    unmergedCount: reconciliation.unmergedCount,
    capturedAt: reconciliation.capturedAt,
  };
}

function boundaryForEvent(event: NormalizedEventEnvelope): GitReconciliationBoundary | null {
  if (event.runId === null || event.sequence === null) {
    return null;
  }
  return ELIGIBLE_BOUNDARIES[event.type as keyof typeof ELIGIBLE_BOUNDARIES] ?? null;
}

function countEntries(entries: readonly ParsedGitStatusEntry[]) {
  return {
    entryCount: entries.length,
    createdCount: entries.filter((entry) => entry.changeKind === "created").length,
    modifiedCount: entries.filter((entry) => entry.changeKind === "modified").length,
    deletedCount: entries.filter((entry) => entry.changeKind === "deleted").length,
    typeChangedCount: entries.filter((entry) => entry.changeKind === "type_changed").length,
    unmergedCount: entries.filter((entry) => entry.changeKind === "unmerged").length,
  };
}

function evidenceMessage(code: GitReconciliationDiagnosticCode): string {
  switch (code) {
    case "baseline_missing":
      return "Repository reconciliation lacked a durable Run baseline.";
    case "baseline_partial":
      return "Repository reconciliation used an incomplete Run baseline.";
    case "repository_changed_during_capture":
      return "The Git repository changed while reconciliation evidence was captured.";
    case "invalid_status_output":
      return "Repository reconciliation could not safely parse the current Git status.";
    case "status_entry_limit_exceeded":
      return "Repository reconciliation exceeded the bounded changed-path inventory.";
    default:
      return "Repository reconciliation was partial and attribution is unavailable.";
  }
}

function evaluateEvidence(
  baseline: GitBaseline | null,
  observation: GitReconciliationObservation,
): Readonly<{
  diagnosticCode: GitReconciliationDiagnosticCode | null;
  attribution: GitReconciliationAttribution;
  baselineComparison: GitBaselineComparison;
}> {
  if (baseline === null) {
    return {
      diagnosticCode: "baseline_missing",
      attribution: "unavailable",
      baselineComparison: "unavailable",
    };
  }
  if (baseline.outcome === "partial") {
    return {
      diagnosticCode: "baseline_partial",
      attribution: "unavailable",
      baselineComparison: "unavailable",
    };
  }
  if (observation.diagnosticCode !== null) {
    return {
      diagnosticCode: observation.diagnosticCode,
      attribution: "unavailable",
      baselineComparison: "unavailable",
    };
  }
  if (
    baseline.workingTreeFingerprint === null ||
    observation.workingTreeFingerprint === null ||
    !observation.headResolved
  ) {
    return {
      diagnosticCode: "reconciliation_processing_failed",
      attribution: "unavailable",
      baselineComparison: "unavailable",
    };
  }
  return {
    diagnosticCode: null,
    attribution:
      !baseline.stagedDirty && !baseline.unstagedDirty && baseline.untrackedCount === 0
        ? "run_relative"
        : "observed_only",
    baselineComparison:
      baseline.workingTreeFingerprint === observation.workingTreeFingerprint
        ? "unchanged"
        : "changed",
  };
}

function headChanged(
  baseline: GitBaseline | null,
  observation: GitReconciliationObservation,
  diagnosticCode: GitReconciliationDiagnosticCode | null,
): boolean | null {
  if (baseline === null || baseline.outcome !== "captured" || diagnosticCode !== null) {
    return null;
  }
  return baseline.headCommit !== observation.headCommit;
}

function summaryPayload(
  input: Readonly<{
    reconciliationId: string;
    boundary: GitReconciliationBoundary;
    outcome: "captured" | "partial";
    diagnosticCode: GitReconciliationDiagnosticCode | null;
    attribution: GitReconciliationAttribution;
    baselineComparison: GitBaselineComparison;
    headChanged: boolean | null;
    stagedDirty: boolean;
    unstagedDirty: boolean;
    counts: ReturnType<typeof countEntries>;
  }>,
): JsonObject {
  return {
    reconciliationId: input.reconciliationId,
    boundary: input.boundary,
    outcome: input.outcome,
    diagnosticCode: input.diagnosticCode,
    attribution: input.attribution,
    baselineComparison: input.baselineComparison,
    headChanged: input.headChanged,
    stagedDirty: input.stagedDirty,
    unstagedDirty: input.unstagedDirty,
    ...input.counts,
  };
}

function filePayload(
  reconciliationId: string,
  entry: ParsedGitStatusEntry,
  attribution: GitReconciliationAttribution,
): JsonObject {
  return {
    reconciliationId,
    pathIdentitySha256: entry.pathIdentitySha256,
    relativePath: entry.relativePath,
    changeKind: entry.changeKind,
    staged: entry.staged,
    unstaged: entry.unstaged,
    attribution,
  };
}

function makeEvent(
  input: Readonly<{
    eventId: string;
    workspaceId: string;
    conversationId: string;
    runId: string;
    sequence: number;
    type: "git.diff_computed" | "file.change_observed";
    occurredAt: string;
    ingestedAt: string;
    sensitivity: "normal" | "secret";
    payload: JsonObject;
  }>,
): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    runId: input.runId,
    sequence: input.sequence,
    type: input.type,
    source: "ownloop",
    sourceEventName: null,
    sourceEventId: null,
    occurredAt: input.occurredAt,
    ingestedAt: input.ingestedAt,
    sensitivity: input.sensitivity,
    payload: input.payload,
    metadata: {
      collectorVersion: GIT_RECONCILIATION_COLLECTOR_VERSION,
      sourceVersion: null,
    },
  });
}

function partialObservation(repositoryRoot: string): GitReconciliationObservation {
  return {
    repositoryRoot,
    repositoryDiscovered: false,
    headCommit: null,
    headResolved: false,
    stagedDiffSha256: null,
    unstagedDiffSha256: null,
    statusBeforeSha256: null,
    statusAfterSha256: null,
    workingTreeFingerprint: null,
    stagedDirty: false,
    unstagedDirty: false,
    entries: [],
    diagnosticCode: "reconciliation_processing_failed",
  };
}

function persistReconciliation(
  dependencies: GitReconciliationDependencies,
  input: Readonly<{
    triggerEventId: string;
    boundary: GitReconciliationBoundary;
    capturedAt: string;
    baseline: GitBaseline | null;
    observation: GitReconciliationObservation;
  }>,
): GitReconciliationResult | null {
  return dependencies.persistence.withTransaction((repositories) => {
    const existing = repositories.gitReconciliations.getByTriggerEvent(input.triggerEventId);
    if (existing !== null) {
      return safeResult(existing);
    }
    const trigger = repositories.events.get(input.triggerEventId);
    if (
      trigger === null ||
      boundaryForEvent(trigger) !== input.boundary ||
      trigger.runId === null
    ) {
      return null;
    }
    const run = repositories.taskRuns.get(trigger.runId);
    if (run === null || run.conversationId !== trigger.conversationId) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git reconciliation trigger has invalid Run ownership.",
      );
    }
    const conversation = repositories.conversations.get(run.conversationId);
    if (conversation === null || conversation.workspaceId !== trigger.workspaceId) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git reconciliation trigger has invalid Conversation ownership.",
      );
    }
    const workspace = repositories.workspaces.get(conversation.workspaceId);
    if (workspace === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git reconciliation trigger has no Workspace.",
      );
    }
    const currentBaseline = repositories.gitBaselines.getByRun(run.runId);
    if (currentBaseline?.baselineId !== input.baseline?.baselineId) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git reconciliation baseline changed before persistence.",
      );
    }

    const evidence = evaluateEvidence(input.baseline, input.observation);
    const outcome = evidence.diagnosticCode === null ? "captured" : "partial";
    const entries =
      evidence.baselineComparison === "unchanged" ? [] : [...input.observation.entries];
    const counts = countEntries(entries);
    const reconciliationId = safeGeneratedId(dependencies.reconciliationIdGenerator ?? randomUUID);
    const summaryEventId = safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID);
    const firstSequence = repositories.events.nextSequence(run.runId);
    const summaryEvent = makeEvent({
      eventId: summaryEventId,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      runId: run.runId,
      sequence: firstSequence,
      type: "git.diff_computed",
      occurredAt: input.capturedAt,
      ingestedAt: input.capturedAt,
      sensitivity: "normal",
      payload: summaryPayload({
        reconciliationId,
        boundary: input.boundary,
        outcome,
        diagnosticCode: evidence.diagnosticCode,
        attribution: evidence.attribution,
        baselineComparison: evidence.baselineComparison,
        headChanged: headChanged(input.baseline, input.observation, evidence.diagnosticCode),
        stagedDirty: input.observation.stagedDirty,
        unstagedDirty: input.observation.unstagedDirty,
        counts,
      }),
    });
    repositories.events.append(summaryEvent);
    repositories.events.recordDeduplicationKey({
      source: "ownloop",
      sourceSessionId: conversation.conversationId,
      deduplicationKey: `${GIT_RECONCILIATION_EVENT_DEDUPLICATION_VERSION}:${trigger.eventId}:summary`,
      eventId: summaryEventId,
      createdAt: input.capturedAt,
    });

    const persistedEntries: GitReconciliationEntry[] = [];
    entries.forEach((entry, entryIndex) => {
      const fileEventId = safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID);
      const fileEvent = makeEvent({
        eventId: fileEventId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        runId: run.runId,
        sequence: firstSequence + entryIndex + 1,
        type: "file.change_observed",
        occurredAt: input.capturedAt,
        ingestedAt: input.capturedAt,
        sensitivity: entry.sensitivity,
        payload: filePayload(reconciliationId, entry, evidence.attribution),
      });
      repositories.events.append(fileEvent);
      repositories.events.recordDeduplicationKey({
        source: "ownloop",
        sourceSessionId: conversation.conversationId,
        deduplicationKey: `${GIT_RECONCILIATION_EVENT_DEDUPLICATION_VERSION}:${trigger.eventId}:entry:${entryIndex}`,
        eventId: fileEventId,
        createdAt: input.capturedAt,
      });
      persistedEntries.push({
        reconciliationId,
        entryIndex,
        fileEventId,
        ...entry,
        attribution: evidence.attribution,
      });
    });

    repositories.gitReconciliations.insert({
      reconciliationId,
      runId: run.runId,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      baselineId: input.baseline?.baselineId ?? null,
      triggerEventId: trigger.eventId,
      summaryEventId,
      boundary: input.boundary,
      outcome,
      diagnosticCode: evidence.diagnosticCode,
      attribution: evidence.attribution,
      baselineComparison: evidence.baselineComparison,
      repositoryRoot: input.observation.repositoryRoot,
      headCommit: input.observation.headResolved ? input.observation.headCommit : null,
      stagedDiffSha256: input.observation.stagedDiffSha256,
      unstagedDiffSha256: input.observation.unstagedDiffSha256,
      statusBeforeSha256: input.observation.statusBeforeSha256,
      statusAfterSha256: input.observation.statusAfterSha256,
      workingTreeFingerprint: input.observation.workingTreeFingerprint,
      stagedDirty: input.observation.stagedDirty,
      unstagedDirty: input.observation.unstagedDirty,
      ...counts,
      capturedAt: input.capturedAt,
    });
    for (const entry of persistedEntries) {
      repositories.gitReconciliations.insertEntry(entry);
    }

    if (evidence.diagnosticCode !== null) {
      const gapId = safeGeneratedId(dependencies.evidenceGapIdGenerator ?? randomUUID);
      repositories.runSupport.insertEvidenceGap({
        gapId,
        runId: run.runId,
        code: `git_reconciliation_${evidence.diagnosticCode}`,
        message: evidenceMessage(evidence.diagnosticCode),
        detailsJson: null,
        createdAt: input.capturedAt,
      });
      if (!repositories.taskRuns.incrementEvidenceGapCount(run.runId)) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The Git reconciliation evidence count was not updated.",
        );
      }
    }

    const persisted = repositories.gitReconciliations.getByTriggerEvent(trigger.eventId);
    if (persisted === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Git reconciliation could not be read after insertion.",
      );
    }
    return safeResult(persisted);
  });
}

export async function reconcileGitAtTrigger(
  dependencies: GitReconciliationDependencies,
  triggerEventId: string,
): Promise<GitReconciliationResult | null> {
  const existing = dependencies.persistence.gitReconciliations.getByTriggerEvent(triggerEventId);
  if (existing !== null) {
    return safeResult(existing);
  }
  const trigger = dependencies.persistence.events.get(triggerEventId);
  if (trigger === null) {
    return null;
  }
  const boundary = boundaryForEvent(trigger);
  if (boundary === null || trigger.runId === null) {
    return null;
  }
  const run = dependencies.persistence.taskRuns.get(trigger.runId);
  if (run === null || run.conversationId !== trigger.conversationId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Git reconciliation trigger has invalid aggregate ownership.",
    );
  }
  const conversation = dependencies.persistence.conversations.get(run.conversationId);
  if (conversation === null || conversation.workspaceId !== trigger.workspaceId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Git reconciliation trigger has invalid aggregate ownership.",
    );
  }
  const workspace = dependencies.persistence.workspaces.get(conversation.workspaceId);
  if (workspace === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Git reconciliation trigger has no Workspace.",
    );
  }
  const baseline = dependencies.persistence.gitBaselines.getByRun(run.runId);
  const workspacePath = baseline?.repositoryRoot ?? workspace.repositoryRoot;
  let observation: GitReconciliationObservation;
  try {
    observation = await observeGitReconciliation({
      workspacePath,
      executable: dependencies.executable ?? "git",
      limits: dependencies.limits ?? DEFAULT_GIT_RECONCILIATION_OBSERVATION_LIMITS,
      ...(dependencies.runner === undefined ? {} : { runner: dependencies.runner }),
    });
  } catch {
    observation = partialObservation(workspacePath);
  }
  const capturedAt = canonicalTimestamp((dependencies.clock ?? (() => new Date()))());
  return persistReconciliation(dependencies, {
    triggerEventId,
    boundary,
    capturedAt,
    baseline,
    observation,
  });
}

export async function getGitReconciliation(
  persistence: OwnLoopPersistence,
  reconciliationId: string,
): Promise<GitReconciliationResult | null> {
  const reconciliation = persistence.gitReconciliations.get(reconciliationId);
  return reconciliation === null ? null : safeResult(reconciliation);
}

export async function listEligibleUnreconciledGitTriggerIds(
  persistence: OwnLoopPersistence,
  limit = MAX_GIT_RECONCILIATION_BATCH,
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GIT_RECONCILIATION_BATCH) {
    return [];
  }
  return persistence.gitReconciliations.listEligibleUnreconciledTriggerEventIds(limit);
}

export async function reconcileEligibleGitTriggers(
  dependencies: GitReconciliationDependencies,
  limit = MAX_GIT_RECONCILIATION_BATCH,
): Promise<GitReconciliationResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GIT_RECONCILIATION_BATCH) {
    return [];
  }
  const triggerEventIds =
    dependencies.persistence.gitReconciliations.listEligibleUnreconciledTriggerEventIds(limit);
  const results: GitReconciliationResult[] = [];
  for (const triggerEventId of triggerEventIds) {
    const result = await reconcileGitAtTrigger(dependencies, triggerEventId);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
