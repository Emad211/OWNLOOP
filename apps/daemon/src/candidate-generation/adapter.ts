import {
  type CandidateGenerationAttemptV1,
  CandidateGenerationAttemptV1Schema,
  type CandidateGenerationDiagnosticCode,
  type CandidateGenerationStatus,
  type CandidateGenerationTokenUsageV1,
  CandidateGenerationTokenUsageV1Schema,
} from "@ownloop/contracts";

import type { CanonicalCandidateMomentBatch } from "./artifact.js";
import { canonicalCandidateMomentBatch } from "./artifact.js";
import type {
  CandidateGenerationProviderOptions,
  PreparedCandidateGenerationRequest,
} from "./request.js";
import { validateCandidateGenerationApiKey } from "./request.js";
import {
  type CandidateGenerationTransport,
  CandidateGenerationTransportError,
} from "./transport.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const SAFE_PROVIDER_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export type CandidateGenerationAdapterDependencies = Readonly<{
  transport: CandidateGenerationTransport;
  clock?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

export type CandidateGenerationAdapterSuccess = Readonly<{
  status: "succeeded";
  diagnosticCode: "completed";
  candidateBatch: CanonicalCandidateMomentBatch;
  attempts: readonly CandidateGenerationAttemptV1[];
  providerRequestId: string | null;
  usage: CandidateGenerationTokenUsageV1 | null;
}>;

export type CandidateGenerationAdapterFailure = Readonly<{
  status: Exclude<CandidateGenerationStatus, "succeeded">;
  diagnosticCode: Exclude<
    CandidateGenerationDiagnosticCode,
    "completed" | "disabled" | "semantic_input_unavailable" | "persistence_failed"
  >;
  attempts: readonly CandidateGenerationAttemptV1[];
  providerRequestId: string | null;
  usage: null;
}>;

export type CandidateGenerationAdapterResult =
  | CandidateGenerationAdapterSuccess
  | CandidateGenerationAdapterFailure;

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The Candidate generation clock is invalid.");
  }
  return value.toISOString();
}

function providerRequestId(value: unknown): string | null {
  return typeof value === "string" && SAFE_PROVIDER_REQUEST_ID.test(value) ? value : null;
}

function parseUsage(value: unknown): CandidateGenerationTokenUsageV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const inputTokens = record.input_tokens;
  const outputTokens = record.output_tokens;
  const totalTokens = record.total_tokens;
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    return null;
  }
  try {
    return CandidateGenerationTokenUsageV1Schema.parse({ inputTokens, outputTokens, totalTokens });
  } catch {
    return null;
  }
}

type EnvelopeExtraction =
  | Readonly<{
      kind: "completed";
      text: string;
      requestId: string | null;
      usage: CandidateGenerationTokenUsageV1 | null;
    }>
  | Readonly<{ kind: "incomplete"; requestId: string | null }>
  | Readonly<{ kind: "refusal"; requestId: string | null }>
  | Readonly<{ kind: "invalid"; requestId: string | null }>;

function extractEnvelope(value: unknown, headerRequestId: string | null): EnvelopeExtraction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "invalid", requestId: headerRequestId };
  }
  const envelope = value as Record<string, unknown>;
  const requestId = headerRequestId ?? providerRequestId(envelope.id);
  if (envelope.status !== "completed") {
    return envelope.status === "incomplete"
      ? { kind: "incomplete", requestId }
      : { kind: "invalid", requestId };
  }
  if (!Array.isArray(envelope.output) || envelope.output.length > 32) {
    return { kind: "invalid", requestId };
  }
  const texts: string[] = [];
  let refusal = false;
  for (const item of envelope.output) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const output = item as Record<string, unknown>;
    if (!Array.isArray(output.content)) continue;
    for (const contentItem of output.content) {
      if (typeof contentItem !== "object" || contentItem === null || Array.isArray(contentItem)) {
        continue;
      }
      const content = contentItem as Record<string, unknown>;
      if (content.type === "refusal") refusal = true;
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  if (refusal) return { kind: "refusal", requestId };
  if (texts.length !== 1) return { kind: "invalid", requestId };
  return {
    kind: "completed",
    text: texts[0] ?? "",
    requestId,
    usage: parseUsage(envelope.usage),
  };
}

