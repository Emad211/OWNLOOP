from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# Event contract: completion is neutral until structured outcome evidence is read.
replace_exact(
    "packages/event-model/src/normalized-event.ts",
    '  "tool.requested",\n  "tool.succeeded",',
    '  "tool.requested",\n  "tool.completed",\n  "tool.succeeded",',
)
replace_exact(
    "packages/event-model/tests/normalized-event.test.ts",
    '  "tool.requested",\n  "tool.succeeded",',
    '  "tool.requested",\n  "tool.completed",\n  "tool.succeeded",',
)

# Immutable migration v21. Existing v19/v20 definitions remain unchanged.
replace_exact(
    "apps/daemon/src/persistence/migration-definitions.ts",
    'import { MULTI_AGENT_EVENT_TAXONOMY_SQL } from "./multi-agent-event-taxonomy-migration.js";\n',
    'import { MULTI_AGENT_EVENT_TAXONOMY_SQL } from "./multi-agent-event-taxonomy-migration.js";\n'
    'import { TOOL_COMPLETION_EVENT_TAXONOMY_SQL } from "./tool-completion-event-taxonomy-migration.js";\n',
)
migration_file = Path("apps/daemon/src/persistence/migration-definitions.ts")
migration_text = migration_file.read_text(encoding="utf-8")
v20 = '''  Object.freeze({
    version: 20,
    name: "provider_neutral_codex_event_taxonomy",
    sql: MULTI_AGENT_EVENT_TAXONOMY_SQL,
    foreignKeyPolicy: "disable_during_table_rebuild",
  }),
'''
if migration_text.count(v20) != 1 or not migration_text.endswith("]);\n"):
    raise SystemExit("migration v20 tail precondition failed")
v21 = '''  Object.freeze({
    version: 21,
    name: "neutral_tool_completion_event_taxonomy",
    sql: TOOL_COMPLETION_EVENT_TAXONOMY_SQL,
    foreignKeyPolicy: "disable_during_table_rebuild",
  }),
'''
closing = migration_text.rfind("]);")
migration_file.write_text(migration_text[:closing] + v21 + migration_text[closing:], encoding="utf-8")

# Keep v20 migration tests isolated after v21 exists.
replace_exact(
    "apps/daemon/src/persistence/migration-v20.test.ts",
    "      runMigrations(opened.database);",
    "      runMigrations(opened.database, MIGRATIONS.slice(0, 20));",
    expected=2,
)

# Codex PostToolUse means completion, not success. Claude semantics are unchanged.
replace_exact(
    "apps/daemon/src/normalization/processor.ts",
    '      return [sourceSpec(receipt.source, "tool.succeeded", payload, "sensitive")];',
    '''      return [
        sourceSpec(
          receipt.source,
          receipt.source === "codex" ? "tool.completed" : "tool.succeeded",
          payload,
          "sensitive",
        ),
      ];''',
)
replace_exact(
    "apps/daemon/src/normalization/codex-normalization.test.ts",
    '        "tool.succeeded",',
    '        "tool.completed",',
)

# Verification contract supports neutral completion while retaining strict Claude outcomes.
replace_exact(
    "packages/contracts/src/verification-evidence.ts",
    'export const VERIFICATION_SOURCE_TOOL_OUTCOMES = ["succeeded", "failed"] as const;',
    'export const VERIFICATION_SOURCE_TOOL_OUTCOMES = ["completed", "succeeded", "failed"] as const;',
)
replace_exact(
    "packages/contracts/src/verification-evidence.ts",
    '''    const exitConsistent =
      (value.sourceToolOutcome === "succeeded" &&
        (value.exitCode === null || value.exitCode === 0)) ||
      (value.sourceToolOutcome === "failed" && (value.exitCode === null || value.exitCode !== 0));''',
    '''    const exitConsistent =
      value.sourceToolOutcome === "completed" ||
      (value.sourceToolOutcome === "succeeded" &&
        (value.exitCode === null || value.exitCode === 0)) ||
      (value.sourceToolOutcome === "failed" && (value.exitCode === null || value.exitCode !== 0));''',
)
replace_exact(
    "packages/contracts/src/verification-evidence.ts",
    '''      const expectedStatus =
        value.sourceToolOutcome === "failed"
          ? "failed"
          : value.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";''',
    '''      const expectedStatus =
        value.sourceToolOutcome === "failed" ||
        (value.sourceToolOutcome === "completed" &&
          value.exitCode !== null &&
          value.exitCode !== 0)
          ? "failed"
          : value.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";''',
)

# Replace the source adapter with a source-aware implementation.
source = Path(".ol027-transfer/verification-source.ts").read_text(encoding="utf-8")
Path("apps/daemon/src/verification-extraction/source.ts").write_text(source, encoding="utf-8")

# Artifact extraction consumes both accepted Claude and Codex command observations.
replace_exact(
    "apps/daemon/src/verification-extraction/artifact.ts",
    'import { acceptedBashObservation } from "./source.js";',
    'import { acceptedCommandObservation } from "./source.js";',
)
replace_exact(
    "apps/daemon/src/verification-extraction/artifact.ts",
    "    const observation = acceptedBashObservation(event);",
    "    const observation = acceptedCommandObservation(event);",
)
replace_exact(
    "apps/daemon/src/verification-extraction/artifact.ts",
    '''    const status =
      source.recognition.kind === "unknown"
        ? "unknown"
        : source.sourceToolOutcome === "failed"
          ? "failed"
          : source.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";''',
    '''    const status =
      source.recognition.kind === "unknown"
        ? "unknown"
        : source.sourceToolOutcome === "failed" ||
            (source.sourceToolOutcome === "completed" &&
              source.exitCode !== null &&
              source.exitCode !== 0)
          ? "failed"
          : source.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";''',
)

# Derived command Events reflect structured outcomes; neutral completion without an exit code
# remains command.completed and never becomes a success claim.
replace_exact(
    "apps/daemon/src/verification-extraction/processor.ts",
    '''function expectedCommandEventType(
  sourceOutcome: "succeeded" | "failed",
): "command.completed" | "command.failed" {
  return sourceOutcome === "succeeded" ? "command.completed" : "command.failed";
}''',
    '''function expectedCommandEventType(
  observation: DeterministicVerificationEvidenceV1["commandObservations"][number],
): "command.completed" | "command.failed" {
  return observation.sourceToolOutcome === "failed" ||
    (observation.sourceToolOutcome === "completed" &&
      observation.exitCode !== null &&
      observation.exitCode !== 0)
    ? "command.failed"
    : "command.completed";
}''',
)
replace_exact(
    "apps/daemon/src/verification-extraction/processor.ts",
    "expectedCommandEventType(observation.sourceToolOutcome)",
    "expectedCommandEventType(observation)",
    expected=2,
)
