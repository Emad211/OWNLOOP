import { Buffer } from "node:buffer";
import type { KeyObject } from "node:crypto";
import {
  INGRESS_CANONICALIZATION_VERSION,
  INGRESS_REDACTION_POLICY_VERSION,
  LocalSecretFieldPatternsSchema,
} from "@ownloop/contracts";
import type { CodexAdapterIngress } from "@ownloop/contracts/codex";
import { PreparedCodexIngressReceiptV1Schema } from "@ownloop/contracts/codex";

import { canonicalizeJson } from "./canonical-json.js";
import {
  createCodexDeduplicationKey,
  extractCodexSourceEventId,
  fingerprintCodexSourcePayload,
} from "./codex-fingerprint.js";
import { reduceAndRedactCodexIngress } from "./codex-reduction.js";
import {
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_PROPERTIES,
  MAX_OUTPUT_CANONICAL_UTF8_BYTES,
  MAX_RECURSIVE_DEPTH,
} from "./constants.js";
import { IngressSecurityError } from "./errors.js";
import { createPathReductionContext } from "./path-reduction.js";
import { createRedactionState, finalizeRedactionSummary } from "./redaction-state.js";

export type PrepareCodexIngressReceiptOptions = Readonly<{
  hmacKey: KeyObject;
  homePath?: string;
  customSecretFieldPatterns?: readonly string[];
}>;

export function prepareCodexIngressReceipt(
  validatedIngress: CodexAdapterIngress,
  options: PrepareCodexIngressReceiptOptions,
) {
  try {
    const payloadFingerprint = fingerprintCodexSourcePayload(
      validatedIngress.payload,
      options.hmacKey,
    );
    const sourceEventId = extractCodexSourceEventId(validatedIngress.payload);
    const deduplicationKey = createCodexDeduplicationKey(
      validatedIngress.payload.hook_event_name,
      sourceEventId,
      payloadFingerprint,
    );
    const paths = createPathReductionContext(
      validatedIngress.payload.cwd,
      validatedIngress.payload.transcript_path,
      options.homePath,
    );
    const state = createRedactionState();
    const customSecretFieldPatterns = LocalSecretFieldPatternsSchema.parse(
      options.customSecretFieldPatterns ?? [],
    );
    const reducedPayload = reduceAndRedactCodexIngress(validatedIngress, {
      paths,
      state,
      customSecretFieldPatterns,
    });
    let redactedPayloadJson: string;
    try {
      redactedPayloadJson = canonicalizeJson(reducedPayload, {
        maxUtf8Bytes: MAX_OUTPUT_CANONICAL_UTF8_BYTES,
        maxDepth: MAX_RECURSIVE_DEPTH,
        maxObjectProperties: MAX_OBJECT_PROPERTIES,
        maxArrayItems: MAX_ARRAY_ITEMS,
      });
    } catch (error) {
      if (error instanceof IngressSecurityError && error.code === "input_too_large") {
        throw new IngressSecurityError("output_too_large");
      }
      throw error;
    }
    const outputUtf8Bytes = Buffer.byteLength(redactedPayloadJson, "utf8");
    const redactionSummary = finalizeRedactionSummary(state, outputUtf8Bytes);
    const parsed = PreparedCodexIngressReceiptV1Schema.safeParse({
      canonicalizationVersion: INGRESS_CANONICALIZATION_VERSION,
      redactionPolicyVersion: INGRESS_REDACTION_POLICY_VERSION,
      ingressContractVersion: validatedIngress.contractVersion,
      source: validatedIngress.source,
      adapterVersion: validatedIngress.adapterVersion,
      sourceSessionId: validatedIngress.payload.session_id,
      sourceEventName: validatedIngress.payload.hook_event_name,
      sourceEventId,
      canonicalWorkspacePath: paths.workspace.value,
      receivedAt: validatedIngress.receivedAt,
      payloadFingerprint,
      deduplicationKey,
      redactedPayloadJson,
      redactionSummary,
    });
    if (!parsed.success) throw new IngressSecurityError("policy_invariant");
    return {
      ...parsed.data,
      redactionSummary: {
        ...parsed.data.redactionSummary,
        rulesApplied: [...parsed.data.redactionSummary.rulesApplied],
      },
    };
  } catch (error) {
    if (error instanceof IngressSecurityError) throw error;
    throw new IngressSecurityError("policy_invariant");
  }
}
