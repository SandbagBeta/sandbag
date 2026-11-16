import { isInFlight, trackerSteps } from "./tracker";

const states = (s: ReturnType<typeof trackerSteps>) =>
  s.map((x) => x.state).join(",");

describe("trackerSteps", () => {
  it("walks the happy path", () => {
    expect(states(trackerSteps("uploaded"))).toBe(
      "current,upcoming,upcoming,upcoming",
    );
    expect(states(trackerSteps("processing"))).toBe(
      "done,current,upcoming,upcoming",
    );
    expect(states(trackerSteps("pending_review"))).toBe(
      "done,done,current,upcoming",
    );
    expect(states(trackerSteps("published"))).toBe("done,done,done,done");
  });

  it("marks the failing step and names the problem", () => {
    const failed = trackerSteps("failed_qc");
    expect(states(failed)).toBe("done,problem,upcoming,upcoming");
    expect(failed[1]?.label).toBe("Failed checks");
    const rejected = trackerSteps("rejected");
    expect(states(rejected)).toBe("done,done,problem,upcoming");
    expect(rejected[2]?.label).toBe("Rejected");
  });

  it("shows changes requested only on a pending scan with that verdict", () => {
    const s = trackerSteps("pending_review", { verdict: "request_changes" });
    expect(s[2]).toMatchObject({
      state: "problem",
      label: "Changes requested",
    });
    expect(
      trackerSteps("pending_review", { verdict: "approve" })[2]?.state,
    ).toBe("current");
  });

  it("only uploaded and processing are in flight", () => {
    expect(isInFlight("uploaded")).toBe(true);
    expect(isInFlight("processing")).toBe(true);
    expect(isInFlight("pending_review")).toBe(false);
    expect(isInFlight("failed_qc")).toBe(false);
  });
});
