import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  CANDIDATE_DECISION_OPTIONS,
  CANDIDATE_MOMENT_CLAIM_MAX_BYTES,
  CANDIDATE_MOMENT_MAX_BATCH_CANDIDATES,
  CANDIDATE_MOMENT_MAX_EVIDENCE_IDS,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  CANDIDATE_RISK_OPTIONS,
  CandidateMomentBatchV1Schema,
  CandidateMomentV1Schema,
  parseCandidateMomentBatchV1,
  parseCandidateMomentV1,
} from "../src/candidate-moment.js";

const evidenceId = (character: string): string => `ev_${character.repeat(48)}`;
const indexedEvidenceId = (index: number): string => `ev_${index.toString(16).padStart(48, "0")}`;

const shared = {
  title: "Review the authenticated replay change",
  claim: "The replay route now requires locally resolvable evidence.",
  importance: "high" as const,
  confidenceBasisPoints: 8_500,
  evidenceIds: [evidenceId("a")],
};

const candidates = {
  change: {
    type: "change" as const,
    ...shared,
    suggestedInteraction: { kind: "acknowledge" as const },
  },
  decision: {
    type: "decision" as const,
    ...shared,
    suggestedInteraction: {
      kind: "decision_response" as const,
      prompt: "Should this decision be confirmed?",
      options: [...CANDIDATE_DECISION_OPTIONS],
    },
  },
  risk: {
    type: "risk" as const,
    ...shared,
    suggestedInteraction: {
      kind: "risk_response" as const,
      prompt: "How should this risk be handled?",
      options: [...CANDIDATE_RISK_OPTIONS],
    },
  },
  check: {
    type: "check" as const,
    ...shared,
    suggestedInteraction: {
      kind: "check_answer" as const,
      question: "Which outcome is supported by the evidence?",
      choices: [
        { id: "supported", label: "The route is evidence-backed" },
        { id: "unsupported", label: "No evidence is required" },
      ],
    },
  },
};

