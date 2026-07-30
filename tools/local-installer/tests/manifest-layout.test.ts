import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertWindowsInstallLayout,
  buildReleaseManifest,
  createWindowsInstallLayout,
  InstallLayoutError,
  ReleasePackageError,
  verifyReleasePackage,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function packageFixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-package-"));
  roots.push(root);
  await mkdir(join(root, "daemon", "dist"), { recursive: true });
  await mkdir(join(root, "web"), { recursive: true });
  await writeFile(join(root, "daemon", "dist", "index.js"), "console.log('daemon')\n");
  await writeFile(join(root, "web", "index.html"), "<!doctype html>\n");
  return root;
}

describe("release package manifest", () => {
  it("builds a byte-identical canonical manifest and verifies read-back", async () => {
    const root = await packageFixture();
    await mkdir(join(root, "node_modules", "@scope", "dir with spaces"), { recursive: true });
    await mkdir(join(root, "node_modules", "alpha"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "@scope", "dir with spaces", "fixture.txt"),
      "fixture\n",
    );
    await writeFile(join(root, "node_modules", "alpha", "index.js"), "alpha\n");

    const first = await buildReleaseManifest(root, ["daemon/dist/index.js"]);
    const second = await buildReleaseManifest(root, ["daemon/dist/index.js"]);
    expect(second).toEqual(first);
    expect(first.files.map((file) => file.path)).toEqual([
      "daemon/dist/index.js",
      "node_modules/@scope/dir with spaces/fixture.txt",
      "node_modules/alpha/index.js",
      "web/index.html",
    ]);
    expect((await verifyReleasePackage(root, first)).fingerprint).toBe(first.fingerprint);
  });

  it("rejects changed, missing, extra, and symlinked package entries", async () => {
    const changedRoot = await packageFixture();
    const changedManifest = await buildReleaseManifest(changedRoot, ["daemon/dist/index.js"]);
    await writeFile(join(changedRoot, "daemon", "dist", "index.js"), "tampered\n");
    await expect(verifyReleasePackage(changedRoot, changedManifest)).rejects.toMatchObject({
      code: "digest_mismatch",
    });

    const extraRoot = await packageFixture();
    const extraManifest = await buildReleaseManifest(extraRoot, ["daemon/dist/index.js"]);
    await writeFile(join(extraRoot, "unexpected.txt"), "extra");
    await expect(verifyReleasePackage(extraRoot, extraManifest)).rejects.toMatchObject({
      code: "extra_file",
    });

    const linkRoot = await packageFixture();
    await symlink(join(linkRoot, "web", "index.html"), join(linkRoot, "linked.html"));
    await expect(buildReleaseManifest(linkRoot, ["daemon/dist/index.js"])).rejects.toBeInstanceOf(
      ReleasePackageError,
    );
  });
});

describe("Windows install layout", () => {
  it("derives one fixed separated per-user layout and accepts case differences", () => {
    const layout = createWindowsInstallLayout("C:\\Users\\Founder\\AppData\\Local");
    expect(layout.releaseRoot).toBe("C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\app\\0.1.0");
    expect(layout.databasePath).toBe(
      "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\data\\ownloop.sqlite",
    );
    expect(
      assertWindowsInstallLayout({
        ...layout,
        root: "c:\\users\\founder\\appdata\\local\\ownloop",
      }),
    ).toBeDefined();
  });

  it("rejects relative or injected/overlapping layout paths", () => {
    expect(() => createWindowsInstallLayout("relative\\Local")).toThrow(InstallLayoutError);
    const layout = createWindowsInstallLayout("C:\\Users\\Founder\\AppData\\Local");
    expect(() =>
      assertWindowsInstallLayout({ ...layout, dataRoot: layout.configRoot }),
    ).toThrowError(expect.objectContaining({ code: "layout_mismatch" }));
  });
});
