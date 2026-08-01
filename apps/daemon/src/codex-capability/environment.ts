import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT,
  CODEX_HOOK_CONFIGURATION_MAX_BYTES,
  CODEX_HOOK_HANDLER_TIMEOUT_SECONDS,
  CODEX_HOOK_MATCHER,
  SUPPORTED_CODEX_HOOK_NAMES,
  type CodexHookLauncherCommands,
  type SupportedCodexHookName,
  inspectCodexHookConfiguration,
  parseCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import type { CodexCapabilityEnvironmentFacts } from "./projector.js";

const TOML_MAX_BYTES = 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MATCHER_IGNORED_EVENTS = new Set<SupportedCodexHookName>(["UserPromptSubmit", "Stop"]);
const EVENT_LABELS: Readonly<Record<SupportedCodexHookName, string>> = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
};

type ReadResult =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "text"; text: string }>;

type HookPosition = Readonly<{
  event: SupportedCodexHookName;
  groupIndex: number;
  handlerIndex: 0;
}>;

type HookState = Readonly<{
  enabled?: boolean;
  trustedHash?: string;
}>;

type ParsedCodexConfig = Readonly<{
  featureHooks: boolean | null;
  states: ReadonlyMap<string, HookState>;
}>;

export type CodexCapabilityEnvironmentInspectionOptions = Readonly<{
  hooksPath: string;
  configPath: string;
  requirementsPath: string | null;
  launcherCommands: CodexHookLauncherCommands;
  platform?: NodeJS.Platform;
}>;

