import {
  type FinalDiffManifestV1,
  FinalDiffManifestV1Schema,
  type RawRunReplayV1,
  RawRunReplayV1Schema,
  ReplayErrorResponseSchema,
  type ReplayRunListResponseV1,
  ReplayRunListResponseV1Schema,
} from "@ownloop/contracts";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type ReplayApiErrorCode = "unauthorized" | "invalid_response" | "unavailable" | "not_found";

export class ReplayApiError extends Error {
  readonly code: ReplayApiErrorCode;

  constructor(code: ReplayApiErrorCode) {
    super(
      code === "unauthorized"
        ? "OwnLoop rejected the installation token."
        : code === "not_found"
          ? "The requested replay was not found."
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
  loadFinalManifest(artifactId: string): Promise<FinalDiffManifestV1>;
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
  return new ReplayApiError("unavailable");
}

export function createReplayApiClient(
  installationToken: string,
  options: Readonly<{
    origin?: string;
    fetcher?: typeof fetch;
  }> = {},
): ReplayApiClient {
  const origin = options.origin ?? window.location.origin;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== "http:") {
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
