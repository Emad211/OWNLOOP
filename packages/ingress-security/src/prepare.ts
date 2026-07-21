import { Buffer } from "node:buffer";
import type { KeyObject } from "node:crypto";

import {
  type ClaudeAdapterIngress,
  INGRESS_CANONICALIZATION_VERSION,
  INGRESS_REDACTION_POLICY_VERSION,
  type PreparedIngressReceiptV1,
  PreparedIngressReceiptV1Schema,
} from "@ownloop/contracts";

import { canonicalizeJson } from "./canonical-json.js";
import {
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_PROPERTIES,
  MAX_OUTPUT_CANONICAL_UTF8_BYTES,
  MAX_RECURSIVE_DEPTH,
} from "./constants.js";
import { IngressSecurityError } from "./errors.js";
import {
  createDeduplicationKey,
  extractSourceEventId,
  fingerprintSourcePayload,
} from "./fingerprint.js";
import { createPathReductionContext } from "./path-reduction.js";
import { createRedactionState, finalizeRedactionSummary } from "./redaction-state.js";
import { reduceAndRedactHookPayload } from "./reduction.js";

export type PrepareIngressReceiptOptions = Readonly<{
  hmacKey: KeyObject;
  homePath?: string;
}>;

export function prepareIngressReceipt(
  validatedIngress: ClaudeAdapterIngress,
  options: PrepareIngressReceiptOptions,
): PreparedIngressReceiptV1 {
  try {
    const payloadFingerprint = fingerprintSourcePayload(validatedIngress.payload, options.hmacKey);
    const sourceEventId = extractSourceEventId(validatedIngress.payload);
    const deduplicationKey = createDeduplicationKey(
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
    const reducedPayload = reduceAndRedactHookPayload(validatedIngress.payload, { paths, state });
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

    const parsed = PreparedIngressReceiptV1Schema.safeParse({
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

    if (!parsed.success) {
      throw new IngressSecurityError("policy_invariant");
    }

    return {
      ...parsed.data,
      redactionSummary: {
        ...parsed.data.redactionSummary,
        rulesApplied: [...parsed.data.redactionSummary.rulesApplied],
      },
    };
  } catch (error) {
    if (error instanceof IngressSecurityError) {
      throw error;
    }
    throw new IngressSecurityError("policy_invariant");
  }
}
