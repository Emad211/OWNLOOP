from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"unexpected anchor in {path}: {old[:80]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    "packages/contracts/src/local-installation.ts",
    '''import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";
''',
    '''import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";
import {
  SUPPORTED_CODEX_HOOK_NAMES,
  SupportedCodexHookNameSchema,
} from "./codex-hook-common.js";
import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME,
} from "./codex-hook-configuration.js";
''',
)
replace_once(
    "packages/contracts/src/local-installation.ts",
    'export const OWNLOOP_STABLE_HOOK_LAUNCHER_FILE = "ownloop-hook.cmd" as const;\nexport const OWNLOOP_STABLE_USER_LAUNCHER_FILE = "ownloop.cmd" as const;\n',
    'export const OWNLOOP_STABLE_HOOK_LAUNCHER_FILE = "ownloop-hook.cmd" as const;\nexport const OWNLOOP_STABLE_CODEX_HOOK_LAUNCHER_FILE =\n  CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME;\nexport const OWNLOOP_STABLE_USER_LAUNCHER_FILE = "ownloop.cmd" as const;\n',
)
replace_once(
    "packages/contracts/src/local-installation.ts",
    'export type OwnLoopClaudeSettingsMutationV1 = z.infer<typeof OwnLoopClaudeSettingsMutationV1Schema>;\n\n',
    '''export type OwnLoopClaudeSettingsMutationV1 = z.infer<typeof OwnLoopClaudeSettingsMutationV1Schema>;

export const OwnLoopCodexHooksMutationV1Schema = z
  .strictObject({
    settingsFileCreated: z.boolean(),
    hooksContainerCreated: z.boolean(),
    createdEventContainers: z
      .array(SupportedCodexHookNameSchema)
      .max(SUPPORTED_CODEX_HOOK_NAMES.length),
  })
  .superRefine((value, context) => {
    const actual = value.createdEventContainers;
    if (new Set(actual).size !== actual.length) {
      context.addIssue({
        code: "custom",
        path: ["createdEventContainers"],
        message: "Created Codex Hook events must be unique.",
      });
    }
    const expectedOrder = SUPPORTED_CODEX_HOOK_NAMES.filter((event) => actual.includes(event));
    if (actual.some((event, index) => event !== expectedOrder[index])) {
      context.addIssue({
        code: "custom",
        path: ["createdEventContainers"],
        message: "Created Codex Hook events must use canonical order.",
      });
    }
  });
export type OwnLoopCodexHooksMutationV1 = z.infer<typeof OwnLoopCodexHooksMutationV1Schema>;

const codexWindowsLauncherCommandSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => {
    const normalized = value.replaceAll("\\\\", "/").toLowerCase();
    return normalized.endsWith(`/${CODEX_HOOK_WINDOWS_LAUNCHER_BASENAME}`);
  }, "Codex Windows command must target the stable OwnLoop launcher.");

export const OwnLoopCodexHooksInstallationV1Schema = z.strictObject({
  command: z.literal(CODEX_HOOK_LAUNCHER_BASENAME),
  commandWindows: codexWindowsLauncherCommandSchema,
  settings: OwnLoopCodexHooksMutationV1Schema,
});
export type OwnLoopCodexHooksInstallationV1 = z.infer<
  typeof OwnLoopCodexHooksInstallationV1Schema
>;

''',
)
replace_once(
    "packages/contracts/src/local-installation.ts",
    '    claudeSettings: OwnLoopClaudeSettingsMutationV1Schema,\n    installedAt: canonicalTimestampSchema,\n',
    '    claudeSettings: OwnLoopClaudeSettingsMutationV1Schema,\n    codexHooks: OwnLoopCodexHooksInstallationV1Schema.optional(),\n    installedAt: canonicalTimestampSchema,\n',
)

