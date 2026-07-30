import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  type OwnLoopClaudeSettingsMutationV1,
  OwnLoopClaudeSettingsMutationV1Schema,
  type SupportedClaudeHookName,
} from "@ownloop/contracts";

import { MAX_SETTINGS_JSON_BYTES, parseStrictJsonObject } from "./strict-json.js";

export class ClaudeSettingsError extends Error {
  readonly code:
    | "invalid_path"
    | "unsafe_path"
    | "invalid_settings"
    | "ambiguous_entry"
    | "operation_failed";
  constructor(code: ClaudeSettingsError["code"]) {
    super("Claude user settings could not be changed safely.");
    this.name = "ClaudeSettingsError";
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;
export type ClaudeSettingsInstallResult = Readonly<{
  settings: JsonObject;
  mutation: OwnLoopClaudeSettingsMutationV1;
  changed: boolean;
}>;

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysExactly(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function ownEntry(command: string): JsonObject {
  return {
    hooks: [{ type: "command", command, timeout: 2 }],
  };
}

function isExactOwnEntry(value: unknown, command: string): boolean {
  if (!object(value) || !keysExactly(value, ["hooks"])) return false;
  const hooks = value.hooks;
  if (!Array.isArray(hooks) || hooks.length !== 1) return false;
  const hook = hooks[0];
  return (
    object(hook) &&
    keysExactly(hook, ["type", "command", "timeout"]) &&
    hook.type === "command" &&
    hook.command === command &&
    hook.timeout === 2
  );
}

function containsCommand(value: unknown, command: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsCommand(entry, command));
  if (!object(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "command" && nested === command) return true;
    if (containsCommand(nested, command)) return true;
  }
  return false;
}

function validateCommand(command: string): void {
  if (command.length < 1 || command.length > 1024 || /[\r\n\0]/u.test(command)) {
    throw new ClaudeSettingsError("ambiguous_entry");
  }
}

export function installClaudeHooks(
  settings: JsonObject,
  command: string,
  options: { settingsFileCreated?: boolean } = {},
): ClaudeSettingsInstallResult {
  validateCommand(command);
  let changed = false;
  let hooksContainerCreated = false;
  const createdEventContainers: SupportedClaudeHookName[] = [];
  let hooks: JsonObject;
  if (settings.hooks === undefined) {
    hooks = Object.create(null) as JsonObject;
    settings.hooks = hooks;
    hooksContainerCreated = true;
    changed = true;
  } else if (object(settings.hooks)) {
    hooks = settings.hooks;
  } else {
    throw new ClaudeSettingsError("invalid_settings");
  }

  for (const event of SUPPORTED_CLAUDE_HOOK_NAMES) {
    let entries: unknown[];
    if (hooks[event] === undefined) {
      entries = [];
      hooks[event] = entries;
      createdEventContainers.push(event);
      changed = true;
    } else if (Array.isArray(hooks[event])) {
      entries = hooks[event];
    } else {
      throw new ClaudeSettingsError("invalid_settings");
    }
    const exact = entries.filter((entry) => isExactOwnEntry(entry, command));
    const ambiguous = entries.some(
      (entry) => containsCommand(entry, command) && !isExactOwnEntry(entry, command),
    );
    if (ambiguous || exact.length > 1) throw new ClaudeSettingsError("ambiguous_entry");
    if (exact.length === 0) {
      entries.push(ownEntry(command));
      changed = true;
    }
  }

  return {
    settings,
    mutation: OwnLoopClaudeSettingsMutationV1Schema.parse({
      settingsFileCreated: options.settingsFileCreated ?? false,
      hooksContainerCreated,
      createdEventContainers,
    }),
    changed,
  };
}

export function removeClaudeHooks(
  settings: JsonObject,
  command: string,
  mutationInput: OwnLoopClaudeSettingsMutationV1,
): { settings: JsonObject; changed: boolean; deleteSettingsFile: boolean } {
  validateCommand(command);
  const mutation = OwnLoopClaudeSettingsMutationV1Schema.parse(mutationInput);
  if (settings.hooks === undefined) return { settings, changed: false, deleteSettingsFile: false };
  if (!object(settings.hooks)) throw new ClaudeSettingsError("invalid_settings");
  const hooks = settings.hooks;
  let changed = false;
  for (const event of SUPPORTED_CLAUDE_HOOK_NAMES) {
    const current = hooks[event];
    if (current === undefined) continue;
    if (!Array.isArray(current)) throw new ClaudeSettingsError("invalid_settings");
    const exactIndexes: number[] = [];
    current.forEach((entry, index) => {
      if (isExactOwnEntry(entry, command)) exactIndexes.push(index);
      else if (containsCommand(entry, command)) throw new ClaudeSettingsError("ambiguous_entry");
    });
    if (exactIndexes.length > 1) throw new ClaudeSettingsError("ambiguous_entry");
    if (exactIndexes.length === 1) {
      current.splice(exactIndexes[0]!, 1);
      changed = true;
    }
    if (current.length === 0 && mutation.createdEventContainers.includes(event)) {
      delete hooks[event];
      changed = true;
    }
  }
  if (Object.keys(hooks).length === 0 && mutation.hooksContainerCreated) {
    delete settings.hooks;
    changed = true;
  }
  return {
    settings,
    changed,
    deleteSettingsFile:
      changed && mutation.settingsFileCreated && Object.keys(settings).length === 0,
  };
}

function pathValue(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new ClaudeSettingsError("invalid_path");
  return resolve(path);
}

async function readSettings(path: string): Promise<JsonObject | null> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_SETTINGS_JSON_BYTES) {
      throw new ClaudeSettingsError("unsafe_path");
    }
    return parseStrictJsonObject((await readFile(path)).toString("utf8"));
  } catch (error) {
    if (error instanceof ClaudeSettingsError) throw error;
    if (fsCode(error) === "ENOENT") return null;
    throw new ClaudeSettingsError("invalid_settings");
  }
}

