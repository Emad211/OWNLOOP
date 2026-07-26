import type {
  CandidateValidationFactV1,
  EnrichedBuildReplayV1,
  FinalDiffManifestV1,
  MomentInteractionActionV1,
  MomentInteractionReceiptV1,
  MomentInteractionStateResponseV1,
  MomentInteractionStateV1,
  OwnershipMomentProjectionItemV1,
  OwnershipMomentsProjectionV1,
  RawRunReplayV1,
  ReplayArtifactReferenceV1,
  ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { BuildReplaySection, type BuildReplayLoadState } from "./BuildReplay.js";
import { SettingsPanel } from "./Settings.js";
import { DiagnosticsPanel } from "./Diagnostics.js";
import {
  createMomentInteractionId,
  createReplayApiClient,
  type ReplayApiClient,
  ReplayApiError,
} from "./api.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

type LoadState = "disconnected" | "loading" | "ready" | "empty" | "error";
type MomentLoadState = "idle" | "loading" | "ready" | "error";
type InteractionLoadState = "idle" | "loading" | "ready" | "error";

type ViewerProps = Readonly<{
  state: LoadState;
  statusMessage: string;
  runs: readonly ReplayRunSummaryV1[];
  replay: RawRunReplayV1 | null;
  manifest: FinalDiffManifestV1 | null;
  moments: OwnershipMomentsProjectionV1 | null;
  momentState: MomentLoadState;
  momentStatusMessage: string;
  interactionState: MomentInteractionStateResponseV1 | null;
  interactionLoadState: InteractionLoadState;
  interactionStatusMessage: string;
  buildReplay: EnrichedBuildReplayV1 | null;
  buildReplayState: BuildReplayLoadState;
  buildReplayStatusMessage: string;
  selectedRunId: string | null;
  selectedRun: ReplayRunSummaryV1 | null;
  settingsClient: ReplayApiClient;
  nextCursor: string | null;
  onSelectRun(runId: string): void;
  onLoadMore(): void;
  onLoadArtifact(artifact: ReplayArtifactReferenceV1): void;
  onResolveEvidence(evidenceId: string): void;
  onResolveMomentEvidence(
    momentId: string,
    evidenceId: string,
    interactionId: string,
  ): Promise<void>;
  onRecordMomentInteraction(
    momentId: string,
    action: MomentInteractionActionV1,
    interactionId: string,
  ): Promise<MomentInteractionReceiptV1>;
  onSettingsUnauthorized(message: string): void;
  onRunsDeleted(runIds: readonly string[]): void;
  onDisconnect(): void;
}>;

function EvidenceAction(
  props: Readonly<{
    evidenceId: string | null | undefined;
    onResolveEvidence(evidenceId: string): void;
  }>,
) {
  if (props.evidenceId === null || props.evidenceId === undefined) {
    return null;
  }
  return (
    <button
      type="button"
      className="button evidence-action"
      onClick={() => props.onResolveEvidence(props.evidenceId ?? "")}
    >
      View evidence
    </button>
  );
}

function formatTime(value: string | null): string {
  return value === null ? "Not ended" : new Date(value).toLocaleString();
}

function statusClass(status: string): string {
  return `status status-${status.toLowerCase()}`;
}

function ConnectionPanel(
  props: Readonly<{
    connected: boolean;
    tokenInputRef: React.RefObject<HTMLInputElement | null>;
    onConnect(event: FormEvent<HTMLFormElement>): void;
    onDisconnect(): void;
    statusMessage: string;
  }>,
) {
  if (props.connected) {
    return (
      <section className="connection connected" aria-labelledby="connection-heading">
        <div>
          <p className="eyebrow">Local connection</p>
          <h2 id="connection-heading">Connected to this OwnLoop daemon</h2>
          <p>The installation token is held only in this page&apos;s memory.</p>
        </div>
        <button type="button" className="button secondary" onClick={props.onDisconnect}>
          Disconnect and forget token
        </button>
      </section>
    );
  }
  return (
    <section className="connection" aria-labelledby="connection-heading">
      <div>
        <p className="eyebrow">Local connection</p>
        <h2 id="connection-heading">Unlock the local replay viewer</h2>
        <p>
          Enter the installation token. It is sent only to this page&apos;s origin and is not saved.
        </p>
      </div>
      <form className="connection-form" onSubmit={props.onConnect}>
        <label htmlFor="installation-token">Installation token</label>
        <input
          ref={props.tokenInputRef}
          id="installation-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          minLength={43}
        />
        <button className="button primary" type="submit">
          Connect
        </button>
        {props.statusMessage.length > 0 ? (
          <p className="connection-status" role="status" aria-live="polite">
            {props.statusMessage}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function RunList(
  props: Readonly<{
    runs: readonly ReplayRunSummaryV1[];
    selectedRunId: string | null;
    onSelectRun(runId: string): void;
    nextCursor: string | null;
    onLoadMore(): void;
  }>,
) {
  return (
    <aside className="runs-panel" aria-labelledby="runs-heading">
      <div className="panel-heading">
        <p className="eyebrow">Observed work</p>
        <h2 id="runs-heading">Task Runs</h2>
      </div>
      <ol className="run-list">
        {props.runs.map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              className={run.runId === props.selectedRunId ? "run-card selected" : "run-card"}
              aria-current={run.runId === props.selectedRunId ? "true" : undefined}
              onClick={() => props.onSelectRun(run.runId)}
            >
              <span className={statusClass(run.status)}>{run.status}</span>
              <strong>Run {run.runNumber}</strong>
              <span className="prompt-preview">{run.promptPreview || "No prompt captured"}</span>
              <span className="run-meta">
                {formatTime(run.startedAt)} · {run.evidenceGapCount} evidence gap
                {run.evidenceGapCount === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {props.nextCursor !== null ? (
        <button type="button" className="button secondary load-more" onClick={props.onLoadMore}>
          Load more Runs
        </button>
      ) : null}
    </aside>
  );
}

function EvidenceBanner({ replay }: Readonly<{ replay: RawRunReplayV1 }>) {
  const gaps = replay.evidenceGaps.length;
  return (
    <section className={`evidence-banner completeness-${replay.run.completeness}`}>
      <div>
        <p className="eyebrow">Replay completeness</p>
        <h2>{replay.run.completeness.replace("_", " ")}</h2>
      </div>
      <p>
        {gaps === 0
          ? "No persisted evidence gap is attached to this Run."
          : `${gaps} persisted evidence gap${gaps === 1 ? "" : "s"} must be reviewed.`}
      </p>
    </section>
  );
}

function factKey(fact: CandidateValidationFactV1): string {
  const evidence = fact.evidenceIds.join(",");
  switch (fact.kind) {
    case "verification_status":
      return `${fact.kind}:${fact.verificationKind}:${fact.observedStatus}:${evidence}`;
    case "evidence_gap":
      return `${fact.kind}:${fact.gapCode}:${evidence}`;
    case "decision_observed":
      return `${fact.kind}:${fact.eventType}:${evidence}`;
    default:
      return `${fact.kind}:${String(fact.value)}:${evidence}`;
  }
}

export function interactionStateMatchesProjection(
  state: MomentInteractionStateResponseV1,
  projection: OwnershipMomentsProjectionV1,
): boolean {
  if (
    projection.validationId === null ||
    state.runId !== projection.runId ||
    state.validationId !== projection.validationId ||
    state.states.length !== projection.moments.length
  ) {
    return false;
  }
  const stateByMoment = new Map(state.states.map((item) => [item.momentId, item]));
  if (stateByMoment.size !== state.states.length) return false;
  return projection.moments.every((moment) => {
    const item = stateByMoment.get(moment.displayId);
    return (
      item !== undefined &&
      item.sourceIndex === moment.sourceIndex &&
      item.sourceCandidateFingerprint === moment.sourceCandidateFingerprint &&
      item.momentType === moment.candidate.type
    );
  });
}

function preferNewerInteractionState(
  current: MomentInteractionStateResponseV1 | null,
  next: MomentInteractionStateResponseV1,
): MomentInteractionStateResponseV1 {
  if (
    current === null ||
    current.runId !== next.runId ||
    current.validationId !== next.validationId ||
    next.totalInteractionCount >= current.totalInteractionCount
  ) {
    return next;
  }
  return current;
}

export function preferNewerBuildReplay(
  current: EnrichedBuildReplayV1 | null,
  next: EnrichedBuildReplayV1,
): EnrichedBuildReplayV1 {
  if (
    current === null ||
    current.runId !== next.runId ||
    current.source?.validationId !== next.source?.validationId ||
    next.reviewSummary.totalInteractions >= current.reviewSummary.totalInteractions
  ) {
    return next;
  }
  return current;
}

function factText(fact: CandidateValidationFactV1): string {
  switch (fact.kind) {
    case "verification_status":
      return `${fact.verificationKind} verification: ${fact.observedStatus}`;
    case "evidence_gap":
      return `Evidence gap: ${fact.gapCode}`;
    case "decision_observed":
      return `Decision observation: ${fact.eventType}`;
    case "source_partial":
      return "Source evidence is partial";
    default:
      return `${fact.kind.replaceAll("_", " ")}: ${fact.value.replaceAll("_", " ")}`;
  }
}

function MomentInteraction(
  props: Readonly<{
    moment: OwnershipMomentProjectionItemV1;
    state: MomentInteractionStateV1;
    enabled: boolean;
    onRecord(
      action: MomentInteractionActionV1,
      interactionId: string,
    ): Promise<MomentInteractionReceiptV1>;
  }>,
) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Recorded state loaded.");
  const [failed, setFailed] = useState<Readonly<{
    interactionId: string;
    action: MomentInteractionActionV1;
  }> | null>(null);
  const interaction = props.moment.candidate.suggestedInteraction;
  const name = `${props.moment.displayId}-interaction`;

  async function submit(
    action: MomentInteractionActionV1,
    interactionId = createMomentInteractionId(),
  ): Promise<void> {
    setPending(true);
    setStatus("Saving interaction…");
    try {
      await props.onRecord(action, interactionId);
      setFailed(null);
      setStatus("Interaction saved. Recorded actions do not prove comprehension or ownership.");
    } catch {
      setFailed({ interactionId, action });
      setStatus("Interaction was not saved. Retry uses the same interaction ID.");
    } finally {
      setPending(false);
    }
  }

  const disabled = !props.enabled || pending;
  return (
    <div className="moment-interaction">
      <p className="eyebrow">Durable local interaction</p>
      {interaction.kind === "acknowledge" ? (
        <button
          type="button"
          className="button secondary"
          aria-pressed={props.state.acknowledgement === true}
          disabled={disabled}
          onClick={() =>
            void submit({
              kind: "acknowledgement_set",
              value: props.state.acknowledgement !== true,
            })
          }
        >
          {props.state.acknowledgement === true ? "Set not acknowledged" : "Set acknowledged"}
        </button>
      ) : null}
      {interaction.kind === "decision_response" ? (
        <fieldset disabled={disabled}>
          <legend>{interaction.prompt}</legend>
          {interaction.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={props.state.decisionResponse === option}
                onChange={() => void submit({ kind: "decision_response_set", value: option })}
              />
              {option.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
      ) : null}
      {interaction.kind === "risk_response" ? (
        <fieldset disabled={disabled}>
          <legend>{interaction.prompt}</legend>
          {interaction.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={props.state.riskResponse === option}
                onChange={() => void submit({ kind: "risk_response_set", value: option })}
              />
              {option.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
      ) : null}
      {interaction.kind === "check_answer" ? (
        <fieldset disabled={disabled}>
          <legend>{interaction.question}</legend>
          {interaction.choices.map((choice) => (
            <label key={choice.id}>
              <input
                type="radio"
                name={name}
                value={choice.id}
                checked={props.state.checkChoiceId === choice.id}
                onChange={() => void submit({ kind: "check_answer_set", choiceId: choice.id })}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <fieldset disabled={disabled}>
        <legend>Was this Moment useful?</legend>
        {(["unset", "useful", "not_useful"] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name={`${props.moment.displayId}-usefulness`}
              value={value}
              checked={props.state.usefulness === value}
              onChange={() => void submit({ kind: "usefulness_set", value })}
            />
            {value === "unset" ? "No feedback" : value === "useful" ? "Useful" : "Not useful"}
          </label>
        ))}
      </fieldset>
      {failed !== null ? (
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => void submit(failed.action, failed.interactionId)}
        >
          Retry save
        </button>
      ) : null}
      <p className="moment-unsaved-note" role="status" aria-live="polite">
        {status}
      </p>
      <small>
        {props.state.interactionCount} recorded action
        {props.state.interactionCount === 1 ? "" : "s"}; {props.state.ownershipRecordCount} bounded
        record{props.state.ownershipRecordCount === 1 ? "" : "s"}. These records attest only that an
        explicit interaction was stored.
      </small>
    </div>
  );
}

function OwnershipMomentCard(
  props: Readonly<{
    moment: OwnershipMomentProjectionItemV1;
    interactionState: MomentInteractionStateV1;
    interactionReady: boolean;
    onResolveEvidence(evidenceId: string, interactionId: string): Promise<void>;
    onRecordInteraction(
      action: MomentInteractionActionV1,
      interactionId: string,
    ): Promise<MomentInteractionReceiptV1>;
  }>,
) {
  const { moment } = props;
  const viewAttempted = useRef(false);
  const recordInteractionRef = useRef(props.onRecordInteraction);
  recordInteractionRef.current = props.onRecordInteraction;
  const [viewFailure, setViewFailure] = useState<string | null>(null);
  const [evidenceFailure, setEvidenceFailure] = useState<Readonly<{
    evidenceId: string;
    interactionId: string;
  }> | null>(null);
  const [evidencePending, setEvidencePending] = useState(false);

  async function openEvidence(
    evidenceId: string,
    interactionId = createMomentInteractionId(),
  ): Promise<void> {
    setEvidencePending(true);
    try {
      await props.onResolveEvidence(evidenceId, interactionId);
      setEvidenceFailure(null);
    } catch {
      setEvidenceFailure({ evidenceId, interactionId });
    } finally {
      setEvidencePending(false);
    }
  }

  async function recordView(interactionId = createMomentInteractionId()): Promise<void> {
    try {
      await recordInteractionRef.current({ kind: "moment_viewed" }, interactionId);
      setViewFailure(null);
    } catch {
      setViewFailure(interactionId);
    }
  }

  useEffect(() => {
    if (!props.interactionReady || viewAttempted.current) return;
    viewAttempted.current = true;
    const interactionId = createMomentInteractionId();
    void recordInteractionRef
      .current({ kind: "moment_viewed" }, interactionId)
      .then(() => setViewFailure(null))
      .catch(() => setViewFailure(interactionId));
  }, [props.interactionReady]);

  return (
    <li className={`moment-card moment-${moment.candidate.type}`}>
      <header>
        <span className="moment-rank">#{moment.selectedRank}</span>
        <span className="moment-type">{moment.candidate.type}</span>
      </header>
      <section className="moment-proposal" aria-label="AI-proposed validated statement">
        <p className="eyebrow">AI-proposed, deterministically validated statement</p>
        <h3>{moment.candidate.title}</h3>
        <p>{moment.candidate.claim}</p>
      </section>
      <section className="moment-support" aria-label="Persisted supporting facts">
        <p className="eyebrow">Persisted supporting facts</p>
        {moment.facts.length === 0 ? (
          <p>No controlled fact summary is available.</p>
        ) : (
          <ul>
            {moment.facts.map((fact) => (
              <li key={factKey(fact)}>{factText(fact)}</li>
            ))}
          </ul>
        )}
        <div className="moment-evidence-actions">
          {moment.evidenceIds.map((evidenceId) => (
            <button
              key={evidenceId}
              type="button"
              className="button evidence-action"
              disabled={!props.interactionReady || evidencePending}
              onClick={() => void openEvidence(evidenceId)}
            >
              View evidence {evidenceId.slice(-6)}
            </button>
          ))}
        </div>
        {evidenceFailure !== null ? (
          <button
            type="button"
            className="button secondary"
            disabled={evidencePending}
            onClick={() =>
              void openEvidence(evidenceFailure.evidenceId, evidenceFailure.interactionId)
            }
          >
            Retry Evidence view
          </button>
        ) : null}
      </section>
      <section className="moment-signals" aria-label="Proposal ranking signals">
        <p className="eyebrow">Proposal signals — not proof</p>
        <dl>
          <div>
            <dt>Importance</dt>
            <dd>{moment.candidate.importance}</dd>
          </div>
          <div>
            <dt>Provider confidence signal</dt>
            <dd>{moment.candidate.confidenceBasisPoints} / 10000</dd>
          </div>
          <div>
            <dt>Deterministic validation score</dt>
            <dd>{moment.score.total}</dd>
          </div>
        </dl>
      </section>
      {viewFailure !== null ? (
        <button
          type="button"
          className="button secondary"
          onClick={() => void recordView(viewFailure)}
        >
          Retry recording Moment view
        </button>
      ) : null}
      <MomentInteraction
        moment={moment}
        state={props.interactionState}
        enabled={props.interactionReady}
        onRecord={props.onRecordInteraction}
      />
    </li>
  );
}

function OwnershipMomentsSection(
  props: Readonly<{
    state: MomentLoadState;
    statusMessage: string;
    projection: OwnershipMomentsProjectionV1 | null;
    interactionState: MomentInteractionStateResponseV1 | null;
    interactionLoadState: InteractionLoadState;
    interactionStatusMessage: string;
    onResolveEvidence(momentId: string, evidenceId: string, interactionId: string): Promise<void>;
    onRecordInteraction(
      momentId: string,
      action: MomentInteractionActionV1,
      interactionId: string,
    ): Promise<MomentInteractionReceiptV1>;
  }>,
) {
  const states = new Map(props.interactionState?.states.map((state) => [state.momentId, state]));
  return (
    <section id="ownership-moments" tabIndex={-1} className="content-section moments-section">
      <div className="section-heading">
        <p className="eyebrow">Finite validated proposals</p>
        <h2>Ownership Moments</h2>
      </div>
      <p className="moment-persistence-note">
        Recorded interactions show what was selected or viewed. They do not prove comprehension or
        ownership.
      </p>
      {props.state === "loading" ? <p aria-live="polite">Loading selected Moments…</p> : null}
      {props.state === "error" ? (
        <p className="warning-note" role="alert">
          {props.statusMessage}
        </p>
      ) : null}
      {props.interactionLoadState === "loading" ? (
        <p aria-live="polite">Loading recorded interactions…</p>
      ) : null}
      {props.interactionLoadState === "error" ? (
        <p className="warning-note" role="alert">
          {props.interactionStatusMessage}
        </p>
      ) : null}
      {props.interactionLoadState === "ready" && props.interactionStatusMessage ? (
        <p className="moment-unsaved-note" role="status" aria-live="polite">
          {props.interactionStatusMessage}
        </p>
      ) : null}
      {props.projection?.outcome === "not_available" ? (
        <p className="empty-note">
          No current validated Moment selection is available. Nothing was generated by this read.
        </p>
      ) : null}
      {props.projection !== null && props.projection.limitations.length > 0 ? (
        <div className="warning-note">
          <strong>Partial source limitations</strong>
          <ul>
            {props.projection.limitations.map((limitation) => (
              <li key={limitation}>{limitation.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.projection !== null &&
      props.projection.outcome !== "not_available" &&
      props.projection.moments.length === 0 ? (
        <p className="empty-note">The verified validation selected zero Moments.</p>
      ) : null}
      {props.projection !== null && props.projection.moments.length > 0 ? (
        <ol className="moment-list">
          {props.projection.moments.map((moment) => {
            const state = states.get(moment.displayId) ?? {
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
              usefulness: "unset" as const,
              latestInteractionAt: null,
              interactionCount: 0,
              ownershipRecordCount: 0,
            };
            return (
              <OwnershipMomentCard
                key={moment.displayId}
                moment={moment}
                interactionState={state}
                interactionReady={
                  props.interactionLoadState === "ready" && props.interactionState !== null
                }
                onResolveEvidence={(evidenceId, interactionId) =>
                  props.onResolveEvidence(moment.displayId, evidenceId, interactionId)
                }
                onRecordInteraction={(action, interactionId) =>
                  props.onRecordInteraction(moment.displayId, action, interactionId)
                }
              />
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function ReplayTimeline(
  props: Readonly<{ replay: RawRunReplayV1; onResolveEvidence(evidenceId: string): void }>,
) {
  const { replay } = props;
  return (
    <section
      id="timeline"
      tabIndex={-1}
      className="content-section"
      aria-labelledby="timeline-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">Storage order</p>
        <h2 id="timeline-heading">Timeline</h2>
      </div>
      {replay.timeline.length === 0 ? (
        <p className="empty-note">No Run-level Event was persisted.</p>
      ) : (
        <ol className="timeline">
          {replay.timeline.map((event) => (
            <li key={event.eventId}>
              <span className="sequence">{event.sequence}</span>
              <div>
                <div className="timeline-title">
                  <strong>{event.type}</strong>
                  <span>{event.source}</span>
                </div>
                <p>
                  Occurred {formatTime(event.occurredAt)} · Ingested {formatTime(event.ingestedAt)}
                </p>
                {Object.keys(event.payload).length > 0 ? (
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                ) : null}
                <EvidenceAction
                  evidenceId={event.evidenceId}
                  onResolveEvidence={props.onResolveEvidence}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ChangedFiles(
  props: Readonly<{ replay: RawRunReplayV1; onResolveEvidence(evidenceId: string): void }>,
) {
  const { replay } = props;
  const files = replay.reconciliations.flatMap((item) => item.changedFiles);
  return (
    <section
      id="changed-files"
      tabIndex={-1}
      className="content-section"
      aria-labelledby="files-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">Repository observations</p>
        <h2 id="files-heading">Changed files</h2>
      </div>
      {files.length === 0 ? (
        <p className="empty-note">No changed-file observation was persisted.</p>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.entryId}>
              <code>{file.relativePath ?? "Sensitive path withheld"}</code>
              <span>{file.changeKind.replace("_", " ")}</span>
              <small>{file.attribution.replace("_", " ")}</small>
              <EvidenceAction
                evidenceId={file.evidenceId}
                onResolveEvidence={props.onResolveEvidence}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Verification(
  props: Readonly<{ replay: RawRunReplayV1; onResolveEvidence(evidenceId: string): void }>,
) {
  const { replay } = props;
  return (
    <section
      id="verification"
      tabIndex={-1}
      className="content-section"
      aria-labelledby="verification-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">Observed only</p>
        <h2 id="verification-heading">Verification</h2>
      </div>
      {replay.verification.length === 0 ? (
        <p className="warning-note">
          No verification Event was observed. This is not a success claim.
        </p>
      ) : (
        <ul className="verification-list">
          {replay.verification.map((item) => (
            <li key={item.eventId}>
              <strong>{item.type}</strong>
              <span>Sequence {item.sequence}</span>
              <EvidenceAction
                evidenceId={item.evidenceId}
                onResolveEvidence={props.onResolveEvidence}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceStructure({ replay }: Readonly<{ replay: RawRunReplayV1 }>) {
  return (
    <section
      id="evidence-structure"
      tabIndex={-1}
      className="content-section"
      aria-labelledby="structure-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">Persisted relationships</p>
        <h2 id="structure-heading">Evidence structure</h2>
      </div>
      <dl className="fact-grid">
        <div>
          <dt>Baseline</dt>
          <dd>{replay.baseline?.outcome ?? "Not captured"}</dd>
        </div>
        <div>
          <dt>Reconciliations</dt>
          <dd>{replay.reconciliations.length}</dd>
        </div>
        <div>
          <dt>Causal links</dt>
          <dd>{replay.causalLinks.length}</dd>
        </div>
        <div>
          <dt>Finalization</dt>
          <dd>{replay.finalization?.terminalStatus ?? "In progress"}</dd>
        </div>
      </dl>
      {replay.reconciliations.length > 0 ? (
        <ul className="relationship-list">
          {replay.reconciliations.map((item) => (
            <li key={item.reconciliationId}>
              <strong>{item.boundary.replace("_", " ")}</strong>
              <span>{item.outcome}</span>
              <small>{item.attribution.replace("_", " ")}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {replay.causalLinks.length > 0 ? (
        <details className="causal-links">
          <summary>Show persisted causal links</summary>
          <ul>
            {replay.causalLinks.map((link) => (
              <li key={link.linkId}>
                <strong>{link.type.replaceAll("_", " ")}</strong>
                <span>
                  {link.sourceKind} → {link.targetKind}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="empty-note">No persisted causal relationship is available.</p>
      )}
    </section>
  );
}

function Artifacts(
  props: Readonly<{
    replay: RawRunReplayV1;
    manifest: FinalDiffManifestV1 | null;
    onLoadArtifact(artifact: ReplayArtifactReferenceV1): void;
    onResolveEvidence(evidenceId: string): void;
  }>,
) {
  return (
    <section
      id="artifacts"
      tabIndex={-1}
      className="content-section"
      aria-labelledby="artifacts-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">Verified local objects</p>
        <h2 id="artifacts-heading">Artifacts</h2>
      </div>
      {props.replay.artifacts.length === 0 ? (
        <p className="empty-note">No replay-readable artifact is linked to this Run.</p>
      ) : (
        <ul className="artifact-list">
          {props.replay.artifacts.map((artifact) => (
            <li key={`${artifact.artifactId}:${artifact.role}`}>
              <div>
                <strong>{artifact.kind}</strong>
                <span>
                  {artifact.mediaType ?? "Unknown media type"} · {artifact.sizeBytes} bytes
                </span>
              </div>
              <div className="artifact-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => props.onLoadArtifact(artifact)}
                >
                  Load verified manifest
                </button>
                <EvidenceAction
                  evidenceId={artifact.evidenceId}
                  onResolveEvidence={props.onResolveEvidence}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {props.manifest !== null ? (
        <div className="manifest-view">
          <h3>Final diff manifest</h3>
          <pre>{JSON.stringify(props.manifest, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}

function ReplayDetail(
  props: Readonly<{
    replay: RawRunReplayV1;
    manifest: FinalDiffManifestV1 | null;
    moments: OwnershipMomentsProjectionV1 | null;
    momentState: MomentLoadState;
    momentStatusMessage: string;
    interactionState: MomentInteractionStateResponseV1 | null;
    interactionLoadState: InteractionLoadState;
    interactionStatusMessage: string;
    buildReplay: EnrichedBuildReplayV1 | null;
    buildReplayState: BuildReplayLoadState;
    buildReplayStatusMessage: string;
    onLoadArtifact(artifact: ReplayArtifactReferenceV1): void;
    onResolveEvidence(evidenceId: string): void;
    onResolveMomentEvidence(
      momentId: string,
      evidenceId: string,
      interactionId: string,
    ): Promise<void>;
    onRecordMomentInteraction(
      momentId: string,
      action: MomentInteractionActionV1,
      interactionId: string,
    ): Promise<MomentInteractionReceiptV1>;
  }>,
) {
  return (
    <article id="run-summary" tabIndex={-1} className="replay-detail">
      <header className="replay-header">
        <div>
          <p className="eyebrow">Run {props.replay.run.runNumber}</p>
          <h1>Raw Build Replay</h1>
        </div>
        <span className={statusClass(props.replay.run.status)}>{props.replay.run.status}</span>
      </header>
      <EvidenceBanner replay={props.replay} />
      <BuildReplaySection
        state={props.buildReplayState}
        statusMessage={props.buildReplayStatusMessage}
        projection={props.buildReplay}
        onResolveEvidence={props.onResolveEvidence}
      />
      <OwnershipMomentsSection
        key={`${props.replay.run.runId}:${props.moments?.validationId ?? "none"}`}
        state={props.momentState}
        statusMessage={props.momentStatusMessage}
        projection={props.moments}
        interactionState={props.interactionState}
        interactionLoadState={props.interactionLoadState}
        interactionStatusMessage={props.interactionStatusMessage}
        onResolveEvidence={props.onResolveMomentEvidence}
        onRecordInteraction={props.onRecordMomentInteraction}
      />
      {props.replay.evidenceGraph !== null && props.replay.evidenceGraph !== undefined ? (
        <section className={`evidence-graph-summary outcome-${props.replay.evidenceGraph.outcome}`}>
          <div>
            <p className="eyebrow">Evidence Graph</p>
            <h2>{props.replay.evidenceGraph.outcome}</h2>
          </div>
          <p>
            {props.replay.evidenceGraph.nodeCount} nodes · {props.replay.evidenceGraph.edgeCount}{" "}
            edges
          </p>
          {props.replay.evidenceGraph.limitations.length > 0 ? (
            <ul>
              {props.replay.evidenceGraph.limitations.map((limitation) => (
                <li key={limitation}>{limitation.replaceAll("_", " ")}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="prompt-block" aria-labelledby="prompt-heading">
        <p className="eyebrow">Redacted input</p>
        <h2 id="prompt-heading">Prompt</h2>
        <p>{props.replay.run.redactedPrompt || "No prompt text was captured."}</p>
      </section>
      <div className="replay-grid">
        <ReplayTimeline replay={props.replay} onResolveEvidence={props.onResolveEvidence} />
        <div className="side-sections">
          <ChangedFiles replay={props.replay} onResolveEvidence={props.onResolveEvidence} />
          <Verification replay={props.replay} onResolveEvidence={props.onResolveEvidence} />
          <EvidenceStructure replay={props.replay} />
          <section
            id="evidence-gaps"
            tabIndex={-1}
            className="content-section"
            aria-labelledby="gaps-heading"
          >
            <div className="section-heading">
              <p className="eyebrow">Uncertainty</p>
              <h2 id="gaps-heading">Evidence gaps</h2>
            </div>
            {props.replay.evidenceGaps.length === 0 ? (
              <p className="empty-note">No evidence gap was persisted.</p>
            ) : (
              <ul className="gap-list">
                {props.replay.evidenceGaps.map((gap) => (
                  <li key={gap.gapId}>
                    <strong>{gap.code}</strong>
                    <p>{gap.message}</p>
                    <small>{formatTime(gap.createdAt)}</small>
                    <EvidenceAction
                      evidenceId={gap.evidenceId}
                      onResolveEvidence={props.onResolveEvidence}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Artifacts
            replay={props.replay}
            manifest={props.manifest}
            onLoadArtifact={props.onLoadArtifact}
            onResolveEvidence={props.onResolveEvidence}
          />
        </div>
      </div>
    </article>
  );
}

export function ReplayViewer(props: ViewerProps) {
  return (
    <div className="viewer-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="OwnLoop replay home">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          <span>
            <strong>OwnLoop</strong>
            <small>Raw Replay</small>
          </span>
        </a>
        <button type="button" className="button ghost" onClick={props.onDisconnect}>
          Disconnect
        </button>
      </header>
      <div className="workspace">
        <RunList
          runs={props.runs}
          selectedRunId={props.selectedRunId}
          nextCursor={props.nextCursor}
          onSelectRun={props.onSelectRun}
          onLoadMore={props.onLoadMore}
        />
        <main className="main-panel" aria-live="polite">
          {props.state === "loading" ? (
            <p className="state-card">Loading persisted replay…</p>
          ) : null}
          {props.state === "empty" ? (
            <p className="state-card">No Task Run has been persisted yet.</p>
          ) : null}
          {props.state === "error" ? (
            <p className="state-card error">{props.statusMessage}</p>
          ) : null}
          {props.state === "ready" && props.replay === null ? (
            <p className="state-card">Select a Task Run to inspect its persisted evidence.</p>
          ) : null}
          {props.replay !== null ? (
            <ReplayDetail
              replay={props.replay}
              manifest={props.manifest}
              moments={props.moments}
              momentState={props.momentState}
              momentStatusMessage={props.momentStatusMessage}
              interactionState={props.interactionState}
              interactionLoadState={props.interactionLoadState}
              interactionStatusMessage={props.interactionStatusMessage}
              buildReplay={props.buildReplay}
              buildReplayState={props.buildReplayState}
              buildReplayStatusMessage={props.buildReplayStatusMessage}
              onLoadArtifact={props.onLoadArtifact}
              onResolveEvidence={props.onResolveEvidence}
              onResolveMomentEvidence={props.onResolveMomentEvidence}
              onRecordMomentInteraction={props.onRecordMomentInteraction}
            />
          ) : null}
          <SettingsPanel
            client={props.settingsClient}
            selectedRun={props.selectedRun}
            onUnauthorized={props.onSettingsUnauthorized}
            onRunsDeleted={props.onRunsDeleted}
          />
          <DiagnosticsPanel
            client={props.settingsClient}
            onUnauthorized={props.onSettingsUnauthorized}
          />
        </main>
      </div>
    </div>
  );
}

export function App() {
  const tokenRef = useRef("");
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<ReplayApiClient | null>(null);
  const loadRequestRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<LoadState>("disconnected");
  const [statusMessage, setStatusMessage] = useState("");
  const [runs, setRuns] = useState<readonly ReplayRunSummaryV1[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [replay, setReplay] = useState<RawRunReplayV1 | null>(null);
  const [manifest, setManifest] = useState<FinalDiffManifestV1 | null>(null);
  const [moments, setMoments] = useState<OwnershipMomentsProjectionV1 | null>(null);
  const [momentState, setMomentState] = useState<MomentLoadState>("idle");
  const [momentStatusMessage, setMomentStatusMessage] = useState("");
  const [interactionState, setInteractionState] = useState<MomentInteractionStateResponseV1 | null>(
    null,
  );
  const [interactionLoadState, setInteractionLoadState] = useState<InteractionLoadState>("idle");
  const [interactionStatusMessage, setInteractionStatusMessage] = useState("");
  const [buildReplay, setBuildReplay] = useState<EnrichedBuildReplayV1 | null>(null);
  const [buildReplayState, setBuildReplayState] = useState<BuildReplayLoadState>("idle");
  const [buildReplayStatusMessage, setBuildReplayStatusMessage] = useState("");

  const initialRunId = useMemo(() => {
    const runId = new URLSearchParams(window.location.search).get("run");
    return runId !== null && SAFE_ID_PATTERN.test(runId) ? runId : null;
  }, []);

  function clearConnection(message = ""): void {
    loadRequestRef.current += 1;
    tokenRef.current = "";
    clientRef.current = null;
    setConnected(false);
    setState(message.length > 0 ? "error" : "disconnected");
    setStatusMessage(message);
    setRuns([]);
    setReplay(null);
    setManifest(null);
    setMoments(null);
    setMomentState("idle");
    setMomentStatusMessage("");
    setInteractionState(null);
    setInteractionLoadState("idle");
    setInteractionStatusMessage("");
    setBuildReplay(null);
    setBuildReplayState("idle");
    setBuildReplayStatusMessage("");
    setSelectedRunId(null);
    setNextCursor(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function clearSelectedRunState(): void {
    loadRequestRef.current += 1;
    setReplay(null);
    setManifest(null);
    setMoments(null);
    setMomentState("idle");
    setMomentStatusMessage("");
    setInteractionState(null);
    setInteractionLoadState("idle");
    setInteractionStatusMessage("");
    setBuildReplay(null);
    setBuildReplayState("idle");
    setBuildReplayStatusMessage("");
    setSelectedRunId(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function handleRunsDeleted(runIds: readonly string[]): Promise<void> {
    if (runIds.length === 0) return;
    const deleted = new Set(runIds);
    const selectedWasDeleted = selectedRunId !== null && deleted.has(selectedRunId);
    if (selectedWasDeleted) clearSelectedRunState();

    const client = clientRef.current;
    if (client === null) return;
    try {
      const list = await client.listRuns();
      if (clientRef.current !== client) return;
      setRuns(list.runs);
      setNextCursor(list.nextCursor);
      if (!selectedWasDeleted) {
        setStatusMessage(`${runIds.length} Run${runIds.length === 1 ? "" : "s"} deleted locally.`);
        return;
      }
      const nextRunId = list.runs[0]?.runId ?? null;
      if (nextRunId === null) {
        setState("empty");
        setStatusMessage("The selected Run was deleted locally.");
        return;
      }
      setStatusMessage("The selected Run was deleted locally.");
      await loadRun(client, nextRunId);
    } catch (error) {
      handleApiError(error, "The Run list could not be refreshed after deletion.");
    }
  }

  function handleApiError(error: unknown, fallback: string): void {
    if (error instanceof ReplayApiError && error.code === "unauthorized") {
      clearConnection(error.message);
      return;
    }
    setState("error");
    setStatusMessage(error instanceof ReplayApiError ? error.message : fallback);
  }

  async function loadRun(client: ReplayApiClient, runId: string): Promise<void> {
    const requestNumber = loadRequestRef.current + 1;
    loadRequestRef.current = requestNumber;
    setState("loading");
    setManifest(null);
    setMoments(null);
    setMomentState("loading");
    setMomentStatusMessage("");
    setInteractionState(null);
    setInteractionLoadState("idle");
    setInteractionStatusMessage("");
    setBuildReplay(null);
    setBuildReplayState("loading");
    setBuildReplayStatusMessage("");

    let nextReplay: RawRunReplayV1;
    try {
      nextReplay = await client.getRun(runId);
    } catch (error) {
      if (loadRequestRef.current !== requestNumber) return;
      setReplay(null);
      setMomentState("error");
      setInteractionLoadState("error");
      handleApiError(error, "The replay could not be loaded.");
      return;
    }
    if (loadRequestRef.current !== requestNumber) return;
    setReplay(nextReplay);
    setSelectedRunId(runId);
    setState("ready");
    window.history.replaceState(null, "", `?run=${encodeURIComponent(runId)}`);

    void (async () => {
      try {
        const nextBuildReplay = await client.getBuildReplay(runId);
        if (loadRequestRef.current !== requestNumber) return;
        setBuildReplay(nextBuildReplay);
        setBuildReplayState("ready");
      } catch (error) {
        if (loadRequestRef.current !== requestNumber) return;
        if (error instanceof ReplayApiError && error.code === "unauthorized") {
          clearConnection(error.message);
          return;
        }
        setBuildReplay(null);
        setBuildReplayState("error");
        setBuildReplayStatusMessage(
          error instanceof ReplayApiError
            ? error.message
            : "Enriched Build Replay could not be loaded.",
        );
      }
    })();

    let nextMoments: OwnershipMomentsProjectionV1;
    try {
      nextMoments = await client.getMoments(runId);
    } catch (error) {
      if (loadRequestRef.current !== requestNumber) return;
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        clearConnection(error.message);
        return;
      }
      setMomentState("error");
      setMomentStatusMessage(
        error instanceof ReplayApiError ? error.message : "Ownership Moments could not be loaded.",
      );
      setInteractionLoadState("error");
      setInteractionStatusMessage(
        "Recorded interactions are unavailable without a valid Moment projection.",
      );
      return;
    }
    if (loadRequestRef.current !== requestNumber) return;
    setMoments(nextMoments);
    setMomentState("ready");

    if (nextMoments.validationId === null || nextMoments.outcome === "not_available") {
      setInteractionState(null);
      setInteractionLoadState("ready");
      return;
    }

    setInteractionLoadState("loading");
    try {
      const nextInteractions = await client.getMomentInteractionState(
        runId,
        nextMoments.validationId,
      );
      if (loadRequestRef.current !== requestNumber) return;
      if (!interactionStateMatchesProjection(nextInteractions, nextMoments)) {
        throw new ReplayApiError("invalid_response");
      }
      setInteractionState(nextInteractions);
      setInteractionLoadState("ready");
    } catch (error) {
      if (loadRequestRef.current !== requestNumber) return;
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        clearConnection(error.message);
        return;
      }
      setInteractionState(null);
      setInteractionLoadState("error");
      setInteractionStatusMessage(
        error instanceof ReplayApiError
          ? error.message
          : "Recorded interactions could not be loaded.",
      );
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = tokenInputRef.current?.value ?? "";
    if (tokenInputRef.current !== null) {
      tokenInputRef.current.value = "";
    }
    tokenRef.current = token;
    const client = createReplayApiClient(token);
    clientRef.current = client;
    setConnected(true);
    setState("loading");
    setStatusMessage("Connecting to the local daemon…");
    try {
      const list = await client.listRuns();
      setRuns(list.runs);
      setNextCursor(list.nextCursor);
      if (list.runs.length === 0) {
        setState("empty");
        return;
      }
      setState("ready");
      const desired = initialRunId ?? list.runs[0]?.runId;
      if (desired !== undefined) {
        await loadRun(client, desired);
      }
    } catch (error) {
      handleApiError(error, "Connection failed.");
    }
  }

  async function loadMore(): Promise<void> {
    const client = clientRef.current;
    if (client === null || nextCursor === null) {
      return;
    }
    try {
      const list = await client.listRuns(nextCursor);
      setRuns((current) => {
        const byId = new Map(current.map((run) => [run.runId, run]));
        for (const run of list.runs) {
          byId.set(run.runId, run);
        }
        return [...byId.values()];
      });
      setNextCursor(list.nextCursor);
    } catch (error) {
      handleApiError(error, "More Runs could not be loaded.");
    }
  }

  async function selectRun(runId: string): Promise<void> {
    const client = clientRef.current;
    if (client !== null) {
      await loadRun(client, runId);
    }
  }

  async function loadArtifact(artifact: ReplayArtifactReferenceV1): Promise<void> {
    const client = clientRef.current;
    if (client === null) {
      return;
    }
    try {
      setManifest(await client.loadFinalManifest(artifact.artifactId));
    } catch (error) {
      handleApiError(error, "The artifact could not be loaded.");
    }
  }

  async function focusEvidence(evidenceId: string): Promise<void> {
    const client = clientRef.current;
    if (client === null || selectedRunId === null) {
      throw new ReplayApiError("unavailable");
    }
    const runId = selectedRunId;
    const requestNumber = loadRequestRef.current;
    const resolution = await client.resolveEvidence(runId, evidenceId);
    if (loadRequestRef.current !== requestNumber) {
      throw new ReplayApiError("unavailable");
    }
    const target = document.getElementById(resolution.anchor.sectionId);
    if (target === null) {
      throw new ReplayApiError("invalid_response");
    }
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    setStatusMessage(`Evidence resolved to ${resolution.nodeKind.replaceAll("_", " ")}.`);
  }

  async function resolveEvidence(evidenceId: string): Promise<void> {
    try {
      await focusEvidence(evidenceId);
    } catch (error) {
      handleApiError(error, "The evidence reference could not be resolved.");
    }
  }

  async function recordMomentInteractionAction(
    momentId: string,
    action: MomentInteractionActionV1,
    interactionId: string,
  ): Promise<MomentInteractionReceiptV1> {
    const client = clientRef.current;
    const runId = selectedRunId;
    const projection = moments;
    const validationId = projection?.validationId ?? null;
    if (client === null || runId === null || validationId === null || projection === null) {
      throw new ReplayApiError("unavailable");
    }
    const requestNumber = loadRequestRef.current;
    setInteractionStatusMessage("Saving recorded interaction…");
    try {
      const receipt = await client.recordMomentInteraction(runId, momentId, {
        schemaVersion: 1,
        interactionId,
        validationId,
        action,
      });
      const refreshed = await client.getMomentInteractionState(runId, validationId);
      if (!interactionStateMatchesProjection(refreshed, projection)) {
        throw new ReplayApiError("invalid_response");
      }
      if (clientRef.current === client && loadRequestRef.current === requestNumber) {
        setInteractionState((current) => preferNewerInteractionState(current, refreshed));
        setInteractionLoadState("ready");
        setInteractionStatusMessage(
          receipt.idempotentReplay
            ? "The existing recorded interaction was verified."
            : "Interaction recorded locally.",
        );
        try {
          const refreshedBuildReplay = await client.getBuildReplay(runId);
          if (clientRef.current === client && loadRequestRef.current === requestNumber) {
            setBuildReplay((current) => preferNewerBuildReplay(current, refreshedBuildReplay));
            setBuildReplayState("ready");
            setBuildReplayStatusMessage("");
          }
        } catch (buildReplayError) {
          if (
            buildReplayError instanceof ReplayApiError &&
            buildReplayError.code === "unauthorized"
          ) {
            clearConnection(buildReplayError.message);
          } else if (clientRef.current === client && loadRequestRef.current === requestNumber) {
            setBuildReplayState("error");
            setBuildReplayStatusMessage(
              buildReplayError instanceof ReplayApiError
                ? buildReplayError.message
                : "Build Replay could not be refreshed after the recorded interaction.",
            );
          }
        }
      }
      return receipt;
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        clearConnection(error.message);
      } else if (clientRef.current === client && loadRequestRef.current === requestNumber) {
        setInteractionStatusMessage(
          error instanceof ReplayApiError ? error.message : "The interaction could not be saved.",
        );
      }
      throw error;
    }
  }

  async function resolveMomentEvidence(
    momentId: string,
    evidenceId: string,
    interactionId: string,
  ): Promise<void> {
    try {
      await focusEvidence(evidenceId);
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        clearConnection(error.message);
      } else {
        setInteractionStatusMessage("Evidence could not be opened, so no view was recorded.");
      }
      throw error;
    }
    try {
      await recordMomentInteractionAction(
        momentId,
        { kind: "evidence_viewed", evidenceId },
        interactionId,
      );
    } catch (error) {
      if (!(error instanceof ReplayApiError && error.code === "unauthorized")) {
        setInteractionStatusMessage("Evidence opened, but the view could not be recorded.");
      }
      throw error;
    }
  }

  const selectedRun =
    selectedRunId === null ? null : (runs.find((run) => run.runId === selectedRunId) ?? null);

  const settingsClient = clientRef.current;

  return (
    <>
      {!connected || settingsClient === null ? (
        <main className="landing">
          <header className="landing-header">
            <p className="eyebrow">Human ownership layer</p>
            <h1>Understand what the coding agent actually changed.</h1>
            <p>
              OwnLoop reconstructs a deterministic replay from persisted local evidence—without
              inventing success, causality, or missing work.
            </p>
          </header>
          <ConnectionPanel
            connected={false}
            tokenInputRef={tokenInputRef}
            onConnect={connect}
            onDisconnect={() => clearConnection()}
            statusMessage={statusMessage}
          />
        </main>
      ) : (
        <ReplayViewer
          state={state}
          statusMessage={statusMessage}
          runs={runs}
          replay={replay}
          manifest={manifest}
          moments={moments}
          momentState={momentState}
          momentStatusMessage={momentStatusMessage}
          interactionState={interactionState}
          interactionLoadState={interactionLoadState}
          interactionStatusMessage={interactionStatusMessage}
          buildReplay={buildReplay}
          buildReplayState={buildReplayState}
          buildReplayStatusMessage={buildReplayStatusMessage}
          selectedRunId={selectedRunId}
          selectedRun={selectedRun}
          settingsClient={settingsClient}
          nextCursor={nextCursor}
          onSelectRun={selectRun}
          onLoadMore={loadMore}
          onLoadArtifact={loadArtifact}
          onResolveEvidence={resolveEvidence}
          onResolveMomentEvidence={resolveMomentEvidence}
          onRecordMomentInteraction={recordMomentInteractionAction}
          onSettingsUnauthorized={(message) => clearConnection(message)}
          onRunsDeleted={(runIds) => void handleRunsDeleted(runIds)}
          onDisconnect={() => clearConnection()}
        />
      )}
    </>
  );
}
