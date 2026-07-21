import { Buffer } from "node:buffer";

import type { JsonValue } from "@ownloop/event-model";

import {
  MAX_INPUT_CANONICAL_UTF8_BYTES,
  MAX_OBJECT_PROPERTIES,
  MAX_RECURSIVE_DEPTH,
  MAX_SOURCE_ARRAY_ITEMS,
} from "./constants.js";
import { type IngressSecurityPath, ingressSecurityError } from "./errors.js";

export type CanonicalJsonLimits = Readonly<{
  maxUtf8Bytes: number;
  maxDepth: number;
  maxObjectProperties: number;
  maxArrayItems: number;
}>;

export const DEFAULT_CANONICAL_INPUT_LIMITS: CanonicalJsonLimits = Object.freeze({
  maxUtf8Bytes: MAX_INPUT_CANONICAL_UTF8_BYTES,
  maxDepth: MAX_RECURSIVE_DEPTH,
  maxObjectProperties: MAX_OBJECT_PROPERTIES,
  maxArrayItems: MAX_SOURCE_ARRAY_ITEMS,
});

type SerializationBudget = {
  utf8Bytes: number;
};

function validateLimits(limits: CanonicalJsonLimits): void {
  if (
    !Number.isInteger(limits.maxUtf8Bytes) ||
    limits.maxUtf8Bytes <= 0 ||
    !Number.isInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isInteger(limits.maxObjectProperties) ||
    limits.maxObjectProperties < 0 ||
    !Number.isInteger(limits.maxArrayItems) ||
    limits.maxArrayItems < 0
  ) {
    throw ingressSecurityError("policy_invariant");
  }
}

function consumeUtf8(budget: SerializationBudget, text: string, limits: CanonicalJsonLimits): void {
  budget.utf8Bytes += Buffer.byteLength(text, "utf8");
  if (budget.utf8Bytes > limits.maxUtf8Bytes) {
    throw ingressSecurityError("input_too_large");
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateDataProperties(
  value: object,
  keys: readonly string[],
  path: IngressSecurityPath,
): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw ingressSecurityError("invalid_json_value", path);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw ingressSecurityError("invalid_json_value", [...path, key]);
    }
  }

  const comparableOwnKeys = Array.isArray(value)
    ? ownKeys.filter((key) => key !== "length")
    : ownKeys;
  if (comparableOwnKeys.length !== keys.length) {
    throw ingressSecurityError("invalid_json_value", path);
  }
}

function serializePrimitive(
  serialized: string,
  budget: SerializationBudget,
  limits: CanonicalJsonLimits,
): string {
  consumeUtf8(budget, serialized, limits);
  return serialized;
}

function serializeValue(
  value: unknown,
  limits: CanonicalJsonLimits,
  budget: SerializationBudget,
  activeObjects: WeakSet<object>,
  path: IngressSecurityPath,
  depth: number,
): string {
  if (depth > limits.maxDepth) {
    throw ingressSecurityError("input_too_deep", path);
  }

  if (value === null) {
    return serializePrimitive("null", budget, limits);
  }

  switch (typeof value) {
    case "boolean":
      return serializePrimitive(value ? "true" : "false", budget, limits);
    case "number": {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw ingressSecurityError("invalid_json_value", path);
      }
      return serializePrimitive(JSON.stringify(value), budget, limits);
    }
    case "string": {
      if (hasLoneSurrogate(value)) {
        throw ingressSecurityError("invalid_json_value", path);
      }
      if (Buffer.byteLength(value, "utf8") > limits.maxUtf8Bytes) {
        throw ingressSecurityError("input_too_large", path);
      }
      return serializePrimitive(JSON.stringify(value), budget, limits);
    }
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      throw ingressSecurityError("invalid_json_value", path);
    case "object":
      break;
    default:
      throw ingressSecurityError("invalid_json_value", path);
  }

  const objectValue = value;
  if (activeObjects.has(objectValue)) {
    throw ingressSecurityError("invalid_json_value", path);
  }
  activeObjects.add(objectValue);

  try {
    if (Array.isArray(objectValue)) {
      if (objectValue.length > limits.maxArrayItems) {
        throw ingressSecurityError("array_item_limit", path);
      }

      const keys = Object.keys(objectValue);
      if (keys.length !== objectValue.length) {
        throw ingressSecurityError("invalid_json_value", path);
      }
      for (let index = 0; index < objectValue.length; index += 1) {
        if (!Object.hasOwn(objectValue, index)) {
          throw ingressSecurityError("invalid_json_value", [...path, index]);
        }
      }
      validateDataProperties(objectValue, keys, path);

      consumeUtf8(budget, "[", limits);
      const serializedItems: string[] = [];
      for (let index = 0; index < objectValue.length; index += 1) {
        if (index > 0) {
          consumeUtf8(budget, ",", limits);
        }
        serializedItems.push(
          serializeValue(
            objectValue[index],
            limits,
            budget,
            activeObjects,
            [...path, index],
            depth + 1,
          ),
        );
      }
      consumeUtf8(budget, "]", limits);
      return `[${serializedItems.join(",")}]`;
    }

    if (!isPlainObject(objectValue)) {
      throw ingressSecurityError("invalid_json_value", path);
    }

    const keys = Object.keys(objectValue);
    if (keys.length > limits.maxObjectProperties) {
      throw ingressSecurityError("object_property_limit", path);
    }
    validateDataProperties(objectValue, keys, path);

    consumeUtf8(budget, "{", limits);
    const sortedKeys = keys.sort(compareUtf16);
    const serializedProperties: string[] = [];
    for (let index = 0; index < sortedKeys.length; index += 1) {
      const key = sortedKeys[index];
      if (key === undefined) {
        throw ingressSecurityError("policy_invariant", path);
      }
      if (hasLoneSurrogate(key)) {
        throw ingressSecurityError("invalid_json_value", [...path, key]);
      }
      if (index > 0) {
        consumeUtf8(budget, ",", limits);
      }
      if (Buffer.byteLength(key, "utf8") > limits.maxUtf8Bytes) {
        throw ingressSecurityError("input_too_large", [...path, key]);
      }
      const serializedKey = JSON.stringify(key);
      consumeUtf8(budget, `${serializedKey}:`, limits);
      const serializedValue = serializeValue(
        objectValue[key],
        limits,
        budget,
        activeObjects,
        [...path, key],
        depth + 1,
      );
      serializedProperties.push(`${serializedKey}:${serializedValue}`);
    }
    consumeUtf8(budget, "}", limits);
    return `{${serializedProperties.join(",")}}`;
  } finally {
    activeObjects.delete(objectValue);
  }
}

export function canonicalizeJson(
  value: unknown,
  limits: CanonicalJsonLimits = DEFAULT_CANONICAL_INPUT_LIMITS,
): string {
  validateLimits(limits);
  return serializeValue(value, limits, { utf8Bytes: 0 }, new WeakSet(), [], 0);
}

export function parseCanonicalJson(canonical: string): JsonValue {
  try {
    const parsed = JSON.parse(canonical) as unknown;
    if (canonicalizeJson(parsed) !== canonical) {
      throw ingressSecurityError("canonicalization_failed");
    }
    return parsed as JsonValue;
  } catch {
    throw ingressSecurityError("canonicalization_failed");
  }
}
