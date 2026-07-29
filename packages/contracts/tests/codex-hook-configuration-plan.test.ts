import { describe, expect, it } from "vitest";

import {
  inspectCodexHookConfiguration,
  parseCodexHookConfigurationJson,
  planCodexHookConfigurationMutation,
  type CodexHookLauncherCommands,
} from "../src/codex.js";

const COMMANDS: CodexHookLauncherCommands = {
  command: "ownloop-codex-hook",
  commandWindows: '"C:\\Users\\Fixture\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd"',
};

describe("Codex Hook configuration transaction plans", () => {
  it("plans deterministic creation for a missing file", () => {
    const plan = planCodexHookConfigurationMutation("install", null, COMMANDS);
    expect(plan).toMatchObject({
      operation: "install",
      sourceExisted: false,
      changed: true,
      before: { state: "missing" },
      after: { state: "exact" },
    });
    expect(plan.outputJson).not.toBeNull();
    const output = parseCodexHookConfigurationJson(plan.outputJson ?? "");
    expect(inspectCodexHookConfiguration(output, COMMANDS).state).toBe("exact");
  });

  it("returns no output for an exact install no-op and preserves source bytes by contract", () => {
    const first = planCodexHookConfigurationMutation("install", null, COMMANDS);
    const source = `  ${first.outputJson ?? ""}`;
    const second = planCodexHookConfigurationMutation("install", source, COMMANDS);
    expect(second).toMatchObject({
      sourceExisted: true,
      changed: false,
      before: { state: "exact" },
      after: { state: "exact" },
      outputJson: null,
    });
  });

  it("returns no output when removing from a missing or unrelated configuration", () => {
    expect(planCodexHookConfigurationMutation("remove", null, COMMANDS)).toMatchObject({
      sourceExisted: false,
      changed: false,
      before: { state: "missing" },
      outputJson: null,
    });
    const unrelated = '{"description":"user config","hooks":{"FutureEvent":[]}}\n';
    expect(planCodexHookConfigurationMutation("remove", unrelated, COMMANDS)).toMatchObject({
      sourceExisted: true,
      changed: false,
      outputJson: null,
    });
  });

  it("plans exact-only removal while preserving unrelated semantic content", () => {
    const installed = planCodexHookConfigurationMutation(
      "install",
      '{"description":"user config","future":{"enabled":true}}',
      COMMANDS,
    );
    const removed = planCodexHookConfigurationMutation("remove", installed.outputJson, COMMANDS);
    expect(removed).toMatchObject({
      changed: true,
      before: { state: "exact" },
      after: { state: "missing" },
    });
    expect(parseCodexHookConfigurationJson(removed.outputJson ?? "")).toMatchObject({
      description: "user config",
      future: { enabled: true },
    });
    expect(removed.outputJson).not.toContain("ownloop-codex-hook");
  });

  it("produces byte-identical plans for semantically equivalent source JSON", () => {
    const first = planCodexHookConfigurationMutation(
      "install",
      '{"z":1,"description":"fixture"}',
      COMMANDS,
    );
    const second = planCodexHookConfigurationMutation(
      "install",
      '{\n  "description": "fixture",\n  "z": 1\n}',
      COMMANDS,
    );
    expect(first.outputJson).toBe(second.outputJson);
  });

  it("fails closed before producing a plan for duplicate or ambiguous entries", () => {
    expect(() =>
      planCodexHookConfigurationMutation("install", '{"hooks":{},"hooks":[]}', COMMANDS),
    ).toThrow();

    const installed = planCodexHookConfigurationMutation("install", null, COMMANDS);
    const document = parseCodexHookConfigurationJson(installed.outputJson ?? "");
    const hookMap = document.hooks as Record<string, unknown>;
    const groups = hookMap.Stop as unknown[];
    groups.push(structuredClone(groups[0]));
    expect(() =>
      planCodexHookConfigurationMutation("remove", JSON.stringify(document), COMMANDS),
    ).toThrow();
  });
});
