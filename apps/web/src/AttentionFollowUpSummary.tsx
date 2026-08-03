import type { OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";

import { followUpMomentsForSummary } from "./attention-resume.js";
import "./attention-followup.css";

const TYPE_TITLES = {
  change: "تغییر مهم نیازمند بازبینی",
  decision: "تصمیم نیازمند پیگیری",
  risk: "ریسک نیازمند اقدام",
  check: "سنجش نیازمند بررسی",
} as const;

const PERSIAN_TEXT_PATTERN = /[\u0600-\u06ff]/u;

function followUpTitle(moment: OwnershipMomentProjectionItemV1): string {
  return PERSIAN_TEXT_PATTERN.test(moment.candidate.title)
    ? moment.candidate.title
    : TYPE_TITLES[moment.candidate.type];
}

export type AttentionFollowUpSummaryProps = Readonly<{
  moments: readonly OwnershipMomentProjectionItemV1[];
  followUpMomentIds: ReadonlySet<string>;
  runId: string;
}>;

export function AttentionFollowUpSummary({
  moments,
  followUpMomentIds,
  runId,
}: AttentionFollowUpSummaryProps) {
  const visibleMoments = followUpMomentsForSummary(moments, followUpMomentIds);
  if (visibleMoments.length === 0) return null;

  const remainingCount = Math.max(0, followUpMomentIds.size - visibleMoments.length);

  return (
    <section className="attention-followups" aria-labelledby="attention-followups-title">
      <header>
        <h2 id="attention-followups-title">برای پیگیری بعدی نگه دار</h2>
        <span>{followUpMomentIds.size.toLocaleString("fa-IR")} مورد</span>
      </header>
      <ul>
        {visibleMoments.map((moment) => (
          <li key={moment.displayId}>
            <i aria-hidden="true">!</i>
            <span>{followUpTitle(moment)}</span>
          </li>
        ))}
      </ul>
      <footer>
        <span>
          {remainingCount > 0
            ? `${remainingCount.toLocaleString("fa-IR")} مورد دیگر در نمای فنی موجود است.`
            : "این فهرست فقط مواردی را نشان می‌دهد که خودت نیازمند پیگیری ثبت کرده‌ای."}
        </span>
        <a href={`/?run=${encodeURIComponent(runId)}`}>شواهد همین اجرا</a>
      </footer>
    </section>
  );
}
