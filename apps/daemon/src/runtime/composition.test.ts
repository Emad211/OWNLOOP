import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  type OwnLoopInstallManifestV1,
  type OwnLoopReleaseManifestV1,
  OwnLoopRuntimeStatusResponseV1Schema,
} from "@ownloop/contracts";

import { openPersistence } from "../persistence/index.js";
import { RuntimeCompatibilityError } from "./compatibility.js";
import { startProductionRuntime, type ProductionRuntime } from "./composition.js";
import { readRuntimeState } from "./state.js";

const fingerprint = `sha256:${"a".repeat(64)}` as const;
const releaseManifest: OwnLoopReleaseManifestV1 = {
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
      path: "daemon/dist/main.js",
      sizeBytes: 1,
      sha256: "b".repeat(64),
      executableCritical: true,
    },
  ],
  fingerprint,
};
const installManifest: OwnLoopInstallManifestV1 = {
  schemaVersion: 1,
  installId: "install_1",
  applicationVersion: "0.1.0",
  releaseDirectoryName: "0.1.0",
  releaseManifestFingerprint: fingerprint,
  installLayoutVersion: 1,
  hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
    event,
    command: "C:\\Users\\founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-hook.cmd",
  })),
  claudeSettings: {
    settingsFileCreated: false,
    hooksContainerCreated: false,
    createdEventContainers: [],
  },
  installedAt: "2026-07-26T12:00:00.000Z",
};

const roots: string[] = [];
const runtimes: ProductionRuntime[] = [];

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes
      .pop()
      ?.shutdown()
      .catch(() => undefined);
  }
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-composition-"));
  roots.push(root);
  const webRoot = join(root, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>OwnLoop</title>");
  return {
    root,
    databasePath: join(root, "data", "ownloop.sqlite"),
    artifactRoot: join(root, "data", "artifacts"),
    webRoot,
    runtimeStatePath: join(root, "run", "runtime-v1.json"),
  };
}

function credentials() {
  return {
    installationToken: randomBytes(32).toString("base64url"),
    hmacKey: randomBytes(32).toString("base64url"),
  };
}

async function waitForMissing(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Runtime state was not removed within the test bound.");
}

