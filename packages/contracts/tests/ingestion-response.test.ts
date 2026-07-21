import {
  invalidIngestionResponseFixtures,
  validIngestionResponseFixtures,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import { INGESTION_ERROR_CODES, IngestionResponseSchema } from "../src/index.js";

describe("structured ingestion responses", () => {
  it.each(validIngestionResponseFixtures)("parses $name", ({ input }) => {
    expect(IngestionResponseSchema.safeParse(input).success).toBe(true);
  });

  it.each(invalidIngestionResponseFixtures)("rejects $name", ({ input }) => {
    expect(IngestionResponseSchema.safeParse(input).success).toBe(false);
  });

  it("exposes the loopback ingestion error codes", () => {
    expect(INGESTION_ERROR_CODES).toEqual([
      "unauthorized",
      "invalid_payload",
      "unsupported_hook",
      "payload_too_large",
      "unsupported_media_type",
      "deduplication_conflict",
      "persistence_failed",
      "internal_error",
    ]);
  });
});
