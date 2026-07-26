import {
  invalidCodexAdapterIngressFixtures,
  invalidCodexSourceMetadataFixtures,
  validCodexAdapterIngressFixture,
  validCodexSourceMetadataFixture,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import { CodexAdapterIngressSchema, CodexSourceMetadataSchema } from "../src/index.js";

describe("Codex adapter ingress", () => {
  it("parses the controlled wrapper", () => {
    expect(CodexAdapterIngressSchema.parse(validCodexAdapterIngressFixture)).toEqual(
      validCodexAdapterIngressFixture,
    );
  });

  it.each(invalidCodexAdapterIngressFixtures)("rejects $name", ({ input }) => {
    expect(CodexAdapterIngressSchema.safeParse(input).success).toBe(false);
  });
});

describe("Codex source metadata", () => {
  it("parses controlled source metadata", () => {
    expect(CodexSourceMetadataSchema.parse(validCodexSourceMetadataFixture)).toEqual(
      validCodexSourceMetadataFixture,
    );
  });

  it.each(invalidCodexSourceMetadataFixtures)("rejects $name", ({ input }) => {
    expect(CodexSourceMetadataSchema.safeParse(input).success).toBe(false);
  });
});
