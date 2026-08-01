import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  SUPPORTED_CODEX_HOOK_NAMES,
  parseCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import {
  inspectCodexHooksFile,
  installCodexHooksFile,
  removeCodexHooksFile,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const commands = {
  command: CODEX_HOOK_LAUNCHER_BASENAME,
  commandWindows: "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd",
} as const;

async function fixture(): Promise<{ root: string; hooksPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "ownloop-codex-hooks-file-"));
  roots.push(root);
  return { root, hooksPath: join(root, ".codex", "hooks.json") };
}

function object(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

describe("Codex Hooks user file", () => {
  it("preserves unrelated configuration and removes only owned entries and containers", async () => {
    const setup = await fixture();
    const firstEvent = "SessionStart" as const;
    const foreignGroup = {
      matcher: "foreign-tool",
      hooks: [{ type: "command", command: "foreign-hook", timeout: 3 }],
    };
    await mkdir(join(setup.root, ".codex"), { recursive: true });
    await writeFile(
      setup.hooksPath,
      `${JSON.stringify({ theme: "dark", hooks: { [firstEvent]: [foreignGroup] } })}\n`,
    );

    const installed = await installCodexHooksFile(
      setup.hooksPath,
      commands,
      () => new Date("2026-08-01T00:00:00.000Z"),
    );
    expect(installed.changed).toBe(true);
    expect(installed.backupPath).not.toBeNull();
    expect(installed.mutation).toEqual({
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: SUPPORTED_CODEX_HOOK_NAMES.slice(1),
    });
    expect(await inspectCodexHooksFile(setup.hooksPath, commands)).toBe("installed");

    const document = parseCodexHookConfigurationJson(await readFile(setup.hooksPath, "utf8"));
    expect(document.theme).toBe("dark");
    const hooks = object(document.hooks);
    expect(hooks[firstEvent]).toEqual(
      expect.arrayContaining([foreignGroup, expect.objectContaining({ matcher: "*" })]),
    );

    const repeated = await installCodexHooksFile(setup.hooksPath, commands);
    expect(repeated).toMatchObject({ changed: false, backupPath: null });

    const removed = await removeCodexHooksFile(
      setup.hooksPath,
      commands,
      installed.mutation,
      () => new Date("2026-08-01T00:00:01.000Z"),
    );
    expect(removed).toMatchObject({ changed: true, deleted: false });
    const after = parseCodexHookConfigurationJson(await readFile(setup.hooksPath, "utf8"));
    expect(after.theme).toBe("dark");
    expect(object(after.hooks)).toEqual({ [firstEvent]: [foreignGroup] });
    expect(await inspectCodexHooksFile(setup.hooksPath, commands)).toBe("missing");
  });

  it("deletes a settings file that OwnLoop created after exact removal", async () => {
    const setup = await fixture();
    const installed = await installCodexHooksFile(setup.hooksPath, commands);
    expect(installed.mutation).toEqual({
      settingsFileCreated: true,
      hooksContainerCreated: true,
      createdEventContainers: SUPPORTED_CODEX_HOOK_NAMES,
    });
    expect(await inspectCodexHooksFile(setup.hooksPath, commands)).toBe("installed");

    const removed = await removeCodexHooksFile(
      setup.hooksPath,
      commands,
      installed.mutation,
    );
    expect(removed).toMatchObject({ changed: true, deleted: true });
    await expect(lstat(setup.hooksPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate keys and ambiguous OwnLoop-like entries without changing bytes", async () => {
    const setup = await fixture();
    await mkdir(join(setup.root, ".codex"), { recursive: true });
    const duplicate = '{"hooks":{},"hooks":{}}\n';
    await writeFile(setup.hooksPath, duplicate);
    await expect(installCodexHooksFile(setup.hooksPath, commands)).rejects.toMatchObject({
      code: "duplicate_key",
    });
    expect(await readFile(setup.hooksPath, "utf8")).toBe(duplicate);
    expect(await inspectCodexHooksFile(setup.hooksPath, commands)).toBe("repair_needed");

    const ambiguous = `${JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: CODEX_HOOK_LAUNCHER_BASENAME,
                commandWindows:
                  "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\other\\ownloop-codex-hook.cmd",
                timeout: 5,
                async: false,
                additionalContextLimit: 0,
              },
            ],
          },
        ],
      },
    })}\n`;
    await writeFile(setup.hooksPath, ambiguous);
    await expect(installCodexHooksFile(setup.hooksPath, commands)).rejects.toMatchObject({
      code: "ambiguous_ownloop_entries",
    });
    expect(await readFile(setup.hooksPath, "utf8")).toBe(ambiguous);
    expect(await inspectCodexHooksFile(setup.hooksPath, commands)).toBe("repair_needed");
  });
});
