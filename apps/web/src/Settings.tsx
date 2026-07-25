import type {
  LocalDiagnosticMode,
  LocalRetentionPolicy,
  LocalSettingsResponseV1,
  LocalSettingsUpdateRequestV1,
  ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { ReplayApiClient } from "./api.js";
import { ReplayApiError } from "./api.js";

type SettingsStatus = "loading" | "ready" | "saving" | "error";

export type SettingsPanelProps = Readonly<{
  client: ReplayApiClient;
  selectedRun: ReplayRunSummaryV1 | null;
  onUnauthorized(message: string): void;
  onRunsDeleted(runIds: readonly string[]): void;
  initialResponse?: LocalSettingsResponseV1;
}>;

function message(error: unknown, fallback: string): string {
  return error instanceof ReplayApiError ? error.message : fallback;
}

export function normalizeSecretPatternText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function runDeletionConfirmation(run: ReplayRunSummaryV1): string {
  return `Delete Run ${run.runNumber} (${run.status}) permanently?`;
}

export function canDeleteRun(run: ReplayRunSummaryV1 | null): boolean {
  return run !== null && !["Capturing", "Finalizing"].includes(run.status);
}

export function SettingsPanel(props: SettingsPanelProps) {
  const secretRef = useRef<HTMLInputElement>(null);
  const onUnauthorizedRef = useRef(props.onUnauthorized);
  onUnauthorizedRef.current = props.onUnauthorized;
  const initial = props.initialResponse ?? null;
  const [response, setResponse] = useState<LocalSettingsResponseV1 | null>(initial);
  const [status, setStatus] = useState<SettingsStatus>(initial === null ? "loading" : "ready");
  const [statusMessage, setStatusMessage] = useState(
    initial === null ? "Loading local settings…" : "Settings loaded.",
  );
  const [externalAiEnabled, setExternalAiEnabled] = useState(
    initial?.settings.externalAiEnabled ?? false,
  );
  const [baseUrl, setBaseUrl] = useState(initial?.settings.provider?.baseUrl ?? "");
  const [modelId, setModelId] = useState(initial?.settings.provider?.modelId ?? "");
  const [modelRevision, setModelRevision] = useState(
    initial?.settings.provider?.modelRevision ?? "",
  );
  const [retentionPolicy, setRetentionPolicy] = useState<LocalRetentionPolicy>(
    initial?.settings.retentionPolicy ?? "keep_until_deleted",
  );
  const [diagnosticMode, setDiagnosticMode] = useState<LocalDiagnosticMode>(
    initial?.settings.diagnosticMode ?? "off",
  );
  const [patterns, setPatterns] = useState(
    initial?.settings.customSecretFieldPatterns.join("\n") ?? "",
  );
  const [diagnosticText, setDiagnosticText] = useState("Diagnostics are off.");
  const [retentionText, setRetentionText] = useState("No preview loaded.");

  const hydrate = useCallback((next: LocalSettingsResponseV1): void => {
    setResponse(next);
    setExternalAiEnabled(next.settings.externalAiEnabled);
    setBaseUrl(next.settings.provider?.baseUrl ?? "");
    setModelId(next.settings.provider?.modelId ?? "");
    setModelRevision(next.settings.provider?.modelRevision ?? "");
    setRetentionPolicy(next.settings.retentionPolicy);
    setDiagnosticMode(next.settings.diagnosticMode);
    setPatterns(next.settings.customSecretFieldPatterns.join("\n"));
  }, []);

  const reload = useCallback(
    async (successMessage = "Settings loaded."): Promise<void> => {
      setStatus("loading");
      try {
        const next = await props.client.getSettings();
        hydrate(next);
        setStatus("ready");
        setStatusMessage(successMessage);
      } catch (error) {
        if (error instanceof ReplayApiError && error.code === "unauthorized") {
          onUnauthorizedRef.current(error.message);
          return;
        }
        setStatus("error");
        setStatusMessage(message(error, "Settings could not be loaded."));
      }
    },
    [hydrate, props.client],
  );

  useEffect(() => {
    if (props.initialResponse === undefined) void reload();
  }, [props.initialResponse, reload]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (response === null) return;
    const normalizedPatterns = normalizeSecretPatternText(patterns);
    const provider =
      baseUrl.length === 0 && modelId.length === 0
        ? null
        : {
            providerFamily: "responses_json_v1" as const,
            baseUrl,
            modelId,
            modelRevision: modelRevision.length === 0 ? null : modelRevision,
            timeoutMs: response.settings.provider?.timeoutMs ?? 30_000,
            maxResponseBytes: response.settings.provider?.maxResponseBytes ?? 256 * 1024,
            retryPolicy:
              response.settings.provider?.retryPolicy ??
              ({ maxAttempts: 2, baseDelayMs: 250, maxRetryAfterMs: 5_000 } as const),
          };
    const request: LocalSettingsUpdateRequestV1 = {
      schemaVersion: 1,
      expectedRevision: response.settings.revision,
      replacement: {
        schemaVersion: 1,
        externalAiEnabled,
        provider,
        retentionPolicy,
        diagnosticMode,
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: normalizedPatterns,
      },
    };
    setStatus("saving");
    setStatusMessage("Saving settings locally…");
    try {
      const next = await props.client.updateSettings(request);
      hydrate(next);
      setStatus("ready");
      setStatusMessage("Settings saved locally.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        props.onUnauthorized(error.message);
        return;
      }
      if (error instanceof ReplayApiError && error.code === "conflict") {
        await reload("Settings changed elsewhere and were reloaded.");
        return;
      }
      setStatus("error");
      setStatusMessage(message(error, "Settings could not be saved."));
    }
  }

  async function loadSecret(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const input = secretRef.current;
    const value = input?.value ?? "";
    if (input !== null) input.value = "";
    setStatus("saving");
    setStatusMessage("Loading provider key into daemon memory…");
    try {
      await props.client.loadProviderSecret(value);
      await reload("Provider key loaded into daemon memory only.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        props.onUnauthorized(error.message);
        return;
      }
      setStatus("error");
      setStatusMessage(message(error, "Provider key was rejected."));
    }
  }

  async function clearSecret(): Promise<void> {
    try {
      await props.client.clearProviderSecret();
      await reload("Provider key cleared from daemon memory.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        props.onUnauthorized(error.message);
        return;
      }
      setStatus("error");
      setStatusMessage(message(error, "Provider key could not be cleared."));
    }
  }

  async function loadDiagnostics(): Promise<void> {
    try {
      const diagnostics = await props.client.getDiagnostics();
      setDiagnosticText(
        diagnostics.mode === "off"
          ? "Diagnostics are off."
          : diagnostics.counts.length === 0
            ? "Counts-only diagnostics are enabled; no events are recorded yet."
            : diagnostics.counts.map((item) => `${item.code}: ${item.count}`).join(" · "),
      );
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized")
        props.onUnauthorized(error.message);
      else setDiagnosticText(message(error, "Diagnostic counts could not be loaded."));
    }
  }

  async function previewRetention(): Promise<void> {
    try {
      const preview = await props.client.getRetentionPreview();
      setRetentionText(
        preview.policy === "keep_until_deleted"
          ? "Current policy deletes nothing automatically."
          : `${preview.totalEligible} terminal Run${preview.totalEligible === 1 ? "" : "s"} eligible.`,
      );
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized")
        props.onUnauthorized(error.message);
      else setRetentionText(message(error, "Retention preview could not be loaded."));
    }
  }

  async function applyRetention(): Promise<void> {
    if (!window.confirm("Delete the eligible terminal Runs shown by the current retention policy?"))
      return;
    try {
      const result = await props.client.applyRetention();
      props.onRunsDeleted(result.deletedRunIds);
      setRetentionText(
        `${result.deletedRunIds.length} terminal Run${result.deletedRunIds.length === 1 ? "" : "s"} deleted.`,
      );
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized")
        props.onUnauthorized(error.message);
      else setRetentionText(message(error, "Retention cleanup failed."));
    }
  }

  async function deleteSelectedRun(): Promise<void> {
    const run = props.selectedRun;
    if (run === null) return;
    if (!window.confirm(runDeletionConfirmation(run))) return;
    try {
      const result = await props.client.deleteRun(run.runId);
      if (result.outcome === "deleted") {
        props.onRunsDeleted([run.runId]);
        setStatusMessage(`Run ${run.runNumber} deleted locally.`);
      } else if (result.outcome === "active_conflict") {
        setStatusMessage("Active Runs cannot be deleted.");
      } else {
        setStatusMessage("The selected Run no longer exists.");
      }
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized")
        props.onUnauthorized(error.message);
      else setStatusMessage(message(error, "Run deletion failed."));
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="settings-heading">
      <div className="section-heading">
        <p className="eyebrow">Local control</p>
        <h2 id="settings-heading">Settings and privacy</h2>
      </div>
      {response === null && status === "loading" ? <p>Loading settings…</p> : null}
      {response !== null ? (
        <>
          <form className="settings-form" onSubmit={save}>
            <fieldset>
              <legend>External AI</legend>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={externalAiEnabled}
                  onChange={(event) => setExternalAiEnabled(event.currentTarget.checked)}
                />
                Enable explicitly configured external AI
              </label>
              <label>
                Provider base URL
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.currentTarget.value)}
                  placeholder="https://provider.example.org/v1"
                />
              </label>
              <label>
                Model ID
                <input
                  value={modelId}
                  onChange={(event) => setModelId(event.currentTarget.value)}
                />
              </label>
              <label>
                Model revision
                <input
                  value={modelRevision}
                  onChange={(event) => setModelRevision(event.currentTarget.value)}
                />
              </label>
              <p>
                Provider key status: <strong>{response.providerSecretStatus}</strong>. Keys are held
                only in daemon memory.
              </p>
            </fieldset>
            <fieldset>
              <legend>Retention</legend>
              <label>
                Policy
                <select
                  value={retentionPolicy}
                  onChange={(event) =>
                    setRetentionPolicy(event.currentTarget.value as LocalRetentionPolicy)
                  }
                >
                  <option value="keep_until_deleted">Keep until deleted</option>
                  <option value="delete_terminal_after_7_days">
                    Delete terminal Runs after 7 days
                  </option>
                  <option value="delete_terminal_after_30_days">
                    Delete terminal Runs after 30 days
                  </option>
                  <option value="delete_terminal_after_90_days">
                    Delete terminal Runs after 90 days
                  </option>
                </select>
              </label>
              <p>No cleanup runs in the background. Preview and apply are explicit actions.</p>
            </fieldset>
            <fieldset>
              <legend>Diagnostics</legend>
              <label>
                Mode
                <select
                  value={diagnosticMode}
                  onChange={(event) =>
                    setDiagnosticMode(event.currentTarget.value as LocalDiagnosticMode)
                  }
                >
                  <option value="off">Off</option>
                  <option value="counts_only">Counts only</option>
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>Secret-field patterns</legend>
              <label>
                One canonical field-name pattern per line
                <textarea
                  value={patterns}
                  onChange={(event) => setPatterns(event.currentTarget.value)}
                  rows={5}
                />
              </label>
              <p>Use exact names, prefix*, or *suffix. Never enter an actual credential value.</p>
            </fieldset>
            <fieldset>
              <legend>Raw source payloads</legend>
              <p>
                <strong>Off.</strong> OwnLoop does not add optional raw source-hook diagnostic
                retention in v1.
              </p>
            </fieldset>
            <button className="button primary" type="submit" disabled={status === "saving"}>
              Save settings
            </button>
          </form>
          <form className="settings-secret-form" onSubmit={loadSecret}>
            <label htmlFor="provider-secret">Provider API key</label>
            <input
              ref={secretRef}
              id="provider-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button secondary" type="submit">
              Load key into memory
            </button>
            <button className="button ghost" type="button" onClick={() => void clearSecret()}>
              Clear memory key
            </button>
          </form>
          <div className="settings-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => void loadDiagnostics()}
            >
              Refresh diagnostic counts
            </button>
            <p>{diagnosticText}</p>
            <button
              className="button secondary"
              type="button"
              onClick={() => void previewRetention()}
            >
              Preview retention
            </button>
            <button className="button danger" type="button" onClick={() => void applyRetention()}>
              Apply retention now
            </button>
            <p>{retentionText}</p>
            <button
              className="button danger"
              type="button"
              disabled={!canDeleteRun(props.selectedRun)}
              onClick={() => void deleteSelectedRun()}
            >
              Delete selected terminal Run
            </button>
          </div>
        </>
      ) : null}
      <p
        className={status === "error" ? "settings-status error" : "settings-status"}
        role="status"
        aria-live="polite"
      >
        {statusMessage}
      </p>
    </section>
  );
}
