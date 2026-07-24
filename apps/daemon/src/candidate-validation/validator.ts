import { createHash } from "node:crypto";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_MAX_FACTS,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  type CandidateMomentBatchV1,
  type CandidateMomentV1,
  type CandidateValidationFactV1,
  type CandidateValidationItemV1,
  type CandidateValidationReason,
  type CandidateValidationReportV1,
  type CandidateValidationScoreV1,
  type DeterministicEvidenceGraphV1,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import { prepareCandidateValidationReport } from "./artifact.js";

const MAX_CLOSURE_DEPTH = 3;
const MAX_EXPANDED = 64;
const ZERO_FINGERPRINT = `sha256:${"0".repeat(64)}`;

const EXPANSION_EDGES = new Set([
  "changed_file_classified_by",
  "classification_assigned_label",
  "command_has_verification",
  "test_file_change_supported_by_classification",
]);

const IMPORTANCE_SIGNAL = Object.freeze({ low: 0, medium: 20, high: 40, critical: 60 });
const TYPE_ORDER = Object.freeze({ risk: 0, decision: 1, change: 2, check: 3 });
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "candidate",
  "did",
  "does",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);
const CONTROLLED_WORDS = new Set([
  "abandoned",
  "acknowledge",
  "added",
  "agent",
  "all",
  "api",
  "application",
  "attribution",
  "authentication",
  "authorization",
  "behavior",
  "build",
  "change",
  "changed",
  "choice",
  "classification",
  "complete",
  "completed",
  "configuration",
  "confirm",
  "created",
  "database",
  "decision",
  "deleted",
  "dependency",
  "dismiss",
  "documentation",
  "evidence",
  "failed",
  "file",
  "files",
  "gap",
  "graph",
  "infrastructure",
  "label",
  "lint",
  "migration",
  "modified",
  "observed",
  "observation",
  "only",
  "partial",
  "passed",
  "plan",
  "public",
  "question",
  "recorded",
  "relative",
  "removed",
  "revise",
  "risk",
  "run",
  "source",
  "status",
  "summary",
  "succeeded",
  "test",
  "tests",
  "type",
  "typecheck",
  "ui",
  "uncertain",
  "unknown",
  "unavailable",
  "unmerged",
  "updated",
]);
const ABSENCE_PATTERNS = [
  /\bno\b/u,
  /\bnone\b/u,
  /\bnothing\b/u,
  /\bnever\b/u,
  /\bwithout\b/u,
  /\bnot\s+(?:tested|observed|changed|failed|run)\b/u,
  /\ball\s+(?:paths|tests|changes|risks|cases)\b/u,
  /\b(?:fully|completely)\s+(?:safe|secure|correct|covered|tested)\b/u,
  /\bguarantee(?:d|s)?\b/u,
  /\b(?:safe|secure|correct)\b/u,
];

export type CandidateValidationBuilderInput = Readonly<{
  runId: string;
  finalizationId: string;
  generationId: string;
  sourceCandidateArtifactId: string;
  sourceCandidateFingerprint: string;
  candidateBatch: CandidateMomentBatchV1;
  evidenceGraphArtifactId: string;
  evidenceGraph: DeterministicEvidenceGraphV1;
}>;

type Assertion = Readonly<{
  key: string;
  family: string;
}>;

type CandidateDraft = Readonly<{
  sourceIndex: number;
  candidate: CandidateMomentV1;
  fingerprint: string;
  citedEvidenceIds: readonly string[];
  expandedEvidenceIds: readonly string[];
  facts: readonly CandidateValidationFactV1[];
  attentionCost: number;
  rejectionReasons: readonly CandidateValidationReason[];
  score: CandidateValidationScoreV1 | null;
  supportSignature: string | null;
}>;

