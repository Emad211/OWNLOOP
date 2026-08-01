import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  type OwnLoopCodexHooksMutationV1,
  OwnLoopCodexHooksMutationV1Schema,
} from "@ownloop/contracts";
import {
  CODEX_HOOK_CONFIGURATION_MAX_BYTES,
  type CodexHookLauncherCommands,
  SUPPORTED_CODEX_HOOK_NAMES,
  inspectCodexHookConfiguration,
  parseCodexHookConfigurationJson,
  planCodexHookConfigurationMutation,
  serializeCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

export class CodexHooksFileError extends Error {
  readonly code: "invalid_path" | "unsafe_path" | "operation_failed";

  constructor(code: CodexHooksFileError["code"]) {
    super("Codex user Hooks could not be changed safely.");
    this.name = "CodexHooksFileError";
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

export type CodexHooksStatus = "installed" | "missing" | "repair_needed";

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathValue(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new CodexHooksFileError("invalid_path");
  return resolve(path);
}

async function readSource(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size > CODEX_HOOK_CONFIGURATION_MAX_BYTES
    ) {
      throw new CodexHooksFileError("unsafe_path");
    }
    return (await readFile(path)).toString("utf8");
  } catch (error) {
    if (error instanceof CodexHooksFileError) throw error;
    if (fsCode(error) === "ENOENT") return null;
    throw new CodexHooksFileError("operation_failed");
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
    throw new CodexHooksFileError("operation_failed");
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new CodexHooksFileError("operation_failed");
  }
}

function installMutation(
  sourceJson: string | null,
  commands: CodexHookLauncherCommands,
): OwnLoopCodexHooksMutationV1 {
  const document = sourceJson === null ? {} : parseCodexHookConfigurationJson(sourceJson);
  const inspection = inspectCodexHookConfiguration(document, commands);
  const hooks = document.hooks;
  const hookObject = isObject(hooks) ? hooks : null;
  return OwnLoopCodexHooksMutationV1Schema.parse({
    settingsFileCreated: sourceJson === null,
    hooksContainerCreated: hooks === undefined,
    createdEventContainers: inspection.missingHookNames.filter(
      (event) => hookObject?.[event] === undefined,
    ),
  });
}

function removeOwnedEmptyContainers(
  document: JsonObject,
  mutation: OwnLoopCodexHooksMutationV1,
): void {
  const hooks = document.hooks;
  if (!isObject(hooks)) return;
  for (const event of mutation.createdEventContainers) {
    const groups = hooks[event];
    if (Array.isArray(groups) && groups.length === 0) delete hooks[event];
  }
  if (mutation.hooksContainerCreated && Object.keys(hooks).length === 0) {
    delete document.hooks;
  }
}

export async function inspectCodexHooksFile(
  settingsPath: string,
  commands: CodexHookLauncherCommands,
): Promise<CodexHooksStatus> {
  try {
    const source = await readSource(pathValue(settingsPath));
    if (source === null) return "missing";
    const document = parseCodexHookConfigurationJson(source);
    const inspection = inspectCodexHookConfiguration(document, commands);
    if (inspection.state === "exact") return "installed";
    if (inspection.state === "missing" || inspection.state === "partial") return "missing";
    return "repair_needed";
  } catch {
    return "repair_needed";
  }
}

export async function installCodexHooksFile(
  settingsPath: string,
  commands: CodexHookLauncherCommands,
  clock: () => Date = () => new Date(),
): Promise<{
  mutation: OwnLoopCodexHooksMutationV1;
  changed: boolean;
  backupPath: string | null;
}> {
  const target = pathValue(settingsPath);
  const source = await readSource(target);
  const plan = planCodexHookConfigurationMutation("install", source, commands);
  const mutation = installMutation(source, commands);
  if (!plan.changed) return { mutation, changed: false, backupPath: null };
  if (plan.outputJson === null) throw new CodexHooksFileError("operation_failed");
  const backupPath = source === null ? null : await backup(target, clock);
  await writeAtomic(target, plan.outputJson);
  return { mutation, changed: true, backupPath };
}

export async function removeCodexHooksFile(
  settingsPath: string,
  commands: CodexHookLauncherCommands,
  mutationInput: OwnLoopCodexHooksMutationV1,
  clock: () => Date = () => new Date(),
): Promise<{ changed: boolean; backupPath: string | null; deleted: boolean }> {
  const target = pathValue(settingsPath);
  const source = await readSource(target);
  if (source === null) return { changed: false, backupPath: null, deleted: false };
  const mutation = OwnLoopCodexHooksMutationV1Schema.parse(mutationInput);
  const plan = planCodexHookConfigurationMutation("remove", source, commands);
  if (!plan.changed) return { changed: false, backupPath: null, deleted: false };
  if (plan.outputJson === null) throw new CodexHooksFileError("operation_failed");
  const document = parseCodexHookConfigurationJson(plan.outputJson);
  removeOwnedEmptyContainers(document, mutation);
  const deleteSettingsFile = mutation.settingsFileCreated && Object.keys(document).length === 0;
  const backupPath = await backup(target, clock);
  if (deleteSettingsFile) {
    await rm(target);
    return { changed: true, backupPath, deleted: true };
  }
  await writeAtomic(target, serializeCodexHookConfigurationJson(document));
  return { changed: true, backupPath, deleted: false };
}
