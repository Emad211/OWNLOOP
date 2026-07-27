from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


config = "packages/contracts/src/codex-hook-configuration.ts"
replace_exact(
    config,
    '''export const CODEX_HOOK_CONFIGURATION_ERROR_CODES = [
  "invalid_document",
  "invalid_launcher_command",''',
    '''export const CODEX_HOOK_CONFIGURATION_ERROR_CODES = [
  "duplicate_key",
  "invalid_document",
  "invalid_json",
  "invalid_launcher_command",''',
)
replace_exact(
    config,
    '''function cloneDocument(value: unknown): JsonObject {
  assertBoundedJson(value);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const cloned = cloneJson(value);
  if (!isPlainObject(cloned)) throw new CodexHookConfigurationError("invalid_document");
  return cloned;
}
''',
    '''function cloneDocument(value: unknown): JsonObject {
  assertBoundedJson(value);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const cloned = cloneJson(value);
  if (!isPlainObject(cloned)) throw new CodexHookConfigurationError("invalid_document");
  return cloned;
}

export function validateCodexHookConfigurationDocument(
  value: unknown,
): Record<string, unknown> {
  return cloneDocument(value);
}
''',
)

codex = "packages/contracts/src/codex.ts"
replace_exact(
    codex,
    '''  removeCodexHookConfiguration,
} from "./codex-hook-configuration.js";''',
    '''  removeCodexHookConfiguration,
  validateCodexHookConfigurationDocument,
} from "./codex-hook-configuration.js";
export {
  parseCodexHookConfigurationJson,
  serializeCodexHookConfigurationJson,
} from "./codex-hook-configuration-json.js";''',
)
