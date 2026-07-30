import {
  OwnLoopRuntimeStatusResponseV1Schema,
  type OwnLoopInstallationSecretsV1,
  type OwnLoopInstallManifestV1,
  type OwnLoopReleaseManifestV1,
  type OwnLoopRuntimeStateV1,
  type OwnLoopRuntimeStatusResponseV1,
} from "@ownloop/contracts";

import { readInstalledRuntimeState } from "./runtime-state-file.js";
import { readInstallManifest } from "./install-manifest.js";
import { readAndVerifyReleasePackage } from "./manifest.js";
import { readInstallationSecrets } from "./secrets.js";

export const RUNTIME_PROBE_RESULTS = ["stopped", "running", "stale", "repair_needed"] as const;
export type RuntimeProbeResult = (typeof RUNTIME_PROBE_RESULTS)[number];

export type RuntimeProbe = Readonly<{
  result: RuntimeProbeResult;
  state: OwnLoopRuntimeStateV1 | null;
  status: OwnLoopRuntimeStatusResponseV1 | null;
}>;

export type RuntimeProcessInspector = Readonly<{
  exists(pid: number): Promise<boolean | null>;
}>;

export type RuntimeClientPaths = Readonly<{
  runtimeStatePath: string;
  secretsPath: string;
  installManifestPath: string;
  releaseRoot: string;
}>;

export type RuntimeClientDependencies = Readonly<{
  fetchImplementation?: typeof fetch;
  processInspector?: RuntimeProcessInspector;
  timeoutMs?: number;
}>;

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 2_000;
  if (!Number.isInteger(value) || value < 1 || value > 30_000)
    throw new TypeError("Invalid runtime probe timeout.");
  return value;
}

const defaultInspector: RuntimeProcessInspector = {
  async exists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")
        return false;
      return null;
    }
  },
};

function statusMatches(
  state: OwnLoopRuntimeStateV1,
  status: OwnLoopRuntimeStatusResponseV1,
  installId: string,
  fingerprint: string,
): boolean {
  return (
    status.installId === installId &&
    status.instanceId === state.instanceId &&
    status.applicationVersion === state.applicationVersion &&
    status.daemonVersion === state.daemonVersion &&
    status.hookAdapterVersion === state.hookAdapterVersion &&
    status.pid === state.pid &&
    status.processStartIdentity === state.processStartIdentity &&
    status.port === state.port &&
    status.phase === state.phase &&
    status.startedAt === state.startedAt &&
    status.compatibility.installLayoutVersion === state.installLayoutVersion &&
    status.compatibility.releaseManifestFingerprint === fingerprint
  );
}

async function fetchStatus(
  state: OwnLoopRuntimeStateV1,
  token: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<OwnLoopRuntimeStatusResponseV1 | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    const response = await fetchImplementation(`http://127.0.0.1:${state.port}/v1/runtime/status`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status !== 200) return null;
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 16 * 1024) return null;
    return OwnLoopRuntimeStatusResponseV1Schema.parse(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeInstalledRuntime(
  paths: RuntimeClientPaths,
  dependencies: RuntimeClientDependencies = {},
): Promise<RuntimeProbe> {
  let state: OwnLoopRuntimeStateV1 | null;
  try {
    state = await readInstalledRuntimeState(paths.runtimeStatePath);
  } catch {
    return { result: "repair_needed", state: null, status: null };
  }
  if (state === null) return { result: "stopped", state: null, status: null };

  let installation: OwnLoopInstallManifestV1;
  let release: OwnLoopReleaseManifestV1;
  let secrets: OwnLoopInstallationSecretsV1 | null;
  try {
    installation = await readInstallManifest(paths.installManifestPath);
    release = await readAndVerifyReleasePackage(paths.releaseRoot);
    secrets = await readInstallationSecrets(paths.secretsPath);
  } catch {
    return { result: "repair_needed", state, status: null };
  }
  if (
    secrets === null ||
    state.installId !== installation.installId ||
    secrets.installId !== installation.installId ||
    installation.releaseManifestFingerprint !== release.fingerprint
  ) {
    return { result: "repair_needed", state, status: null };
  }

  const status = await fetchStatus(
    state,
    secrets.installationToken,
    dependencies.fetchImplementation ?? fetch,
    boundedTimeout(dependencies.timeoutMs),
  );
  if (
    status !== null &&
    statusMatches(state, status, installation.installId, release.fingerprint)
  ) {
    return { result: "running", state, status };
  }
  const exists = await (dependencies.processInspector ?? defaultInspector)
    .exists(state.pid)
    .catch(() => null);
  return { result: exists === false ? "stale" : "repair_needed", state, status: null };
}