describe("candidate moment contracts", () => {
  it.each(Object.entries(candidates))("accepts the valid %s candidate", (_name, candidate) => {
    expect(CandidateMomentV1Schema.parse(candidate)).toEqual(candidate);
  });

  it("accepts a strict batch containing all four candidate types", () => {
    const batch = {
      schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
      candidates: Object.values(candidates),
    };
    expect(CandidateMomentBatchV1Schema.parse(batch)).toEqual(batch);
  });

  it("requires one or more unique strict Evidence IDs", () => {
    const { evidenceIds: _evidenceIds, ...withoutEvidence } = candidates.change;
    expect(() => CandidateMomentV1Schema.parse(withoutEvidence)).toThrow(ZodError);
    expect(() => CandidateMomentV1Schema.parse({ ...candidates.change, evidenceIds: [] })).toThrow(
      ZodError,
    );
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.change,
        evidenceIds: [evidenceId("a"), evidenceId("a")],
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, evidenceIds: ["event-1"] }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.change,
        evidenceIds: Array.from({ length: CANDIDATE_MOMENT_MAX_EVIDENCE_IDS + 1 }, (_, index) =>
          indexedEvidenceId(index),
        ),
      }),
    ).toThrow(ZodError);
  });

  it("rejects an interaction kind that does not match the candidate type", () => {
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.change,
        suggestedInteraction: candidates.decision.suggestedInteraction,
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.decision,
        suggestedInteraction: candidates.risk.suggestedInteraction,
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.risk,
        suggestedInteraction: candidates.check.suggestedInteraction,
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: candidates.change.suggestedInteraction,
      }),
    ).toThrow(ZodError);
  });

  it("keeps decision and risk options fixed and ordered", () => {
    const decision = candidates.decision.suggestedInteraction;
    const risk = candidates.risk.suggestedInteraction;
    for (const options of [
      decision.options.toReversed(),
      [...decision.options, "delegate"],
      decision.options.slice(0, 2),
    ]) {
      expect(() =>
        CandidateMomentV1Schema.parse({
          ...candidates.decision,
          suggestedInteraction: { ...decision, options },
        }),
      ).toThrow(ZodError);
    }
    for (const options of [
      risk.options.toReversed(),
      [...risk.options, "ignore"],
      risk.options.slice(1),
    ]) {
      expect(() =>
        CandidateMomentV1Schema.parse({
          ...candidates.risk,
          suggestedInteraction: { ...risk, options },
        }),
      ).toThrow(ZodError);
    }
  });

  it("bounds and validates check choices", () => {
    const interaction = candidates.check.suggestedInteraction;
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: { ...interaction, choices: interaction.choices.slice(0, 1) },
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: {
          ...interaction,
          choices: Array.from({ length: 6 }, (_, index) => ({
            id: `choice_${index}`,
            label: `Choice ${index}`,
          })),
        },
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: {
          ...interaction,
          choices: [
            { id: "same", label: "First" },
            { id: "same", label: "Second" },
          ],
        },
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: {
          ...interaction,
          choices: [
            { id: "invalid-choice", label: "First" },
            { id: "second", label: "Second" },
          ],
        },
      }),
    ).toThrow(ZodError);
  });

  it("requires integer confidence within 0 through 10000", () => {
    for (const confidenceBasisPoints of [-1, 10_001, 10.5, Number.NaN]) {
      expect(() =>
        CandidateMomentV1Schema.parse({ ...candidates.change, confidenceBasisPoints }),
      ).toThrow(ZodError);
    }
    expect(
      CandidateMomentV1Schema.parse({ ...candidates.change, confidenceBasisPoints: 0 })
        .confidenceBasisPoints,
    ).toBe(0);
    expect(
      CandidateMomentV1Schema.parse({ ...candidates.change, confidenceBasisPoints: 10_000 })
        .confidenceBasisPoints,
    ).toBe(10_000);
  });

  it("accepts only controlled importance values", () => {
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, importance: "urgent" }),
    ).toThrow(ZodError);
  });

  it("rejects non-NFC, control, raw markup, URI, and blank text", () => {
    const unsafeValues = [
      "e\u0301",
      "unsafe\u0000text",
      "unsafe\u0007text",
      "<script>alert(1)</script>",
      "JaVaScRiPt:alert(1)",
      "DATA: text/plain;base64,abc",
      "vbscript:msgbox(1)",
      "https://example.com/path",
      "https:example.com/path",
      "mailto:owner@example.com",
      "   ",
    ];
    for (const title of unsafeValues) {
      expect(() => CandidateMomentV1Schema.parse({ ...candidates.change, title })).toThrow(
        ZodError,
      );
    }
  });

  it("enforces independent code-point and UTF-8 byte bounds", () => {
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.change,
        claim: "é".repeat(Math.floor(CANDIDATE_MOMENT_CLAIM_MAX_BYTES / 2) + 1),
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, title: "a".repeat(161) }),
    ).toThrow(ZodError);
  });

  it("rejects unknown candidate and interaction kinds plus extra fields", () => {
    expect(() => CandidateMomentV1Schema.parse({ ...candidates.change, type: "summary" })).toThrow(
      ZodError,
    );
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.change,
        suggestedInteraction: { kind: "open_url" },
      }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, path: "src/app.ts" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, sourceExcerpt: "secret" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, model: "provider-model" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, url: "https://example.com" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, command: "rm -rf" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({ ...candidates.change, artifactId: "artifact-1" }),
    ).toThrow(ZodError);
    expect(() =>
      CandidateMomentV1Schema.parse({
        ...candidates.check,
        suggestedInteraction: {
          ...candidates.check.suggestedInteraction,
          choices: [
            { id: "first", label: "First", callback: "runTool" },
            { id: "second", label: "Second" },
          ],
        },
      }),
    ).toThrow(ZodError);
  });

  it("bounds the candidate count in a batch", () => {
    expect(() =>
      CandidateMomentBatchV1Schema.parse({
        schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
        candidates: Array.from(
          { length: CANDIDATE_MOMENT_MAX_BATCH_CANDIDATES + 1 },
          () => candidates.change,
        ),
      }),
    ).toThrow(ZodError);
  });

  it("enforces the aggregate UTF-8 byte bound for a batch", () => {
    const largeCandidate = {
      ...candidates.check,
      title: "😀".repeat(160),
      claim: "😀".repeat(2_000),
      suggestedInteraction: {
        ...candidates.check.suggestedInteraction,
        question: "😀".repeat(500),
        choices: Array.from({ length: 5 }, (_, index) => ({
          id: `choice_${index}`,
          label: "😀".repeat(160),
        })),
      },
    };
    expect(() =>
      CandidateMomentBatchV1Schema.parse({
        schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
        candidates: Array.from(
          { length: CANDIDATE_MOMENT_MAX_BATCH_CANDIDATES },
          () => largeCandidate,
        ),
      }),
    ).toThrow(ZodError);
  });

  it("does not accept provider, prompt, cost, storage, or executable batch fields", () => {
    for (const extra of [
      { provider: "example" },
      { prompt: "hidden prompt" },
      { tokenCount: 1 },
      { cost: 0.01 },
      { artifactPath: "/tmp/artifact" },
      { html: "<strong>text</strong>" },
      { execute: "run" },
    ]) {
      expect(() =>
        CandidateMomentBatchV1Schema.parse({
          schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
          candidates: [],
          ...extra,
        }),
      ).toThrow(ZodError);
    }
  });

  it("parses into deeply immutable clones without mutating input", () => {
    const input = structuredClone(candidates.check);
    const before = structuredClone(input);
    const parsed = parseCandidateMomentV1(input);
    expect(input).toEqual(before);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.evidenceIds)).toBe(true);
    expect(Object.isFrozen(parsed.suggestedInteraction)).toBe(true);
    if (parsed.type === "check") {
      expect(Object.isFrozen(parsed.suggestedInteraction.choices)).toBe(true);
      expect(Object.isFrozen(parsed.suggestedInteraction.choices[0])).toBe(true);
    }
  });

  it("returns a deeply immutable batch clone", () => {
    const parsed = parseCandidateMomentBatchV1({
      schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
      candidates: [candidates.decision],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.candidates)).toBe(true);
    expect(Object.isFrozen(parsed.candidates[0])).toBe(true);
  });
});