function backupName(path: string, clock: () => Date): string {
  const stamp = clock().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `${path}.ownloop-backup-${stamp}`;
}

async function backup(path: string, clock: () => Date): Promise<string> {
  const target = backupName(path, clock);
  try {
    await copyFile(path, target, constants.COPYFILE_EXCL);
    return target;
  } catch {
    throw new ClaudeSettingsError("operation_failed");
  }
}

async function writeAtomic(path: string, settings: JsonObject): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new ClaudeSettingsError("operation_failed");
  }
}

export type ClaudeHooksStatus = "installed" | "missing" | "repair_needed";

export function inspectClaudeHooks(settings: JsonObject, command: string): ClaudeHooksStatus {
  try {
    validateCommand(command);
    if (settings.hooks === undefined) return "missing";
    if (!object(settings.hooks)) return "repair_needed";
    for (const event of SUPPORTED_CLAUDE_HOOK_NAMES) {
      const entries = settings.hooks[event];
      if (entries === undefined) return "missing";
      if (!Array.isArray(entries)) return "repair_needed";
      const exact = entries.filter((entry) => isExactOwnEntry(entry, command));
      if (
        entries.some((entry) => containsCommand(entry, command) && !isExactOwnEntry(entry, command))
      ) {
        return "repair_needed";
      }
      if (exact.length > 1) return "repair_needed";
      if (exact.length === 0) return "missing";
    }
    return "installed";
  } catch {
    return "repair_needed";
  }
}

export async function inspectClaudeHooksFile(
  settingsPath: string,
  command: string,
): Promise<ClaudeHooksStatus> {
  try {
    const settings = await readSettings(pathValue(settingsPath));
    return settings === null ? "missing" : inspectClaudeHooks(settings, command);
  } catch {
    return "repair_needed";
  }
}

export async function installClaudeHooksFile(
  settingsPath: string,
  command: string,
  clock: () => Date = () => new Date(),
): Promise<{
  mutation: OwnLoopClaudeSettingsMutationV1;
  changed: boolean;
  backupPath: string | null;
}> {
  const target = pathValue(settingsPath);
  const existing = await readSettings(target);
  const fileCreated = existing === null;
  const result = installClaudeHooks(existing ?? (Object.create(null) as JsonObject), command, {
    settingsFileCreated: fileCreated,
  });
  if (!result.changed) return { mutation: result.mutation, changed: false, backupPath: null };
  let backupPath: string | null = null;
  if (!fileCreated) backupPath = await backup(target, clock);
  await writeAtomic(target, result.settings);
  return { mutation: result.mutation, changed: true, backupPath };
}

export async function removeClaudeHooksFile(
  settingsPath: string,
  command: string,
  mutation: OwnLoopClaudeSettingsMutationV1,
  clock: () => Date = () => new Date(),
): Promise<{ changed: boolean; backupPath: string | null; deleted: boolean }> {
  const target = pathValue(settingsPath);
  const existing = await readSettings(target);
  if (existing === null) return { changed: false, backupPath: null, deleted: false };
  const result = removeClaudeHooks(existing, command, mutation);
  if (!result.changed) return { changed: false, backupPath: null, deleted: false };
  const backupPath = await backup(target, clock);
  if (result.deleteSettingsFile) {
    await rm(target);
    return { changed: true, backupPath, deleted: true };
  }
  await writeAtomic(target, result.settings);
  return { changed: true, backupPath, deleted: false };
}
