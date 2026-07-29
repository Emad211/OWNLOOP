import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const scriptsRoot = resolve("tools/local-installer/scripts");

async function script(name: string): Promise<string> {
  return readFile(resolve(scriptsRoot, name), "utf8");
}

describe("Windows launcher scripts", () => {
  it("keeps the installed Hook launcher silent and fail-open", async () => {
    const value = await script("installed-ownloop-hook.cmd");
    expect(value).toContain(">nul 2>&1");
    expect(value).toContain("exit /b 0");
    expect(value).toContain("%LOCALAPPDATA%\\OwnLoop\\app\\0.1.0\\installer\\dist\\hook-main.js");
    expect(value).not.toContain("install-manifest");
    expect(value).not.toContain("OWNLOOP_INSTALLATION_TOKEN");
  });

  it("suppresses raw Node and PowerShell stderr while preserving controlled CLI JSON", async () => {
    const installed = await script("installed-ownloop.cmd");
    expect(installed).toContain("installer\\dist\\cli.js");
    expect(installed).toContain("2>nul");
    expect(installed).not.toContain("install-manifest");

    const cmd = await script("ownloop.cmd");
    expect(cmd).toContain("-NonInteractive");
    expect(cmd).toContain("2>nul");

    const powershell = await script("ownloop.ps1");
    expect(powershell).toContain("ConvertFrom-Json");
    expect(powershell).toContain(
      '$ControlledFailure = \'{"ok":false,"error":{"code":"operation_failed"}}\'',
    );
    expect(powershell).toContain("2>$null");
    expect(powershell).not.toContain("Write-Error");
    expect(powershell).not.toContain("$_.Exception");
  });
});
