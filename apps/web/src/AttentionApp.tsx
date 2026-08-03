import type {
  CandidateValidationFactV1,
  MomentInteractionActionV1,
  OwnershipMomentProjectionItemV1,
  OwnershipMomentsProjectionV1,
  ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  createMomentInteractionId,
  createReplayApiClient,
  type ReplayApiClient,
  ReplayApiError,
} from "./api.js";
import { AttentionFollowUpSummary } from "./AttentionFollowUpSummary.js";
import {
  attentionKeyboardAction,
  type AttentionKeyboardAction,
  type AttentionKeyboardPhase,
} from "./attention-keyboard.js";
import { attentionRevealFeedback } from "./attention-reveal.js";
import {
  buildAttentionResumePlan,
  nextUnreviewedMomentIndex,
  selectionNeedsFollowUp,
  updateFollowUpMomentIds,
} from "./attention-resume.js";
import { buildAttentionSessionPlan, type AttentionSessionPlan } from "./attention-session.js";
import {
  attentionTransitionDelay,
  attentionTransitionReceipt,
  type AttentionTransitionReceipt,
} from "./attention-transition.js";
import "./attention.css";
import "./attention-empty.css";
import "./attention-keyboard.css";

type AttentionPhase = AttentionKeyboardPhase;

type AttentionOption = Readonly<{
  value: string;
  label: string;
}>;

type AttentionRun = Readonly<{
  run: ReplayRunSummaryV1;
  projection: OwnershipMomentsProjectionV1;
}>;

export type AttentionEmptyState = Readonly<{
  kind: "configure_avalai" | "await_run";
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
}>;

