import { z } from "zod";

import { JsonObjectSchema } from "./json-value.js";
import { SemVerSchema } from "./version.js";

const nonEmptyStringSchema = z.string().min(1);
const timestampSchema = z.iso.datetime({ offset: true });

export const NORMALIZED_EVENT_SCHEMA_VERSION = 1 as const;

export const NORMALIZED_EVENT_SOURCES = ["claude_code", "ownloop"] as const;
export const NormalizedEventSourceSchema = z.enum(NORMALIZED_EVENT_SOURCES);
export type NormalizedEventSource = z.infer<typeof NormalizedEventSourceSchema>;

export const EVENT_SENSITIVITIES = ["public", "normal", "sensitive", "secret"] as const;
export const EventSensitivitySchema = z.enum(EVENT_SENSITIVITIES);
export type EventSensitivity = z.infer<typeof EventSensitivitySchema>;

export const NORMALIZED_EVENT_TYPES = [
  "conversation.started",
  "conversation.resumed",
  "conversation.ended",
  "run.started",
  "run.stop_observed",
  "run.stop_failed",
  "run.finalization_started",
  "run.completed",
  "run.partial",
  "run.abandoned",
  "run.failed",
  "user.prompt_submitted",
  "agent.plan_observed",
  "agent.summary_observed",
  "tool.requested",
  "tool.succeeded",
  "tool.failed",
  "tool.batch_completed",
  "file.read_observed",
  "file.write_requested",
  "file.created",
  "file.modified",
  "file.deleted",
  "file.change_observed",
  "command.started",
  "command.completed",
  "command.failed",
  "test.observed",
  "build.observed",
  "lint.observed",
  "typecheck.observed",
  "snapshot.baseline_captured",
  "snapshot.final_captured",
  "git.diff_computed",
  "git.commit_observed",
  "evidence.gap_detected",
  "event.duplicate_ignored",
  "event.source_unrecognized",
  "redaction.applied",
] as const;

export const NormalizedEventTypeSchema = z.enum(NORMALIZED_EVENT_TYPES);
export type NormalizedEventType = z.infer<typeof NormalizedEventTypeSchema>;

export const NormalizedEventMetadataSchema = z.strictObject({
  collectorVersion: SemVerSchema,
  sourceVersion: nonEmptyStringSchema.nullish(),
});
export type NormalizedEventMetadata = z.infer<typeof NormalizedEventMetadataSchema>;

export const NormalizedEventEnvelopeSchema = z
  .strictObject({
    eventId: nonEmptyStringSchema,
    schemaVersion: z.literal(NORMALIZED_EVENT_SCHEMA_VERSION),
    workspaceId: nonEmptyStringSchema,
    conversationId: nonEmptyStringSchema,
    runId: nonEmptyStringSchema.nullable(),
    sequence: z.number().int().positive().nullable(),
    type: NormalizedEventTypeSchema,
    source: NormalizedEventSourceSchema,
    sourceEventName: nonEmptyStringSchema.nullable(),
    sourceEventId: nonEmptyStringSchema.nullable(),
    occurredAt: timestampSchema,
    ingestedAt: timestampSchema,
    sensitivity: EventSensitivitySchema,
    payload: JsonObjectSchema,
    metadata: NormalizedEventMetadataSchema,
  })
  .superRefine((event, context) => {
    const hasRunId = event.runId !== null;
    const hasSequence = event.sequence !== null;

    if (hasRunId !== hasSequence) {
      context.addIssue({
        code: "custom",
        path: hasRunId ? ["sequence"] : ["runId"],
        message: "runId and sequence must either both be non-null or both be null.",
      });
    }
  });
export type NormalizedEventEnvelope = z.infer<typeof NormalizedEventEnvelopeSchema>;
