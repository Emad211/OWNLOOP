import { describe, expect, it } from "vitest";

import { reduceVerificationOutput } from "./reducer.js";

describe("verification output reducer", () => {
  it("normalizes lines and strips ANSI/control sequences", () => {
    const result = reduceVerificationOutput(
      "stdout",
      "\u001b[31mFAIL\u001b[0m\r\nnext\u0000line\tvalue",
    );
    expect(result.excerpt).toBe("FAIL\nnextline\tvalue");
    expect(result.acceptedByteCount).toBeGreaterThan(result.excerptByteCount);
    expect(result.acceptedSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("truncates by deterministic line and byte bounds", () => {
    const result = reduceVerificationOutput(
      "stderr",
      `${"x".repeat(30_000)}\n${"y\n".repeat(100)}`,
    );
    expect(result.truncated).toBe(true);
    expect(result.excerptByteCount).toBeLessThanOrEqual(16 * 1024);
    expect(Array.from(result.excerpt).length).toBeLessThanOrEqual(4_096);
  });

  it("does not infer meaning from output text", () => {
    const result = reduceVerificationOutput("output", "all tests passed");
    expect(result).not.toHaveProperty("status");
  });
});
