import { Buffer } from "node:buffer";
import { createHmac, type KeyObject } from "node:crypto";

import {
  type HmacSha256Fingerprint,
  HmacSha256FingerprintSchema,
  type IngressDeduplicationKey,
  IngressDeduplicationKeySchema,
  type SupportedClaudeHookName,
  type SupportedClaudeHookPayload,
} from "@ownloop/contracts";

import { canonicalizeJson } from "./canonical-json.js";
import { IngressSecurityError, ingressSecurityError } from "./errors.js";

const MINIMUM_HMAC_KEY_BYTES = 32;

export function validateIngressHmacKey(key: KeyObject): void {
  if (key.type !== "secret" || (key.symmetricKeySize ?? 0) < MINIMUM_HMAC_KEY_BYTES) {
    throw ingressSecurityError("invalid_hmac_key");
  }
}

export function fingerprintSourcePayload(
  payload: SupportedClaudeHookPayload,
  key: KeyObject,
): HmacSha256Fingerprint {
  validateIngressHmacKey(key);
  const canonicalPayload = canonicalizeJson(payload);
  try {
    const digest = createHmac("sha256", key).update(canonicalPayload, "utf8").digest("hex");
    return `hmac-sha256:${digest}` as HmacSha256Fingerprint;
  } catch {
    throw new IngressSecurityError("invalid_hmac_key");
  }
}

export function extractSourceEventId(payload: SupportedClaudeHookPayload): string | null {
  switch (payload.hook_event_name) {
    case "UserPromptSubmit":
      return payload.prompt_id ?? null;
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      return payload.tool_use_id;
    case "SessionStart":
    case "PostToolBatch":
    case "Stop":
    case "StopFailure":
    case "SessionEnd":
      return null;
    default: {
      const _unreachable: never = payload;
      throw new IngressSecurityError("unsupported_hook", {
        path: ["hook_event_name"],
      });
    }
  }
}

function encodeSourceEventId(sourceEventId: string): string {
  const encoded = Buffer.from(sourceEventId, "utf8").toString("base64url");
  if (encoded.length === 0 || encoded.length > 1024) {
    throw ingressSecurityError("policy_invariant", ["sourceEventId"]);
  }
  return encoded;
}

export function createDeduplicationKey(
  hookName: SupportedClaudeHookName,
  sourceEventId: string | null,
  fingerprint: HmacSha256Fingerprint,
): IngressDeduplicationKey {
  if (!HmacSha256FingerprintSchema.safeParse(fingerprint).success) {
    throw ingressSecurityError("policy_invariant", ["payloadFingerprint"]);
  }

  const candidate =
    sourceEventId === null
      ? `v1:${hookName}:hmac:${fingerprint.slice("hmac-sha256:".length)}`
      : `v1:${hookName}:id:${encodeSourceEventId(sourceEventId)}`;
  const parsed = IngressDeduplicationKeySchema.safeParse(candidate);
  if (!parsed.success) {
    throw ingressSecurityError("policy_invariant", ["deduplicationKey"]);
  }
  return parsed.data;
}
