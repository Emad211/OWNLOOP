import { win32 } from "node:path";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_INSTALL_MANIFEST_FILE,
  OWNLOOP_RUNTIME_STATE_FILE,
  OWNLOOP_SECRETS_FILE,
} from "@ownloop/contracts";

export type WindowsInstallLayout = Readonly<{
  root: string;
  appRoot: string;
  releaseRoot: string;
  binRoot: string;
  configRoot: string;
  dataRoot: string;
  artifactRoot: string;
  databasePath: string;
  runRoot: string;
  installManifestPath: string;
  secretsPath: string;
  runtimeStatePath: string;
}>;

export class InstallLayoutError extends Error {
  readonly code: "invalid_local_app_data" | "layout_mismatch";
  constructor(code: InstallLayoutError["code"]) {
    super("The Windows per-user install layout is invalid.");
    this.name = "InstallLayoutError";
    this.code = code;
  }
}

function normalize(value: string): string {
  return win32.normalize(value).toLowerCase();
}

export function createWindowsInstallLayout(localAppData: string): WindowsInstallLayout {
  if (!win32.isAbsolute(localAppData) || localAppData.includes("\0")) {
    throw new InstallLayoutError("invalid_local_app_data");
  }
  const localRoot = win32.resolve(localAppData);
  const root = win32.join(localRoot, "OwnLoop");
  const appRoot = win32.join(root, "app");
  const configRoot = win32.join(root, "config");
  const dataRoot = win32.join(root, "data");
  const runRoot = win32.join(root, "run");
  return Object.freeze({
    root,
    appRoot,
    releaseRoot: win32.join(appRoot, OWNLOOP_APPLICATION_VERSION),
    binRoot: win32.join(root, "bin"),
    configRoot,
    dataRoot,
    artifactRoot: win32.join(dataRoot, "artifacts"),
    databasePath: win32.join(dataRoot, "ownloop.sqlite"),
    runRoot,
    installManifestPath: win32.join(root, OWNLOOP_INSTALL_MANIFEST_FILE),
    secretsPath: win32.join(configRoot, OWNLOOP_SECRETS_FILE),
    runtimeStatePath: win32.join(runRoot, OWNLOOP_RUNTIME_STATE_FILE),
  });
}

export function assertWindowsInstallLayout(layout: WindowsInstallLayout): WindowsInstallLayout {
  const localAppData = win32.dirname(layout.root);
  const expected = createWindowsInstallLayout(localAppData);
  for (const key of Object.keys(expected) as (keyof WindowsInstallLayout)[]) {
    if (normalize(layout[key]) !== normalize(expected[key])) {
      throw new InstallLayoutError("layout_mismatch");
    }
  }
  const uniqueRoots = [
    layout.appRoot,
    layout.binRoot,
    layout.configRoot,
    layout.dataRoot,
    layout.runRoot,
  ].map(normalize);
  if (new Set(uniqueRoots).size !== uniqueRoots.length)
    throw new InstallLayoutError("layout_mismatch");
  return layout;
}
