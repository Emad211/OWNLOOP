import type {
  FinalDiffManifestV1,
  RawRunReplayV1,
  ReplayArtifactReferenceV1,
  ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { type FormEvent, useMemo, useRef, useState } from "react";

import { createReplayApiClient, type ReplayApiClient, ReplayApiError } from "./api.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

type LoadState = "disconnected" | "loading" | "ready" | "empty" | "error";

type ViewerProps = Readonly<{
  state: LoadState;
  statusMessage: string;
  runs: readonly ReplayRunSummaryV1[];
  replay: RawRunReplayV1 | null;
  manifest: FinalDiffManifestV1 | null;
  selectedRunId: string | null;
  nextCursor: string | null;
  onSelectRun(runId: string): void;
  onLoadMore(): void;
  onLoadArtifact(artifact: ReplayArtifactReferenceV1): void;
  onResolveEvidence(evidenceId: string): void;
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
    onLoadArtifact(artifact: ReplayArtifactReferenceV1): void;
    onResolveEvidence(evidenceId: string): void;
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
              onLoadArtifact={props.onLoadArtifact}
              onResolveEvidence={props.onResolveEvidence}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const tokenRef = useRef("");
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<ReplayApiClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<LoadState>("disconnected");
  const [statusMessage, setStatusMessage] = useState("");
  const [runs, setRuns] = useState<readonly ReplayRunSummaryV1[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [replay, setReplay] = useState<RawRunReplayV1 | null>(null);
  const [manifest, setManifest] = useState<FinalDiffManifestV1 | null>(null);

  const initialRunId = useMemo(() => {
    const runId = new URLSearchParams(window.location.search).get("run");
    return runId !== null && SAFE_ID_PATTERN.test(runId) ? runId : null;
  }, []);

  function clearConnection(message = ""): void {
    tokenRef.current = "";
    clientRef.current = null;
    setConnected(false);
    setState(message.length > 0 ? "error" : "disconnected");
    setStatusMessage(message);
    setRuns([]);
    setReplay(null);
    setManifest(null);
    setSelectedRunId(null);
    setNextCursor(null);
    window.history.replaceState(null, "", window.location.pathname);
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
    setState("loading");
    setManifest(null);
    try {
      const nextReplay = await client.getRun(runId);
      setReplay(nextReplay);
      setSelectedRunId(runId);
      setState("ready");
      window.history.replaceState(null, "", `?run=${encodeURIComponent(runId)}`);
    } catch (error) {
      setReplay(null);
      handleApiError(error, "The replay could not be loaded.");
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

  async function resolveEvidence(evidenceId: string): Promise<void> {
    const client = clientRef.current;
    if (client === null || selectedRunId === null) {
      return;
    }
    try {
      const resolution = await client.resolveEvidence(selectedRunId, evidenceId);
      const target = document.getElementById(resolution.anchor.sectionId);
      if (target === null) {
        throw new ReplayApiError("invalid_response");
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
      setStatusMessage(`Evidence resolved to ${resolution.nodeKind.replaceAll("_", " ")}.`);
    } catch (error) {
      handleApiError(error, "The evidence reference could not be resolved.");
    }
  }

  return (
    <>
      {!connected ? (
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
          selectedRunId={selectedRunId}
          nextCursor={nextCursor}
          onSelectRun={selectRun}
          onLoadMore={loadMore}
          onLoadArtifact={loadArtifact}
          onResolveEvidence={resolveEvidence}
          onDisconnect={() => clearConnection()}
        />
      )}
    </>
  );
}