function hash48(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function fingerprint(value: unknown): string {
  const canonical = canonicalizeJson(value, DEFAULT_CANONICAL_INPUT_LIMITS);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function candidateText(candidate: CandidateMomentV1): string {
  const values = [candidate.title, candidate.claim];
  switch (candidate.suggestedInteraction.kind) {
    case "decision_response":
    case "risk_response":
      values.push(candidate.suggestedInteraction.prompt);
      break;
    case "check_answer":
      values.push(
        candidate.suggestedInteraction.question,
        ...candidate.suggestedInteraction.choices.map((choice) => choice.label),
      );
      break;
  }
  return values.join(". ");
}

function containsUnsupportedAbsence(text: string): boolean {
  const normalized = normalizeText(text);
  return ABSENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function meaningfulUnknownTokens(text: string): readonly string[] {
  const tokens = normalizeText(text).split(" ").filter(Boolean);
  return [
    ...new Set(tokens.filter((token) => !STOP_WORDS.has(token) && !CONTROLLED_WORDS.has(token))),
  ];
}

function factKey(fact: CandidateValidationFactV1): string {
  switch (fact.kind) {
    case "verification_status":
      return `${fact.kind}:${fact.verificationKind}:${fact.observedStatus}`;
    case "evidence_gap":
      return `${fact.kind}:${fact.gapCode}`;
    case "decision_observed":
      return `${fact.kind}:${fact.eventType}`;
    default:
      return `${fact.kind}:${String(fact.value)}`;
  }
}

function factSortKey(fact: CandidateValidationFactV1): string {
  return `${factKey(fact)}:${fact.evidenceIds.join(",")}`;
}

function factsForNodes(
  graph: DeterministicEvidenceGraphV1,
  evidenceIds: readonly string[],
): readonly CandidateValidationFactV1[] {
  const byId = new Map(graph.nodes.map((node) => [node.evidenceId, node]));
  const grouped = new Map<string, CandidateValidationFactV1>();
  const add = (fact: CandidateValidationFactV1): void => {
    const key = factKey(fact);
    const previous = grouped.get(key);
    if (previous === undefined) {
      grouped.set(key, fact);
      return;
    }
    grouped.set(key, {
      ...previous,
      evidenceIds: [...new Set([...previous.evidenceIds, ...fact.evidenceIds])].toSorted(),
    } as CandidateValidationFactV1);
  };
  for (const evidenceId of evidenceIds) {
    const node = byId.get(evidenceId);
    if (node === undefined) continue;
    if (node.metadata.terminalStatus !== undefined) {
      add({
        kind: "terminal_status",
        value: node.metadata.terminalStatus,
        evidenceIds: [evidenceId],
      });
    }
    if (node.metadata.changeKind !== undefined) {
      add({ kind: "change_kind", value: node.metadata.changeKind, evidenceIds: [evidenceId] });
    }
    if (node.metadata.attribution !== undefined) {
      add({ kind: "attribution", value: node.metadata.attribution, evidenceIds: [evidenceId] });
    }
    if (node.metadata.label !== undefined) {
      add({ kind: "classification_label", value: node.metadata.label, evidenceIds: [evidenceId] });
    }
    if (
      node.metadata.verificationKind !== undefined &&
      node.metadata.observedStatus !== undefined
    ) {
      add({
        kind: "verification_status",
        verificationKind: node.metadata.verificationKind,
        observedStatus: node.metadata.observedStatus,
        evidenceIds: [evidenceId],
      });
    }
    if (node.metadata.gapCode !== undefined) {
      add({ kind: "evidence_gap", gapCode: node.metadata.gapCode, evidenceIds: [evidenceId] });
    }
    if (
      node.kind === "event" &&
      (node.metadata.eventType === "agent.plan_observed" ||
        node.metadata.eventType === "agent.summary_observed")
    ) {
      add({
        kind: "decision_observed",
        eventType: node.metadata.eventType,
        evidenceIds: [evidenceId],
      });
    }
  }
  if (graph.outcome === "partial") {
    add({ kind: "source_partial", value: true, evidenceIds: [] });
  }
  return [...grouped.values()].toSorted((left, right) =>
    compareText(factSortKey(left), factSortKey(right)),
  );
}

function assertions(text: string): readonly Assertion[] {
  const normalized = normalizeText(text);
  const values = new Map<string, Assertion>();
  const add = (key: string, family: string): void => {
    values.set(key, { key, family });
  };
  if (/\b(?:created|added)\b/u.test(normalized)) add("change_kind:created", "change_kind");
  if (
    /\b(?:modified|updated)\b/u.test(normalized) ||
    (/\bchanged\b/u.test(normalized) && !/\btype\s+changed\b/u.test(normalized))
  ) {
    add("change_kind:modified", "change_kind");
  }
  if (/\b(?:deleted|removed)\b/u.test(normalized)) add("change_kind:deleted", "change_kind");
  if (/\btype\s+changed\b/u.test(normalized)) add("change_kind:type_changed", "change_kind");
  if (/\bunmerged\b/u.test(normalized)) add("change_kind:unmerged", "change_kind");
  for (const status of ["completed", "partial", "abandoned", "failed"] as const) {
    const statusPattern = new RegExp(
      `(?:\\b(?:run|finalization)(?:\\s+status)?\\s+${status}\\b|\\b${status}\\s+(?:run|finalization)\\b)`,
      "u",
    );
    if (statusPattern.test(normalized)) {
      add(`terminal_status:${status[0]?.toUpperCase()}${status.slice(1)}`, "terminal_status");
    }
  }
  if (/\brun\s+relative\b/u.test(normalized)) add("attribution:run_relative", "attribution");
  if (/\bobserved\s+only\b/u.test(normalized)) add("attribution:observed_only", "attribution");
  if (/\battribution\s+unavailable\b/u.test(normalized))
    add("attribution:unavailable", "attribution");
  const labels = [
    "ui",
    "behavior",
    "tests",
    "dependency",
    "authentication_authorization",
    "public_api",
    "database_migration",
    "configuration_infrastructure",
    "documentation",
    "unknown",
  ] as const;
  for (const label of labels) {
    const phrase = label.replaceAll("_", " ");
    if (new RegExp(`\\b${phrase.replace(" ", "\\s+")}\\b`, "u").test(normalized)) {
      add(`classification_label:${label}`, "classification_label");
    }
  }
  const kinds = ["test", "lint", "typecheck", "build"] as const;
  for (const kind of kinds) {
    const kindPattern =
      kind === "typecheck" ? /\btype\s*check\b/u : new RegExp(`\\b${kind}s?\\b`, "u");
    if (!kindPattern.test(normalized)) continue;
    if (/\b(?:passed|succeeded)\b/u.test(normalized)) {
      add(`verification_status:${kind}:passed`, `verification_status:${kind}`);
    }
    if (/\bfailed\b/u.test(normalized)) {
      add(`verification_status:${kind}:failed`, `verification_status:${kind}`);
    }
    if (/\bunknown\b/u.test(normalized)) {
      add(`verification_status:${kind}:unknown`, `verification_status:${kind}`);
    }
    if (/\bobserved\s+without\s+exit\s+code\b/u.test(normalized)) {
      add(`verification_status:${kind}:observed_without_exit_code`, `verification_status:${kind}`);
    }
  }
  if (/\bevidence\s+gap\b/u.test(normalized)) add("evidence_gap:*", "evidence_gap");
  if (/\b(?:decision|plan|summary)\s+(?:observed|recorded)\b/u.test(normalized)) {
    add("decision_observed:*", "decision_observed");
  }
  if (/\b(?:source|graph)\s+partial\b/u.test(normalized))
    add("source_partial:true", "source_partial");
  return [...values.values()].toSorted((left, right) => compareText(left.key, right.key));
}

function connectedAndExpanded(
  graph: DeterministicEvidenceGraphV1,
  citedEvidenceIds: readonly string[],
): Readonly<{ connected: boolean; expanded: readonly string[] }> {
  const allAdjacency = new Map<string, Set<string>>();
  const expansionAdjacency = new Map<string, Set<string>>();
  const connect = (map: Map<string, Set<string>>, left: string, right: string): void => {
    (map.get(left) ?? map.set(left, new Set()).get(left))?.add(right);
    (map.get(right) ?? map.set(right, new Set()).get(right))?.add(left);
  };
  for (const edge of graph.edges) {
    connect(allAdjacency, edge.sourceEvidenceId, edge.targetEvidenceId);
    if (EXPANSION_EDGES.has(edge.type)) {
      connect(expansionAdjacency, edge.sourceEvidenceId, edge.targetEvidenceId);
    }
  }
  const reachable = new Set<string>();
  const queue = citedEvidenceIds.length === 0 ? [] : [citedEvidenceIds[0] as string];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of allAdjacency.get(current) ?? []) queue.push(next);
  }
  const connected = citedEvidenceIds.every((id) => reachable.has(id));
  const citedSet = new Set(citedEvidenceIds);
  const expanded = new Set<string>();
  const frontier = citedEvidenceIds.map((id) => ({ id, depth: 0 }));
  const visited = new Set(citedEvidenceIds);
  while (frontier.length > 0 && expanded.size < MAX_EXPANDED) {
    const current = frontier.shift();
    if (current === undefined || current.depth >= MAX_CLOSURE_DEPTH) continue;
    for (const next of [...(expansionAdjacency.get(current.id) ?? [])].toSorted()) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (!citedSet.has(next)) expanded.add(next);
      frontier.push({ id: next, depth: current.depth + 1 });
      if (expanded.size >= MAX_EXPANDED) break;
    }
  }
  return { connected, expanded: [...expanded].toSorted() };
}

