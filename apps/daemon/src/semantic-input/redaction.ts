import {
  SEMANTIC_ANALYSIS_EXCERPT_MAX_BYTES,
  SEMANTIC_ANALYSIS_EXCERPT_MAX_CODE_POINTS,
  SEMANTIC_ANALYSIS_GOAL_MAX_BYTES,
  SEMANTIC_ANALYSIS_GOAL_MAX_CODE_POINTS,
  type SemanticAnalysisRedactedTextV1,
  type SemanticAnalysisRedactionCountV1,
  type SemanticAnalysisRedactionKind,
  SEMANTIC_ANALYSIS_REDACTION_KINDS,
} from "@ownloop/contracts";

const encoder = new TextEncoder();
const TRUNCATION_MARKER = "[TRUNCATED]";

const PLACEHOLDERS: Readonly<Record<SemanticAnalysisRedactionKind, string>> = Object.freeze({
  private_key: "[REDACTED_PRIVATE_KEY]",
  bearer_credential: "[REDACTED_BEARER]",
  provider_token: "[REDACTED_TOKEN]",
  secret_assignment: "[REDACTED_SECRET]",
  absolute_path: "[REDACTED_PATH]",
  url: "[REDACTED_URL]",
  email: "[REDACTED_EMAIL]",
  ip_address: "[REDACTED_IP]",
  markup: "[REDACTED_MARKUP]",
  control_character: "",
});

