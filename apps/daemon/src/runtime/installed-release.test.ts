import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES, type OwnLoopReleaseManifestV1 } from "@ownloop/contracts";

import { runInstalledDaemon } from "../main.js";
import {
  InstalledReleaseError,
  buildInstalledAclVerificationCommand,
  deriveInstalledRuntimePaths,
  loadVerifiedInstalledRuntime,
} from "./installed-release.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function createInstalledFixture() {
  const localAppData = await mkdtemp(join(tmpdir(), "ownloop-installed-daemon-"));
  roots.push(localAppData);
  const paths = deriveInstalledRuntimePaths(localAppData);
  await mkdir(join(paths.releaseRoot, "daemon", "dist"), { recursive: true });
  await mkdir(join(paths.releaseRoot, "hook-adapter", "dist"), { recursive: true });
  await mkdir(paths.webRoot, { recursive: true });
  await mkdir(paths.configRoot, { recursive: true });
  await mkdir(paths.binRoot, { recursive: true });
  await writeFile(join(paths.releaseRoot, "daemon", "dist", "@scope.js"), "at\n");
  await writeFile(join(paths.releaseRoot, "daemon", "dist", "Zeta.js"), "upper\n");
  await writeFile(join(paths.releaseRoot, "daemon", "dist", "_alpha.js"), "underscore\n");
  await writeFile(join(paths.releaseRoot, "daemon", "dist", "main.js"), "daemon\n");
  await writeFile(join(paths.releaseRoot, "hook-adapter", "dist", "index.js"), "adapter\n");
  await writeFile(join(paths.webRoot, "index.html"), "<!doctype html><title>OwnLoop</title>\n");
  await writeFile(paths.stableHookLauncherPath, "@exit /b 0\n");

  const entries = [
    ["daemon/dist/@scope.js", "at\n", false],
    ["daemon/dist/Zeta.js", "upper\n", false],
    ["daemon/dist/_alpha.js", "underscore\n", false],
    ["daemon/dist/main.js", "daemon\n", true],
    ["hook-adapter/dist/index.js", "adapter\n", true],
    ["web/index.html", "<!doctype html><title>OwnLoop</title>\n", false],
  ] as const;
  const files = entries.map(([path, content, executableCritical]) => ({
    path,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    executableCritical,
  }));
  const unsigned = {
    schemaVersion: 1 as const,
    applicationVersion: "0.1.0" as const,
    daemonVersion: "0.1.0" as const,
    hookAdapterVersion: "0.1.0" as const,
    hookAdapterContractVersion: 1 as const,
    webVersion: "0.1.0" as const,
    expectedDatabaseSchemaVersion: 18 as const,
    platform: "win32" as const,
    architecture: "x64" as const,
    nodeVersion: "24.18.0" as const,
    packagingPnpmVersion: "11.4.0" as const,
    installLayoutVersion: 1 as const,
    files,
  };
  const releaseManifest: OwnLoopReleaseManifestV1 = {
    ...unsigned,
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")}`,
  };
  await writeFile(
    join(paths.releaseRoot, "release-manifest.json"),
    `${JSON.stringify(releaseManifest)}\n`,
  );
  const installId = "install_fixture_1";
  const secrets = {
    schemaVersion: 1,
    installId,
    installationToken: randomBytes(32).toString("base64url"),
    hmacKey: randomBytes(32).toString("base64url"),
    createdAt: "2026-07-26T12:00:00.000Z",
  } as const;
  await writeFile(paths.secretsPath, `${JSON.stringify(secrets)}\n`, { mode: 0o600 });
  const installManifest = {
    schemaVersion: 1,
    installId,
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: releaseManifest.fingerprint,
    installLayoutVersion: 1,
    hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
      event,
      command: paths.stableHookLauncherPath,
    })),
    claudeSettings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [],
    },
    installedAt: "2026-07-26T12:00:00.000Z",
  } as const;
  await writeFile(paths.installManifestPath, `${JSON.stringify(installManifest)}\n`);
  return { localAppData, paths, releaseManifest, secrets, installManifest };
}

describe("installed release verification", () => {
  it("constructs an encoded module-independent startup ACL command", () => {
    const configRoot = "C:\\Users\\Fixture User\\AppData\\Local\\OwnLoop\\config";
    const secretsPath = `${configRoot}\\secrets-v1.json`;
    const command = buildInstalledAclVerificationCommand(configRoot, secretsPath);
    expect(command.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(command).toHaveLength(4);
    const script = Buffer.from(command[3]!, "base64").toString("utf16le");
    expect(script).toContain("[System.IO.Directory]::GetAccessControl");
    expect(script).toContain("[System.IO.File]::GetAccessControl");
    expect(script).not.toMatch(/\b(?:Get-Acl|Set-Acl|ConvertTo-Json|ForEach-Object)\b/u);
    expect(script).not.toContain(configRoot);
    expect(script).not.toContain(secretsPath);
  });

  it("verifies canonical package ordering independent of host locale", async () => {
    const fixture = await createInstalledFixture();
    const result = await loadVerifiedInstalledRuntime({
      localAppData: fixture.localAppData,
      platform: "win32",
      architecture: "x64",
      nodeVersion: "24.18.0",
      verifyPrivateAcl: async () => true,
    });
    expect(result.installManifest.installId).toBe(fixture.secrets.installId);
    expect(result.releaseManifest.files.slice(0, 3).map((file) => file.path)).toEqual([
      "daemon/dist/@scope.js",
      "daemon/dist/Zeta.js",
      "daemon/dist/_alpha.js",
    ]);
  });

  it("rejects unsupported environment before reading paths and rejects package tampering", async () => {
    await expect(
      loadVerifiedInstalledRuntime({
        localAppData: join(tmpdir(), "does-not-exist"),
        platform: "linux",
        architecture: "x64",
        nodeVersion: "24.18.0",
        verifyPrivateAcl: async () => true,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "unsupported_environment" }));

    const fixture = await createInstalledFixture();
    await writeFile(join(fixture.paths.releaseRoot, "daemon", "dist", "main.js"), "tampered\n");
    await expect(
      loadVerifiedInstalledRuntime({
        localAppData: fixture.localAppData,
        platform: "win32",
        architecture: "x64",
        nodeVersion: "24.18.0",
        verifyPrivateAcl: async () => true,
      }),
    ).rejects.toBeInstanceOf(InstalledReleaseError);
  });

  it("rejects when the protected ACL cannot be independently verified", async () => {
    const fixture = await createInstalledFixture();
    await expect(
      loadVerifiedInstalledRuntime({
        localAppData: fixture.localAppData,
        platform: "win32",
        architecture: "x64",
        nodeVersion: "24.18.0",
        verifyPrivateAcl: async () => false,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "acl_unverified" }));
  });

  it("starts the real composition only after installed verification and serves packaged web bytes", async () => {
    const fixture = await createInstalledFixture();
    const runtime = await runInstalledDaemon({
      environment: { LOCALAPPDATA: fixture.localAppData },
      platform: "win32",
      architecture: "x64",
      nodeVersion: "24.18.0",
      verifyPrivateAcl: async () => true,
    });
    try {
      const page = await fetch(`${runtime.address.url}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("OwnLoop");
      expect(await readFile(fixture.paths.runtimeStatePath, "utf8")).not.toContain(
        fixture.secrets.installationToken,
      );
    } finally {
      await runtime.shutdown();
    }
  });
});
