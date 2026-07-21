import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { isSensitiveUntrackedPath } from "../git-baseline/index.js";
import type {
  GitReconciliationChangeKind,
  GitReconciliationDiagnosticCode,
} from "../persistence/index.js";
import {
  DEFAULT_GIT_RECONCILIATION_ENTRY_LIMIT,
  GIT_RECONCILIATION_PATH_IDENTITY_VERSION,
} from "./constants.js";

export type ParsedGitStatusEntry = Readonly<{
  pathIdentitySha256: string;
  relativePath: string | null;
  changeKind: GitReconciliationChangeKind;
  staged: boolean;
  unstaged: boolean;
  sensitivity: "normal" | "secret";
}>;

export type GitStatusParseResult = Readonly<{
  entries: readonly ParsedGitStatusEntry[];
  diagnosticCode: Extract<
    GitReconciliationDiagnosticCode,
    "invalid_status_output" | "status_entry_limit_exceeded"
  > | null;
}>;

const ORDINARY_STATUS = new Set([".", "M", "T", "A", "D"]);
const UNMERGED_STATUS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const HEADER_PATTERN = /^# [A-Za-z0-9][A-Za-z0-9.-]*(?: [^\0\r\n]*)?$/u;
const MODE_PATTERN = /^[0-7]{6}$/u;
const OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SUBMODULE_PATTERN = /^(?:N\.\.\.|S[.C][.M][.U])$/u;

function pathIdentity(relativePath: string): string {
  return createHash("sha256")
    .update(`${GIT_RECONCILIATION_PATH_IDENTITY_VERSION}\0${relativePath}`)
    .digest("hex");
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function normalizeRepositoryRelativePath(value: string): string | null {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) ||
    containsControlCharacter(value)
  ) {
    return null;
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

function buildEntry(
  rawPath: string,
  changeKind: GitReconciliationChangeKind,
  staged: boolean,
  unstaged: boolean,
): ParsedGitStatusEntry | null {
  const normalizedPath = normalizeRepositoryRelativePath(rawPath);
  if (normalizedPath === null) {
    return null;
  }
  const sensitivity = isSensitiveUntrackedPath(normalizedPath) ? "secret" : "normal";
  return {
    pathIdentitySha256: pathIdentity(normalizedPath),
    relativePath: sensitivity === "secret" ? null : normalizedPath,
    changeKind,
    staged,
    unstaged,
    sensitivity,
  };
}

function ordinaryChangeKind(x: string, y: string): GitReconciliationChangeKind | null {
  if (x === "D" || y === "D") {
    return "deleted";
  }
  if (x === "A" || y === "A") {
    return "created";
  }
  if (x === "T" || y === "T") {
    return "type_changed";
  }
  if (x === "M" || y === "M") {
    return "modified";
  }
  return null;
}

function parseOrdinary(record: string): ParsedGitStatusEntry | null {
  const fields = record.split(" ");
  if (fields.length < 9 || fields[0] !== "1") {
    return null;
  }
  const [_, xy, submodule, modeHead, modeIndex, modeWorktree, objectHead, objectIndex] = fields;
  const rawPath = fields.slice(8).join(" ");
  if (
    xy === undefined ||
    xy.length !== 2 ||
    !ORDINARY_STATUS.has(xy[0] ?? "") ||
    !ORDINARY_STATUS.has(xy[1] ?? "") ||
    submodule === undefined ||
    !SUBMODULE_PATTERN.test(submodule) ||
    modeHead === undefined ||
    !MODE_PATTERN.test(modeHead) ||
    modeIndex === undefined ||
    !MODE_PATTERN.test(modeIndex) ||
    modeWorktree === undefined ||
    !MODE_PATTERN.test(modeWorktree) ||
    objectHead === undefined ||
    !OBJECT_PATTERN.test(objectHead) ||
    objectIndex === undefined ||
    !OBJECT_PATTERN.test(objectIndex)
  ) {
    return null;
  }
  const x = xy[0] ?? ".";
  const y = xy[1] ?? ".";
  const changeKind = ordinaryChangeKind(x, y);
  if (changeKind === null) {
    return null;
  }
  return buildEntry(rawPath, changeKind, x !== ".", y !== ".");
}

function parseUnmerged(record: string): ParsedGitStatusEntry | null {
  const fields = record.split(" ");
  if (fields.length < 11 || fields[0] !== "u") {
    return null;
  }
  const [
    _,
    xy,
    submodule,
    modeStage1,
    modeStage2,
    modeStage3,
    modeWorktree,
    objectStage1,
    objectStage2,
    objectStage3,
  ] = fields;
  const rawPath = fields.slice(10).join(" ");
  if (
    xy === undefined ||
    !UNMERGED_STATUS.has(xy) ||
    submodule === undefined ||
    !SUBMODULE_PATTERN.test(submodule) ||
    [modeStage1, modeStage2, modeStage3, modeWorktree].some(
      (mode) => mode === undefined || !MODE_PATTERN.test(mode),
    ) ||
    [objectStage1, objectStage2, objectStage3].some(
      (object) => object === undefined || !OBJECT_PATTERN.test(object),
    )
  ) {
    return null;
  }
  return buildEntry(rawPath, "unmerged", true, true);
}

function parseRecord(record: string): ParsedGitStatusEntry | "header" | null {
  if (record.startsWith("#")) {
    return HEADER_PATTERN.test(record) ? "header" : null;
  }
  if (record.startsWith("1 ")) {
    return parseOrdinary(record);
  }
  if (record.startsWith("u ")) {
    return parseUnmerged(record);
  }
  if (record.startsWith("? ")) {
    return buildEntry(record.slice(2), "created", false, true);
  }
  return null;
}

function compareEntries(left: ParsedGitStatusEntry, right: ParsedGitStatusEntry): number {
  return (
    left.pathIdentitySha256.localeCompare(right.pathIdentitySha256) ||
    left.changeKind.localeCompare(right.changeKind) ||
    Number(left.staged) - Number(right.staged) ||
    Number(left.unstaged) - Number(right.unstaged)
  );
}

export function parseGitPorcelainV2Status(
  rawStatus: Buffer,
  maximumEntries = DEFAULT_GIT_RECONCILIATION_ENTRY_LIMIT,
): GitStatusParseResult {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
    return { entries: [], diagnosticCode: "invalid_status_output" };
  }
  if (rawStatus.length === 0) {
    return { entries: [], diagnosticCode: null };
  }
  if (rawStatus.at(-1) !== 0) {
    return { entries: [], diagnosticCode: "invalid_status_output" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawStatus);
  } catch {
    return { entries: [], diagnosticCode: "invalid_status_output" };
  }

  const records = text.split("\0");
  records.pop();
  const entries: ParsedGitStatusEntry[] = [];
  const identities = new Set<string>();
  for (const record of records) {
    if (record.length === 0) {
      return { entries: [], diagnosticCode: "invalid_status_output" };
    }
    const parsed = parseRecord(record);
    if (parsed === null) {
      return { entries: [], diagnosticCode: "invalid_status_output" };
    }
    if (parsed === "header") {
      continue;
    }
    if (identities.has(parsed.pathIdentitySha256)) {
      return { entries: [], diagnosticCode: "invalid_status_output" };
    }
    identities.add(parsed.pathIdentitySha256);
    entries.push(parsed);
  }

  entries.sort(compareEntries);
  if (entries.length > maximumEntries) {
    return {
      entries: entries.slice(0, maximumEntries),
      diagnosticCode: "status_entry_limit_exceeded",
    };
  }
  return { entries, diagnosticCode: null };
}
