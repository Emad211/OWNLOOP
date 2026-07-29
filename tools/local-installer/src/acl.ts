import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseStrictJsonObject } from "./strict-json.js";

const execFileAsync = promisify(execFile);
const SID_PATTERN = /^S-1-[0-9]+(?:-[0-9]+)+$/u;

export class AclBoundaryError extends Error {
  readonly code: "invalid_sid" | "apply_failed" | "verification_failed";
  constructor(code: AclBoundaryError["code"]) {
    super("The current-user-only Windows ACL boundary could not be established.");
    this.name = "AclBoundaryError";
    this.code = code;
  }
}

export type AclCommandRunner = (
  executable: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

const APPLY_SCRIPT = [
  "param([string]$TargetPath,[string]$UserSid)",
  "$ErrorActionPreference='Stop'",
  "$acl=Get-Acl -LiteralPath $TargetPath",
  "$acl.SetAccessRuleProtection($true,$false)",
  "@($acl.Access)|ForEach-Object{$acl.RemoveAccessRuleAll($_)}",
  "$sid=[System.Security.Principal.SecurityIdentifier]::new($UserSid)",
  "$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
  "$acl.AddAccessRule($rule)",
  "Set-Acl -LiteralPath $TargetPath -AclObject $acl",
].join(";");

const VERIFY_SCRIPT = [
  "param([string]$TargetPath)",
  "$ErrorActionPreference='Stop'",
  "$acl=Get-Acl -LiteralPath $TargetPath",
  "$entries=@($acl.Access|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString()}})",
  "[pscustomobject]@{protected=$acl.AreAccessRulesProtected;entries=$entries}|ConvertTo-Json -Compress -Depth 4",
].join(";");

async function defaultRunner(executable: string, args: readonly string[]) {
  const result = await execFileAsync(executable, [...args], { windowsHide: true, timeout: 10_000 });
  return { stdout: result.stdout, stderr: result.stderr };
}

export function buildPrivateAclCommands(
  path: string,
  userSid: string,
): readonly (readonly string[])[] {
  if (!SID_PATTERN.test(userSid)) throw new AclBoundaryError("invalid_sid");
  return [
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      APPLY_SCRIPT,
      "-TargetPath",
      path,
      "-UserSid",
      userSid,
    ],
    ["-NoProfile", "-NonInteractive", "-Command", VERIFY_SCRIPT, "-TargetPath", path],
  ] as const;
}

export async function ensurePrivateWindowsAcl(
  path: string,
  userSid: string,
  runner: AclCommandRunner = defaultRunner,
): Promise<void> {
  const commands = buildPrivateAclCommands(path, userSid);
  const apply = commands[0]!;
  const verify = commands[1]!;
  try {
    await runner("powershell.exe", apply);
  } catch {
    throw new AclBoundaryError("apply_failed");
  }
  let stdout: string;
  try {
    ({ stdout } = await runner("powershell.exe", verify));
  } catch {
    throw new AclBoundaryError("verification_failed");
  }
  try {
    const parsed = parseStrictJsonObject(stdout.trim(), 64 * 1024);
    const entries = parsed.entries;
    if (parsed.protected !== true || !Array.isArray(entries) || entries.length !== 1) {
      throw new AclBoundaryError("verification_failed");
    }
    const entry = entries[0];
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      (entry as Record<string, unknown>).sid !== userSid ||
      (entry as Record<string, unknown>).type !== "Allow" ||
      !String((entry as Record<string, unknown>).rights)
        .split(",")
        .map((part) => part.trim())
        .includes("FullControl")
    ) {
      throw new AclBoundaryError("verification_failed");
    }
  } catch (error) {
    if (error instanceof AclBoundaryError) throw error;
    throw new AclBoundaryError("verification_failed");
  }
}