function supportsType(
  candidate: CandidateMomentV1,
  graph: DeterministicEvidenceGraphV1,
  supportIds: readonly string[],
): boolean {
  const nodes = new Map(graph.nodes.map((node) => [node.evidenceId, node]));
  const selected = supportIds.flatMap((id) => {
    const node = nodes.get(id);
    return node === undefined ? [] : [node];
  });
  const hasRunEdgeTo = (evidenceId: string): boolean =>
    graph.edges.some(
      (edge) =>
        edge.type === "run_contains" &&
        edge.targetEvidenceId === evidenceId &&
        nodes.get(edge.sourceEvidenceId)?.kind === "run",
    );
  const change = selected.some((node) => node.kind === "changed_file");
  const decision = selected.some(
    (node) =>
      node.kind === "event" &&
      hasRunEdgeTo(node.evidenceId) &&
      (node.metadata.eventType === "agent.plan_observed" ||
        node.metadata.eventType === "agent.summary_observed"),
  );
  const risk = selected.some(
    (node) =>
      node.kind === "evidence_gap" ||
      (node.kind === "verification_observation" &&
        node.metadata.observedStatus !== undefined &&
        node.metadata.observedStatus !== "passed") ||
      ((node.kind === "run" || node.kind === "finalization") &&
        node.metadata.terminalStatus !== undefined &&
        node.metadata.terminalStatus !== "Completed"),
  );
  if (candidate.type === "change") return change;
  if (candidate.type === "decision") return decision;
  if (candidate.type === "risk") return risk;
  return change || decision || risk;
}

