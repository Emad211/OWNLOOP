import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  CandidateMomentBatchV1Schema,
  CandidateMomentV1Schema,
  DeterministicChangeClassificationV1Schema,
  formatBootstrapName,
  parseCandidateMomentBatchV1,
  parseCandidateMomentV1,
} from "../src/index.js";

describe("bootstrap contract", () => {
  it("formats the stable workspace label", () => {
    expect(formatBootstrapName(APP_NAME)).toBe("OwnLoop v0.1 bootstrap");
  });

  it("exports deterministic change-classification contracts from the package root", () => {
    expect(CHANGE_CLASSIFIER_VERSION).toBe("0.1.0");
    expect(DeterministicChangeClassificationV1Schema).toBeDefined();
  });

  it("exports candidate-moment contracts and parsers from the package root", () => {
    expect(CANDIDATE_MOMENT_SCHEMA_VERSION).toBe(1);
    expect(CandidateMomentV1Schema).toBeDefined();
    expect(CandidateMomentBatchV1Schema).toBeDefined();
    expect(parseCandidateMomentV1).toBeTypeOf("function");
    expect(parseCandidateMomentBatchV1).toBeTypeOf("function");
  });
});
