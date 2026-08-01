#!/usr/bin/env node

import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { installClaudeHooksFile } from "../dist/claude-settings.js";
import { installCodexHooksFile } from "../dist/codex-hooks-file.js";
import { createNativeInstallLayout, installOwnLoop } from "../dist/installer-transaction.js";
import { readAndVerifyReleasePackage } from "../dist/manifest.js";

const execFileAsync = promisify(execFile);
const roots = [];
const CODEX_COMMAND = "ownloop-codex-hook";

function controlledError(error) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unclassified",
  };
}

async function regularFileOrMissing(path) {
  try {
    const stats = await lstat(path);
    return stats.isFile() && !stats.isSymbolicLink() ? "regular_file" : "unsafe_entry";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return "missing";
    }
    return "unreadable";
  }
}

async function copyIfRegular(source, destination) {
  const state = await regularFileOrMissing(source);
  if (state !== "regular_file") return state;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return state;
}

async function diagnoseSettings(label, source, relativeTarget, operation) {
  const root = await mkdtemp(join(tmpdir(), `ownloop-${label}-diagnostic-`));
  roots.push(root);
  const target = join(root, relativeTarget);
  const sourceState = await copyIfRegular(source, target);
  try {
    await operation(target);
    return { sourceState, result: "accepted" };
  } catch (error) {
    return { sourceState, result: "rejected", error: controlledError(error) };
  }
}

async function currentUserSid() {
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
  return stdout.trim();
}

function diagnosticAclRunner(userSid) {
  let call = 0;
  return async () => {
    call += 1;
    return {
      stdout:
        call % 2 === 1
          ? ""
          : JSON.stringify({
              protected: true,
              entries: [
                {
                  sid: userSid,
                  type: "Allow",
                  rights: "FullControl",
                  inheritance: "ContainerInherit, ObjectInherit",
                  propagation: "None",
                  inherited: false,
                },
              ],
            }),
      stderr: "",
    };
  };
}

async function diagnoseCleanTransaction(packageRoot, launchers, userSid) {
  const root = await mkdtemp(join(tmpdir(), "ownloop-clean-install-diagnostic-"));
  roots.push(root);
  const layout = createNativeInstallLayout(join(root, "LocalAppData", "OwnLoop"));
  const userProfile = join(root, "UserProfile");
  try {
    await installOwnLoop({
      sourcePackageRoot: packageRoot,
      layout,
      claudeSettingsPath: join(userProfile, ".claude", "settings.json"),
      codexSettingsPath: join(userProfile, ".codex", "hooks.json"),
      userSid,
      ...launchers,
      aclRunner: diagnosticAclRunner(userSid),
    });
    return { result: "accepted" };
  } catch (error) {
    return { result: "rejected", error: controlledError(error) };
  }
}

async function main() {
  if (process.platform !== "win32") {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: "unsupported_platform" } })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const packageInput =
    process.env.OWNLOOP_PACKAGE_ROOT ?? join(process.cwd(), "dist", "ownloop-windows-0.1.0");
  const userProfileInput = process.env.USERPROFILE;
  const localAppDataInput = process.env.LOCALAPPDATA;
  if (
    userProfileInput === undefined ||
    localAppDataInput === undefined ||
    !isAbsolute(packageInput) ||
    !isAbsolute(userProfileInput) ||
    !isAbsolute(localAppDataInput)
  ) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: "environment_unavailable" } })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const packageRoot = resolve(packageInput);
  const userProfile = resolve(userProfileInput);
  const localAppData = resolve(localAppDataInput);
  const stableRoot = join(localAppData, "OwnLoop");
  const claudeSource = join(userProfile, ".claude", "settings.json");
  const codexSource = join(userProfile, ".codex", "hooks.json");
  const commands = {
    command: CODEX_COMMAND,
    commandWindows: join(stableRoot, "bin", "ownloop-codex-hook.cmd"),
  };

  let packageResult;
  try {
    const manifest = await readAndVerifyReleasePackage(packageRoot);
    packageResult = {
      result: "accepted",
      fileCount: manifest.files.length,
      fingerprintMatchesFormat: /^sha256:[0-9a-f]{64}$/u.test(manifest.fingerprint),
    };
  } catch (error) {
    packageResult = { result: "rejected", error: controlledError(error) };
  }

  const [claudeSettings, codexHooks] = await Promise.all([
    diagnoseSettings("claude-settings", claudeSource, join(".claude", "settings.json"), (target) =>
      installClaudeHooksFile(target, join(stableRoot, "bin", "ownloop-hook.cmd")),
    ),
    diagnoseSettings("codex-hooks", codexSource, join(".codex", "hooks.json"), (target) =>
      installCodexHooksFile(target, commands),
    ),
  ]);

  let cleanTransaction;
  try {
    const launchers = {
      userLauncher: await readFile(join(packageRoot, "launchers", "installed-ownloop.cmd"), "utf8"),
      hookLauncher: await readFile(
        join(packageRoot, "launchers", "installed-ownloop-hook.cmd"),
        "utf8",
      ),
      codexHookLauncher: await readFile(
        join(packageRoot, "launchers", "installed-ownloop-codex-hook.cmd"),
        "utf8",
      ),
    };
    cleanTransaction = await diagnoseCleanTransaction(
      packageRoot,
      launchers,
      await currentUserSid(),
    );
  } catch (error) {
    cleanTransaction = { result: "rejected", error: controlledError(error) };
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      schemaVersion: 1,
      package: packageResult,
      claudeSettings,
      codexHooks,
      cleanTransaction,
    })}\n`,
  );
}

void main()
  .catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: controlledError(error) })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
