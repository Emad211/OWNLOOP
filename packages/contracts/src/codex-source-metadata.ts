import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import {
  CODEX_MAX_IDENTIFIER_CODE_POINTS,
  CODEX_MAX_PATH_CODE_POINTS,
  CodexPermissionModeSchema,
  CodexSourceSurfaceSchema,
  SupportedCodexHookNameSchema,
} from "./codex-hook-common.js";

const boundedIdentifierSchema = z.string().min(1).max(CODEX_MAX_IDENTIFIER_CODE_POINTS);
const boundedPathSchema = z.string().min(1).max(CODEX_MAX_PATH_CODE_POINTS);
const boundedSourceVersionSchema = z.string().min(1).max(256);

export const CodexSourceMetadataSchema = z.strictObject({
  source: z.literal("codex"),
  sourceSessionId: boundedIdentifierSchema,
  sourceEventName: SupportedCodexHookNameSchema,
  sourceEventId: boundedIdentifierSchema.nullish(),
  turnId: boundedIdentifierSchema.nullish(),
  toolUseId: boundedIdentifierSchema.nullish(),
  agentId: boundedIdentifierSchema.nullish(),
  agentType: boundedIdentifierSchema.nullish(),
  transcriptPath: boundedPathSchema.nullish(),
  cwd: boundedPathSchema,
  permissionMode: CodexPermissionModeSchema.nullish(),
  adapterVersion: SemVerSchema,
  sourceVersion: boundedSourceVersionSchema.nullish(),
  sourceSurface: CodexSourceSurfaceSchema,
});
export type CodexSourceMetadata = z.infer<typeof CodexSourceMetadataSchema>;