function retryDelay(
  retryAfter: string | undefined,
  attemptNumber: number,
  baseDelayMs: number,
  maximumMs: number,
  clock: () => Date,
): number {
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maximumMs, Math.floor(seconds * 1000));
    }
    const retryAt = Date.parse(retryAfter);
    const now = clock().getTime();
    if (Number.isFinite(retryAt) && Number.isFinite(now) && retryAt >= now) {
      return Math.min(maximumMs, retryAt - now);
    }
  }
  return Math.min(maximumMs, baseDelayMs * 2 ** Math.max(0, attemptNumber - 1));
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      operation();
    };
    const timer = setTimeout(() => finish(resolve), milliseconds);
    const abort = () => {
      clearTimeout(timer);
      finish(() => reject(new CandidateGenerationTransportError("aborted")));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function attempt(input: Omit<CandidateGenerationAttemptV1, never>): CandidateGenerationAttemptV1 {
  return CandidateGenerationAttemptV1Schema.parse(input);
}

function failure(
  status: CandidateGenerationAdapterFailure["status"],
  diagnosticCode: CandidateGenerationAdapterFailure["diagnosticCode"],
  attempts: readonly CandidateGenerationAttemptV1[],
  requestId: string | null,
): CandidateGenerationAdapterFailure {
  return { status, diagnosticCode, attempts, providerRequestId: requestId, usage: null };
}

export async function generateCandidateBatchWithResponsesAdapter(
  dependencies: CandidateGenerationAdapterDependencies,
  request: PreparedCandidateGenerationRequest,
  provider: CandidateGenerationProviderOptions,
  signal?: AbortSignal,
): Promise<CandidateGenerationAdapterResult> {
  const secret = validateCandidateGenerationApiKey(provider.apiKey);
  const clock = dependencies.clock ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const attempts: CandidateGenerationAttemptV1[] = [];
  let lastRequestId: string | null = null;

  for (
    let attemptNumber = 1;
    attemptNumber <= request.providerConfig.retryPolicy.maxAttempts;
    attemptNumber += 1
  ) {
    if (signal?.aborted) {
      return failure("aborted", "aborted", attempts, lastRequestId);
    }
    const startedAt = canonicalTimestamp(clock);
    try {
      const response = await dependencies.transport({
        url: request.endpoint.responseUrl,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": request.requestFingerprint.slice("sha256:".length),
        },
        body: request.httpRequestBytes,
        timeoutMs: request.providerConfig.timeoutMs,
        maxResponseBytes: request.providerConfig.maxResponseBytes,
        ...(signal === undefined ? {} : { signal }),
      });
      const completedAt = canonicalTimestamp(clock);
      lastRequestId = providerRequestId(response.headers["x-request-id"]);
      if (TRANSIENT_STATUSES.has(response.statusCode)) {
        const delay =
          attemptNumber < request.providerConfig.retryPolicy.maxAttempts
            ? retryDelay(
                response.headers["retry-after"],
                attemptNumber,
                request.providerConfig.retryPolicy.baseDelayMs,
                request.providerConfig.retryPolicy.maxRetryAfterMs,
                clock,
              )
            : 0;
        attempts.push(
          attempt({
            attemptNumber,
            outcome: "http_transient",
            httpStatus: response.statusCode,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: delay,
          }),
        );
        if (delay > 0 || attemptNumber < request.providerConfig.retryPolicy.maxAttempts) {
          if (attemptNumber < request.providerConfig.retryPolicy.maxAttempts) {
            try {
              await sleep(delay, signal);
            } catch {
              return failure("aborted", "aborted", attempts, lastRequestId);
            }
            continue;
          }
        }
        return failure("transport_failed", "http_transient_exhausted", attempts, lastRequestId);
      }
      if (response.statusCode !== 200) {
        attempts.push(
          attempt({
            attemptNumber,
            outcome: "http_permanent",
            httpStatus: response.statusCode,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: 0,
          }),
        );
        return failure("provider_rejected", "http_permanent_failure", attempts, lastRequestId);
      }
      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) {
        attempts.push(
          attempt({
            attemptNumber,
            outcome: "invalid_content_type",
            httpStatus: 200,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: 0,
          }),
        );
        return failure("invalid_response", "invalid_content_type", attempts, lastRequestId);
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(decoder.decode(response.body));
      } catch {
        attempts.push(
          attempt({
            attemptNumber,
            outcome: "invalid_envelope",
            httpStatus: 200,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: 0,
          }),
        );
        return failure("invalid_response", "invalid_provider_envelope", attempts, lastRequestId);
      }
      const extracted = extractEnvelope(envelope, lastRequestId);
      lastRequestId = extracted.requestId;
      if (extracted.kind !== "completed") {
        const mapping =
          extracted.kind === "refusal"
            ? (["provider_rejected", "provider_refusal", "provider_refusal"] as const)
            : extracted.kind === "incomplete"
              ? (["invalid_response", "provider_incomplete", "provider_incomplete"] as const)
              : (["invalid_response", "invalid_provider_envelope", "invalid_envelope"] as const);
        attempts.push(
          attempt({
            attemptNumber,
            outcome: mapping[2],
            httpStatus: 200,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: 0,
          }),
        );
        return failure(mapping[0], mapping[1], attempts, lastRequestId);
      }
      let candidateBatch: CanonicalCandidateMomentBatch;
      try {
        candidateBatch = canonicalCandidateMomentBatch(JSON.parse(extracted.text));
      } catch (error) {
        const productLimit = error instanceof Error && error.message.includes("product limit");
        attempts.push(
          attempt({
            attemptNumber,
            outcome: productLimit ? "product_limit_exceeded" : "invalid_candidate_batch",
            httpStatus: 200,
            providerRequestId: lastRequestId,
            startedAt,
            completedAt,
            retryDelayMs: 0,
          }),
        );
        return failure(
          "invalid_response",
          productLimit ? "candidate_product_limit_exceeded" : "invalid_candidate_batch",
          attempts,
          lastRequestId,
        );
      }
      attempts.push(
        attempt({
          attemptNumber,
          outcome: "completed",
          httpStatus: 200,
          providerRequestId: lastRequestId,
          startedAt,
          completedAt,
          retryDelayMs: 0,
        }),
      );
      return {
        status: "succeeded",
        diagnosticCode: "completed",
        candidateBatch,
        attempts,
        providerRequestId: lastRequestId,
        usage: extracted.usage,
      };
    } catch (error) {
      const completedAt = canonicalTimestamp(clock);
      const code =
        error instanceof CandidateGenerationTransportError ? error.code : "network_error";
      const outcome =
        code === "aborted"
          ? "aborted"
          : code === "timeout"
            ? "timeout"
            : code === "response_too_large"
              ? "response_too_large"
              : "transport_error";
      const retryDelayMs =
        code !== "aborted" &&
        code !== "response_too_large" &&
        attemptNumber < request.providerConfig.retryPolicy.maxAttempts
          ? Math.min(
              request.providerConfig.retryPolicy.maxRetryAfterMs,
              request.providerConfig.retryPolicy.baseDelayMs * 2 ** Math.max(0, attemptNumber - 1),
            )
          : 0;
      attempts.push(
        attempt({
          attemptNumber,
          outcome,
          httpStatus: null,
          providerRequestId: lastRequestId,
          startedAt,
          completedAt,
          retryDelayMs,
        }),
      );
      if (code === "aborted") return failure("aborted", "aborted", attempts, lastRequestId);
      if (code === "response_too_large") {
        return failure("invalid_response", "response_too_large", attempts, lastRequestId);
      }
      if (attemptNumber < request.providerConfig.retryPolicy.maxAttempts) {
        try {
          await sleep(retryDelayMs, signal);
          continue;
        } catch {
          return failure("aborted", "aborted", attempts, lastRequestId);
        }
      }
      return failure(
        "transport_failed",
        code === "timeout" ? "transport_timeout" : "transport_error",
        attempts,
        lastRequestId,
      );
    }
  }
  return failure("transport_failed", "transport_error", attempts, lastRequestId);
}
