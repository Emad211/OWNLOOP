import { CANDIDATE_VALIDATION_MAX_BATCH } from "@ownloop/contracts";

export const CANDIDATE_VALIDATION_REPORT_ROLE = "candidate-validation-report-v1" as const;
export const CANDIDATE_VALIDATION_REPORT_KIND = "candidate-validation-report-v1" as const;
export const CANDIDATE_VALIDATION_REPORT_MEDIA_TYPE =
  "application/vnd.ownloop.candidate-validation-report+json" as const;
export const CANDIDATE_VALIDATION_REPORT_SENSITIVITY = "sensitive" as const;
export const MAX_CANDIDATE_VALIDATION_BATCH = CANDIDATE_VALIDATION_MAX_BATCH;
