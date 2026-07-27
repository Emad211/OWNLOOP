import { describe, expect, it } from "vitest";

import { EvidenceNodeMetadataV1Schema } from "../src/index.js";

describe("Evidence Graph multi-agent source metadata", () => {
  it("accepts the controlled Codex source", () => {
    expect(
      EvidenceNodeMetadataV1Schema.parse({
        eventType: "tool.requested",
        eventSource: "codex",
        sensitivity: "sensitive",
        sourceAnalyzerVersion: "1",
      }),
    ).toEqual({
      eventType: "tool.requested",
      eventSource: "codex",
      sensitivity: "sensitive",
      sourceAnalyzerVersion: "1",
    });
  });

  it("still rejects an unknown source", () => {
    expect(EvidenceNodeMetadataV1Schema.safeParse({ eventSource: "future_agent" }).success).toBe(
      false,
    );
  });
});
