import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES } from "@ownloop/contracts";

import {
  buildReleaseManifest,
  createNativeInstallLayout,
  createOrReadInstallationSecrets,
  installClaudeHooksFile,
  writeInstallManifestAtomic,
} from "../src/index.js";
import { CliParseError, executeCli, parseCliCommand } from "../src/cli.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function environment() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-cli-"));
  roots.push(root);
  const localAppData = join(root, "Local");
  const userProfile = join(root, "User");
  const packageRoot = join(root, "package");
  await mkdir(join(packageRoot, "launchers"), { recursive: true });
  await writeFile(join(packageRoot, "launchers", "installed-ownloop.cmd"), "user launcher\n");
  await writeFile(join(packageRoot, "launchers", "installed-ownloop-hook.cmd"), "hook launcher\n");
  return {
    packageRoot,
    environment: { LOCALAPPDATA: localAppData, USERPROFILE: userProfile },
  };
}

const compatible = {
  platform: "win32",
  architecture: "x64",
  nodeVersion: "24.18.0",
} as const;

async function prepareVerifiedInstallation(setup: Awaited<ReturnType<typeof environment>>) {
  const root = join(setup.environment.LOCALAPPDATA, "OwnLoop");
  const layout = createNativeInstallLayout(root);
  await mkdir(join(layout.releaseRoot, "installer", "dist"), { recursive: true });
  await writeFile(
    join(layout.releaseRoot, "installer", "dist", "hook-main.js"),
    "process.exitCode = 0;\n",
  );
  const release = await buildReleaseManifest(layout.releaseRoot, ["installer/dist/hook-main.js"]);
  await writeFile(
    join(layout.releaseRoot, "release-manifest.json"),
    `${JSON.stringify(release)}\n`,
  );
  const { secrets } = await createOrReadInstallationSecrets(
    layout.secretsPath,
    () => new Date("2026-07-26T12:00:00.000Z"),
  );
  await writeInstallManifestAtomic(layout.installManifestPath, {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: release.fingerprint,
    installLayoutVersion: 1,
    hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
      event,
      command: layout.stableHookLauncherPath,
    })),
    claudeSettings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [],
    },
    installedAt: "2026-07-26T12:00:00.000Z",
  });
  return {
    layout,
    release,
    secrets,
    claudeSettingsPath: join(setup.environment.USERPROFILE, ".claude", "settings.json"),
  };
}

describe("CLI grammar", () => {
  it("accepts only the bounded command surface and exact remove-data confirmation grammar", () => {
    expect(parseCliCommand(["install"])).toEqual({ name: "install" });
    expect(parseCliCommand(["hooks", "status"])).toEqual({ name: "hooks_status" });
    expect(parseCliCommand(["uninstall", "--preserve-data"])).toEqual({
      name: "uninstall",
      dataMode: "preserve",
    });
    expect(parseCliCommand(["uninstall", "--remove-data", "--confirm", "install_1"])).toEqual({
      name: "uninstall",
      dataMode: "remove",
      confirmationInstallId: "install_1",
    });
    expect(() => parseCliCommand(["uninstall", "--remove-data"])).toThrow(CliParseError);
    expect(() => parseCliCommand(["start", "--port", "8080"])).toThrow(CliParseError);
    expect(() => parseCliCommand(["open", "https://example.com"])).toThrow(CliParseError);
  });
});

