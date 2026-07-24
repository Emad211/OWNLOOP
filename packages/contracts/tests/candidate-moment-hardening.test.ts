import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CANDIDATE_DECISION_OPTIONS,
  CandidateMomentV1Schema,
  parseCandidateMomentV1,
} from "../src/candidate-moment.js";

const decisionCandidate = {
  type: "decision" as const,
  title: "Confirm the evidence-backed behavior",
  claim: "The candidate contract retains a fixed decision response.",
  importance: "high" as const,
  confidenceBasisPoints: 8_500,
  evidenceIds: [`ev_${"a".repeat(48)}`],
  suggestedInteraction: {
    kind: "decision_response" as const,
    prompt: "Should this decision be confirmed?",
    options: CANDIDATE_DECISION_OPTIONS,
  },
};

describe("candidate moment hardening", () => {
  it("rejects lone UTF-16 surrogates while retaining valid supplementary characters", () => {
    const loneHighSurrogate = String.fromCharCode(0xd800);
    const loneLowSurrogate = String.fromCharCode(0xdc00);

    for (const title of [
      loneHighSurrogate,
      loneLowSurrogate,
      `before${loneHighSurrogate}after`,
      `before${loneLowSurrogate}after`,
    ]) {
      expect(() => CandidateMomentV1Schema.parse({ ...decisionCandidate, title })).toThrow();
    }

    expect(
      CandidateMomentV1Schema.parse({
        ...decisionCandidate,
        title: "Confirm the evidence-backed behavior 😀",
      }).title,
    ).toBe("Confirm the evidence-backed behavior 😀");
  });

  it("rejects negative zero confidence instead of canonicalizing it to zero", () => {
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...decisionCandidate,
        confidenceBasisPoints: -0,
      }),
    ).toThrow();
  });

  it("rejects obfuscated and scheme-less URLs without rejecting ordinary dotted text", () => {
    for (const title of [
      "java\nscript:alert(1)",
      "Review h t t p s : // example.com/path before merge",
      "Review www.example.com/path before merge",
      "Review www . example . museum / path before merge",
      "Review //example.invalid/path before merge",
      "Review example.com/path before merge",
      "Review example.museum/path before merge",
      "Contact owner@example.org before merge",
      "Contact owner @ example.museum before merge",
      "Review localhost:3000/path before merge",
      "Review localhost / path before merge",
      "Review 127.0.0.1:3000/path before merge",
      "Review 127.0.0.1 / path before merge",
    ]) {
      expect(() => CandidateMomentV1Schema.parse({ ...decisionCandidate, title })).toThrow();
    }

    for (const title of [
      "Update package.json while preserving version 1.2.3",
      "Keep Node.js compatibility",
      "Compare object.property without navigation",
      "Record metadata: updated",
      "Describe database: consistency",
    ]) {
      expect(CandidateMomentV1Schema.parse({ ...decisionCandidate, title }).title).toBe(title);
    }
  });

  it("preserves the fixed decision option tuple in deeply readonly parser output", () => {
    const parsed = parseCandidateMomentV1(decisionCandidate);
    expect(parsed.type).toBe("decision");
    if (parsed.type !== "decision") {
      throw new Error("Expected a decision candidate.");
    }

    expectTypeOf(parsed.suggestedInteraction.options).toEqualTypeOf<
      readonly ["confirm", "revise", "uncertain"]
    >();
    expect(Object.isFrozen(parsed.suggestedInteraction.options)).toBe(true);
  });
});
