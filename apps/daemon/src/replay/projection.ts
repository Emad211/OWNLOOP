import {
  type DeterministicEvidenceGraphV1,
  RAW_REPLAY_SCHEMA_VERSION,
  type RawRunReplayV1,
  REPLAY_PROMPT_PREVIEW_CODE_POINTS,
  type ReplayArtifactReferenceV1,
  type ReplayCausalLinkV1,
  type ReplayCompleteness,
  type ReplayRunListResponseV1,
  type ReplayRunSummaryV1,
  type ReplayTimelineEventV1,
  type ReplayVerificationV1,
} from "@ownloop/contracts";
import type { JsonObject, JsonValue, NormalizedEventEnvelope } from "@ownloop/event-model";

import type {
  GitReconciliation,
  OwnLoopPersistence,
  ReplayTaskRunCursor,
  RunFinalization,
  TaskRun,
} from "../persistence/index.js";
import { PersistenceError } from "../persistence/index.js";
import {
  FINAL_DIFF_MANIFEST_KIND,
  FINAL_DIFF_MANIFEST_MEDIA_TYPE,
  FINAL_DIFF_MANIFEST_ROLE,
} from "./constants.js";
import { encodeReplayCursor } from "./cursor.js";

const VERIFICATION_TYPES = new Set([
  "test.observed",
  "build.observed",
  "lint.observed",
  "typecheck.observed",
  "command.completed",
  "command.failed",
]);

const SAFE_PAYLOAD_KEYS = new Set([
  "action",
  "attribution",
  "baselineComparison",
  "boundary",
  "diagnosticCode",
  "duplicate",
  "entryCount",
  "exitCode",
  "finalFingerprintPresent",
  "finalSnapshotPresent",
  "manifestPresent",
  "observationIndex",
  "outputEvidenceCount",
  "outputEvidencePresent",
  "recognized",
  "verificationKind",
  "mode",
  "outcome",
  "reconciliationPresent",
  "status",
  "staged",
  "stagedDirty",
  "terminalStatus",
  "toolName",
  "tool_name",
  "triggerPresent",
  "unstaged",
  "unstagedDirty",
]);

function truncateCodePoints(
  value: string,
  maximum: number,
): Readonly<{ value: string; truncated: boolean }> {
  const points = Array.from(value);
  if (points.length <= maximum) {
    return { value, truncated: false };
  }
  return { value: points.slice(0, maximum).join(""), truncated: true };
}

function safePayloadValue(value: JsonValue): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return truncateCodePoints(value, 512).value;
  }
  return undefined;
}

function projectEventPayload(event: NormalizedEventEnvelope): JsonObject {
  if (event.type === "user.prompt_submitted") {
    return {};
  }
  const projected: JsonObject = {};
  for (const [key, value] of Object.entries(event.payload)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) {
      continue;
    }
    const safe = safePayloadValue(value);
    if (safe !== undefined) {
      projected[key] = safe;
    }
  }
  return projected;
}

function completeness(run: TaskRun, finalization: RunFinalization | null): ReplayCompleteness {
  if (run.status === "Capturing" || run.status === "Finalizing") {
    if (finalization !== null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "An active Run cannot contain a terminal replay finalization.",
      );
    }
    return "in_progress";
  }
  if (finalization === null || finalization.terminalStatus !== run.status) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A terminal Run is missing a consistent replay finalization.",
    );
  }
  if (run.status === "Completed") {
    if (run.evidenceGapCount !== 0) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A completed replay Run contains evidence gaps.",
      );
    }
    return "complete";
  }
  if (run.status === "Partial") {
    return "partial";
  }
  return run.status === "Failed" ? "failed" : "abandoned";
}

function assertEventContinuity(events: readonly NormalizedEventEnvelope[], runId: string): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.runId !== runId || event.sequence !== index + 1) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The replay Event history is not a contiguous Run sequence.",
      );
    }
  }
}

