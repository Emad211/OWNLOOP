import type { LocalSettingsErrorCode } from "@ownloop/contracts";

export class LocalSettingsServiceError extends Error {
  readonly code: LocalSettingsErrorCode;

  constructor(code: LocalSettingsErrorCode) {
    super("The local settings operation failed.");
    this.name = "LocalSettingsServiceError";
    this.code = code;
  }
}
