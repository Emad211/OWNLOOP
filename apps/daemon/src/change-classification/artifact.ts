import { createHash } from "node:crypto";

import {
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  type DeterministicChangeClassificationV1,
  DeterministicChangeClassificationV1Schema,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import {
  type GitReconciliation,
  type RunFinalization,
  PersistenceError,
} from "../persistence/index.js";
import {
  CHANGE_CLASSIFICATION_MAX_ARTIFACT_BYTES,
  CHANGE_CLASSIFICATION_MAX_ENTRIES,
} from "./constants.js";
import { aggregateClassificationLabels, classifyReconciliationEntries } from "./engine.js";

const CLASSIFICATION_ARTIFACT_CANONICAL_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: CHANGE_CLASSIFICATION_MAX_ARTIFACT_BYTES,
});

// The accepted fingerprint input includes up to 2,000 canonical relative paths. A path may be
// 1,024 UTF-16 code units and require up to three UTF-8 bytes per code unit, in addition to the
// controlled entry metadata. This bounded budget accepts the complete OL-013 input surface while
// remaining independent from the smaller Hook-ingress canonical JSON limit.
const CHANGE_CLASSIFICATION_MAX_INPUT_CANONICAL_BYTES = 8 * 1024 * 1024;
const CLASSIFICATION_INPUT_CANONICAL_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: CHANGE_CLASSIFICATION_MAX_INPUT_CANONICAL_BYTES,
});

export type PreparedChangeClassification = Readonly<{
  value: DeterministicChangeClassificationV1;
  canonicalJson: string;
  bytes: Uint8Array;
}>;

function inputValue(
  runId: string,
  finalization: RunFinalization,
  reconciliation: GitReconciliation | null,
): Record<string, unknown> {
  return {
    schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CHANGE_CLASSIFIER_VERSION,
    taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
    ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    runId,
    finalizationId: finalization.finalizationId,
    reconciliation:
      reconciliation === null
        ? null
        : {
            reconciliationId: reconciliation.reconciliationId,
            outcome: reconciliation.outcome,
            diagnosticCode: reconciliation.diagnosticCode,
            boundary: reconciliation.boundary,
            attribution: reconciliation.attribution,
            baselineComparison: reconciliation.baselineComparison,
            entries: reconciliation.entries.map((entry) => ({
              entryIndex: entry.entryIndex,
              fileEventId: entry.fileEventId,
              relativePath: entry.relativePath,
              changeKind: entry.changeKind,
              staged: entry.staged,
              unstaged: entry.unstaged,
              sensitivity: entry.sensitivity,
              attribution: entry.attribution,
            })),
          },
  };
}

function inputFingerprint(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalizeJson(value, CLASSIFICATION_INPUT_CANONICAL_LIMITS))
    .digest("hex");
}

export function prepareDeterministicChangeClassification(
  runId: string,
  finalization: RunFinalization,
  reconciliation: GitReconciliation | null,
): PreparedChangeClassification {
  if (finalization.runId !== runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Run finalization ownership is inconsistent for classification.",
    );
  }
  if (finalization.reconciliationId !== (reconciliation?.reconciliationId ?? null)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The finalization reconciliation linkage is inconsistent for classification.",
    );
  }
  if (reconciliation !== null && reconciliation.runId !== runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Git reconciliation ownership is inconsistent for classification.",
    );
  }
  if ((reconciliation?.entries.length ?? 0) > CHANGE_CLASSIFICATION_MAX_ENTRIES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The classification input exceeds the supported entry limit.",
    );
  }

  const entries =
    reconciliation === null ? [] : classifyReconciliationEntries(reconciliation.entries);
  const outcome =
    reconciliation === null
      ? "unavailable"
      : reconciliation.outcome === "captured"
        ? "classified"
        : "partial";
  const diagnosticCode =
    reconciliation === null
      ? "reconciliation_unavailable"
      : reconciliation.outcome === "partial"
        ? "reconciliation_partial"
        : null;
  const value = DeterministicChangeClassificationV1Schema.parse({
    schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CHANGE_CLASSIFIER_VERSION,
    taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
    ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    runId,
    finalizationId: finalization.finalizationId,
    reconciliationId: reconciliation?.reconciliationId ?? null,
    outcome,
    diagnosticCode,
    inputFingerprint: inputFingerprint(inputValue(runId, finalization, reconciliation)),
    entries,
    aggregateLabels: aggregateClassificationLabels(entries),
  });
  const canonicalJson = canonicalizeJson(value, CLASSIFICATION_ARTIFACT_CANONICAL_LIMITS);
  const bytes = new TextEncoder().encode(canonicalJson);
  if (bytes.byteLength > CHANGE_CLASSIFICATION_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "operation_failed",
      "The deterministic classification exceeds the artifact size limit.",
    );
  }
  return { value, canonicalJson, bytes };
}

export function parseCanonicalChangeClassification(
  bytes: Uint8Array,
): DeterministicChangeClassificationV1 {
  if (bytes.byteLength > CHANGE_CLASSIFICATION_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted classification exceeds the artifact size limit.",
    );
  }
  let canonical: string;
  try {
    canonical = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted classification is not valid UTF-8.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical) as unknown;
    if (canonicalizeJson(parsed, CLASSIFICATION_ARTIFACT_CANONICAL_LIMITS) !== canonical) {
      throw new Error("non-canonical classification");
    }
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted classification is not canonical JSON.",
    );
  }
  const result = DeterministicChangeClassificationV1Schema.safeParse(parsed);
  if (!result.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted classification contract is invalid.",
    );
  }
  return result.data;
}
