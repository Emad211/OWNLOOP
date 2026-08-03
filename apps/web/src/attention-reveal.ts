import type { CandidateValidationFactV1 } from "@ownloop/contracts";

export type AttentionRevealTone = "confirmed" | "caution" | "unknown";

export type AttentionRevealFeedback = Readonly<{
  tone: AttentionRevealTone;
  title: string;
  message: string;
}>;

function isCautionFact(fact: CandidateValidationFactV1): boolean {
  switch (fact.kind) {
    case "source_partial":
    case "evidence_gap":
      return true;
    case "verification_status":
      return fact.observedStatus === "failed";
    case "terminal_status":
      return fact.value === "Failed" || fact.value === "Partial" || fact.value === "Abandoned";
    case "attribution":
      return fact.value === "unavailable";
    default:
      return false;
  }
}

function isUnknownFact(fact: CandidateValidationFactV1): boolean {
  switch (fact.kind) {
    case "verification_status":
      return fact.observedStatus === "unknown" || fact.observedStatus === "observed_without_exit_code";
    case "attribution":
      return fact.value === "observed_only";
    default:
      return false;
  }
}

export function attentionRevealFeedback(
  facts: readonly CandidateValidationFactV1[],
): AttentionRevealFeedback {
  if (facts.some(isCautionFact)) {
    return {
      tone: "caution",
      title: "شواهد نیاز به توجه دارند",
      message:
        "این وضعیت دربارهٔ انتخاب تو قضاوت نمی‌کند؛ فقط می‌گوید شکست، شکاف یا محدودیت قطعی در شواهد ثبت شده است.",
    };
  }

  if (facts.length === 0 || facts.some(isUnknownFact)) {
    return {
      tone: "unknown",
      title: "شواهد هنوز قطعی نیستند",
      message:
        "این وضعیت به معنی خطا یا موفقیت نیست؛ بخشی از نتیجه بدون کد خروج، انتساب قطعی یا fact کافی ثبت شده است.",
    };
  }

  return {
    tone: "confirmed",
    title: "شواهد مستقیم ثبت شده‌اند",
    message:
      "در facts این لحظه علامت شکست، شکاف یا محدودیت دیده نشد؛ این نتیجه همچنان ادعای امنیت یا فهم کامل نیست.",
  };
}
