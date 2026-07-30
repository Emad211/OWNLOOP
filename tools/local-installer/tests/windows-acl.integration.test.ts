import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

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
  });
});