describe("CLI execution", () => {
  it("installs through the verified package surface and returns only controlled identity", async () => {
    const setup = await environment();
    const installImplementation = vi.fn(async () => ({ installId: "install_1", created: true }));
    const result = await executeCli(["install"], {
      ...compatible,
      environment: setup.environment,
      packageRoot: setup.packageRoot,
      userSid: async () => "S-1-5-21-100",
      installImplementation,
    });
    expect(result).toEqual({ ok: true, command: "install", installId: "install_1", created: true });
    expect(JSON.stringify(result)).not.toContain(setup.packageRoot);
    expect(installImplementation).toHaveBeenCalledWith(
      expect.objectContaining({
        userSid: "S-1-5-21-100",
        userLauncher: "user launcher\n",
        hookLauncher: "hook launcher\n",
      }),
    );
  });

  it("opens only the exact URL derived from verified running status", async () => {
    const setup = await environment();
    const openUrl = vi.fn(async () => undefined);
    const probeImplementation = vi.fn(async () => ({
      result: "running" as const,
      state: {
        schemaVersion: 1 as const,
        installId: "install_1",
        applicationVersion: "0.1.0" as const,
        daemonVersion: "0.1.0" as const,
        hookAdapterVersion: "0.1.0" as const,
        installLayoutVersion: 1 as const,
        instanceId: "runtime_1",
        pid: 123,
        processStartIdentity: "123.1",
        port: 43123,
        phase: "ready" as const,
        startedAt: "2026-07-26T12:00:00.000Z",
        updatedAt: "2026-07-26T12:00:01.000Z",
      },
      status: null,
    }));
    const result = await executeCli(["open"], {
      ...compatible,
      environment: setup.environment,
      probeImplementation,
      openUrl,
    });
    expect(result).toEqual({ ok: true, command: "open", url: "http://127.0.0.1:43123/" });
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:43123/");
  });

  it("returns the controlled runtime identity required by start and status", async () => {
    const setup = await environment();
    const state = {
      schemaVersion: 1 as const,
      installId: "install_1",
      applicationVersion: "0.1.0" as const,
      daemonVersion: "0.1.0" as const,
      hookAdapterVersion: "0.1.0" as const,
      installLayoutVersion: 1 as const,
      instanceId: "runtime_1",
      pid: 123,
      processStartIdentity: "123.1",
      port: 43123,
      phase: "ready" as const,
      startedAt: "2026-07-26T12:00:00.000Z",
      updatedAt: "2026-07-26T12:00:01.000Z",
    };
    const probe = { result: "running" as const, state, status: null };
    const started = await executeCli(["start"], {
      ...compatible,
      environment: setup.environment,
      startImplementation: vi.fn(async () => probe),
    });
    expect(started).toMatchObject({
      ok: true,
      command: "start",
      status: "running",
      instanceId: "runtime_1",
      phase: "ready",
      pid: 123,
      url: "http://127.0.0.1:43123/",
    });
    const status = await executeCli(["status"], {
      ...compatible,
      environment: setup.environment,
      probeImplementation: vi.fn(async () => probe),
    });
    expect(status).toMatchObject({
      ok: true,
      command: "status",
      status: "running",
      instanceId: "runtime_1",
      phase: "ready",
      pid: 123,
      url: "http://127.0.0.1:43123/",
    });
  });

  it("reports start failure as a controlled code without exception, path, or stack leakage", async () => {
    const setup = await environment();
    const error = new Error(`private failure at ${setup.packageRoot}`) as Error & { code: string };
    error.code = "start_timeout";
    error.stack = `SECRET STACK ${setup.packageRoot}`;
    const result = await executeCli(["start"], {
      ...compatible,
      environment: setup.environment,
      startImplementation: vi.fn(async () => {
        throw error;
      }),
    });
    expect(result).toEqual({ ok: false, error: { code: "start_timeout" } });
    expect(JSON.stringify(result)).not.toContain(setup.packageRoot);
    expect(JSON.stringify(result)).not.toContain("STACK");
  });

  it("passes the explicit uninstall data choice and confirmation without falling through", async () => {
    const setup = await environment();
    const uninstallImplementation = vi.fn(async () => ({ dataPreserved: false }));
    const result = await executeCli(["uninstall", "--remove-data", "--confirm", "install_123"], {
      ...compatible,
      environment: setup.environment,
      uninstallImplementation,
      stopImplementation: vi.fn(async () => undefined),
    });
    // Destructive uninstall requires complete installation reconciliation before any mutation.
    expect(result).toEqual({ ok: false, error: { code: "repair_needed" } });
    expect(uninstallImplementation).not.toHaveBeenCalled();
  });

  it("distinguishes missing Hook state from orphaned settings that require repair", async () => {
    const setup = await environment();
    const missing = await executeCli(["hooks", "status"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(missing).toEqual({ ok: true, command: "hooks status", status: "missing" });

    const layout = createNativeInstallLayout(join(setup.environment.LOCALAPPDATA, "OwnLoop"));
    const settingsPath = join(setup.environment.USERPROFILE, ".claude", "settings.json");
    await installClaudeHooksFile(settingsPath, layout.stableHookLauncherPath);
    const orphaned = await executeCli(["hooks", "status"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(orphaned).toEqual({ ok: true, command: "hooks status", status: "repair_needed" });
  });

  it("verifies install identity and release bytes before Hook mutation", async () => {
    const setup = await environment();
    const installed = await prepareVerifiedInstallation(setup);
    await mkdir(join(setup.environment.USERPROFILE, ".claude"), { recursive: true });
    await writeFile(installed.claudeSettingsPath, '{"theme":"dark"}\n');
    const before = await readFile(installed.claudeSettingsPath, "utf8");
    await writeFile(
      join(installed.layout.releaseRoot, "installer", "dist", "hook-main.js"),
      "tampered\n",
    );

    const result = await executeCli(["hooks", "install"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(result).toEqual({ ok: false, error: { code: "repair_needed" } });
    expect(await readFile(installed.claudeSettingsPath, "utf8")).toBe(before);
  });

  it("installs and reports exact Hooks only after verified installation reconciliation", async () => {
    const setup = await environment();
    await prepareVerifiedInstallation(setup);
    const installed = await executeCli(["hooks", "install"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(installed).toEqual({ ok: true, command: "hooks install", changed: true });
    const status = await executeCli(["hooks", "status"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(status).toEqual({ ok: true, command: "hooks status", status: "installed" });
  });

  it("rejects unsupported platform before filesystem access", async () => {
    const result = await executeCli(["status"], {
      platform: "linux",
      architecture: "x64",
      nodeVersion: "24.18.0",
      environment: {},
    });
    expect(result).toEqual({ ok: false, error: { code: "runtime_incompatible" } });
  });
});
