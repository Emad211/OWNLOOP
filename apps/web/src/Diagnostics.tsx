import type { DiagnosticsBundleV1, DiagnosticsDashboardV1 } from "@ownloop/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ReplayApiClient } from "./api.js";
import { ReplayApiError } from "./api.js";

export const DIAGNOSTICS_DOWNLOAD_FILENAME = "ownloop-diagnostics-v1.json" as const;

type Status = "loading" | "ready" | "error" | "exporting";

export type DiagnosticsPanelProps = Readonly<{
  client: ReplayApiClient;
  onUnauthorized(message: string): void;
  initialDashboard?: DiagnosticsDashboardV1;
}>;

export function triggerDiagnosticsDownload(
  bundle: DiagnosticsBundleV1,
  dependencies: Readonly<{
    documentValue?: Document;
    urlApi?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  }> = {},
): void {
  const documentValue = dependencies.documentValue ?? document;
  const urlApi = dependencies.urlApi ?? URL;
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json;charset=utf-8" });
  const url = urlApi.createObjectURL(blob);
  try {
    const anchor = documentValue.createElement("a");
    anchor.href = url;
    anchor.download = DIAGNOSTICS_DOWNLOAD_FILENAME;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    urlApi.revokeObjectURL(url);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof ReplayApiError
    ? error.message
    : "Diagnostics could not be loaded from the local daemon.";
}

function countList(items: readonly Readonly<{ code: string; count: number }>[]) {
  return items.length === 0 ? (
    <p className="empty-note">No controlled counts are present in this snapshot.</p>
  ) : (
    <ul className="diagnostic-count-list">
      {items.map((item) => (
        <li key={item.code}>
          <code>{item.code}</code>
          <strong>{item.count}</strong>
        </li>
      ))}
    </ul>
  );
}

export function DiagnosticsPanel(props: DiagnosticsPanelProps) {
  const initial = props.initialDashboard ?? null;
  const [dashboard, setDashboard] = useState<DiagnosticsDashboardV1 | null>(initial);
  const [status, setStatus] = useState<Status>(initial === null ? "loading" : "ready");
  const [message, setMessage] = useState(
    initial === null ? "Loading diagnostics…" : "Diagnostics snapshot loaded.",
  );
  const unauthorizedRef = useRef(props.onUnauthorized);
  unauthorizedRef.current = props.onUnauthorized;

  const load = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setMessage("Refreshing diagnostics from the local daemon…");
    try {
      const next = await props.client.getDiagnosticsDashboard();
      setDashboard(next);
      setStatus("ready");
      setMessage("Diagnostics snapshot refreshed.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        unauthorizedRef.current(error.message);
        return;
      }
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, [props.client]);

  useEffect(() => {
    if (props.initialDashboard === undefined) void load();
  }, [load, props.initialDashboard]);

  async function exportBundle(): Promise<void> {
    setStatus("exporting");
    setMessage("Preparing a sanitized in-memory bundle…");
    try {
      const bundle = await props.client.getDiagnosticsBundle();
      triggerDiagnosticsDownload(bundle);
      setStatus("ready");
      setMessage("Sanitized diagnostic bundle downloaded. No bundle was persisted by OwnLoop.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        props.onUnauthorized(error.message);
        return;
      }
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="settings-panel diagnostics-panel" aria-labelledby="diagnostics-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Local observability</p>
          <h2 id="diagnostics-heading">Diagnostics and evidence quality</h2>
        </div>
        <button className="button ghost" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className={status === "error" ? "status-line error" : "status-line"} aria-live="polite">
        {message}
      </p>
      {dashboard === null ? null : (
        <>
          {dashboard.limitations.length > 0 ? (
            <aside className="diagnostic-limitations" aria-label="Diagnostic limitations">
              <strong>Limitations</strong>
              <ul>
                {dashboard.limitations.map((item) => (
                  <li key={item}>{item.replaceAll("_", " ")}</li>
                ))}
              </ul>
              <p>Zero process counts are not proof that an event never occurred.</p>
            </aside>
          ) : null}

          <div className="diagnostic-grid">
            <section>
              <h3>Process hooks</h3>
              {dashboard.process === null ? (
                <p>Counts-only diagnostics are disabled.</p>
              ) : (
                <>
                  <dl className="metrics-grid">
                    <div>
                      <dt>Server starts</dt>
                      <dd>{dashboard.process.serverStarted}</dd>
                    </div>
                    <div>
                      <dt>Server stops</dt>
                      <dd>{dashboard.process.serverStopped}</dd>
                    </div>
                    <div>
                      <dt>Accepted</dt>
                      <dd>{dashboard.process.acceptedReceipts}</dd>
                    </div>
                    <div>
                      <dt>Duplicates</dt>
                      <dd>{dashboard.process.duplicateReceipts}</dd>
                    </div>
                    <div>
                      <dt>Rejected</dt>
                      <dd>{dashboard.process.rejectedRequests}</dd>
                    </div>
                  </dl>
                  <h4>Accepted by hook</h4>
                  {countList(
                    dashboard.process.acceptedByHook.map((item) => ({
                      code: item.hookName,
                      count: item.count,
                    })),
                  )}
                  <h4>Duplicates by hook</h4>
                  {countList(
                    dashboard.process.duplicateByHook.map((item) => ({
                      code: item.hookName,
                      count: item.count,
                    })),
                  )}
                  <h4>Rejected by code</h4>
                  {countList(dashboard.process.rejectedByCode)}
                </>
              )}
            </section>

            <section>
              <h3>Redaction</h3>
              <dl className="metrics-grid">
                <div>
                  <dt>Prepared receipts</dt>
                  <dd>{dashboard.redaction.preparedReceiptCount}</dd>
                </div>
                <div>
                  <dt>Legacy receipts</dt>
                  <dd>{dashboard.redaction.legacyReceiptCount}</dd>
                </div>
                <div>
                  <dt>Redacted fields</dt>
                  <dd>{dashboard.redaction.redactedFieldCount}</dd>
                </div>
                <div>
                  <dt>Redacted values</dt>
                  <dd>{dashboard.redaction.redactedValueCount}</dd>
                </div>
                <div>
                  <dt>Path replacements</dt>
                  <dd>{dashboard.redaction.pathReplacementCount}</dd>
                </div>
                <div>
                  <dt>Dropped unknown fields</dt>
                  <dd>{dashboard.redaction.droppedUnknownFieldCount}</dd>
                </div>
                <div>
                  <dt>Truncated values</dt>
                  <dd>{dashboard.redaction.truncatedValueCount}</dd>
                </div>
              </dl>
              <h4>Receipts by hook</h4>
              {countList(
                dashboard.redaction.receiptsByHook.map((item) => ({
                  code: item.hookName,
                  count: item.count,
                })),
              )}
              <h4>Receipts by redaction rule</h4>
              {countList(dashboard.redaction.receiptsByRule)}
            </section>

            <section>
              <h3>Run outcomes</h3>
              <p>{dashboard.runs.totalRuns} persisted Task Runs in this snapshot.</p>
              {countList(
                dashboard.runs.byStatus.map((item) => ({ code: item.status, count: item.count })),
              )}
              <p>{dashboard.finalizations.total} verified finalizations.</p>
              <h4>Finalizations by status</h4>
              {countList(dashboard.finalizations.byStatus)}
              <h4>Finalizations by mode</h4>
              {countList(dashboard.finalizations.byMode)}
              <h4>Finalization diagnostics</h4>
              {countList(dashboard.finalizations.byDiagnosticCode)}
              <p>{dashboard.finalizations.withoutDiagnosticCode} without a diagnostic code.</p>
            </section>

            <section>
              <h3>Evidence quality</h3>
              <p>{dashboard.validations.totalValidations} verified current-policy validations.</p>
              <dl className="metrics-grid">
                <div>
                  <dt>Source Candidates</dt>
                  <dd>{dashboard.validations.sourceCandidates}</dd>
                </div>
                <div>
                  <dt>Rejected</dt>
                  <dd>{dashboard.validations.rejectedCandidates}</dd>
                </div>
                <div>
                  <dt>Duplicates</dt>
                  <dd>{dashboard.validations.duplicateCandidates}</dd>
                </div>
                <div>
                  <dt>Unselected</dt>
                  <dd>{dashboard.validations.unselectedCandidates}</dd>
                </div>
                <div>
                  <dt>Selected</dt>
                  <dd>{dashboard.validations.selectedCandidates}</dd>
                </div>
              </dl>
              <h4>Validation outcomes</h4>
              {countList(dashboard.validations.byOutcome)}
              <h4>Evidence-gap codes</h4>
              {countList(dashboard.evidenceGapCounts)}
              <h4>Validation reasons</h4>
              {countList(dashboard.validations.reasonCounts)}
            </section>
          </div>

          <section className="diagnostic-runs">
            <h3>Recent Runs</h3>
            {dashboard.recentRuns.length === 0 ? (
              <p className="empty-note">No Task Runs are present.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Status</th>
                      <th>Finalization</th>
                      <th>Gaps</th>
                      <th>Validation</th>
                      <th>Candidate counts</th>
                      <th>Limitations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentRuns.map((run) => (
                      <tr key={run.runId}>
                        <td>{run.runNumber}</td>
                        <td>{run.status}</td>
                        <td>
                          {run.finalization === null
                            ? "none"
                            : `${run.finalization.terminalStatus} / ${run.finalization.mode}`}
                        </td>
                        <td>{run.evidenceGapCount}</td>
                        <td>{run.validation?.outcome ?? "none"}</td>
                        <td>
                          {run.validation === null
                            ? "none"
                            : `${run.validation.selectedCandidates}/${run.validation.sourceCandidates} selected; ${run.validation.rejectedCandidates} rejected; ${run.validation.duplicateCandidates} duplicate`}
                        </td>
                        <td>
                          {run.limitations.length === 0 ? "none" : run.limitations.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {dashboard.recentRunsTruncated ? (
              <p>
                Showing {dashboard.recentRuns.length} of {dashboard.recentRunsTotal} Runs.
              </p>
            ) : null}
          </section>

          <section className="diagnostic-export">
            <h3>Sanitized export</h3>
            <p>
              The bundle excludes payloads, prompts, Candidate prose, Evidence IDs/text, paths,
              provider data and secrets, artifact metadata, exceptions, and stacks.
            </p>
            <button
              className="button primary"
              type="button"
              disabled={status === "exporting"}
              onClick={() => void exportBundle()}
            >
              Download sanitized JSON
            </button>
          </section>
        </>
      )}
    </section>
  );
}
