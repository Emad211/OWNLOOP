import {
  type EnrichedBuildReplayV1,
  EnrichedBuildReplayV1Schema,
  type EvidenceResolutionV1,
  EvidenceResolutionV1Schema,
  type FinalDiffManifestV1,
  type LocalDiagnosticsResponseV1,
  LocalDiagnosticsResponseV1Schema,
  type LocalProviderSecretResponseV1,
  LocalProviderSecretResponseV1Schema,
  type LocalRetentionApplyResultV1,
  LocalRetentionApplyResultV1Schema,
  type LocalRetentionPreviewV1,
  LocalRetentionPreviewV1Schema,
  type LocalRunDeletionResultV1,
  LocalRunDeletionResultV1Schema,
  type LocalSettingsResponseV1,
  LocalSettingsResponseV1Schema,
  type LocalSettingsUpdateRequestV1,
  type MomentInteractionReceiptV1,
  MomentInteractionReceiptV1Schema,
  type MomentInteractionRequestV1,
  type MomentInteractionStateResponseV1,
  MomentInteractionStateResponseV1Schema,
  type OwnershipMomentsProjectionV1,
  OwnershipMomentsProjectionV1Schema,
  FinalDiffManifestV1Schema,
  type RawRunReplayV1,
  RawRunReplayV1Schema,
  ReplayErrorResponseSchema,
  type ReplayRunListResponseV1,
  ReplayRunListResponseV1Schema,
} from "@ownloop/contracts";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type ReplayApiErrorCode =
  | "unauthorized"
  | "invalid_response"
  | "unavailable"
  | "not_found"
  | "conflict"
  | "rejected";

export class ReplayApiError extends Error {
  readonly code: ReplayApiErrorCode;

  constructor(code: ReplayApiErrorCode) {
    super(
      code === "unauthorized"
        ? "OwnLoop rejected the installation token."
        : code === "not_found"
          ? "The requested replay was not found."
          : code === "conflict"
            ? "The interaction ID conflicts with another request."
            : code === "rejected"
              ? "OwnLoop rejected the interaction."
              : code === "invalid_response"
                ? "OwnLoop returned an invalid replay response."
                : "OwnLoop is not available.",
    );
    this.name = "ReplayApiError";
    this.code = code;
  }
}

export type ReplayApiClient = Readonly<{
  listRuns(cursor?: string | null): Promise<ReplayRunListResponseV1>;
  getRun(runId: string): Promise<RawRunReplayV1>;
  getBuildReplay(runId: string): Promise<EnrichedBuildReplayV1>;
  getMoments(runId: string): Promise<OwnershipMomentsProjectionV1>;
  getMomentInteractionState(
    runId: string,
    validationId: string,
  ): Promise<MomentInteractionStateResponseV1>;
  recordMomentInteraction(
    runId: string,
    momentId: string,
    request: MomentInteractionRequestV1,
  ): Promise<MomentInteractionReceiptV1>;
  loadFinalManifest(artifactId: string): Promise<FinalDiffManifestV1>;
  resolveEvidence(runId: string, evidenceId: string): Promise<EvidenceResolutionV1>;
  getSettings(): Promise<LocalSettingsResponseV1>;
  updateSettings(request: LocalSettingsUpdateRequestV1): Promise<LocalSettingsResponseV1>;
  loadProviderSecret(apiKey: string): Promise<LocalProviderSecretResponseV1>;
  clearProviderSecret(): Promise<LocalProviderSecretResponseV1>;
  getDiagnostics(): Promise<LocalDiagnosticsResponseV1>;
  getRetentionPreview(): Promise<LocalRetentionPreviewV1>;
  applyRetention(): Promise<LocalRetentionApplyResultV1>;
  deleteRun(runId: string): Promise<LocalRunDeletionResultV1>;
}>;

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ReplayApiError("invalid_response");
  }
}

function mapErrorStatus(status: number): ReplayApiError {
  if (status === 401) {
    return new ReplayApiError("unauthorized");
  }
  if (status === 404) {
    return new ReplayApiError("not_found");
  }
  if (status === 409) {
    return new ReplayApiError("conflict");
  }
  if (status === 400 || status === 413 || status === 415) {
    return new ReplayApiError("rejected");
  }
  return new ReplayApiError("unavailable");
}

