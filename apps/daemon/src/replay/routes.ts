import {
  EvidenceResolutionV1Schema,
  RAW_REPLAY_SCHEMA_VERSION,
  RawRunReplayV1Schema,
  REPLAY_DEFAULT_LIST_LIMIT,
  REPLAY_MAX_ARTIFACT_BYTES,
  REPLAY_MAX_LIST_LIMIT,
  ReplayRunListResponseV1Schema,
} from "@ownloop/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { isArtifactStoreError, type LocalArtifactStore } from "../artifact-store/index.js";
import { readValidatedRunEvidenceGraph, resolveRunEvidence } from "../evidence-graph/index.js";
import type { InstallationTokenVerifier } from "../ingress/index.js";
import { type OwnLoopPersistence, PersistenceError } from "../persistence/index.js";
import {
  FINAL_DIFF_MANIFEST_MEDIA_TYPE,
  REPLAY_ARTIFACT_ROUTE,
  REPLAY_EVIDENCE_ROUTE,
  REPLAY_LIST_ROUTE,
  REPLAY_RUN_ROUTE,
} from "./constants.js";
import { decodeReplayCursor } from "./cursor.js";
import {
  isReplayReadableArtifact,
  projectRawRunReplay,
  projectReplayRunList,
} from "./projection.js";
import { replayError } from "./responses.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const LIST_LIMIT_PATTERN = /^(?:[1-9]|[1-9]\d|100)$/u;

type ReplayListQuery = Readonly<{
  limit?: string | readonly string[];
  cursor?: string | readonly string[];
}>;

function singleQueryValue(
  value: string | readonly string[] | undefined,
): string | undefined | false {
  return typeof value === "string" || value === undefined ? value : false;
}

export type ReplayRouteDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: Pick<LocalArtifactStore, "readPreparedBytes">;
  tokenVerifier: InstallationTokenVerifier;
}>;

