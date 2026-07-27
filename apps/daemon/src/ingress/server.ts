import { type KeyObject, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import {
  ClaudeAdapterIngressSchema,
  type IngestionErrorCode,
  SUPPORTED_CLAUDE_HOOK_NAMES,
} from "@ownloop/contracts";
import {
  IngressSecurityError,
  prepareIngressReceipt,
  validateIngressHmacKey,
} from "@ownloop/ingress-security";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from "fastify";
import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  type CodexCapabilityEnvironmentFacts,
  registerCodexCapabilityRoute,
} from "../codex-capability/index.js";
import { diagnosticsError, registerDiagnosticsRoutes } from "../diagnostics-dashboard/index.js";
import {
  type LocalSettingsService,
  localSettingsError,
  registerLocalSettingsRoutes,
} from "../local-settings/index.js";
import type {
  NewPreparedIngressReceipt,
  OwnLoopPersistence,
  OwnLoopPersistence as ReplayPersistence,
} from "../persistence/index.js";
import { PersistenceDeduplicationConflictError, PersistenceError } from "../persistence/index.js";
import { createContainedStaticSite, registerReplayRoutes, replayError } from "../replay/index.js";
import { createInstallationTokenVerifier } from "./auth.js";
import { CODEX_INGRESS_ROUTE, registerCodexIngressRoute } from "./codex-route.js";
import { emitIngressDiagnostic, type IngressDiagnosticSink } from "./diagnostics.js";
import { acceptedResponse, rejectedResponse, summarizeZodError } from "./responses.js";

export const INGRESS_LOOPBACK_HOST = "127.0.0.1" as const;
export const INGRESS_ROUTE = "/v1/ingress/claude" as const;
export const INGRESS_BODY_LIMIT_BYTES = 1024 * 1024;

export { CODEX_INGRESS_ROUTE };

const SAFE_RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SUPPORTED_HOOK_SET = new Set<string>(SUPPORTED_CLAUDE_HOOK_NAMES);

export type IngressPersistence = Readonly<{
  ingressReceipts: Pick<OwnLoopPersistence["ingressReceipts"], "insertPreparedOrGetExisting">;
}>;

export type IngressServerDependencies = Readonly<{
  persistence: IngressPersistence;
  installationToken: string;
  hmacKey: KeyObject;
  homePath?: string;
  clock?: () => Date;
  receiptIdGenerator?: () => string;
  diagnostics?: IngressDiagnosticSink;
  customSecretFieldPatterns?: () => readonly string[];
  codexCapabilityEnvironment?: () => CodexCapabilityEnvironmentFacts;
  settings?: LocalSettingsService;
  replay?: Readonly<{
    persistence: ReplayPersistence;
    artifactStore: Pick<LocalArtifactStore, "readPreparedBytes">;
    webRoot?: string;
  }>;
}>;

export type IngressServerAddress = Readonly<{
  host: typeof INGRESS_LOOPBACK_HOST;
  port: number;
  url: string;
}>;

function isJsonRequest(request: FastifyRequest): boolean {
  const values = request.raw.headersDistinct["content-type"];
  if (values === undefined || values.length !== 1) {
    return false;
  }
  return values[0]?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function safeReceiptId(generator: () => string): string {
  const receiptId = generator();
  if (!SAFE_RECEIPT_ID_PATTERN.test(receiptId)) {
    throw new Error("The receipt ID generator returned an unsafe identifier.");
  }
  return receiptId;
}

function safeTimestamp(clock: () => Date): string {
  const instant = clock();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error("The ingestion clock returned an invalid date.");
  }
  return instant.toISOString();
}

function isUnsupportedHookBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("payload" in body)) {
    return false;
  }
  const payload = body.payload;
  if (typeof payload !== "object" || payload === null || !("hook_event_name" in payload)) {
    return false;
  }
  const hookName = payload.hook_event_name;
  return typeof hookName === "string" && !SUPPORTED_HOOK_SET.has(hookName);
}

function fastifyErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

function sendRejected(
  reply: FastifyReply,
  statusCode: number,
  code: IngestionErrorCode,
  diagnostics: IngressDiagnosticSink | undefined,
): void {
  emitIngressDiagnostic(diagnostics, { type: "request.rejected", code });
  void reply.code(statusCode).send(rejectedResponse(code));
}

