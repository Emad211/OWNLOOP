import { randomUUID } from "node:crypto";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  NormalizedEventEnvelopeSchema,
  type NormalizedEventEnvelope,
  type NormalizedEventType,
  type JsonObject,
} from "@ownloop/event-model";
import { parseCanonicalJson } from "@ownloop/ingress-security";

import {
  type EventNormalizationDiagnosticCode,
  type LifecycleResolutionAction,
  type OwnLoopPersistence,
  type PersistenceRepositories,
  PersistenceError,
  type PreparedIngressReceiptRecord,
  type ReceiptEventNormalization,
  type ReceiptLifecycleResolution,
} from "../persistence/index.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_BATCH = 100;

export type EventNormalizationDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  clock?: () => Date;
  eventIdGenerator?: () => string;
}>;

class ExpectedNormalizationFailure extends Error {
  readonly diagnosticCode: EventNormalizationDiagnosticCode;

  constructor(diagnosticCode: EventNormalizationDiagnosticCode) {
    super("A controlled Event normalization invariant rejected the receipt.");
    this.name = "ExpectedNormalizationFailure";
    this.diagnosticCode = diagnosticCode;
  }
}

function canonicalTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ExpectedNormalizationFailure("invalid_redacted_payload");
  }
  return date.toISOString();
}

function safeEventId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PersistenceError("operation_failed", "The Event ID generator returned an unsafe ID.");
  }
  return value;
}

function parsePayload(receipt: PreparedIngressReceiptRecord): JsonObject {
  let parsed: unknown;
  try {
    parsed = parseCanonicalJson(receipt.redactedPayloadJson);
  } catch {
    throw new ExpectedNormalizationFailure("invalid_redacted_payload");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ExpectedNormalizationFailure("invalid_redacted_payload");
  }
  return parsed as JsonObject;
}

function requirePayloadField(
  payload: JsonObject,
  key: string,
  kind: "string" | "boolean" | "array" | "present",
): void {
  const value = payload[key];
  const valid =
    kind === "present"
      ? value !== undefined
      : kind === "array"
        ? Array.isArray(value)
        : typeof value === kind;
  if (!valid) {
    throw new ExpectedNormalizationFailure("invalid_redacted_payload");
  }
}

function validateSourcePayload(receipt: PreparedIngressReceiptRecord, payload: JsonObject): void {
  switch (receipt.sourceEventName) {
    case "SessionStart":
      requirePayloadField(payload, "source", "string");
      break;
    case "UserPromptSubmit":
      requirePayloadField(payload, "prompt", "string");
      break;
    case "PreToolUse":
      requirePayloadField(payload, "tool_name", "string");
      requirePayloadField(payload, "tool_input", "present");
      break;
    case "PostToolUse":
      requirePayloadField(payload, "tool_name", "string");
      requirePayloadField(payload, "tool_input", "present");
      requirePayloadField(payload, "tool_response", "present");
      break;
    case "PostToolUseFailure":
      requirePayloadField(payload, "tool_name", "string");
      requirePayloadField(payload, "tool_input", "present");
      requirePayloadField(payload, "error", "string");
      break;
    case "PostToolBatch":
      requirePayloadField(payload, "tool_calls", "array");
      break;
    case "Stop":
      requirePayloadField(payload, "stop_hook_active", "boolean");
      requirePayloadField(payload, "last_assistant_message", "string");
      break;
    case "StopFailure":
      requirePayloadField(payload, "error", "string");
      break;
    case "SessionEnd":
      requirePayloadField(payload, "reason", "string");
      break;
  }
}

type EventSpecification = Readonly<{
  type: NormalizedEventType;
  source: "claude_code" | "ownloop";
  payload: JsonObject;
  sensitivity: "normal" | "sensitive";
  sourceFields: boolean;
}>;

function syntheticPayload(
  triggerHook: string,
  lifecycleAction: LifecycleResolutionAction,
  runNumber?: number,
): JsonObject {
  return {
    triggerHook,
    lifecycleAction,
    ...(runNumber === undefined ? {} : { runNumber }),
  };
}

function requireRun(resolution: ReceiptLifecycleResolution): string {
  if (resolution.runId === null) {
    throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }
  return resolution.runId;
}

function sourceSpec(
  type: NormalizedEventType,
  payload: JsonObject,
  sensitivity: "normal" | "sensitive",
): EventSpecification {
  return { type, source: "claude_code", payload, sensitivity, sourceFields: true };
}

