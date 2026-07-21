import { Buffer } from "node:buffer";

import type { JsonValue } from "@ownloop/event-model";

import {
  ARRAY_TRUNCATION_MARKER,
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_PROPERTIES,
  MAX_RECURSIVE_DEPTH,
  MAX_RETAINED_STRING_UTF8_BYTES,
  REDACTION_MARKER,
  REDACTION_RULES,
  STRING_TRUNCATION_MARKER,
} from "./constants.js";
import { type IngressSecurityPath, ingressSecurityError } from "./errors.js";
import { type PathReductionContext, reducePathsInString } from "./path-reduction.js";
import type { RedactionState } from "./redaction-state.js";

const SECRET_FIELD_NAMES = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "privatekey",
  "sshprivatekey",
  "credential",
  "credentials",
]);

const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]{4,1048576}/gi;
const PRIVATE_KEY_BEGIN_PATTERN =
  /-----BEGIN ((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----/g;
const MAX_PRIVATE_KEY_BLOCK_CHARACTERS = 131_072;
const ASSIGNMENT_PATTERN =
  /\b(password|passwd|token|api[_-]?key|client[_-]?secret)([ \t]*[:=][ \t]*)([^\s;&,]{1,1048576})/gi;
const URI_PASSWORD_PATTERN =
  /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]{1,512}:)([^\s/@]{1,1048576})(@)/g;
const PROVIDER_TOKEN_PATTERN =
  /(^|[^A-Za-z0-9_])((?:sk|ghp|github_pat|xox[baprs]|fixture-provider-token)[-_][A-Za-z0-9_-]{12,1048576})(?=$|[^A-Za-z0-9_])/gi;

export function normalizeSecretFieldName(name: string): string {
  return name.toLowerCase().replace(/[_.\-\s]/g, "");
}

export function isSecretFieldName(name: string): boolean {
  return SECRET_FIELD_NAMES.has(normalizeSecretFieldName(name));
}

function replacePattern(
  input: string,
  pattern: RegExp,
  replacement: string | ((...matches: string[]) => string),
): { output: string; count: number } {
  let count = 0;
  pattern.lastIndex = 0;
  const output = input.replace(pattern, (...arguments_) => {
    count += 1;
    if (typeof replacement === "string") {
      return replacement;
    }
    const stringArguments = arguments_.slice(0, -2).map(String);
    return replacement(...stringArguments);
  });
  pattern.lastIndex = 0;
  return { output, count };
}

function redactPrivateKeyBlocks(input: string): { output: string; count: number } {
  let cursor = 0;
  let output = "";
  let count = 0;

  PRIVATE_KEY_BEGIN_PATTERN.lastIndex = 0;
  for (
    let match = PRIVATE_KEY_BEGIN_PATTERN.exec(input);
    match !== null;
    match = PRIVATE_KEY_BEGIN_PATTERN.exec(input)
  ) {
    const label = match[1];
    if (label === undefined) {
      continue;
    }

    output += input.slice(cursor, match.index);
    const endMarker = `-----END ${label}-----`;
    const endIndex = input.indexOf(endMarker, PRIVATE_KEY_BEGIN_PATTERN.lastIndex);
    const boundedEnd = match.index + MAX_PRIVATE_KEY_BLOCK_CHARACTERS;

    output += REDACTION_MARKER;
    count += 1;

    if (endIndex === -1 || endIndex + endMarker.length > boundedEnd) {
      cursor = input.length;
      break;
    }

    cursor = endIndex + endMarker.length;
    PRIVATE_KEY_BEGIN_PATTERN.lastIndex = cursor;
  }
  PRIVATE_KEY_BEGIN_PATTERN.lastIndex = 0;

  return { output: `${output}${input.slice(cursor)}`, count };
}

function redactStrongPatterns(value: string, state: RedactionState): string {
  let output = value;

  if (/bearer|basic/i.test(output)) {
    const authorization = replacePattern(
      output,
      AUTHORIZATION_PATTERN,
      (_whole, scheme) => `${scheme} ${REDACTION_MARKER}`,
    );
    output = authorization.output;
    if (authorization.count > 0) {
      state.redactedValueCount += authorization.count;
      state.rulesApplied.add(REDACTION_RULES.authorization);
    }
  }

  if (output.includes("PRIVATE KEY")) {
    const privateKey = redactPrivateKeyBlocks(output);
    output = privateKey.output;
    if (privateKey.count > 0) {
      state.redactedValueCount += privateKey.count;
      state.rulesApplied.add(REDACTION_RULES.privateKey);
    }
  }

  if (/password|passwd|token|api[_-]?key|client[_-]?secret/i.test(output)) {
    const assignment = replacePattern(
      output,
      ASSIGNMENT_PATTERN,
      (_whole, name, separator) => `${name}${separator}${REDACTION_MARKER}`,
    );
    output = assignment.output;
    if (assignment.count > 0) {
      state.redactedValueCount += assignment.count;
      state.rulesApplied.add(REDACTION_RULES.assignment);
    }
  }

  if (output.includes("://") && output.includes("@")) {
    const uriPassword = replacePattern(
      output,
      URI_PASSWORD_PATTERN,
      (_whole, prefix, _password, suffix) => `${prefix}${REDACTION_MARKER}${suffix}`,
    );
    output = uriPassword.output;
    if (uriPassword.count > 0) {
      state.redactedValueCount += uriPassword.count;
      state.rulesApplied.add(REDACTION_RULES.uriPassword);
    }
  }

  if (/(?:sk|ghp|github_pat|xox[baprs]|fixture-provider-token)[-_]/i.test(output)) {
    const providerToken = replacePattern(
      output,
      PROVIDER_TOKEN_PATTERN,
      (_whole, prefix) => `${prefix}${REDACTION_MARKER}`,
    );
    output = providerToken.output;
    if (providerToken.count > 0) {
      state.redactedValueCount += providerToken.count;
      state.rulesApplied.add(REDACTION_RULES.providerToken);
    }
  }

  return output;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) {
    return value;
  }

  const markerBytes = Buffer.byteLength(STRING_TRUNCATION_MARKER, "utf8");
  const targetBytes = maximumBytes - markerBytes;
  let low = 0;
  let high = value.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (Buffer.byteLength(candidate, "utf8") <= targetBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  let boundary = low;
  if (boundary > 0) {
    const finalCodeUnit = value.charCodeAt(boundary - 1);
    if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      boundary -= 1;
    }
  }
  return `${value.slice(0, boundary)}${STRING_TRUNCATION_MARKER}`;
}

