import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  installCodexHookConfiguration,
  serializeCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import { createInstalledCodexCapabilityEnvironmentProvider } from "../../../apps/daemon/src/codex-capability/installed-environment.js";
import { buildPrivateAclCommands, ensurePrivateWindowsAcl } from "../src/index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;
const FIXTURE_SID = "S-1-5-21-111111111-222222222-333333333-1001";
const FIXTURE_PATH = "C:\\Users\\Fixture User\\AppData\\Local\\OwnLoop\\config";

function nativeFailureDetails(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const value = error as Record<string, unknown>;
  return JSON.stringify({
    code: value.code ?? null,
    exitCode: value.exitCode ?? null,
    signal: value.signal ?? null,
    stdout: typeof value.stdout === "string" ? value.stdout.trim() : null,
    stderr: typeof value.stderr === "string" ? value.stderr.trim() : null,
    message: typeof value.message === "string" ? value.message : null,
  });
}

function restoreEnvironment(
  name: "USERPROFILE" | "LOCALAPPDATA" | "ProgramData",
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object response.");
  }
  return value as Record<string, unknown>;
}

async function invokeInstalledCli(
  cliPath: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      env: environment,
      windowsHide: true,
      timeout: 60_000,
      encoding: "utf8",
    });
    const lines = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length !== 1 || stderr.trim().length !== 0) {
      throw new Error(`Invalid installed CLI output. stdout=${stdout} stderr=${stderr}`);
    }
    const parsed = object(JSON.parse(lines[0]!));
    if (parsed.ok !== true) throw new Error(`Installed CLI returned failure: ${lines[0]}`);
    return parsed;
  } catch (error) {
    throw new Error(
      `Installed CLI command failed: ${args.join(" ")} ${nativeFailureDetails(error)}`,
    );
  }
}

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("Windows private ACL command construction", () => {
  it("uses encoded module-independent .NET commands without plaintext path or SID arguments", () => {
    const commands = buildPrivateAclCommands(FIXTURE_PATH, FIXTURE_SID);
    expect(commands).toHaveLength(2);

    for (const command of commands) {
      expect(command.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
      expect(command).toHaveLength(4);
      const script = Buffer.from(command[3]!, "base64").toString("utf16le");
      expect(script).toContain("[System.IO.Directory]");
      expect(script).not.toMatch(/\b(?:Get-Acl|Set-Acl|ConvertTo-Json|ForEach-Object)\b/u);
      expect(script).not.toContain(FIXTURE_PATH);
      expect(script).not.toContain(FIXTURE_SID);
    }
  });

  it("rejects a non-canonical SID before constructing a command", () => {
    expect(() => buildPrivateAclCommands(FIXTURE_PATH, "not-a-sid")).toThrowError(
      expect.objectContaining({ code: "invalid_sid" }),
    );
  });
});

windowsDescribe("Windows private ACL boundary", () => {
  it("applies and verifies the current-user-only directory ACL idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "ownloop-acl-smoke-"));
    roots.push(root);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const userSid = stdout.trim();
    const commands = buildPrivateAclCommands(root, userSid);

    for (const [index, command] of commands.entries()) {
      try {
        await execFileAsync("powershell.exe", [...command], {
          windowsHide: true,
          timeout: 10_000,
        });
      } catch (error) {
        const operation = index === 0 ? "apply" : "verify";
        throw new Error(
          `Native Windows ACL ${operation} command failed: ${nativeFailureDetails(error)}`,
        );
      }
    }

    try {
      await ensurePrivateWindowsAcl(root, userSid);
      await ensurePrivateWindowsAcl(root, userSid);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "unknown";
      throw new Error(`Windows ACL smoke failed with controlled code: ${code}`);
    }

    expect(userSid).toMatch(/^S-1-[0-9]+(?:-[0-9]+)+$/u);
  }, 20_000);
});

windowsDescribe("installed Codex capability paths", () => {
  it("reads current-user Hooks and the official ProgramData policy without overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "ownloop-codex-capability-smoke-"));
    roots.push(root);
    const userProfile = join(root, "User");
    const localAppData = join(root, "LocalAppData");
    const programData = join(root, "ProgramData");
    const codexRoot = join(userProfile, ".codex");
    const requirementsRoot = join(programData, "OpenAI", "Codex");
    await mkdir(codexRoot, { recursive: true });
    await mkdir(localAppData, { recursive: true });
    await mkdir(requirementsRoot, { recursive: true });

    const launcherCommands = {
      command: CODEX_HOOK_LAUNCHER_BASENAME,
      commandWindows: join(localAppData, "OwnLoop", "bin", "ownloop-codex-hook.cmd"),
    } as const;
    await writeFile(
      join(codexRoot, "hooks.json"),
      serializeCodexHookConfigurationJson(
        installCodexHookConfiguration({}, launcherCommands).document,
      ),
    );
    await writeFile(
      join(requirementsRoot, "requirements.toml"),
      "allow_managed_hooks_only = false\n",
    );

    const previous = {
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      ProgramData: process.env.ProgramData,
    };
    process.env.USERPROFILE = userProfile;
    process.env.LOCALAPPDATA = localAppData;
    process.env.ProgramData = programData;
    try {
      const provider = createInstalledCodexCapabilityEnvironmentProvider();
      if (provider === null) throw new Error("Installed Codex capability provider is unavailable.");
      expect(await provider()).toEqual({
        configurationState: "exact",
        hookEngineState: "enabled",
        trustState: "needs_trust",
        managedPolicyState: "unrestricted",
        verifiedSourceSurfaces: [],
      });
    } finally {
      restoreEnvironment("USERPROFILE", previous.USERPROFILE);
      restoreEnvironment("LOCALAPPDATA", previous.LOCALAPPDATA);
      restoreEnvironment("ProgramData", previous.ProgramData);
    }
  });
});

