import { z } from "zod";

import { SUPPORTED_CODEX_HOOK_NAMES, type SupportedCodexHookName } from "./codex-hook-common.js";

export const CODEX_HOOK_HANDLER_TIMEOUT_SECONDS = 5 as const;
export const CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT = 0 as const;
export const CODEX_HOOK_MATCHER = "*" as const;
export const CODEX_HOOK_LAUNCHER_BASENAME = "ownloop-codex-hook" as const;
export const CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME = "ownloop-codex-hook.cmd" as const;
export const CODEX_HOOK_CONFIGURATION_MAX_BYTES = 1024 * 1024;
export const CODEX_HOOK_CONFIGURATION_MAX_DEPTH = 32;
export const CODEX_HOOK_CONFIGURATION_MAX_NODES = 50_000;

export const CODEX_HOOK_CONFIGURATION_STATES = [
  "missing",
  "partial",
  "exact",
  "ambiguous",
] as const;
export const CodexHookConfigurationStateSchema = z.enum(CODEX_HOOK_CONFIGURATION_STATES);
export type CodexHookConfigurationState = z.infer<typeof CodexHookConfigurationStateSchema>;

export const CODEX_HOOK_CONFIGURATION_ERROR_CODES = [
  "invalid_document",
  "invalid_launcher_command",
  "ambiguous_ownloop_entries",
  "configuration_too_large",
] as const;
export const CodexHookConfigurationErrorCodeSchema = z.enum(CODEX_HOOK_CONFIGURATION_ERROR_CODES);
export type CodexHookConfigurationErrorCode = z.infer<typeof CodexHookConfigurationErrorCodeSchema>;

export class CodexHookConfigurationError extends Error {
  readonly code: CodexHookConfigurationErrorCode;

  constructor(code: CodexHookConfigurationErrorCode) {
    super("The Codex Hook configuration operation failed safely.");
    this.name = "CodexHookConfigurationError";
    this.code = code;
  }
}

export type CodexHookLauncherCommands = Readonly<{
  command: string;
  commandWindows: string;
}>;

export type CodexHookConfigurationInspection = Readonly<{
  state: CodexHookConfigurationState;
  exactHookNames: readonly SupportedCodexHookName[];
  missingHookNames: readonly SupportedCodexHookName[];
  ambiguousHookNames: readonly SupportedCodexHookName[];
}>;

export type CodexHookConfigurationMutation = Readonly<{
  changed: boolean;
  inspection: CodexHookConfigurationInspection;
  document: Record<string, unknown>;
}>;

type JsonObject = Record<string, unknown>;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const SECRET_OR_ROUTE_PATTERN =
  /(?:authorization|bearer|password|passwd|secret|api[_.-]?key|access[_.-]?token|refresh[_.-]?token|id[_.-]?token|--port|127\.0\.0\.1:\d|localhost:\d)/iu;
const VERSIONED_APP_PATH_PATTERN = /[\\/]app[\\/](?:v?\d+\.\d+\.\d+|current)[\\/]/iu;
const OWNLOOP_LAUNCHER_PATTERN = /ownloop-codex-hook(?:\.cmd)?/iu;

function isPlainObject(value: unknown): value is JsonObject {
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

function assertBoundedJson(value: unknown): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > CODEX_HOOK_CONFIGURATION_MAX_NODES || depth > CODEX_HOOK_CONFIGURATION_MAX_DEPTH) {
      throw new CodexHookConfigurationError("configuration_too_large");
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current) && !Object.is(current, -0))
    ) {
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (!isPlainObject(current)) {
      throw new CodexHookConfigurationError("invalid_document");
    }
    for (const [key, item] of Object.entries(current)) {
      if (containsControlCharacter(key) || key === "__proto__" || key === "constructor") {
        throw new CodexHookConfigurationError("invalid_document");
      }
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new CodexHookConfigurationError("invalid_document");
  }
  if (utf8ByteLength(serialized) > CODEX_HOOK_CONFIGURATION_MAX_BYTES) {
    throw new CodexHookConfigurationError("configuration_too_large");
  }
}

function cloneDocument(value: unknown): JsonObject {
  assertBoundedJson(value);
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const cloned = cloneJson(value);
  if (!isPlainObject(cloned)) throw new CodexHookConfigurationError("invalid_document");
  return cloned;
}

function unquotedCommandPath(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0 || containsControlCharacter(trimmed)) return null;
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 3) return null;
    const inner = trimmed.slice(1, -1);
    return inner.includes('"') ? null : inner;
  }
  return /\s/u.test(trimmed) ? null : trimmed;
}

function validateLauncherCommand(command: string, windows: boolean): string {
  if (
    command.length > 8192 ||
    SECRET_OR_ROUTE_PATTERN.test(command) ||
    VERSIONED_APP_PATH_PATTERN.test(command)
  ) {
    throw new CodexHookConfigurationError("invalid_launcher_command");
  }
  const path = unquotedCommandPath(command);
  if (path === null) throw new CodexHookConfigurationError("invalid_launcher_command");
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const expected = windows ? CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME : CODEX_HOOK_LAUNCHER_BASENAME;
  if (!normalized.endsWith(`/${expected}`) && normalized !== expected) {
    throw new CodexHookConfigurationError("invalid_launcher_command");
  }
  return command;
}

function validateCommands(input: CodexHookLauncherCommands): CodexHookLauncherCommands {
  return Object.freeze({
    command: validateLauncherCommand(input.command, false),
    commandWindows: validateLauncherCommand(input.commandWindows, true),
  });
}