function getContext(persistence: OwnLoopPersistence, run: TaskRun) {
  const conversation = persistence.conversations.get(run.conversationId);
  if (conversation === null) {
    throw new PersistenceError("invalid_persisted_row", "The replay Run has no Conversation.");
  }
  const workspace = persistence.workspaces.get(conversation.workspaceId);
  if (workspace === null) {
    throw new PersistenceError("invalid_persisted_row", "The replay Run has no Workspace.");
  }
  const actualGapCount = persistence.runSupport.countEvidenceGaps(run.runId);
  if (actualGapCount !== run.evidenceGapCount) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The replay Run evidence counter is inconsistent.",
    );
  }
  const baseline = persistence.gitBaselines.getByRun(run.runId);
  const reconciliations = persistence.gitReconciliations.listForRun(run.runId);
  const finalization = persistence.runFinalizations.getByRun(run.runId);
  const artifactRecords = persistence.artifacts.listRecordsForRunBounded(run.runId, 1000);
  return { conversation, workspace, baseline, reconciliations, finalization, artifactRecords };
}

function summaryFromRun(persistence: OwnLoopPersistence, run: TaskRun): ReplayRunSummaryV1 {
  const context = getContext(persistence, run);
  const preview = truncateCodePoints(run.redactedPrompt, REPLAY_PROMPT_PREVIEW_CODE_POINTS);
  return {
    runId: run.runId,
    conversationId: run.conversationId,
    workspaceId: context.workspace.workspaceId,
    runNumber: run.runNumber,
    status: run.status,
    completeness: completeness(run, context.finalization),
    promptPreview: preview.value,
    promptTruncated: preview.truncated,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    evidenceGapCount: run.evidenceGapCount,
    presence: {
      baseline: context.baseline !== null,
      reconciliation: context.reconciliations.length > 0,
      finalization: context.finalization !== null,
      finalManifest:
        context.finalization?.manifestArtifactId !== null && context.finalization !== null,
      terminalEvent: context.finalization !== null,
    },
  };
}

export function projectReplayRunList(
  persistence: OwnLoopPersistence,
  limit: number,
  cursor: ReplayTaskRunCursor | null,
): ReplayRunListResponseV1 {
  const rows = persistence.taskRuns.listRecentForReplay(limit + 1, cursor);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const runs = visible.map((run) => summaryFromRun(persistence, run));
  const last = visible.at(-1);
  return {
    ok: true,
    schemaVersion: RAW_REPLAY_SCHEMA_VERSION,
    runs,
    nextCursor:
      hasMore && last !== undefined
        ? encodeReplayCursor({
            startedAt: last.startedAt,
            conversationId: last.conversationId,
            runNumber: last.runNumber,
            runId: last.runId,
          })
        : null,
  };
}

function projectTimeline(events: readonly NormalizedEventEnvelope[]): ReplayTimelineEventV1[] {
  return events.map((event) => ({
    eventId: event.eventId,
    sequence: event.sequence ?? 0,
    type: event.type,
    source: event.source,
    sensitivity: event.sensitivity,
    occurredAt: event.occurredAt,
    ingestedAt: event.ingestedAt,
    payload: projectEventPayload(event),
    metadata: {
      collectorVersion: event.metadata.collectorVersion,
      sourceVersion: event.metadata.sourceVersion ?? null,
    },
  }));
}

function projectReconciliation(reconciliation: GitReconciliation) {
  return {
    reconciliationId: reconciliation.reconciliationId,
    boundary: reconciliation.boundary,
    outcome: reconciliation.outcome,
    diagnosticCode: reconciliation.diagnosticCode,
    attribution: reconciliation.attribution,
    baselineComparison: reconciliation.baselineComparison,
    triggerEventId: reconciliation.triggerEventId,
    summaryEventId: reconciliation.summaryEventId,
    stagedDirty: reconciliation.stagedDirty,
    unstagedDirty: reconciliation.unstagedDirty,
    capturedAt: reconciliation.capturedAt,
    counts: {
      entries: reconciliation.entryCount,
      created: reconciliation.createdCount,
      modified: reconciliation.modifiedCount,
      deleted: reconciliation.deletedCount,
      typeChanged: reconciliation.typeChangedCount,
      unmerged: reconciliation.unmergedCount,
    },
    changedFiles: reconciliation.entries.map((entry) => ({
      entryId: `reconciliation:${reconciliation.reconciliationId}:entry:${entry.entryIndex}`,
      entryIndex: entry.entryIndex,
      relativePath: entry.relativePath,
      changeKind: entry.changeKind,
      staged: entry.staged,
      unstaged: entry.unstaged,
      sensitivity: entry.sensitivity,
      attribution: entry.attribution,
      fileEventId: entry.fileEventId,
    })),
  } as const;
}

