import type { IngressRedactionRuleId } from "@ownloop/contracts";

export const MAX_INPUT_CANONICAL_UTF8_BYTES = 1024 * 1024;
export const MAX_OUTPUT_CANONICAL_UTF8_BYTES = 256 * 1024;
export const MAX_RECURSIVE_DEPTH = 32;
export const MAX_OBJECT_PROPERTIES = 1024;
export const MAX_ARRAY_ITEMS = 1024;
export const MAX_RETAINED_STRING_UTF8_BYTES = 64 * 1024;

// Arbitrary source-data arrays may be reduced to MAX_ARRAY_ITEMS. This higher bound limits the
// complete unredacted source traversal used for HMAC while the 1 MiB byte limit remains primary.
export const MAX_SOURCE_ARRAY_ITEMS = 65_536;

export const REDACTION_MARKER = "[REDACTED:ownloop-v1]";
export const STRING_TRUNCATION_MARKER = "[TRUNCATED:string-v1]";
export const ARRAY_TRUNCATION_MARKER = Object.freeze({ $ownloop: "truncated-array-v1" });

export const REDACTION_RULES = Object.freeze({
  secretField: "field.secret",
  unknownField: "field.unknown-dropped",
  authorization: "string.authorization",
  privateKey: "string.private-key",
  assignment: "string.assignment",
  uriPassword: "string.uri-password",
  providerToken: "string.provider-token",
  workspacePath: "path.workspace",
  transcriptPath: "path.transcript",
  homePath: "path.home",
  absolutePath: "path.absolute",
  stringTruncation: "truncate.string",
  arrayTruncation: "truncate.array",
} satisfies Record<string, IngressRedactionRuleId>);
