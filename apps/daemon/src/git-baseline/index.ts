export {
  captureGitBaseline,
  captureMissingGitBaselines,
  type GitBaselineCaptureDependencies,
  type GitBaselineCaptureResult,
} from "./processor.js";
export {
  DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS,
  observeGitBaseline,
  type GitBaselineObservation,
  type GitBaselineObservationLimits,
} from "./observation.js";
export {
  GitCommandError,
  runGitCommand,
  type GitCommandFailure,
  type GitCommandRequest,
  type GitCommandResult,
  type GitCommandRunner,
} from "./git-runner.js";
export { computeWorkingTreeFingerprint } from "./fingerprint.js";
export {
  isSensitiveUntrackedPath,
  scanUntrackedEntries,
  type ScannedUntrackedEntry,
  type UntrackedScanLimits,
  type UntrackedScanResult,
} from "./untracked.js";
