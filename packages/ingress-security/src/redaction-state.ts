import type { IngressRedactionRuleId, RedactionSummaryV1 } from "@ownloop/contracts";

export type RedactionState = {
  redactedFieldCount: number;
  redactedValueCount: number;
  pathReplacementCount: number;
  droppedUnknownFieldCount: number;
  truncatedValueCount: number;
  readonly rulesApplied: Set<IngressRedactionRuleId>;
};

export function createRedactionState(): RedactionState {
  return {
    redactedFieldCount: 0,
    redactedValueCount: 0,
    pathReplacementCount: 0,
    droppedUnknownFieldCount: 0,
    truncatedValueCount: 0,
    rulesApplied: new Set(),
  };
}

export function finalizeRedactionSummary(
  state: RedactionState,
  outputUtf8Bytes: number,
): RedactionSummaryV1 {
  return {
    policyVersion: 1,
    redactedFieldCount: state.redactedFieldCount,
    redactedValueCount: state.redactedValueCount,
    pathReplacementCount: state.pathReplacementCount,
    droppedUnknownFieldCount: state.droppedUnknownFieldCount,
    truncatedValueCount: state.truncatedValueCount,
    rulesApplied: [...state.rulesApplied].sort(),
    outputUtf8Bytes,
  };
}
