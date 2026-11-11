import { describe, expect, it, vi } from "vitest";
import { CLIMB_CHECKLIST, loadReviewClimb } from "./climbQueue";
import { decideReview } from "./decide";

const ALL = CLIMB_CHECKLIST.map((c) => c.id);
const base = {
  subjectType: "climb" as const,
  subjectId: "c1",
  verdict: "approve",
  reason: "",
  checked: ALL,
};

function deps() {
  const submit = vi.fn().mockResolvedValue({});
  return {
    submit,
    d: { reviewerId: "r", trustLevel: "maintainer" as const, submit },
  };
}

describe("decideReview for climbs", () => {
  it("approves through the lifecycle with subjectType climb", async () => {
    const { d, submit } = deps();
    expect(await decideReview(d, base)).toMatchObject({ ok: true });
    expect(submit).toHaveBeenCalledWith({
      reviewerId: "r",
      subjectType: "climb",
      subjectId: "c1",
      verdict: "approve",
      reason: null,
    });
  });

  it("requires the climb checklist, not the scan one", async () => {
    const { d, submit } = deps();
    const r = await decideReview(d, {
      ...base,
      checked: ["is_boulder", "is_claimed", "coverage", "not_sensitive"],
    });
    expect(r.ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires a reason to reject", async () => {
    const { d } = deps();
    expect(
      (await decideReview(d, { ...base, verdict: "reject", checked: [] })).ok,
    ).toBe(false);
  });
});

describe("loadReviewClimb", () => {
  it("returns null for a malformed id without querying", async () => {
    const from = vi.fn();
    expect(await loadReviewClimb({ from } as never, "nope")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
