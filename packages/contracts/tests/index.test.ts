import { describe, expect, it } from "vitest";

import { APP_NAME, formatBootstrapName } from "../src/index.js";

describe("bootstrap contract", () => {
  it("formats the stable workspace label", () => {
    expect(formatBootstrapName(APP_NAME)).toBe("OwnLoop v0.1 bootstrap");
  });
});
