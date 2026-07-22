import type { ReplayTaskRunCursor } from "../persistence/index.js";

const MAX_CURSOR_LENGTH = 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const OFFSET_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function canonicalTimestamp(value: string): string | null {
  const match = OFFSET_DATETIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (offsetHour > 23 || offsetMinute > 59) {
    return null;
  }
  const local = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${String(millisecond).padStart(3, "0")}Z`,
  );
  if (
    !Number.isFinite(local.getTime()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function encodeReplayCursor(cursor: ReplayTaskRunCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      startedAt: cursor.startedAt,
      conversationId: cursor.conversationId,
      runNumber: cursor.runNumber,
      runId: cursor.runId,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeReplayCursor(value: string | undefined): ReplayTaskRunCursor | null | false {
  if (value === undefined || value.length === 0) {
    return null;
  }
  if (value.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) {
      return false;
    }
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    const startedAt =
      typeof record.startedAt === "string" ? canonicalTimestamp(record.startedAt) : null;
    if (
      Object.keys(record).sort().join(",") !== "conversationId,runId,runNumber,startedAt,v" ||
      record.v !== 1 ||
      startedAt === null ||
      typeof record.conversationId !== "string" ||
      !SAFE_ID_PATTERN.test(record.conversationId) ||
      typeof record.runNumber !== "number" ||
      !Number.isInteger(record.runNumber) ||
      record.runNumber < 1 ||
      typeof record.runId !== "string" ||
      !SAFE_ID_PATTERN.test(record.runId)
    ) {
      return false;
    }
    return {
      startedAt,
      conversationId: record.conversationId,
      runNumber: record.runNumber,
      runId: record.runId,
    };
  } catch {
    return false;
  }
}
