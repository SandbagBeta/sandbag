import { describe, expect, it } from "vitest";
import {
  isVoteFailureUserFixable,
  voteFailureHelp,
  type VoteFailureCode,
} from "./voteFailure";

const ALL: VoteFailureCode[] = [
  "signed_out",
  "unknown_climb",
  "not_published",
  "invalid_grade",
  "error",
];
const REF = {
  reference: "SB-0123ABCD",
  reportPath: "/report-problem?ref=SB-0123ABCD",
};

describe("voteFailureHelp", () => {
  it.each(ALL)("%s names what happened, the step, and what to do", (code) => {
    const h = voteFailureHelp(code);
    expect(h.whatHappened).toMatch(/^Your vote wasn't saved/);
    expect(h.stageLabel).toBeTruthy();
    expect(h.whatYouCanDo.length).toBeGreaterThan(0);
    expect(h.userFixable).toBe(isVoteFailureUserFixable(code));
    expect(h.userFixable || h.nextSteps.length > 0).toBe(true);
  });

  it("covers sign-in, not published and a server error", () => {
    expect(voteFailureHelp("signed_out").whatYouCanDo[0]).toMatch(/Sign in/);
    expect(voteFailureHelp("not_published").whatHappened).toMatch(
      /isn't published/,
    );
    expect(voteFailureHelp("error").userFixable).toBe(false);
  });

  it("only a server error carries the reference", () => {
    expect(voteFailureHelp("signed_out", REF).reference).toBeUndefined();
    const h = voteFailureHelp("error", REF);
    expect(h.reference).toBe(REF.reference);
    expect(h.reportPath).toBe(REF.reportPath);
    expect(h.nextSteps[0]).toContain(REF.reference);
  });
});
