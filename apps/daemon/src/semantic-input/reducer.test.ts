import { describe, expect, it } from "vitest";

import { parseCanonicalSemanticAnalysisInput } from "./artifact.js";
import { prepareDeterministicSemanticAnalysisInput } from "./reducer.js";
import {
  runEvidenceId,
  semanticInputFixture,
  unavailableSemanticInputFixture,
  verificationEvidenceId,
} from "./test-fixture.js";

describe("semantic-analysis input reducer", () => {
  it("produces deterministic evidence-addressed canonical bytes", () => {
    const input = semanticInputFixture();
    const first = prepareDeterministicSemanticAnalysisInput(input);
    const second = prepareDeterministicSemanticAnalysisInput(input);
    if (!("bytes" in first) || !("bytes" in second)) throw new Error("expected ready input");

    expect(first.bytes).toEqual(second.bytes);
    expect(first.value).toMatchObject({
      outcome: "ready",
      diagnosticCode: null,
      graphContext: { runEvidenceId },
      goal: { evidenceId: runEvidenceId },
      verificationExcerpts: [
        {
          evidenceId: verificationEvidenceId,
          verificationKind: "test",
          observedStatus: "passed",
        },
      ],
    });
    expect(first.value.goal?.text).toContain("[REDACTED_URL]");
    expect(first.value.goal?.text).toContain("package.json");
    expect(first.value.verificationExcerpts[0]?.text).toContain("[REDACTED_PATH]");
    expect(first.canonicalJson).not.toContain("/home/alice/project");
    expect(first.canonicalJson).not.toContain("secret=hidden");
    expect(parseCanonicalSemanticAnalysisInput(first.bytes)).toEqual(first.value);
  });

  it("returns unavailable without inventing evidence for an unavailable graph", () => {
    expect(prepareDeterministicSemanticAnalysisInput(unavailableSemanticInputFixture())).toEqual({
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: [],
    });
  });
});
