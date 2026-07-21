import { createSecretKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createDeduplicationKey,
  extractSourceEventId,
  fingerprintSourcePayload,
  IngressSecurityError,
} from "../src/index.js";
import { ingressFixture, SUPPORTED_HOOKS } from "./fixtures.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 7));

describe("keyed source fingerprinting", () => {
  it("is stable across object insertion order and ignores wrapper receivedAt", () => {
    const first = ingressFixture("UserPromptSubmit", { future_field: { beta: 2, alpha: 1 } });
    const second = {
      ...first,
      receivedAt: "2026-07-21T10:00:00+00:00",
      payload: {
        future_field: { alpha: 1, beta: 2 },
        ...first.payload,
      },
    };

    expect(fingerprintSourcePayload(first.payload, HMAC_KEY)).toBe(
      fingerprintSourcePayload(second.payload, HMAC_KEY),
    );
  });

  it("changes when source content or unknown source fields change", () => {
    const first = ingressFixture("UserPromptSubmit", { future_field: "one" });
    const second = ingressFixture("UserPromptSubmit", { future_field: "two" });
    expect(fingerprintSourcePayload(first.payload, HMAC_KEY)).not.toBe(
      fingerprintSourcePayload(second.payload, HMAC_KEY),
    );
  });

  it("requires a secret KeyObject with at least 32 bytes", () => {
    expect(() =>
      fingerprintSourcePayload(ingressFixture().payload, createSecretKey(Buffer.alloc(31, 1))),
    ).toThrowError(expect.objectContaining({ code: "invalid_hmac_key" }));

    const { publicKey } = generateKeyPairSync("ed25519");
    expect(() => fingerprintSourcePayload(ingressFixture().payload, publicKey)).toThrowError(
      expect.objectContaining({ code: "invalid_hmac_key" }),
    );
  });

  it("extracts source IDs exhaustively for all supported Hooks", () => {
    const expected: Record<string, string | null> = {
      SessionStart: null,
      UserPromptSubmit: "d9428888-122b-11e1-b85c-61cd3cbb3210",
      PreToolUse: "tool-fixture-001",
      PostToolUse: "tool-fixture-002",
      PostToolUseFailure: "tool-fixture-003",
      PostToolBatch: null,
      Stop: null,
      StopFailure: null,
      SessionEnd: null,
    };

    for (const hook of SUPPORTED_HOOKS) {
      expect(extractSourceEventId(ingressFixture(hook).payload)).toBe(expected[hook]);
    }
  });

  it("creates encoded ID and HMAC deduplication keys", () => {
    const fingerprint = fingerprintSourcePayload(ingressFixture().payload, HMAC_KEY);
    const idKey = createDeduplicationKey("PreToolUse", "tool:id/fixture", fingerprint);
    expect(idKey).toMatch(/^v1:PreToolUse:id:[A-Za-z0-9_-]+$/);
    expect(idKey).not.toContain("tool:id/fixture");

    const unicodeId = "tool-é/fixture";
    expect(createDeduplicationKey("PreToolUse", unicodeId, fingerprint)).toBe(
      `v1:PreToolUse:id:${Buffer.from(unicodeId, "utf8").toString("base64url")}`,
    );

    const hmacKey = createDeduplicationKey("Stop", null, fingerprint);
    expect(hmacKey).toBe(`v1:Stop:hmac:${fingerprint.slice("hmac-sha256:".length)}`);
  });

  it("rejects malformed fingerprints and oversized source IDs safely", () => {
    expect(() =>
      createDeduplicationKey("Stop", null, "hmac-sha256:invalid" as `hmac-sha256:${string}`),
    ).toThrowError(expect.objectContaining({ code: "policy_invariant" }));
    expect(() =>
      createDeduplicationKey(
        "PreToolUse",
        "x".repeat(2_000),
        fingerprintSourcePayload(ingressFixture().payload, HMAC_KEY),
      ),
    ).toThrowError(expect.objectContaining({ code: "policy_invariant" }));
  });

  it("does not expose key material in errors", () => {
    const keyFixture = Buffer.from("fixture-key-material-that-must-not-leak");
    let error: unknown;
    try {
      fingerprintSourcePayload(
        ingressFixture().payload,
        createSecretKey(keyFixture.subarray(0, 16)),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IngressSecurityError);
    expect(JSON.stringify(error)).not.toContain(keyFixture.toString("utf8"));
  });
});
