import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import {
  type SupportedCodexHookPayload,
  SupportedCodexHookPayloadSchema,
} from "@ownloop/contracts/codex";

import {
  CODEX_HOOK_ADAPTER_MAX_JSON_DEPTH,
  CODEX_HOOK_ADAPTER_MAX_STDIN_BYTES,
} from "./constants.js";

export type CodexHookInputSource = AsyncIterable<unknown>;

type ParsedString = Readonly<{ value: string; end: number }>;

function chunkToBuffer(chunk: unknown): Buffer | null {
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

function whitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

class DuplicateKeyRejectingScanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): boolean {
    this.#skipWhitespace();
    if (!this.#scanValue(0)) return false;
    this.#skipWhitespace();
    return this.#index === this.#text.length;
  }

  #skipWhitespace(): void {
    while (this.#index < this.#text.length && whitespace(this.#text.charCodeAt(this.#index))) {
      this.#index += 1;
    }
  }

  #scanValue(depth: number): boolean {
    if (depth > CODEX_HOOK_ADAPTER_MAX_JSON_DEPTH) return false;
    this.#skipWhitespace();
    const character = this.#text[this.#index];
    if (character === "{") return this.#scanObject(depth + 1);
    if (character === "[") return this.#scanArray(depth + 1);
    if (character === '"') {
      const parsed = this.#scanString();
      if (parsed === null) return false;
      this.#index = parsed.end;
      return true;
    }
    if (
      this.#consumeKeyword("true") ||
      this.#consumeKeyword("false") ||
      this.#consumeKeyword("null")
    ) {
      return true;
    }
    return this.#scanNumber();
  }

  #consumeKeyword(keyword: string): boolean {
    if (!this.#text.startsWith(keyword, this.#index)) return false;
    this.#index += keyword.length;
    return true;
  }

  #scanNumber(): boolean {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.#text.slice(this.#index),
    );
    if (match === null) return false;
    this.#index += match[0].length;
    return true;
  }

  #scanString(): ParsedString | null {
    const start = this.#index;
    if (this.#text[start] !== '"') return null;
    let cursor = start + 1;
    while (cursor < this.#text.length) {
      const code = this.#text.charCodeAt(cursor);
      if (code === 0x22) {
        const token = this.#text.slice(start, cursor + 1);
        try {
          const value: unknown = JSON.parse(token);
          return typeof value === "string" ? { value, end: cursor + 1 } : null;
        } catch {
          return null;
        }
      }
      if (code < 0x20) return null;
      if (code === 0x5c) {
        cursor += 1;
        const escaped = this.#text[cursor];
        if (escaped === undefined) return null;
        if (escaped === "u") {
          const unicode = this.#text.slice(cursor + 1, cursor + 5);
          if (!/^[0-9A-Fa-f]{4}$/u.test(unicode)) return null;
          cursor += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) {
          return null;
        }
      }
      cursor += 1;
    }
    return null;
  }

  #scanObject(depth: number): boolean {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return true;
    }
    const keys = new Set<string>();
    while (this.#index < this.#text.length) {
      const parsedKey = this.#scanString();
      if (parsedKey === null || keys.has(parsedKey.value)) return false;
      keys.add(parsedKey.value);
      this.#index = parsedKey.end;
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") return false;
      this.#index += 1;
      if (!this.#scanValue(depth)) return false;
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return true;
      }
      if (separator !== ",") return false;
      this.#index += 1;
      this.#skipWhitespace();
    }
    return false;
  }

  #scanArray(depth: number): boolean {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return true;
    }
    while (this.#index < this.#text.length) {
      if (!this.#scanValue(depth)) return false;
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "]") {
        this.#index += 1;
        return true;
      }
      if (separator !== ",") return false;
      this.#index += 1;
      this.#skipWhitespace();
    }
    return false;
  }
}

export async function readSupportedCodexHookPayload(
  source: CodexHookInputSource,
  maximumBytes = CODEX_HOOK_ADAPTER_MAX_STDIN_BYTES,
): Promise<SupportedCodexHookPayload | null> {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1) return null;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of source) {
      const buffer = chunkToBuffer(chunk);
      if (buffer === null) return null;
      totalBytes += buffer.byteLength;
      if (totalBytes > maximumBytes) return null;
      chunks.push(buffer);
    }
    if (totalBytes === 0) return null;

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
    } catch {
      return null;
    }
    if (!new DuplicateKeyRejectingScanner(text).scan()) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const validated = SupportedCodexHookPayloadSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  } finally {
    chunks.length = 0;
  }
}
