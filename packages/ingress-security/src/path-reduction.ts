import path from "node:path";

import { REDACTION_RULES } from "./constants.js";
import { ingressSecurityError } from "./errors.js";
import type { RedactionState } from "./redaction-state.js";

export type PathFlavor = "posix" | "windows";

export type CanonicalPath = Readonly<{
  flavor: PathFlavor;
  value: string;
}>;

export type PathReductionContext = Readonly<{
  workspace: CanonicalPath;
  transcript: CanonicalPath | null;
  home: CanonicalPath | null;
}>;

const STRUCTURED_PATH_FIELD_NAMES = new Set([
  "canonicalpath",
  "cwd",
  "dir",
  "directory",
  "file",
  "filepath",
  "filename",
  "path",
  "repositoryroot",
  "transcriptpath",
  "worktree",
  "workingdirectory",
]);

const PATH_START_BOUNDARIES = new Set([
  " ",
  "\t",
  "\r",
  "\n",
  '"',
  "'",
  "`",
  "(",
  "[",
  "{",
  "=",
  ",",
  ";",
  ":",
]);
const UNQUOTED_PATH_END = /[\s"'`<>|]/;
const TRAILING_PATH_PUNCTUATION = /[),;\]}]+$/;
const MAX_EMBEDDED_PATH_CHARACTERS = 8192;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[_.\-\s]/g, "");
}

function isStructuredPathField(fieldName: string): boolean {
  const normalized = normalizeFieldName(fieldName);
  return (
    STRUCTURED_PATH_FIELD_NAMES.has(normalized) ||
    normalized.endsWith("path") ||
    /(?:^|[_.\-\s])(?:file|filename|dir|directory)$/i.test(fieldName) ||
    /(?:File|Filename|Dir|Directory)$/.test(fieldName)
  );
}

function detectFlavor(value: string): PathFlavor | null {
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || /^\/\/[^/]/.test(value)) {
    return "windows";
  }
  return value.startsWith("/") ? "posix" : null;
}

function moduleFor(flavor: PathFlavor): typeof path.posix | typeof path.win32 {
  return flavor === "windows" ? path.win32 : path.posix;
}

function stripNonRootTrailingSeparator(value: string, flavor: PathFlavor): string {
  const pathModule = moduleFor(flavor);
  const root = pathModule.parse(value).root;
  if (value === root) {
    return value;
  }
  return value.replace(flavor === "windows" ? /[\\/]+$/ : /\/+$/, "");
}

export function canonicalizeAbsolutePath(value: string): CanonicalPath {
  if (value.trim().length === 0 || containsControlCharacter(value)) {
    throw ingressSecurityError("invalid_workspace_path");
  }

  const flavor = detectFlavor(value);
  if (flavor === null) {
    throw ingressSecurityError("invalid_workspace_path");
  }
  const pathModule = moduleFor(flavor);
  if (!pathModule.isAbsolute(value)) {
    throw ingressSecurityError("invalid_workspace_path");
  }

  const normalized = stripNonRootTrailingSeparator(pathModule.normalize(value), flavor);
  if (!pathModule.isAbsolute(normalized)) {
    throw ingressSecurityError("invalid_workspace_path");
  }
  return Object.freeze({ flavor, value: normalized });
}

function comparisonValue(value: string, flavor: PathFlavor): string {
  return flavor === "windows" ? value.toLowerCase() : value;
}

function isSameOrChild(candidate: CanonicalPath, parent: CanonicalPath): boolean {
  if (candidate.flavor !== parent.flavor) {
    return false;
  }
  const pathModule = moduleFor(candidate.flavor);
  const relative = pathModule.relative(parent.value, candidate.value);
  return relative === "" || (!relative.startsWith("..") && !pathModule.isAbsolute(relative));
}

function relativePosix(candidate: CanonicalPath, parent: CanonicalPath): string {
  return moduleFor(candidate.flavor).relative(parent.value, candidate.value).replace(/\\/g, "/");
}

function samePath(left: CanonicalPath, right: CanonicalPath): boolean {
  return (
    left.flavor === right.flavor &&
    comparisonValue(left.value, left.flavor) === comparisonValue(right.value, right.flavor)
  );
}

function basename(candidate: CanonicalPath): string {
  return moduleFor(candidate.flavor).basename(candidate.value).replace(/[\\/]/g, "_") || "root";
}

function markPathReplacement(state: RedactionState, rule: keyof typeof REDACTION_RULES): void {
  state.pathReplacementCount += 1;
  state.rulesApplied.add(REDACTION_RULES[rule]);
}