async function readBoundedRegularFile(pathInput: string, maxBytes: number): Promise<ReadResult> {
  const path = resolve(pathInput);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maxBytes) {
      return { kind: "invalid" };
    }
    return { kind: "text", text: UTF8.decode(await readFile(path)) };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "invalid" };
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || value === null) throw new Error("Invalid canonical value.");
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function codexTrustedHashForInstalledHandler(
  event: SupportedCodexHookName,
  commands: CodexHookLauncherCommands,
  platform: NodeJS.Platform = process.platform,
): string {
  const handler: Record<string, unknown> = {
    type: "command",
    command: platform === "win32" ? commands.commandWindows : commands.command,
    timeout: CODEX_HOOK_HANDLER_TIMEOUT_SECONDS,
    async: false,
    additionalContextLimit: CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT,
  };
  const identity: Record<string, unknown> = {
    event_name: EVENT_LABELS[event],
    hooks: [handler],
  };
  if (!MATCHER_IGNORED_EVENTS.has(event)) identity.matcher = CODEX_HOOK_MATCHER;
  return `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactHandler(value: unknown, commands: CodexHookLauncherCommands): boolean {
  if (!isObject(value) || Object.keys(value).length !== 6) return false;
  return (
    value.type === "command" &&
    value.command === commands.command &&
    value.commandWindows === commands.commandWindows &&
    value.timeout === CODEX_HOOK_HANDLER_TIMEOUT_SECONDS &&
    value.async === false &&
    value.additionalContextLimit === CODEX_HOOK_ADDITIONAL_CONTEXT_LIMIT
  );
}

function findHookPositions(
  document: Record<string, unknown>,
  commands: CodexHookLauncherCommands,
): readonly HookPosition[] | null {
  if (!isObject(document.hooks)) return null;
  const positions: HookPosition[] = [];
  for (const event of SUPPORTED_CODEX_HOOK_NAMES) {
    const groups = document.hooks[event];
    if (!Array.isArray(groups)) return null;
    const indexes = groups.flatMap((group, groupIndex) => {
      if (
        !isObject(group) ||
        Object.keys(group).length !== 2 ||
        group.matcher !== CODEX_HOOK_MATCHER ||
        !Array.isArray(group.hooks) ||
        group.hooks.length !== 1 ||
        !exactHandler(group.hooks[0], commands)
      ) {
        return [];
      }
      return [groupIndex];
    });
    if (indexes.length !== 1) return null;
    positions.push({ event, groupIndex: indexes[0]!, handlerIndex: 0 });
  }
  return positions;
}

function stripTomlComment(line: string): string | null {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === character) quote = null;
      else if (quote === null) quote = character;
      continue;
    }
    if (character === "#" && quote === null) return line.slice(0, index).trim();
  }
  return quote === null ? line.trim() : null;
}

function parseTomlString(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return null;
}

function parseStateHeader(header: string): string | null {
  const prefix = "hooks.state.";
  if (!header.startsWith(prefix)) return null;
  return parseTomlString(header.slice(prefix.length));
}

function parseCodexConfigToml(text: string): ParsedCodexConfig | null {
  let section = "";
  let featureHooks: boolean | null = null;
  let legacyFeatureHooks: boolean | null = null;
  const mutableStates = new Map<string, { enabled?: boolean; trustedHash?: string }>();
  const seenAssignments = new Set<string>();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine);
    if (line === null) return null;
    if (line.length === 0) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim();
      continue;
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (assignment === null) continue;
    const key = assignment[1]!;
    const value = assignment[2]!.trim();
    const assignmentIdentity = `${section}\0${key}`;
    if (seenAssignments.has(assignmentIdentity)) return null;
    seenAssignments.add(assignmentIdentity);

    if (section === "features" && (key === "hooks" || key === "codex_hooks")) {
      const parsed = value === "true" ? true : value === "false" ? false : null;
      if (parsed === null) return null;
      if (key === "hooks") featureHooks = parsed;
      else legacyFeatureHooks = parsed;
      continue;
    }

    const stateKey = parseStateHeader(section);
    if (stateKey === null) continue;
    const state = mutableStates.get(stateKey) ?? {};
    if (key === "enabled") {
      if (value !== "true" && value !== "false") return null;
      state.enabled = value === "true";
    } else if (key === "trusted_hash") {
      const parsed = parseTomlString(value);
      if (parsed === null || !/^sha256:[0-9a-f]{64}$/u.test(parsed)) return null;
      state.trustedHash = parsed;
    }
    mutableStates.set(stateKey, state);
  }

  if (featureHooks !== null && legacyFeatureHooks !== null && featureHooks !== legacyFeatureHooks) {
    return null;
  }
  return {
    featureHooks: featureHooks ?? legacyFeatureHooks,
    states: new Map(mutableStates),
  };
}

function trustAndEngineState(
  config: ReadResult,
  hooksPath: string,
  positions: readonly HookPosition[] | null,
  commands: CodexHookLauncherCommands,
  platform: NodeJS.Platform,
): Pick<CodexCapabilityEnvironmentFacts, "hookEngineState" | "trustState"> {
  if (positions === null) return { hookEngineState: "enabled", trustState: "not_applicable" };
  if (config.kind === "invalid") return { hookEngineState: "unknown", trustState: "unknown" };
  const parsed =
    config.kind === "missing"
      ? { featureHooks: null, states: new Map() }
      : parseCodexConfigToml(config.text);
  if (parsed === null) return { hookEngineState: "unknown", trustState: "unknown" };
  const source = resolve(hooksPath);
  let needsTrust = false;
  let disabled = parsed.featureHooks === false;
  for (const position of positions) {
    const key = `${source}:${EVENT_LABELS[position.event]}:${position.groupIndex}:${position.handlerIndex}`;
    const state = parsed.states.get(key);
    if (state?.enabled === false) disabled = true;
    const expectedHash = codexTrustedHashForInstalledHandler(position.event, commands, platform);
    if (state?.trustedHash !== expectedHash) needsTrust = true;
  }
  return {
    hookEngineState: disabled ? "disabled" : "enabled",
    trustState: needsTrust ? "needs_trust" : "trusted",
  };
}

function managedPolicyState(requirements: ReadResult): "unrestricted" | "managed_only" | "unknown" {
  if (requirements.kind !== "text") return "unknown";
  let section = "";
  let observed: boolean | null = null;
  for (const rawLine of requirements.text.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine);
    if (line === null) return "unknown";
    if (line.length === 0) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim();
      continue;
    }
    if (section !== "") continue;
    const match = /^allow_managed_hooks_only\s*=\s*(true|false)$/u.exec(line);
    if (match === null) continue;
    if (observed !== null) return "unknown";
    observed = match[1] === "true";
  }
  return observed === null ? "unknown" : observed ? "managed_only" : "unrestricted";
}

export async function inspectCodexCapabilityEnvironment(
  options: CodexCapabilityEnvironmentInspectionOptions,
): Promise<CodexCapabilityEnvironmentFacts> {
  const [hooks, config, requirements] = await Promise.all([
    readBoundedRegularFile(options.hooksPath, CODEX_HOOK_CONFIGURATION_MAX_BYTES),
    readBoundedRegularFile(options.configPath, TOML_MAX_BYTES),
    options.requirementsPath === null
      ? Promise.resolve<ReadResult>({ kind: "missing" })
      : readBoundedRegularFile(options.requirementsPath, TOML_MAX_BYTES),
  ]);

  if (hooks.kind === "missing") {
    return {
      configurationState: "missing",
      hookEngineState: config.kind === "invalid" ? "unknown" : "enabled",
      trustState: "not_applicable",
      managedPolicyState: managedPolicyState(requirements),
      verifiedSourceSurfaces: [],
    };
  }
  if (hooks.kind === "invalid") {
    return {
      configurationState: "unavailable",
      hookEngineState: "unknown",
      trustState: "unknown",
      managedPolicyState: managedPolicyState(requirements),
      verifiedSourceSurfaces: [],
    };
  }

  try {
    const document = parseCodexHookConfigurationJson(hooks.text);
    const inspection = inspectCodexHookConfiguration(document, options.launcherCommands);
    const configurationState = inspection.state === "ambiguous" ? "ambiguous" : inspection.state;
    const positions =
      configurationState === "exact" ? findHookPositions(document, options.launcherCommands) : null;
    const runtime = trustAndEngineState(
      config,
      options.hooksPath,
      positions,
      options.launcherCommands,
      options.platform ?? process.platform,
    );
    return {
      configurationState,
      ...runtime,
      managedPolicyState: managedPolicyState(requirements),
      verifiedSourceSurfaces: [],
    };
  } catch {
    return {
      configurationState: "invalid",
      hookEngineState: "unknown",
      trustState: "unknown",
      managedPolicyState: managedPolicyState(requirements),
      verifiedSourceSurfaces: [],
    };
  }
}
