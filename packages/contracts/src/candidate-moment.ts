import { z } from "zod";

import { EvidenceIdSchema } from "./evidence-graph.js";

export const CANDIDATE_MOMENT_SCHEMA_VERSION = 1 as const;
export const CANDIDATE_MOMENT_MAX_EVIDENCE_IDS = 32;
export const CANDIDATE_MOMENT_MAX_BATCH_CANDIDATES = 50;
export const CANDIDATE_MOMENT_MAX_BATCH_BYTES = 512 * 1024;

export const CANDIDATE_MOMENT_TITLE_MAX_CODE_POINTS = 160;
export const CANDIDATE_MOMENT_TITLE_MAX_BYTES = 640;
export const CANDIDATE_MOMENT_CLAIM_MAX_CODE_POINTS = 2_000;
export const CANDIDATE_MOMENT_CLAIM_MAX_BYTES = 8_000;
export const CANDIDATE_MOMENT_INTERACTION_TEXT_MAX_CODE_POINTS = 500;
export const CANDIDATE_MOMENT_INTERACTION_TEXT_MAX_BYTES = 2_000;
export const CANDIDATE_MOMENT_CHOICE_LABEL_MAX_CODE_POINTS = 160;
export const CANDIDATE_MOMENT_CHOICE_LABEL_MAX_BYTES = 640;

export const CANDIDATE_MOMENT_TYPES = ["change", "decision", "risk", "check"] as const;
export const CandidateMomentTypeSchema = z.enum(CANDIDATE_MOMENT_TYPES);
export type CandidateMomentType = z.infer<typeof CandidateMomentTypeSchema>;

export const CANDIDATE_MOMENT_IMPORTANCE_LEVELS = ["low", "medium", "high", "critical"] as const;
export const CandidateMomentImportanceSchema = z.enum(CANDIDATE_MOMENT_IMPORTANCE_LEVELS);
export type CandidateMomentImportance = z.infer<typeof CandidateMomentImportanceSchema>;

export const CANDIDATE_DECISION_OPTIONS = ["confirm", "revise", "uncertain"] as const;
export const CANDIDATE_RISK_OPTIONS = ["acknowledge", "mitigate", "dismiss"] as const;

const dangerousUriPattern = /(?:javascript|vbscript|data)\s*:/iu;
const ordinaryUrlPattern = /(?:https?|ftp|file)\s*:/iu;
const mailtoPattern = /mailto\s*:/iu;

function containsDisallowedControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (
      codePoint <= 0x08 ||
      (codePoint >= 0x0b && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }
  return length;
}

function plainTextSchema(options: Readonly<{ maxCodePoints: number; maxBytes: number }>) {
  return z.string().superRefine((value, context) => {
    if (value.trim().length === 0) {
      context.addIssue({ code: "custom", message: "Candidate text cannot be blank." });
    }
    if (containsLoneSurrogate(value)) {
      context.addIssue({ code: "custom", message: "Candidate text must contain valid Unicode." });
    }
    if (value.normalize("NFC") !== value) {
      context.addIssue({ code: "custom", message: "Candidate text must be NFC-normalized." });
    }
    if (containsDisallowedControl(value)) {
      context.addIssue({ code: "custom", message: "Candidate text contains a control character." });
    }
    if (value.includes("<") || value.includes(">")) {
      context.addIssue({
        code: "custom",
        message: "Candidate text contains raw markup delimiters.",
      });
    }
    if (
      dangerousUriPattern.test(value) ||
      ordinaryUrlPattern.test(value) ||
      mailtoPattern.test(value)
    ) {
      context.addIssue({ code: "custom", message: "Candidate text contains a URI." });
    }
    if ([...value].length > options.maxCodePoints) {
      context.addIssue({ code: "custom", message: "Candidate text exceeds its code-point limit." });
    }
    if (utf8ByteLength(value) > options.maxBytes) {
      context.addIssue({ code: "custom", message: "Candidate text exceeds its UTF-8 byte limit." });
    }
  });
}

export const CandidateMomentTitleSchema = plainTextSchema({
  maxCodePoints: CANDIDATE_MOMENT_TITLE_MAX_CODE_POINTS,
  maxBytes: CANDIDATE_MOMENT_TITLE_MAX_BYTES,
});
export const CandidateMomentClaimSchema = plainTextSchema({
  maxCodePoints: CANDIDATE_MOMENT_CLAIM_MAX_CODE_POINTS,
  maxBytes: CANDIDATE_MOMENT_CLAIM_MAX_BYTES,
});
export const CandidateMomentInteractionTextSchema = plainTextSchema({
  maxCodePoints: CANDIDATE_MOMENT_INTERACTION_TEXT_MAX_CODE_POINTS,
  maxBytes: CANDIDATE_MOMENT_INTERACTION_TEXT_MAX_BYTES,
});
export const CandidateMomentChoiceLabelSchema = plainTextSchema({
  maxCodePoints: CANDIDATE_MOMENT_CHOICE_LABEL_MAX_CODE_POINTS,
  maxBytes: CANDIDATE_MOMENT_CHOICE_LABEL_MAX_BYTES,
});

export const CandidateMomentChoiceIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
export type CandidateMomentChoiceId = z.infer<typeof CandidateMomentChoiceIdSchema>;

