/// <reference types="vite/client" />

import type { OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AttentionFollowUpSummary } from "./AttentionFollowUpSummary.js";

function moment(
  displayId: string,
  type: "change" | "decision" | "risk" | "check",
  title: string,
): OwnershipMomentProjectionItemV1 {
  return {
    displayId,
    candidate: { type, title },
  } as OwnershipMomentProjectionItemV1;
}

describe("Attention follow-up summary", () => {
  it("renders nothing without follow-up Moments", () => {
    const html = renderToStaticMarkup(
      <AttentionFollowUpSummary moments={[]} followUpMomentIds={new Set()} runId="run-1" />,
    );
    expect(html).toBe("");
  });

  it("shows at most three topics in projection order with a same-run link", () => {
    const moments = [
      moment(`mom_${"1".repeat(48)}`, "change", "تغییر اول"),
      moment(`mom_${"2".repeat(48)}`, "decision", "Decision in English"),
      moment(`mom_${"3".repeat(48)}`, "risk", "ریسک سوم"),
      moment(`mom_${"4".repeat(48)}`, "check", "سنجش چهارم"),
    ];
    const ids = new Set(moments.map((item) => item.displayId));
    const html = renderToStaticMarkup(
      <AttentionFollowUpSummary moments={moments} followUpMomentIds={ids} runId="run-1" />,
    );

    expect(html).toContain("تغییر اول");
    expect(html).toContain("تصمیم نیازمند پیگیری");
    expect(html).toContain("ریسک سوم");
    expect(html).not.toContain("سنجش چهارم");
    expect(html).toContain("۱ مورد دیگر");
    expect(html).toContain('/?run=run-1');
  });

  it("does not render a Moment whose follow-up state was removed", () => {
    const first = moment(`mom_${"1".repeat(48)}`, "change", "موضوع اول");
    const second = moment(`mom_${"2".repeat(48)}`, "risk", "موضوع دوم");
    const html = renderToStaticMarkup(
      <AttentionFollowUpSummary
        moments={[first, second]}
        followUpMomentIds={new Set([second.displayId])}
        runId="run-1"
      />,
    );

    expect(html).not.toContain("موضوع اول");
    expect(html).toContain("موضوع دوم");
  });
});
