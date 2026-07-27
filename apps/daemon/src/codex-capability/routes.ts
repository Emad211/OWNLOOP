import { Buffer } from "node:buffer";

import { CodexCapabilityStatusV1Schema } from "@ownloop/contracts/codex";
import { canonicalizeJson } from "@ownloop/ingress-security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { diagnosticsError } from "../diagnostics-dashboard/index.js";
import type { InstallationTokenVerifier } from "../ingress/index.js";
import type { OwnLoopPersistence } from "../persistence/index.js";
import {
  type CodexCapabilityEnvironmentFacts,
  projectCodexCapabilityFromPersistence,
} from "./projector.js";

export const CODEX_CAPABILITY_ROUTE = "/v1/diagnostics/codex" as const;
export const CODEX_CAPABILITY_MAX_BYTES = 128 * 1024;

const CAPABILITY_LIMITS = Object.freeze({
  maxUtf8Bytes: CODEX_CAPABILITY_MAX_BYTES,
  maxDepth: 32,
  maxObjectProperties: 256,
  maxArrayItems: 256,
});
const DEFAULT_ENVIRONMENT: CodexCapabilityEnvironmentFacts = Object.freeze({
  configurationState: "unavailable",
  hookEngineState: "unknown",
  trustState: "unknown",
  managedPolicyState: "unknown",
  verifiedSourceSurfaces: Object.freeze([]),
});

export type CodexCapabilityRouteDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  tokenVerifier: InstallationTokenVerifier;
  environment?: () => CodexCapabilityEnvironmentFacts;
}>;

function secure(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
}

function unauthorized(reply: FastifyReply): void {
  void secure(reply).code(401).send(diagnosticsError("unauthorized"));
}

function invalidQuery(request: FastifyRequest): boolean {
  return request.url.includes("?");
}

export function registerCodexCapabilityRoute(
  server: FastifyInstance,
  dependencies: CodexCapabilityRouteDependencies,
): void {
  server.get(
    CODEX_CAPABILITY_ROUTE,
    {
      onRequest(request, reply, done) {
        if (!dependencies.tokenVerifier.verifyRequest(request)) {
          unauthorized(reply);
          return;
        }
        if (invalidQuery(request)) {
          void secure(reply).code(400).send(diagnosticsError("invalid_request"));
          return;
        }
        done();
      },
    },
    (_request, reply) => {
      try {
        const status = CodexCapabilityStatusV1Schema.parse(
          projectCodexCapabilityFromPersistence(
            dependencies.persistence,
            dependencies.environment?.() ?? DEFAULT_ENVIRONMENT,
          ),
        );
        const body = canonicalizeJson(status, CAPABILITY_LIMITS);
        const bytes = Buffer.from(body, "utf8");
        if (bytes.byteLength > CODEX_CAPABILITY_MAX_BYTES) {
          void secure(reply).code(500).send(diagnosticsError("projection_failed"));
          return;
        }
        void secure(reply)
          .type("application/json; charset=utf-8")
          .header("Content-Length", String(bytes.byteLength))
          .send(body);
      } catch {
        void secure(reply).code(500).send(diagnosticsError("projection_failed"));
      }
    },
  );
}
