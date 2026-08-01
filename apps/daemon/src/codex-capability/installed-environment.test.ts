import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  installCodexHookConfiguration,
  serializeCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import { createInstalledCodexCapabilityEnvironmentProvider } from "./installed-environment.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-installed-codex-environment-"));
  roots.push(root);
  const userProfile = join(root, "User");
  const localAppData = join(root, "LocalAppData");
  const programData = join(root, "ProgramData");
  const codexRoot = join(userProfile, ".codex");
  const requirementsRoot = join(programData, "OpenAI", "Codex");
  await mkdir(codexRoot, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await mkdir(requirementsRoot, { recursive: true });
  return {
    userProfile,
    localAppData,
    programData,
    hooksPath: join(codexRoot, "hooks.json"),
    requirementsPath: join(requirementsRoot, "requirements.toml"),
  };
}

describe("installed Codex capability environment provider", () => {
  it("reads the official Windows paths on every invocation without mutation", async () => {
    const setup = await fixture();
    await writeFile(setup.requirementsPath, "allow_managed_hooks_only = false\n");
    const provider = createInstalledCodexCapabilityEnvironmentProvider({
      platform: "win32",
      environment: {
        USERPROFILE: setup.userProfile,
        LOCALAPPDATA: setup.localAppData,
        ProgramData: setup.programData,
      },
    });
    if (provider === null) throw new Error("Expected an installed capability provider.");

    expect(await provider()).toEqual({
      configurationState: "missing",
      hookEngineState: "enabled",
      trustState: "not_applicable",
      managedPolicyState: "unrestricted",
      verifiedSourceSurfaces: [],
    });

    const commands = {
      command: CODEX_HOOK_LAUNCHER_BASENAME,
      commandWindows: join(
        setup.localAppData,
        "OwnLoop",
        "bin",
        "ownloop-codex-hook.cmd",
      ),
    } as const;
    const document = installCodexHookConfiguration({}, commands).document;
    await writeFile(setup.hooksPath, serializeCodexHookConfigurationJson(document));

    expect(await provider()).toEqual({
      configurationState: "exact",
      hookEngineState: "enabled",
      trustState: "needs_trust",
      managedPolicyState: "unrestricted",
      verifiedSourceSurfaces: [],
    });

    await rm(setup.hooksPath);
    expect((await provider()).configurationState).toBe("missing");
  });

  it("fails closed outside Windows or when required roots are not absolute", () => {
    expect(
      createInstalledCodexCapabilityEnvironmentProvider({
        platform: "linux",
        environment: {},
      }),
    ).toBeNull();
    expect(
      createInstalledCodexCapabilityEnvironmentProvider({
        platform: "win32",
        environment: { USERPROFILE: "relative-user", LOCALAPPDATA: "relative-local" },
      }),
    ).toBeNull();
    expect(
      createInstalledCodexCapabilityEnvironmentProvider({
        platform: "win32",
        environment: { USERPROFILE: "/absolute-user" },
      }),
    ).toBeNull();
  });
});