export function reduceStructuredPath(
  value: string,
  context: PathReductionContext,
  state: RedactionState,
): string {
  const flavor = detectFlavor(value);
  if (flavor === null) {
    return value.replace(/\\/g, "/");
  }

  let candidate: CanonicalPath;
  try {
    candidate = canonicalizeAbsolutePath(value);
  } catch {
    markPathReplacement(state, "absolutePath");
    return "$ABSOLUTE/invalid";
  }

  if (context.transcript !== null && samePath(candidate, context.transcript)) {
    markPathReplacement(state, "transcriptPath");
    return "$CLAUDE_TRANSCRIPT";
  }

  if (isSameOrChild(candidate, context.workspace)) {
    markPathReplacement(state, "workspacePath");
    const relative = relativePosix(candidate, context.workspace);
    return relative.length === 0 ? "$WORKSPACE" : `$WORKSPACE/${relative}`;
  }

  if (context.home !== null && isSameOrChild(candidate, context.home)) {
    markPathReplacement(state, "homePath");
    const relative = relativePosix(candidate, context.home);
    return relative.length === 0 ? "$HOME" : `$HOME/${relative}`;
  }

  markPathReplacement(state, "absolutePath");
  return `$ABSOLUTE/${basename(candidate)}`;
}

function isPathStartBoundary(value: string, index: number): boolean {
  return index === 0 || PATH_START_BOUNDARIES.has(value[index - 1] ?? "");
}

function isWindowsDriveStart(value: string, index: number): boolean {
  const drive = value[index] ?? "";
  return (
    /[A-Za-z]/.test(drive) &&
    value[index + 1] === ":" &&
    (value[index + 2] === "\\" || value[index + 2] === "/")
  );
}

function isUncStart(value: string, index: number): boolean {
  return value[index] === "\\" && value[index + 1] === "\\";
}

function isPosixStart(value: string, index: number): boolean {
  return value[index] === "/" && value[index + 1] !== "/";
}

function scanPathEnd(value: string, start: number): number {
  const previous = value[start - 1];
  const quote = previous === '"' || previous === "'" || previous === "`" ? previous : null;
  const maximum = Math.min(value.length, start + MAX_EMBEDDED_PATH_CHARACTERS);
  let cursor = start;

  while (cursor < maximum) {
    const character = value[cursor] ?? "";
    if (quote !== null ? character === quote : UNQUOTED_PATH_END.test(character)) {
      break;
    }
    cursor += 1;
  }

  if (cursor === maximum && cursor < value.length && !UNQUOTED_PATH_END.test(value[cursor] ?? "")) {
    while (cursor < value.length && !UNQUOTED_PATH_END.test(value[cursor] ?? "")) {
      cursor += 1;
    }
  }
  return cursor;
}

function splitTrailingPunctuation(candidate: string): { pathValue: string; suffix: string } {
  const match = candidate.match(TRAILING_PATH_PUNCTUATION);
  if (match === null) {
    return { pathValue: candidate, suffix: "" };
  }
  return {
    pathValue: candidate.slice(0, -match[0].length),
    suffix: match[0],
  };
}

function reduceEmbeddedAbsolutePaths(
  value: string,
  context: PathReductionContext,
  state: RedactionState,
): string {
  let cursor = 0;
  let output = "";

  while (cursor < value.length) {
    const candidateStart =
      isPathStartBoundary(value, cursor) &&
      (isWindowsDriveStart(value, cursor) ||
        isUncStart(value, cursor) ||
        isPosixStart(value, cursor));

    if (!candidateStart) {
      output += value[cursor] ?? "";
      cursor += 1;
      continue;
    }

    const end = scanPathEnd(value, cursor);
    const candidate = value.slice(cursor, end);
    const { pathValue, suffix } = splitTrailingPunctuation(candidate);
    if (pathValue.length === 0) {
      output += candidate;
      cursor = end;
      continue;
    }

    output += `${reduceStructuredPath(pathValue, context, state)}${suffix}`;
    cursor = end;
  }

  return output;
}

export function reducePathsInString(
  value: string,
  fieldName: string | null,
  context: PathReductionContext,
  state: RedactionState,
): string {
  if (fieldName !== null && isStructuredPathField(fieldName)) {
    return reduceStructuredPath(value, context, state).replace(/\\/g, "/");
  }

  return reduceEmbeddedAbsolutePaths(value, context, state);
}

export function createPathReductionContext(
  workspacePath: string,
  transcriptPath: string,
  homePath?: string,
): PathReductionContext {
  const workspace = canonicalizeAbsolutePath(workspacePath);

  const transcript = (() => {
    try {
      return canonicalizeAbsolutePath(transcriptPath);
    } catch {
      return null;
    }
  })();

  const home = (() => {
    if (homePath === undefined) {
      return null;
    }
    try {
      return canonicalizeAbsolutePath(homePath);
    } catch {
      return null;
    }
  })();

  return Object.freeze({ workspace, transcript, home });
}
