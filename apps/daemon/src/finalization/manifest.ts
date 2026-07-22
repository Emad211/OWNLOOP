import { canonicalizeJson } from "@ownloop/ingress-security";

import type { GitReconciliation } from "../persistence/index.js";
import { FINAL_DIFF_MANIFEST_VERSION } from "./constants.js";

export type PreparedFinalDiffManifest = Readonly<{
  canonicalJson: string;
  bytes: Uint8Array;
}>;

export function prepareFinalDiffManifest(
  runId: string,
  reconciliation: GitReconciliation,
): PreparedFinalDiffManifest {
  const value = {
    version: FINAL_DIFF_MANIFEST_VERSION,
    runId,
    reconciliationId: reconciliation.reconciliationId,
    outcome: reconciliation.outcome,
    diagnosticCode: reconciliation.diagnosticCode,
    attribution: reconciliation.attribution,
    baselineComparison: reconciliation.baselineComparison,
    boundary: reconciliation.boundary,
    finalFingerprintPresent: reconciliation.workingTreeFingerprint !== null,
    stagedDirty: reconciliation.stagedDirty,
    unstagedDirty: reconciliation.unstagedDirty,
    counts: {
      entryCount: reconciliation.entryCount,
      created: reconciliation.createdCount,
      modified: reconciliation.modifiedCount,
      deleted: reconciliation.deletedCount,
      typeChanged: reconciliation.typeChangedCount,
      unmerged: reconciliation.unmergedCount,
    },
    entries: reconciliation.entries.map((entry) => ({
      eventIndex: entry.entryIndex,
      pathIdentitySha256: entry.pathIdentitySha256,
      relativePath: entry.relativePath,
      changeKind: entry.changeKind,
      staged: entry.staged,
      unstaged: entry.unstaged,
      sensitivity: entry.sensitivity,
      attribution: entry.attribution,
    })),
  };
  const canonicalJson = canonicalizeJson(value);
  return { canonicalJson, bytes: new TextEncoder().encode(canonicalJson) };
}