export type SanitizeContext = Readonly<{
  paths: PathReductionContext;
  state: RedactionState;
}>;

function sanitizeString(value: string, fieldName: string | null, context: SanitizeContext): string {
  const redacted = redactStrongPatterns(value, context.state);
  const pathReduced = reducePathsInString(redacted, fieldName, context.paths, context.state);
  const truncated = truncateUtf8(pathReduced, MAX_RETAINED_STRING_UTF8_BYTES);
  if (truncated !== pathReduced) {
    context.state.truncatedValueCount += 1;
    context.state.rulesApplied.add(REDACTION_RULES.stringTruncation);
  }
  return truncated;
}

function sanitizeArray(
  value: readonly unknown[],
  context: SanitizeContext,
  path: IngressSecurityPath,
  depth: number,
): JsonValue[] {
  const truncated = value.length > MAX_ARRAY_ITEMS;
  const retainedCount = truncated ? MAX_ARRAY_ITEMS - 1 : value.length;
  const output: JsonValue[] = [];
  for (let index = 0; index < retainedCount; index += 1) {
    output.push(sanitizeArbitraryJson(value[index], context, [...path, index], depth + 1));
  }
  if (truncated) {
    output.push({ ...ARRAY_TRUNCATION_MARKER });
    context.state.truncatedValueCount += 1;
    context.state.rulesApplied.add(REDACTION_RULES.arrayTruncation);
  }
  return output;
}

function sanitizeObjectKey(
  key: string,
  context: SanitizeContext,
  path: IngressSecurityPath,
): string {
  const sanitized = sanitizeString(key, null, context);
  if (sanitized.length === 0) {
    throw ingressSecurityError("policy_invariant", path);
  }
  return sanitized;
}

function sanitizeObject(
  value: Record<string, unknown>,
  context: SanitizeContext,
  path: IngressSecurityPath,
  depth: number,
): Record<string, JsonValue> {
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_PROPERTIES) {
    throw ingressSecurityError("object_property_limit", path);
  }

  const output = Object.create(null) as Record<string, JsonValue>;
  for (const key of keys) {
    const sanitizedKey = sanitizeObjectKey(key, context, [...path, key]);
    if (Object.hasOwn(output, sanitizedKey)) {
      throw ingressSecurityError("policy_invariant", [...path, key]);
    }

    if (isSecretFieldName(key)) {
      output[sanitizedKey] = REDACTION_MARKER;
      context.state.redactedFieldCount += 1;
      context.state.redactedValueCount += 1;
      context.state.rulesApplied.add(REDACTION_RULES.secretField);
      continue;
    }
    output[sanitizedKey] = sanitizeArbitraryJson(
      value[key],
      context,
      [...path, key],
      depth + 1,
      key,
    );
  }
  return output;
}

export function sanitizeArbitraryJson(
  value: unknown,
  context: SanitizeContext,
  path: IngressSecurityPath = [],
  depth = 0,
  fieldName: string | null = null,
): JsonValue {
  if (depth > MAX_RECURSIVE_DEPTH) {
    throw ingressSecurityError("input_too_deep", path);
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw ingressSecurityError("invalid_json_value", path);
    }
    return value;
  }
  if (typeof value === "string") {
    return sanitizeString(value, fieldName, context);
  }
  if (Array.isArray(value)) {
    return sanitizeArray(value, context, path, depth);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw ingressSecurityError("invalid_json_value", path);
    }
    return sanitizeObject(value as Record<string, unknown>, context, path, depth);
  }
  throw ingressSecurityError("invalid_json_value", path);
}

export function assertStructuralArrayLimit(
  value: readonly unknown[] | undefined,
  path: IngressSecurityPath,
): void {
  if (value !== undefined && value.length > MAX_ARRAY_ITEMS) {
    throw ingressSecurityError("array_item_limit", path);
  }
}