function typeHasAppropriateAssertion(
  type: CandidateMomentV1["type"],
  values: readonly Assertion[],
): boolean {
  if (type === "change") {
    return values.some(
      (item) => item.family === "change_kind" || item.family === "classification_label",
    );
  }
  if (type === "decision") return values.some((item) => item.family === "decision_observed");
  if (type === "risk") {
    return values.some(
      (item) =>
        item.family === "evidence_gap" ||
        item.family.startsWith("verification_status:") ||
        item.family === "terminal_status" ||
        item.family === "source_partial",
    );
  }
  return values.length > 0;
}

function factMatches(assertion: Assertion, facts: readonly CandidateValidationFactV1[]): boolean {
  if (assertion.key.endsWith(":*")) {
    return facts.some((fact) => factKey(fact).startsWith(assertion.key.slice(0, -1)));
  }
  return facts.some((fact) => factKey(fact) === assertion.key);
}

function hasConflict(
  assertionsValue: readonly Assertion[],
  facts: readonly CandidateValidationFactV1[],
): boolean {
  const assertionFamilies = new Map<string, Set<string>>();
  for (const assertion of assertionsValue) {
    const values = assertionFamilies.get(assertion.family) ?? new Set<string>();
    values.add(assertion.key);
    assertionFamilies.set(assertion.family, values);
  }
  if ([...assertionFamilies.values()].some((values) => values.size > 1)) return true;

  for (const family of assertionFamilies.keys()) {
    const familyFacts = new Set(facts.map(factKey).filter((key) => key.startsWith(`${family}:`)));
    if (familyFacts.size > 1) return true;
  }
  return false;
}

function attentionCost(candidate: CandidateMomentV1): number {
  let cost = [...candidate.title].length + [...candidate.claim].length;
  switch (candidate.suggestedInteraction.kind) {
    case "decision_response":
    case "risk_response":
      cost += [...candidate.suggestedInteraction.prompt].length;
      break;
    case "check_answer":
      cost += [...candidate.suggestedInteraction.question].length;
      cost += candidate.suggestedInteraction.choices.reduce(
        (total, choice) => total + [...choice.label].length + 20,
        0,
      );
      break;
  }
  return Math.min(100_000, cost);
}