export const CandidateMomentChoiceV1Schema = z.strictObject({
  id: CandidateMomentChoiceIdSchema,
  label: CandidateMomentChoiceLabelSchema,
});
export type CandidateMomentChoiceV1 = z.infer<typeof CandidateMomentChoiceV1Schema>;

export const CandidateChangeInteractionV1Schema = z.strictObject({
  kind: z.literal("acknowledge"),
});
export type CandidateChangeInteractionV1 = z.infer<typeof CandidateChangeInteractionV1Schema>;

export const CandidateDecisionInteractionV1Schema = z.strictObject({
  kind: z.literal("decision_response"),
  prompt: CandidateMomentInteractionTextSchema,
  options: z.tuple([
    z.literal(CANDIDATE_DECISION_OPTIONS[0]),
    z.literal(CANDIDATE_DECISION_OPTIONS[1]),
    z.literal(CANDIDATE_DECISION_OPTIONS[2]),
  ]),
});
export type CandidateDecisionInteractionV1 = z.infer<typeof CandidateDecisionInteractionV1Schema>;

export const CandidateRiskInteractionV1Schema = z.strictObject({
  kind: z.literal("risk_response"),
  prompt: CandidateMomentInteractionTextSchema,
  options: z.tuple([
    z.literal(CANDIDATE_RISK_OPTIONS[0]),
    z.literal(CANDIDATE_RISK_OPTIONS[1]),
    z.literal(CANDIDATE_RISK_OPTIONS[2]),
  ]),
});
export type CandidateRiskInteractionV1 = z.infer<typeof CandidateRiskInteractionV1Schema>;

export const CandidateCheckInteractionV1Schema = z
  .strictObject({
    kind: z.literal("check_answer"),
    question: CandidateMomentInteractionTextSchema,
    choices: z.array(CandidateMomentChoiceV1Schema).min(2).max(5),
  })
  .superRefine((value, context) => {
    const choiceIds = value.choices.map((choice) => choice.id);
    if (new Set(choiceIds).size !== choiceIds.length) {
      context.addIssue({ code: "custom", message: "Check choice IDs must be unique." });
    }
  });
export type CandidateCheckInteractionV1 = z.infer<typeof CandidateCheckInteractionV1Schema>;

const sharedCandidateShape = {
  title: CandidateMomentTitleSchema,
  claim: CandidateMomentClaimSchema,
  importance: CandidateMomentImportanceSchema,
  confidenceBasisPoints: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .refine((value) => !Object.is(value, -0), "Confidence cannot be negative zero."),
  evidenceIds: z
    .array(EvidenceIdSchema)
    .min(1)
    .max(CANDIDATE_MOMENT_MAX_EVIDENCE_IDS)
    .superRefine((value, context) => {
      if (new Set(value).size !== value.length) {
        context.addIssue({ code: "custom", message: "Candidate Evidence IDs must be unique." });
      }
    }),
} as const;

export const ChangeCandidateMomentV1Schema = z.strictObject({
  type: z.literal("change"),
  ...sharedCandidateShape,
  suggestedInteraction: CandidateChangeInteractionV1Schema,
});
export const DecisionCandidateMomentV1Schema = z.strictObject({
  type: z.literal("decision"),
  ...sharedCandidateShape,
  suggestedInteraction: CandidateDecisionInteractionV1Schema,
});
export const RiskCandidateMomentV1Schema = z.strictObject({
  type: z.literal("risk"),
  ...sharedCandidateShape,
  suggestedInteraction: CandidateRiskInteractionV1Schema,
});
export const CheckCandidateMomentV1Schema = z.strictObject({
  type: z.literal("check"),
  ...sharedCandidateShape,
  suggestedInteraction: CandidateCheckInteractionV1Schema,
});

export const CandidateMomentV1Schema = z.discriminatedUnion("type", [
  ChangeCandidateMomentV1Schema,
  DecisionCandidateMomentV1Schema,
  RiskCandidateMomentV1Schema,
  CheckCandidateMomentV1Schema,
]);
type MutableCandidateMomentV1 = z.infer<typeof CandidateMomentV1Schema>;

export const CandidateMomentBatchV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
    candidates: z.array(CandidateMomentV1Schema).max(CANDIDATE_MOMENT_MAX_BATCH_CANDIDATES),
  })
  .superRefine((value, context) => {
    if (utf8ByteLength(JSON.stringify(value)) > CANDIDATE_MOMENT_MAX_BATCH_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Candidate batch exceeds its UTF-8 byte limit.",
      });
    }
  });
type MutableCandidateMomentBatchV1 = z.infer<typeof CandidateMomentBatchV1Schema>;

type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

export type CandidateMomentV1 = DeepReadonly<MutableCandidateMomentV1>;
export type CandidateMomentBatchV1 = DeepReadonly<MutableCandidateMomentBatchV1>;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function parseCandidateMomentV1(input: unknown): CandidateMomentV1 {
  return deepFreeze(CandidateMomentV1Schema.parse(input));
}

export function parseCandidateMomentBatchV1(input: unknown): CandidateMomentBatchV1 {
  return deepFreeze(CandidateMomentBatchV1Schema.parse(input));
}