function addLink(
  links: Map<string, ReplayCausalLinkV1>,
  link: Omit<ReplayCausalLinkV1, "linkId">,
): void {
  const linkId = `${link.type}:${link.sourceKind}:${link.sourceId}:${link.targetKind}:${link.targetId}`;
  if (!links.has(linkId) && links.size >= 20_000) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Run exceeds the replay causal-link limit.",
    );
  }
  links.set(linkId, { linkId, ...link });
}

function projectCausalLinks(
  persistence: OwnLoopPersistence,
  runId: string,
  baselineId: string | null,
  baselineEventId: string | null,
  reconciliations: readonly GitReconciliation[],
  finalization: RunFinalization | null,
): ReplayCausalLinkV1[] {
  const links = new Map<string, ReplayCausalLinkV1>();
  for (const group of persistence.eventNormalizations.listReplayEventGroupsForRun(runId, 10_000)) {
    const sourceId = group.eventIds[0];
    if (sourceId === undefined) {
      continue;
    }
    for (const targetId of group.eventIds.slice(1)) {
      addLink(links, {
        type: "receipt_sibling",
        sourceKind: "event",
        sourceId,
        targetKind: "event",
        targetId,
      });
    }
  }
  if (baselineId !== null && baselineEventId !== null) {
    addLink(links, {
      type: "baseline_event",
      sourceKind: "event",
      sourceId: baselineEventId,
      targetKind: "baseline",
      targetId: baselineId,
    });
  }
  for (const reconciliation of reconciliations) {
    addLink(links, {
      type: "reconciliation_trigger",
      sourceKind: "event",
      sourceId: reconciliation.triggerEventId,
      targetKind: "reconciliation",
      targetId: reconciliation.reconciliationId,
    });
    addLink(links, {
      type: "reconciliation_summary",
      sourceKind: "reconciliation",
      sourceId: reconciliation.reconciliationId,
      targetKind: "event",
      targetId: reconciliation.summaryEventId,
    });
    for (const entry of reconciliation.entries) {
      addLink(links, {
        type: "reconciliation_file_event",
        sourceKind: "reconciliation",
        sourceId: reconciliation.reconciliationId,
        targetKind: "event",
        targetId: entry.fileEventId,
      });
    }
  }
  if (finalization !== null) {
    if (finalization.triggerEventId !== null) {
      addLink(links, {
        type: "finalization_trigger",
        sourceKind: "event",
        sourceId: finalization.triggerEventId,
        targetKind: "finalization",
        targetId: finalization.finalizationId,
      });
    }
    if (finalization.reconciliationId !== null) {
      addLink(links, {
        type: "finalization_reconciliation",
        sourceKind: "reconciliation",
        sourceId: finalization.reconciliationId,
        targetKind: "finalization",
        targetId: finalization.finalizationId,
      });
    }
    if (finalization.finalSnapshotEventId !== null) {
      addLink(links, {
        type: "finalization_snapshot",
        sourceKind: "finalization",
        sourceId: finalization.finalizationId,
        targetKind: "event",
        targetId: finalization.finalSnapshotEventId,
      });
    }
    addLink(links, {
      type: "finalization_terminal",
      sourceKind: "finalization",
      sourceId: finalization.finalizationId,
      targetKind: "event",
      targetId: finalization.terminalEventId,
    });
    if (finalization.manifestArtifactId !== null) {
      addLink(links, {
        type: "finalization_artifact",
        sourceKind: "finalization",
        sourceId: finalization.finalizationId,
        targetKind: "artifact",
        targetId: finalization.manifestArtifactId,
      });
    }
  }
  return [...links.values()].sort((left, right) => left.linkId.localeCompare(right.linkId));
}

