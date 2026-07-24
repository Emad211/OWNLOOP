import {
  type DeterministicSemanticAnalysisInputV1,
  DeterministicSemanticAnalysisInputV1Schema,
  SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SEMANTIC_ARTIFACT_CANONICAL_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
  maxArrayItems: 100_000,
  maxObjectProperties: 100_000,
});

export function canonicalSemanticAnalysisInput(
  value: DeterministicSemanticAnalysisInputV1,
): Readonly<{ canonicalJson: string; bytes: Uint8Array }> {
  const parsed = DeterministicSemanticAnalysisInputV1Schema.parse(value);
  const canonicalJson = canonicalizeJson(parsed, SEMANTIC_ARTIFACT_CANONICAL_LIMITS);
  const bytes = encoder.encode(canonicalJson);
  if (
    bytes.byteLength > SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES ||
    parsed.estimates.utf8ByteCount !== bytes.byteLength ||
    parsed.estimates.inputTokenUpperBound < bytes.byteLength
  ) {
    throw new PersistenceError(
      "operation_failed",
      "The semantic-analysis input artifact estimate or size is invalid.",
    );
  }
  return { canonicalJson, bytes };
}

export function parseCanonicalSemanticAnalysisInput(
  bytes: Uint8Array,
): DeterministicSemanticAnalysisInputV1 {
  if (bytes.byteLength > SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-analysis input exceeds the artifact size limit.",
    );
  }
  try {
    const canonicalJson = decoder.decode(bytes);
    const parsed = DeterministicSemanticAnalysisInputV1Schema.parse(JSON.parse(canonicalJson));
    if (
      canonicalizeJson(parsed, SEMANTIC_ARTIFACT_CANONICAL_LIMITS) !== canonicalJson ||
      parsed.estimates.utf8ByteCount !== bytes.byteLength ||
      parsed.estimates.inputTokenUpperBound < bytes.byteLength
    ) {
      throw new Error("non-canonical semantic input");
    }
    return parsed;
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted semantic-analysis input artifact is invalid.",
    );
  }
}
