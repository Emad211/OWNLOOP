import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  canonicalizeJson,
  IngressSecurityError,
  MAX_INPUT_CANONICAL_UTF8_BYTES,
  parseCanonicalJson,
} from "../src/index.js";

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(expect.objectContaining({ code }));
}

describe("Canonical JSON v1", () => {
  it("is stable across object insertion order and preserves array order", () => {
    expect(canonicalizeJson({ beta: 2, alpha: [2, 1] })).toBe(
      canonicalizeJson({ alpha: [2, 1], beta: 2 }),
    );
    expect(canonicalizeJson([1, 2])).not.toBe(canonicalizeJson([2, 1]));
  });

  it("preserves Unicode without normalization", () => {
    const composed = "é";
    const decomposed = "e\u0301";
    expect(canonicalizeJson(composed)).toBe(JSON.stringify(composed));
    expect(canonicalizeJson(decomposed)).toBe(JSON.stringify(decomposed));
    expect(canonicalizeJson(composed)).not.toBe(canonicalizeJson(decomposed));
  });

  it("supports ordinary length properties and null-prototype plain objects", () => {
    expect(canonicalizeJson({ length: 1, value: true })).toBe('{"length":1,"value":true}');

    const value = Object.create(null) as Record<string, unknown>;
    value.beta = 2;
    value.alpha = 1;
    expect(canonicalizeJson(value)).toBe('{"alpha":1,"beta":2}');
  });

  it("rejects lone surrogates in values and keys", () => {
    expectCode(() => canonicalizeJson("\ud800"), "invalid_json_value");
    expectCode(() => canonicalizeJson({ "\udc00": true }), "invalid_json_value");
  });

  it("rejects negative zero at every nesting location", () => {
    expectCode(() => canonicalizeJson(-0), "invalid_json_value");
    expectCode(() => canonicalizeJson({ nested: -0 }), "invalid_json_value");
    expectCode(() => canonicalizeJson([0, -0]), "invalid_json_value");
  });

  it("rejects non-finite, sparse, cyclic, and non-plain values", () => {
    expectCode(() => canonicalizeJson(Number.POSITIVE_INFINITY), "invalid_json_value");
    expectCode(() => canonicalizeJson(Number.NaN), "invalid_json_value");

    const sparse = new Array(2);
    sparse[1] = true;
    expectCode(() => canonicalizeJson(sparse), "invalid_json_value");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectCode(() => canonicalizeJson(cyclic), "invalid_json_value");

    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "must-not-run",
    });
    expectCode(() => canonicalizeJson(accessor), "invalid_json_value");
    const nonEnumerable = Object.defineProperty({}, "value", {
      enumerable: false,
      value: true,
    });
    expectCode(() => canonicalizeJson(nonEnumerable), "invalid_json_value");

    class FixtureClass {
      readonly value = 1;
    }
    expectCode(() => canonicalizeJson(new FixtureClass()), "invalid_json_value");
    expectCode(() => canonicalizeJson(new Date()), "invalid_json_value");
    expectCode(() => canonicalizeJson(new Map()), "invalid_json_value");
    expectCode(() => canonicalizeJson(new Set()), "invalid_json_value");
    expectCode(() => canonicalizeJson(new Uint8Array([1, 2])), "invalid_json_value");
    expectCode(() => canonicalizeJson(undefined), "invalid_json_value");
    expectCode(() => canonicalizeJson(1n), "invalid_json_value");
    expectCode(() => canonicalizeJson(() => true), "invalid_json_value");
    expectCode(() => canonicalizeJson(Symbol("fixture")), "invalid_json_value");
  });

  it("enforces depth, property, array, and input-byte limits", () => {
    expectCode(
      () =>
        canonicalizeJson(
          { a: { b: true } },
          { maxUtf8Bytes: 100, maxDepth: 1, maxObjectProperties: 10, maxArrayItems: 10 },
        ),
      "input_too_deep",
    );
    expectCode(
      () =>
        canonicalizeJson(
          { a: 1, b: 2 },
          { maxUtf8Bytes: 100, maxDepth: 5, maxObjectProperties: 1, maxArrayItems: 10 },
        ),
      "object_property_limit",
    );
    expectCode(
      () =>
        canonicalizeJson([1, 2], {
          maxUtf8Bytes: 100,
          maxDepth: 5,
          maxObjectProperties: 10,
          maxArrayItems: 1,
        }),
      "array_item_limit",
    );
    const oversized = "x".repeat(MAX_INPUT_CANONICAL_UTF8_BYTES + 1);
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(MAX_INPUT_CANONICAL_UTF8_BYTES);
    expectCode(() => canonicalizeJson(oversized), "input_too_large");
  });

  it("parses only already-canonical JSON text", () => {
    expect(parseCanonicalJson('{"alpha":1,"beta":[true]}')).toEqual({
      alpha: 1,
      beta: [true],
    });
    expectCode(() => parseCanonicalJson('{ "alpha": 1 }'), "canonicalization_failed");
    expectCode(() => parseCanonicalJson('{"beta":2,"alpha":1}'), "canonicalization_failed");
    expectCode(() => parseCanonicalJson('{"alpha":1,"alpha":2}'), "canonicalization_failed");
    expectCode(() => parseCanonicalJson("-0"), "canonicalization_failed");
  });

  it("returns content-free stable errors", () => {
    const fixtureSecret = "fixture-secret-never-emit";
    let error: unknown;
    try {
      canonicalizeJson({ value: fixtureSecret, invalid: -0 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IngressSecurityError);
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(fixtureSecret);
    expect(String(error)).not.toContain(fixtureSecret);
  });
});
