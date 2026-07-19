import {
  invalidClaudeAdapterIngressFixtures,
  invalidClaudeSourceMetadataFixtures,
  validClaudeAdapterIngressFixture,
  validClaudeSourceMetadataFixture,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import { ClaudeAdapterIngressSchema, ClaudeSourceMetadataSchema } from "../src/index.js";

describe("Claude adapter ingress wrapper", () => {
  it("parses the versioned wrapper", () => {
    expect(ClaudeAdapterIngressSchema.safeParse(validClaudeAdapterIngressFixture).success).toBe(
      true,
    );
  });

  it.each(invalidClaudeAdapterIngressFixtures)("rejects $name", ({ input }) => {
    expect(ClaudeAdapterIngressSchema.safeParse(input).success).toBe(false);
  });
});

describe("Claude source metadata", () => {
  it("parses supported source metadata", () => {
    expect(ClaudeSourceMetadataSchema.safeParse(validClaudeSourceMetadataFixture).success).toBe(
      true,
    );
  });

  it.each(invalidClaudeSourceMetadataFixtures)("rejects $name", ({ input }) => {
    expect(ClaudeSourceMetadataSchema.safeParse(input).success).toBe(false);
  });
});
