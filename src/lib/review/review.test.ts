import { describe, expect, it, vi } from "vitest";
import { ReviewNotAllowedError } from "@/lib/lifecycle";
import { decideReview } from "./decide";
import { CHECKLIST, canReviewInUi, countQcWarnings } from "./queue";

const ALL = CHECKLIST.map((c) => c.id);
const base = { subjectId: "s", verdict: "approve", reason: "", checked: ALL };

function deps(trust: "maintainer" | "reviewer" | "contributor" | null) {
  const submit = vi.fn().mockResolvedValue({});
  return { submit, d: { reviewerId: "r", trustLevel: trust, submit } };
}

describe("canReviewInUi", () => {
  it("is maintainer only", () => {
    expect(canReviewInUi("maintainer")).toBe(true);
    for (const t of ["reviewer", "contributor", null] as const) {
      expect(canReviewInUi(t)).toBe(false);
    }
  });
});

describe("decideReview", () => {
  it("refuses non-maintainers (403) without touching the lifecycle", async () => {
    const { d, submit } = deps("contributor");
    const r = await decideReview(d, base);
    expect(r).toMatchObject({ ok: false });
    expect(submit).not.toHaveBeenCalled();
  });

  it("approves with a full checklist and no reason", async () => {
    const { d, submit } = deps("maintainer");
    expect(await decideReview(d, base)).toMatchObject({ ok: true });
    expect(submit).toHaveBeenCalledWith({
      reviewerId: "r",
      subjectType: "scan",
      subjectId: "s",
      verdict: "approve",
      reason: null,
    });
  });

  it("requires every checklist item to approve", async () => {
    const { d, submit } = deps("maintainer");
    const r = await decideReview(d, { ...base, checked: ALL.slice(1) });
    expect(r.ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires a reason to reject or request changes", async () => {
    const { d, submit } = deps("maintainer");
    for (const verdict of ["reject", "request_changes"]) {
      const r = await decideReview(d, { ...base, verdict, checked: [] });
      expect(r.ok).toBe(false);
    }
    expect(submit).not.toHaveBeenCalled();
    const ok = await decideReview(d, {
      ...base,
      verdict: "reject",
      reason: " blurry ",
      checked: [],
    });
    expect(ok.ok).toBe(true);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ reason: "blurry" });
  });

  it("rejects unknown verdicts", async () => {
    const { d } = deps("maintainer");
    expect((await decideReview(d, { ...base, verdict: "delete" })).ok).toBe(
      false,
    );
  });

  it("surfaces lifecycle refusals as messages and rethrows others", async () => {
    const { d, submit } = deps("maintainer");
    submit.mockRejectedValueOnce(
      new ReviewNotAllowedError(
        "self_review",
        "You can't review your own scan.",
      ),
    );
    expect(await decideReview(d, base)).toEqual({
      ok: false,
      error: "You can't review your own scan.",
    });
    submit.mockRejectedValueOnce(new Error("db down"));
    await expect(decideReview(d, base)).rejects.toThrow("db down");
  });
});

describe("countQcWarnings", () => {
  it("counts failing non-info checks", () => {
    const check = (pass: boolean, severity: "error" | "warning" | "info") => ({
      id: "x",
      pass,
      severity,
      message: "m",
    });
    expect(countQcWarnings(null)).toBe(0);
    expect(
      countQcWarnings({
        pipeline_version: "1",
        checks: [
          check(false, "warning"),
          check(false, "info"),
          check(true, "warning"),
        ],
      }),
    ).toBe(1);
  });
});
