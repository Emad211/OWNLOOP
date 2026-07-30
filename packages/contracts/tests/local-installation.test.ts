import { describe, expect, it } from "vitest";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_DAEMON_VERSION,
  OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
  OWNLOOP_HOOK_ADAPTER_VERSION,
  OWNLOOP_INSTALL_LAYOUT_VERSION,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION,
  OwnLoopInstallationSecretsV1Schema,
  OwnLoopInstallManifestV1Schema,
  OwnLoopReleaseManifestV1Schema,
  OwnLoopRuntimeShutdownRequestV1Schema,
  OwnLoopRuntimeStateV1Schema,
  OwnLoopRuntimeStatusResponseV1Schema,
  SUPPORTED_CLAUDE_HOOK_NAMES,
} from "../src/index.js";

const timestamp = "2026-07-26T12:00:00.000Z";
const fingerprint = `sha256:${"a".repeat(64)}`;
const secretA = "A".repeat(43);
const secretB = "B".repeat(43);

function releaseManifest() {
  return {
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
      { path: "web/index.html", sizeBytes: 2, sha256: "c".repeat(64), executableCritical: false },
    ],
    fingerprint,
  } as const;
}

function runtimeStatus() {
  return {
    ok: true,
    schemaVersion: OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION,
    installId: "install_1",
    instanceId: "instance_1",
    applicationVersion: OWNLOOP_APPLICATION_VERSION,
    daemonVersion: OWNLOOP_DAEMON_VERSION,
    hookAdapterVersion: OWNLOOP_HOOK_ADAPTER_VERSION,
    pid: 123,
    processStartIdentity: "123.456",
    port: 43123,
    phase: "ready",
    pumpState: "idle",
    startedAt: timestamp,
    compatibility: {
      platform: "win32",
      architecture: "x64",
      nodeVersion: OWNLOOP_REQUIRED_NODE_VERSION,
      databaseSchemaVersion: OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
      installLayoutVersion: OWNLOOP_INSTALL_LAYOUT_VERSION,
      releaseManifestFingerprint: fingerprint,
    },
  } as const;
}

describe("local installation contracts", () => {
  it("accepts one canonical release manifest and rejects reordered, traversal, or extra fields", () => {
    expect(OwnLoopReleaseManifestV1Schema.parse(releaseManifest()).files).toHaveLength(2);
    expect(() =>
      OwnLoopReleaseManifestV1Schema.parse({
        ...releaseManifest(),
        files: [...releaseManifest().files].reverse(),
      }),
    ).toThrow();
    expect(() =>
      OwnLoopReleaseManifestV1Schema.parse({
        ...releaseManifest(),
        files: [{ ...releaseManifest().files[0], path: "../escape" }],
      }),
    ).toThrow();
    expect(() =>
      OwnLoopReleaseManifestV1Schema.parse({ ...releaseManifest(), rawPath: "C:\\x" }),
    ).toThrow();

    expect(
      OwnLoopReleaseManifestV1Schema.parse({
        ...releaseManifest(),
        files: [
          {
            path: "daemon/node_modules/@fastify/forwarded/dir with spaces/test-package.zip",
            sizeBytes: 1,
            sha256: "b".repeat(64),
            executableCritical: true,
          },
          releaseManifest().files[1],
        ],
      }).files[0]?.path,
    ).toContain("@fastify");

    for (const path of [
      "daemon/../escape.js",
      "daemon/node_modules/bad?.js",
      "daemon/node_modules/CON/readme.txt",
      "daemon/node_modules/trailing./index.js",
      "daemon/node_modules/ trailing/index.js",
    ]) {
      expect(() =>
        OwnLoopReleaseManifestV1Schema.parse({
          ...releaseManifest(),
          files: [{ ...releaseManifest().files[0], path }, releaseManifest().files[1]],
        }),
      ).toThrow();
    }
  });

  it("requires distinct canonical installation secrets", () => {
    expect(
      OwnLoopInstallationSecretsV1Schema.parse({
        schemaVersion: 1,
        installId: "install_1",
        installationToken: secretA,
        hmacKey: secretB,
        createdAt: timestamp,
      }).installationToken,
    ).toBe(secretA);
    expect(() =>
      OwnLoopInstallationSecretsV1Schema.parse({
        schemaVersion: 1,
        installId: "install_1",
        installationToken: secretA,
        hmacKey: secretA,
        createdAt: timestamp,
      }),
    ).toThrow();
  });

  it("requires exactly one fixed command record for every supported Hook event", () => {
    const hooks = SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
      event,
      command: "C:\\Users\\founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-hook.cmd",
    }));
    expect(
      OwnLoopInstallManifestV1Schema.parse({
        schemaVersion: 1,
        installId: "install_1",
        applicationVersion: "0.1.0",
        releaseDirectoryName: "0.1.0",
        releaseManifestFingerprint: fingerprint,
        installLayoutVersion: 1,
        hooks,
        claudeSettings: {
          settingsFileCreated: false,
          hooksContainerCreated: false,
          createdEventContainers: [],
        },
        installedAt: timestamp,
      }).hooks,
    ).toHaveLength(9);
    expect(() =>
      OwnLoopInstallManifestV1Schema.parse({
        schemaVersion: 1,
        installId: "install_1",
        applicationVersion: "0.1.0",
        releaseDirectoryName: "0.1.0",
        releaseManifestFingerprint: fingerprint,
        installLayoutVersion: 1,
        hooks: hooks.slice(0, -1),
        claudeSettings: {
          settingsFileCreated: false,
          hooksContainerCreated: false,
          createdEventContainers: [],
        },
        installedAt: timestamp,
      }),
    ).toThrow();
  });

  it("strictly validates runtime state, status reconciliation, and shutdown request", () => {
    expect(
      OwnLoopRuntimeStateV1Schema.parse({
        schemaVersion: 1,
        installId: "install_1",
        applicationVersion: "0.1.0",
        daemonVersion: "0.1.0",
        hookAdapterVersion: "0.1.0",
        installLayoutVersion: 1,
        instanceId: "instance_1",
        pid: 123,
        processStartIdentity: "123.456",
        port: 43123,
        phase: "ready",
        startedAt: timestamp,
        updatedAt: timestamp,
      }).phase,
    ).toBe("ready");
    expect(OwnLoopRuntimeStatusResponseV1Schema.parse(runtimeStatus()).pumpState).toBe("idle");
    expect(() =>
      OwnLoopRuntimeStatusResponseV1Schema.parse({
        ...runtimeStatus(),
        phase: "stopping",
        pumpState: "running",
      }),
    ).toThrow();
    expect(() =>
      OwnLoopRuntimeShutdownRequestV1Schema.parse({
        schemaVersion: 1,
        instanceId: "instance_1",
        extra: true,
      }),
    ).toThrow();
  });
});
