import type {
  DeterministicChangeClassificationV1,
  DeterministicEvidenceGraphV1,
  DeterministicVerificationEvidenceV1,
  EvidenceGraphLimitation,
  EvidenceGraphOutcome,
  EvidenceId,
  EvidenceNodeV1,
  EvidenceResolutionAnchorKind,
  EvidenceResolutionV1,
} from "@ownloop/contracts";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  classifyFinalizedRunChanges,
  DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
  DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
  DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
  DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY,
  getRunChangeClassification,
  parseCanonicalChangeClassification,
} from "../change-classification/index.js";
import {
  FINAL_DIFF_MANIFEST_KIND,
  FINAL_DIFF_MANIFEST_MEDIA_TYPE,
  FINAL_DIFF_MANIFEST_ROLE,
} from "../finalization/index.js";
import {
  type ArtifactMetadata,
  type OwnLoopPersistence,
  PersistenceError,
  type RunArtifactRecord,
  type RunFinalization,
  type TaskRun,
} from "../persistence/index.js";
import {
  DETERMINISTIC_VERIFICATION_EVIDENCE_KIND,
  DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE,
  DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
  DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY,
  extractFinalizedRunVerificationEvidence,
  getRunVerificationEvidence,
  parseCanonicalVerificationEvidence,
} from "../verification-extraction/index.js";
import {
  parseCanonicalEvidenceGraph,
  prepareDeterministicEvidenceGraph,
  type PreparedEvidenceGraph,
} from "./artifact.js";
import type { EvidenceGraphBuilderInput } from "./builder.js";
import {
  DETERMINISTIC_EVIDENCE_GRAPH_KIND,
  DETERMINISTIC_EVIDENCE_GRAPH_MEDIA_TYPE,
  DETERMINISTIC_EVIDENCE_GRAPH_ROLE,
  DETERMINISTIC_EVIDENCE_GRAPH_SENSITIVITY,
  MAX_EVIDENCE_GRAPH_BATCH,
} from "./constants.js";

const MAX_GRAPH_SOURCE_EVENTS = 25_000;
const MAX_GRAPH_ARTIFACT_RECORDS = 4;

export type EvidenceGraphReadDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: Pick<LocalArtifactStore, "readPreparedBytes">;
}>;

export type EvidenceGraphDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}>;

function writableDependencies(
  dependencies: EvidenceGraphReadDependencies,
): EvidenceGraphDependencies {
  if (
    typeof (dependencies.artifactStore as Partial<LocalArtifactStore>).putPreparedArtifactForRun !==
    "function"
  ) {
    throw new PersistenceError(
      "operation_failed",
      "Evidence Graph source generation requires a writable artifact store.",
    );
  }
  return {
    persistence: dependencies.persistence,
    artifactStore: dependencies.artifactStore as LocalArtifactStore,
  };
}

export type EvidenceGraphResult = Readonly<{
  artifactId: string;
  schemaVersion: number;
  builderVersion: string;
  taxonomyVersion: string;
  runId: string;
  finalizationId: string;
  classificationArtifactId: string;
  verificationArtifactId: string;
  outcome: EvidenceGraphOutcome;
  limitations: readonly EvidenceGraphLimitation[];
  inputFingerprint: string;
  nodeCount: number;
  edgeCount: number;
  evidenceIds: readonly EvidenceId[];
}>;

type ValidatedSourceArtifact<T> = Readonly<{
  artifactId: string;
  record: RunArtifactRecord;
  value: T;
}>;

function safeResult(artifactId: string, value: DeterministicEvidenceGraphV1): EvidenceGraphResult {
  return {
    artifactId,
    schemaVersion: value.schemaVersion,
    builderVersion: value.builderVersion,
    taxonomyVersion: value.taxonomyVersion,
    runId: value.runId,
    finalizationId: value.finalizationId,
    classificationArtifactId: value.classificationArtifactId,
    verificationArtifactId: value.verificationArtifactId,
    outcome: value.outcome,
    limitations: value.limitations,
    inputFingerprint: value.inputFingerprint,
    nodeCount: value.nodes.length,
    edgeCount: value.edges.length,
    evidenceIds: value.nodes.map((node) => node.evidenceId),
  };
}

function terminalRun(run: TaskRun | null): TaskRun | null {
  return run !== null && ["Completed", "Partial", "Abandoned", "Failed"].includes(run.status)
    ? run
    : null;
}

function graphRecord(persistence: OwnLoopPersistence, runId: string): RunArtifactRecord | null {
  return persistence.artifacts.getRecordForRunRole(runId, DETERMINISTIC_EVIDENCE_GRAPH_ROLE);
}