function ownLoopSpec(type: NormalizedEventType, payload: JsonObject): EventSpecification {
  return { type, source: "ownloop", payload, sensitivity: "normal", sourceFields: false };
}

function buildSpecifications(
  persistence: OwnLoopPersistence,
  receipt: PreparedIngressReceiptRecord,
  resolution: ReceiptLifecycleResolution,
  payload: JsonObject,
): readonly EventSpecification[] {
  switch (receipt.sourceEventName) {
    case "SessionStart": {
      if (resolution.runId !== null) {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      if (resolution.action === "conversation_started") {
        return [sourceSpec("conversation.started", payload, "normal")];
      }
      if (resolution.action === "conversation_resumed") {
        return [sourceSpec("conversation.resumed", payload, "normal")];
      }
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
    }
    case "UserPromptSubmit": {
      const runId = requireRun(resolution);
      if (resolution.action !== "run_started") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      const run = persistence.taskRuns.get(runId);
      if (run === null || run.conversationId !== resolution.conversationId) {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [
        ownLoopSpec(
          "run.started",
          syntheticPayload(receipt.sourceEventName, resolution.action, run.runNumber),
        ),
        sourceSpec("user.prompt_submitted", payload, "sensitive"),
      ];
    }
    case "PreToolUse":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec("tool.requested", payload, "sensitive")];
    case "PostToolUse":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec("tool.succeeded", payload, "sensitive")];
    case "PostToolUseFailure":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec("tool.failed", payload, "sensitive")];
    case "PostToolBatch":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec("tool.batch_completed", payload, "sensitive")];
    case "Stop":
      requireRun(resolution);
      if (resolution.action !== "run_finalizing") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [
        sourceSpec("run.stop_observed", payload, "sensitive"),
        ownLoopSpec(
          "run.finalization_started",
          syntheticPayload(receipt.sourceEventName, resolution.action),
        ),
      ];
    case "StopFailure":
      requireRun(resolution);
      if (resolution.action !== "run_finalizing") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [
        sourceSpec("run.stop_failed", payload, "sensitive"),
        ownLoopSpec(
          "run.finalization_started",
          syntheticPayload(receipt.sourceEventName, resolution.action),
        ),
      ];
    case "SessionEnd":
      if (resolution.runId !== null || resolution.action !== "conversation_ended") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec("conversation.ended", payload, "normal")];
    default:
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }
}

function eventDeduplicationKey(
  receipt: PreparedIngressReceiptRecord,
  eventIndex: number,
  eventType: NormalizedEventType,
): string {
  return `v1:${receipt.deduplicationKey}:event:${eventIndex}:${eventType}`;
}

function failedNormalization(
  receiptId: string,
  normalizedAt: string,
  diagnosticCode: EventNormalizationDiagnosticCode,
): ReceiptEventNormalization {
  return {
    receiptId,
    outcome: "failed",
    eventCount: 0,
    diagnosticCode,
    normalizedAt,
    eventIds: [],
  };
}

function skippedNormalization(receiptId: string, normalizedAt: string): ReceiptEventNormalization {
  return {
    receiptId,
    outcome: "skipped",
    eventCount: 0,
    diagnosticCode: "lifecycle_failed",
    normalizedAt,
    eventIds: [],
  };
}

function insertZeroEventNormalization(
  persistence: PersistenceRepositories,
  normalization: ReceiptEventNormalization,
): ReceiptEventNormalization {
  persistence.eventNormalizations.insert(normalization);
  return normalization;
}

