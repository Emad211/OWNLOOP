import {
  LocalDiagnosticsResponseV1Schema,
  LocalProviderSecretRequestV1Schema,
  LocalProviderSecretResponseV1Schema,
  LocalRetentionApplyResultV1Schema,
  LocalRetentionPreviewV1Schema,
  LocalRunDeletionResultV1Schema,
  LocalSettingsErrorResponseV1Schema,
  LocalSettingsResponseV1Schema,
  LocalSettingsUpdateRequestV1Schema,
  type LocalSettingsErrorCode,
} from "@ownloop/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { InstallationTokenVerifier } from "../ingress/index.js";
import { LocalSettingsServiceError } from "./errors.js";
import type { LocalSettingsService } from "./service.js";

export const LOCAL_SETTINGS_ROUTE = "/v1/settings" as const;
export const LOCAL_PROVIDER_SECRET_ROUTE = "/v1/settings/provider-secret" as const;
export const LOCAL_DIAGNOSTICS_ROUTE = "/v1/settings/diagnostics" as const;
export const LOCAL_RETENTION_PREVIEW_ROUTE = "/v1/settings/retention-preview" as const;
export const LOCAL_RETENTION_APPLY_ROUTE = "/v1/settings/apply-retention" as const;
export const LOCAL_RUN_DELETE_ROUTE = "/v1/replay/runs/:runId" as const;
export const LOCAL_SETTINGS_BODY_LIMIT_BYTES = 16 * 1024;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type LocalSettingsRouteDependencies = Readonly<{
  service: LocalSettingsService;
  tokenVerifier: InstallationTokenVerifier;
}>;

export function localSettingsError(error: LocalSettingsErrorCode) {
  return LocalSettingsErrorResponseV1Schema.parse({ ok: false, error });
}

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).header("Cache-Control", "no-store").send(localSettingsError("unauthorized"));
}

function isJsonRequest(request: FastifyRequest): boolean {
  const values = request.raw.headersDistinct["content-type"];
  return (
    values !== undefined &&
    values.length === 1 &&
    values[0]?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function failure(reply: FastifyReply, error: unknown): void {
  if (typeof error === "object" && error !== null && "name" in error && error.name === "ZodError") {
    void reply
      .code(400)
      .header("Cache-Control", "no-store")
      .send(localSettingsError("invalid_request"));
    return;
  }
  if (error instanceof LocalSettingsServiceError) {
    const status = error.code === "settings_conflict" || error.code === "run_active" ? 409 : 400;
    void reply
      .code(status)
      .header("Cache-Control", "no-store")
      .send(localSettingsError(error.code));
    return;
  }
  void reply
    .code(500)
    .header("Cache-Control", "no-store")
    .send(localSettingsError("operation_failed"));
}

export function registerLocalSettingsRoutes(
  server: FastifyInstance,
  dependencies: LocalSettingsRouteDependencies,
): void {
  const onRequest = (request: FastifyRequest, reply: FastifyReply, done: () => void): void => {
    if (!dependencies.tokenVerifier.verifyRequest(request)) {
      unauthorized(reply);
      return;
    }
    done();
  };
  const jsonOnRequest = (request: FastifyRequest, reply: FastifyReply, done: () => void): void => {
    if (!dependencies.tokenVerifier.verifyRequest(request)) {
      unauthorized(reply);
      return;
    }
    if (!isJsonRequest(request)) {
      void reply
        .code(415)
        .header("Cache-Control", "no-store")
        .send(localSettingsError("invalid_request"));
      return;
    }
    done();
  };

  server.get(LOCAL_SETTINGS_ROUTE, { onRequest }, (_request, reply) => {
    try {
      void reply
        .header("Cache-Control", "no-store")
        .send(LocalSettingsResponseV1Schema.parse(dependencies.service.getResponse()));
    } catch (error) {
      failure(reply, error);
    }
  });

  server.put<{ Body: unknown }>(
    LOCAL_SETTINGS_ROUTE,
    { onRequest: jsonOnRequest, bodyLimit: LOCAL_SETTINGS_BODY_LIMIT_BYTES },
    (request, reply) => {
      try {
        const input = LocalSettingsUpdateRequestV1Schema.parse(request.body);
        void reply
          .header("Cache-Control", "no-store")
          .send(LocalSettingsResponseV1Schema.parse(dependencies.service.update(input)));
      } catch (error) {
        failure(reply, error);
      }
    },
  );

  server.post<{ Body: unknown }>(
    LOCAL_PROVIDER_SECRET_ROUTE,
    { onRequest: jsonOnRequest, bodyLimit: LOCAL_SETTINGS_BODY_LIMIT_BYTES },
    (request, reply) => {
      try {
        const input = LocalProviderSecretRequestV1Schema.parse(request.body);
        void reply
          .header("Cache-Control", "no-store")
          .send(
            LocalProviderSecretResponseV1Schema.parse(
              dependencies.service.loadProviderSecret(input.apiKey),
            ),
          );
      } catch (error) {
        failure(reply, error);
      }
    },
  );

  server.delete(LOCAL_PROVIDER_SECRET_ROUTE, { onRequest }, (_request, reply) => {
    void reply
      .header("Cache-Control", "no-store")
      .send(LocalProviderSecretResponseV1Schema.parse(dependencies.service.clearProviderSecret()));
  });

  server.get(LOCAL_DIAGNOSTICS_ROUTE, { onRequest }, (_request, reply) => {
    void reply
      .header("Cache-Control", "no-store")
      .send(LocalDiagnosticsResponseV1Schema.parse(dependencies.service.diagnostics()));
  });

  server.get(LOCAL_RETENTION_PREVIEW_ROUTE, { onRequest }, (_request, reply) => {
    try {
      void reply
        .header("Cache-Control", "no-store")
        .send(LocalRetentionPreviewV1Schema.parse(dependencies.service.retentionPreview()));
    } catch (error) {
      failure(reply, error);
    }
  });

  server.post(LOCAL_RETENTION_APPLY_ROUTE, { onRequest }, async (_request, reply) => {
    try {
      void reply
        .header("Cache-Control", "no-store")
        .send(LocalRetentionApplyResultV1Schema.parse(await dependencies.service.applyRetention()));
    } catch (error) {
      failure(reply, error);
    }
  });

  server.delete<{ Params: { runId: string } }>(
    LOCAL_RUN_DELETE_ROUTE,
    { onRequest },
    async (request, reply) => {
      if (!SAFE_ID_PATTERN.test(request.params.runId)) {
        void reply
          .code(404)
          .header("Cache-Control", "no-store")
          .send(localSettingsError("run_not_found"));
        return;
      }
      try {
        const result = await dependencies.service.deleteRun(request.params.runId);
        const status =
          result.outcome === "not_found" ? 404 : result.outcome === "active_conflict" ? 409 : 200;
        void reply
          .code(status)
          .header("Cache-Control", "no-store")
          .send(LocalRunDeletionResultV1Schema.parse(result));
      } catch (error) {
        failure(reply, error);
      }
    },
  );
}
