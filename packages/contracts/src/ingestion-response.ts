import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);
const safeIssuePathSegmentSchema = z.union([
  z.string().regex(/^(?:\$field|[A-Za-z_][A-Za-z0-9_.-]{0,63})$/),
  z.number().int().nonnegative(),
]);

export const INGESTION_ERROR_CODES = [
  "unauthorized",
  "invalid_payload",
  "unsupported_hook",
  "payload_too_large",
  "unsupported_media_type",
  "deduplication_conflict",
  "persistence_failed",
  "internal_error",
] as const;
export const IngestionErrorCodeSchema = z.enum(INGESTION_ERROR_CODES);
export type IngestionErrorCode = z.infer<typeof IngestionErrorCodeSchema>;

export const ValidationIssuePathSegmentSchema = safeIssuePathSegmentSchema;
export type ValidationIssuePathSegment = z.infer<typeof ValidationIssuePathSegmentSchema>;

export const ValidationIssueSummarySchema = z.strictObject({
  path: z.array(ValidationIssuePathSegmentSchema).max(32),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  message: z.string().min(1).max(256),
});
export type ValidationIssueSummary = z.infer<typeof ValidationIssueSummarySchema>;

export const IngestionAcceptedResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal("accepted"),
  receiptId: nonEmptyStringSchema.max(128),
  duplicate: z.boolean(),
});
export type IngestionAcceptedResponse = z.infer<typeof IngestionAcceptedResponseSchema>;

export const IngestionRejectedResponseSchema = z.strictObject({
  ok: z.literal(false),
  status: z.literal("rejected"),
  error: z.strictObject({
    code: IngestionErrorCodeSchema,
    message: z.string().min(1).max(256),
    issues: z.array(ValidationIssueSummarySchema).max(16).optional(),
  }),
});
export type IngestionRejectedResponse = z.infer<typeof IngestionRejectedResponseSchema>;

export const IngestionResponseSchema = z.discriminatedUnion("ok", [
  IngestionAcceptedResponseSchema,
  IngestionRejectedResponseSchema,
]);
export type IngestionResponse = z.infer<typeof IngestionResponseSchema>;
