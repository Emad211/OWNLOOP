import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES } from "@ownloop/contracts";

import {
  ClaudeSettingsError,
  InstallationSecretError,
  createOrReadInstallationSecrets,
  installClaudeHooks,
  installClaudeHooksFile,
  parseStrictJsonObject,
  removeClaudeHooks,
  removeClaudeHooksFile,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function root() {
  const value = await mkdtemp(join(tmpdir(), "ownloop-installer-settings-"));
  roots.push(value);
  return value;
}

const command = "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-hook.cmd";
const clock = () => new Date("2026-07-26T12:00:00.000Z");

describe("strict JSON", () => {
  it("rejects decoded duplicate keys, prototype keys remain data, and root arrays", () => {
    expect(() => parseStrictJsonObject('{"a":1,"\\u0061":2}')).toThrowError(
      expect.objectContaining({ code: "duplicate_key" }),
    );
    const parsed = parseStrictJsonObject('{"__proto__":{"polluted":true},"safe":1}');
    expect(parsed.safe).toBe(1);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(() => parseStrictJsonObject("[]")).toThrowError(
      expect.objectContaining({ code: "root_not_object" }),
    );
  });
});

describe("installation secrets", () => {
  it("creates independent credentials once and preserves them across reinstall", async () => {
    const directory = await root();
    const path = join(directory, "config", "secrets-v1.json");
    const first = await createOrReadInstallationSecrets(path, clock);
    const second = await createOrReadInstallationSecrets(path, clock);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.secrets).toEqual(first.secrets);
    expect(first.secrets.installationToken).not.toBe(first.secrets.hmacKey);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("provider");
  });

  it("rejects symlinked or malformed secret state without rotation", async () => {
    const directory = await root();
    const outside = join(directory, "outside.json");
    await writeFile(outside, "{}\n");
    const path = join(directory, "secrets-v1.json");
    await symlink(outside, path);
    await expect(createOrReadInstallationSecrets(path, clock)).rejects.toBeInstanceOf(
      InstallationSecretError,
    );
  });
});

describe("Claude settings hooks", () => {
  it("installs exactly one entry per supported event, preserves unknown settings, and is idempotent", () => {
    const settings = parseStrictJsonObject(
      JSON.stringify({
        permissions: { allow: ["Bash(git status)"] },
        hooks: { PreToolUse: [{ matcher: "Bash" }] },
      }),
    );
    const first = installClaudeHooks(settings, command);
    expect(first.changed).toBe(true);
    expect(first.settings.permissions).toEqual({ allow: ["Bash(git status)"] });
    const hooks = first.settings.hooks as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual([...SUPPORTED_CLAUDE_HOOK_NAMES].sort());
    expect(hooks.PreToolUse).toHaveLength(2);
    const second = installClaudeHooks(first.settings, command);
    expect(second.changed).toBe(false);
  });

  it("rejects ambiguous modified OwnLoop entries and removes only exact recorded entries", () => {
    const ambiguous = parseStrictJsonObject(
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command, timeout: 9 }] }] },
      }),
    );
    expect(() => installClaudeHooks(ambiguous, command)).toThrowError(
      expect.objectContaining({ code: "ambiguous_entry" }),
    );

    const preexisting = parseStrictJsonObject(
      '{"hooks":{"SessionStart":[]},"mcpServers":{"x":{}}}',
    );
    const installed = installClaudeHooks(preexisting, command);
    const removed = removeClaudeHooks(installed.settings, command, installed.mutation);
    expect(removed.settings).toEqual({ hooks: { SessionStart: [] }, mcpServers: { x: {} } });
  });

  it("backs up before file mutation, avoids duplicate backups on idempotent install, and deletes only a file it created", async () => {
    const directory = await root();
    const settingsPath = join(directory, ".claude", "settings.json");
    await mkdir(join(directory, ".claude"));
    await writeFile(settingsPath, '{"theme":"dark"}\n');
    const installed = await installClaudeHooksFile(settingsPath, command, clock);
    expect(installed.changed).toBe(true);
    expect(installed.backupPath).not.toBeNull();
    expect(await readFile(installed.backupPath!, "utf8")).toBe('{"theme":"dark"}\n');
    const repeated = await installClaudeHooksFile(settingsPath, command, clock);
    expect(repeated).toMatchObject({ changed: false, backupPath: null });
    const removed = await removeClaudeHooksFile(
      settingsPath,
      command,
      installed.mutation,
      () => new Date("2026-07-26T12:00:01.000Z"),
    );
    expect(removed.deleted).toBe(false);
    expect(parseStrictJsonObject(await readFile(settingsPath, "utf8"))).toEqual({ theme: "dark" });

    const createdPath = join(directory, ".claude", "created.json");
    const created = await installClaudeHooksFile(createdPath, command, clock);
    const createdRemoval = await removeClaudeHooksFile(
      createdPath,
      command,
      created.mutation,
      () => new Date("2026-07-26T12:00:02.000Z"),
    );
    expect(createdRemoval.deleted).toBe(true);
    await expect(readFile(createdPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves a corrupt settings file untouched", async () => {
    const directory = await root();
    const settingsPath = join(directory, "settings.json");
    const raw = '{"hooks":{},"hooks":{}}\n';
    await writeFile(settingsPath, raw);
    await expect(installClaudeHooksFile(settingsPath, command, clock)).rejects.toBeInstanceOf(
      ClaudeSettingsError,
    );
    expect(await readFile(settingsPath, "utf8")).toBe(raw);
  });
});
