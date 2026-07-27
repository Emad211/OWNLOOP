from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label} precondition failed: expected 1, found {count}")
    return text.replace(old, new)


migrations = Path("apps/daemon/src/persistence/migration-definitions.ts")
migration_text = migrations.read_text(encoding="utf-8")
migration_import = (
    'import { MULTI_AGENT_EVENT_TAXONOMY_SQL } '
    'from "./multi-agent-event-taxonomy-migration.js";\n\n'
)
if migration_text.startswith("import ") or migration_import in migration_text:
    raise SystemExit("migration import precondition failed")
migration_text = migration_import + migration_text
last_v19 = '''  Object.freeze({
    version: 19,
    name: "multi_agent_event_source",
    sql: MULTI_AGENT_EVENT_SOURCE_SQL,
    foreignKeyPolicy: "disable_during_table_rebuild",
  }),
'''
if migration_text.count(last_v19) != 1 or not migration_text.endswith("]);\n"):
    raise SystemExit("migration v19 tail precondition failed")
entry_v20 = '''  Object.freeze({
    version: 20,
    name: "provider_neutral_codex_event_taxonomy",
    sql: MULTI_AGENT_EVENT_TAXONOMY_SQL,
    foreignKeyPolicy: "disable_during_table_rebuild",
  }),
'''
closing = migration_text.rfind("]);")
if closing < 0:
    raise SystemExit("migration array closing marker missing")
migration_text = migration_text[:closing] + entry_v20 + migration_text[closing:]
migrations.write_text(migration_text, encoding="utf-8")

v19_test = Path("apps/daemon/src/persistence/migration-v19.test.ts")
v19_text = v19_test.read_text(encoding="utf-8")
v19_text = replace_once(
    v19_text,
    '''      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toHaveLength(19);
''',
    '''      runMigrations(opened.database, MIGRATIONS.slice(0, 19));

      expect(readAppliedMigrations(opened.database)).toHaveLength(19);
''',
    "isolated migration v19 test",
)
v19_test.write_text(v19_text, encoding="utf-8")

lifecycle = Path("apps/daemon/src/lifecycle/processor.ts")
lifecycle_text = lifecycle.read_text(encoding="utf-8")
projection_start = lifecycle_text.index("function projectLifecyclePayload(")
projection_end = lifecycle_text.index("\n\nfunction insertResolution", projection_start)
new_projection = '''function projectLifecyclePayload(
  receipt: PreparedIngressReceiptRecord,
): LifecycleProjection {
  let parsed: JsonValue;
  try {
    parsed = parseCanonicalJson(receipt.redactedPayloadJson);
  } catch {
    throw new ExpectedLifecycleFailure("invalid_redacted_payload");
  }
  const record = asObject(parsed);

  if (receipt.source === "codex") {
    switch (receipt.sourceEventName) {
      case "SessionStart":
        return { startMode: requiredString(record, "source"), prompt: null, stopReason: null };
      case "UserPromptSubmit":
        return { startMode: null, prompt: requiredString(record, "prompt"), stopReason: null };
      case "SessionEnd":
        requiredString(record, "reason");
        return { startMode: null, prompt: null, stopReason: null };
      case "PreToolUse":
      case "PermissionRequest":
      case "PostToolUse":
      case "PreCompact":
      case "PostCompact":
      case "SubagentStart":
      case "SubagentStop":
      case "Stop":
        return { startMode: null, prompt: null, stopReason: null };
      default:
        throw new ExpectedLifecycleFailure("invalid_transition");
    }
  }

  if (receipt.source !== "claude_code") {
    throw new ExpectedLifecycleFailure("invalid_transition");
  }
  switch (receipt.sourceEventName) {
    case "SessionStart":
      return { startMode: requiredString(record, "source"), prompt: null, stopReason: null };
    case "UserPromptSubmit":
      return { startMode: null, prompt: requiredString(record, "prompt"), stopReason: null };
    case "StopFailure":
      return { startMode: null, prompt: null, stopReason: requiredString(record, "error") };
    case "SessionEnd":
      requiredString(record, "reason");
      return { startMode: null, prompt: null, stopReason: null };
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch":
    case "Stop":
      return { startMode: null, prompt: null, stopReason: null };
    default:
      throw new ExpectedLifecycleFailure("invalid_transition");
  }
}'''
lifecycle_text = lifecycle_text[:projection_start] + new_projection + lifecycle_text[projection_end:]
lifecycle_text = replace_once(
    lifecycle_text,
    '''    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch": {
''',
    '''    case "PreToolUse":
    case "PermissionRequest":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PostToolBatch":
    case "PreCompact":
    case "PostCompact":
    case "SubagentStart":
    case "SubagentStop": {
''',
    "Codex run association",
)
lifecycle.write_text(lifecycle_text, encoding="utf-8")