const PRIVATE_KEY_PATTERN =
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const PROVIDER_TOKEN_PATTERN =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/gu;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret|private[_-]?key|credential)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu;
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9-]{0,62}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,62}[A-Z0-9])?)+\b/giu;
const KNOWN_SCHEME_URL_PATTERN =
  /(?:^|[^A-Za-z0-9+.-])(?:https?|ftp|file|mailto|javascript|vbscript|data)\s*:\s*[^\s<>"']+/giu;
const COMMON_BARE_DOMAIN_PATTERN =
  /(?:^|[^A-Za-z0-9._-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.)+(?:com|org|net|io|dev|app|ai|co|me|info|biz|edu|gov|cloud|tech|site|online|shop|store|xyz|fr|de|uk|ir)(?=$|[^A-Za-z0-9_-])/giu;
const NAVIGABLE_DOMAIN_PATTERN =
  /(?:^|[^A-Za-z0-9._-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})(?::\d{1,5}|[/?#])[^\s<>"']*(?=$|[^A-Za-z0-9_-])/giu;
const WWW_DOMAIN_PATTERN =
  /(?:^|[^A-Za-z0-9._-])www\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})(?::\d{1,5})?(?:[/?#][^\s<>"']*)?(?=$|[^A-Za-z0-9_-])/giu;
const PROTOCOL_RELATIVE_URL_PATTERN =
  /(?:^|[^A-Za-z0-9_])\/\/(?:localhost(?::\d{1,5})?|(?:[A-Za-z0-9-]+\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59}))(?:[/?#]|$)/giu;
const LOCALHOST_URL_PATTERN =
  /(?:^|[^A-Za-z0-9_])localhost(?::\d{1,5}(?:[/?#][^\s<>"']*)?|[/?#][^\s<>"']*)(?=$|[^A-Za-z0-9_-])/giu;
const URL_PUNCTUATION_WHITESPACE_PATTERN = /\s*([.:/?#@])\s*/gu;
const OBFUSCATED_SCHEME_PATTERN =
  /(?:^|[^a-z0-9+.-])(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a|h\s*t\s*t\s*p\s*s?|f\s*t\s*p|f\s*i\s*l\s*e|m\s*a\s*i\s*l\s*t\s*o)\s*:/iu;
const IPV4_PATTERN = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/gu;
const IPV6_PATTERN = /\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b/gu;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/](?:[^\s<>:"|?*]+[\\/])*[^\s<>:"|?*]*/gu;
const UNC_PATH_PATTERN = /\\\\[^\s\\/<>:"|?*]+[\\/][^\s<>:"|?*]+/gu;
const POSIX_PATH_PATTERN =
  /(?<![A-Za-z0-9._-])\/(?:[^\s/<>"']+\/)*[^\s/<>"']+(?=$|[\s)"',.;:!?])/gu;
const MARKUP_PATTERN = /<[^>]*>|[<>]/gu;

export class SemanticInputRedactionError extends Error {
  readonly code: "invalid_unicode";

  constructor() {
    super("Semantic input contains invalid Unicode.");
    this.name = "SemanticInputRedactionError";
    this.code = "invalid_unicode";
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function increment(
  counts: Map<SemanticAnalysisRedactionKind, number>,
  kind: SemanticAnalysisRedactionKind,
): void {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
}

function replacePattern(
  value: string,
  pattern: RegExp,
  kind: SemanticAnalysisRedactionKind,
  counts: Map<SemanticAnalysisRedactionKind, number>,
): string {
  return value.replace(pattern, () => {
    increment(counts, kind);
    return PLACEHOLDERS[kind];
  });
}

function removeDisallowedControls(
  value: string,
  counts: Map<SemanticAnalysisRedactionKind, number>,
): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      increment(counts, "control_character");
      continue;
    }
    output += character;
  }
  return output;
}

function orderedCounts(
  counts: ReadonlyMap<SemanticAnalysisRedactionKind, number>,
): SemanticAnalysisRedactionCountV1[] {
  return SEMANTIC_ANALYSIS_REDACTION_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [{ kind, count }];
  });
}

function truncateText(
  value: string,
  maxCodePoints: number,
  maxBytes: number,
): Readonly<{ text: string; truncated: boolean }> {
  const characters = [...value];
  if (characters.length <= maxCodePoints && byteLength(value) <= maxBytes) {
    return { text: value, truncated: false };
  }

  const markerCharacters = [...TRUNCATION_MARKER];
  const markerBytes = byteLength(TRUNCATION_MARKER);
  const codePointBudget = Math.max(0, maxCodePoints - markerCharacters.length);
  const byteBudget = Math.max(0, maxBytes - markerBytes);
  const retained: string[] = [];
  let retainedBytes = 0;
  for (const character of characters) {
    const characterBytes = byteLength(character);
    if (retained.length >= codePointBudget || retainedBytes + characterBytes > byteBudget) break;
    retained.push(character);
    retainedBytes += characterBytes;
  }
  return { text: `${retained.join("")}${TRUNCATION_MARKER}`, truncated: true };
}

function containsUrlLike(value: string): boolean {
  const compacted = value.replace(URL_PUNCTUATION_WHITESPACE_PATTERN, "$1");
  const patterns = [
    OBFUSCATED_SCHEME_PATTERN,
    COMMON_BARE_DOMAIN_PATTERN,
    NAVIGABLE_DOMAIN_PATTERN,
    WWW_DOMAIN_PATTERN,
    PROTOCOL_RELATIVE_URL_PATTERN,
    LOCALHOST_URL_PATTERN,
  ];
  return [value, compacted].some((candidate) =>
    patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(candidate);
    }),
  );
}

function redactObfuscatedUrlLines(
  value: string,
  counts: Map<SemanticAnalysisRedactionKind, number>,
): string {
  return value
    .split("\n")
    .map((line) => {
      if (!containsUrlLike(line)) return line;
      increment(counts, "url");
      return PLACEHOLDERS.url;
    })
    .join("\n");
}

function redact(
  source: string,
  maxCodePoints: number,
  maxBytes: number,
): SemanticAnalysisRedactedTextV1 {
  if (hasLoneSurrogate(source)) throw new SemanticInputRedactionError();

  const sourceCodePointCount = [...source].length;
  const sourceByteCount = byteLength(source);
  const counts = new Map<SemanticAnalysisRedactionKind, number>();
  let value = source.replace(/\r\n?/gu, "\n");
  value = removeDisallowedControls(value, counts);
  value = replacePattern(value, PRIVATE_KEY_PATTERN, "private_key", counts);
  value = replacePattern(value, BEARER_PATTERN, "bearer_credential", counts);
  value = replacePattern(value, PROVIDER_TOKEN_PATTERN, "provider_token", counts);
  value = replacePattern(value, SECRET_ASSIGNMENT_PATTERN, "secret_assignment", counts);
  value = replacePattern(value, EMAIL_PATTERN, "email", counts);
  value = replacePattern(value, KNOWN_SCHEME_URL_PATTERN, "url", counts);
  value = replacePattern(value, WWW_DOMAIN_PATTERN, "url", counts);
  value = replacePattern(value, PROTOCOL_RELATIVE_URL_PATTERN, "url", counts);
  value = replacePattern(value, LOCALHOST_URL_PATTERN, "url", counts);
  value = replacePattern(value, NAVIGABLE_DOMAIN_PATTERN, "url", counts);
  value = replacePattern(value, COMMON_BARE_DOMAIN_PATTERN, "url", counts);
  value = redactObfuscatedUrlLines(value, counts);
  value = replacePattern(value, IPV4_PATTERN, "ip_address", counts);
  value = replacePattern(value, IPV6_PATTERN, "ip_address", counts);
  value = replacePattern(value, WINDOWS_PATH_PATTERN, "absolute_path", counts);
  value = replacePattern(value, UNC_PATH_PATTERN, "absolute_path", counts);
  value = replacePattern(value, POSIX_PATH_PATTERN, "absolute_path", counts);
  value = replacePattern(value, MARKUP_PATTERN, "markup", counts);
  value = value.normalize("NFC");
  if (value.trim().length === 0) value = "[REDACTED]";

  const truncated = truncateText(value, maxCodePoints, maxBytes);
  return {
    text: truncated.text,
    sourceCodePointCount,
    sourceByteCount,
    retainedCodePointCount: [...truncated.text].length,
    retainedByteCount: byteLength(truncated.text),
    truncated: truncated.truncated,
    redactions: orderedCounts(counts),
  };
}

export function redactSemanticGoal(source: string): SemanticAnalysisRedactedTextV1 {
  return redact(source, SEMANTIC_ANALYSIS_GOAL_MAX_CODE_POINTS, SEMANTIC_ANALYSIS_GOAL_MAX_BYTES);
}

export function redactSemanticVerificationExcerpt(source: string): SemanticAnalysisRedactedTextV1 {
  return redact(
    source,
    SEMANTIC_ANALYSIS_EXCERPT_MAX_CODE_POINTS,
    SEMANTIC_ANALYSIS_EXCERPT_MAX_BYTES,
  );
}
