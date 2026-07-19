import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);

export const INGESTION_ERROR_CODES = [
  "invalid_payload",
  "unsupported_hook",
  "persistence_failed",
  "internal_error",
] as const;
export const IngestionErrorCodeSchema = z.enum(INGESTION_ERROR_CODES);
export type IngestionErrorCode = z.infer<typeof IngestionErrorCodeSchema>;

export const ValidationIssuePathSegmentSchema = z.union([z.string(), z.number()]);
export type ValidationIssuePathSegment = z.infer<typeof ValidationIssuePathSegmentSchema>;

export const ValidationIssueSummarySchema = z.strictObject({
  path: z.array(ValidationIssuePathSegmentSchema),
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
});
export type ValidationIssueSummary = z.infer<typeof ValidationIssueSummarySchema>;

export const IngestionAcceptedResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal("accepted"),
  receiptId: nonEmptyStringSchema,
  duplicate: z.boolean(),
});
export type IngestionAcceptedResponse = z.infer<typeof IngestionAcceptedResponseSchema>;

export const IngestionRejectedResponseSchema = z.strictObject({
  ok: z.literal(false),
  status: z.literal("rejected"),
  error: z.strictObject({
    code: IngestionErrorCodeSchema,
    message: nonEmptyStringSchema,
    issues: z.array(ValidationIssueSummarySchema).optional(),
  }),
});
export type IngestionRejectedResponse = z.infer<typeof IngestionRejectedResponseSchema>;

export const IngestionResponseSchema = z.discriminatedUnion("ok", [
  IngestionAcceptedResponseSchema,
  IngestionRejectedResponseSchema,
]);
export type IngestionResponse = z.infer<typeof IngestionResponseSchema>;
