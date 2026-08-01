import {
  type CodexCapabilityStatusV1,
  type CodexHookLauncherCommands,
  CodexCapabilityStatusV1Schema,
  CODEX_HOOK_LAUNCHER_BASENAME,
  projectCodexCapabilityStatusV1,
} from "@ownloop/contracts/codex";

import { inspectCodexHooksFile, type CodexHooksStatus } from "./codex-hooks-file.js";
import { readInstallManifest } from "./install-manifest.js";
import {
  probeInstalledRuntime,
  type RuntimeClientDependencies,
  type RuntimeClientPaths,
  type RuntimeProbeResult,
} from "./runtime-client.js";
import { readInstallationSecrets } from "./secrets.js";

const CODEX_CAPABILITY_ROUTE = "/v1/diagnostics/codex";
const CODEX_CAPABILITY_MAX_BYTES = 128 * 1024;

export type CodexDoctorPaths = RuntimeClientPaths &
  Readonly<{
    codexSettingsPath: string;
    stableCodexHookLauncherPath: string;
  }>;

export type CodexDoctorDiagnostic = "daemon_capability_unavailable" | null;

export type CodexDoctorResult = Readonly<{
  source: "daemon" | "local";
  runtime: RuntimeProbeResult;
  capability: CodexCapabilityStatusV1;
  diagnostic: CodexDoctorDiagnostic;
}>;

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 2_000;
  if (!Number.isInteger(value) || value < 1 || value > 30_000) {
    throw new TypeError("Invalid Codex doctor timeout.");
  }
  return value;
}

function launcherCommands(paths: CodexDoctorPaths): CodexHookLauncherCommands {
  return {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: paths.stableCodexHookLauncherPath,
  };
}

function localCapability(status: CodexHooksStatus): CodexCapabilityStatusV1 {
  const missing = status === "missing";
  return projectCodexCapabilityStatusV1({
    configurationState: missing ? "missing" : status === "installed" ? "exact" : "ambiguous",
    hookEngineState: "unknown",
    trustState: missing ? "not_applicable" : "unknown",
    managedPolicyState: "unknown",
    observedHookNames: [],
    observedSourceSurfaces: [],
    observedSourceVersions: [],
    lastObservedAt: null,
    limitations: missing
      ? ["hook_engine_unknown", "managed_policy_unknown"]
      : ["hook_engine_unknown", "managed_policy_unknown", "trust_unknown"],
  });
}

async function readBoundedResponse(response: Response): Promise<string | null> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) return null;
      total += value.byteLength;
      if (total > CODEX_CAPABILITY_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
      total,
    ).toString("utf8");
  } catch {
    return null;
  }
}

async function fetchCapability(
  port: number,
  token: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<CodexCapabilityStatusV1 | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    const response = await fetchImplementation(
      `http://127.0.0.1:${port}${CODEX_CAPABILITY_ROUTE}`,
      {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (
      response.status !== 200 ||
      response.headers.get("cache-control") !== "no-store" ||
      response.headers.get("x-content-type-options") !== "nosniff"
    ) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await readBoundedResponse(response);
    if (text === null) return null;
    return CodexCapabilityStatusV1Schema.parse(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCodexDoctor(
  paths: CodexDoctorPaths,
  dependencies: RuntimeClientDependencies = {},
): Promise<CodexDoctorResult> {
  const runtime = await probeInstalledRuntime(paths, dependencies);
  if (runtime.result === "running" && runtime.state !== null) {
    try {
      const [manifest, secrets] = await Promise.all([
        readInstallManifest(paths.installManifestPath),
        readInstallationSecrets(paths.secretsPath),
      ]);
      if (secrets !== null && secrets.installId === manifest.installId) {
        const capability = await fetchCapability(
          runtime.state.port,
          secrets.installationToken,
          dependencies.fetchImplementation ?? fetch,
          boundedTimeout(dependencies.timeoutMs),
        );
        if (capability !== null) {
          return { source: "daemon", runtime: runtime.result, capability, diagnostic: null };
        }
      }
    } catch {
      // Fall through to the privacy-bounded local-only projection.
    }
  }

  const status = await inspectCodexHooksFile(paths.codexSettingsPath, launcherCommands(paths));
  return {
    source: "local",
    runtime: runtime.result,
    capability: localCapability(status),
    diagnostic: runtime.result === "running" ? "daemon_capability_unavailable" : null,
  };
}