function canonicalHandler(commands: CodexHookLauncherCommands): JsonObject {
  return {
    type: "command",
    command: commands.command,
    commandWindows: commands.commandWindows,
    timeout: CODEX_HOOK_HANDLER_TIMEOUT_SECONDS,
    async: false,
    additionalContextLimit: CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT,
  };
}

function canonicalGroup(commands: CodexHookLauncherCommands): JsonObject {
  return {
    matcher: CODEX_HOOK_MATCHER,
    hooks: [canonicalHandler(commands)],
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return value === null ? "null" : String(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isPlainObject(value)) throw new CodexHookConfigurationError("invalid_document");
  const keys = Object.keys(value).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function isExactGroup(value: unknown, commands: CodexHookLauncherCommands): boolean {
  return canonicalJson(value) === canonicalJson(canonicalGroup(commands));
}

function containsOwnLoopLikeHandler(value: unknown): boolean {
  if (typeof value === "string") return OWNLOOP_LAUNCHER_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsOwnLoopLikeHandler);
  if (!isPlainObject(value)) return false;
  return Object.values(value).some(containsOwnLoopLikeHandler);
}

function hooksObject(document: JsonObject, create: boolean): JsonObject | null {
  const hooks = document.hooks;
  if (hooks === undefined) {
    if (!create) return null;
    const created: JsonObject = {};
    document.hooks = created;
    return created;
  }
  if (!isPlainObject(hooks)) throw new CodexHookConfigurationError("invalid_document");
  return hooks;
}

function inspectMutable(
  document: JsonObject,
  commands: CodexHookLauncherCommands,
): CodexHookConfigurationInspection {
  const hooks = hooksObject(document, false);
  const exactHookNames: SupportedCodexHookName[] = [];
  const missingHookNames: SupportedCodexHookName[] = [];
  const ambiguousHookNames: SupportedCodexHookName[] = [];

  for (const hookName of SUPPORTED_CODEX_HOOK_NAMES) {
    const groups = hooks?.[hookName];
    if (groups === undefined) {
      missingHookNames.push(hookName);
      continue;
    }
    if (!Array.isArray(groups)) throw new CodexHookConfigurationError("invalid_document");
    const exactCount = groups.filter((group) => isExactGroup(group, commands)).length;
    const likeCount = groups.filter(containsOwnLoopLikeHandler).length;
    if (exactCount === 1 && likeCount === 1) {
      exactHookNames.push(hookName);
    } else if (exactCount === 0 && likeCount === 0) {
      missingHookNames.push(hookName);
    } else {
      ambiguousHookNames.push(hookName);
    }
  }

  const state: CodexHookConfigurationState =
    ambiguousHookNames.length > 0
      ? "ambiguous"
      : exactHookNames.length === 0
        ? "missing"
        : missingHookNames.length === 0
          ? "exact"
          : "partial";
  return Object.freeze({
    state,
    exactHookNames: Object.freeze(exactHookNames),
    missingHookNames: Object.freeze(missingHookNames),
    ambiguousHookNames: Object.freeze(ambiguousHookNames),
  });
}

export function inspectCodexHookConfiguration(
  input: unknown,
  launcherCommands: CodexHookLauncherCommands,
): CodexHookConfigurationInspection {
  const document = cloneDocument(input);
  return inspectMutable(document, validateCommands(launcherCommands));
}

export function installCodexHookConfiguration(
  input: unknown,
  launcherCommands: CodexHookLauncherCommands,
): CodexHookConfigurationMutation {
  const document = cloneDocument(input);
  const commands = validateCommands(launcherCommands);
  const inspection = inspectMutable(document, commands);
  if (inspection.state === "ambiguous") {
    throw new CodexHookConfigurationError("ambiguous_ownloop_entries");
  }
  const hooks = hooksObject(document, true);
  if (hooks === null) throw new CodexHookConfigurationError("invalid_document");
  for (const hookName of inspection.missingHookNames) {
    const groups = hooks[hookName];
    if (groups === undefined) {
      hooks[hookName] = [canonicalGroup(commands)];
    } else if (Array.isArray(groups)) {
      groups.push(canonicalGroup(commands));
    } else {
      throw new CodexHookConfigurationError("invalid_document");
    }
  }
  return Object.freeze({
    changed: inspection.missingHookNames.length > 0,
    inspection: inspectMutable(document, commands),
    document,
  });
}

export function removeCodexHookConfiguration(
  input: unknown,
  launcherCommands: CodexHookLauncherCommands,
): CodexHookConfigurationMutation {
  const document = cloneDocument(input);
  const commands = validateCommands(launcherCommands);
  const inspection = inspectMutable(document, commands);
  if (inspection.state === "ambiguous") {
    throw new CodexHookConfigurationError("ambiguous_ownloop_entries");
  }
  if (inspection.exactHookNames.length === 0) {
    return Object.freeze({ changed: false, inspection, document });
  }
  const hooks = hooksObject(document, false);
  if (hooks === null) throw new CodexHookConfigurationError("invalid_document");
  for (const hookName of inspection.exactHookNames) {
    const groups = hooks[hookName];
    if (!Array.isArray(groups)) throw new CodexHookConfigurationError("invalid_document");
    hooks[hookName] = groups.filter((group) => !isExactGroup(group, commands));
  }
  return Object.freeze({
    changed: inspection.exactHookNames.length > 0,
    inspection: inspectMutable(document, commands),
    document,
  });
}