export function createReplayApiClient(
  installationToken: string,
  options: Readonly<{ fetcher?: typeof fetch }> = {},
): ReplayApiClient {
  const origin = window.location.origin;
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    parsedOrigin.protocol !== "http:" ||
    parsedOrigin.hostname !== "127.0.0.1"
  ) {
    throw new ReplayApiError("unavailable");
  }
  const fetcher = options.fetcher ?? fetch;
  const headers = (): HeadersInit => ({
    authorization: `Bearer ${installationToken}`,
    accept: "application/json",
  });

  async function requestJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, origin), {
        method: "GET",
        headers: headers(),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new ReplayApiError("unavailable");
    }
    if (!response.ok) {
      const body = await responseJson(response).catch(() => null);
      if (ReplayErrorResponseSchema.safeParse(body).success) {
        throw mapErrorStatus(response.status);
      }
      throw mapErrorStatus(response.status);
    }
    return responseJson(response);
  }

  async function mutationJson(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    acceptControlledFailure = false,
  ): Promise<Readonly<{ response: Response; body: unknown }>> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, origin), {
        method,
        headers:
          body === undefined ? headers() : { ...headers(), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new ReplayApiError("unavailable");
    }
    const parsedBody = await responseJson(response);
    if (!response.ok && !acceptControlledFailure) throw mapErrorStatus(response.status);
    return { response, body: parsedBody };
  }

  async function postJson(path: string, body: unknown): Promise<unknown> {
    return (await mutationJson("POST", path, body)).body;
  }

  return Object.freeze({
    async listRuns(cursor = null): Promise<ReplayRunListResponseV1> {
      const url = new URL("/v1/replay/runs", origin);
      url.searchParams.set("limit", "25");
      if (cursor !== null) {
        url.searchParams.set("cursor", cursor);
      }
      const result = ReplayRunListResponseV1Schema.safeParse(
        await requestJson(`${url.pathname}${url.search}`),
      );
      if (!result.success) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async getRun(runId: string): Promise<RawRunReplayV1> {
      if (!SAFE_ID_PATTERN.test(runId)) {
        throw new ReplayApiError("not_found");
      }
      const result = RawRunReplayV1Schema.safeParse(
        await requestJson(`/v1/replay/runs/${encodeURIComponent(runId)}`),
      );
      if (!result.success) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async getBuildReplay(runId: string): Promise<EnrichedBuildReplayV1> {
      if (!SAFE_ID_PATTERN.test(runId)) {
        throw new ReplayApiError("not_found");
      }
      const result = EnrichedBuildReplayV1Schema.safeParse(
        await requestJson(`/v1/replay/runs/${encodeURIComponent(runId)}/build-replay`),
      );
      if (!result.success || result.data.runId !== runId) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async getMoments(runId: string): Promise<OwnershipMomentsProjectionV1> {
      if (!SAFE_ID_PATTERN.test(runId)) {
        throw new ReplayApiError("not_found");
      }
      const result = OwnershipMomentsProjectionV1Schema.safeParse(
        await requestJson(`/v1/replay/runs/${encodeURIComponent(runId)}/moments`),
      );
      if (!result.success) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async getMomentInteractionState(
      runId: string,
      validationId: string,
    ): Promise<MomentInteractionStateResponseV1> {
      if (!SAFE_ID_PATTERN.test(runId) || !/^val_[0-9a-f]{48}$/u.test(validationId)) {
        throw new ReplayApiError("not_found");
      }
      const query = new URLSearchParams({ validationId });
      const result = MomentInteractionStateResponseV1Schema.safeParse(
        await requestJson(
          `/v1/replay/runs/${encodeURIComponent(runId)}/moment-interactions?${query.toString()}`,
        ),
      );
      if (
        !result.success ||
        result.data.runId !== runId ||
        result.data.validationId !== validationId
      ) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async recordMomentInteraction(
      runId: string,
      momentId: string,
      request: MomentInteractionRequestV1,
    ): Promise<MomentInteractionReceiptV1> {
      if (!SAFE_ID_PATTERN.test(runId) || !/^mom_[0-9a-f]{48}$/u.test(momentId)) {
        throw new ReplayApiError("not_found");
      }
      const result = MomentInteractionReceiptV1Schema.safeParse(
        await postJson(
          `/v1/replay/runs/${encodeURIComponent(runId)}/moments/${encodeURIComponent(momentId)}/interactions`,
          request,
        ),
      );
      if (
        !result.success ||
        result.data.runId !== runId ||
        result.data.validationId !== request.validationId ||
        result.data.momentId !== momentId ||
        result.data.interactionId !== request.interactionId ||
        result.data.actionKind !== request.action.kind
      ) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async resolveEvidence(runId: string, evidenceId: string): Promise<EvidenceResolutionV1> {
      if (!SAFE_ID_PATTERN.test(runId) || !/^ev_[0-9a-f]{48}$/u.test(evidenceId)) {
        throw new ReplayApiError("not_found");
      }
      const result = EvidenceResolutionV1Schema.safeParse(
        await requestJson(
          `/v1/replay/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceId)}`,
        ),
      );
      if (!result.success) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async loadFinalManifest(artifactId: string): Promise<FinalDiffManifestV1> {
      if (!SAFE_ID_PATTERN.test(artifactId)) {
        throw new ReplayApiError("not_found");
      }
      const result = FinalDiffManifestV1Schema.safeParse(
        await requestJson(`/v1/replay/artifacts/${encodeURIComponent(artifactId)}`),
      );
      if (!result.success) {
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },

    async getSettings(): Promise<LocalSettingsResponseV1> {
      const result = LocalSettingsResponseV1Schema.safeParse(await requestJson("/v1/settings"));
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async updateSettings(request: LocalSettingsUpdateRequestV1): Promise<LocalSettingsResponseV1> {
      const result = LocalSettingsResponseV1Schema.safeParse(
        (await mutationJson("PUT", "/v1/settings", request)).body,
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async loadProviderSecret(apiKey: string): Promise<LocalProviderSecretResponseV1> {
      const result = LocalProviderSecretResponseV1Schema.safeParse(
        (await mutationJson("POST", "/v1/settings/provider-secret", { schemaVersion: 1, apiKey }))
          .body,
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async clearProviderSecret(): Promise<LocalProviderSecretResponseV1> {
      const result = LocalProviderSecretResponseV1Schema.safeParse(
        (await mutationJson("DELETE", "/v1/settings/provider-secret")).body,
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async getDiagnostics(): Promise<LocalDiagnosticsResponseV1> {
      const result = LocalDiagnosticsResponseV1Schema.safeParse(
        await requestJson("/v1/settings/diagnostics"),
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async getRetentionPreview(): Promise<LocalRetentionPreviewV1> {
      const result = LocalRetentionPreviewV1Schema.safeParse(
        await requestJson("/v1/settings/retention-preview"),
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async applyRetention(): Promise<LocalRetentionApplyResultV1> {
      const result = LocalRetentionApplyResultV1Schema.safeParse(
        (await mutationJson("POST", "/v1/settings/apply-retention")).body,
      );
      if (!result.success) throw new ReplayApiError("invalid_response");
      return result.data;
    },

    async deleteRun(runId: string): Promise<LocalRunDeletionResultV1> {
      if (!SAFE_ID_PATTERN.test(runId)) throw new ReplayApiError("not_found");
      const { response, body } = await mutationJson(
        "DELETE",
        `/v1/replay/runs/${encodeURIComponent(runId)}`,
        undefined,
        true,
      );
      if (response.status === 401) throw new ReplayApiError("unauthorized");
      const result = LocalRunDeletionResultV1Schema.safeParse(body);
      if (!result.success || result.data.runId !== runId) {
        if (!response.ok) throw mapErrorStatus(response.status);
        throw new ReplayApiError("invalid_response");
      }
      return result.data;
    },
  });
}

export function createMomentInteractionId(cryptoValue: Crypto = crypto): string {
  const bytes = new Uint8Array(24);
  cryptoValue.getRandomValues(bytes);
  return `ix_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