function assertGraphMetadata(metadata: ArtifactMetadata): void {
  if (
    metadata.storageVersion !== 1 ||
    metadata.kind !== DETERMINISTIC_EVIDENCE_GRAPH_KIND ||
    metadata.mediaType !== DETERMINISTIC_EVIDENCE_GRAPH_MEDIA_TYPE ||
    metadata.sensitivity !== DETERMINISTIC_EVIDENCE_GRAPH_SENSITIVITY ||
    metadata.sizeBytes > 8 * 1024 * 1024
  ) {
    throw new PersistenceError("invalid_persisted_row", "Evidence Graph metadata is invalid.");
  }
}

function requiredRoleRecord(
  persistence: OwnLoopPersistence,
  runId: string,
  role: string,
  expectedArtifactId: string,
): RunArtifactRecord {
  const record = persistence.artifacts.getRecordForRunRole(runId, role);
  if (record === null || record.artifact.artifactId !== expectedArtifactId) {
    throw new PersistenceError("invalid_persisted_row", "Evidence source artifact is missing.");
  }
  return record;
}

async function classificationSource(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
  create: boolean,
): Promise<ValidatedSourceArtifact<DeterministicChangeClassificationV1> | null> {
  let result: Awaited<ReturnType<typeof classifyFinalizedRunChanges>>;
  if (create) {
    result = await classifyFinalizedRunChanges(writableDependencies(dependencies), runId);
  } else {
    result = await getRunChangeClassification(dependencies as EvidenceGraphDependencies, runId);
  }
  if (result === null) return null;
  const record = requiredRoleRecord(
    dependencies.persistence,
    runId,
    DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
    result.artifactId,
  );
  if (
    record.artifact.storageVersion !== 1 ||
    record.artifact.kind !== DETERMINISTIC_CHANGE_CLASSIFICATION_KIND ||
    record.artifact.mediaType !== DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE ||
    record.artifact.sensitivity !== DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY
  ) {
    throw new PersistenceError("invalid_persisted_row", "Classification metadata is invalid.");
  }
  const content = await dependencies.artifactStore.readPreparedBytes(result.artifactId);
  const value = parseCanonicalChangeClassification(content.bytes);
  if (value.inputFingerprint !== result.inputFingerprint) {
    throw new PersistenceError("invalid_persisted_row", "Classification read-back differs.");
  }
  return { artifactId: result.artifactId, record, value };
}

async function verificationSource(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
  create: boolean,
): Promise<ValidatedSourceArtifact<DeterministicVerificationEvidenceV1> | null> {
  let result: Awaited<ReturnType<typeof extractFinalizedRunVerificationEvidence>>;
  if (create) {
    result = await extractFinalizedRunVerificationEvidence(
      writableDependencies(dependencies),
      runId,
    );
  } else {
    result = await getRunVerificationEvidence(dependencies as EvidenceGraphDependencies, runId);
  }
  if (result === null) return null;
  const record = requiredRoleRecord(
    dependencies.persistence,
    runId,
    DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
    result.artifactId,
  );
  if (
    record.artifact.storageVersion !== 1 ||
    record.artifact.kind !== DETERMINISTIC_VERIFICATION_EVIDENCE_KIND ||
    record.artifact.mediaType !== DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE ||
    record.artifact.sensitivity !== DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY
  ) {
    throw new PersistenceError("invalid_persisted_row", "Verification metadata is invalid.");
  }
  const content = await dependencies.artifactStore.readPreparedBytes(result.artifactId);
  const value = parseCanonicalVerificationEvidence(content.bytes);
  if (value.inputFingerprint !== result.inputFingerprint) {
    throw new PersistenceError("invalid_persisted_row", "Verification read-back differs.");
  }
  return { artifactId: result.artifactId, record, value };
}

function sourceFacts(
  persistence: OwnLoopPersistence,
  runId: string,
  sourceEventCount?: number,
): Readonly<{
  run: TaskRun;
  finalization: RunFinalization;
  events: EvidenceGraphBuilderInput["events"];
  receiptGroups: EvidenceGraphBuilderInput["receiptGroups"];
  baseline: EvidenceGraphBuilderInput["baseline"];
  reconciliations: EvidenceGraphBuilderInput["reconciliations"];
  evidenceGaps: EvidenceGraphBuilderInput["evidenceGaps"];
}> | null {
  const run = terminalRun(persistence.taskRuns.get(runId));
  if (run === null) return null;
  const finalization = persistence.runFinalizations.getByRun(runId);
  if (finalization === null) {
    throw new PersistenceError("invalid_persisted_row", "Terminal Run lacks finalization.");
  }
  const events =
    sourceEventCount === undefined
      ? persistence.events.listForRunBounded(runId, MAX_GRAPH_SOURCE_EVENTS)
      : persistence.events.listForRunPrefixExact(runId, sourceEventCount);
  const eventIds = new Set(events.map((event) => event.eventId));
  const receiptGroups = persistence.eventNormalizations
    .listReplayEventGroupsForRun(runId, 10_000)
    .flatMap((group) => {
      const retained = group.eventIds.filter((eventId) => eventIds.has(eventId));
      return retained.length === 0 ? [] : [{ receiptId: group.receiptId, eventIds: retained }];
    });
  return {
    run,
    finalization,
    events,
    receiptGroups,
    baseline: persistence.gitBaselines.getByRun(runId),
    reconciliations: persistence.gitReconciliations.listForRun(runId),
    evidenceGaps: persistence.runSupport.listEvidenceGapsBounded(runId, 10_000),
  };
}

