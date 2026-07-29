#!/usr/bin/env node

import { join, resolve } from "node:path";

import { launchInstalledHookAdapter } from "./hook-launcher.js";
import { createNativeInstallLayout } from "./installer-transaction.js";

async function main(): Promise<void> {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData === undefined) return;
    const layout = createNativeInstallLayout(join(resolve(localAppData), "OwnLoop"));
    await launchInstalledHookAdapter({
      ...layout,
      stableHookLauncherPath: layout.stableHookLauncherPath,
    });
  } catch {
    // Installed Hook launch is observational, silent, and fail-open.
  }
}

void main().finally(() => {
  process.exitCode = 0;
});