function normalizeInsideTransaction(
  dependencies: EventNormalizationDependencies,
  receiptId: string,
  normalizedAt: string,
): ReceiptEventNormalization | null {
  const { persistence } = dependencies;
  const existing = persistence.eventNormalizations.get(receiptId);
  if (existing !== null) {
    return existing;
  }

  const resolution = persistence.lifecycleResolutions.get(receiptId);
  if (resolution === null) {
    return null;
  }
  if (resolution.outcome === "failed") {
    return insertZeroEventNormalization(persistence, skippedNormalization(receiptId, normalizedAt));
  }
  if (
    resolution.workspaceId === null ||
    resolution.conversationId === null ||
    (resolution.action.startsWith("run_") && resolution.runId === null)
  ) {
    throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }

  const receipt = persistence.ingressReceipts.get(receiptId);
  if (receipt === null) {
    throw new ExpectedNormalizationFailure("missing_lifecycle_resolution");
  }
  if (receipt.preparationStatus !== "prepared") {
    throw new ExpectedNormalizationFailure("legacy_receipt_unsupported");
  }

  const payload = parsePayload(receipt);
  validateSourcePayload(receipt, payload);
  const specs = buildSpecifications(persistence, receipt, resolution, payload);
  if (specs.length === 0) {
    throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }

  const occurredAt = canonicalTimestamp(receipt.receivedAt);
  const ingestedAt = canonicalTimestamp(receipt.createdAt);
  const firstSequence =
    resolution.runId === null ? null : persistence.events.nextSequence(resolution.runId);
  const eventIds: string[] = [];

  for (let eventIndex = 0; eventIndex < specs.length; eventIndex += 1) {
    const spec = specs[eventIndex];
    if (spec === undefined) {
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
    }
    const eventId = safeEventId(dependencies.eventIdGenerator ?? randomUUID);
    const event: NormalizedEventEnvelope = NormalizedEventEnvelopeSchema.parse({
      eventId,
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      workspaceId: resolution.workspaceId,
      conversationId: resolution.conversationId,
      runId: resolution.runId,
      sequence: firstSequence === null ? null : firstSequence + eventIndex,
      type: spec.type,
      source: spec.source,
      sourceEventName: spec.sourceFields ? receipt.sourceEventName : null,
      sourceEventId: spec.sourceFields ? receipt.sourceEventId : null,
      occurredAt,
      ingestedAt,
      sensitivity: spec.sensitivity,
      payload: spec.payload,
      metadata: {
        collectorVersion: receipt.adapterVersion,
        sourceVersion: null,
      },
    });
    persistence.events.append(event);
    persistence.events.recordDeduplicationKey({
      source: spec.source,
      sourceSessionId: receipt.sourceSessionId,
      deduplicationKey: eventDeduplicationKey(receipt, eventIndex, spec.type),
      eventId,
      createdAt: normalizedAt,
    });
    eventIds.push(eventId);
  }

  const normalization: ReceiptEventNormalization = {
    receiptId,
    outcome: "normalized",
    eventCount: eventIds.length,
    diagnosticCode: null,
    normalizedAt,
    eventIds,
  };
  persistence.eventNormalizations.insert(normalization);
  for (let eventIndex = 0; eventIndex < eventIds.length; eventIndex += 1) {
    const eventId = eventIds[eventIndex];
    if (eventId === undefined) {
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
    }
    persistence.eventNormalizations.linkEvent(receiptId, eventIndex, eventId);
  }
  return normalization;
}

function recordExpectedFailure(
  dependencies: EventNormalizationDependencies,
  receiptId: string,
  normalizedAt: string,
  diagnosticCode: EventNormalizationDiagnosticCode,
): ReceiptEventNormalization | null {
  return dependencies.persistence.withTransaction((persistence) => {
    const existing = persistence.eventNormalizations.get(receiptId);
    if (existing !== null) {
      return existing;
    }
    if (persistence.lifecycleResolutions.get(receiptId) === null) {
      return null;
    }
    return insertZeroEventNormalization(
      persistence,
      failedNormalization(receiptId, normalizedAt, diagnosticCode),
    );
  });
}

export function processEventNormalization(
  dependencies: EventNormalizationDependencies,
  receiptId: string,
): ReceiptEventNormalization | null {
  const normalizedAt = canonicalTimestamp((dependencies.clock ?? (() => new Date()))());
  try {
    return dependencies.persistence.withTransaction(() =>
      normalizeInsideTransaction(dependencies, receiptId, normalizedAt),
    );
  } catch (error) {
    const diagnosticCode =
      error instanceof ExpectedNormalizationFailure
        ? error.diagnosticCode
        : "normalization_processing_failed";
    try {
      return recordExpectedFailure(dependencies, receiptId, normalizedAt, diagnosticCode);
    } catch {
      throw new PersistenceError("operation_failed", "Event normalization failed safely.");
    }
  }
}

export function processPendingEventNormalizations(
  dependencies: EventNormalizationDependencies,
  limit = MAX_BATCH,
): ReceiptEventNormalization[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
    return [];
  }
  const receiptIds = dependencies.persistence.eventNormalizations.listEligibleReceiptIds(limit);
  const results: ReceiptEventNormalization[] = [];
  for (const receiptId of receiptIds) {
    const result = processEventNormalization(dependencies, receiptId);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