normalization = Path("apps/daemon/src/normalization/processor.ts")
normalization_text = normalization.read_text(encoding="utf-8")
normalization_text = replace_once(
    normalization_text,
    '''  type NormalizedEventEnvelope,
  type NormalizedEventType,
  type JsonObject,
''',
    '''  type NormalizedEventEnvelope,
  type NormalizedEventSource,
  type NormalizedEventType,
  type JsonObject,
''',
    "normalized source type import",
)
normalization_text = replace_once(
    normalization_text,
    '''  return parsed as JsonObject;
}

function requirePayloadField(
''',
    '''  return parsed as JsonObject;
}

function sourceVersionFromPayload(payload: JsonObject): string | null {
  const value = payload.source_version;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requirePayloadField(
''',
    "source version helper",
)
validation_start = normalization_text.index("function validateSourcePayload(")
validation_end = normalization_text.index("\n\ntype EventSpecification", validation_start)
new_validation = '''function requireCodexTurnMetadata(
  payload: JsonObject,
  requirePermissionMode: boolean,
): void {
  requirePayloadField(payload, "turn_id", "string");
  requirePayloadField(payload, "model", "string");
  if (requirePermissionMode) {
    requirePayloadField(payload, "permission_mode", "string");
  }
}

function validateSourcePayload(
  receipt: PreparedIngressReceiptRecord,
  payload: JsonObject,
): void {
  if (receipt.source === "codex") {
    switch (receipt.sourceEventName) {
      case "SessionStart":
        requirePayloadField(payload, "source", "string");
        requirePayloadField(payload, "model", "string");
        requirePayloadField(payload, "permission_mode", "string");
        return;
      case "UserPromptSubmit":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "prompt", "string");
        return;
      case "PreToolUse":
      case "PermissionRequest":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "tool_name", "string");
        requirePayloadField(payload, "tool_input", "present");
        return;
      case "PostToolUse":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "tool_name", "string");
        requirePayloadField(payload, "tool_input", "present");
        requirePayloadField(payload, "tool_response", "present");
        return;
      case "PreCompact":
      case "PostCompact":
        requireCodexTurnMetadata(payload, false);
        requirePayloadField(payload, "trigger", "string");
        return;
      case "SubagentStart":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "agent_id", "string");
        requirePayloadField(payload, "agent_type", "string");
        return;
      case "SubagentStop":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "agent_id", "string");
        requirePayloadField(payload, "agent_type", "string");
        requirePayloadField(payload, "stop_hook_active", "boolean");
        requirePayloadField(payload, "last_assistant_message", "present");
        return;
      case "Stop":
        requireCodexTurnMetadata(payload, true);
        requirePayloadField(payload, "stop_hook_active", "boolean");
        requirePayloadField(payload, "last_assistant_message", "present");
        return;
      case "SessionEnd":
        requirePayloadField(payload, "reason", "string");
        return;
      default:
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
    }
  }

  if (receipt.source !== "claude_code") {
    throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }
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
    default:
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }
}'''
normalization_text = (
    normalization_text[:validation_start]
    + new_validation
    + normalization_text[validation_end:]
)
normalization_text = replace_once(
    normalization_text,
    '  source: "claude_code" | "ownloop";\n',
    '  source: NormalizedEventSource;\n',
    "Event specification source",
)
source_spec_start = normalization_text.index("function sourceSpec(")
source_spec_end = normalization_text.index("\n\nfunction ownLoopSpec", source_spec_start)
new_source_spec = '''function sourceSpec(
  source: Exclude<NormalizedEventSource, "ownloop">,
  type: NormalizedEventType,
  payload: JsonObject,
  sensitivity: "normal" | "sensitive",
): EventSpecification {
  return { type, source, payload, sensitivity, sourceFields: true };
}'''
normalization_text = (
    normalization_text[:source_spec_start]
    + new_source_spec
    + normalization_text[source_spec_end:]
)
build_start = normalization_text.index("function buildSpecifications(")
build_end = normalization_text.index("\n\nfunction eventDeduplicationKey", build_start)
new_build = '''function buildSpecifications(
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
        return [sourceSpec(receipt.source, "conversation.started", payload, "normal")];
      }
      if (resolution.action === "conversation_resumed") {
        return [sourceSpec(receipt.source, "conversation.resumed", payload, "normal")];
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
        sourceSpec(receipt.source, "user.prompt_submitted", payload, "sensitive"),
      ];
    }
    case "PreToolUse":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "tool.requested", payload, "sensitive")];
    case "PermissionRequest":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "permission.requested", payload, "sensitive")];
    case "PostToolUse":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "tool.succeeded", payload, "sensitive")];
    case "PostToolUseFailure":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "tool.failed", payload, "sensitive")];
    case "PostToolBatch":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "tool.batch_completed", payload, "sensitive")];
    case "PreCompact":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "context.compaction_started", payload, "normal")];
    case "PostCompact":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "context.compaction_completed", payload, "normal")];
    case "SubagentStart":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "agent.subagent_started", payload, "normal")];
    case "SubagentStop":
      requireRun(resolution);
      if (resolution.action !== "run_associated") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "agent.subagent_stopped", payload, "sensitive")];
    case "Stop":
      requireRun(resolution);
      if (resolution.action !== "run_finalizing") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [
        sourceSpec(receipt.source, "run.stop_observed", payload, "sensitive"),
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
        sourceSpec(receipt.source, "run.stop_failed", payload, "sensitive"),
        ownLoopSpec(
          "run.finalization_started",
          syntheticPayload(receipt.sourceEventName, resolution.action),
        ),
      ];
    case "SessionEnd":
      if (resolution.runId !== null || resolution.action !== "conversation_ended") {
        throw new ExpectedNormalizationFailure("invalid_event_mapping");
      }
      return [sourceSpec(receipt.source, "conversation.ended", payload, "normal")];
    default:
      throw new ExpectedNormalizationFailure("invalid_event_mapping");
  }
}'''
normalization_text = (
    normalization_text[:build_start]
    + new_build
    + normalization_text[build_end:]
)
normalization_text = replace_once(
    normalization_text,
    '        sourceVersion: null,\n',
    '        sourceVersion: sourceVersionFromPayload(payload),\n',
    "Event source version metadata",
)
normalization.write_text(normalization_text, encoding="utf-8")

codex_test = Path("apps/daemon/src/normalization/codex-normalization.test.ts")
codex_test_text = codex_test.read_text(encoding="utf-8")
codex_test_text = replace_once(
    codex_test_text,
    'expect(runEvents.filter((event) => event.source === "codex")).toHaveLength(8);',
    'expect(runEvents.filter((event) => event.source === "codex")).toHaveLength(9);',
    "Codex source Event count",
)
codex_test.write_text(codex_test_text, encoding="utf-8")
