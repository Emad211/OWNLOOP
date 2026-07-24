import { createHash } from "node:crypto";

import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

export const CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1 = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "candidates"],
  properties: {
    schemaVersion: { const: 1 },
    candidates: {
      type: "array",
      maxItems: 7,
      items: {
        anyOf: [
          candidateSchema("change", {
            type: "object",
            additionalProperties: false,
            required: ["kind"],
            properties: { kind: { const: "acknowledge" } },
          }),
          candidateSchema(
            "decision",
            fixedResponse("decision_response", ["confirm", "revise", "uncertain"]),
          ),
          candidateSchema(
            "risk",
            fixedResponse("risk_response", ["acknowledge", "mitigate", "dismiss"]),
          ),
          candidateSchema("check", {
            type: "object",
            additionalProperties: false,
            required: ["kind", "question", "choices"],
            properties: {
              kind: { const: "check_answer" },
              question: { type: "string", minLength: 1, maxLength: 500 },
              choices: {
                type: "array",
                minItems: 2,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label"],
                  properties: {
                    id: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
                    label: { type: "string", minLength: 1, maxLength: 160 },
                  },
                },
              },
            },
          }),
        ],
      },
    },
  },
});

function fixedResponse(kind: string, options: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "prompt", "options"],
    properties: {
      kind: { const: kind },
      prompt: { type: "string", minLength: 1, maxLength: 500 },
      options: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "string", enum: [...options] },
      },
    },
  };
}

function candidateSchema(type: string, interaction: object) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "title",
      "claim",
      "importance",
      "confidenceBasisPoints",
      "evidenceIds",
      "suggestedInteraction",
    ],
    properties: {
      type: { const: type },
      title: { type: "string", minLength: 1, maxLength: 160 },
      claim: { type: "string", minLength: 1, maxLength: 2000 },
      importance: { type: "string", enum: ["low", "medium", "high", "critical"] },
      confidenceBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
      evidenceIds: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: { type: "string", pattern: "^ev_[0-9a-f]{48}$" },
      },
      suggestedInteraction: interaction,
    },
  };
}

export const CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_CANONICAL = canonicalizeJson(
  CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1,
  DEFAULT_CANONICAL_INPUT_LIMITS,
);
export const CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_FINGERPRINT = `sha256:${createHash("sha256")
  .update(CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_CANONICAL)
  .digest("hex")}` as const;
