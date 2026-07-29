import { createSecretKey, randomUUID, type KeyObject } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_DAEMON_VERSION,
  OWNLOOP_HOOK_ADAPTER_VERSION,
  OWNLOOP_INSTALL_LAYOUT_VERSION,
  type OwnLoopInstallManifestV1,
  type OwnLoopReleaseManifestV1,
  type OwnLoopRuntimeCompatibilityV1,
  type OwnLoopRuntimeStateV1,
  type OwnLoopRuntimeStatusResponseV1,
} from "@ownloop/contracts";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import type { CandidateGenerationTransport } from "../candidate-generation/index.js";
import { recoverStaleRuns } from "../finalization/index.js";
import {
  createLoopbackIngressServer,
  type IngressServerAddress,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import { LocalSettingsService } from "../local-settings/index.js";
import { openPersistence, type OwnLoopPersistence } from "../persistence/index.js";
import { assertRuntimeCompatibility } from "./compatibility.js";
import { createSerializedRuntimePump, type SerializedRuntimePump } from "./pump.js";
import type { RuntimeRouteController } from "./routes.js";
import { RuntimeStateController } from "./state.js";
import { createProductionRuntimeStages } from "./stages.js";

const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;

export type ProductionRuntimeConfiguration = Readonly<{
  databasePath: string;
  artifactRoot: string;
  webRoot: string;
  runtimeStatePath: string;
  installationToken: string;
  hmacKey: KeyObject | string;
  installManifest: OwnLoopInstallManifestV1;
  releaseManifest: OwnLoopReleaseManifestV1;
  platform?: string;
  architecture?: string;
  nodeVersion?: string;
  pid?: number;
  processStartIdentity?: string;
  port?: number;
  pumpIdleDelayMs?: number;
  shutdownGraceMs?: number;
  clock?: () => Date;
  instanceIdGenerator?: () => string;
  transport?: CandidateGenerationTransport;
  onBound?: (address: IngressServerAddress) => void;
}>;

export type ProductionRuntime = Readonly<{
  address: IngressServerAddress;
  compatibility: OwnLoopRuntimeCompatibilityV1;
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  settings: LocalSettingsService;
  pump: SerializedRuntimePump;
  status(): OwnLoopRuntimeStatusResponseV1;
  shutdown(): Promise<void>;
}>;

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The production runtime clock returned an invalid date.");
  }
  return value.toISOString();
}

function hmacKey(value: KeyObject | string): KeyObject {
  if (typeof value !== "string") return value;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 32 || bytes.toString("base64url") !== value) {
    throw new TypeError("The runtime HMAC key is invalid.");
  }
  return createSecretKey(bytes);
}

function boundedGrace(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SHUTDOWN_GRACE_MS;
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new TypeError("The runtime shutdown grace is invalid.");
  }
  return value;
}

