export const ATTENTION_TRANSITION_DURATION_MS = 420;

export type AttentionTransitionReceipt = Readonly<{
  title: string;
  message: string;
  needsFollowUp: boolean;
  hasNext: boolean;
}>;

export function attentionTransitionDelay(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : ATTENTION_TRANSITION_DURATION_MS;
}

export function attentionTransitionReceipt(
  needsFollowUp: boolean,
  hasNext: boolean,
): AttentionTransitionReceipt {
  if (needsFollowUp) {
    return {
      title: "ثبت شد و برای پیگیری ماند",
      message: hasNext
        ? "این پاسخ بدون داوری درست یا غلط ثبت شد؛ Moment بعدی آماده است."
        : "این پاسخ در جمع‌بندی پیگیری‌ها می‌ماند؛ جلسه در حال بسته‌شدن است.",
      needsFollowUp,
      hasNext,
    };
  }

  return {
    title: "ثبت شد",
    message: hasNext
      ? "برای این Moment پیگیری بازی ثبت نشد؛ Moment بعدی آماده است."
      : "برای این Moment پیگیری بازی ثبت نشد؛ جلسه در حال بسته‌شدن است.",
    needsFollowUp,
    hasNext,
  };
}
