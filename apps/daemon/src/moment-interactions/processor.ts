import { createHash } from "node:crypto";

import {
  MOMENT_INTERACTION_ACTOR,
  MOMENT_INTERACTION_MAX_RECENT_ITEMS,
  MOMENT_INTERACTION_SCHEMA_VERSION,
  type MomentInteractionActionV1,
  type MomentInteractionReceiptV1,
  MomentInteractionReceiptV1Schema,
  type MomentInteractionRecordV1,
  type MomentInteractionRequestV1,
  MomentInteractionRequestV1Schema,
  type MomentInteractionStateResponseV1,
  MomentInteractionStateResponseV1Schema,
  type MomentInteractionStateV1,
  type OwnershipMomentProjectionItemV1,
  type OwnershipMomentsProjectionV1,
  type OwnershipRecordKind,
  type OwnershipRecordV1,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import {
  type OwnershipMomentsDependencies,
  projectValidationOwnershipMoments,
} from "../ownership-moments/index.js";
import { PersistenceError } from "../persistence/index.js";

export const MOMENT_INTERACTION_ERROR_CODES = [
  "run_not_found",
  "validation_not_found",
  "moment_not_found",
  "action_not_allowed",
  "interaction_conflict",
] as const;
export type MomentInteractionErrorCode = (typeof MOMENT_INTERACTION_ERROR_CODES)[number];

export class MomentInteractionError extends Error {
  readonly code: MomentInteractionErrorCode;

  constructor(code: MomentInteractionErrorCode) {
    super("The Moment interaction request could not be accepted.");
    this.name = "MomentInteractionError";
    this.code = code;
  }
}

export type MomentInteractionDependencies = OwnershipMomentsDependencies;

type ProcessorOptions = Readonly<{
  clock?: () => Date;
  projectionReader?: typeof projectValidationOwnershipMoments;
}>;

function safeTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError("operation_failed", "The Moment interaction clock is invalid.");
  }
  return value.toISOString();
}

