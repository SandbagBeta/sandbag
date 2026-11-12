import { describe, expect, it } from "vitest";
import type { QcReport, Review, ScanStatusEvent } from "../types";
import { buildTimeline, canRetry, groupChecks, latestFeedback } from "./format";

const report: QcReport = {
  pipeline_version: "t",
  checks: [
    {
      id: "tex",
      pass: false,
      severity: "error",
      message: "Texture too low: 512px, need 1024px+",
    },
    {
      id: "tri",
      pass: false,
      severity: "error",
      message: "Too many triangles",
    },
    { id: "hole", pass: false, severity: "warning", message: "Some holes" },
    { id: "ok", pass: true, severity: "error", message: "Fine" },
  ],
};

const review = (verdict: Review["verdict"], at: string): Review => ({
  id: at,
  subject_type: "scan",
  subject_id: "s",
  reviewer_id: null,
  verdict,
  reason: verdict === "approve" ? null : `why ${at}`,
  created_at: at,
});

describe("groupChecks", () => {
  it("shows every failing error check, not just the first", () => {
    const g = groupChecks(report);
    expect(g.blocking.map((c) => c.id)).toEqual(["tex", "tri"]);
    expect(g.advisory.map((c) => c.id)).toEqual(["hole"]);
    expect(g.passed.map((c) => c.id)).toEqual(["ok"]);
  });
  it("tolerates a missing report", () => {
    expect(groupChecks(null)).toEqual({
      blocking: [],
      advisory: [],
      passed: [],
    });
  });
});

describe("buildTimeline", () => {
  it("orders oldest first with plain labels", () => {
    const e = (
      id: string,
      to: ScanStatusEvent["to_status"],
      at: string,
    ): ScanStatusEvent => ({
      id,
      scan_id: "s",
      from_status: null,
      to_status: to,
      created_at: at,
    });
    const steps = buildTimeline([
      e("2", "failed_qc", "2026-01-02T00:00:00Z"),
      e("1", "uploaded", "2026-01-01T00:00:00Z"),
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Uploaded",
      "Failed automated checks",
    ]);
  });
});

describe("latestFeedback / canRetry", () => {
  it("ignores approvals and takes the newest", () => {
    const f = latestFeedback([
      review("request_changes", "2026-01-01"),
      review("reject", "2026-01-03"),
      review("approve", "2026-01-04"),
    ]);
    expect(f?.verdict).toBe("reject");
  });
  it("allows retry only from failed, rejected or changes-requested", () => {
    expect(canRetry("failed_qc", null)).toBe(true);
    expect(canRetry("rejected", null)).toBe(true);
    expect(canRetry("pending_review", review("request_changes", "x"))).toBe(
      true,
    );
    expect(canRetry("pending_review", null)).toBe(false);
    expect(canRetry("published", null)).toBe(false);
    expect(canRetry("processing", null)).toBe(false);
  });
});
