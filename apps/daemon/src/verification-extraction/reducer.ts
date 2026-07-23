import { createHash } from "node:crypto";

import type { VerificationOutputField, VerificationReducedOutputV1 } from "@ownloop/contracts";

import { MAX_OUTPUT_EXCERPT_LINES, MAX_OUTPUT_EXCERPT_UTF8_BYTES } from "./constants.js";
import { VERIFICATION_MAX_OUTPUT_EXCERPT_CODE_POINTS } from "@ownloop/contracts";

const encoder = new TextEncoder();

function stripAnsiAndControls(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index);
          if (current >= 0x40 && current <= 0x7e) break;
          index += 1;
        }
        continue;
      }
      if (next === 0x5d) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index);
          if (current === 0x07) break;
          if (current === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
      if (index + 1 < value.length) index += 1;
      continue;
    }
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
      continue;
    }
    output += value[index];
  }
  return output;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let output = "";
  for (const point of value) {
    const pointBytes = encoder.encode(point).byteLength;
    if (bytes + pointBytes > maximumBytes) break;
    output += point;
    bytes += pointBytes;
  }
  return output;
}

export function reduceVerificationOutput(
  field: VerificationOutputField,
  acceptedValue: string,
): VerificationReducedOutputV1 {
  const acceptedBytes = encoder.encode(acceptedValue);
  const normalized = stripAnsiAndControls(acceptedValue.replace(/\r\n?/gu, "\n"));
  const allLines = normalized.split("\n");
  const lineBounded = allLines.slice(0, MAX_OUTPUT_EXCERPT_LINES).join("\n");
  const codePointBounded = Array.from(lineBounded)
    .slice(0, VERIFICATION_MAX_OUTPUT_EXCERPT_CODE_POINTS)
    .join("");
  const excerpt = truncateUtf8(codePointBounded, MAX_OUTPUT_EXCERPT_UTF8_BYTES);
  return {
    field,
    acceptedByteCount: acceptedBytes.byteLength,
    acceptedSha256: createHash("sha256").update(acceptedBytes).digest("hex"),
    excerpt,
    excerptByteCount: encoder.encode(excerpt).byteLength,
    lineCount: allLines.length,
    truncated: excerpt !== normalized,
  };
}
