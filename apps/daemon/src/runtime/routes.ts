import {
  OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION,
  type OwnLoopRuntimeErrorCode,
  OwnLoopRuntimeErrorResponseV1Schema,
  type OwnLoopRuntimeShutdownRequestV1,
  OwnLoopRuntimeShutdownRequestV1Schema,
  OwnLoopRuntimeShutdownResponseV1Schema,
  type OwnLoopRuntimeStatusResponseV1,
  OwnLoopRuntimeStatusResponseV1Schema,
} from "@ownloop/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getDistinctRequestHeaderValues } from "../http-headers.js";
import type { InstallationTokenVerifier } from "../ingress/index.js";

export const RUNTIME_STATUS_ROUTE = "/v1/runtime/status" as const;
export const RUNTIME_SHUTDOWN_ROUTE = "/v1/runtime/shutdown" as const;
export const RUNTIME_CONTROL_BODY_LIMIT_BYTES = 4 * 1024;

export type RuntimeRouteController = Readonly<{
  status(): OwnLoopRuntimeStatusResponseV1;
  beginShutdown(instanceId: string): "accepted" | "instance_mismatch" | "shutdown_in_progress";
  performShutdown(): void | Promise<void>;
}>;

export type RuntimeRouteDependencies = Readonly<{
  tokenVerifier: InstallationTokenVerifier;
  controller: RuntimeRouteController;
}>;

function headers(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
}

export function runtimeError(code: OwnLoopRuntimeErrorCode) {
  return OwnLoopRuntimeErrorResponseV1Schema.parse({
    ok: false,
    schemaVersion: OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION,
    error: { code },
  });
}

function unauthorized(reply: FastifyReply): void {
  void headers(reply).code(401).send(runtimeError("unauthorized"));
}

function authenticate(
  verifier: InstallationTokenVerifier,
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  if (!verifier.verifyRequest(request)) {
    unauthorized(reply);
    return;
  }
  done();
}

function isJsonRequest(request: FastifyRequest): boolean {
  const values = getDistinctRequestHeaderValues(request, "content-type");
  return (
    values !== undefined &&
    values.length === 1 &&
    values[0]?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function hasQuery(request: FastifyRequest): boolean {
  const query = request.query;
  return typeof query === "object" && query !== null && Object.keys(query).length > 0;
}

export function registerRuntimeRoutes(
  server: FastifyInstance,
  dependencies: RuntimeRouteDependencies,
): void {
  const onRequest = (request: FastifyRequest, reply: FastifyReply, done: () => void): void =>
    authenticate(dependencies.tokenVerifier, request, reply, done);

  server.get(RUNTIME_STATUS_ROUTE, { onRequest }, (request, reply) => {
    if (hasQuery(request)) {
      void headers(reply).code(400).send(runtimeError("invalid_request"));
      return;
    }
    try {
      void headers(reply).send(
        OwnLoopRuntimeStatusResponseV1Schema.parse(dependencies.controller.status()),
      );
    } catch {
      void headers(reply).code(503).send(runtimeError("runtime_unavailable"));
    }
  });

  server.post<{ Body: unknown }>(
    RUNTIME_SHUTDOWN_ROUTE,
    {
      onRequest(request, reply, done) {
        if (!dependencies.tokenVerifier.verifyRequest(request)) {
          unauthorized(reply);
          return;
        }
        if (!isJsonRequest(request) || hasQuery(request)) {
          void headers(reply).code(415).send(runtimeError("invalid_request"));
          return;
        }
        done();
      },
      bodyLimit: RUNTIME_CONTROL_BODY_LIMIT_BYTES,
    },
    (request, reply) => {
      let parsed: OwnLoopRuntimeShutdownRequestV1;
      try {
        parsed = OwnLoopRuntimeShutdownRequestV1Schema.parse(request.body);
      } catch {
        void headers(reply).code(400).send(runtimeError("invalid_request"));
        return;
      }
      const outcome = dependencies.controller.beginShutdown(parsed.instanceId);
      if (outcome === "instance_mismatch") {
        void headers(reply).code(409).send(runtimeError("instance_mismatch"));
        return;
      }
      if (outcome === "shutdown_in_progress") {
        void headers(reply).code(409).send(runtimeError("shutdown_in_progress"));
        return;
      }
      reply.raw.once("finish", () => {
        void Promise.resolve(dependencies.controller.performShutdown()).catch(() => undefined);
      });
      void headers(reply).send(
        OwnLoopRuntimeShutdownResponseV1Schema.parse({
          ok: true,
          schemaVersion: OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION,
          instanceId: parsed.instanceId,
          acknowledged: true,
        }),
      );
    },
  );
}