function score(
  candidate: CandidateMomentV1,
  facts: readonly CandidateValidationFactV1[],
  cost: number,
  graphPartial: boolean,
): CandidateValidationScoreV1 {
  let evidenceStrength = 0;
  let urgency = 0;
  for (const fact of facts) {
    switch (fact.kind) {
      case "evidence_gap":
        evidenceStrength += 400;
        urgency += 300;
        break;
      case "verification_status":
        evidenceStrength += fact.observedStatus === "passed" ? 120 : 300;
        if (fact.observedStatus !== "passed") urgency += 250;
        break;
      case "terminal_status":
        evidenceStrength += 160;
        if (fact.value !== "Completed") urgency += 250;
        break;
      case "decision_observed":
        evidenceStrength += 260;
        break;
      case "change_kind":
        evidenceStrength += 220;
        break;
      case "classification_label":
        evidenceStrength += 80;
        break;
      case "attribution":
        evidenceStrength += 40;
        break;
      case "source_partial":
        break;
    }
  }
  evidenceStrength = Math.min(100_000, evidenceStrength);
  urgency = Math.min(100_000, urgency);
  const completenessAdjustment = graphPartial ? -50 : 0;
  const providerImportanceSignal = IMPORTANCE_SIGNAL[candidate.importance];
  const providerConfidenceSignal = Math.min(20, Math.floor(candidate.confidenceBasisPoints / 500));
  const attentionPenalty = Math.min(100, Math.ceil(cost / 20));
  const total =
    evidenceStrength +
    urgency +
    completenessAdjustment +
    providerImportanceSignal +
    providerConfidenceSignal -
    attentionPenalty;
  return {
    evidenceStrength,
    urgency,
    completenessAdjustment,
    providerImportanceSignal,
    providerConfidenceSignal,
    attentionPenalty,
    total,
  };
}

function sortedReasons(
  reasons: Iterable<CandidateValidationReason>,
): readonly CandidateValidationReason[] {
  const order = [
    "missing_evidence",
    "foreign_evidence",
    "disconnected_evidence",
    "unsupported_evidence_kind",
    "type_evidence_mismatch",
    "unsupported_claim_language",
    "deterministic_contradiction",
    "unsupported_absence_claim",
    "conflicting_evidence",
    "duplicate_candidate",
    "ranked_below_limit",
    "source_graph_partial",
    "evidence_limit_exceeded",
  ] as const;
  return [...new Set(reasons)].toSorted(
    (left, right) => order.indexOf(left) - order.indexOf(right),
  );
}

function draftCandidate(
  input: CandidateValidationBuilderInput,
  candidate: CandidateMomentV1,
  sourceIndex: number,
): CandidateDraft {
  const candidateFingerprint = fingerprint(candidate);
  const citedEvidenceIds = [...candidate.evidenceIds].toSorted();
  const nodeIds = new Set(input.evidenceGraph.nodes.map((node) => node.evidenceId));
  const reasons = new Set<CandidateValidationReason>();
  if (citedEvidenceIds.some((id) => !nodeIds.has(id))) reasons.add("missing_evidence");
  const closure = connectedAndExpanded(input.evidenceGraph, citedEvidenceIds);
  if (!closure.connected) reasons.add("disconnected_evidence");
  const supportIds = [...new Set([...citedEvidenceIds, ...closure.expanded])].toSorted();
  const allFacts = factsForNodes(input.evidenceGraph, supportIds);
  if (allFacts.length > CANDIDATE_VALIDATION_MAX_FACTS) {
    reasons.add("evidence_limit_exceeded");
  }
  const facts = allFacts.slice(0, CANDIDATE_VALIDATION_MAX_FACTS);
  if (!supportsType(candidate, input.evidenceGraph, supportIds))
    reasons.add("type_evidence_mismatch");
  const text = candidateText(candidate);
  if (containsUnsupportedAbsence(text)) reasons.add("unsupported_absence_claim");
  const extracted = assertions(text);
  if (
    extracted.length === 0 ||
    !typeHasAppropriateAssertion(candidate.type, extracted) ||
    meaningfulUnknownTokens(text).length > 0
  ) {
    reasons.add("unsupported_claim_language");
  }
  if (extracted.some((item) => !factMatches(item, allFacts))) {
    reasons.add("deterministic_contradiction");
  }
  if (hasConflict(extracted, allFacts)) reasons.add("conflicting_evidence");
  const cost = attentionCost(candidate);
  const rejectionReasons = sortedReasons(reasons);
  const candidateScore =
    rejectionReasons.length === 0
      ? score(candidate, allFacts, cost, input.evidenceGraph.outcome === "partial")
      : null;
  const supportSignature =
    candidateScore === null
      ? null
      : fingerprint({
          type: candidate.type,
          citedEvidenceIds,
          expandedEvidenceIds: closure.expanded,
          facts: allFacts.map(factKey),
        });
  return {
    sourceIndex,
    candidate,
    fingerprint: candidateFingerprint,
    citedEvidenceIds,
    expandedEvidenceIds: closure.expanded,
    facts,
    attentionCost: cost,
    rejectionReasons,
    score: candidateScore,
    supportSignature,
  };
}