type AttentionKeyboardContext = Readonly<{
  phase: AttentionPhase;
  revealed: boolean;
  selectionPresent: boolean;
  optionCount: number;
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

export function attentionEmptyState(providerConfigured: boolean): AttentionEmptyState {
  return providerConfigured
    ? {
        kind: "await_run",
        title: "مغز آماده است؛ یک اجرای واقعی لازم داریم.",
        message:
          "AvalAI تنظیم شده، اما هنوز Run دارای Moment معتبر پیدا نشد. یک کار واقعی عامل را اجرا کن تا شواهد و Candidateها ساخته شوند.",
        actionLabel: "رفتن به نمای فنی",
        actionHref: "/",
      }
    : {
        kind: "configure_avalai",
        title: "اول مغز لحظه‌ها را آماده کن.",
        message:
          "هنوز ارائه‌دهندهٔ LLM کامل تنظیم نشده است. دامنه، مدل و کلید حافظه‌ای AvalAI را ثبت کن؛ حقیقت همچنان از Git و Evidence می‌آید.",
        actionLabel: "تنظیم AvalAI",
        actionHref: "/?view=avalai",
      };
}

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

function factIdentity(fact: CandidateValidationFactV1): string {
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
  const submissionRef = useRef(false);
  const keyboardContextRef = useRef<AttentionKeyboardContext>({
    phase: "locked",
    revealed: false,
    selectionPresent: false,
    optionCount: 0,
  });
  const keyboardActionRef = useRef<(action: AttentionKeyboardAction) => void>(() => undefined);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<AttentionPhase>("locked");
  const [message, setMessage] = useState("");
  const [emptyState, setEmptyState] = useState<AttentionEmptyState | null>(null);
  const [activeRun, setActiveRun] = useState<AttentionRun | null>(null);
  const [sessionPlan, setSessionPlan] = useState<AttentionSessionPlan | null>(null);
  const [transitionReceipt, setTransitionReceipt] = useState<AttentionTransitionReceipt | null>(
    null,
  );
  const [reviewedMomentIds, setReviewedMomentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [followUpMomentIds, setFollowUpMomentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [followUps, setFollowUps] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const moments = sessionPlan?.moments ?? [];
  const current = moments[index] ?? null;
  const options = useMemo(() => (current === null ? [] : optionsForMoment(current)), [current]);
  const revealFeedback = useMemo(
    () => (current === null ? null : attentionRevealFeedback(current.facts)),
    [current],
  );
  const coverage =
    phase === "complete" && moments.length === 0 && activeRun !== null
      ? 100
      : moments.length === 0
        ? 0
        : Math.round((completed / moments.length) * 100);
  const entryError = phase === "error" && activeRun === null;

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    submissionRef.current = false;
    setPhase("loading");
    setMessage("در حال پیدا کردن تازه‌ترین اجرای دارای لحظه‌های معتبر…");
    setEmptyState(null);
    setSessionPlan(null);
    setTransitionReceipt(null);
    setReviewedMomentIds(new Set());
    setFollowUpMomentIds(new Set());
    setFollowUps(0);
    try {
      const client = createReplayApiClient(token);
      clientRef.current = client;
      setToken("");
      const result = await firstRunWithMoments(client);
      if (result === null) {
        const settings = await client.getSettings();
        const nextEmptyState = attentionEmptyState(settings.providerGenerationConfigured);
        setEmptyState(nextEmptyState);
        setPhase("empty");
        setMessage(nextEmptyState.message);
        return;
      }

      const validationId = result.projection.validationId;
      if (validationId === null) throw new ReplayApiError("invalid_response");
      const interactionState = await client.getMomentInteractionState(
        result.run.runId,
        validationId,
      );
      const resumePlan = buildAttentionResumePlan(result.projection, interactionState);
      if (resumePlan.outcome === "stale") {
        clientRef.current = null;
        setPhase("error");
        setMessage(
          "وضعیت مرور ذخیره‌شده با نسخهٔ فعلی Momentها هماهنگ نیست؛ برای جلوگیری از ثبت تکراری، نمای فنی را بررسی کن.",
        );
        return;
      }

      const reviewedIds = new Set(resumePlan.reviewedMomentIds);
      const nextFollowUpIds = new Set(resumePlan.followUpMomentIds);
      const nextSessionPlan = buildAttentionSessionPlan(result.projection.moments, reviewedIds);
      setActiveRun(result);
      setSessionPlan(nextSessionPlan);
      setReviewedMomentIds(reviewedIds);
      setFollowUpMomentIds(nextFollowUpIds);
      setIndex(0);
      setSelection(null);
      setRevealed(false);
      setFollowUps(nextFollowUpIds.size);
      setElapsedSeconds(0);
      setEmptyState(null);
      setMessage("");

      if (resumePlan.outcome === "complete") {
        setCompleted(resumePlan.completedCount);
        setPhase("complete");
        return;
      }
      setCompleted(0);
      setPhase("preview");
    } catch (error) {
      setEmptyState(null);
      setSessionPlan(null);
      setTransitionReceipt(null);
      setPhase("error");
      setMessage(
        error instanceof ReplayApiError && error.code === "unauthorized"
          ? "توکن نصب پذیرفته نشد."
          : "اتصال به OwnLoop محلی ممکن نشد.",
      );
    }
  }

  function startSession(): void {
    if (sessionPlan === null || sessionPlan.totalCount === 0) return;
    submissionRef.current = false;
    startedAtRef.current = Date.now();
    setIndex(0);
    setSelection(null);
    setRevealed(false);
    setCompleted(0);
    setElapsedSeconds(0);
    setTransitionReceipt(null);
    setPhase("ready");
  }

  function reveal(): void {
    if (selection === null || current === null) return;
    setRevealed(true);
  }

  async function recordAndContinue(): Promise<void> {
    const client = clientRef.current;
    const validationId = activeRun?.projection.validationId ?? null;
    if (
      submissionRef.current ||
      client === null ||
      activeRun === null ||
      current === null ||
      selection === null ||
      validationId === null ||
      reviewedMomentIds.has(current.displayId)
    ) {
      return;
    }
    submissionRef.current = true;
    setPhase("saving");
    setMessage("در حال ثبت انتخاب روی همین دستگاه…");
    try {
      await client.recordMomentInteraction(activeRun.run.runId, current.displayId, {
        schemaVersion: 1,
        interactionId: createMomentInteractionId(),
        validationId,
        action: actionForSelection(current, selection),
      });
      const needsFollowUp = selectionNeedsFollowUp(selection);
      const nextReviewedIds = new Set(reviewedMomentIds);
      nextReviewedIds.add(current.displayId);
      const nextFollowUpIds = updateFollowUpMomentIds(
        followUpMomentIds,
        current.displayId,
        needsFollowUp,
      );
      const nextIndex = nextUnreviewedMomentIndex(moments, nextReviewedIds, index);
      const receipt = attentionTransitionReceipt(needsFollowUp, nextIndex !== null);

      setReviewedMomentIds(nextReviewedIds);
      setFollowUpMomentIds(nextFollowUpIds);
      setCompleted((value) => value + 1);
      setFollowUps(nextFollowUpIds.size);
      setTransitionReceipt(receipt);
      setPhase("transition");
      setMessage("");

      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const delayMs = attentionTransitionDelay(reducedMotion);
      if (delayMs > 0) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      }

      setTransitionReceipt(null);
      submissionRef.current = false;
      if (nextIndex === null) {
        setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
        setPhase("complete");
        return;
      }
      setIndex(nextIndex);
      setSelection(null);
      setRevealed(false);
      setPhase("ready");
    } catch (error) {
      submissionRef.current = false;
      setTransitionReceipt(null);
      setPhase("error");
      setMessage(
        error instanceof ReplayApiError && error.code === "unauthorized"
          ? "توکن نصب منقضی یا رد شد."
          : "تعامل ذخیره نشد؛ می‌توانی دوباره تلاش کنی.",
      );
    }
  }

  keyboardContextRef.current = {
    phase,
    revealed,
    selectionPresent: selection !== null,
    optionCount: options.length,
  };
  keyboardActionRef.current = (action) => {
    if (action.kind === "select") {
      const option = options[action.optionIndex];
      if (option !== undefined) setSelection(option.value);
      return;
    }
    if (action.kind === "reveal") {
      reveal();
      return;
    }
    void recordAndContinue();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = attentionKeyboardAction({
        ...keyboardContextRef.current,
        key: event.key,
        targetTagName: target?.tagName ?? null,
        targetEditable: target?.isContentEditable ?? false,
      });
      if (action === null) return;
      event.preventDefault();
      keyboardActionRef.current(action);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
          ) : phase === "empty" && emptyState !== null ? (
            <section className="attention-empty-state" aria-labelledby="attention-empty-title">
              <span aria-hidden="true">{emptyState.kind === "configure_avalai" ? "✦" : "↗"}</span>
              <div>
                <h2 id="attention-empty-title">{emptyState.title}</h2>
                <p>{message}</p>
              </div>
              <a href={emptyState.actionHref}>{emptyState.actionLabel}</a>
            </section>
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
                <button type="submit">آماده‌کردن جلسه</button>
              </div>
            </form>
          )}
          {entryError ? <p className="attention-notice">{message}</p> : null}
          <small>محلی · بدون تله‌متری · پایان‌دار</small>
        </section>
      </main>
    );
  }

  if (phase === "preview" && activeRun !== null && sessionPlan !== null) {
    return (
      <main className="attention-shell attention-complete" dir="rtl">
        <div className="attention-ambient" aria-hidden="true" />
        <section className="attention-summary-card">
          <p className="attention-kicker">جلسه آماده است</p>
          <h1>یک مرور کوتاه و پایان‌دار پیش رو داری.</h1>
          <p>
            ترتیب این جلسه همان رتبه‌بندی validator است. هیچ Moment تازه‌ای ساخته یا جایگزین نشده است.
          </p>
          <div className="attention-summary-grid">
            <div>
              <strong>{faNumber(sessionPlan.totalCount)}</strong>
              <span>Moment مرور‌نشده</span>
            </div>
            <div>
              <strong>{faNumber(sessionPlan.estimatedSeconds)}</strong>
              <span>ثانیهٔ تقریبی</span>
            </div>
            <div>
              <strong>{faNumber(activeRun.run.runNumber)}</strong>
              <span>شمارهٔ اجرای عامل</span>
            </div>
          </div>
          {sessionPlan.truncated ? (
            <p className="attention-boundary-note">
              این جلسه به سقف هفت Moment محدود شده است؛ موارد بعدی در جلسهٔ بعد باقی می‌مانند.
            </p>
          ) : null}
          <div className="attention-summary-actions">
            <button type="button" className="attention-primary" onClick={startSession}>
              شروع جلسه
            </button>
            <a href={`/?run=${encodeURIComponent(activeRun.run.runId)}`}>دیدن نمای فنی</a>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "transition" && transitionReceipt !== null) {
    return (
      <main className="attention-shell attention-complete" dir="rtl">
        <div className="attention-ambient" aria-hidden="true" />
        <section
          className={
            transitionReceipt.needsFollowUp
              ? "attention-transition-card is-follow-up"
              : "attention-transition-card"
          }
          role="status"
          aria-live="polite"
        >
          <div className="attention-transition-mark" aria-hidden="true">
            {transitionReceipt.needsFollowUp ? "!" : "✓"}
          </div>
          <h1>{transitionReceipt.title}</h1>
          <p>{transitionReceipt.message}</p>
          <div className="attention-transition-pulse" aria-hidden="true" />
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
          <h1>مهم‌ترین لحظه‌های این جلسه را دیدی.</h1>
          <p>
            این عدد فقط میزان مرور ثبت‌شده را نشان می‌دهد؛ نه اثبات فهم کامل، صحت کد یا مالکیت حقوقی.
          </p>
          <div className="attention-summary-grid">
            <div>
              <strong>{faNumber(completed)}</strong>
              <span>Moment مرورشده در این جلسه</span>
            </div>
            <div>
              <strong>{faNumber(followUps)}</strong>
              <span>مورد نیازمند پیگیری</span>
            </div>
            <div>
              <strong>{elapsedSeconds === 0 ? "—" : faNumber(elapsedSeconds)}</strong>
              <span>{elapsedSeconds === 0 ? "زمان این مرور ثبت نشده" : "ثانیه تا پایان"}</span>
            </div>
          </div>
          {activeRun !== null ? (
            <AttentionFollowUpSummary
              moments={activeRun.projection.moments}
              followUpMomentIds={followUpMomentIds}
              runId={activeRun.run.runId}
            />
          ) : null}
          <div className="attention-summary-actions">
            <button
              type="button"
              className="attention-primary"
              onClick={() => window.location.reload()}
            >
              بررسی جلسهٔ بعدی
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
        <div
          className="attention-progress"
          role="progressbar"
          aria-label="پیشرفت همین جلسه"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coverage}
        >
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
          <p className="attention-keyboard-hint" aria-hidden="true">
            <kbd>۱–۳</kbd>
            انتخاب
            <span>·</span>
            <kbd>Enter</kbd>
            {revealed ? "ادامه" : "آشکارسازی"}
          </p>

          <fieldset
            className="attention-options"
            aria-label="انتخاب شما"
            style={{ border: 0, padding: 0, minInlineSize: 0 }}
          >
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
          </fieldset>

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
              {revealFeedback !== null ? (
                <div
                  className={`attention-reveal-feedback is-${revealFeedback.tone}`}
                  role="status"
                >
                  <i aria-hidden="true">
                    {revealFeedback.tone === "confirmed"
                      ? "✓"
                      : revealFeedback.tone === "caution"
                        ? "!"
                        : "؟"}
                  </i>
                  <div>
                    <strong>{revealFeedback.title}</strong>
                    <p>{revealFeedback.message}</p>
                  </div>
                </div>
              ) : null}
              <div className="attention-evidence-heading">
                <span>آنچه واقعاً ثبت شده</span>
                <small>{faNumber(current.facts.length)} واقعیت قطعی</small>
              </div>
              {current.facts.length === 0 ? (
                <p>خلاصهٔ کنترل‌شده‌ای برای این لحظه در دسترس نیست.</p>
              ) : (
                <ul>
                  {current.facts.map((fact) => (
                    <li key={factIdentity(fact)}>
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
                  : nextUnreviewedMomentIndex(moments, reviewedMomentIds, index) === null
                    ? "بستن حلقه"
                    : "ثبت و رفتن به Moment بعد"}
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
