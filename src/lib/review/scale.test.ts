import { describe, expect, it, vi } from "vitest";
import {
  ReviewNotAllowedError,
  SubjectNotFoundError,
  TransitionConflictError,
} from "@/lib/lifecycle";
import type { QcReport } from "@/lib/types";
import {
  formatNumber,
  longestSideFromQc,
  parseScaleInput,
  realSize,
  scaleFailureHelp,
  scaleHelpText,
  setScaleFor,
  type SetScaleDeps,
} from "./scale";

const report = (data?: Record<string, number>): QcReport =>
  ({
    checks: [
      { id: "scale", pass: true, severity: "info", message: "ok", data },
    ],
  }) as unknown as QcReport;

describe("longestSideFromQc", () => {
  it("reads the scale check's longest_m", () => {
    expect(longestSideFromQc(report({ longest_m: 1.5 }))).toBe(1.5);
  });
  it("is null when missing or unusable", () => {
    expect(longestSideFromQc(null)).toBeNull();
    expect(longestSideFromQc(report({}))).toBeNull();
    expect(longestSideFromQc(report({ longest_m: 0 }))).toBeNull();
  });
});

describe("parseScaleInput", () => {
  it("accepts plain numbers, comma decimals and spaces", () => {
    expect(parseScaleInput("13.3")).toEqual({ ok: true, factor: 13.3 });
    expect(parseScaleInput(" 13,3 ")).toEqual({ ok: true, factor: 13.3 });
    expect(parseScaleInput(".5")).toEqual({ ok: true, factor: 0.5 });
  });
  it("rejects junk and out-of-range values with a message", () => {
    for (const bad of ["", "abc", "-2", "1e999", "0", "1001", "0.0001", null]) {
      const r = parseScaleInput(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/0\.001|number/);
    }
  });
});

describe("display helpers", () => {
  it("rounds to 3 significant figures", () => {
    expect(formatNumber(13.3333)).toBe("13.3");
    expect(formatNumber(20)).toBe("20");
  });
  it("real size = GLB size * factor", () => {
    expect(realSize(1.5, 13.3)).toBeCloseTo(19.95);
  });
  it("help gives the worked example for the measured size", () => {
    const t = scaleHelpText(1.5);
    expect(t).toContain("1.5 m across");
    expect(t).toContain("enter 13.3");
  });
  it("help omits an example that would be out of range", () => {
    expect(scaleHelpText(0.00001)).not.toContain("enter");
    expect(scaleHelpText(null)).toContain("1 leaves");
  });
});

describe("scaleFailureHelp", () => {
  const rubric = (h: ReturnType<typeof scaleFailureHelp>) => {
    expect(h.whatHappened).toMatch(/^The scale wasn't saved/);
    expect(h.stageLabel).toBeTruthy();
    expect(h.whatYouCanDo.length).toBeGreaterThan(0);
    expect(h.nextSteps.length).toBeGreaterThan(0);
  };
  it("explains each refusal with what to do and next steps", () => {
    for (const code of [
      "self_review",
      "not_pending",
      "not_maintainer",
      "invalid_scale",
    ] as const) {
      const h = scaleFailureHelp(new ReviewNotAllowedError(code, "x"));
      rubric(h);
      expect(h.userFixable).toBe(true);
    }
    rubric(scaleFailureHelp(new SubjectNotFoundError("scan", "x")));
    rubric(scaleFailureHelp(new TransitionConflictError("scan", "x", "y")));
  });
  it("our-side errors carry the reference only when logged", () => {
    const ref = {
      reference: "SB-ABCDEFGH",
      reportPath: "/report-problem?ref=SB-ABCDEFGH",
    };
    const h = scaleFailureHelp(new Error("boom"), ref);
    expect(h.userFixable).toBe(false);
    expect(h.reference).toBe("SB-ABCDEFGH");
    expect(h.nextSteps.join(" ")).toContain("SB-ABCDEFGH");
    expect(scaleFailureHelp(new Error("boom")).reference).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain("boom");
  });
});

describe("setScaleFor", () => {
  const deps = (over: Partial<SetScaleDeps> = {}): SetScaleDeps => ({
    maintainerId: "m",
    trustLevel: "maintainer",
    set: vi.fn().mockResolvedValue({}),
    logUnexpected: vi.fn().mockResolvedValue(null),
    ...over,
  });

  it("writes the parsed factor", async () => {
    const d = deps();
    const r = await setScaleFor(d, { scanId: "s1", factor: "13.3" });
    expect(d.set).toHaveBeenCalledWith({ scanId: "s1", factor: 13.3 });
    expect(r).toMatchObject({ ok: true, factor: 13.3 });
  });
  it("refuses non-maintainers without writing", async () => {
    const d = deps({ trustLevel: "reviewer" });
    const r = await setScaleFor(d, { scanId: "s1", factor: "2" });
    expect(r?.ok).toBe(false);
    expect(d.set).not.toHaveBeenCalled();
  });
  it("refuses an out-of-range factor without writing", async () => {
    const d = deps();
    const r = await setScaleFor(d, { scanId: "s1", factor: "5000" });
    expect(r?.ok).toBe(false);
    expect(d.set).not.toHaveBeenCalled();
  });
  it("turns a lifecycle refusal into help without logging", async () => {
    const d = deps({
      set: vi
        .fn()
        .mockRejectedValue(new ReviewNotAllowedError("not_pending", "x")),
    });
    const r = await setScaleFor(d, { scanId: "s1", factor: "2" });
    expect(r && !r.ok && r.help.stage).toBe("scan");
    expect(d.logUnexpected).not.toHaveBeenCalled();
  });
  it("logs unexpected errors and returns the reference", async () => {
    const d = deps({
      set: vi.fn().mockRejectedValue(new Error("db down")),
      logUnexpected: vi.fn().mockResolvedValue({
        reference: "SB-ABCDEFGH",
        reportPath: "/report-problem?ref=SB-ABCDEFGH",
      }),
    });
    const r = await setScaleFor(d, { scanId: "s1", factor: "2" });
    expect(d.logUnexpected).toHaveBeenCalled();
    expect(r && !r.ok && r.help.reference).toBe("SB-ABCDEFGH");
  });
});
