import type {
  LocalSettingsResponseV1,
  LocalSettingsUpdateRequestV1,
} from "@ownloop/contracts";
import { type FormEvent, useRef, useState } from "react";

import {
  createReplayApiClient,
  type ReplayApiClient,
  ReplayApiError,
} from "./api.js";
import "./avalai-setup.css";

export const AVALAI_BASE_URLS = {
  iran: "https://api.avalai.ir/v1",
  global: "https://api.avalai.org/v1",
} as const;

export type AvalAiRegion = keyof typeof AVALAI_BASE_URLS;

type SetupPhase = "ready" | "saving" | "success" | "error";
type EntryPhase = "locked" | "loading" | "ready" | "error";

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export function avalAiRegionFromSettings(response: LocalSettingsResponseV1): AvalAiRegion {
  return response.settings.provider?.baseUrl === AVALAI_BASE_URLS.global ? "global" : "iran";
}

export function buildAvalAiSettingsUpdate(
  response: LocalSettingsResponseV1,
  region: AvalAiRegion,
  modelIdInput: string,
): LocalSettingsUpdateRequestV1 {
  const modelId = modelIdInput.trim();
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new Error("invalid_model_id");
  }

  const currentProvider = response.settings.provider;
  const baseUrl = AVALAI_BASE_URLS[region];
  const sameModel =
    currentProvider?.baseUrl === baseUrl && currentProvider.modelId === modelId;

  return {
    schemaVersion: 1,
    expectedRevision: response.settings.revision,
    replacement: {
      schemaVersion: 1,
      externalAiEnabled: true,
      provider: {
        providerFamily: "responses_json_v1",
        baseUrl,
        modelId,
        modelRevision: sameModel ? currentProvider.modelRevision : null,
        timeoutMs: currentProvider?.timeoutMs ?? 30_000,
        maxResponseBytes: currentProvider?.maxResponseBytes ?? 256 * 1024,
        retryPolicy:
          currentProvider?.retryPolicy ??
          ({ maxAttempts: 2, baseDelayMs: 250, maxRetryAfterMs: 5_000 } as const),
      },
      retentionPolicy: response.settings.retentionPolicy,
      diagnosticMode: response.settings.diagnosticMode,
      rawSourcePayloadRetention: "off",
      customSecretFieldPatterns: response.settings.customSecretFieldPatterns,
    },
  };
}

function setupMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message === "invalid_model_id") {
    return "شناسهٔ مدل معتبر نیست. فقط حروف انگلیسی، عدد و نشانه‌های . _ : / - مجازند.";
  }
  if (error instanceof ReplayApiError && error.code === "conflict") {
    return "تنظیمات هم‌زمان تغییر کرده‌اند. نسخهٔ تازه بارگذاری شد؛ دوباره ثبت کن.";
  }
  if (error instanceof ReplayApiError && error.code === "rejected") {
    return "کلید یا تنظیمات توسط OwnLoop پذیرفته نشد.";
  }
  return fallback;
}

export type AvalAiSetupPanelProps = Readonly<{
  client: ReplayApiClient;
  initialResponse: LocalSettingsResponseV1;
  onUnauthorized(): void;
}>;

