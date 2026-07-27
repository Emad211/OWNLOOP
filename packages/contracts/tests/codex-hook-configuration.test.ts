import { describe, expect, it } from "vitest";

import {
  type CodexHookLauncherCommands,
  inspectCodexHookConfiguration,
  installCodexHookConfiguration,
  removeCodexHookConfiguration,
  SUPPORTED_CODEX_HOOK_NAMES,
} from "../src/codex.js";

const COMMANDS: CodexHookLauncherCommands = {
  command: "ownloop-codex-hook",
  commandWindows: '"C:\\Users\\Fixture\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd"',
};

function installedDocument(): Record<string, unknown> {
  return installCodexHookConfiguration({}, COMMANDS).document;
}

function hooks(document: Record<string, unknown>): Record<string, unknown> {
  const value = document.hooks;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a Hook map fixture.");
  }
  return value as Record<string, unknown>;
}

describe("Codex Hook configuration core", () => {
  it("installs exactly one isolated handler for all 11 Hooks and is idempotent", () => {
    const input = {};
    const first = installCodexHookConfiguration(input, COMMANDS);
    expect(input).toEqual({});
    expect(first.changed).toBe(true);
    expect(first.inspection).toMatchObject({
      state: "exact",
      exactHookNames: SUPPORTED_CODEX_HOOK_NAMES,
      missingHookNames: [],
      ambiguousHookNames: [],
    });
    for (const hookName of SUPPORTED_CODEX_HOOK_NAMES) {
      expect(hooks(first.document)[hookName]).toEqual([
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: COMMANDS.command,
              commandWindows: COMMANDS.commandWindows,
              timeout: 5,
              async: false,
              additionalContextLimit: 0,
            },
          ],
        },
      ]);
    }

    const second = installCodexHookConfiguration(first.document, COMMANDS);
    expect(second.changed).toBe(false);
    expect(second.document).toEqual(first.document);
  });

  it("preserves unknown top-level fields, unknown events, and unrelated handlers", () => {
    const unrelated = {
      matcher: "shell_command",
      hooks: [{ type: "command", command: "other-tool", timeout: 3 }],
    };
    const input = {
      description: "User configuration",
      futureTopLevel: { retained: true },
      hooks: {
        PreToolUse: [unrelated],
        FutureEvent: [{ matcher: "*", hooks: [{ type: "command", command: "future" }] }],
      },
    };
    const result = installCodexHookConfiguration(input, COMMANDS);
    expect(result.document).toMatchObject({
      description: "User configuration",
      futureTopLevel: { retained: true },
      hooks: {
        FutureEvent: [{ matcher: "*", hooks: [{ type: "command", command: "future" }] }],
      },
    });
    expect((hooks(result.document).PreToolUse as unknown[])[0]).toEqual(unrelated);
  });

  it("repairs a non-ambiguous partial installation", () => {
    const partial = installedDocument();
    hooks(partial).SessionEnd = [];
    expect(inspectCodexHookConfiguration(partial, COMMANDS)).toMatchObject({
      state: "partial",
      missingHookNames: ["SessionEnd"],
    });
    const repaired = installCodexHookConfiguration(partial, COMMANDS);
    expect(repaired.changed).toBe(true);
    expect(repaired.inspection.state).toBe("exact");
  });

  it("fails closed for modified or duplicate OwnLoop-like entries", () => {
    const modified = installedDocument();
    const preToolGroups = hooks(modified).PreToolUse as Array<Record<string, unknown>>;
    const group = structuredClone(preToolGroups[0]) as Record<string, unknown>;
    const handlers = group.hooks as Array<Record<string, unknown>>;
    handlers[0] = { ...handlers[0], timeout: 99 };
    preToolGroups[0] = group;
    expect(inspectCodexHookConfiguration(modified, COMMANDS)).toMatchObject({
      state: "ambiguous",
      ambiguousHookNames: ["PreToolUse"],
    });
    expect(() => installCodexHookConfiguration(modified, COMMANDS)).toThrowError(
      expect.objectContaining({
        code: "ambiguous_ownloop_entries",
      }),
    );
    expect(() => removeCodexHookConfiguration(modified, COMMANDS)).toThrowError(
      expect.objectContaining({
        code: "ambiguous_ownloop_entries",
      }),
    );

    const duplicate = installedDocument();
    const duplicateGroups = hooks(duplicate).Stop as unknown[];
    duplicateGroups.push(structuredClone(duplicateGroups[0]));
    expect(inspectCodexHookConfiguration(duplicate, COMMANDS)).toMatchObject({
      state: "ambiguous",
      ambiguousHookNames: ["Stop"],
    });
  });

  it("removes only exact OwnLoop groups and leaves unrelated data byte-structurally intact", () => {
    const document = installedDocument();
    const unrelated = {
      matcher: "apply_patch",
      hooks: [{ type: "command", command: "user-hook", timeout: 7 }],
    };
    (hooks(document).PostToolUse as unknown[]).unshift(unrelated);
    const removed = removeCodexHookConfiguration(document, COMMANDS);
    expect(removed.changed).toBe(true);
    expect(removed.inspection.state).toBe("missing");
    expect(hooks(removed.document).PostToolUse).toEqual([unrelated]);
    expect(JSON.stringify(removed.document)).not.toContain("ownloop-codex-hook");
  });

  it("does not create a hooks object during inspection or no-op removal", () => {
    const input = { description: "empty" };
    expect(inspectCodexHookConfiguration(input, COMMANDS).state).toBe("missing");
    expect(input).toEqual({ description: "empty" });
    const removed = removeCodexHookConfiguration(input, COMMANDS);
    expect(removed.changed).toBe(false);
    expect(removed.document).toEqual(input);
  });

  it("rejects invalid documents and unsafe launcher commands", () => {
    expect(() => installCodexHookConfiguration({ hooks: [] }, COMMANDS)).toThrowError(
      expect.objectContaining({ code: "invalid_document" }),
    );
    expect(() =>
      installCodexHookConfiguration(
        {},
        { ...COMMANDS, commandWindows: "ownloop-codex-hook.cmd --port 1234" },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_launcher_command" }));
    expect(() =>
      installCodexHookConfiguration(
        {},
        { ...COMMANDS, command: "ownloop-codex-hook --token secret" },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_launcher_command" }));
    expect(() =>
      installCodexHookConfiguration(
        {},
        {
          ...COMMANDS,
          commandWindows:
            '"C:\\Users\\Fixture\\AppData\\Local\\OwnLoop\\app\\0.1.0\\ownloop-codex-hook.cmd"',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_launcher_command" }));
  });
});
