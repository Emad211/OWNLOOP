import { Buffer } from "node:buffer";

import {
  DIAGNOSTICS_BUNDLE_MAX_BYTES,
  DIAGNOSTICS_DASHBOARD_MAX_BYTES,
  DiagnosticsBundleV1Schema,
  DiagnosticsDashboardV1Schema,
  DiagnosticsErrorResponseV1Schema,
  type DiagnosticsErrorCode,
} from "@ownloop/contracts";
import { canonicalizeJson, IngressSecurityError } from "@ownloop/ingress-security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { InstallationTokenVerifier } from "../ingress/index.js";
import {
  DIAGNOSTICS_BUNDLE_FILENAME,
  DIAGNOSTICS_BUNDLE_ROUTE,
  DIAGNOSTICS_DASHBOARD_ROUTE,
} from "./constants.js";
import {
  prepareDiagnosticsBundle,
  projectDiagnosticsDashboard,
  type DiagnosticsDashboardDependencies,
} from "./projector.js";

const DASHBOARD_LIMITS = Object.freeze({
  maxUtf8Bytes: DIAGNOSTICS_DASHBOARD_MAX_BYTES,
  maxDepth: 64,
  maxObjectProperties: 1024,
  maxArrayItems: 100_000,
});
const BUNDLE_LIMITS = Object.freeze({
  maxUtf8Bytes: DIAGNOSTICS_BUNDLE_MAX_BYTES,
  maxDepth: 72,
  maxObjectProperties: 2048,
  maxArrayItems: 100_000,
});

export type DiagnosticsRouteDependencies = DiagnosticsDashboardDependencies &
  Readonly<{
    tokenVerifier: InstallationTokenVerifier;
    clock?: () => Date;
  }>;

export function diagnosticsError(error: DiagnosticsErrorCode) {
  return DiagnosticsErrorResponseV1Schema.parse({ ok: false, error });
}

function secure(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
}

function unauthorized(reply: FastifyReply): void {
  void secure(reply).code(401).send(diagnosticsError("unauthorized"));
}

function invalidQuery(request: FastifyRequest): boolean {
  return request.url.includes("?");
}

function failure(reply: FastifyReply, error: unknown, target: "dashboard" | "bundle"): void {
  if (
    target === "bundle" &&
    error instanceof IngressSecurityError &&
    error.code === "input_too_large"
  ) {
    void secure(reply).code(413).send(diagnosticsError("bundle_too_large"));
    return;
  }
  void secure(reply).code(500).send(diagnosticsError("projection_failed"));
}

export function registerDiagnosticsRoutes(
  server: FastifyInstance,
  dependencies: DiagnosticsRouteDependencies,
): void {
  const onRequest = (request: FastifyRequest, reply: FastifyReply, done: () => void): void => {
    if (!dependencies.tokenVerifier.verifyRequest(request)) {
      unauthorized(reply);
      return;
    }
    if (invalidQuery(request)) {
      void secure(reply).code(400).send(diagnosticsError("invalid_request"));
      return;
    }
    done();
  };

  server.get(DIAGNOSTICS_DASHBOARD_ROUTE, { onRequest }, async (_request, reply) => {
    try {
      const dashboard = DiagnosticsDashboardV1Schema.parse(
        await projectDiagnosticsDashboard(dependencies),
      );
      const body = canonicalizeJson(dashboard, DASHBOARD_LIMITS);
      const bytes = Buffer.from(body, "utf8");
      if (bytes.byteLength > DIAGNOSTICS_DASHBOARD_MAX_BYTES) {
        void secure(reply).code(500).send(diagnosticsError("projection_failed"));
        return;
      }
      void secure(reply)
        .type("application/json; charset=utf-8")
        .header("Content-Length", String(bytes.byteLength))
        .send(body);
    } catch (error) {
      failure(reply, error, "dashboard");
    }
  });

  server.get(DIAGNOSTICS_BUNDLE_ROUTE, { onRequest }, async (_request, reply) => {
    try {
      const dashboard = await projectDiagnosticsDashboard(dependencies);
      const bundle = DiagnosticsBundleV1Schema.parse(
        prepareDiagnosticsBundle(dashboard, dependencies.clock),
      );
      const body = canonicalizeJson(bundle, BUNDLE_LIMITS);
      const bytes = Buffer.from(body, "utf8");
      if (bytes.byteLength > DIAGNOSTICS_BUNDLE_MAX_BYTES) {
        void secure(reply).code(413).send(diagnosticsError("bundle_too_large"));
        return;
      }
      void secure(reply)
        .type("application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${DIAGNOSTICS_BUNDLE_FILENAME}"`)
        .header("Content-Length", String(bytes.byteLength))
        .send(body);
    } catch (error) {
      failure(reply, error, "bundle");
    }
  });
}