export function AvalAiSetupPanel({
  client,
  initialResponse,
  onUnauthorized,
}: AvalAiSetupPanelProps) {
  const secretRef = useRef<HTMLInputElement>(null);
  const [response, setResponse] = useState(initialResponse);
  const [region, setRegion] = useState<AvalAiRegion>(() =>
    avalAiRegionFromSettings(initialResponse),
  );
  const [modelId, setModelId] = useState(initialResponse.settings.provider?.modelId ?? "");
  const [phase, setPhase] = useState<SetupPhase>("ready");
  const [message, setMessage] = useState(
    initialResponse.providerGenerationConfigured
      ? "مغز AvalAI آمادهٔ تولید Candidate است."
      : "دامنه و مدل را انتخاب کن؛ کلید فقط در حافظهٔ daemon می‌ماند.",
  );

  function hydrate(next: LocalSettingsResponseV1): void {
    setResponse(next);
    setRegion(avalAiRegionFromSettings(next));
    setModelId(next.settings.provider?.modelId ?? "");
  }

  async function reloadAfterConflict(): Promise<void> {
    try {
      hydrate(await client.getSettings());
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        onUnauthorized();
      }
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const secretInput = secretRef.current;
    const apiKey = secretInput?.value ?? "";
    if (secretInput !== null) secretInput.value = "";

    if (response.providerSecretStatus === "absent" && apiKey.length === 0) {
      setPhase("error");
      setMessage("برای فعال‌شدن AvalAI باید کلید را وارد کنی.");
      return;
    }

    setPhase("saving");
    setMessage("در حال ثبت تنظیمات محلی و بارگذاری کلید در حافظه…");

    try {
      const request = buildAvalAiSettingsUpdate(response, region, modelId);
      if (apiKey.length > 0) {
        await client.loadProviderSecret(apiKey);
      }
      const next = await client.updateSettings(request);
      hydrate(next);
      setPhase(next.providerGenerationConfigured ? "success" : "ready");
      setMessage(
        next.providerGenerationConfigured
          ? "AvalAI فعال شد؛ مدل اکنون می‌تواند Candidate پیشنهاد دهد."
          : "تنظیمات ثبت شد، اما کلید فعال در حافظه وجود ندارد.",
      );
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (error instanceof ReplayApiError && error.code === "conflict") {
        await reloadAfterConflict();
      }
      setPhase("error");
      setMessage(setupMessage(error, "تنظیم AvalAI کامل نشد؛ بدون افشای کلید دوباره تلاش کن."));
    }
  }

  async function clearSecret(): Promise<void> {
    setPhase("saving");
    setMessage("در حال پاک‌کردن کلید از حافظهٔ daemon…");
    try {
      await client.clearProviderSecret();
      const next = await client.getSettings();
      hydrate(next);
      setPhase("ready");
      setMessage("کلید از حافظه پاک شد؛ تنظیمات عمومی مدل حفظ شدند.");
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") {
        onUnauthorized();
        return;
      }
      setPhase("error");
      setMessage("پاک‌کردن کلید از حافظه ممکن نشد.");
    }
  }

  const configured = response.providerGenerationConfigured;

  return (
    <section className="avalai-panel" aria-labelledby="avalai-panel-title">
      <div className="avalai-panel-head">
        <div>
          <p className="avalai-eyebrow">AvalAI · مغز لحظه‌ها</p>
          <h2 id="avalai-panel-title">سه انتخاب؛ بدون تنظیمات شلوغ</h2>
        </div>
        <span className={configured ? "avalai-status is-ready" : "avalai-status"}>
          <i aria-hidden="true" />
          {configured ? "آماده" : "نیازمند تنظیم"}
        </span>
      </div>

      <form className="avalai-form" onSubmit={(event) => void save(event)}>
        <fieldset className="avalai-region-fieldset">
          <legend>۱. مسیر اتصال</legend>
          <div className="avalai-region-options">
            <label className={region === "iran" ? "is-selected" : ""}>
              <input
                type="radio"
                name="avalai-region"
                value="iran"
                checked={region === "iran"}
                onChange={() => setRegion("iran")}
              />
              <span>
                <strong>داخل ایران</strong>
                <small>api.avalai.ir</small>
              </span>
              <i aria-hidden="true" />
            </label>
            <label className={region === "global" ? "is-selected" : ""}>
              <input
                type="radio"
                name="avalai-region"
                value="global"
                checked={region === "global"}
                onChange={() => setRegion("global")}
              />
              <span>
                <strong>مسیر جهانی</strong>
                <small>api.avalai.org</small>
              </span>
              <i aria-hidden="true" />
            </label>
          </div>
        </fieldset>

        <label className="avalai-input-label" htmlFor="avalai-model-id">
          <span>۲. شناسهٔ مدل</span>
          <input
            id="avalai-model-id"
            value={modelId}
            onChange={(event) => setModelId(event.currentTarget.value)}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={256}
            pattern="[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}"
            placeholder="شناسهٔ مدل در حساب AvalAI"
          />
        </label>

        <label className="avalai-input-label" htmlFor="avalai-api-key">
          <span>۳. کلید API</span>
          <input
            ref={secretRef}
            id="avalai-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              response.providerSecretStatus === "loaded"
                ? "کلید در حافظه موجود است؛ برای تعویض، کلید تازه را وارد کن"
                : "کلید فقط در حافظهٔ daemon نگهداری می‌شود"
            }
          />
        </label>

        <div className="avalai-form-actions">
          <button className="avalai-primary" type="submit" disabled={phase === "saving"}>
            {phase === "saving" ? "در حال ثبت…" : "فعال‌کردن مغز AvalAI"}
          </button>
          {response.providerSecretStatus === "loaded" ? (
            <button
              className="avalai-secondary"
              type="button"
              disabled={phase === "saving"}
              onClick={() => void clearSecret()}
            >
              پاک‌کردن کلید از حافظه
            </button>
          ) : null}
        </div>
      </form>

      <p
        className={phase === "error" ? "avalai-message is-error" : "avalai-message"}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>

      <div className="avalai-boundaries" aria-label="مرزهای اعتماد">
        <div>
          <span>LLM</span>
          <strong>فقط پیشنهاد</strong>
        </div>
        <div>
          <span>Validator</span>
          <strong>کنترل ادعا</strong>
        </div>
        <div>
          <span>Git + Evidence</span>
          <strong>مرجع حقیقت</strong>
        </div>
      </div>

      <p className="avalai-privacy-note">
        کلید در SQLite، فایل تنظیمات، URL، log، diagnostics یا browser storage نوشته نمی‌شود و با
        راه‌اندازی دوبارهٔ daemon از بین می‌رود.
      </p>
    </section>
  );
}