function representative(left: CandidateDraft, right: CandidateDraft): CandidateDraft {
  const leftScore = left.score;
  const rightScore = right.score;
  if (leftScore === null) return right;
  if (rightScore === null) return left;
  const comparisons = [
    leftScore.evidenceStrength - rightScore.evidenceStrength,
    right.attentionCost - left.attentionCost,
    leftScore.providerImportanceSignal - rightScore.providerImportanceSignal,
    leftScore.providerConfidenceSignal - rightScore.providerConfidenceSignal,
    right.sourceIndex - left.sourceIndex,
  ];
  const comparison = comparisons.find((value) => value !== 0) ?? 0;
  return comparison >= 0 ? left : right;
}

export function validationIdentity(input: CandidateValidationBuilderInput): Readonly<{
  validationId: string;
  validationKey: string;
}> {
  const material = canonicalizeJson(
    {
      runId: input.runId,
      finalizationId: input.finalizationId,
      generationId: input.generationId,
      sourceCandidateArtifactId: input.sourceCandidateArtifactId,
      sourceCandidateFingerprint: input.sourceCandidateFingerprint,
      evidenceGraphArtifactId: input.evidenceGraphArtifactId,
      evidenceGraphInputFingerprint: input.evidenceGraph.inputFingerprint,
      evidenceGraphSchemaVersion: input.evidenceGraph.schemaVersion,
      evidenceGraphBuilderVersion: input.evidenceGraph.builderVersion,
      evidenceGraphTaxonomyVersion: input.evidenceGraph.taxonomyVersion,
      schemaVersion: CANDIDATE_VALIDATION_SCHEMA_VERSION,
      validatorVersion: CANDIDATE_VALIDATOR_VERSION,
      supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
      contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
      absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
      duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
      rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
      selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    },
    DEFAULT_CANONICAL_INPUT_LIMITS,
  );
  return {
    validationId: `val_${hash48(`id\0${material}`)}`,
    validationKey: `vkey_${hash48(`key\0${material}`)}`,
  };
}