describe("production runtime composition", () => {
  it("opens real resources, publishes ready state, serves status, and shuts down through the authenticated route", async () => {
    const paths = await fixture();
    const auth = credentials();
    const runtime = await startProductionRuntime({
      ...paths,
      ...auth,
      releaseManifest,
      installManifest,
      platform: "win32",
      architecture: "x64",
      nodeVersion: "24.18.0",
      pid: 4242,
      processStartIdentity: "4242.100",
      instanceIdGenerator: () => "runtime_integration_1",
      pumpIdleDelayMs: 25,
      shutdownGraceMs: 2_000,
    });
    runtimes.push(runtime);

    const state = await readRuntimeState(paths.runtimeStatePath);
    expect(state).toMatchObject({
      instanceId: "runtime_integration_1",
      phase: "ready",
      port: runtime.address.port,
    });
    expect(JSON.stringify(state)).not.toContain(auth.installationToken);
    expect(JSON.stringify(state)).not.toContain(auth.hmacKey);

    const statusResponse = await fetch(`${runtime.address.url}/v1/runtime/status`, {
      headers: { authorization: `Bearer ${auth.installationToken}` },
    });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get("cache-control")).toBe("no-store");
    const status = OwnLoopRuntimeStatusResponseV1Schema.parse(await statusResponse.json());
    expect(status).toMatchObject({
      instanceId: "runtime_integration_1",
      port: runtime.address.port,
      phase: "ready",
      compatibility: { databaseSchemaVersion: 18 },
    });

    const page = await fetch(`${runtime.address.url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("OwnLoop");

    const shutdownResponse = await fetch(`${runtime.address.url}/v1/runtime/shutdown`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.installationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ schemaVersion: 1, instanceId: "runtime_integration_1" }),
    });
    expect(shutdownResponse.status).toBe(200);
    expect(await shutdownResponse.json()).toEqual({
      ok: true,
      schemaVersion: 1,
      instanceId: "runtime_integration_1",
      acknowledged: true,
    });
    await waitForMissing(paths.runtimeStatePath);
    runtimes.pop();

    expect(() => runtime.persistence.taskRuns.get("missing")).toThrow();
    await expect(fetch(`${runtime.address.url}/v1/runtime/status`)).rejects.toThrow();
  });

  it("recovers a stale capturing Run before starting the ordinary runtime pump", async () => {
    const paths = await fixture();
    await mkdir(join(paths.root, "data"), { recursive: true });
    const seeded = openPersistence(paths.databasePath);
    seeded.workspaces.insert({
      workspaceId: "workspace-stale",
      canonicalPath: "C:\\workspace\\project",
      repositoryRoot: "C:\\workspace\\project",
      gitRemote: null,
      initialRepositoryFingerprint: "a".repeat(64),
      identityBasis: "git_resolved_v1",
      createdAt: "2026-07-26T09:00:00.000Z",
      lastObservedAt: "2026-07-26T09:00:00.000Z",
    });
    seeded.conversations.insert({
      conversationId: "conversation-stale",
      workspaceId: "workspace-stale",
      source: "claude_code",
      sourceSessionId: "session-stale",
      startMode: "startup",
      startedAt: "2026-07-26T09:00:00.000Z",
      lastObservedAt: "2026-07-26T09:00:00.000Z",
      endedAt: null,
      status: "Active",
    });
    seeded.taskRuns.insert({
      runId: "run-stale",
      conversationId: "conversation-stale",
      runNumber: 1,
      redactedPrompt: "[REDACTED]",
      baselineGitCommit: null,
      baselineWorkingTreeFingerprint: null,
      startedAt: "2026-07-26T09:00:00.000Z",
      endedAt: null,
      status: "Capturing",
      finalGitFingerprint: null,
      sourceStopReason: null,
      evidenceGapCount: 0,
    });
    seeded.close();

    const runtime = await startProductionRuntime({
      ...paths,
      ...credentials(),
      releaseManifest,
      installManifest,
      platform: "win32",
      architecture: "x64",
      nodeVersion: "24.18.0",
      clock: () => new Date("2026-07-26T10:00:00.000Z"),
      instanceIdGenerator: () => "runtime_recovery_1",
      pumpIdleDelayMs: 100,
    });
    runtimes.push(runtime);

    expect(runtime.persistence.taskRuns.get("run-stale")).toMatchObject({
      status: "Abandoned",
      endedAt: "2026-07-26T10:00:00.000Z",
    });
    expect(runtime.persistence.runFinalizations.getByRun("run-stale")).toMatchObject({
      runId: "run-stale",
      terminalStatus: "Abandoned",
      mode: "recovery",
      diagnosticCode: "stale_capturing_recovered",
    });
    expect(runtime.persistence.events.listForRun("run-stale").map((event) => event.type)).toContain(
      "run.abandoned",
    );
  });

  it("rejects incompatibility before creating database, artifact, state, or listener resources", async () => {
    const paths = await fixture();
    let bound = false;
    await expect(
      startProductionRuntime({
        ...paths,
        ...credentials(),
        releaseManifest,
        installManifest,
        platform: "linux",
        architecture: "x64",
        nodeVersion: "24.18.0",
        onBound: () => {
          bound = true;
        },
      }),
    ).rejects.toBeInstanceOf(RuntimeCompatibilityError);

    expect(bound).toBe(false);
    await expect(access(paths.databasePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(paths.artifactRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(paths.runtimeStatePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes the bound listener and database when runtime-state publication fails", async () => {
    const paths = await fixture();
    const outside = join(paths.root, "outside-run");
    await mkdir(outside);
    const linkedRun = join(paths.root, "linked-run");
    await symlink(outside, linkedRun, "dir");
    const unsafeStatePath = join(linkedRun, "runtime-v1.json");
    let boundUrl: string | null = null;

    await expect(
      startProductionRuntime({
        ...paths,
        ...credentials(),
        runtimeStatePath: unsafeStatePath,
        releaseManifest,
        installManifest,
        platform: "win32",
        architecture: "x64",
        nodeVersion: "24.18.0",
        onBound: (address) => {
          boundUrl = address.url;
        },
      }),
    ).rejects.toMatchObject({ code: "unsafe_path" });

    expect(boundUrl).not.toBeNull();
    await expect(fetch(`${boundUrl}/v1/runtime/status`)).rejects.toThrow();
    await expect(access(unsafeStatePath)).rejects.toMatchObject({ code: "ENOENT" });

    const reopened = openPersistence(paths.databasePath);
    expect(reopened.connectionInfo).toMatchObject({ fileBacked: true, foreignKeysEnabled: true });
    expect(reopened.taskRuns.get("missing")).toBeNull();
    reopened.close();
    expect(await readFile(join(paths.webRoot, "index.html"), "utf8")).toContain("OwnLoop");
  });
});
