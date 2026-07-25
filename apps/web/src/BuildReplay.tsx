import type {
  CandidateValidationFactV1,
  EnrichedBuildReplayMomentV1,
  EnrichedBuildReplayReviewActivity,
  EnrichedBuildReplayV1,
} from "@ownloop/contracts";

export type BuildReplayLoadState = "idle" | "loading" | "ready" | "error";

type BuildReplayProps = Readonly<{
  state: BuildReplayLoadState;
  statusMessage: string;
  projection: EnrichedBuildReplayV1 | null;
  onResolveEvidence(evidenceId: string): void;
}>;

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function factText(fact: CandidateValidationFactV1): string {
  switch (fact.kind) {
    case "verification_status":
      return `${humanize(fact.verificationKind)} verification: ${humanize(fact.observedStatus)}`;
    case "evidence_gap":
      return `Evidence gap: ${humanize(fact.gapCode)}`;
    case "decision_observed":
      return `Decision observation: ${humanize(fact.eventType)}`;
    case "source_partial":
      return "Source evidence is partial";
    default:
      return `${humanize(fact.kind)}: ${humanize(fact.value)}`;
  }
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
      return `${fact.kind}:${fact.value}:${evidence}`;
  }
}

function reviewLabel(activity: EnrichedBuildReplayReviewActivity): string {
  switch (activity) {
    case "none":
      return "No recorded review activity";
    case "viewed":
      return "Viewed";
    case "evidence_opened":
      return "Evidence opened";
    case "responded":
      return "Responded";
  }
}

function interactionText(moment: EnrichedBuildReplayMomentV1): string {
  const interaction = moment.proposal.suggestedInteraction;
  switch (interaction.kind) {
    case "acknowledge":
      return "Acknowledge this change";
    case "decision_response":
    case "risk_response":
      return interaction.prompt;
    case "check_answer":
      return interaction.question;
  }
}

