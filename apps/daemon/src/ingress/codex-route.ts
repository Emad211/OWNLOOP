import { type KeyObject, randomUUID } from "node:crypto";

import type { IngestionErrorCode } from "@ownloop/contracts";
import {
  CodexAdapterIngressSchema,
  SUPPORTED_CODEX_HOOK_NAMES,
} from "@ownloop/contracts/codex";
import {
  IngressSecurityError,
  prepareCodexIngressReceipt,
} from "@ownloop/ingress-security";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type {
  NewCodexPreparedIngressReceipt,
  OwnLoopPersistence,
} from "../persistence/index.js";
import {
  PersistenceDeduplicationConflictError,
  PersistenceError,
} from "../persistence/index.js";
import type { InstallationTokenVerifier } from "./auth.js";
import {
  emitIngressDiagnostic,
  type IngressDiagnosticSink,
} from "./diagnostics.js";
import {
  acceptedResponse,
  rejectedResponse,
  summarizeZodError,
} from "./responses.js";

export const CODEX_INGRESS_ROUTE = "/v1/ingress/codex" as const;

const SAFE_RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SUPPORTED_CODEX_HOOK_SET = new Set<string>(SUPPORTED_CODEX_HOOK_NAMES);

export type CodexIngressPersistence = Readonly<{
  ingressReceipts: Pick<
    OwnLoopPersistence["ingressReceipts"],
    "insertPreparedOrGetExisting"
  >;
}>;

export type CodexIngressRouteDependencies = Readonly<{
  persistence: CodexIngressPersistence;
  tokenVerifier: InstallationTokenVerifier;
  hmacKey: KeyObject;
  homePath?: string;
  clock?: () => Date;
  receiptIdGenerator?: () => string;
  diagnostics?: IngressDiagnosticSink;
  customSecretFieldPatterns?: () => readonly string[];
}>;

function isJsonRequest(request: FastifyRequest): boolean {
  const values = request.raw.headersDistinct["content-type"];
  if (values === undefined || values.length !== 1) return false;
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

function isUnsupportedCodexHookBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("payload" in body)) return false;
  const payload = body.payload;
  if (typeof payload !== "object" || payload === null || !("hook_event_name" in payload)) {
    return false;
  }
  const hookName = payload.hook_event_name;
  return typeof hookName === "string" && !SUPPORTED_CODEX_HOOK_SET.has(hookName);
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

export function registerCodexIngressRoute(
  server: FastifyInstance,
  dependencies: CodexIngressRouteDependencies,
): void {
  const clock = dependencies.clock ?? (() => new Date());
  const receiptIdGenerator = dependencies.receiptIdGenerator ?? randomUUID;

  server.post<{ Body: unknown }>(
    CODEX_INGRESS_ROUTE,
    {
      onRequest(request, reply, done) {
        if (!dependencies.tokenVerifier.verifyRequest(request)) {
          sendRejected(reply, 401, "unauthorized", dependencies.diagnostics);
          return;
        }
        if (!isJsonRequest(request)) {
          sendRejected(reply, 415, "unsupported_media_type", dependencies.diagnostics);
          return;
        }
        done();
      },
    },
    (request, reply) => {
      const parsed = CodexAdapterIngressSchema.safeParse(request.body);
      if (!parsed.success) {
        const code: IngestionErrorCode = isUnsupportedCodexHookBody(request.body)
          ? "unsupported_hook"
          : "invalid_payload";
        emitIngressDiagnostic(dependencies.diagnostics, { type: "request.rejected", code });
        void reply.code(400).send(rejectedResponse(code, summarizeZodError(parsed.error)));
        return;
      }

      try {
        const prepared = prepareCodexIngressReceipt(parsed.data, {
          hmacKey: dependencies.hmacKey,
          ...(dependencies.homePath === undefined ? {} : { homePath: dependencies.homePath }),
          customSecretFieldPatterns: dependencies.customSecretFieldPatterns?.() ?? [],
        });
        const newReceipt: NewCodexPreparedIngressReceipt = {
          ...prepared,
          receiptId: safeReceiptId(receiptIdGenerator),
          processingStatus: "pending",
          processedAt: null,
          failureCode: null,
          createdAt: safeTimestamp(clock),
        };
        const inserted =
          dependencies.persistence.ingressReceipts.insertPreparedOrGetExisting(newReceipt);
        emitIngressDiagnostic(dependencies.diagnostics, {
          type: "receipt.accepted",
          source: "codex",
          receiptId: inserted.receiptId,
          hookName: parsed.data.payload.hook_event_name,
          duplicate: inserted.duplicate,
        });
        void reply.code(202).send(acceptedResponse(inserted.receiptId, inserted.duplicate));
      } catch (error) {
        if (error instanceof PersistenceDeduplicationConflictError) {
          sendRejected(reply, 409, "deduplication_conflict", dependencies.diagnostics);
          return;
        }
        if (error instanceof PersistenceError) {
          sendRejected(reply, 503, "persistence_failed", dependencies.diagnostics);
          return;
        }
        if (error instanceof IngressSecurityError) {
          const code: IngestionErrorCode =
            error.code === "unsupported_hook" ? "unsupported_hook" : "invalid_payload";
          sendRejected(reply, 400, code, dependencies.diagnostics);
          return;
        }
        sendRejected(reply, 500, "internal_error", dependencies.diagnostics);
      }
    },
  );
}
