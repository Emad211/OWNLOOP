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
    const [apply] = buildPrivateAclCommands(root, userSid);

    try {
      await execFileAsync("powershell.exe", [...apply!], { windowsHide: true, timeout: 10_000 });
    } catch (error) {
      throw new Error(`Native Windows ACL apply command failed: ${nativeFailureDetails(error)}`);
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