function EvidenceButton(
  props: Readonly<{
    evidenceId: string | null | undefined;
    onResolveEvidence(evidenceId: string): void;
  }>,
) {
  if (props.evidenceId === null || props.evidenceId === undefined) return null;
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

function ReviewState({ moment }: Readonly<{ moment: EnrichedBuildReplayMomentV1 }>) {
  const state = moment.review.state;
  return (
    <section className="build-replay-review" aria-label="Recorded review activity">
      <p className="eyebrow">Recorded review activity</p>
      <h4>{reviewLabel(moment.review.activity)}</h4>
      <dl className="build-replay-counts">
        <div>
          <dt>Moment views</dt>
          <dd>{state.viewCount}</dd>
        </div>
        <div>
          <dt>Evidence views</dt>
          <dd>{state.evidenceViewCount}</dd>
        </div>
        <div>
          <dt>Interactions</dt>
          <dd>{state.interactionCount}</dd>
        </div>
        <div>
          <dt>Ownership Records</dt>
          <dd>{state.ownershipRecordCount}</dd>
        </div>
      </dl>
      <p className="build-replay-disclaimer">
        Recorded activity shows what was viewed or selected. It does not prove comprehension,
        correctness, approval, or ownership.
      </p>
    </section>
  );
}

function ReplayMoment(
  props: Readonly<{
    moment: EnrichedBuildReplayMomentV1;
    onResolveEvidence(evidenceId: string): void;
  }>,
) {
  const { moment } = props;
  return (
    <li className={`build-replay-moment moment-${moment.proposal.type}`}>
      <header>
        <span className="moment-rank">#{moment.selectedRank}</span>
        <span className="moment-type">{moment.proposal.type}</span>
      </header>
      <section className="moment-proposal">
        <p className="eyebrow">Provider proposal</p>
        <h3>{moment.proposal.title}</h3>
        <p>{moment.proposal.claim}</p>
        <p className="build-replay-interaction">Suggested interaction: {interactionText(moment)}</p>
        <dl className="build-replay-counts">
          <div>
            <dt>Importance signal</dt>
            <dd>{moment.proposal.importance}</dd>
          </div>
          <div>
            <dt>Confidence signal</dt>
            <dd>{moment.proposal.confidenceBasisPoints} bp</dd>
          </div>
        </dl>
      </section>
      <section className="moment-support">
        <p className="eyebrow">Deterministic support</p>
        <p>Validation score: {moment.support.score.total}</p>
        {moment.support.facts.length === 0 ? (
          <p className="empty-note">No controlled fact summary is available.</p>
        ) : (
          <ul>
            {moment.support.facts.map((fact) => (
              <li key={factKey(fact)}>{factText(fact)}</li>
            ))}
          </ul>
        )}
        <div className="moment-evidence-actions">
          {moment.support.evidenceIds.map((evidenceId) => (
            <EvidenceButton
              key={evidenceId}
              evidenceId={evidenceId}
              onResolveEvidence={props.onResolveEvidence}
            />
          ))}
        </div>
      </section>
      <ReviewState moment={moment} />
    </li>
  );
}

export function BuildReplaySection(props: BuildReplayProps) {
  if (props.state === "idle") return null;
  if (props.state === "loading") {
    return (
      <section id="build-replay" className="build-replay state-card" aria-live="polite">
        Loading deterministic Build Replay…
      </section>
    );
  }
  if (props.state === "error") {
    return (
      <section id="build-replay" className="build-replay state-card error" aria-live="polite">
        {props.statusMessage || "Build Replay could not be loaded."}
      </section>
    );
  }
  const replay = props.projection;
  if (replay === null) {
    return (
      <section id="build-replay" className="build-replay state-card error" aria-live="polite">
        Build Replay response is unavailable.
      </section>
    );
  }
  if (replay.outcome === "not_available") {
    return (
      <section id="build-replay" className="build-replay content-section" aria-live="polite">
        <p className="eyebrow">End-of-task replay</p>
        <h2>Enriched Build Replay is not available</h2>
        <p>This read-only replay becomes available after the Task Run reaches a terminal state.</p>
      </section>
    );
  }
  if (replay.completion === null || replay.goal === null) return null;

  return (
    <section
      id="build-replay"
      tabIndex={-1}
      className={`build-replay content-section outcome-${replay.outcome}`}
      aria-labelledby="build-replay-heading"
    >
      <header className="section-heading">
        <div>
          <p className="eyebrow">End-of-task replay</p>
          <h2 id="build-replay-heading">Enriched Build Replay</h2>
        </div>
        <span className={`status status-${replay.completion.status.toLowerCase()}`}>
          {replay.completion.status}
        </span>
      </header>

      <section className="build-replay-goal" aria-labelledby="build-replay-goal-heading">
        <p className="eyebrow">Original redacted goal</p>
        <h3 id="build-replay-goal-heading">What the Run was asked to do</h3>
        <p>{replay.goal}</p>
        <dl className="build-replay-counts">
          <div>
            <dt>Completeness</dt>
            <dd>{humanize(replay.completion.completeness)}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatTime(replay.completion.startedAt)}</dd>
          </div>
          <div>
            <dt>Ended</dt>
            <dd>{formatTime(replay.completion.endedAt)}</dd>
          </div>
        </dl>
      </section>

      {replay.limitations.length > 0 ? (
        <section
          className="build-replay-limitations"
          aria-labelledby="build-replay-limitations-heading"
        >
          <p className="eyebrow">Limitations first</p>
          <h3 id="build-replay-limitations-heading">Evidence coverage limitations</h3>
          <ul>
            {replay.limitations.map((limitation) => (
              <li key={limitation}>{humanize(limitation)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="build-replay-review-summary" aria-labelledby="build-review-heading">
        <p className="eyebrow">Recorded review summary</p>
        <h3 id="build-review-heading">Review activity</h3>
        <dl className="build-replay-counts">
          <div>
            <dt>Selected</dt>
            <dd>{replay.reviewSummary.selected}</dd>
          </div>
          <div>
            <dt>No activity</dt>
            <dd>{replay.reviewSummary.none}</dd>
          </div>
          <div>
            <dt>Viewed</dt>
            <dd>{replay.reviewSummary.viewed}</dd>
          </div>
          <div>
            <dt>Evidence opened</dt>
            <dd>{replay.reviewSummary.evidenceOpened}</dd>
          </div>
          <div>
            <dt>Responded</dt>
            <dd>{replay.reviewSummary.responded}</dd>
          </div>
        </dl>
        <p className="build-replay-disclaimer">
          Recorded activity is not a comprehension score, approval, or ownership claim.
        </p>
      </section>

      <section className="build-replay-files" aria-labelledby="build-files-heading">
        <p className="eyebrow">Moment-linked files</p>
        <h3 id="build-files-heading">Changed files referenced by selected Moments</h3>
        {replay.files.items.length === 0 ? (
          <p className="empty-note">No changed file was explicitly linked to a selected Moment.</p>
        ) : (
          <ol>
            {replay.files.items.map((item) => (
              <li key={`${item.reconciliationId}:${item.file.entryId}`}>
                <strong>{item.file.relativePath ?? "Sensitive path withheld"}</strong>
                <span>{humanize(item.file.changeKind)}</span>
                <small>
                  Referenced by rank{" "}
                  {item.linkedMoments.map((moment) => moment.selectedRank).join(", ")}
                </small>
                <EvidenceButton
                  evidenceId={item.file.evidenceId}
                  onResolveEvidence={props.onResolveEvidence}
                />
              </li>
            ))}
          </ol>
        )}
        {replay.files.counts.truncated ? (
          <p className="empty-note">
            Showing {replay.files.counts.returned} of {replay.files.counts.total} linked files.
          </p>
        ) : null}
      </section>

      <section className="build-replay-moments" aria-labelledby="build-moments-heading">
        <p className="eyebrow">Finite selected set</p>
        <h3 id="build-moments-heading">Changes, decisions, risks, and checks</h3>
        {replay.moments.length === 0 ? (
          <p className="empty-note">No Ownership Moments were selected for this Run.</p>
        ) : (
          <div className="build-replay-moment-groups">
            {(["change", "decision", "risk", "check"] as const).map((type) => {
              const moments = replay.moments.filter((moment) => moment.proposal.type === type);
              if (moments.length === 0) return null;
              return (
                <section key={type} aria-labelledby={`build-replay-${type}-heading`}>
                  <h4 id={`build-replay-${type}-heading`}>{humanize(type)} Moments</h4>
                  <ol className="moment-list">
                    {moments.map((moment) => (
                      <ReplayMoment
                        key={moment.displayId}
                        moment={moment}
                        onResolveEvidence={props.onResolveEvidence}
                      />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section className="build-replay-verification" aria-labelledby="build-verification-heading">
        <p className="eyebrow">Observed verification</p>
        <h3 id="build-verification-heading">Verification observations</h3>
        {replay.verification.items.length === 0 ? (
          <p className="empty-note">No controlled verification observation is available.</p>
        ) : (
          <ol>
            {replay.verification.items.map((item) => (
              <li key={item.eventId}>
                <strong>{humanize(item.payload.verificationKind ?? "unknown")}</strong>
                <span>{humanize(item.payload.status ?? "unknown")}</span>
                <small>{formatTime(item.occurredAt)}</small>
                <EvidenceButton
                  evidenceId={item.evidenceId}
                  onResolveEvidence={props.onResolveEvidence}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="build-replay-gaps" aria-labelledby="build-gaps-heading">
        <p className="eyebrow">Uncertainty</p>
        <h3 id="build-gaps-heading">Evidence gaps</h3>
        {replay.gaps.items.length === 0 ? (
          <p className="empty-note">No Evidence gap is included in this replay.</p>
        ) : (
          <ol>
            {replay.gaps.items.map((item) => (
              <li key={item.gap.gapId}>
                <strong>{humanize(item.gap.code)}</strong>
                <p>{item.gap.message}</p>
                <small>{formatTime(item.gap.createdAt)}</small>
                <EvidenceButton
                  evidenceId={item.gap.evidenceId}
                  onResolveEvidence={props.onResolveEvidence}
                />
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