replace_once(
    "tools/local-installer/src/installer-transaction.ts",
    "  stableUserLauncherPath: string;\n  stableHookLauncherPath: string;\n",
    "  stableUserLauncherPath: string;\n  stableHookLauncherPath: string;\n  stableCodexHookLauncherPath: string;\n",
)
replace_once(
    "tools/local-installer/src/installer-transaction.ts",
    "    stableUserLauncherPath: join(binRoot, OWNLOOP_STABLE_USER_LAUNCHER_FILE),\n    stableHookLauncherPath: join(binRoot, OWNLOOP_STABLE_HOOK_LAUNCHER_FILE),\n",
    "    stableUserLauncherPath: join(binRoot, OWNLOOP_STABLE_USER_LAUNCHER_FILE),\n    stableHookLauncherPath: join(binRoot, OWNLOOP_STABLE_HOOK_LAUNCHER_FILE),\n    stableCodexHookLauncherPath: join(binRoot, OWNLOOP_STABLE_CODEX_HOOK_LAUNCHER_FILE),\n",
)
replace_once(
    "tools/local-installer/src/installer-transaction.ts",
    "  OWNLOOP_STABLE_HOOK_LAUNCHER_FILE,\n  OWNLOOP_STABLE_USER_LAUNCHER_FILE,\n",
    "  OWNLOOP_STABLE_CODEX_HOOK_LAUNCHER_FILE,\n  OWNLOOP_STABLE_HOOK_LAUNCHER_FILE,\n  OWNLOOP_STABLE_USER_LAUNCHER_FILE,\n",
)

replace_once(
    "tools/local-installer/src/package-builder.ts",
    '(ownArea === "daemon" || ownArea === "hook-adapter" || ownArea === "installer")',
    '(ownArea === "daemon" ||\n      ownArea === "hook-adapter" ||\n      ownArea === "codex-hook-adapter" ||\n      ownArea === "installer")',
)
replace_once(
    "tools/local-installer/src/package-builder.ts",
    '  "hook-adapter/dist/index.js",\n  "installer/dist/cli.js",\n  "installer/dist/hook-main.js",\n  "launchers/installed-ownloop-hook.cmd",\n',
    '  "hook-adapter/dist/index.js",\n  "codex-hook-adapter/dist/index.js",\n  "installer/dist/cli.js",\n  "installer/dist/hook-main.js",\n  "installer/dist/codex-hook-main.js",\n  "launchers/installed-ownloop-hook.cmd",\n  "launchers/installed-ownloop-codex-hook.cmd",\n',
)
replace_once(
    "tools/local-installer/src/package-builder.ts",
    '      ["@ownloop/hook-adapter", "hook-adapter", "tools/hook-adapter/package.json"],\n      ["@ownloop/local-installer", "installer", "tools/local-installer/package.json"],\n',
    '''      ["@ownloop/hook-adapter", "hook-adapter", "tools/hook-adapter/package.json"],
      [
        "@ownloop/codex-hook-adapter",
        "codex-hook-adapter",
        "tools/codex-hook-adapter/package.json",
      ],
      ["@ownloop/local-installer", "installer", "tools/local-installer/package.json"],
''',
)