function hash48(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function requestFingerprint(request: MomentInteractionRequestV1): string {
  const canonical = canonicalizeJson(request, DEFAULT_CANONICAL_INPUT_LIMITS);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function actionsEqual(left: MomentInteractionActionV1, right: MomentInteractionActionV1): boolean {
  return (
    canonicalizeJson(left, DEFAULT_CANONICAL_INPUT_LIMITS) ===
    canonicalizeJson(right, DEFAULT_CANONICAL_INPUT_LIMITS)
  );
}

function recordId(interactionId: string, recordKind: OwnershipRecordKind): string {
  return `or_${hash48(`ownership-record\0${interactionId}\0${recordKind}`)}`;
}

function ownershipFor(interaction: MomentInteractionRecordV1): OwnershipRecordV1 | null {
  let recordKind: OwnershipRecordKind;
  let valueCode: string;
  switch (interaction.action.kind) {
    case "moment_viewed":
    case "evidence_viewed":
      return null;
    case "acknowledgement_set":
      recordKind = "acknowledgement_recorded";
      valueCode = interaction.action.value ? "acknowledged" : "unacknowledged";
      break;
    case "decision_response_set":
    case "risk_response_set":
      recordKind = "response_recorded";
      valueCode = interaction.action.value;
      break;
    case "check_answer_set":
      recordKind = "answer_recorded";
      valueCode = interaction.action.choiceId;
      break;
    case "usefulness_set":
      recordKind = "feedback_recorded";
      valueCode = interaction.action.value;
      break;
  }
  return {
    schemaVersion: MOMENT_INTERACTION_SCHEMA_VERSION,
    recordId: recordId(interaction.interactionId, recordKind),
    interactionId: interaction.interactionId,
    actor: MOMENT_INTERACTION_ACTOR,
    runId: interaction.runId,
    validationId: interaction.validationId,
    momentId: interaction.momentId,
    sourceIndex: interaction.sourceIndex,
    sourceCandidateFingerprint: interaction.sourceCandidateFingerprint,
    momentType: interaction.momentType,
    recordKind,
    valueCode,
    assertionCode: "interaction_recorded",
    noComprehensionClaim: true,
    createdAt: interaction.createdAt,
  };
}

function assertActionAllowed(
  moment: OwnershipMomentProjectionItemV1,
  action: MomentInteractionActionV1,
): void {
  const interaction = moment.candidate.suggestedInteraction;
  switch (action.kind) {
    case "moment_viewed":
    case "usefulness_set":
      return;
    case "evidence_viewed":
      if (moment.evidenceIds.includes(action.evidenceId)) return;
      break;
    case "acknowledgement_set":
      if (moment.candidate.type === "change" && interaction.kind === "acknowledge") return;
      break;
    case "decision_response_set":
      if (
        moment.candidate.type === "decision" &&
        interaction.kind === "decision_response" &&
        interaction.options.includes(action.value)
      ) {
        return;
      }
      break;
    case "risk_response_set":
      if (
        moment.candidate.type === "risk" &&
        interaction.kind === "risk_response" &&
        interaction.options.includes(action.value)
      ) {
        return;
      }
      break;
    case "check_answer_set":
      if (
        moment.candidate.type === "check" &&
        interaction.kind === "check_answer" &&
        interaction.choices.some((choice) => choice.id === action.choiceId)
      ) {
        return;
      }
      break;
  }
  throw new MomentInteractionError("action_not_allowed");
}

async function verifiedProjection(
  dependencies: MomentInteractionDependencies,
  runId: string,
  validationId: string,
  options: ProcessorOptions,
): Promise<OwnershipMomentsProjectionV1> {
  if (dependencies.persistence.taskRuns.get(runId) === null) {
    throw new MomentInteractionError("run_not_found");
  }
  const reader = options.projectionReader ?? projectValidationOwnershipMoments;
  const projection = await reader(dependencies, runId, validationId);
  if (projection === null || projection.validationId !== validationId) {
    throw new MomentInteractionError("validation_not_found");
  }
  if (projection.outcome === "not_available") {
    throw new MomentInteractionError("validation_not_found");
  }
  return projection;
}

function findMoment(
  projection: OwnershipMomentsProjectionV1,
  momentId: string,
): OwnershipMomentProjectionItemV1 {
  const matches = projection.moments.filter((moment) => moment.displayId === momentId);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) {
    throw new MomentInteractionError("moment_not_found");
  }
  return match;
}

function zeroState(moment: OwnershipMomentProjectionItemV1): MomentInteractionStateV1 {
  return {
    momentId: moment.displayId,
    sourceIndex: moment.sourceIndex,
    sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
    momentType: moment.candidate.type,
    viewCount: 0,
    evidenceViewCount: 0,
    acknowledgement: null,
    decisionResponse: null,
    riskResponse: null,
    checkChoiceId: null,
    usefulness: "unset",
    latestInteractionAt: null,
    interactionCount: 0,
    ownershipRecordCount: 0,
  };
}

function stateResponse(
  dependencies: MomentInteractionDependencies,
  projection: OwnershipMomentsProjectionV1,
): MomentInteractionStateResponseV1 {
  const runId = projection.runId;
  const validationId = projection.validationId;
  if (validationId === null) throw new MomentInteractionError("validation_not_found");
  const persisted = dependencies.persistence.momentInteractions.listStates(runId, validationId);
  const persistedByMoment = new Map(persisted.map((state) => [state.momentId, state]));
  for (const state of persisted) {
    const moment = projection.moments.find((item) => item.displayId === state.momentId);
    if (
      moment === undefined ||
      moment.sourceIndex !== state.sourceIndex ||
      moment.sourceCandidateFingerprint !== state.sourceCandidateFingerprint ||
      moment.candidate.type !== state.momentType
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Moment interaction identity differs from the verified projection.",
      );
    }
    const evidenceIds = dependencies.persistence.momentInteractions.listDistinctEvidenceIds(
      runId,
      validationId,
      state.momentId,
    );
    if (
      evidenceIds.length > moment.evidenceIds.length ||
      evidenceIds.some((evidenceId) => !moment.evidenceIds.includes(evidenceId))
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Evidence interaction differs from the verified Moment.",
      );
    }
    const checkChoiceIds = dependencies.persistence.momentInteractions.listDistinctCheckChoiceIds(
      runId,
      validationId,
      state.momentId,
    );
    const allowedChoices =
      moment.candidate.suggestedInteraction.kind === "check_answer"
        ? moment.candidate.suggestedInteraction.choices.map((choice) => choice.id)
        : [];
    if (
      checkChoiceIds.length > allowedChoices.length ||
      checkChoiceIds.some((choiceId) => !allowedChoices.includes(choiceId))
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Check interaction differs from the verified Moment.",
      );
    }
  }
  const recentInteractions = dependencies.persistence.momentInteractions.listRecentInteractions(
    runId,
    validationId,
    MOMENT_INTERACTION_MAX_RECENT_ITEMS + 1,
  );
  const recentOwnershipRecords =
    dependencies.persistence.momentInteractions.listRecentOwnershipRecords(
      runId,
      validationId,
      MOMENT_INTERACTION_MAX_RECENT_ITEMS + 1,
    );
  return MomentInteractionStateResponseV1Schema.parse({
    ok: true,
    schemaVersion: MOMENT_INTERACTION_SCHEMA_VERSION,
    runId,
    validationId,
    states: projection.moments.map(
      (moment) => persistedByMoment.get(moment.displayId) ?? zeroState(moment),
    ),
    totalInteractionCount: dependencies.persistence.momentInteractions.countInteractions(
      runId,
      validationId,
    ),
    totalOwnershipRecordCount: dependencies.persistence.momentInteractions.countOwnershipRecords(
      runId,
      validationId,
    ),
    recentInteractions: recentInteractions.slice(-MOMENT_INTERACTION_MAX_RECENT_ITEMS),
    recentOwnershipRecords: recentOwnershipRecords.slice(-MOMENT_INTERACTION_MAX_RECENT_ITEMS),
    interactionHistoryTruncated: recentInteractions.length > MOMENT_INTERACTION_MAX_RECENT_ITEMS,
    ownershipRecordHistoryTruncated:
      recentOwnershipRecords.length > MOMENT_INTERACTION_MAX_RECENT_ITEMS,
  });
}