windowsDescribe("installed Codex CLI package boundary", () => {
  it("runs Codex-only status, doctor, remove, install, and uninstall without changing Claude", async () => {
    const root = await mkdtemp(join(tmpdir(), "ownloop-installed-codex-cli-"));
    roots.push(root);
    const packageRoot = resolve("dist", "ownloop-windows-0.1.0");
    const cliPath = join(packageRoot, "installer", "dist", "cli.js");
    const localAppData = join(root, "LocalAppData");
    const userProfile = join(root, "User");
    const codexRoot = join(userProfile, ".codex");
    const codexSettingsPath = join(codexRoot, "hooks.json");
    await mkdir(codexRoot, { recursive: true });
    await writeFile(
      codexSettingsPath,
      `${JSON.stringify({
        theme: "native-package-smoke",
        hooks: {
          SessionStart: [
            {
              matcher: "foreign-tool",
              hooks: [{ type: "command", command: "foreign-hook", timeout: 3 }],
            },
          ],
        },
      })}\n`,
    );

    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      LOCALAPPDATA: localAppData,
      USERPROFILE: userProfile,
      OWNLOOP_PACKAGE_ROOT: packageRoot,
    };
    const installed = await invokeInstalledCli(cliPath, environment, ["install"]);
    const installId = String(installed.installId ?? "");
    expect(installId).not.toBe("");

    const claudeSettingsPath = join(userProfile, ".claude", "settings.json");
    const claudeBefore = await readFile(claudeSettingsPath);
    expect(
      await invokeInstalledCli(cliPath, environment, ["codex", "hooks", "status"]),
    ).toMatchObject({ command: "codex hooks status", status: "installed" });

    const doctor = await invokeInstalledCli(cliPath, environment, ["codex", "doctor"]);
    expect(doctor).toMatchObject({
      command: "codex doctor",
      source: "local",
      runtime: "stopped",
      capability: { state: "installed_unverified" },
    });
    const doctorText = JSON.stringify(doctor);
    expect(doctorText).not.toContain(root);
    expect(doctorText).not.toContain("installationToken");
    expect(doctorText).not.toContain("hmacKey");

    const removed = await invokeInstalledCli(cliPath, environment, ["codex", "hooks", "remove"]);
    expect(removed).toMatchObject({ command: "codex hooks remove", changed: true });
    expect(
      await invokeInstalledCli(cliPath, environment, ["codex", "hooks", "status"]),
    ).toMatchObject({ command: "codex hooks status", status: "missing" });
    expect(await readFile(claudeSettingsPath)).toEqual(claudeBefore);
    expect(JSON.parse(await readFile(codexSettingsPath, "utf8"))).toEqual({
      hooks: {
        SessionStart: [
          {
            hooks: [{ command: "foreign-hook", timeout: 3, type: "command" }],
            matcher: "foreign-tool",
          },
        ],
      },
      theme: "native-package-smoke",
    });

    const reconciled = await invokeInstalledCli(cliPath, environment, [
      "codex",
      "hooks",
      "install",
    ]);
    expect(reconciled).toMatchObject({ command: "codex hooks install", changed: true });
    expect(await readFile(claudeSettingsPath)).toEqual(claudeBefore);
    expect(
      await invokeInstalledCli(cliPath, environment, ["codex", "hooks", "status"]),
    ).toMatchObject({ command: "codex hooks status", status: "installed" });

    await invokeInstalledCli(cliPath, environment, [
      "uninstall",
      "--remove-data",
      "--confirm",
      installId,
    ]);
    await expect(
      readFile(join(localAppData, "OwnLoop", "install-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(codexSettingsPath, "utf8"))).toEqual({
      hooks: {
        SessionStart: [
          {
            hooks: [{ command: "foreign-hook", timeout: 3, type: "command" }],
            matcher: "foreign-tool",
          },
        ],
      },
      theme: "native-package-smoke",
    });
  }, 120_000);
});
