import { createHash } from "node:crypto";

import {
  CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES,
  CANDIDATE_MOMENT_MAX_BATCH_BYTES,
  type CandidateMomentBatchV1,
  CandidateMomentBatchV1Schema,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const CANDIDATE_ARTIFACT_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: CANDIDATE_MOMENT_MAX_BATCH_BYTES,
  maxArrayItems: 10_000,
  maxObjectProperties: 10_000,
});

export type CanonicalCandidateMomentBatch = Readonly<{
  value: CandidateMomentBatchV1;
  canonicalJson: string;
  bytes: Uint8Array;
  fingerprint: string;
}>;

function fingerprint(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalCandidateMomentBatch(input: unknown): CanonicalCandidateMomentBatch {
  const value = CandidateMomentBatchV1Schema.parse(input);
  if (value.candidates.length > CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES) {
    throw new PersistenceError(
      "operation_failed",
      "The provider Candidate batch exceeds the product limit.",
    );
  }
  const canonicalJson = canonicalizeJson(value, CANDIDATE_ARTIFACT_LIMITS);
  const bytes = encoder.encode(canonicalJson);
  if (bytes.byteLength === 0 || bytes.byteLength > CANDIDATE_MOMENT_MAX_BATCH_BYTES) {
    throw new PersistenceError("operation_failed", "The Candidate artifact size is invalid.");
  }
  return { value, canonicalJson, bytes, fingerprint: fingerprint(bytes) };
}

export function parseCanonicalCandidateMomentBatch(
  bytes: Uint8Array,
): CanonicalCandidateMomentBatch {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > CANDIDATE_MOMENT_MAX_BATCH_BYTES
  ) {
    throw new PersistenceError("invalid_persisted_row", "The Candidate artifact size is invalid.");
  }
  try {
    const canonicalJson = decoder.decode(bytes);
    const value = CandidateMomentBatchV1Schema.parse(JSON.parse(canonicalJson));
    if (
      value.candidates.length > CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES ||
      canonicalizeJson(value, CANDIDATE_ARTIFACT_LIMITS) !== canonicalJson
    ) {
      throw new Error("non-canonical Candidate artifact");
    }
    return { value, canonicalJson, bytes: Uint8Array.from(bytes), fingerprint: fingerprint(bytes) };
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate artifact is invalid.",
    );
  }
}
