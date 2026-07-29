import { describe, expect, it } from "vitest";

import {
  OwnLoopInstallManifestV1Schema,
  OwnLoopReleaseManifestV1Schema,
  SUPPORTED_CLAUDE_HOOK_NAMES,
} from "@ownloop/contracts";

import { assertRuntimeCompatibility, RuntimeCompatibilityError } from "./compatibility.js";

const fingerprint = `sha256:${"a".repeat(64)}`;
const release = OwnLoopReleaseManifestV1Schema.parse({
  schemaVersion: 1,
  applicationVersion: "0.1.0",
  daemonVersion: "0.1.0",
  hookAdapterVersion: "0.1.0",
  hookAdapterContractVersion: 1,
  webVersion: "0.1.0",
  expectedDatabaseSchemaVersion: 18,
  platform: "win32",
  architecture: "x64",
  nodeVersion: "24.18.0",
  packagingPnpmVersion: "11.4.0",
  installLayoutVersion: 1,
  files: [
    {
      path: "daemon/dist/index.js",
      sizeBytes: 1,
      sha256: "b".repeat(64),
      executableCritical: true,
    },
  ],
  fingerprint,
});
const installation = OwnLoopInstallManifestV1Schema.parse({
  schemaVersion: 1,
  installId: "install_1",
  applicationVersion: "0.1.0",
  releaseDirectoryName: "0.1.0",
  releaseManifestFingerprint: fingerprint,
  installLayoutVersion: 1,
  hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
    event,
    command: "C:\\fixed\\ownloop-hook.cmd",
  })),
  claudeSettings: {
    settingsFileCreated: false,
    hooksContainerCreated: false,
    createdEventContainers: [],
  },
  installedAt: "2026-07-26T12:00:00.000Z",
});

describe("runtime compatibility", () => {
  it("returns one controlled compatibility tuple", () => {
    expect(
      assertRuntimeCompatibility({
        platform: "win32",
        architecture: "x64",
        nodeVersion: "24.18.0",
        releaseManifest: release,
        installManifest: installation,
      }),
    ).toMatchObject({ databaseSchemaVersion: 18, installLayoutVersion: 1 });
  });

  it("fails before runtime composition for unsupported or mismatched input", () => {
    expect(() =>
      assertRuntimeCompatibility({
        platform: "linux",
        architecture: "x64",
        nodeVersion: "24.18.0",
        releaseManifest: release,
        installManifest: installation,
      }),
    ).toThrow(RuntimeCompatibilityError);
    expect(() =>
      assertRuntimeCompatibility({
        platform: "win32",
        architecture: "x64",
        nodeVersion: "24.18.0",
        releaseManifest: release,
        installManifest: {
          ...installation,
          releaseManifestFingerprint: `sha256:${"c".repeat(64)}`,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "release_mismatch" }));
  });
});