function sourceArtifactRecords(
  persistence: OwnLoopPersistence,
  runId: string,
  finalization: RunFinalization,
  classification: ValidatedSourceArtifact<DeterministicChangeClassificationV1>,
  verification: ValidatedSourceArtifact<DeterministicVerificationEvidenceV1>,
): readonly RunArtifactRecord[] {
  const records = [classification.record, verification.record];
  if (finalization.manifestArtifactId !== null) {
    const manifest = requiredRoleRecord(
      persistence,
      runId,
      FINAL_DIFF_MANIFEST_ROLE,
      finalization.manifestArtifactId,
    );
    if (
      manifest.artifact.storageVersion !== 1 ||
      manifest.artifact.kind !== FINAL_DIFF_MANIFEST_KIND ||
      manifest.artifact.mediaType !== FINAL_DIFF_MANIFEST_MEDIA_TYPE ||
      manifest.artifact.sensitivity !== "sensitive" ||
      manifest.artifact.sizeBytes > 2 * 1024 * 1024
    ) {
      throw new PersistenceError("invalid_persisted_row", "Final manifest metadata is invalid.");
    }
    records.unshift(manifest);
  }
  if (records.length > MAX_GRAPH_ARTIFACT_RECORDS) {
    throw new PersistenceError("invalid_persisted_row", "Evidence source artifact set is invalid.");
  }
  return records;
}

async function prepareSource(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
  create: boolean,
  sourceEventCount?: number,
): Promise<PreparedEvidenceGraph | null> {
  const classification = await classificationSource(dependencies, runId, create);
  const verification = await verificationSource(dependencies, runId, create);
  if (classification === null || verification === null) {
    if (create) {
      throw new PersistenceError("operation_failed", "Evidence source artifacts are unavailable.");
    }
    return null;
  }
  // OL-014 may append deterministic derived Events while it creates the verification artifact.
  // Capture the authoritative Graph Event prefix only after both source artifacts exist.
  const facts = sourceFacts(dependencies.persistence, runId, sourceEventCount);
  if (facts === null) return null;
  return prepareDeterministicEvidenceGraph({
    ...facts,
    artifactRecords: sourceArtifactRecords(
      dependencies.persistence,
      runId,
      facts.finalization,
      classification,
      verification,
    ),
    classificationArtifactId: classification.artifactId,
    classification: classification.value,
    verificationArtifactId: verification.artifactId,
    verification: verification.value,
  });
}

export async function readValidatedRunEvidenceGraph(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
): Promise<Readonly<{ artifactId: string; value: DeterministicEvidenceGraphV1 }> | null> {
  const record = graphRecord(dependencies.persistence, runId);
  if (record === null) return null;
  assertGraphMetadata(record.artifact);
  const content = await dependencies.artifactStore.readPreparedBytes(record.artifact.artifactId);
  if (
    content.artifactId !== record.artifact.artifactId ||
    content.kind !== DETERMINISTIC_EVIDENCE_GRAPH_KIND ||
    content.mediaType !== DETERMINISTIC_EVIDENCE_GRAPH_MEDIA_TYPE ||
    content.sensitivity !== DETERMINISTIC_EVIDENCE_GRAPH_SENSITIVITY ||
    content.sizeBytes !== record.artifact.sizeBytes
  ) {
    throw new PersistenceError("invalid_persisted_row", "Evidence Graph read metadata differs.");
  }
  const value = parseCanonicalEvidenceGraph(content.bytes);
  if (value.runId !== runId) {
    throw new PersistenceError("invalid_persisted_row", "Evidence Graph Run ownership differs.");
  }
  const expected = await prepareSource(dependencies, runId, false, value.sourceEventCount);
  if (expected === null || expected.canonicalJson !== new TextDecoder().decode(content.bytes)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "Evidence Graph no longer matches accepted source facts.",
    );
  }
  return { artifactId: record.artifact.artifactId, value };
}

