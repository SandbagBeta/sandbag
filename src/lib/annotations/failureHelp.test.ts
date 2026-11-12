import { describe, expect, it } from "vitest";
import {
  buildHelp,
  isUserFixable,
  ISSUE_HINTS,
  signedOutHelp,
  STAGE_LABELS,
  type RawFailure,
} from "./failureHelp";
import type { AnnotationIssueCode } from "./validate";

const ref = {
  reference: "SB-0123ABCD",
  reportPath: "/report-problem?ref=SB-0123ABCD",
};

describe("failure help (#user-experience)", () => {
  it("has a human label for every stage", () => {
    for (const label of Object.values(STAGE_LABELS)) {
      expect(label.length).toBeGreaterThan(5);
    }
  });

  it("has a fix hint for every validator problem", () => {
    const codes: AnnotationIssueCode[] = [
      "name_empty",
      "name_duplicate",
      "start_holds_count",
      "too_few_holds",
      "duplicate_hold_id",
      "hash_mismatch",
      "face_out_of_range",
      "off_surface",
      "bad_sequence",
      "foot_in_sequence",
      "bad_payload",
    ];
    for (const c of codes) expect(ISSUE_HINTS[c]).toMatch(/\S/);
  });

  describe("who can fix what", () => {
    const v = (issues: RawFailure["issues"]): RawFailure => ({
      code: "validation",
      stage: "validation",
      message: "m",
      issues,
    });
    it("annotation problems and a changed mesh are the user's to fix", () => {
      expect(
        isUserFixable(v([{ code: "off_surface", message: "m", holdId: "h" }])),
      ).toBe(true);
      expect(
        isUserFixable({ code: "stale", stage: "scan", message: "m" }),
      ).toBe(true);
    });
    it("a payload problem is the user's only when it points at a field they typed", () => {
      expect(
        isUserFixable(
          v([{ code: "bad_payload", message: "m", field: "name" }]),
        ),
      ).toBe(true);
      expect(isUserFixable(v([{ code: "bad_payload", message: "m" }]))).toBe(
        false,
      );
      expect(
        isUserFixable(
          v([
            { code: "bad_payload", message: "m", field: "name" },
            { code: "bad_payload", message: "m", holdId: "h" },
          ]),
        ),
      ).toBe(false);
    });
    it("system failures are not", () => {
      for (const code of [
        "not_found",
        "forbidden",
        "mesh_unavailable",
        "error",
      ] as const) {
        expect(isUserFixable({ code, stage: "database", message: "m" })).toBe(
          false,
        );
      }
    });
  });

  it("a fixable validation failure lists each distinct hint once and says to press Save again", () => {
    const help = buildHelp({
      code: "validation",
      stage: "validation",
      message: "m",
      issues: [
        { code: "off_surface", message: "a", holdId: "1" },
        { code: "off_surface", message: "b", holdId: "2" },
        { code: "name_empty", message: "c" },
      ],
    });
    expect(help.userFixable).toBe(true);
    expect(help.whatHappened).toMatch(/3 things need fixing/);
    expect(help.whatYouCanDo).toEqual([
      ISSUE_HINTS.off_surface,
      ISSUE_HINTS.name_empty,
    ]);
    expect(help.nextSteps).toEqual([
      "Fix the highlighted items, then press Save again.",
    ]);
    expect(help.reference).toBeUndefined();
  });

  it("uses the singular for one problem", () => {
    const help = buildHelp({
      code: "validation",
      stage: "validation",
      message: "m",
      issues: [{ code: "name_empty", message: "c" }],
    });
    expect(help.whatHappened).toMatch(/1 thing needs fixing/);
  });

  it("every failure says what happened, always starts from 'wasn't saved', and offers a way forward", () => {
    const cases: RawFailure[] = [
      { code: "not_found", stage: "scan", message: "m" },
      { code: "forbidden", stage: "access", message: "m" },
      { code: "mesh_unavailable", stage: "mesh", message: "m" },
      { code: "error", stage: "database", message: "m" },
      { code: "stale", stage: "scan", message: "m" },
    ];
    for (const raw of cases) {
      const h = buildHelp(raw, ref);
      expect(h.whatHappened).toMatch(/wasn't saved/);
      expect(h.whatYouCanDo.length).toBeGreaterThan(0);
      expect(h.nextSteps.length).toBeGreaterThan(0);
      expect(h.stageLabel).toBe(STAGE_LABELS[raw.stage]);
    }
  });

  it("a system failure carries the reference and link and mentions the reference", () => {
    const h = buildHelp(
      { code: "error", stage: "database", message: "m" },
      ref,
    );
    expect(h.userFixable).toBe(false);
    expect(h.reference).toBe(ref.reference);
    expect(h.reportPath).toBe(ref.reportPath);
    expect(h.nextSteps.join(" ")).toContain(ref.reference);
  });

  it("never attaches a reference to a failure the user can fix", () => {
    const h = buildHelp({ code: "stale", stage: "scan", message: "m" }, ref);
    expect(h.reference).toBeUndefined();
    expect(h.reportPath).toBeUndefined();
  });

  it("a system failure without a reference still tells the user what to do", () => {
    const h = buildHelp({ code: "error", stage: "database", message: "m" });
    expect(h.reference).toBeUndefined();
    expect(h.nextSteps.length).toBeGreaterThan(0);
  });

  it("an expired sign-in is fixable and says how", () => {
    const h = signedOutHelp();
    expect(h).toMatchObject({ stage: "session", userFixable: true });
    expect(h.whatYouCanDo[0]).toMatch(/Sign in/);
    expect(h.nextSteps[0]).toMatch(/Save again/);
  });
});
