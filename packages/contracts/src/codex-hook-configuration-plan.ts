import {
  CodexHookConfigurationError,
  type CodexHookConfigurationInspection,
  type CodexHookLauncherCommands,
  inspectCodexHookConfiguration,
  installCodexHookConfiguration,
  removeCodexHookConfiguration,
} from "./codex-hook-configuration.js";
import {
  parseCodexHookConfigurationJson,
  serializeCodexHookConfigurationJson,
} from "./codex-hook-configuration-json.js";

export const CODEX_HOOK_CONFIGURATION_OPERATIONS = ["install", "remove"] as const;
export type CodexHookConfigurationOperation = (typeof CODEX_HOOK_CONFIGURATION_OPERATIONS)[number];

export type CodexHookConfigurationPlan = Readonly<{
  operation: CodexHookConfigurationOperation;
  sourceExisted: boolean;
  changed: boolean;
  before: CodexHookConfigurationInspection;
  after: CodexHookConfigurationInspection;
  outputJson: string | null;
}>;

export function planCodexHookConfigurationMutation(
  operation: CodexHookConfigurationOperation,
  sourceJson: string | null,
  launcherCommands: CodexHookLauncherCommands,
): CodexHookConfigurationPlan {
  const sourceExisted = sourceJson !== null;
  const sourceDocument = sourceJson === null ? {} : parseCodexHookConfigurationJson(sourceJson);
  const mutation = (() => {
    switch (operation) {
      case "install":
        return installCodexHookConfiguration(sourceDocument, launcherCommands);
      case "remove":
        return removeCodexHookConfiguration(sourceDocument, launcherCommands);
      default: {
        const _unreachable: never = operation;
        throw new CodexHookConfigurationError("invalid_document");
      }
    }
  })();
  return Object.freeze({
    operation,
    sourceExisted,
    changed: mutation.changed,
    before: inspectCodexHookConfiguration(sourceDocument, launcherCommands),
    after: mutation.inspection,
    outputJson: mutation.changed ? serializeCodexHookConfigurationJson(mutation.document) : null,
  });
}
