import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReleaseManifest,
  createNativeInstallLayout,
  installOwnLoop,
  parseStrictJsonObject,
  uninstallOwnLoop,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "ownloop-install-transaction-"));
  roots.push(temp);
  const packageRoot = join(temp, "package");
  await mkdir(join(packageRoot, "daemon", "dist"), { recursive: true });
  await mkdir(join(packageRoot, "hook-adapter", "dist"), { recursive: true });
  await mkdir(join(packageRoot, "web"), { recursive: true });
  await writeFile(join(packageRoot, "daemon", "dist", "main.js"), "daemon\n");
  await writeFile(join(packageRoot, "hook-adapter", "dist", "index.js"), "hook\n");
  await writeFile(join(packageRoot, "web", "index.html"), "web\n");
  const release = await buildReleaseManifest(packageRoot, [
    "daemon/dist/main.js",
    "hook-adapter/dist/index.js",
  ]);
  await writeFile(join(packageRoot, "release-manifest.json"), `${JSON.stringify(release)}\n`);
  const layout = createNativeInstallLayout(join(temp, "OwnLoop"));
  const claudeSettingsPath = join(temp, ".claude", "settings.json");
  await mkdir(join(temp, ".claude"));
  await writeFile(claudeSettingsPath, '{"theme":"dark"}\n');
  const aclRunner = vi.fn(async (_executable: string, args: readonly string[]) => ({
    stdout: args.includes("-UserSid")
      ? ""
      : JSON.stringify({
          protected: true,
          entries: [{ sid: "S-1-5-21-100", type: "Allow", rights: "FullControl" }],
        }),
    stderr: "",
  }));
  return { temp, packageRoot, layout, claudeSettingsPath, aclRunner };
}

const installOptions = (setup: Awaited<ReturnType<typeof fixture>>) => ({
  sourcePackageRoot: setup.packageRoot,
  layout: setup.layout,
  claudeSettingsPath: setup.claudeSettingsPath,
  userSid: "S-1-5-21-100",
  userLauncher: "@echo ownloop\n",
  hookLauncher: "@echo off\n",
  clock: () => new Date("2026-07-26T12:00:00.000Z"),
  aclRunner: setup.aclRunner,
});

describe("installer transaction", () => {
  it("installs, verifies, and reinstalls without rotating secrets or deleting data", async () => {
    const setup = await fixture();
    const first = await installOwnLoop(installOptions(setup));
    await writeFile(join(setup.layout.dataRoot, "keep.txt"), "durable");
    const secretsBefore = await readFile(setup.layout.secretsPath, "utf8");
    const second = await installOwnLoop(installOptions(setup));
    expect(second.installId).toBe(first.installId);
    expect(await readFile(setup.layout.secretsPath, "utf8")).toBe(secretsBefore);
    expect(await readFile(join(setup.layout.dataRoot, "keep.txt"), "utf8")).toBe("durable");
    const settings = parseStrictJsonObject(await readFile(setup.claudeSettingsPath, "utf8"));
    expect(settings.theme).toBe("dark");
  });

  it("rolls back app, launchers, credentials, manifest, and settings on ACL failure", async () => {
    const setup = await fixture();
    const originalSettings = await readFile(setup.claudeSettingsPath, "utf8");
    await expect(
      installOwnLoop({
        ...installOptions(setup),
        aclRunner: vi.fn(async () => {
          throw new Error("ACL denied");
        }),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "acl_failed" }));
    expect(await readFile(setup.claudeSettingsPath, "utf8")).toBe(originalSettings);
    await expect(readdir(setup.layout.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores Claude settings byte-for-byte when stop fails during uninstall", async () => {
    const setup = await fixture();
    await installOwnLoop(installOptions(setup));
    const before = await readFile(setup.claudeSettingsPath);
    await expect(
      uninstallOwnLoop({
        layout: setup.layout,
        claudeSettingsPath: setup.claudeSettingsPath,
        dataMode: "preserve",
        stopRuntime: vi.fn(async () => {
          throw new Error("stop failed");
        }),
        clock: () => new Date("2026-07-26T12:00:01.000Z"),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "uninstall_failed" }));
    expect(await readFile(setup.claudeSettingsPath)).toEqual(before);
    expect(await readFile(setup.layout.installManifestPath, "utf8")).toContain("installId");
  });

  it("preserves data by explicit choice and requires exact install ID before data removal", async () => {
    const preserve = await fixture();
    const installed = await installOwnLoop(installOptions(preserve));
    await writeFile(join(preserve.layout.dataRoot, "keep.txt"), "durable");
    expect(
      await uninstallOwnLoop({
        layout: preserve.layout,
        claudeSettingsPath: preserve.claudeSettingsPath,
        dataMode: "preserve",
        stopRuntime: vi.fn(async () => {
          const error = new Error("not running") as Error & { code: string };
          error.code = "not_running";
          throw error;
        }),
      }),
    ).toEqual({ dataPreserved: true });
    expect(await readFile(join(preserve.layout.dataRoot, "keep.txt"), "utf8")).toBe("durable");

    const remove = await fixture();
    const removedInstall = await installOwnLoop(installOptions(remove));
    await expect(
      uninstallOwnLoop({
        layout: remove.layout,
        claudeSettingsPath: remove.claudeSettingsPath,
        dataMode: "remove",
        confirmationInstallId: "wrong",
        stopRuntime: vi.fn(),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "confirmation_required" }));
    await uninstallOwnLoop({
      layout: remove.layout,
      claudeSettingsPath: remove.claudeSettingsPath,
      dataMode: "remove",
      confirmationInstallId: removedInstall.installId,
      stopRuntime: vi.fn(async () => {
        const error = new Error("not running") as Error & { code: string };
        error.code = "not_running";
        throw error;
      }),
    });
    await expect(readdir(remove.layout.dataRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(removedInstall.installId).toBe(
      installed.installId === removedInstall.installId
        ? installed.installId
        : removedInstall.installId,
    );
  });
});
