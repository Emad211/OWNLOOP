export const MOMENT_INTERACTION_STATE_ROUTE = "/v1/replay/runs/:runId/moment-interactions" as const;
export const MOMENT_INTERACTION_WRITE_ROUTE =
  "/v1/replay/runs/:runId/moments/:momentId/interactions" as const;
export const MOMENT_INTERACTION_BODY_LIMIT_BYTES = 4 * 1024;
