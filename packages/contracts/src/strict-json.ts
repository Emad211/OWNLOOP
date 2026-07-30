const MAX_JSON_DEPTH = 100;

export class StrictJsonError extends Error {
  readonly code: "invalid_json" | "duplicate_key" | "root_not_object" | "too_large";
  constructor(code: StrictJsonError["code"]) {
    super("The JSON document is not a supported strict object.");
    this.name = "StrictJsonError";
    this.code = code;
  }
}

class Parser {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  parse(): unknown {
    this.#space();
    const value = this.#value(0);
    this.#space();
    if (this.#index !== this.#text.length) this.#fail();
    return value;
  }

  #fail(): never {
    throw new StrictJsonError("invalid_json");
  }

  #space(): void {
    while (this.#index < this.#text.length) {
      const code = this.#text.charCodeAt(this.#index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      this.#index += 1;
    }
  }

  #value(depth: number): unknown {
    if (depth > MAX_JSON_DEPTH) this.#fail();
    this.#space();
    const current = this.#text[this.#index];
    if (current === "{") return this.#object(depth + 1);
    if (current === "[") return this.#array(depth + 1);
    if (current === '"') return this.#string();
    if (current === "t") return this.#literal("true", true);
    if (current === "f") return this.#literal("false", false);
    if (current === "n") return this.#literal("null", null);
    return this.#number();
  }

  #literal<T>(raw: string, value: T): T {
    if (this.#text.slice(this.#index, this.#index + raw.length) !== raw) this.#fail();
    this.#index += raw.length;
    return value;
  }

  #string(): string {
    const start = this.#index;
    this.#index += 1;
    let escaped = false;
    while (this.#index < this.#text.length) {
      const code = this.#text.charCodeAt(this.#index);
      if (!escaped && code === 0x22) {
        this.#index += 1;
        try {
          const value: unknown = JSON.parse(this.#text.slice(start, this.#index));
          if (typeof value !== "string") this.#fail();
          return value;
        } catch {
          this.#fail();
        }
      }
      if (!escaped && code < 0x20) this.#fail();
      if (!escaped && code === 0x5c) {
        escaped = true;
      } else {
        escaped = false;
      }
      this.#index += 1;
    }
    this.#fail();
  }

  #number(): number {
    const remainder = this.#text.slice(this.#index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remainder);
    if (match === null) this.#fail();
    this.#index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.#fail();
    return value;
  }

  #array(depth: number): unknown[] {
    this.#index += 1;
    const values: unknown[] = [];
    this.#space();
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return values;
    }
    while (true) {
      values.push(this.#value(depth));
      this.#space();
      const current = this.#text[this.#index];
      if (current === "]") {
        this.#index += 1;
        return values;
      }
      if (current !== ",") this.#fail();
      this.#index += 1;
    }
  }

  #object(depth: number): Record<string, unknown> {
    this.#index += 1;
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.#space();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return value;
    }
    while (true) {
      this.#space();
      if (this.#text[this.#index] !== '"') this.#fail();
      const key = this.#string();
      if (keys.has(key)) throw new StrictJsonError("duplicate_key");
      keys.add(key);
      this.#space();
      if (this.#text[this.#index] !== ":") this.#fail();
      this.#index += 1;
      value[key] = this.#value(depth);
      this.#space();
      const current = this.#text[this.#index];
      if (current === "}") {
        this.#index += 1;
        return value;
      }
      if (current !== ",") this.#fail();
      this.#index += 1;
    }
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function parseStrictJsonObject(
  text: string,
  maximumBytes = 1024 * 1024,
): Record<string, unknown> {
  if (utf8ByteLength(text) > maximumBytes) throw new StrictJsonError("too_large");
  const value = new Parser(text).parse();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrictJsonError("root_not_object");
  }
  return value as Record<string, unknown>;
}
