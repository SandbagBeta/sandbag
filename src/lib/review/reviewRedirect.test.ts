import { describe, expect, it } from "vitest";
import { reviewedBanner, reviewRedirect } from "./decide";

describe("reviewRedirect", () => {
  it("sends approve and reject back to the queue", () => {
    expect(reviewRedirect("approve")).toBe("/review?reviewed=approve");
    expect(reviewRedirect("reject")).toBe("/review?reviewed=reject");
  });
  it("keeps request_changes and junk on the page", () => {
    expect(reviewRedirect("request_changes")).toBeNull();
    expect(reviewRedirect(null)).toBeNull();
  });
});

describe("reviewedBanner", () => {
  it("confirms only known verdicts", () => {
    expect(reviewedBanner("approve")).toBe("Approved and published.");
    expect(reviewedBanner("reject")).toBe("Rejected.");
    expect(reviewedBanner("<b>x</b>")).toBeNull();
    expect(reviewedBanner(undefined)).toBeNull();
  });
});
