export const REPLAY_LIST_ROUTE = "/v1/replay/runs" as const;
export const REPLAY_RUN_ROUTE = "/v1/replay/runs/:runId" as const;
export const REPLAY_ARTIFACT_ROUTE = "/v1/replay/artifacts/:artifactId" as const;
export const REPLAY_EVIDENCE_ROUTE = "/v1/replay/runs/:runId/evidence/:evidenceId" as const;
export const FINAL_DIFF_MANIFEST_ROLE = "final-diff-manifest-v1" as const;
export const FINAL_DIFF_MANIFEST_KIND = "final-diff-manifest-v1" as const;
export const FINAL_DIFF_MANIFEST_MEDIA_TYPE = "application/vnd.ownloop.final-diff+json" as const;
