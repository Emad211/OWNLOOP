from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# Capability documents cannot claim a state that contradicts their facts.
replace_exact(
    "packages/contracts/src/codex-capability.ts",
    '''    if (value.state === "active" && value.facts.limitations.length > 0) {
      context.addIssue({ code: "custom", message: "Active capability cannot contain limitations." });
    }''',
    '''    if (value.state !== capabilityState(value.facts)) {
      context.addIssue({ code: "custom", message: "Capability state does not match its facts." });
    }
    if (value.state === "active" && value.facts.limitations.length > 0) {
      context.addIssue({ code: "custom", message: "Active capability cannot contain limitations." });
    }''',
)

config_path = "packages/contracts/src/codex-hook-configuration.ts"
replace_exact(
    config_path,
    '''function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
''',
    '''function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function cloneJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item);
  return output;
}
''',
)
replace_exact(
    config_path,
    "  if (new TextEncoder().encode(serialized).byteLength > CODEX_HOOK_CONFIGURATION_MAX_BYTES) {",
    "  if (utf8ByteLength(serialized) > CODEX_HOOK_CONFIGURATION_MAX_BYTES) {",
)
replace_exact(
    config_path,
    '''function cloneDocument(value: unknown): JsonObject {
  assertBoundedJson(value);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const cloned = structuredClone(value) as unknown;
  if (!isPlainObject(cloned)) throw new CodexHookConfigurationError("invalid_document");
  return cloned;
}''',
    '''function cloneDocument(value: unknown): JsonObject {
  assertBoundedJson(value);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const cloned = cloneJson(value);
  if (!isPlainObject(cloned)) throw new CodexHookConfigurationError("invalid_document");
  return cloned;
}''',
)
replace_exact(
    config_path,
    '''function hooksObject(document: JsonObject): JsonObject {
  const hooks = document.hooks;
  if (hooks === undefined) {
    const created: JsonObject = {};
    document.hooks = created;
    return created;
  }
  if (!isPlainObject(hooks)) throw new CodexHookConfigurationError("invalid_document");
  return hooks;
}''',
    '''function hooksObject(document: JsonObject, create: boolean): JsonObject | null {
  const hooks = document.hooks;
  if (hooks === undefined) {
    if (!create) return null;
    const created: JsonObject = {};
    document.hooks = created;
    return created;
  }
  if (!isPlainObject(hooks)) throw new CodexHookConfigurationError("invalid_document");
  return hooks;
}''',
)
replace_exact(
    config_path,
    "  const hooks = hooksObject(document);\n  const exactHookNames",
    "  const hooks = hooksObject(document, false);\n  const exactHookNames",
)
replace_exact(
    config_path,
    '''  for (const hookName of SUPPORTED_CODEX_HOOK_NAMES) {
    const groups = hooks[hookName];''',
    '''  for (const hookName of SUPPORTED_CODEX_HOOK_NAMES) {
    const groups = hooks?.[hookName];''',
)
replace_exact(
    config_path,
    '''  const hooks = hooksObject(document);
  for (const hookName of inspection.missingHookNames) {''',
    '''  const hooks = hooksObject(document, true);
  if (hooks === null) throw new CodexHookConfigurationError("invalid_document");
  for (const hookName of inspection.missingHookNames) {''',
)
replace_exact(
    config_path,
    '''  const hooks = hooksObject(document);
  for (const hookName of inspection.exactHookNames) {''',
    '''  if (inspection.exactHookNames.length === 0) {
    return Object.freeze({ changed: false, inspection, document });
  }
  const hooks = hooksObject(document, false);
  if (hooks === null) throw new CodexHookConfigurationError("invalid_document");
  for (const hookName of inspection.exactHookNames) {''',
)

# Export pure capability and hooks configuration primitives through the Codex subpath.
export_anchor = '} from "./codex-capability.js";\n'
export_block = '''export type {
  CodexHookConfigurationInspection,
  CodexHookConfigurationMutation,
  CodexHookConfigurationState,
  CodexHookLauncherCommands,
} from "./codex-hook-configuration.js";
export {
  CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT,
  CODEX_HOOK_CONFIGURATION_ERROR_CODES,
  CODEX_HOOK_CONFIGURATION_MAX_BYTES,
  CODEX_HOOK_CONFIGURATION_MAX_DEPTH,
  CODEX_HOOK_CONFIGURATION_MAX_NODES,
  CODEX_HOOK_CONFIGURATION_STATES,
  CODEX_HOOK_HANDLER_TIMEOUT_SECONDS,
  CODEX_HOOK_LAUNCHER_BASENAME,
  CODEX_HOOK_MATCHER,
  CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME,
  CodexHookConfigurationError,
  CodexHookConfigurationErrorCodeSchema,
  CodexHookConfigurationStateSchema,
  inspectCodexHookConfiguration,
  installCodexHookConfiguration,
  removeCodexHookConfiguration,
} from "./codex-hook-configuration.js";
'''
replace_exact(
    "packages/contracts/src/codex.ts",
    export_anchor,
    export_anchor + export_block,
)