export async function getRunEvidenceGraph(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
): Promise<EvidenceGraphResult | null> {
  const graph = await readValidatedRunEvidenceGraph(dependencies, runId);
  return graph === null ? null : safeResult(graph.artifactId, graph.value);
}

export async function buildFinalizedRunEvidenceGraph(
  dependencies: EvidenceGraphDependencies,
  runId: string,
): Promise<EvidenceGraphResult | null> {
  const existing = await getRunEvidenceGraph(dependencies, runId);
  if (existing !== null) return existing;
  const prepared = await prepareSource(dependencies, runId, true);
  if (prepared === null) return null;
  try {
    await dependencies.artifactStore.putPreparedArtifactForRun({
      preparedContent: [prepared.bytes],
      runId,
      role: DETERMINISTIC_EVIDENCE_GRAPH_ROLE,
      kind: DETERMINISTIC_EVIDENCE_GRAPH_KIND,
      mediaType: DETERMINISTIC_EVIDENCE_GRAPH_MEDIA_TYPE,
      sensitivity: DETERMINISTIC_EVIDENCE_GRAPH_SENSITIVITY,
    });
  } catch (error) {
    // A concurrent processor may have linked the same deterministic role.
    const raced = await getRunEvidenceGraph(dependencies, runId);
    if (raced !== null) return raced;
    throw error;
  }
  const persisted = await getRunEvidenceGraph(dependencies, runId);
  if (persisted === null || persisted.inputFingerprint !== prepared.value.inputFingerprint) {
    throw new PersistenceError(
      "operation_failed",
      "Evidence Graph was not persisted consistently.",
    );
  }
  return persisted;
}

export async function buildEligibleFinalizedRunEvidenceGraphs(
  dependencies: EvidenceGraphDependencies,
  limit = MAX_EVIDENCE_GRAPH_BATCH,
): Promise<readonly EvidenceGraphResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVIDENCE_GRAPH_BATCH) return [];
  const runIds = dependencies.persistence.artifacts.listFinalizedRunIdsWithoutRole(
    DETERMINISTIC_EVIDENCE_GRAPH_ROLE,
    limit,
  );
  const results: EvidenceGraphResult[] = [];
  for (const runId of runIds) {
    const result = await buildFinalizedRunEvidenceGraph(dependencies, runId);
    if (result !== null) results.push(result);
  }
  return results;
}

function anchorForNode(node: EvidenceNodeV1): Readonly<{
  kind: EvidenceResolutionAnchorKind;
  sectionId: string;
  sourceId: string;
}> {
  switch (node.locator.kind) {
    case "run":
      return { kind: "run", sectionId: "run-summary", sourceId: node.locator.runId };
    case "event":
      return { kind: "timeline_event", sectionId: "timeline", sourceId: node.locator.eventId };
    case "baseline":
      return {
        kind: "baseline",
        sectionId: "evidence-structure",
        sourceId: node.locator.baselineId,
      };
    case "reconciliation":
      return {
        kind: "reconciliation",
        sectionId: "evidence-structure",
        sourceId: node.locator.reconciliationId,
      };
    case "changed_file":
      return {
        kind: "changed_file",
        sectionId: "changed-files",
        sourceId: node.locator.fileEventId,
      };
    case "evidence_gap":
      return { kind: "evidence_gap", sectionId: "evidence-gaps", sourceId: node.locator.gapId };
    case "finalization":
      return {
        kind: "finalization",
        sectionId: "evidence-structure",
        sourceId: node.locator.finalizationId,
      };
    case "artifact":
      return { kind: "artifact", sectionId: "artifacts", sourceId: node.locator.artifactId };
    case "classification_entry":
    case "classification_label":
    case "classification_rule":
      return {
        kind: "classification",
        sectionId: "changed-files",
        sourceId: node.locator.artifactId,
      };
    case "command_observation":
    case "verification_observation":
    case "test_file_change":
      return {
        kind: "verification",
        sectionId: "verification",
        sourceId: node.locator.artifactId,
      };
  }
}

export async function resolveRunEvidence(
  dependencies: EvidenceGraphReadDependencies,
  runId: string,
  requestedEvidenceId: string,
): Promise<EvidenceResolutionV1 | null> {
  if (!/^ev_[0-9a-f]{48}$/u.test(requestedEvidenceId)) return null;
  const graph = await readValidatedRunEvidenceGraph(dependencies, runId);
  if (graph === null) return null;
  const node = graph.value.nodes.find((candidate) => candidate.evidenceId === requestedEvidenceId);
  if (node === undefined) return null;
  return {
    ok: true,
    schemaVersion: graph.value.schemaVersion,
    runId,
    evidenceId: node.evidenceId,
    nodeKind: node.kind,
    graphOutcome: graph.value.outcome,
    limitations: graph.value.limitations,
    anchor: anchorForNode(node),
  };
}
