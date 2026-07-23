import { createHash } from "node:crypto";

import {
  type DeterministicChangeClassificationV1,
  type DeterministicEvidenceGraphV1,
  DeterministicEvidenceGraphV1Schema,
  type DeterministicVerificationEvidenceV1,
  type EvidenceEdgeType,
  type EvidenceEdgeV1,
  EVIDENCE_EDGE_TYPES,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_LIMITATIONS,
  EVIDENCE_GRAPH_MAX_EDGES,
  EVIDENCE_GRAPH_MAX_NODES,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  type EvidenceGraphKindCountV1,
  type EvidenceGraphLimitation,
  type EvidenceNodeKind,
  type EvidenceNodeLocatorV1,
  type EvidenceNodeMetadataV1,
  type EvidenceNodeV1,
  EVIDENCE_NODE_KINDS,
} from "@ownloop/contracts";
import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { canonicalizeJson } from "@ownloop/ingress-security";

import type {
  EvidenceGapRecord,
  GitBaseline,
  GitReconciliation,
  ReceiptReplayEventGroup,
  RunArtifactRecord,
  RunFinalization,
  TaskRun,
} from "../persistence/index.js";
import { PersistenceError } from "../persistence/index.js";
import { DETERMINISTIC_EVIDENCE_GRAPH_ROLE } from "./constants.js";

export type EvidenceGraphBuilderInput = Readonly<{
  run: TaskRun;
  finalization: RunFinalization;
  events: readonly NormalizedEventEnvelope[];
  receiptGroups: readonly ReceiptReplayEventGroup[];
  baseline: GitBaseline | null;
  reconciliations: readonly GitReconciliation[];
  evidenceGaps: readonly EvidenceGapRecord[];
  artifactRecords: readonly RunArtifactRecord[];
  classificationArtifactId: string;
  classification: DeterministicChangeClassificationV1;
  verificationArtifactId: string;
  verification: DeterministicVerificationEvidenceV1;
}>;

function digest(prefix: "ev" | "ed", domain: string, value: unknown): string {
  const hash = createHash("sha256")
    .update(`ownloop-evidence-graph-v1\0${domain}\0${canonicalizeJson(value)}`)
    .digest("hex");
  return `${prefix}_${hash.slice(0, 48)}`;
}

export function evidenceId(locator: EvidenceNodeLocatorV1): `ev_${string}` {
  return digest("ev", locator.kind, locator) as `ev_${string}`;
}

function edgeId(
  type: EvidenceEdgeType,
  sourceEvidenceId: string,
  targetEvidenceId: string,
): `ed_${string}` {
  return digest("ed", type, { sourceEvidenceId, targetEvidenceId }) as `ed_${string}`;
}

function assertEventContinuity(runId: string, events: readonly NormalizedEventEnvelope[]): void {
  for (const [index, event] of events.entries()) {
    if (event.runId !== runId || event.sequence !== index + 1) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Evidence Graph source Event sequence is not contiguous.",
      );
    }
  }
}

function kindCounts<T extends EvidenceNodeKind | EvidenceEdgeType>(
  order: readonly T[],
  values: readonly T[],
): EvidenceGraphKindCountV1[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return order.flatMap((kind) => {
    const count = counts.get(kind);
    return count === undefined ? [] : [{ kind, count }];
  });
}

function inputFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function buildDeterministicEvidenceGraph(
  input: EvidenceGraphBuilderInput,
): DeterministicEvidenceGraphV1 {
  if (
    input.finalization.runId !== input.run.runId ||
    input.classification.runId !== input.run.runId ||
    input.verification.runId !== input.run.runId ||
    input.classification.finalizationId !== input.finalization.finalizationId ||
    input.verification.finalizationId !== input.finalization.finalizationId ||
    input.verification.classificationArtifactId !== input.classificationArtifactId ||
    input.verification.classificationInputFingerprint !== input.classification.inputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Evidence Graph source ownership is inconsistent.",
    );
  }
  if (!["Completed", "Partial", "Abandoned", "Failed"].includes(input.run.status)) {
    throw new PersistenceError("operation_failed", "The Evidence Graph Run is not terminal.");
  }
  assertEventContinuity(input.run.runId, input.events);

  const nodes = new Map<string, EvidenceNodeV1>();
  const edges = new Map<string, EvidenceEdgeV1>();

  const addNode = (
    locator: EvidenceNodeLocatorV1,
    metadata: EvidenceNodeMetadataV1 = {},
  ): string => {
    const id = evidenceId(locator);
    const node: EvidenceNodeV1 = { evidenceId: id, kind: locator.kind, locator, metadata };
    const existing = nodes.get(id);
    if (existing !== undefined && canonicalizeJson(existing) !== canonicalizeJson(node)) {
      throw new PersistenceError("invalid_persisted_row", "Evidence node identity collision.");
    }
    if (existing === undefined && nodes.size >= EVIDENCE_GRAPH_MAX_NODES) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Evidence Graph exceeds the node limit.",
      );
    }
    nodes.set(id, node);
    return id;
  };

  const addEdge = (type: EvidenceEdgeType, sourceEvidenceId: string, targetEvidenceId: string) => {
    if (sourceEvidenceId === targetEvidenceId) {
      throw new PersistenceError("invalid_persisted_row", "Evidence self-edge is invalid.");
    }
    const id = edgeId(type, sourceEvidenceId, targetEvidenceId);
    const edge: EvidenceEdgeV1 = { edgeId: id, type, sourceEvidenceId, targetEvidenceId };
    const existing = edges.get(id);
    if (existing !== undefined && canonicalizeJson(existing) !== canonicalizeJson(edge)) {
      throw new PersistenceError("invalid_persisted_row", "Evidence edge identity collision.");
    }
    if (existing === undefined && edges.size >= EVIDENCE_GRAPH_MAX_EDGES) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Evidence Graph exceeds the edge limit.",
      );
    }
    edges.set(id, edge);
  };

  const runNode = addNode(
    { kind: "run", runId: input.run.runId },
    { outcome: input.run.status, terminalStatus: input.finalization.terminalStatus },
  );
  const eventNodeIds = new Map<string, string>();
  for (const event of input.events) {
    const nodeId = addNode(
      { kind: "event", eventId: event.eventId },
      {
        eventType: event.type,
        eventSource: event.source,
        sensitivity: event.sensitivity,
        sourceAnalyzerVersion: String(event.schemaVersion),
      },
    );
    eventNodeIds.set(event.eventId, nodeId);
    addEdge("run_contains", runNode, nodeId);
  }

  for (const group of input.receiptGroups) {
    const sourceId = group.eventIds[0];
    if (sourceId === undefined) continue;
    const sourceNode = eventNodeIds.get(sourceId);
    if (sourceNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Receipt sibling Event is missing.");
    }
    for (const eventId of group.eventIds.slice(1)) {
      const targetNode = eventNodeIds.get(eventId);
      if (targetNode === undefined) {
        throw new PersistenceError("invalid_persisted_row", "Receipt sibling Event is missing.");
      }
      addEdge("normalized_with", sourceNode, targetNode);
    }
  }

  if (input.baseline !== null) {
    if (input.baseline.runId !== input.run.runId) {
      throw new PersistenceError("invalid_persisted_row", "Evidence baseline ownership differs.");
    }
    const baselineNode = addNode(
      { kind: "baseline", baselineId: input.baseline.baselineId },
      {
        outcome: input.baseline.outcome,
        diagnosticCode: input.baseline.diagnosticCode,
        sourceAnalyzerVersion: "git-baseline-v1",
      },
    );
    addEdge("run_contains", runNode, baselineNode);
    const baselineEventNode = eventNodeIds.get(input.baseline.baselineEventId);
    if (baselineEventNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Baseline Event is missing.");
    }
    addEdge("baseline_recorded_by", baselineNode, baselineEventNode);
  }

  const changedFileNodesByEvent = new Map<string, string>();
  const reconciliationNodes = new Map<string, string>();
  for (const reconciliation of input.reconciliations) {
    if (reconciliation.runId !== input.run.runId) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Evidence reconciliation ownership differs.",
      );
    }
    const reconciliationNode = addNode(
      { kind: "reconciliation", reconciliationId: reconciliation.reconciliationId },
      {
        outcome: reconciliation.outcome,
        diagnosticCode: reconciliation.diagnosticCode,
        attribution: reconciliation.attribution,
        sourceAnalyzerVersion: "git-reconciliation-v1",
      },
    );
    reconciliationNodes.set(reconciliation.reconciliationId, reconciliationNode);
    addEdge("run_contains", runNode, reconciliationNode);
    const triggerNode = eventNodeIds.get(reconciliation.triggerEventId);
    const summaryNode = eventNodeIds.get(reconciliation.summaryEventId);
    if (triggerNode === undefined || summaryNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Reconciliation Event is missing.");
    }
    addEdge("reconciliation_triggered_by", reconciliationNode, triggerNode);
    addEdge("reconciliation_summarized_by", reconciliationNode, summaryNode);
    for (const entry of reconciliation.entries) {
      const changedFileNode = addNode(
        {
          kind: "changed_file",
          reconciliationId: reconciliation.reconciliationId,
          entryIndex: entry.entryIndex,
          fileEventId: entry.fileEventId,
        },
        {
          changeKind: entry.changeKind,
          sensitivity: entry.sensitivity,
          attribution: entry.attribution,
        },
      );
      if (changedFileNodesByEvent.has(entry.fileEventId)) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "A file Event is linked to multiple changed-file identities.",
        );
      }
      changedFileNodesByEvent.set(entry.fileEventId, changedFileNode);
      addEdge("run_contains", runNode, changedFileNode);
      addEdge("reconciliation_observed_file", reconciliationNode, changedFileNode);
      const fileEventNode = eventNodeIds.get(entry.fileEventId);
      if (fileEventNode === undefined) {
        throw new PersistenceError("invalid_persisted_row", "Changed-file Event is missing.");
      }
      addEdge("changed_file_emitted_event", changedFileNode, fileEventNode);
    }
  }

  for (const gap of input.evidenceGaps) {
    if (gap.runId !== input.run.runId) {
      throw new PersistenceError("invalid_persisted_row", "Evidence gap ownership differs.");
    }
    const gapNode = addNode({ kind: "evidence_gap", gapId: gap.gapId }, { gapCode: gap.code });
    addEdge("run_has_gap", runNode, gapNode);
  }

  const finalizationNode = addNode(
    { kind: "finalization", finalizationId: input.finalization.finalizationId },
    {
      outcome: input.finalization.terminalStatus,
      terminalStatus: input.finalization.terminalStatus,
      diagnosticCode: input.finalization.diagnosticCode,
      sourceAnalyzerVersion: input.finalization.generatorVersion,
    },
  );
  addEdge("run_contains", runNode, finalizationNode);
  if (input.finalization.triggerEventId !== null) {
    const trigger = eventNodeIds.get(input.finalization.triggerEventId);
    if (trigger === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Finalization trigger Event is missing.");
    }
    addEdge("finalization_triggered_by", finalizationNode, trigger);
  }
  if (input.finalization.reconciliationId !== null) {
    const reconciliationNode = reconciliationNodes.get(input.finalization.reconciliationId);
    if (reconciliationNode === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Finalization reconciliation is missing.",
      );
    }
    addEdge("finalization_uses_reconciliation", finalizationNode, reconciliationNode);
  }
  for (const eventId of [
    input.finalization.finalSnapshotEventId,
    input.finalization.terminalEventId,
  ]) {
    if (eventId === null) continue;
    const eventNode = eventNodeIds.get(eventId);
    if (eventNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Finalization Event is missing.");
    }
    addEdge("finalization_emitted_event", finalizationNode, eventNode);
  }

  const artifactNodes = new Map<string, string>();
  for (const record of input.artifactRecords) {
    if (record.reference.runId !== input.run.runId) {
      throw new PersistenceError("invalid_persisted_row", "Artifact reference ownership differs.");
    }
    if (record.reference.role === DETERMINISTIC_EVIDENCE_GRAPH_ROLE) continue;
    const artifactNode = addNode(
      {
        kind: "artifact",
        artifactId: record.artifact.artifactId,
        role: record.reference.role,
      },
      {
        artifactKind: record.artifact.kind,
        sensitivity: record.artifact.sensitivity,
        sourceAnalyzerVersion: String(record.artifact.storageVersion),
      },
    );
    artifactNodes.set(record.artifact.artifactId, artifactNode);
    addEdge("run_materialized_artifact", runNode, artifactNode);
  }
  if (input.finalization.manifestArtifactId !== null) {
    const artifactNode = artifactNodes.get(input.finalization.manifestArtifactId);
    if (artifactNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Finalization artifact is missing.");
    }
    addEdge("finalization_materialized_artifact", finalizationNode, artifactNode);
  }

  const classificationArtifactNode = artifactNodes.get(input.classificationArtifactId);
  if (classificationArtifactNode === undefined) {
    throw new PersistenceError("invalid_persisted_row", "Classification artifact node is missing.");
  }
  const classificationEntriesByFileEvent = new Map<string, string>();
  for (const entry of input.classification.entries) {
    const entryNode = addNode(
      {
        kind: "classification_entry",
        artifactId: input.classificationArtifactId,
        entryIndex: entry.entryIndex,
        fileEventId: entry.fileEventId,
      },
      { sourceAnalyzerVersion: input.classification.classifierVersion },
    );
    classificationEntriesByFileEvent.set(entry.fileEventId, entryNode);
    addEdge("run_contains", runNode, entryNode);
    const changedFileNode = changedFileNodesByEvent.get(entry.fileEventId);
    if (changedFileNode === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Classification entry has no changed-file source.",
      );
    }
    addEdge("changed_file_classified_by", changedFileNode, entryNode);
    for (const assigned of entry.labels) {
      const labelNode = addNode(
        {
          kind: "classification_label",
          artifactId: input.classificationArtifactId,
          entryIndex: entry.entryIndex,
          label: assigned.label,
        },
        {
          label: assigned.label,
          confidenceBasisPoints: assigned.confidenceBasisPoints,
          sourceAnalyzerVersion: input.classification.taxonomyVersion,
        },
      );
      addEdge("classification_assigned_label", entryNode, labelNode);
      for (const evidence of assigned.evidence) {
        const ruleNode = addNode(
          {
            kind: "classification_rule",
            artifactId: input.classificationArtifactId,
            ruleId: evidence.ruleId,
          },
          {
            ruleId: evidence.ruleId,
            ruleEvidenceKind: evidence.kind,
            sourceAnalyzerVersion: input.classification.ruleSetVersion,
          },
        );
        addEdge("classification_supported_by_rule", labelNode, ruleNode);
      }
    }
  }

  const verificationArtifactNode = artifactNodes.get(input.verificationArtifactId);
  if (verificationArtifactNode === undefined) {
    throw new PersistenceError("invalid_persisted_row", "Verification artifact node is missing.");
  }
  for (const observation of input.verification.commandObservations) {
    const commandNode = addNode(
      {
        kind: "command_observation",
        artifactId: input.verificationArtifactId,
        observationIndex: observation.observationIndex,
        sourceEventId: observation.sourceEventId,
      },
      {
        verificationKind: observation.kind,
        observedStatus: observation.status,
        ruleId: observation.ruleId,
        sourceAnalyzerVersion: input.verification.extractorVersion,
      },
    );
    addEdge("run_contains", runNode, commandNode);
    const sourceEventNode = eventNodeIds.get(observation.sourceEventId);
    const commandEventNode = eventNodeIds.get(observation.commandEventId);
    if (sourceEventNode === undefined || commandEventNode === undefined) {
      throw new PersistenceError("invalid_persisted_row", "Command observation Event is missing.");
    }
    addEdge("command_observed_from_event", commandNode, sourceEventNode);
    addEdge("command_emitted_event", commandNode, commandEventNode);
    if (observation.verificationEventId !== null && observation.kind !== "unknown") {
      const verificationNode = addNode(
        {
          kind: "verification_observation",
          artifactId: input.verificationArtifactId,
          observationIndex: observation.observationIndex,
          verificationKind: observation.kind,
        },
        {
          verificationKind: observation.kind,
          observedStatus: observation.status,
          sourceAnalyzerVersion: input.verification.extractorVersion,
        },
      );
      addEdge("command_has_verification", commandNode, verificationNode);
      const verificationEventNode = eventNodeIds.get(observation.verificationEventId);
      if (verificationEventNode === undefined) {
        throw new PersistenceError("invalid_persisted_row", "Verification Event is missing.");
      }
      addEdge("verification_emitted_event", verificationNode, verificationEventNode);
    }
  }
  for (const change of input.verification.testFileChanges) {
    const changeNode = addNode(
      {
        kind: "test_file_change",
        artifactId: input.verificationArtifactId,
        entryIndex: change.entryIndex,
        fileEventId: change.fileEventId,
      },
      { verificationKind: "test", sourceAnalyzerVersion: input.verification.extractorVersion },
    );
    addEdge("run_contains", runNode, changeNode);
    const classificationEntryNode = classificationEntriesByFileEvent.get(change.fileEventId);
    if (classificationEntryNode === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Test-file evidence classification source is missing.",
      );
    }
    addEdge("test_file_change_supported_by_classification", changeNode, classificationEntryNode);
  }

  const limitations = new Set<EvidenceGraphLimitation>();
  if (changedFileNodesByEvent.size > 0) limitations.add("diff_hunks_not_retained");
  if (input.finalization.manifestArtifactId === null) limitations.add("final_manifest_unavailable");
  if (input.classification.outcome === "partial") limitations.add("classification_partial");
  if (input.classification.outcome === "unavailable") limitations.add("classification_unavailable");
  if (input.verification.outcome === "partial") limitations.add("verification_partial");
  if (input.verification.outcome === "unavailable") limitations.add("verification_unavailable");
  if (input.evidenceGaps.length > 0) limitations.add("evidence_gaps_present");
  const orderedLimitations = EVIDENCE_GRAPH_LIMITATIONS.filter((item) => limitations.has(item));
  const outcome = orderedLimitations.length === 0 ? "complete" : "partial";
  const sortedNodes = [...nodes.values()].toSorted((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
  const sortedEdges = [...edges.values()].toSorted((left, right) =>
    left.edgeId.localeCompare(right.edgeId),
  );
  const fingerprint = inputFingerprint({
    schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    builderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
    taxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    runId: input.run.runId,
    finalizationId: input.finalization.finalizationId,
    classificationArtifactId: input.classificationArtifactId,
    classificationInputFingerprint: input.classification.inputFingerprint,
    verificationArtifactId: input.verificationArtifactId,
    verificationInputFingerprint: input.verification.inputFingerprint,
    sourceEventCount: input.events.length,
    limitations: orderedLimitations,
    nodes: sortedNodes.map(({ kind, locator, metadata }) => ({ kind, locator, metadata })),
    edges: sortedEdges.map(({ type, sourceEvidenceId, targetEvidenceId }) => ({
      type,
      sourceEvidenceId,
      targetEvidenceId,
    })),
  });
  return DeterministicEvidenceGraphV1Schema.parse({
    schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    builderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
    taxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    runId: input.run.runId,
    finalizationId: input.finalization.finalizationId,
    classificationArtifactId: input.classificationArtifactId,
    classificationInputFingerprint: input.classification.inputFingerprint,
    verificationArtifactId: input.verificationArtifactId,
    verificationInputFingerprint: input.verification.inputFingerprint,
    sourceEventCount: input.events.length,
    outcome,
    diagnosticCode: outcome === "complete" ? null : "source_partial",
    limitations: orderedLimitations,
    inputFingerprint: fingerprint,
    nodes: sortedNodes,
    edges: sortedEdges,
    nodeKindCounts: kindCounts(
      EVIDENCE_NODE_KINDS,
      sortedNodes.map((node) => node.kind),
    ),
    edgeTypeCounts: kindCounts(
      EVIDENCE_EDGE_TYPES,
      sortedEdges.map((edge) => edge.type),
    ),
  });
}