package_path = Path("tools/codex-hook-adapter/package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
if package.get("version") != "0.0.0":
    raise SystemExit("unexpected Codex adapter version")
package["version"] = "0.1.0"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

index_path = Path("tools/local-installer/src/index.ts")
index_text = index_path.read_text(encoding="utf-8")
if 'export * from "./codex-hook-launcher.js";' in index_text:
    raise SystemExit("Codex launcher export already exists")
index_path.write_text(index_text + '\nexport * from "./codex-hook-launcher.js";\n', encoding="utf-8")

replace_once(
    "tools/local-installer/tests/package-builder.test.ts",
    '    [\n      "tools/local-installer/package.json",\n',
    '''    [
      "tools/codex-hook-adapter/package.json",
      {
        name: "@ownloop/codex-hook-adapter",
        version: "0.1.0",
        private: true,
        type: "module",
        files: ["dist"],
        bin: { "ownloop-codex-hook-adapter": "./dist/index.js" },
        dependencies: { "@ownloop/contracts": "workspace:*" },
      },
    ],
    [
      "tools/local-installer/package.json",
''',
)
replace_once(
    "tools/local-installer/tests/package-builder.test.ts",
    '    "installed-ownloop-hook.cmd",\n  ]) {\n',
    '    "installed-ownloop-hook.cmd",\n    "installed-ownloop-codex-hook.cmd",\n  ]) {\n',
)
replace_once(
    "tools/local-installer/tests/package-builder.test.ts",
    '    if (workspace === "@ownloop/hook-adapter")\n      await writeFile(join(destination, "dist", "index.js"), "hook\\n");\n    if (workspace === "@ownloop/local-installer") {\n',
    '    if (workspace === "@ownloop/hook-adapter")\n      await writeFile(join(destination, "dist", "index.js"), "hook\\n");\n    if (workspace === "@ownloop/codex-hook-adapter")\n      await writeFile(join(destination, "dist", "index.js"), "codex hook\\n");\n    if (workspace === "@ownloop/local-installer") {\n',
)
replace_once(
    "tools/local-installer/tests/package-builder.test.ts",
    '      await writeFile(join(destination, "dist", "hook-main.js"), "hook main\\n");\n',
    '      await writeFile(join(destination, "dist", "hook-main.js"), "hook main\\n");\n      await writeFile(join(destination, "dist", "codex-hook-main.js"), "codex hook main\\n");\n',
)
replace_once(
    "tools/local-installer/tests/package-builder.test.ts",
    "    expect(deployCalls).toHaveLength(3);\n",
    "    expect(deployCalls).toHaveLength(4);\n",
)

Path("tools/local-installer/src/codex-hook-launcher.ts").write_text('''import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import type { HookSpawnOptions } from "./hook-launcher.js";
import { readInstallManifest } from "./install-manifest.js";
import {
  probeInstalledRuntime,
  type RuntimeClientDependencies,
  type RuntimeClientPaths,
} from "./runtime-client.js";
import { readInstallationSecrets } from "./secrets.js";

const ADAPTER_ENTRY = "codex-hook-adapter/dist/index.js";

export type CodexHookLauncherPaths = RuntimeClientPaths &
  Readonly<{ stableCodexHookLauncherPath: string }>;

export type CodexHookSpawn = (
  executable: string,
  args: readonly string[],
  options: HookSpawnOptions,
) => Promise<void>;

async function defaultSpawn(
  executable: string,
  args: readonly string[],
  options: HookSpawnOptions,
): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    let child;
    try {
      child = spawn(executable, [...args], options);
    } catch {
      resolvePromise();
      return;
    }
    child.once("error", () => resolvePromise());
    child.once("exit", () => resolvePromise());
  });
}

export async function launchInstalledCodexHookAdapter(
  paths: CodexHookLauncherPaths,
  dependencies: RuntimeClientDependencies & {
    spawnImplementation?: CodexHookSpawn;
    nodeExecutable?: string;
  } = {},
): Promise<"launched" | "skipped"> {
  try {
    const probe = await probeInstalledRuntime(paths, dependencies);
    if (probe.result !== "running" || probe.state === null || probe.status === null) {
      return "skipped";
    }
    const installation = await readInstallManifest(paths.installManifestPath);
    const codex = installation.codexHooks;
    if (
      codex === undefined ||
      codex.command !== CODEX_HOOK_LAUNCHER_BASENAME ||
      resolve(codex.commandWindows) !== resolve(paths.stableCodexHookLauncherPath)
    ) {
      return "skipped";
    }
    const secrets = await readInstallationSecrets(paths.secretsPath);
    if (secrets === null || secrets.installId !== installation.installId) return "skipped";
    const adapterEntry = resolve(paths.releaseRoot, ADAPTER_ENTRY);
    await (dependencies.spawnImplementation ?? defaultSpawn)(
      dependencies.nodeExecutable ?? process.execPath,
      [adapterEntry],
      {
        env: {
          ...process.env,
          OWNLOOP_INGRESS_PORT: String(probe.state.port),
          OWNLOOP_INSTALLATION_TOKEN: secrets.installationToken,
          OWNLOOP_CODEX_SOURCE_SURFACE: "cli",
        },
        windowsHide: true,
        stdio: ["inherit", "ignore", "ignore"],
      },
    );
    return "launched";
  } catch {
    return "skipped";
  }
}
''', encoding="utf-8")

Path("tools/local-installer/src/codex-hook-main.ts").write_text('''#!/usr/bin/env node

import { join, resolve } from "node:path";

import { launchInstalledCodexHookAdapter } from "./codex-hook-launcher.js";
import { createNativeInstallLayout } from "./installer-transaction.js";

async function main(): Promise<void> {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData === undefined) return;
    const layout = createNativeInstallLayout(join(resolve(localAppData), "OwnLoop"));
    await launchInstalledCodexHookAdapter(layout);
  } catch {
    // Codex Hook observation is silent and fail-open.
  }
}

void main().finally(() => {
  process.exitCode = 0;
});
''', encoding="utf-8")

Path("tools/local-installer/scripts/installed-ownloop-codex-hook.cmd").write_text('''@echo off
node "%LOCALAPPDATA%\\OwnLoop\\app\\0.1.0\\installer\\dist\\codex-hook-main.js" >nul 2>&1
exit /b 0
''', encoding="utf-8")

Path("packages/contracts/tests/local-installation-codex.test.ts").write_text('''import { describe, expect, it } from "vitest";

import { OwnLoopInstallManifestV1Schema, SUPPORTED_CLAUDE_HOOK_NAMES } from "../src/index.js";
import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  SUPPORTED_CODEX_HOOK_NAMES,
} from "../src/codex.js";

const manifest = () => ({
  schemaVersion: 1,
  installId: "install_1",
  applicationVersion: "0.1.0",
  releaseDirectoryName: "0.1.0",
  releaseManifestFingerprint: `sha256:${"a".repeat(64)}`,
  installLayoutVersion: 1,
  hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
    event,
    command: "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-hook.cmd",
  })),
  claudeSettings: {
    settingsFileCreated: false,
    hooksContainerCreated: false,
    createdEventContainers: [],
  },
  codexHooks: {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows:
      "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd",
    settings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [...SUPPORTED_CODEX_HOOK_NAMES],
    },
  },
  installedAt: "2026-07-26T12:00:00.000Z",
});

describe("Codex installation ownership contract", () => {
  it("accepts the stable launcher and canonical event ownership", () => {
    expect(
      OwnLoopInstallManifestV1Schema.parse(manifest()).codexHooks?.settings.createdEventContainers,
    ).toEqual(SUPPORTED_CODEX_HOOK_NAMES);
  });

  it("rejects reordered ownership or a versioned launcher command", () => {
    expect(() =>
      OwnLoopInstallManifestV1Schema.parse({
        ...manifest(),
        codexHooks: {
          ...manifest().codexHooks,
          settings: {
            ...manifest().codexHooks.settings,
            createdEventContainers: [...SUPPORTED_CODEX_HOOK_NAMES].reverse(),
          },
        },
      }),
    ).toThrow();
    expect(() =>
      OwnLoopInstallManifestV1Schema.parse({
        ...manifest(),
        codexHooks: {
          ...manifest().codexHooks,
          commandWindows:
            "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\app\\0.1.0\\ownloop-codex-hook.cmd",
        },
      }),
    ).toThrow();
  });
});
''', encoding="utf-8")

Path("tools/local-installer/tests/codex-launcher-script.test.ts").write_text('''import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("installed Codex Hook launcher", () => {
  it("is stable, silent, fail-open, and secret-free", async () => {
    const value = await readFile(
      resolve("tools/local-installer/scripts/installed-ownloop-codex-hook.cmd"),
      "utf8",
    );
    expect(value).toContain("installer\\\\dist\\\\codex-hook-main.js");
    expect(value).toContain(">nul 2>&1");
    expect(value).toContain("exit /b 0");
    expect(value).not.toContain("OWNLOOP_INSTALLATION_TOKEN");
    expect(value).not.toContain("secrets-v1.json");
  });
});
''', encoding="utf-8")