function unauthorized(reply: FastifyReply): void {
  void reply.code(401).header("Cache-Control", "no-store").send(replayError("unauthorized"));
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

function contentFreeFailure(reply: FastifyReply, error: unknown): void {
  const code = error instanceof PersistenceError ? "projection_failed" : "internal_error";
  const status = error instanceof PersistenceError ? 503 : 500;
  void reply.code(status).header("Cache-Control", "no-store").send(replayError(code));
}

export function registerReplayRoutes(
  server: FastifyInstance,
  dependencies: ReplayRouteDependencies,
): void {
  const onRequest = (request: FastifyRequest, reply: FastifyReply, done: () => void): void =>
    authenticate(dependencies.tokenVerifier, request, reply, done);

  server.get<{ Querystring: ReplayListQuery }>(
    REPLAY_LIST_ROUTE,
    { onRequest },
    (request, reply) => {
      const limitText = singleQueryValue(request.query.limit);
      const cursorText = singleQueryValue(request.query.cursor);
      const limit =
        limitText === undefined
          ? REPLAY_DEFAULT_LIST_LIMIT
          : limitText !== false && LIST_LIMIT_PATTERN.test(limitText)
            ? Number(limitText)
            : Number.NaN;
      const cursor = cursorText === false ? false : decodeReplayCursor(cursorText);
      if (!Number.isInteger(limit) || limit > REPLAY_MAX_LIST_LIMIT || cursor === false) {
        void reply.code(400).header("Cache-Control", "no-store").send(replayError("invalid_query"));
        return;
      }
      try {
        void reply
          .header("Cache-Control", "no-store")
          .send(
            ReplayRunListResponseV1Schema.parse(
              projectReplayRunList(dependencies.persistence, limit, cursor),
            ),
          );
      } catch (error) {
        contentFreeFailure(reply, error);
      }
    },
  );

  server.get<{ Params: { runId: string } }>(
    REPLAY_RUN_ROUTE,
    { onRequest },
    async (request, reply) => {
      if (!SAFE_ID_PATTERN.test(request.params.runId)) {
        void reply.code(404).header("Cache-Control", "no-store").send(replayError("run_not_found"));
        return;
      }
      try {
        const graph = await readValidatedRunEvidenceGraph(dependencies, request.params.runId);
        const replay = projectRawRunReplay(dependencies.persistence, request.params.runId, graph);
        if (replay === null) {
          void reply
            .code(404)
            .header("Cache-Control", "no-store")
            .send(replayError("run_not_found"));
          return;
        }
        void reply
          .header("Cache-Control", "no-store")
          .send(
            RawRunReplayV1Schema.parse({ ...replay, schemaVersion: RAW_REPLAY_SCHEMA_VERSION }),
          );
      } catch (error) {
        contentFreeFailure(reply, error);
      }
    },
  );

  server.get<{ Params: { runId: string; evidenceId: string } }>(
    REPLAY_EVIDENCE_ROUTE,
    { onRequest },
    async (request, reply) => {
      const { runId, evidenceId } = request.params;
      if (!SAFE_ID_PATTERN.test(runId) || !/^ev_[0-9a-f]{48}$/u.test(evidenceId)) {
        void reply
          .code(404)
          .header("Cache-Control", "no-store")
          .send(replayError("evidence_not_found"));
        return;
      }
      try {
        const resolution = await resolveRunEvidence(dependencies, runId, evidenceId);
        if (resolution === null) {
          void reply
            .code(404)
            .header("Cache-Control", "no-store")
            .send(replayError("evidence_not_found"));
          return;
        }
        void reply
          .header("Cache-Control", "no-store")
          .send(EvidenceResolutionV1Schema.parse(resolution));
      } catch (error) {
        if (error instanceof PersistenceError || isArtifactStoreError(error)) {
          void reply
            .code(409)
            .header("Cache-Control", "no-store")
            .send(replayError("evidence_unavailable"));
          return;
        }
        contentFreeFailure(reply, error);
      }
    },
  );

  server.get<{ Params: { artifactId: string } }>(
    REPLAY_ARTIFACT_ROUTE,
    { onRequest },
    async (request, reply) => {
      const artifactId = request.params.artifactId;
      if (!SAFE_ID_PATTERN.test(artifactId)) {
        void reply
          .code(404)
          .header("Cache-Control", "no-store")
          .send(replayError("artifact_not_found"));
        return;
      }
      try {
        const metadata = dependencies.persistence.artifacts.getMetadata(artifactId);
        if (metadata === null || !isReplayReadableArtifact(dependencies.persistence, artifactId)) {
          void reply
            .code(404)
            .header("Cache-Control", "no-store")
            .send(replayError("artifact_not_found"));
          return;
        }
        if (metadata.sizeBytes > REPLAY_MAX_ARTIFACT_BYTES) {
          void reply
            .code(409)
            .header("Cache-Control", "no-store")
            .send(replayError("artifact_unavailable"));
          return;
        }
        const content = await dependencies.artifactStore.readPreparedBytes(artifactId);
        if (
          content.sizeBytes > REPLAY_MAX_ARTIFACT_BYTES ||
          content.mediaType !== FINAL_DIFF_MANIFEST_MEDIA_TYPE
        ) {
          void reply
            .code(409)
            .header("Cache-Control", "no-store")
            .send(replayError("artifact_unavailable"));
          return;
        }
        void reply
          .code(200)
          .header("Cache-Control", "no-store")
          .header(
            "Content-Disposition",
            `attachment; filename="ownloop-final-diff-${artifactId}.json"`,
          )
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Length", String(content.sizeBytes))
          .type(content.mediaType)
          .send(Buffer.from(content.bytes));
      } catch (error) {
        if (isArtifactStoreError(error)) {
          void reply
            .code(409)
            .header("Cache-Control", "no-store")
            .send(replayError("artifact_unavailable"));
          return;
        }
        contentFreeFailure(reply, error);
      }
    },
  );
}