export function buildCandidateValidationReport(
  input: CandidateValidationBuilderInput,
): ReturnType<typeof prepareCandidateValidationReport> {
  if (
    input.evidenceGraph.runId !== input.runId ||
    input.evidenceGraph.finalizationId !== input.finalizationId ||
    input.evidenceGraph.outcome === "unavailable"
  ) {
    throw new Error("Candidate validation source ownership is invalid.");
  }
  const identity = validationIdentity(input);
  const drafts = input.candidateBatch.candidates.map((candidate, index) =>
    draftCandidate(input, candidate, index),
  );
  const groups = new Map<string, CandidateDraft[]>();
  for (const draft of drafts) {
    if (draft.supportSignature === null) continue;
    const key = `${draft.candidate.type}:${draft.supportSignature}`;
    const group = groups.get(key) ?? [];
    group.push(draft);
    groups.set(key, group);
  }
  const duplicateOf = new Map<number, Readonly<{ groupId: string; representativeIndex: number }>>();
  for (const [signature, group] of groups) {
    const best = group.reduce(representative);
    const groupId = `dup_${hash48(signature)}`;
    for (const item of group) {
      if (item.sourceIndex !== best.sourceIndex) {
        duplicateOf.set(item.sourceIndex, {
          groupId,
          representativeIndex: best.sourceIndex,
        });
      }
    }
  }
  const eligible = drafts
    .filter((draft) => draft.rejectionReasons.length === 0 && !duplicateOf.has(draft.sourceIndex))
    .toSorted((left, right) => {
      const leftScore = left.score!;
      const rightScore = right.score!;
      return (
        rightScore.total - leftScore.total ||
        rightScore.evidenceStrength - leftScore.evidenceStrength ||
        left.attentionCost - right.attentionCost ||
        TYPE_ORDER[left.candidate.type] - TYPE_ORDER[right.candidate.type] ||
        left.sourceIndex - right.sourceIndex
      );
    });
  const selected = eligible.slice(0, 7);
  const selectedRank = new Map(selected.map((draft, index) => [draft.sourceIndex, index + 1]));
  const items: CandidateValidationItemV1[] = drafts.map((draft) => {
    const citedEvidenceIds = [...draft.citedEvidenceIds];
    const expandedEvidenceIds = [...draft.expandedEvidenceIds];
    const facts = draft.facts.map((fact) => ({
      ...fact,
      evidenceIds: [...fact.evidenceIds],
    }));
    if (draft.rejectionReasons.length > 0) {
      return {
        sourceIndex: draft.sourceIndex,
        candidateFingerprint: draft.fingerprint,
        citedEvidenceIds,
        expandedEvidenceIds,
        facts,
        decision: "rejected",
        reasons: [...draft.rejectionReasons],
        duplicateGroupId: null,
        representativeSourceIndex: null,
        attentionCost: draft.attentionCost,
        score: null,
        selectedRank: null,
      };
    }
    const duplicate = duplicateOf.get(draft.sourceIndex);
    if (duplicate !== undefined) {
      return {
        sourceIndex: draft.sourceIndex,
        candidateFingerprint: draft.fingerprint,
        citedEvidenceIds,
        expandedEvidenceIds,
        facts,
        decision: "valid_unselected",
        reasons: ["duplicate_candidate"],
        duplicateGroupId: duplicate.groupId,
        representativeSourceIndex: duplicate.representativeIndex,
        attentionCost: draft.attentionCost,
        score: draft.score,
        selectedRank: null,
      };
    }
    const rank = selectedRank.get(draft.sourceIndex);
    if (rank !== undefined) {
      return {
        sourceIndex: draft.sourceIndex,
        candidateFingerprint: draft.fingerprint,
        citedEvidenceIds,
        expandedEvidenceIds,
        facts,
        decision: "valid_selected",
        reasons: [],
        duplicateGroupId: null,
        representativeSourceIndex: null,
        attentionCost: draft.attentionCost,
        score: draft.score,
        selectedRank: rank,
      };
    }
    return {
      sourceIndex: draft.sourceIndex,
      candidateFingerprint: draft.fingerprint,
      citedEvidenceIds,
      expandedEvidenceIds,
      facts,
      decision: "valid_unselected",
      reasons: ["ranked_below_limit"],
      duplicateGroupId: null,
      representativeSourceIndex: null,
      attentionCost: draft.attentionCost,
      score: draft.score,
      selectedRank: null,
    };
  });
  const rejected = items.filter((item) => item.decision === "rejected").length;
  const selectedItems = items.filter((item) => item.decision === "valid_selected");
  const unselected = items.filter((item) => item.decision === "valid_unselected").length;
  const duplicate = items.filter((item) => item.reasons.includes("duplicate_candidate")).length;
  const partial = input.evidenceGraph.outcome === "partial";
  const report: Omit<CandidateValidationReportV1, "reportFingerprint"> = {
    schemaVersion: CANDIDATE_VALIDATION_SCHEMA_VERSION,
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    ...identity,
    runId: input.runId,
    finalizationId: input.finalizationId,
    generationId: input.generationId,
    sourceCandidateArtifactId: input.sourceCandidateArtifactId,
    sourceCandidateFingerprint: input.sourceCandidateFingerprint,
    evidenceGraphArtifactId: input.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: input.evidenceGraph.inputFingerprint,
    sourceVersions: {
      evidenceGraphSchemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
      evidenceGraphBuilderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
      evidenceGraphTaxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
      candidateMomentSchemaVersion: 1,
      candidateGenerationSchemaVersion: 1,
    },
    outcome: partial ? "partial" : "ready",
    diagnosticCode: partial ? "source_graph_partial" : "completed",
    limitations: partial ? ["source_graph_partial"] : [],
    items,
    counts: {
      source: items.length,
      rejected,
      valid: items.length - rejected,
      selected: selectedItems.length,
      duplicate,
      unselected,
    },
    selectedSourceIndexes: selectedItems
      .toSorted((left, right) => (left.selectedRank ?? 0) - (right.selectedRank ?? 0))
      .map((item) => item.sourceIndex),
  };
  return prepareCandidateValidationReport(report);
}

export { ZERO_FINGERPRINT };
