import { describe, expect, it } from "vitest";

import { parseCanonicalCandidateValidationReport } from "./artifact.js";
import { CHANGE_CANDIDATE, validatorInput } from "./test-fixture.js";
import { buildCandidateValidationReport } from "./validator.js";

describe("Candidate validation report artifact", () => {
  it("round-trips canonical bytes and rejects tampering", () => {
    const prepared = buildCandidateValidationReport(validatorInput([CHANGE_CANDIDATE]));
    expect(parseCanonicalCandidateValidationReport(prepared.bytes).canonicalJson).toBe(
      prepared.canonicalJson,
    );
    const tampered = Uint8Array.from(prepared.bytes);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 48 ? 49 : 48;
    expect(() => parseCanonicalCandidateValidationReport(tampered)).toThrow();
  });
});