function artifactProjection(
  records: ReturnType<OwnLoopPersistence["artifacts"]["listRecordsForRun"]>,
): ReplayArtifactReferenceV1[] {
  const visible = records.filter(
    ({ reference, artifact }) =>
      reference.role === FINAL_DIFF_MANIFEST_ROLE &&
      artifact.storageVersion === 1 &&
      artifact.kind === FINAL_DIFF_MANIFEST_KIND &&
      artifact.mediaType === FINAL_DIFF_MANIFEST_MEDIA_TYPE,
  );
  if (visible.length > 1000) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Run contains too many replay artifacts.",
    );
  }
  return visible.map(({ reference, artifact }) => ({
    artifactId: artifact.artifactId,
    role: reference.role,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    sensitivity: artifact.sensitivity,
    sizeBytes: artifact.sizeBytes,
    contentUrl: `/v1/replay/artifacts/${artifact.artifactId}`,
  }));
}

export function projectRawRunReplay(
  persistence: OwnLoopPersistence,
  runId: string,
  evidenceGraph: Readonly<{
    artifactId: string;
    value: DeterministicEvidenceGraphV1;
  }> | null = null,
): RawRunReplayV1 | null {
  const run = persistence.taskRuns.get(runId);
  if (run === null) {
    return null;
  }
  const context = getContext(persistence, run);
  const events = persistence.events.listForRunBounded(runId, 10_000);
  assertEventContinuity(events, runId);
  const summary = summaryFromRun(persistence, run);
  const timeline = projectTimeline(events);
  const verification: ReplayVerificationV1[] = timeline
    .filter((event) => VERIFICATION_TYPES.has(event.type))
    .map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type as ReplayVerificationV1["type"],
      occurredAt: event.occurredAt,
      payload: event.payload,
    }));
  const replay: RawRunReplayV1 = {
    ok: true,
    schemaVersion: RAW_REPLAY_SCHEMA_VERSION,
    run: {
      ...summary,
      redactedPrompt: run.redactedPrompt,
      sourceStopReason:
        run.sourceStopReason === null
          ? null
          : run.sourceStopReason === "stop"
            ? "stop"
            : "source_failure",
    },
    timeline,
    causalLinks: projectCausalLinks(
      persistence,
      runId,
      context.baseline?.baselineId ?? null,
      context.baseline?.baselineEventId ?? null,
      context.reconciliations,
      context.finalization,
    ),
    baseline:
      context.baseline === null
        ? null
        : {
            baselineId: context.baseline.baselineId,
            baselineEventId: context.baseline.baselineEventId,
            outcome: context.baseline.outcome,
            diagnosticCode: context.baseline.diagnosticCode,
            headPresent: context.baseline.headCommit !== null,
            stagedDirty: context.baseline.stagedDirty,
            unstagedDirty: context.baseline.unstagedDirty,
            untrackedCount: context.baseline.untrackedCount,
            untrackedHashedCount: context.baseline.untrackedHashedCount,
            untrackedOmittedCount: context.baseline.untrackedOmittedCount,
            capturedAt: context.baseline.capturedAt,
            captureDelayMs: context.baseline.captureDelayMs,
          },
    reconciliations: context.reconciliations.map(projectReconciliation),
    verification,
    evidenceGaps: (() => {
      const gaps = persistence.runSupport.listEvidenceGapsBounded(runId, 10_000);
      return gaps.map((gap) => ({
        gapId: gap.gapId,
        code: gap.code,
        message: truncateCodePoints(gap.message, 512).value,
        createdAt: gap.createdAt,
      }));
    })(),
    finalization:
      context.finalization === null
        ? null
        : {
            finalizationId: context.finalization.finalizationId,
            terminalStatus: context.finalization.terminalStatus,
            mode: context.finalization.mode,
            diagnosticCode: context.finalization.diagnosticCode,
            triggerEventId: context.finalization.triggerEventId,
            reconciliationId: context.finalization.reconciliationId,
            finalSnapshotEventId: context.finalization.finalSnapshotEventId,
            terminalEventId: context.finalization.terminalEventId,
            manifestArtifactId: context.finalization.manifestArtifactId,
            finalizedAt: context.finalization.finalizedAt,
          },
    artifacts: artifactProjection(context.artifactRecords),
  };
  if (evidenceGraph === null) {
    return replay;
  }
  const eventEvidence = new Map<string, string>();
  const changedFileEvidence = new Map<string, string>();
  const gapEvidence = new Map<string, string>();
  const finalizationEvidence = new Map<string, string>();
  const artifactEvidence = new Map<string, string>();
  for (const node of evidenceGraph.value.nodes) {
    switch (node.locator.kind) {
      case "event":
        eventEvidence.set(node.locator.eventId, node.evidenceId);
        break;
      case "changed_file":
        changedFileEvidence.set(node.locator.fileEventId, node.evidenceId);
        break;
      case "evidence_gap":
        gapEvidence.set(node.locator.gapId, node.evidenceId);
        break;
      case "finalization":
        finalizationEvidence.set(node.locator.finalizationId, node.evidenceId);
        break;
      case "artifact":
        artifactEvidence.set(node.locator.artifactId, node.evidenceId);
        break;
      default:
        break;
    }
  }
  return {
    ...replay,
    timeline: replay.timeline.map((item) => ({
      ...item,
      evidenceId: eventEvidence.get(item.eventId) ?? null,
    })),
    reconciliations: replay.reconciliations.map((item) => ({
      ...item,
      changedFiles: item.changedFiles.map((file) => ({
        ...file,
        evidenceId: changedFileEvidence.get(file.fileEventId) ?? null,
      })),
    })),
    verification: replay.verification.map((item) => ({
      ...item,
      evidenceId: eventEvidence.get(item.eventId) ?? null,
    })),
    evidenceGaps: replay.evidenceGaps.map((item) => ({
      ...item,
      evidenceId: gapEvidence.get(item.gapId) ?? null,
    })),
    finalization:
      replay.finalization === null
        ? null
        : {
            ...replay.finalization,
            evidenceId: finalizationEvidence.get(replay.finalization.finalizationId) ?? null,
          },
    artifacts: replay.artifacts.map((item) => ({
      ...item,
      evidenceId: artifactEvidence.get(item.artifactId) ?? null,
    })),
    evidenceGraph: {
      artifactId: evidenceGraph.artifactId,
      outcome: evidenceGraph.value.outcome,
      limitations: evidenceGraph.value.limitations,
      nodeCount: evidenceGraph.value.nodes.length,
      edgeCount: evidenceGraph.value.edges.length,
    },
  };
}

