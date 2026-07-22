import {
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  DeterministicChangeClassificationV1Schema,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

function validClassification() {
  return {
    schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CHANGE_CLASSIFIER_VERSION,
    taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
    ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    reconciliationId: "reconciliation-1",
    outcome: "classified",
    diagnosticCode: null,
    inputFingerprint: "a".repeat(64),
    entries: [
      {
        entryIndex: 0,
        fileEventId: "file-event-1",
        changeKind: "modified",
        attribution: "run_relative",
        sensitivity: "normal",
        labels: [
          {
            label: "tests",
            confidenceBasisPoints: 9500,
            evidence: [{ ruleId: "tests.test_suffix", kind: "path_pattern" }],
          },
        ],
      },
    ],
    aggregateLabels: [{ label: "tests", entryCount: 1, maximumConfidenceBasisPoints: 9500 }],
  } as const;
}

describe("deterministic change classification contracts", () => {
  it("accepts a strict evidence-backed classification", () => {
    expect(DeterministicChangeClassificationV1Schema.parse(validClassification())).toEqual(
      validClassification(),
    );
  });

  it("rejects forbidden persistence fields and inconsistent outcomes", () => {
    expect(
      DeterministicChangeClassificationV1Schema.safeParse({
        ...validClassification(),
        repositoryRoot: "/private/repository",
      }).success,
    ).toBe(false);
    expect(
      DeterministicChangeClassificationV1Schema.safeParse({
        ...validClassification(),
        outcome: "unavailable",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate file Event identities", () => {
    const base = validClassification();
    const invalid = {
      ...base,
      entries: [
        ...base.entries,
        {
          ...base.entries[0],
          entryIndex: 1,
        },
      ],
      aggregateLabels: [{ label: "tests", entryCount: 2, maximumConfidenceBasisPoints: 9500 }],
    };
    expect(DeterministicChangeClassificationV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects aggregate values that do not match classified entries", () => {
    const base = validClassification();
    const invalid = {
      ...base,
      aggregateLabels: [{ ...base.aggregateLabels[0], entryCount: 2 }],
    };
    expect(DeterministicChangeClassificationV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("requires canonical label/evidence ordering and controlled unknown semantics", () => {
    const base = validClassification();
    const invalidOrder = {
      ...base,
      entries: [
        {
          ...base.entries[0],
          labels: [
            {
              label: "unknown",
              confidenceBasisPoints: 0,
              evidence: [{ ruleId: "fallback.no_supported_rule", kind: "fallback" }],
            },
            ...base.entries[0].labels,
          ],
        },
      ],
    };
    expect(DeterministicChangeClassificationV1Schema.safeParse(invalidOrder).success).toBe(false);

    const unknown = {
      ...validClassification(),
      entries: [
        {
          ...validClassification().entries[0],
          labels: [
            {
              label: "unknown",
              confidenceBasisPoints: 0,
              evidence: [{ ruleId: "fallback.no_supported_rule", kind: "fallback" }],
            },
          ],
        },
      ],
      aggregateLabels: [{ label: "unknown", entryCount: 1, maximumConfidenceBasisPoints: 0 }],
    };
    expect(DeterministicChangeClassificationV1Schema.parse(unknown)).toEqual(unknown);
  });
});
