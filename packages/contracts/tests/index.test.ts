import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  CHANGE_CLASSIFIER_VERSION,
  DeterministicChangeClassificationV1Schema,
  formatBootstrapName,
} from "../src/index.js";

describe("bootstrap contract", () => {
  it("formats the stable workspace label", () => {
    expect(formatBootstrapName(APP_NAME)).toBe("OwnLoop v0.1 bootstrap");
  });

  it("exports deterministic change-classification contracts from the package root", () => {
    expect(CHANGE_CLASSIFIER_VERSION).toBe("0.1.0");
    expect(DeterministicChangeClassificationV1Schema).toBeDefined();
  });
});
