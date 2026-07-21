import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";
import { CLAUDE_INGRESS_CONTRACT_VERSION } from "./ingress-wrapper.js";

export const INGRESS_CANONICALIZATION_VERSION = 1 as const;
export const INGRESS_REDACTION_POLICY_VERSION = 1 as const;

export const INGRESS_REDACTION_RULE_IDS = [
  "field.secret",
  "field.unknown-dropped",
  "path.absolute",
  "path.home",
  "path.transcript",
  "path.workspace",
  "string.assignment",
  "string.authorization",
  "string.private-key",
  "string.provider-token",
  "string.uri-password",
  "truncate.array",
  "truncate.string",
] as const;

export const IngressRedactionRuleIdSchema = z.enum(INGRESS_REDACTION_RULE_IDS);
export type IngressRedactionRuleId = z.infer<typeof IngressRedactionRuleIdSchema>;

const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const RedactionSummaryV1Schema = z
  .strictObject({
    policyVersion: z.literal(INGRESS_REDACTION_POLICY_VERSION),
    redactedFieldCount: nonNegativeIntegerSchema,
    redactedValueCount: nonNegativeIntegerSchema,
    pathReplacementCount: nonNegativeIntegerSchema,
    droppedUnknownFieldCount: nonNegativeIntegerSchema,
    truncatedValueCount: nonNegativeIntegerSchema,
    rulesApplied: z.array(IngressRedactionRuleIdSchema).max(INGRESS_REDACTION_RULE_IDS.length),
    outputUtf8Bytes: nonNegativeIntegerSchema.max(256 * 1024),
  })
  .superRefine(({ rulesApplied }, context) => {
    const sortedUnique = [...new Set(rulesApplied)].sort();
    if (
      sortedUnique.length !== rulesApplied.length ||
      sortedUnique.some((rule, index) => rule !== rulesApplied[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "rulesApplied must be sorted and unique.",
        path: ["rulesApplied"],
      });
    }
  });
export type RedactionSummaryV1 = z.infer<typeof RedactionSummaryV1Schema>;

export const HmacSha256FingerprintSchema = z.string().regex(/^hmac-sha256:[0-9a-f]{64}$/);
export type HmacSha256Fingerprint = z.infer<typeof HmacSha256FingerprintSchema>;

const supportedHookPattern = SUPPORTED_CLAUDE_HOOK_NAMES.join("|");
const deduplicationKeyPattern = new RegExp(
  `^v1:(?:${supportedHookPattern}):(?:id:[A-Za-z0-9_-]{1,1024}|hmac:[0-9a-f]{64})$`,
);

export const IngressDeduplicationKeySchema = z
  .string()
  .min(1)
  .max(1152)
  .regex(deduplicationKeyPattern);
export type IngressDeduplicationKey = z.infer<typeof IngressDeduplicationKeySchema>;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
      continue;
    }
    if (codeUnit <= 0x7ff) {
      bytes += 2;
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
        continue;
      }
    }
    bytes += 3;
  }
  return bytes;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
      index += 1;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function base64UrlEncodeUtf8(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = utf8Bytes(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(block >> 18) & 0x3f] ?? "";
    output += alphabet[(block >> 12) & 0x3f] ?? "";
    if (second !== undefined) {
      output += alphabet[(block >> 6) & 0x3f] ?? "";
    }
    if (third !== undefined) {
      output += alphabet[block & 0x3f] ?? "";
    }
  }
  return output;
}

const absolutePathPattern = /^(?:\/|[A-Za-z]:[\\/]|\\\\|\/\/)/;
const embeddedAbsolutePathPattern = /(?:^|[\s"'([{=,:;])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/;
const strongIdentifierSecretPattern =
  /(?:^|[^A-Za-z0-9_])(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/i;
const identifierUriCredentialPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/:@]+:[^/@]+@/;
const IDENTIFIER_SECRET_ASSIGNMENT_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "privatekey",
  "sshprivatekey",
  "credential",
  "credentials",
]);

function containsIdentifierSecretAssignment(value: string): boolean {
  const separatorIndex = value.search(/[:=]/);
  if (separatorIndex <= 0) {
    return false;
  }
  const name = value
    .slice(0, separatorIndex)
    .toLowerCase()
    .replace(/[_.\-\s]/g, "");
  return IDENTIFIER_SECRET_ASSIGNMENT_NAMES.has(name);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const identifierSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !containsControlCharacter(value), "Identifiers cannot contain controls.")
  .refine((value) => !hasLoneSurrogate(value), "Identifiers cannot contain lone surrogates.")
  .refine((value) => !/\s/.test(value), "Identifiers cannot contain whitespace.")
  .refine(
    (value) => !strongIdentifierSecretPattern.test(value),
    "Identifiers cannot contain a strong secret-token pattern.",
  )
  .refine(
    (value) => !containsIdentifierSecretAssignment(value),
    "Identifiers cannot contain secret-bearing assignments.",
  )
  .refine(
    (value) => !identifierUriCredentialPattern.test(value),
    "Identifiers cannot contain URI credentials.",
  )
  .refine(
    (value) => !embeddedAbsolutePathPattern.test(value),
    "Identifiers cannot contain absolute paths.",
  );
const canonicalWorkspacePathSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => absolutePathPattern.test(value), "Workspace path must be absolute.")
  .refine(
    (value) => !containsControlCharacter(value),
    "Workspace path cannot contain control characters.",
  )
  .refine((value) => !hasLoneSurrogate(value), "Workspace path cannot contain lone surrogates.");

function canonicalizeContractJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Invalid canonical JSON number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new TypeError("Invalid canonical JSON string.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeContractJson).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Invalid canonical JSON value.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${keys
    .map((key) => {
      if (hasLoneSurrogate(key)) {
        throw new TypeError("Invalid canonical JSON property.");
      }
      return `${JSON.stringify(key)}:${canonicalizeContractJson(record[key])}`;
    })
    .join(",")}}`;
}

const stableIdRequiredHooks = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const);
const sourceIdEligibleHooks = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
] as const);

export const PreparedIngressReceiptV1Schema = z
  .strictObject({
    canonicalizationVersion: z.literal(INGRESS_CANONICALIZATION_VERSION),
    redactionPolicyVersion: z.literal(INGRESS_REDACTION_POLICY_VERSION),
    ingressContractVersion: z.literal(CLAUDE_INGRESS_CONTRACT_VERSION),
    source: z.literal("claude_code"),
    adapterVersion: SemVerSchema,
    sourceSessionId: identifierSchema,
    sourceEventName: SupportedClaudeHookNameSchema,
    sourceEventId: identifierSchema.nullable(),
    canonicalWorkspacePath: canonicalWorkspacePathSchema,
    receivedAt: z.iso.datetime({ offset: true }),
    payloadFingerprint: HmacSha256FingerprintSchema,
    deduplicationKey: IngressDeduplicationKeySchema,
    redactedPayloadJson: z
      .string()
      .min(2)
      .max(256 * 1024),
    redactionSummary: RedactionSummaryV1Schema,
  })
  .superRefine((receipt, context) => {
    const outputBytes = utf8ByteLength(receipt.redactedPayloadJson);
    if (outputBytes > 256 * 1024) {
      context.addIssue({
        code: "custom",
        message: "redactedPayloadJson exceeds its UTF-8 byte limit.",
        path: ["redactedPayloadJson"],
      });
    }
    if (outputBytes !== receipt.redactionSummary.outputUtf8Bytes) {
      context.addIssue({
        code: "custom",
        message: "redactionSummary output byte count does not match the payload.",
        path: ["redactionSummary", "outputUtf8Bytes"],
      });
    }

    try {
      const parsed = JSON.parse(receipt.redactedPayloadJson) as unknown;
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        context.addIssue({
          code: "custom",
          message: "redactedPayloadJson must contain a JSON object.",
          path: ["redactedPayloadJson"],
        });
      } else if (canonicalizeContractJson(parsed) !== receipt.redactedPayloadJson) {
        context.addIssue({
          code: "custom",
          message: "redactedPayloadJson must use canonical JSON v1.",
          path: ["redactedPayloadJson"],
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "redactedPayloadJson must contain valid canonical JSON.",
        path: ["redactedPayloadJson"],
      });
    }

    const requiresId = stableIdRequiredHooks.has(
      receipt.sourceEventName as typeof stableIdRequiredHooks extends Set<infer Item>
        ? Item
        : never,
    );
    const permitsId = sourceIdEligibleHooks.has(
      receipt.sourceEventName as typeof sourceIdEligibleHooks extends Set<infer Item>
        ? Item
        : never,
    );
    if (requiresId && receipt.sourceEventId === null) {
      context.addIssue({
        code: "custom",
        message: "This Hook requires a source event ID.",
        path: ["sourceEventId"],
      });
    }
    if (!permitsId && receipt.sourceEventId !== null) {
      context.addIssue({
        code: "custom",
        message: "This Hook cannot carry a source event ID in policy v1.",
        path: ["sourceEventId"],
      });
    }

    const expectedPrefix = `v1:${receipt.sourceEventName}:`;
    if (!receipt.deduplicationKey.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        message: "Deduplication Hook name does not match sourceEventName.",
        path: ["deduplicationKey"],
      });
    }
    if (receipt.sourceEventId === null) {
      const fingerprintHex = receipt.payloadFingerprint.slice("hmac-sha256:".length);
      if (receipt.deduplicationKey !== `${expectedPrefix}hmac:${fingerprintHex}`) {
        context.addIssue({
          code: "custom",
          message: "HMAC deduplication key does not match the payload fingerprint.",
          path: ["deduplicationKey"],
        });
      }
    } else {
      const expectedIdKey = `${expectedPrefix}id:${base64UrlEncodeUtf8(receipt.sourceEventId)}`;
      if (receipt.deduplicationKey !== expectedIdKey) {
        context.addIssue({
          code: "custom",
          message: "ID deduplication key does not match sourceEventId.",
          path: ["deduplicationKey"],
        });
      }
    }
  });
export type PreparedIngressReceiptV1 = z.infer<typeof PreparedIngressReceiptV1Schema>;

export const INGRESS_SECURITY_ERROR_CODES = [
  "array_item_limit",
  "canonicalization_failed",
  "input_too_deep",
  "input_too_large",
  "invalid_hmac_key",
  "invalid_json_value",
  "invalid_workspace_path",
  "object_property_limit",
  "output_too_large",
  "policy_invariant",
  "unsupported_hook",
] as const;

export const IngressSecurityErrorCodeSchema = z.enum(INGRESS_SECURITY_ERROR_CODES);
export type IngressSecurityErrorCode = z.infer<typeof IngressSecurityErrorCodeSchema>;

export const IngressSecurityPathSegmentSchema = z.union([
  z.string().regex(/^(?:\$field|[A-Za-z_][A-Za-z0-9_.-]{0,63})$/),
  nonNegativeIntegerSchema,
]);

export const IngressSecurityErrorDetailsSchema = z.strictObject({
  code: IngressSecurityErrorCodeSchema,
  message: z.string().min(1).max(512),
  path: z.array(IngressSecurityPathSegmentSchema).max(64).optional(),
  ruleId: IngressRedactionRuleIdSchema.optional(),
});
export type IngressSecurityErrorDetails = z.infer<typeof IngressSecurityErrorDetailsSchema>;
