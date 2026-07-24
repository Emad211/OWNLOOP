import { createHash } from "node:crypto";

import {
  CANDIDATE_VALIDATION_MAX_ARTIFACT_BYTES,
  type CandidateValidationReportV1,
  CandidateValidationReportV1Schema,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ZERO_FINGERPRINT = `sha256:${"0".repeat(64)}`;
const REPORT_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: CANDIDATE_VALIDATION_MAX_ARTIFACT_BYTES,
  maxArrayItems: 10_000,
  maxObjectProperties: 10_000,
});

export type PreparedCandidateValidationReport = Readonly<{
  value: CandidateValidationReportV1;
  canonicalJson: string;
  bytes: Uint8Array;
  fingerprint: string;
}>;

function fingerprintMaterial(value: CandidateValidationReportV1): string {
  return canonicalizeJson({ ...value, reportFingerprint: ZERO_FINGERPRINT }, REPORT_LIMITS);
}

function reportFingerprint(value: CandidateValidationReportV1): string {
  return `sha256:${createHash("sha256").update(fingerprintMaterial(value)).digest("hex")}`;
}

export function prepareCandidateValidationReport(
  input: Omit<CandidateValidationReportV1, "reportFingerprint">,
): PreparedCandidateValidationReport {
  const provisional = CandidateValidationReportV1Schema.parse({
    ...input,
    reportFingerprint: ZERO_FINGERPRINT,
  });
  const value = CandidateValidationReportV1Schema.parse({
    ...provisional,
    reportFingerprint: reportFingerprint(provisional),
  });
  const canonicalJson = canonicalizeJson(value, REPORT_LIMITS);
  const bytes = encoder.encode(canonicalJson);
  if (bytes.byteLength === 0 || bytes.byteLength > CANDIDATE_VALIDATION_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "operation_failed",
      "The Candidate validation report size is invalid.",
    );
  }
  return { value, canonicalJson, bytes, fingerprint: value.reportFingerprint };
}

export function parseCanonicalCandidateValidationReport(
  bytes: Uint8Array,
): PreparedCandidateValidationReport {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > CANDIDATE_VALIDATION_MAX_ARTIFACT_BYTES
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation report size is invalid.",
    );
  }
  try {
    const canonicalJson = decoder.decode(bytes);
    const value = CandidateValidationReportV1Schema.parse(JSON.parse(canonicalJson));
    if (
      canonicalizeJson(value, REPORT_LIMITS) !== canonicalJson ||
      reportFingerprint(value) !== value.reportFingerprint
    ) {
      throw new Error("non-canonical Candidate validation report");
    }
    return {
      value,
      canonicalJson,
      bytes: Uint8Array.from(bytes),
      fingerprint: value.reportFingerprint,
    };
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate validation report is invalid.",
    );
  }
}
