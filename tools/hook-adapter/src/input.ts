import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import {
  type SupportedClaudeHookPayload,
  SupportedClaudeHookPayloadSchema,
} from "@ownloop/contracts";

import { HOOK_ADAPTER_MAX_STDIN_BYTES } from "./constants.js";

export type HookInputSource = AsyncIterable<unknown>;

function chunkToBuffer(chunk: unknown): Buffer | null {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

export async function readSupportedHookPayload(
  source: HookInputSource,
  maximumBytes = HOOK_ADAPTER_MAX_STDIN_BYTES,
): Promise<SupportedClaudeHookPayload | null> {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) {
    return null;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of source) {
      const buffer = chunkToBuffer(chunk);
      if (buffer === null) {
        return null;
      }
      totalBytes += buffer.byteLength;
      if (totalBytes > maximumBytes) {
        return null;
      }
      chunks.push(buffer);
    }
    if (totalBytes === 0) {
      return null;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const validated = SupportedClaudeHookPayloadSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  } finally {
    chunks.length = 0;
  }
}