export async function readMomentInteractionState(
  dependencies: MomentInteractionDependencies,
  runId: string,
  validationId: string,
  options: ProcessorOptions = {},
): Promise<MomentInteractionStateResponseV1> {
  const projection = await verifiedProjection(dependencies, runId, validationId, options);
  return stateResponse(dependencies, projection);
}

export async function recordMomentInteraction(
  dependencies: MomentInteractionDependencies,
  runId: string,
  momentId: string,
  input: unknown,
  options: ProcessorOptions = {},
): Promise<MomentInteractionReceiptV1> {
  const request = MomentInteractionRequestV1Schema.parse(input);
  const projection = await verifiedProjection(dependencies, runId, request.validationId, options);
  const moment = findMoment(projection, momentId);
  assertActionAllowed(moment, request.action);
  const fingerprint = requestFingerprint(request);

  const stored = dependencies.persistence.withTransaction((repositories) => {
    const existing = repositories.momentInteractions.getInteraction(request.interactionId);
    if (existing !== null) {
      if (
        existing.requestFingerprint !== fingerprint ||
        existing.runId !== runId ||
        existing.validationId !== request.validationId ||
        existing.momentId !== momentId ||
        !actionsEqual(existing.action, request.action) ||
        existing.sourceIndex !== moment.sourceIndex ||
        existing.sourceCandidateFingerprint !== moment.sourceCandidateFingerprint ||
        existing.momentType !== moment.candidate.type
      ) {
        throw new MomentInteractionError("interaction_conflict");
      }
      return { interaction: existing, idempotentReplay: true } as const;
    }
    const proposed: MomentInteractionRecordV1 = {
      schemaVersion: MOMENT_INTERACTION_SCHEMA_VERSION,
      interactionId: request.interactionId,
      actor: MOMENT_INTERACTION_ACTOR,
      runId,
      validationId: request.validationId,
      momentId,
      sourceIndex: moment.sourceIndex,
      sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
      momentType: moment.candidate.type,
      action: request.action,
      requestFingerprint: fingerprint,
      createdAt: safeTimestamp(options.clock ?? (() => new Date())),
    };
    repositories.momentInteractions.insertInteraction(proposed);
    const ownership = ownershipFor(proposed);
    if (ownership !== null) repositories.momentInteractions.insertOwnershipRecord(ownership);
    return { interaction: proposed, idempotentReplay: false } as const;
  });

  const response = stateResponse(dependencies, projection);
  const state = response.states.find((item) => item.momentId === momentId);
  if (state === undefined) {
    throw new PersistenceError("invalid_persisted_row", "Moment state disappeared after insert.");
  }
  const ownership = dependencies.persistence.momentInteractions.getOwnershipRecordForInteraction(
    request.interactionId,
  );
  return MomentInteractionReceiptV1Schema.parse({
    ok: true,
    schemaVersion: MOMENT_INTERACTION_SCHEMA_VERSION,
    interactionId: stored.interaction.interactionId,
    runId,
    validationId: request.validationId,
    momentId,
    actionKind: stored.interaction.action.kind,
    createdAt: stored.interaction.createdAt,
    ownershipRecordId: ownership?.recordId ?? null,
    idempotentReplay: stored.idempotentReplay,
    state,
  });
}