export function isReplayReadableArtifact(
  persistence: OwnLoopPersistence,
  artifactId: string,
): boolean {
  const metadata = persistence.artifacts.getMetadata(artifactId);
  if (
    metadata === null ||
    metadata.storageVersion !== 1 ||
    metadata.kind !== FINAL_DIFF_MANIFEST_KIND ||
    metadata.mediaType !== FINAL_DIFF_MANIFEST_MEDIA_TYPE
  ) {
    return false;
  }
  let corruptedReference = false;
  for (const reference of persistence.artifacts.listReferencesForArtifactBounded(
    artifactId,
    1000,
  )) {
    if (reference.role !== FINAL_DIFF_MANIFEST_ROLE) {
      continue;
    }
    const run = persistence.taskRuns.get(reference.runId);
    if (run === null) {
      corruptedReference = true;
      continue;
    }
    try {
      const context = getContext(persistence, run);
      completeness(run, context.finalization);
      assertEventContinuity(
        persistence.events.listForRunBounded(reference.runId, 10_000),
        reference.runId,
      );
      return true;
    } catch (error) {
      if (error instanceof PersistenceError) {
        corruptedReference = true;
        continue;
      }
      throw error;
    }
  }
  if (corruptedReference) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The replay artifact is linked only to an invalid Run projection.",
    );
  }
  return false;
}
