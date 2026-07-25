import {
  type EvidenceResolutionV1,
  EvidenceResolutionV1Schema,
  type FinalDiffManifestV1,
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

  async function postJson(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, origin), {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new ReplayApiError("unavailable");
    }
    if (!response.ok) {
      await responseJson(response).catch(() => null);
      throw mapErrorStatus(response.status);
    }
    return responseJson(response);
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
  });
}

export function createMomentInteractionId(cryptoValue: Crypto = crypto): string {
  const bytes = new Uint8Array(24);
  cryptoValue.getRandomValues(bytes);
  return `ix_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