export async function startProductionRuntime(
  configuration: ProductionRuntimeConfiguration,
): Promise<ProductionRuntime> {
  const clock = configuration.clock ?? (() => new Date());
  const startedAt = timestamp(clock);
  const compatibility = assertRuntimeCompatibility({
    platform: configuration.platform ?? process.platform,
    architecture: configuration.architecture ?? process.arch,
    nodeVersion: configuration.nodeVersion ?? process.versions.node,
    releaseManifest: configuration.releaseManifest,
    installManifest: configuration.installManifest,
  });
  const instanceId = configuration.instanceIdGenerator?.() ?? `runtime_${randomUUID()}`;
  const pid = configuration.pid ?? process.pid;
  const processStartIdentity =
    configuration.processStartIdentity ??
    new Date(Date.now() - Math.max(0, process.uptime() * 1_000)).toISOString();
  const shutdownGraceMs = boundedGrace(configuration.shutdownGraceMs);
  const state = new RuntimeStateController(configuration.runtimeStatePath);

  let persistence: OwnLoopPersistence | null = null;
  let artifactStore: LocalArtifactStore | null = null;
  let settings: LocalSettingsService | null = null;
  let server: ReturnType<typeof createLoopbackIngressServer> | null = null;
  let address: IngressServerAddress | null = null;
  let pump: SerializedRuntimePump | null = null;
  let phase: OwnLoopRuntimeStateV1["phase"] = "starting";
  let shutdownAccepted = false;
  let shutdownPromise: Promise<void> | null = null;

  const status = (): OwnLoopRuntimeStatusResponseV1 => {
    if (address === null || pump === null) throw new Error("Runtime status is not available.");
    return {
      ok: true,
      schemaVersion: 1,
      installId: configuration.installManifest.installId,
      instanceId,
      applicationVersion: OWNLOOP_APPLICATION_VERSION,
      daemonVersion: OWNLOOP_DAEMON_VERSION,
      hookAdapterVersion: OWNLOOP_HOOK_ADAPTER_VERSION,
      pid,
      processStartIdentity,
      port: address.port,
      phase,
      pumpState: pump.state,
      startedAt,
      compatibility,
    };
  };

  const publish = async (nextPhase: OwnLoopRuntimeStateV1["phase"]): Promise<void> => {
    if (address === null) throw new Error("Cannot publish runtime state before binding.");
    const updatedAt = timestamp(clock);
    await state.publish({
      schemaVersion: 1,
      installId: configuration.installManifest.installId,
      applicationVersion: OWNLOOP_APPLICATION_VERSION,
      daemonVersion: OWNLOOP_DAEMON_VERSION,
      hookAdapterVersion: OWNLOOP_HOOK_ADAPTER_VERSION,
      installLayoutVersion: OWNLOOP_INSTALL_LAYOUT_VERSION,
      instanceId,
      pid,
      processStartIdentity,
      port: address.port,
      phase: nextPhase,
      startedAt,
      updatedAt,
    });
    phase = nextPhase;
  };

  const performShutdown = async (): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        if (address !== null && state.current !== null && phase !== "stopping") {
          await publish("stopping");
        }
      } catch {
        phase = "stopping";
      }
      try {
        await pump?.stop(shutdownGraceMs);
      } finally {
        try {
          await server?.close();
        } finally {
          persistence?.close();
          try {
            await state.remove(instanceId);
          } catch {
            // Exact owned cleanup is best effort after resources are closed.
          }
        }
      }
    })();
    return shutdownPromise;
  };

  const routeController: RuntimeRouteController = {
    status,
    beginShutdown(requestedInstanceId) {
      if (requestedInstanceId !== instanceId) return "instance_mismatch";
      if (shutdownAccepted) return "shutdown_in_progress";
      shutdownAccepted = true;
      return "accepted";
    },
    performShutdown,
  };

  try {
    // Compatibility is deliberately complete before any filesystem or listener side effect.
    await mkdir(dirname(configuration.databasePath), { recursive: true, mode: 0o700 });
    persistence = openPersistence(configuration.databasePath);
    artifactStore = await createLocalArtifactStore({
      artifactRoot: configuration.artifactRoot,
      persistence,
    });
    settings = new LocalSettingsService({ persistence, artifactStore, clock });
    server = createLoopbackIngressServer({
      persistence,
      installationToken: configuration.installationToken,
      hmacKey: hmacKey(configuration.hmacKey),
      settings,
      replay: { persistence, artifactStore, webRoot: configuration.webRoot },
      runtime: { controller: routeController },
      clock,
    });
    address = await startLoopbackIngressServer(server, configuration.port ?? 0);
    configuration.onBound?.(address);
    await publish("starting");

    await recoverStaleRuns({ persistence, artifactStore, clock }, startedAt);

    pump = createSerializedRuntimePump({
      operations: createProductionRuntimeStages({
        persistence,
        artifactStore,
        settings,
        ...(configuration.transport === undefined ? {} : { transport: configuration.transport }),
        clock,
      }),
      ...(configuration.pumpIdleDelayMs === undefined
        ? {}
        : { idleDelayMs: configuration.pumpIdleDelayMs }),
      clock,
    });
    pump.start();
    await publish("ready");

    return {
      address,
      compatibility,
      persistence,
      artifactStore,
      settings,
      pump,
      status,
      shutdown: performShutdown,
    };
  } catch (error) {
    try {
      await pump?.stop(shutdownGraceMs);
    } catch {
      // continue reverse cleanup
    }
    try {
      await server?.close();
    } catch {
      // continue reverse cleanup
    }
    persistence?.close();
    try {
      await state.remove(instanceId);
    } catch {
      // state may not have been published or may be unsafe
    }
    throw error;
  }
}