function mapFrameworkError(error: unknown): Readonly<{
  statusCode: number;
  code: IngestionErrorCode;
}> {
  switch (fastifyErrorCode(error)) {
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return { statusCode: 413, code: "payload_too_large" };
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return { statusCode: 415, code: "unsupported_media_type" };
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return { statusCode: 400, code: "invalid_payload" };
    default:
      return { statusCode: 500, code: "internal_error" };
  }
}

export function createLoopbackIngressServer(
  dependencies: IngressServerDependencies,
): FastifyInstance {
  const { persistence, installationToken, hmacKey, homePath } = dependencies;
  const diagnostics: IngressDiagnosticSink | undefined =
    dependencies.settings === undefined
      ? dependencies.diagnostics
      : (event) => {
          emitIngressDiagnostic(dependencies.diagnostics, event);
          emitIngressDiagnostic(dependencies.settings?.diagnosticsSink, event);
        };
  validateIngressHmacKey(hmacKey);
  const tokenVerifier = createInstallationTokenVerifier(installationToken);
  const clock = dependencies.clock ?? (() => new Date());
  const receiptIdGenerator = dependencies.receiptIdGenerator ?? randomUUID;

  const server = Fastify({
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
    bodyLimit: INGRESS_BODY_LIMIT_BYTES,
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    handlerTimeout: 10_000,
    keepAliveTimeout: 2_000,
    forceCloseConnections: "idle",
    return503OnClosing: true,
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
  });

  server.addHook("onListen", function onListen(done) {
    const address = this.server.address();
    if (address !== null && typeof address !== "string") {
      emitIngressDiagnostic(diagnostics, {
        type: "server.started",
        port: address.port,
      });
    }
    done();
  });

  server.addHook("onClose", (_instance, done) => {
    emitIngressDiagnostic(diagnostics, { type: "server.stopped" });
    done();
  });

  server.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      return;
    }
    const mapped = mapFrameworkError(error);
    if (/^\/v1\/settings(?:\/|$)/u.test(request.url)) {
      const status = mapped.statusCode === 413 ? 413 : mapped.statusCode === 415 ? 415 : 400;
      void reply
        .code(status)
        .header("Cache-Control", "no-store")
        .send(localSettingsError("invalid_request"));
      return;
    }
    if (
      request.method === "POST" &&
      /^\/v1\/replay\/runs\/[^/?]+\/moments\/[^/?]+\/interactions(?:\?|$)/u.test(request.url)
    ) {
      const code = mapped.statusCode === 413 ? 413 : mapped.statusCode === 415 ? 415 : 400;
      void reply
        .code(code)
        .header("Cache-Control", "no-store")
        .send(replayError("interaction_rejected"));
      return;
    }
    sendRejected(reply, mapped.statusCode, mapped.code, diagnostics);
  });

  if (dependencies.settings !== undefined) {
    registerLocalSettingsRoutes(server, { service: dependencies.settings, tokenVerifier });
  }
  if (dependencies.settings !== undefined && dependencies.replay !== undefined) {
    registerDiagnosticsRoutes(server, {
      persistence: dependencies.replay.persistence,
      artifactStore: dependencies.replay.artifactStore,
      settings: dependencies.settings,
      tokenVerifier,
      clock,
    });
  }
  if (dependencies.replay !== undefined) {
    registerCodexCapabilityRoute(server, {
      persistence: dependencies.replay.persistence,
      tokenVerifier,
      ...(dependencies.codexCapabilityEnvironment === undefined
        ? {}
        : { environment: dependencies.codexCapabilityEnvironment }),
    });
    registerReplayRoutes(server, {
      persistence: dependencies.replay.persistence,
      artifactStore: dependencies.replay.artifactStore,
      tokenVerifier,
      clock,
    });
  }
  registerCodexIngressRoute(server, {
    persistence,
    tokenVerifier,
    hmacKey,
    ...(homePath === undefined ? {} : { homePath }),
    clock,
    receiptIdGenerator,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    customSecretFieldPatterns: () =>
      dependencies.settings?.getCustomSecretFieldPatterns() ??
      dependencies.customSecretFieldPatterns?.() ??
      [],
  });

  const staticSite = createContainedStaticSite(dependencies.replay?.webRoot);

  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/v1/diagnostics")) {
      void reply
        .code(404)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(diagnosticsError("invalid_request"));
      return;
    }
    if (request.url.startsWith("/v1/settings")) {
      void reply
        .code(404)
        .header("Cache-Control", "no-store")
        .send(localSettingsError("invalid_request"));
      return;
    }
    if (request.url.startsWith("/v1/replay")) {
      void reply.code(404).header("Cache-Control", "no-store").send(replayError("invalid_query"));
      return;
    }
    if (!request.url.startsWith("/v1/") && staticSite?.serve(request, reply) === true) {
      return;
    }
    sendRejected(reply, 404, "invalid_payload", diagnostics);
  });

  server.post<{ Body: unknown }>(
    INGRESS_ROUTE,
    {
      onRequest(request, reply, done) {
        if (!tokenVerifier.verifyRequest(request)) {
          sendRejected(reply, 401, "unauthorized", diagnostics);
          return;
        }
        if (!isJsonRequest(request)) {
          sendRejected(reply, 415, "unsupported_media_type", diagnostics);
          return;
        }
        done();
      },
    },
    (request, reply) => {
      const parsed = ClaudeAdapterIngressSchema.safeParse(request.body);
      if (!parsed.success) {
        const code: IngestionErrorCode = isUnsupportedHookBody(request.body)
          ? "unsupported_hook"
          : "invalid_payload";
        emitIngressDiagnostic(diagnostics, { type: "request.rejected", code });
        void reply.code(400).send(rejectedResponse(code, summarizeZodError(parsed.error)));
        return;
      }

      try {
        const prepared = prepareIngressReceipt(parsed.data, {
          hmacKey: hmacKey,
          ...(homePath === undefined ? {} : { homePath: homePath }),
          customSecretFieldPatterns:
            dependencies.settings?.getCustomSecretFieldPatterns() ??
            dependencies.customSecretFieldPatterns?.() ??
            [],
        });
        const createdAt = safeTimestamp(clock);
        const newReceipt: NewPreparedIngressReceipt = {
          ...prepared,
          receiptId: safeReceiptId(receiptIdGenerator),
          processingStatus: "pending",
          processedAt: null,
          failureCode: null,
          createdAt,
        };
        const inserted = persistence.ingressReceipts.insertPreparedOrGetExisting(newReceipt);

        emitIngressDiagnostic(diagnostics, {
          type: "receipt.accepted",
          receiptId: inserted.receiptId,
          hookName: parsed.data.payload.hook_event_name,
          duplicate: inserted.duplicate,
        });
        void reply.code(202).send(acceptedResponse(inserted.receiptId, inserted.duplicate));
      } catch (error) {
        if (error instanceof PersistenceDeduplicationConflictError) {
          sendRejected(reply, 409, "deduplication_conflict", diagnostics);
          return;
        }
        if (error instanceof PersistenceError) {
          sendRejected(reply, 503, "persistence_failed", diagnostics);
          return;
        }
        if (error instanceof IngressSecurityError) {
          const code: IngestionErrorCode =
            error.code === "unsupported_hook" ? "unsupported_hook" : "invalid_payload";
          sendRejected(reply, 400, code, diagnostics);
          return;
        }
        sendRejected(reply, 500, "internal_error", diagnostics);
      }
    },
  );

  return server;
}

export async function startLoopbackIngressServer(
  server: FastifyInstance,
  port = 0,
): Promise<IngressServerAddress> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("The loopback port must be an integer between 0 and 65535.");
  }

  await server.listen({ host: INGRESS_LOOPBACK_HOST, port });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    await server.close();
    throw new Error("The loopback ingress server did not expose a TCP address.");
  }
  const tcpAddress = address as AddressInfo;
  if (tcpAddress.address !== INGRESS_LOOPBACK_HOST || tcpAddress.family !== "IPv4") {
    await server.close();
    throw new Error("The ingress server did not bind to the required IPv4 loopback address.");
  }

  return Object.freeze({
    host: INGRESS_LOOPBACK_HOST,
    port: tcpAddress.port,
    url: `http://${INGRESS_LOOPBACK_HOST}:${tcpAddress.port}`,
  });
}
