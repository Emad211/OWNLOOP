import { createHash } from "node:crypto";

import type {
  VerificationOutputField,
  VerificationReducedOutputV1,
  VerificationSourceToolOutcome,
} from "@ownloop/contracts";
import type { JsonObject, JsonValue, NormalizedEventEnvelope } from "@ownloop/event-model";

import { PersistenceError } from "../persistence/index.js";
import { MAX_ACCEPTED_COMMAND_CODE_POINTS } from "./constants.js";
import { recognizeVerificationCommand } from "./recognizer.js";
import { reduceVerificationOutput } from "./reducer.js";

const OUTPUT_FIELD_ORDER: readonly VerificationOutputField[] = [
  "stdout",
  "stderr",
  "output",
  "tool_response",
  "error",
];
const encoder = new TextEncoder();

export type AcceptedBashObservation = Readonly<{
  sourceEventId: string;
  occurredAt: string;
  sourceToolOutcome: VerificationSourceToolOutcome;
  commandFingerprint: string | null;
  recognition: ReturnType<typeof recognizeVerificationCommand>;
  exitCode: number | null;
  reducedOutputs: readonly VerificationReducedOutputV1[];
  partial: boolean;
}>;

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function integerExitCode(value: JsonValue | undefined): number | null | "invalid" {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value) ? value : "invalid";
}

function commandHash(command: string): string {
  return createHash("sha256").update(encoder.encode(command)).digest("hex");
}

function collectResponse(
  event: NormalizedEventEnvelope,
  sourceToolOutcome: VerificationSourceToolOutcome,
): Readonly<{
  exitCode: number | null;
  outputs: readonly VerificationReducedOutputV1[];
  partial: boolean;
}> {
  let partial = false;
  let exitCode: number | null = null;
  const outputs = new Map<VerificationOutputField, VerificationReducedOutputV1>();
  const response = event.payload.tool_response;

  if (typeof response === "string") {
    outputs.set("tool_response", reduceVerificationOutput("tool_response", response));
  } else {
    const responseObject = objectValue(response);
    if (responseObject === null) {
      if (response !== undefined && response !== null) partial = true;
      if (sourceToolOutcome === "succeeded") partial = true;
    } else {
      const camel = integerExitCode(responseObject.exitCode);
      const snake = integerExitCode(responseObject.exit_code);
      if (camel === "invalid" || snake === "invalid") {
        partial = true;
      } else if (camel !== null && snake !== null && camel !== snake) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The accepted tool response contains conflicting exit codes.",
        );
      } else {
        exitCode = camel ?? snake;
      }
      for (const field of ["stdout", "stderr", "output"] as const) {
        const value = responseObject[field];
        if (value === undefined || value === null) continue;
        if (typeof value !== "string") {
          partial = true;
          continue;
        }
        outputs.set(field, reduceVerificationOutput(field, value));
      }
    }
  }

  if (sourceToolOutcome === "failed") {
    const error = event.payload.error;
    if (typeof error !== "string") {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A failed source tool Event is missing its accepted error string.",
      );
    }
    outputs.set("error", reduceVerificationOutput("error", error));
  }

  if (
    (sourceToolOutcome === "succeeded" && exitCode !== null && exitCode !== 0) ||
    (sourceToolOutcome === "failed" && exitCode === 0)
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The source tool Event outcome conflicts with its explicit exit code.",
    );
  }

  return {
    exitCode,
    outputs: OUTPUT_FIELD_ORDER.flatMap((field) => {
      const output = outputs.get(field);
      return output === undefined ? [] : [output];
    }),
    partial,
  };
}

export function acceptedBashObservation(
  event: NormalizedEventEnvelope,
): AcceptedBashObservation | null {
  if (
    event.source !== "claude_code" ||
    (event.type !== "tool.succeeded" && event.type !== "tool.failed")
  ) {
    return null;
  }
  const expectedHook = event.type === "tool.succeeded" ? "PostToolUse" : "PostToolUseFailure";
  if (event.sourceEventName !== expectedHook) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The source tool Event hook linkage is inconsistent.",
    );
  }
  if (typeof event.payload.tool_name !== "string") {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The source tool Event is missing its controlled tool name.",
    );
  }
  if (event.payload.tool_name !== "Bash") {
    return null;
  }
  const toolInput = objectValue(event.payload.tool_input);
  if (toolInput === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The accepted Bash Event has invalid tool input.",
    );
  }
  const commandValue = toolInput.command;
  let partial = false;
  let command: string | null = null;
  let commandFingerprint: string | null = null;
  if (typeof commandValue === "string") {
    commandFingerprint = commandHash(commandValue);
    if (
      commandValue.trim().length > 0 &&
      Array.from(commandValue).length <= MAX_ACCEPTED_COMMAND_CODE_POINTS
    ) {
      command = commandValue;
    } else {
      partial = true;
    }
  } else {
    partial = true;
  }
  const sourceToolOutcome = event.type === "tool.succeeded" ? "succeeded" : "failed";
  const response = collectResponse(event, sourceToolOutcome);
  return {
    sourceEventId: event.eventId,
    occurredAt: event.occurredAt,
    sourceToolOutcome,
    commandFingerprint,
    recognition:
      command === null
        ? { kind: "unknown", ruleId: "unknown.unsupported_command", toolFamily: "unknown" }
        : recognizeVerificationCommand(command),
    exitCode: response.exitCode,
    reducedOutputs: response.outputs,
    partial: partial || response.partial,
  };
}