export function AvalAiSetupApp() {
  const [token, setToken] = useState("");
  const [client, setClient] = useState<ReplayApiClient | null>(null);
  const [response, setResponse] = useState<LocalSettingsResponseV1 | null>(null);
  const [phase, setPhase] = useState<EntryPhase>("locked");
  const [message, setMessage] = useState("");

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPhase("loading");
    setMessage("در حال اتصال امن به daemon محلی…");
    try {
      const nextClient = createReplayApiClient(token);
      setToken("");
      const nextResponse = await nextClient.getSettings();
      setClient(nextClient);
      setResponse(nextResponse);
      setPhase("ready");
      setMessage("");
    } catch (error) {
      setClient(null);
      setResponse(null);
      setPhase("error");
      setMessage(
        error instanceof ReplayApiError && error.code === "unauthorized"
          ? "توکن نصب پذیرفته نشد."
          : "اتصال به OwnLoop محلی ممکن نشد.",
      );
    }
  }

  function resetAuthorization(): void {
    setClient(null);
    setResponse(null);
    setPhase("error");
    setMessage("مجوز محلی منقضی یا رد شد؛ دوباره متصل شو.");
  }

  return (
    <main className="avalai-setup-shell" dir="rtl">
      <div className="avalai-ambient" aria-hidden="true" />
      <header className="avalai-topbar">
        <a href="/?view=attention" className="avalai-brand" aria-label="بازگشت به حلقهٔ مالکیت">
          <span>O</span>
          <strong>OwnLoop</strong>
        </a>
        <a href="/?view=attention" className="avalai-back-link">
          بازگشت به حلقه
        </a>
      </header>

      <section className="avalai-hero">
        <div className="avalai-hero-copy">
          <p className="avalai-eyebrow">تنظیم محلی · بدون ذخیرهٔ کلید</p>
          <h1>مغز لحظه‌ها را روشن کن؛ حقیقت را به شواهد بسپار.</h1>
          <p>
            AvalAI عنوان، سؤال و گزینه‌های فارسی را پیشنهاد می‌دهد. OwnLoop فقط Candidateهایی را
            نمایش می‌دهد که از validator و Evidence عبور کنند.
          </p>
        </div>

        {client !== null && response !== null ? (
          <AvalAiSetupPanel
            client={client}
            initialResponse={response}
            onUnauthorized={resetAuthorization}
          />
        ) : (
          <section className="avalai-auth-card" aria-labelledby="avalai-auth-title">
            <p className="avalai-eyebrow">اتصال به OwnLoop محلی</p>
            <h2 id="avalai-auth-title">توکن نصب را فقط در همین صفحه وارد کن</h2>
            {phase === "loading" ? (
              <div className="avalai-loading" role="status">
                <span />
                <span />
                <span />
                <p>{message}</p>
              </div>
            ) : (
              <form onSubmit={(event) => void connect(event)}>
                <label htmlFor="avalai-install-token">توکن نصب محلی</label>
                <input
                  id="avalai-install-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.currentTarget.value)}
                  autoComplete="off"
                  spellCheck={false}
                  minLength={43}
                  required
                  placeholder="توکن پس از اتصال از state پاک می‌شود"
                />
                <button className="avalai-primary" type="submit">
                  اتصال و خواندن تنظیمات
                </button>
              </form>
            )}
            {phase === "error" ? (
              <p className="avalai-message is-error" role="alert">
                {message}
              </p>
            ) : null}
          </section>
        )}
      </section>

      <footer className="avalai-footer">
        <span>Local-first</span>
        <span>کلید memory-only</span>
        <span>Evidence-first</span>
      </footer>
    </main>
  );
}
