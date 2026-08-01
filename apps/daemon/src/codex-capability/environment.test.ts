import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  SUPPORTED_CODEX_HOOK_NAMES,
  installCodexHookConfiguration,
  serializeCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import {
  codexTrustedHashForInstalledHandler,
  inspectCodexCapabilityEnvironment,
} from "./environment.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const commands = {
  command: CODEX_HOOK_LAUNCHER_BASENAME,
  commandWindows: "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd",
} as const;

const labels = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
} as const;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-codex-environment-"));
  roots.push(root);
  const codexRoot = join(root, ".codex");
  await mkdir(codexRoot, { recursive: true });
  return {
    hooksPath: join(codexRoot, "hooks.json"),
    configPath: join(codexRoot, "config.toml"),
    requirementsPath: join(root, "requirements.toml"),
  };
}

function exactDocument(foreignSessionStart = false): Record<string, unknown> {
  const document = installCodexHookConfiguration({}, commands).document;
  if (foreignSessionStart) {
    const hooks = document.hooks as Record<string, unknown[]>;
    hooks.SessionStart!.unshift({
      matcher: "foreign-tool",
      hooks: [{ type: "command", command: "foreign-hook" }],
    });
  }
  return document;
}

function trustedConfig(hooksPath: string, foreignSessionStart = false): string {
  const lines = ["[features]", "hooks = true", ""];
  for (const event of SUPPORTED_CODEX_HOOK_NAMES) {
    const groupIndex = event === "SessionStart" && foreignSessionStart ? 1 : 0;
    const key = `${resolve(hooksPath)}:${labels[event]}:${groupIndex}:0`;
    lines.push(`[hooks.state.${JSON.stringify(key)}]`);
    lines.push("enabled = true");
    lines.push(
      `trusted_hash = ${JSON.stringify(codexTrustedHashForInstalledHandler(event, commands, "win32"))}`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

describe("Codex capability environment inspection", () => {
  it("matches the pinned Codex canonical trust hash", () => {
    expect(codexTrustedHashForInstalledHandler("SessionStart", commands, "win32")).toBe(
      "sha256:696f45eff4a63ba6ababcf71061e1df9ec9865cd556e88f7089dce02310b8d7d",
    );
    expect(codexTrustedHashForInstalledHandler("UserPromptSubmit", commands, "win32")).toBe(
      "sha256:58759ec711d2319d6ce2cc4c402b20fac87eb110d4ff45f1c66708a6a2b7b751",
    );
  });

  it("reports exact default-enabled Hooks as needing trust when state is absent", async () => {
    const setup = await fixture();
    await writeFile(
      setup.hooksPath,
      serializeCodexHookConfigurationJson(exactDocument()),
    );
    expect(
      await inspectCodexCapabilityEnvironment({
        ...setup,
        launcherCommands: commands,
        platform: "win32",
      }),
    ).toEqual({
      configurationState: "exact",
      hookEngineState: "enabled",
      trustState: "needs_trust",
      managedPolicyState: "unknown",
      verifiedSourceSurfaces: [],
    });
  });

  it("proves trusted and unrestricted only from exact state and explicit policy", async () => {
    const setup = await fixture();
    await writeFile(
      setup.hooksPath,
      serializeCodexHookConfigurationJson(exactDocument(true)),
    );
    await writeFile(setup.configPath, trustedConfig(setup.hooksPath, true));
    await writeFile(setup.requirementsPath, "allow_managed_hooks_only = false\n");
    expect(
      await inspectCodexCapabilityEnvironment({
        ...setup,
        launcherCommands: commands,
        platform: "win32",
      }),
    ).toEqual({
      configurationState: "exact",
      hookEngineState: "enabled",
      trustState: "trusted",
      managedPolicyState: "unrestricted",
      verifiedSourceSurfaces: [],
    });
  });

  it("reports explicit disable, stale trust, and managed-only policy without mutation", async () => {
    const setup = await fixture();
    const hooksText = serializeCodexHookConfigurationJson(exactDocument());
    await writeFile(setup.hooksPath, hooksText);
    const config = trustedConfig(setup.hooksPath).replace(
      "[features]\nhooks = true",
      "[features]\nhooks = false",
    ).replace(/trusted_hash = "sha256:[0-9a-f]{64}"/u, `trusted_hash = "sha256:${"0".repeat(64)}"`);
    await writeFile(setup.configPath, config);
    await writeFile(setup.requirementsPath, "allow_managed_hooks_only = true\n");
    expect(
      await inspectCodexCapabilityEnvironment({
        ...setup,
        launcherCommands: commands,
        platform: "win32",
      }),
    ).toMatchObject({
      configurationState: "exact",
      hookEngineState: "disabled",
      trustState: "needs_trust",
      managedPolicyState: "managed_only",
    });
    expect(await import("node:fs/promises").then(({ readFile }) => readFile(setup.hooksPath, "utf8"))).toBe(
      hooksText,
    );
  });

  it("fails closed for malformed Hooks or conflicting feature aliases", async () => {
    const setup = await fixture();
    await writeFile(setup.hooksPath, '{"hooks":{},"hooks":{}}\n');
    expect(
      await inspectCodexCapabilityEnvironment({
        ...setup,
        launcherCommands: commands,
        platform: "win32",
      }),
    ).toMatchObject({
      configurationState: "invalid",
      hookEngineState: "unknown",
      trustState: "unknown",
    });

    await writeFile(
      setup.hooksPath,
      serializeCodexHookConfigurationJson(exactDocument()),
    );
    await writeFile(setup.configPath, "[features]\nhooks = true\ncodex_hooks = false\n");
    expect(
      await inspectCodexCapabilityEnvironment({
        ...setup,
        launcherCommands: commands,
        platform: "win32",
      }),
    ).toMatchObject({
      configurationState: "exact",
      hookEngineState: "unknown",
      trustState: "unknown",
    });
  });
});
