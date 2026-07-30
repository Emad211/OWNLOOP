import { Buffer } from "node:buffer";
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

function encodedPowerShellUtf8Value(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`;
}

function encodedPowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function applyScript(path: string, userSid: string): string {
  return [
    "$ErrorActionPreference='Stop'",
    `$TargetPath=${encodedPowerShellUtf8Value(path)}`,
    `$UserSid=${encodedPowerShellUtf8Value(userSid)}`,
    "if(-not [System.IO.Directory]::Exists($TargetPath)){throw 'missing_directory'}",
    "$sid=[System.Security.Principal.SecurityIdentifier]::new($UserSid)",
    "$acl=[System.Security.AccessControl.DirectorySecurity]::new()",
    "$acl.SetAccessRuleProtection($true,$false)",
    "$inheritance=[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit",
    "$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)",
    "$acl.AddAccessRule($rule)",
    "[System.IO.Directory]::SetAccessControl($TargetPath,$acl)",
  ].join(";");
}

function verifyScript(path: string): string {
  return [
    "$ErrorActionPreference='Stop'",
    `$TargetPath=${encodedPowerShellUtf8Value(path)}`,
    "if(-not [System.IO.Directory]::Exists($TargetPath)){throw 'missing_directory'}",
    "$acl=[System.IO.Directory]::GetAccessControl($TargetPath,[System.Security.AccessControl.AccessControlSections]::Access)",
    "$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])",
    "$jsonEntries=[System.Collections.Generic.List[string]]::new()",
    "for($index=0;$index -lt $rules.Count;$index++){$entry=$rules[$index];$sidValue=$entry.IdentityReference.Value;$typeValue=$entry.AccessControlType.ToString();$rightsValue=$entry.FileSystemRights.ToString();$inheritanceValue=$entry.InheritanceFlags.ToString();$propagationValue=$entry.PropagationFlags.ToString();$inheritedValue=$entry.IsInherited.ToString().ToLowerInvariant();if(-not [System.Text.RegularExpressions.Regex]::IsMatch($sidValue,'^S-1-[0-9]+(?:-[0-9]+)+$')){throw 'invalid_acl_sid'};foreach($enumValue in @($typeValue,$rightsValue,$inheritanceValue,$propagationValue)){if(-not [System.Text.RegularExpressions.Regex]::IsMatch($enumValue,'^[A-Za-z]+(?:, [A-Za-z]+)*$')){throw 'invalid_acl_enum'}};$ignored=$jsonEntries.Add('{\"sid\":\"'+$sidValue+'\",\"type\":\"'+$typeValue+'\",\"rights\":\"'+$rightsValue+'\",\"inheritance\":\"'+$inheritanceValue+'\",\"propagation\":\"'+$propagationValue+'\",\"inherited\":'+$inheritedValue+'}')}",
    "$protectedValue=$acl.AreAccessRulesProtected.ToString().ToLowerInvariant()",
    "$json='{\"protected\":'+$protectedValue+',\"entries\":['+[string]::Join(',',$jsonEntries)+']}'",
    "[Console]::Out.Write($json)",
  ].join(";");
}

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
      "-EncodedCommand",
      encodedPowerShellCommand(applyScript(path, userSid)),
    ],
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedPowerShellCommand(verifyScript(path)),
    ],
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
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AclBoundaryError("verification_failed");
    }
    const record = entry as Record<string, unknown>;
    const inheritance = String(record.inheritance)
      .split(",")
      .map((part) => part.trim());
    if (
      record.sid !== userSid ||
      record.type !== "Allow" ||
      record.inherited !== false ||
      record.propagation !== "None" ||
      !String(record.rights)
        .split(",")
        .map((part) => part.trim())
        .includes("FullControl") ||
      !inheritance.includes("ContainerInherit") ||
      !inheritance.includes("ObjectInherit")
    ) {
      throw new AclBoundaryError("verification_failed");
    }
  } catch (error) {
    if (error instanceof AclBoundaryError) throw error;
    throw new AclBoundaryError("verification_failed");
  }
}
