import {
  CHANGE_CLASSIFICATION_LABELS,
  CHANGE_CLASSIFICATION_MAX_ENTRIES,
  type ChangeClassificationAggregateLabelV1,
  type ChangeClassificationAssignedLabelV1,
  type ChangeClassificationEntryV1,
  type ChangeClassificationLabel,
} from "@ownloop/contracts";

import { PersistenceError, type GitReconciliationEntry } from "../persistence/index.js";
import { CHANGE_CLASSIFICATION_RULES, type ParsedClassificationPath } from "./rules.js";

const MAX_RELATIVE_PATH_LENGTH = 1024;
function hasAsciiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;

function parsePath(
  value: string | null,
  sensitivity: "normal" | "secret",
): ParsedClassificationPath | null {
  if (sensitivity === "secret") {
    if (value !== null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A secret reconciliation entry exposed its relative path.",
      );
    }
    return null;
  }
  if (value === null) {
    return null;
  }
  if (
    value.length === 0 ||
    value.length > MAX_RELATIVE_PATH_LENGTH ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    hasAsciiControl(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    WINDOWS_DRIVE_PATTERN.test(value) ||
    value.includes("\\") ||
    value.endsWith("/") ||
    value.includes("//")
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A reconciliation entry contains a non-canonical relative path.",
    );
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A reconciliation entry contains an unsafe relative path segment.",
    );
  }
  const lower = value.toLowerCase();
  const lowerSegments = lower.split("/");
  const basename = lowerSegments.at(-1);
  if (basename === undefined) {
    throw new PersistenceError("invalid_persisted_row", "A reconciliation entry has no basename.");
  }
  const lastDot = basename.lastIndexOf(".");
  const extension =
    lastDot > 0 && lastDot < basename.length - 1 ? basename.slice(lastDot + 1) : null;
  return { value, lower, segments: lowerSegments, basename, extension };
}

function labelOrder(label: ChangeClassificationLabel): number {
  return CHANGE_CLASSIFICATION_LABELS.indexOf(label);
}

function classifyPath(
  path: ParsedClassificationPath | null,
): ChangeClassificationAssignedLabelV1[] {
  if (path === null) {
    return [
      {
        label: "unknown",
        confidenceBasisPoints: 0,
        evidence: [{ ruleId: "fallback.no_supported_rule", kind: "fallback" }],
      },
    ];
  }
  const byLabel = new Map<
    Exclude<ChangeClassificationLabel, "unknown">,
    {
      confidenceBasisPoints: number;
      evidence: Array<{
        ruleId: string;
        kind: "exact_filename" | "extension" | "path_segment" | "path_pattern";
      }>;
    }
  >();
  for (const rule of CHANGE_CLASSIFICATION_RULES) {
    if (!rule.matches(path)) {
      continue;
    }
    const existing = byLabel.get(rule.label);
    if (existing === undefined) {
      byLabel.set(rule.label, {
        confidenceBasisPoints: rule.confidenceBasisPoints,
        evidence: [{ ruleId: rule.ruleId, kind: rule.evidenceKind }],
      });
    } else {
      existing.confidenceBasisPoints = Math.max(
        existing.confidenceBasisPoints,
        rule.confidenceBasisPoints,
      );
      existing.evidence.push({ ruleId: rule.ruleId, kind: rule.evidenceKind });
    }
  }
  if (byLabel.size === 0) {
    return [
      {
        label: "unknown",
        confidenceBasisPoints: 0,
        evidence: [{ ruleId: "fallback.no_supported_rule", kind: "fallback" }],
      },
    ];
  }
  return [...byLabel.entries()]
    .toSorted(([left], [right]) => labelOrder(left) - labelOrder(right))
    .map(([label, value]) => ({
      label,
      confidenceBasisPoints: value.confidenceBasisPoints,
      evidence: value.evidence.toSorted((left, right) =>
        left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0,
      ),
    }));
}

export function classifyReconciliationEntries(
  entries: readonly GitReconciliationEntry[],
): ChangeClassificationEntryV1[] {
  if (entries.length > CHANGE_CLASSIFICATION_MAX_ENTRIES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The reconciliation exceeds the deterministic classification entry limit.",
    );
  }
  return entries.map((entry, index) => {
    if (entry.entryIndex !== index) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The reconciliation entry order is not contiguous for classification.",
      );
    }
    return {
      entryIndex: entry.entryIndex,
      fileEventId: entry.fileEventId,
      changeKind: entry.changeKind,
      attribution: entry.attribution,
      sensitivity: entry.sensitivity,
      labels: classifyPath(parsePath(entry.relativePath, entry.sensitivity)),
    };
  });
}

export function aggregateClassificationLabels(
  entries: readonly ChangeClassificationEntryV1[],
): ChangeClassificationAggregateLabelV1[] {
  const aggregates = new Map<ChangeClassificationLabel, { count: number; maximum: number }>();
  for (const entry of entries) {
    for (const label of entry.labels) {
      const existing = aggregates.get(label.label);
      if (existing === undefined) {
        aggregates.set(label.label, {
          count: 1,
          maximum: label.confidenceBasisPoints,
        });
      } else {
        existing.count += 1;
        existing.maximum = Math.max(existing.maximum, label.confidenceBasisPoints);
      }
    }
  }
  return [...aggregates.entries()]
    .toSorted(([left], [right]) => labelOrder(left) - labelOrder(right))
    .map(([label, aggregate]) => ({
      label,
      entryCount: aggregate.count,
      maximumConfidenceBasisPoints: aggregate.maximum,
    }));
}
