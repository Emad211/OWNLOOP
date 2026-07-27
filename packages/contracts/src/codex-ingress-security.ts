import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import { SupportedCodexHookNameSchema } from "./codex-hook-common.js";
import { CODEX_INGRESS_CONTRACT_VERSION } from "./codex-ingress-wrapper.js";
import {
  HmacSha256FingerprintSchema,
  INGRESS_CANONICALIZATION_VERSION,
  INGRESS_REDACTION_POLICY_VERSION,
  IngressDeduplicationKeySchema,
  RedactionSummaryV1Schema,
} from "./ingress-security.js";

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
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
    if (second !== undefined) output += alphabet[(block >> 6) & 0x3f] ?? "";
    if (third !== undefined) output += alphabet[block & 0x3f] ?? "";
  }
  return output;
}

function canonicalizeContractJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Invalid canonical JSON number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) throw new TypeError("Invalid canonical JSON string.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeContractJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("Invalid canonical JSON value.");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${keys
    .map((key) => {
      if (hasLoneSurrogate(key)) throw new TypeError("Invalid canonical JSON property.");
      return `${JSON.stringify(key)}:${canonicalizeContractJson(record[key])}`;
    })
    .join(",")}}`;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const absolutePathPattern = /^(?:\/|[A-Za-z]:[\\/]|\\\\|\/\/)/u;
const embeddedAbsolutePathPattern = /(?:^|[\s"'([{=,:;])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/u;
const secretPattern =
  /(?:^|[^A-Za-z0-9])(?:authorization|password|passwd|secret|api[_.-]?key|access[_.-]?token|refresh[_.-]?token|id[_.-]?token|token|private[_.-]?key|credential|credentials)[:=]/iu;
const uriCredentialPattern = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/u;
const strongTokenPattern =
  /(?:^|[^A-Za-z0-9_])(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/iu;

const identifierSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !hasLoneSurrogate(value))
  .refine((value) => !/\s/u.test(value))
  .refine((value) => !strongTokenPattern.test(value))
  .refine((value) => !secretPattern.test(value))
  .refine((value) => !uriCredentialPattern.test(value))
  .refine((value) => !/file:\/\//iu.test(value))
  .refine((value) => !embeddedAbsolutePathPattern.test(value));

const canonicalWorkspacePathSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => absolutePathPattern.test(value))
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !hasLoneSurrogate(value));

const CODEX_SOURCE_ID_HOOKS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const);

export const PreparedCodexIngressReceiptV1Schema = z
  .strictObject({
    canonicalizationVersion: z.literal(INGRESS_CANONICALIZATION_VERSION),
    redactionPolicyVersion: z.literal(INGRESS_REDACTION_POLICY_VERSION),
    ingressContractVersion: z.literal(CODEX_INGRESS_CONTRACT_VERSION),
    source: z.literal("codex"),
    adapterVersion: SemVerSchema,
    sourceSessionId: identifierSchema,
    sourceEventName: SupportedCodexHookNameSchema,
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

    const usesSourceId = CODEX_SOURCE_ID_HOOKS.has(
      receipt.sourceEventName as typeof CODEX_SOURCE_ID_HOOKS extends Set<infer Item>
        ? Item
        : never,
    );
    if (usesSourceId !== (receipt.sourceEventId !== null)) {
      context.addIssue({
        code: "custom",
        message: usesSourceId
          ? "This Codex Hook requires a source event ID."
          : "This Codex Hook cannot carry a source event ID in policy v1.",
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
export type PreparedCodexIngressReceiptV1 = z.infer<typeof PreparedCodexIngressReceiptV1Schema>;
