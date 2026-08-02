import type {
  CandidateValidationFactV1,
  MomentInteractionActionV1,
  OwnershipMomentProjectionItemV1,
  OwnershipMomentsProjectionV1,
  ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { type CSSProperties, type FormEvent, useMemo, useRef, useState } from "react";

import {
  createMomentInteractionId,
  createReplayApiClient,
  type ReplayApiClient,
  ReplayApiError,
} from "./api.js";
import "./attention.css";

type AttentionPhase =
  | "locked"
  | "loading"
  | "ready"
  | "saving"
  | "complete"
  | "empty"
  | "error";

type AttentionOption = Readonly<{
  value: string;
  label: string;
}>;

type AttentionRun = Readonly<{
  run: ReplayRunSummaryV1;
  projection: OwnershipMomentsProjectionV1;
}>;

const TYPE_LABELS = {
  change: "تغییر",
  decision: "تصمیم",
  risk: "ریسک",
  check: "سنجش",
} as const;

const TYPE_TITLES = {
  change: "یک تغییر مهم در پروژه ثبت شد",
  decision: "عامل یک تصمیم مهم گرفته است",
  risk: "این بخش به توجه تو نیاز دارد",
  check: "ببین شواهد را درست خوانده‌ای یا نه",
} as const;

const PERSIAN_TEXT_PATTERN = /[\u0600-\u06ff]/u;

function faNumber(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function faPercent(value: number): string {
  return `${faNumber(value)}٪`;
}

function humanStatus(status: string): string {
  switch (status) {
    case "Completed":
    case "completed":
      return "کامل شد";
    case "Partial":
    case "partial":
      return "ناقص ماند";
    case "Abandoned":
    case "abandoned":
      return "رها شد";
    case "Failed":
    case "failed":
      return "شکست خورد";
    case "passed":
      return "موفق بود";
    case "unknown":
      return "نامشخص است";
    case "observed_without_exit_code":
      return "بدون کد خروج مشاهده شد";
    default:
      return status.replaceAll("_", " ");
  }
}

export function factTextFa(fact: CandidateValidationFactV1): string {
  switch (fact.kind) {
    case "change_kind":
      return fact.value === "created"
        ? "یک فایل ایجاد شد"
        : fact.value === "modified"
          ? "یک فایل ویرایش شد"
          : fact.value === "deleted"
            ? "یک فایل حذف شد"
            : fact.value === "type_changed"
              ? "نوع یک فایل تغییر کرد"
              : "تغییری هنوز ادغام نشده است";
    case "classification_label":
      return `این تغییر در دستهٔ «${fact.value.replaceAll("_", " ")}» قرار گرفته است`;
    case "verification_status":
      return `بررسی ${fact.verificationKind.replaceAll("_", " ")} ${humanStatus(fact.observedStatus)}`;
    case "evidence_gap":
      return `یک شکاف شواهد ثبت شده است: ${fact.gapCode.replaceAll("_", " ")}`;
    case "decision_observed":
      return fact.eventType === "agent.plan_observed"
        ? "یک برنامهٔ عامل واقعاً مشاهده شده است"
        : "جمع‌بندی عامل واقعاً مشاهده شده است";
    case "terminal_status":
      return `وضعیت پایان اجرا: ${humanStatus(fact.value)}`;
    case "attribution":
      return fact.value === "run_relative"
        ? "تغییر نسبت به همین اجرای عامل سنجیده شده است"
        : fact.value === "observed_only"
          ? "این مورد فقط مشاهده شده و انتساب قطعی ندارد"
          : "انتساب این مورد در دسترس نیست";
    case "source_partial":
      return "منبع شواهد ناقص است و نتیجه باید با احتیاط خوانده شود";
  }
}

function titleForMoment(moment: OwnershipMomentProjectionItemV1): string {
  return PERSIAN_TEXT_PATTERN.test(moment.candidate.title)
    ? moment.candidate.title
    : TYPE_TITLES[moment.candidate.type];
}

function questionForMoment(moment: OwnershipMomentProjectionItemV1): string {
  switch (moment.candidate.type) {
    case "change":
      return "قبل از دیدن شواهد، این تغییر را چقدر مهم می‌دانی؟";
    case "decision":
      return "این تصمیم را تأیید می‌کنی یا نیاز به بازبینی دارد؟";
    case "risk":
      return "با این ریسک چه برخوردی باید کرد؟";
    case "check":
      return "کدام پاسخ با شواهد ثبت‌شده هماهنگ‌تر است؟";
  }
}

function fallbackChoiceLabel(choiceId: string): string {
  switch (choiceId) {
    case "confirm":
      return "با شواهد هماهنگ است";
    case "revise":
      return "نیاز به بازبینی دارد";
    case "supported":
      return "شواهد آن را پشتیبانی می‌کنند";
    case "review":
      return "باید دوباره بررسی شود";
    default:
      return "این گزینه را انتخاب می‌کنم";
  }
}

export function optionsForMoment(
  moment: OwnershipMomentProjectionItemV1,
): readonly AttentionOption[] {
  const interaction = moment.candidate.suggestedInteraction;
  switch (interaction.kind) {
    case "acknowledge":
      return [
        { value: "understood", label: "مهم است؛ می‌خواهم شواهد را ببینم" },
        { value: "later", label: "بعداً باید دقیق‌تر بررسی شود" },
        { value: "uncertain", label: "هنوز مطمئن نیستم" },
      ];
    case "decision_response":
      return [
        { value: "confirm", label: "این تصمیم قابل‌تأیید است" },
        { value: "revise", label: "این تصمیم نیاز به بازبینی دارد" },
        { value: "uncertain", label: "برای تصمیم‌گیری شواهد بیشتری لازم است" },
      ];
    case "risk_response":
      return [
        { value: "acknowledge", label: "ریسک را ثبت و پیگیری می‌کنم" },
        { value: "mitigate", label: "باید برای کاهش ریسک اقدام شود" },
        { value: "dismiss", label: "فعلاً این ریسک را کنار می‌گذارم" },
      ];
    case "check_answer":
      return interaction.choices.map((choice) => ({
        value: choice.id,
        label: PERSIAN_TEXT_PATTERN.test(choice.label)
          ? choice.label
          : fallbackChoiceLabel(choice.id),
      }));
  }
}

function actionForSelection(
  moment: OwnershipMomentProjectionItemV1,
  selection: string,
): MomentInteractionActionV1 {
  const interaction = moment.candidate.suggestedInteraction;
  switch (interaction.kind) {
    case "acknowledge":
      return { kind: "acknowledgement_set", value: selection === "understood" };
    case "decision_response":
      if (selection === "confirm" || selection === "revise" || selection === "uncertain") {
        return { kind: "decision_response_set", value: selection };
      }
      throw new ReplayApiError("rejected");
    case "risk_response":
      if (selection === "acknowledge" || selection === "mitigate" || selection === "dismiss") {
        return { kind: "risk_response_set", value: selection };
      }
      throw new ReplayApiError("rejected");
    case "check_answer":
      if (interaction.choices.some((choice) => choice.id === selection)) {
        return { kind: "check_answer_set", choiceId: selection };
      }
      throw new ReplayApiError("rejected");
  }
}

async function firstRunWithMoments(client: ReplayApiClient): Promise<AttentionRun | null> {
  const list = await client.listRuns();
  for (const run of list.runs.slice(0, 10)) {
    try {
      const projection = await client.getMoments(run.runId);
      if (
        projection.validationId !== null &&
        projection.outcome !== "not_available" &&
        projection.moments.length > 0
      ) {
        return { run, projection };
      }
    } catch (error) {
      if (error instanceof ReplayApiError && error.code === "unauthorized") throw error;
    }
  }
  return null;
}

export function AttentionApp() {
  const clientRef = useRef<ReplayApiClient | null>(null);
  const startedAtRef = useRef(Date.now());
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<AttentionPhase>("locked");
  const [message, setMessage] = useState("");
  const [activeRun, setActiveRun] = useState<AttentionRun | null>(null);
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [followUps, setFollowUps] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const moments = activeRun?.projection.moments ?? [];
  const current = moments[index] ?? null;
  const options = useMemo(() => (current === null ? [] : optionsForMoment(current)), [current]);
  const coverage = moments.length === 0 ? 0 : Math.round((completed / moments.length) * 100);
  const entryError = phase === "error" && activeRun === null;

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPhase("loading");
    setMessage("در حال پیدا کردن تازه‌ترین اجرای دارای لحظه‌های معتبر…");
    try {
      const client = createReplayApiClient(token);
      clientRef.current = client;
      setToken("");
      const result = await firstRunWithMoments(client);
      if (result === null) {
        setPhase("empty");
        setMessage("هنوز اجرای دارای لحظهٔ معتبر پیدا نشد.");
        return;
      }
      startedAtRef.current = Date.now();
      setActiveRun(result);
      setIndex(0);
      setSelection(null);
      setRevealed(false);
      setCompleted(0);
      setFollowUps(0);
      setPhase("ready");
      setMessage("");
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof ReplayApiError && error.code === "unauthorized"
          ? "توکن نصب پذیرفته نشد."
          : "اتصال به OwnLoop محلی ممکن نشد.",
      );
    }
  }

  function reveal(): void {
    if (selection === null || current === null) return;
    setRevealed(true);
  }

  async function recordAndContinue(): Promise<void> {
    const client = clientRef.current;
    const validationId = activeRun?.projection.validationId ?? null;
    if (
      client === null ||
      activeRun === null ||
      current === null ||
      selection === null ||
      validationId === null
    ) {
      return;
    }
    setPhase("saving");
    setMessage("در حال ثبت انتخاب روی همین دستگاه…");
    try {
      await client.recordMomentInteraction(activeRun.run.runId, current.displayId, {
        schemaVersion: 1,
        interactionId: createMomentInteractionId(),
        validationId,
        action: actionForSelection(current, selection),
      });
      const nextCompleted = completed + 1;
      setCompleted(nextCompleted);
      if (
        selection === "later" ||
        selection === "uncertain" ||
        selection === "revise" ||
        selection === "mitigate"
      ) {
        setFollowUps((value) => value + 1);
      }
      if (index >= moments.length - 1) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
        setPhase("complete");
        setMessage("");
        return;
      }
      setIndex((value) => value + 1);
      setSelection(null);
      setRevealed(false);
      setPhase("ready");
      setMessage("");
    } catch (error) {
      setPhase("error");
      setMessage(
        error instanceof ReplayApiError && error.code === "unauthorized"
          ? "توکن نصب منقضی یا رد شد."
          : "تعامل ذخیره نشد؛ می‌توانی دوباره تلاش کنی.",
      );
    }
  }

  function restart(): void {
    startedAtRef.current = Date.now();
    setIndex(0);
    setSelection(null);
    setRevealed(false);
    setCompleted(0);
    setFollowUps(0);
    setElapsedSeconds(0);
    setPhase(activeRun === null ? "locked" : "ready");
    setMessage("");
  }

  if (phase === "locked" || phase === "loading" || phase === "empty" || entryError) {
    return (
      <main className="attention-shell attention-entry" dir="rtl">
        <div className="attention-ambient" aria-hidden="true" />
        <section className="attention-entry-card">
          <div className="attention-mark" aria-hidden="true">
            O
          </div>
          <p className="attention-kicker">OwnLoop · حلقهٔ مالکیت انسانی</p>
          <h1>عامل کد می‌نویسد؛ تو فهم پروژه را نگه می‌داری.</h1>
          <p className="attention-entry-copy">
            چند لحظهٔ کوتاه، واقعی و مبتنی بر شواهد؛ بدون گزارش طولانی و بدون پیمایش بی‌پایان.
          </p>
          {phase === "loading" ? (
            <div className="attention-loader" role="status">
              <span />
              <span />
              <span />
              <p>{message}</p>
            </div>
          ) : (
            <form className="attention-token-form" onSubmit={connect}>
              <label htmlFor="attention-token">توکن نصب محلی</label>
              <div>
                <input
                  id="attention-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  type="password"
                  autoComplete="off"
                  required
                  minLength={43}
                  placeholder="توکن فقط در حافظهٔ همین صفحه می‌ماند"
                />
                <button type="submit">شروع حلقه</button>
              </div>
            </form>
          )}
          {phase === "empty" || entryError ? <p className="attention-notice">{message}</p> : null}
          <small>محلی · بدون تله‌متری · پایان‌دار</small>
        </section>
      </main>
    );
  }

  if (phase === "complete") {
    return (
      <main className="attention-shell attention-complete" dir="rtl">
        <div className="attention-ambient" aria-hidden="true" />
        <section className="attention-summary-card">
          <div
            className="attention-completion-ring"
            style={{ "--coverage": `${coverage}%` } as CSSProperties}
          >
            <strong>{faPercent(coverage)}</strong>
            <span>مرور شده</span>
          </div>
          <p className="attention-kicker">حلقه بسته شد</p>
          <h1>مهم‌ترین لحظه‌های این اجرا را دیدی.</h1>
          <p>
            این عدد فقط میزان مرور ثبت‌شده را نشان می‌دهد؛ نه اثبات فهم کامل، صحت کد یا مالکیت حقوقی.
          </p>
          <div className="attention-summary-grid">
            <div>
              <strong>{faNumber(completed)}</strong>
              <span>لحظهٔ مرورشده</span>
            </div>
            <div>
              <strong>{faNumber(followUps)}</strong>
              <span>مورد نیازمند پیگیری</span>
            </div>
            <div>
              <strong>{faNumber(elapsedSeconds)}</strong>
              <span>ثانیه تا پایان</span>
            </div>
          </div>
          <div className="attention-summary-actions">
            <button type="button" className="attention-primary" onClick={restart}>
              مرور دوباره
            </button>
            <a href={`/?run=${encodeURIComponent(activeRun?.run.runId ?? "")}`}>
              نمای فنی و شواهد کامل
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (current === null || activeRun === null) {
    return null;
  }

  return (
    <main
      className={`attention-shell attention-flow attention-type-${current.candidate.type}`}
      dir="rtl"
    >
      <div className="attention-ambient" aria-hidden="true" />
      <header className="attention-topbar">
        <a className="attention-brand" href="/?view=attention" aria-label="شروع دوبارهٔ OwnLoop">
          <span>O</span>
          <strong>OwnLoop</strong>
        </a>
        <div className="attention-run-state">
          <i aria-hidden="true" />
          اجرای {faNumber(activeRun.run.runNumber)}
        </div>
        <a
          className="attention-technical-link"
          href={`/?run=${encodeURIComponent(activeRun.run.runId)}`}
        >
          نمای فنی
        </a>
      </header>

      <section className="attention-stage" aria-live="polite">
        <div className="attention-progress" aria-label="پیشرفت مرور">
          <div>
            <span>{faNumber(index + 1)}</span>
            <small>از {faNumber(moments.length)}</small>
          </div>
          <div className="attention-progress-track">
            <i
              style={{
                width: `${Math.round(((index + (revealed ? 0.65 : 0)) / moments.length) * 100)}%`,
              }}
            />
          </div>
          <strong>{faPercent(coverage)}</strong>
        </div>

        <article className={revealed ? "attention-card is-revealed" : "attention-card"}>
          <div className="attention-card-glow" aria-hidden="true" />
          <div className="attention-card-meta">
            <span>{TYPE_LABELS[current.candidate.type]}</span>
            <small>پیشنهاد هوش مصنوعی · تأییدشده با شواهد قطعی</small>
          </div>
          <h1>{titleForMoment(current)}</h1>
          <p className="attention-question">{questionForMoment(current)}</p>

          <div className="attention-options" role="group" aria-label="انتخاب شما">
            {options.map((option, optionIndex) => (
              <button
                key={option.value}
                type="button"
                className={selection === option.value ? "is-selected" : ""}
                disabled={revealed || phase === "saving"}
                onClick={() => setSelection(option.value)}
              >
                <span>{faNumber(optionIndex + 1)}</span>
                <strong>{option.label}</strong>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>

          {!revealed ? (
            <button
              type="button"
              className="attention-primary attention-reveal-button"
              disabled={selection === null}
              onClick={reveal}
            >
              آشکارکردن شواهد
            </button>
          ) : (
            <section className="attention-evidence">
              <div className="attention-evidence-heading">
                <span>آنچه واقعاً ثبت شده</span>
                <small>{faNumber(current.facts.length)} واقعیت قطعی</small>
              </div>
              {current.facts.length === 0 ? (
                <p>خلاصهٔ کنترل‌شده‌ای برای این لحظه در دسترس نیست.</p>
              ) : (
                <ul>
                  {current.facts.map((fact, factIndex) => (
                    <li key={`${fact.kind}-${factIndex}`}>
                      <i aria-hidden="true">✓</i>
                      <span>{factTextFa(fact)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="attention-boundary-note">
                متن مدل فقط قاب‌بندی این لحظه است؛ گیت، آزمون‌ها و گراف شواهد مرجع حقیقت‌اند.
              </p>
              <button
                type="button"
                className="attention-primary"
                disabled={phase === "saving"}
                onClick={() => void recordAndContinue()}
              >
                {phase === "saving"
                  ? "در حال ثبت…"
                  : index >= moments.length - 1
                    ? "بستن حلقه"
                    : "ثبت و رفتن به لحظهٔ بعد"}
              </button>
            </section>
          )}
        </article>

        {phase === "error" ? (
          <div className="attention-error" role="alert">
            <p>{message}</p>
            <button type="button" onClick={() => setPhase("ready")}>
              تلاش دوباره
            </button>
          </div>
        ) : null}
      </section>

      <footer className="attention-footer">
        <span>جلسهٔ محدود · بدون پیمایش بی‌پایان</span>
        <span>کلید API و توکن در مرورگر ذخیره نمی‌شوند</span>
      </footer>
    </main>
  );
}
