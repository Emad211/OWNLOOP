import {
  CODEX_HOOK_CONFIGURATION_MAX_BYTES,
  CODEX_HOOK_CONFIGURATION_MAX_DEPTH,
  CodexHookConfigurationError,
  validateCodexHookConfigurationDocument,
} from "./codex-hook-configuration.js";

type ParsedString = Readonly<{ value: string; end: number }>;
type ScanResult = "valid" | "invalid_json" | "duplicate_key";

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function whitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

class StrictJsonScanner {
  readonly #text: string;
  #index = 0;
  #failure: Exclude<ScanResult, "valid"> | null = null;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): ScanResult {
    this.#skipWhitespace();
    if (!this.#scanValue(0)) return this.#failure ?? "invalid_json";
    this.#skipWhitespace();
    return this.#index === this.#text.length ? "valid" : "invalid_json";
  }

  #fail(reason: Exclude<ScanResult, "valid"> = "invalid_json"): false {
    this.#failure ??= reason;
    return false;
  }

  #skipWhitespace(): void {
    while (this.#index < this.#text.length && whitespace(this.#text.charCodeAt(this.#index))) {
      this.#index += 1;
    }
  }

  #scanValue(depth: number): boolean {
    if (depth > CODEX_HOOK_CONFIGURATION_MAX_DEPTH) return this.#fail();
    this.#skipWhitespace();
    const character = this.#text[this.#index];
    if (character === "{") return this.#scanObject(depth + 1);
    if (character === "[") return this.#scanArray(depth + 1);
    if (character === '"') {
      const parsed = this.#scanString();
      if (parsed === null) return this.#fail();
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
    if (match === null) return this.#fail();
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
      if (parsedKey === null) return this.#fail();
      if (keys.has(parsedKey.value)) return this.#fail("duplicate_key");
      keys.add(parsedKey.value);
      this.#index = parsedKey.end;
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") return this.#fail();
      this.#index += 1;
      if (!this.#scanValue(depth)) return false;
      this.#skipWhitespace();
      const separator = this.#text[this.#index];
      if (separator === "}") {
        this.#index += 1;
        return true;
      }
      if (separator !== ",") return this.#fail();
      this.#index += 1;
      this.#skipWhitespace();
    }
    return this.#fail();
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
      if (separator !== ",") return this.#fail();
      this.#index += 1;
      this.#skipWhitespace();
    }
    return this.#fail();
  }
}

function sortedJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (typeof value !== "object") throw new CodexHookConfigurationError("invalid_document");
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [key, sortedJsonValue(record[key])]),
  );
}

export function parseCodexHookConfigurationJson(text: string): Record<string, unknown> {
  if (typeof text !== "string" || utf8ByteLength(text) > CODEX_HOOK_CONFIGURATION_MAX_BYTES) {
    throw new CodexHookConfigurationError("configuration_too_large");
  }
  const scan = new StrictJsonScanner(text).scan();
  if (scan !== "valid") throw new CodexHookConfigurationError(scan);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CodexHookConfigurationError("invalid_json");
  }
  return validateCodexHookConfigurationDocument(parsed);
}

export function serializeCodexHookConfigurationJson(input: unknown): string {
  const document = validateCodexHookConfigurationDocument(input);
  const serialized = `${JSON.stringify(sortedJsonValue(document), null, 2)}\n`;
  if (utf8ByteLength(serialized) > CODEX_HOOK_CONFIGURATION_MAX_BYTES) {
    throw new CodexHookConfigurationError("configuration_too_large");
  }
  return serialized;
}
