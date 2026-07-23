import {
  type DeterministicEvidenceGraphV1,
  DeterministicEvidenceGraphV1Schema,
  EVIDENCE_GRAPH_MAX_ARTIFACT_BYTES,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";
import type { EvidenceGraphBuilderInput } from "./builder.js";
import { buildDeterministicEvidenceGraph } from "./builder.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type PreparedEvidenceGraph = Readonly<{
  value: DeterministicEvidenceGraphV1;
  canonicalJson: string;
  bytes: Uint8Array;
}>;

export function prepareDeterministicEvidenceGraph(
  input: EvidenceGraphBuilderInput,
): PreparedEvidenceGraph {
  const value = buildDeterministicEvidenceGraph(input);
  let canonicalJson: string;
  try {
    canonicalJson = canonicalizeJson(value, {
      ...DEFAULT_CANONICAL_INPUT_LIMITS,
      maxUtf8Bytes: EVIDENCE_GRAPH_MAX_ARTIFACT_BYTES,
      maxArrayItems: 100_000,
      maxObjectProperties: 100_000,
    });
  } catch {
    throw new PersistenceError(
      "operation_failed",
      "The deterministic Evidence Graph exceeds canonical limits.",
    );
  }
  const bytes = encoder.encode(canonicalJson);
  if (bytes.byteLength > EVIDENCE_GRAPH_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError("operation_failed", "The Evidence Graph exceeds the size limit.");
  }
  return { value, canonicalJson, bytes };
}

export function parseCanonicalEvidenceGraph(bytes: Uint8Array): DeterministicEvidenceGraphV1 {
  try {
    const text = decoder.decode(bytes);
    const parsed = DeterministicEvidenceGraphV1Schema.parse(JSON.parse(text));
    if (
      canonicalizeJson(parsed, {
        ...DEFAULT_CANONICAL_INPUT_LIMITS,
        maxUtf8Bytes: EVIDENCE_GRAPH_MAX_ARTIFACT_BYTES,
        maxArrayItems: 100_000,
        maxObjectProperties: 100_000,
      }) !== text
    ) {
      throw new Error("non-canonical");
    }
    return parsed;
  } catch {
    throw new PersistenceError("invalid_persisted_row", "The Evidence Graph artifact is invalid.");
  }
}
