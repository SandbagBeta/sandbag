import { parseSaveClimbInput } from "./saveInput";
import {
  buildSavePayload,
  describeSaveFailure,
  gradeError,
  holdLabeler,
  plainIssue,
} from "./savePayload";
import type { Hold } from "../types";

const hash = "a".repeat(64);
const hold = (i: number): Hold => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  climb_id: "draft",
  scan_content_hash: hash,
  position: [0, i, 0],
  normal: [0, 1, 0],
  face_index: i,
  type: i === 0 ? "start" : "hand",
  seq_order: i,
});

describe("buildSavePayload", () => {
  const meta = {
    name: "  Warmup ",
    description: " ",
    proposed_grade: "V2",
    fa_info: "",
  };
  const payload = () =>
    buildSavePayload({
      scanId: "00000000-0000-4000-8000-0000000000aa",
      scanContentHash: hash,
      meta,
      holds: [hold(0), hold(1), hold(2)],
      paths: [
        {
          id: "p",
          climb_id: "draft",
          kind: "topout",
          points: [
            [0, 0, 0],
            [0, 1, 0],
          ],
        },
      ],
    });

  it("trims text, nulls empty FA and drops draft ids", () => {
    const p = payload();
    expect(p.name).toBe("Warmup");
    expect(p.description).toBe("");
    expect(p.faInfo).toBeNull();
    expect(p.holds[0]).not.toHaveProperty("climb_id");
    expect(p.holds[0]).not.toHaveProperty("scan_content_hash");
    expect(p.paths).toEqual([
      {
        kind: "topout",
        points: [
          [0, 0, 0],
          [0, 1, 0],
        ],
      },
    ]);
  });

  it("is accepted by the server-side parser", () => {
    const r = parseSaveClimbInput(payload());
    expect(r.ok).toBe(true);
  });
});

describe("gradeError", () => {
  it("accepts VB..V17 and rejects blank", () => {
    expect(gradeError("VB")).toBeNull();
    expect(gradeError("V17")).toBeNull();
    expect(gradeError("")).not.toBeNull();
  });
});

describe("describeSaveFailure", () => {
  it("maps each non-validation code to an action", () => {
    const act = (code: string) =>
      describeSaveFailure({ code, message: "x" }).action;
    expect(act("signed_out")).toBe("sign-in");
    expect(act("stale")).toBe("reload");
    expect(act("mesh_unavailable")).toBe("retry");
    expect(act("error")).toBe("retry");
    expect(act("not_found")).toBeNull();
    expect(act("forbidden")).toBeNull();
    expect(act("something_new")).toBe("retry");
  });

  it("surfaces name issues and hold ids from validation", () => {
    const v = describeSaveFailure({
      code: "validation",
      message: "",
      issues: [
        { code: "name_duplicate", message: "Name taken." },
        { code: "off_surface", message: "Off.", holdId: "h1" },
        { code: "bad_sequence", message: "Seq.", holdId: "h1" },
        { code: "face_out_of_range", message: "Face.", holdId: "h2" },
      ],
    });
    expect(v.fields.name).toBe("Name taken.");
    expect(v.holdIds).toEqual(["h1", "h2"]);
    expect(v.issues).toHaveLength(4);
  });
});

describe("holdLabeler and plainIssue", () => {
  const holds: Hold[] = [
    { ...hold(0), id: "a" },
    { ...hold(1), id: "foot1", type: "foot", seq_order: null },
    { ...hold(2), id: "c", seq_order: 2 },
    { ...hold(1), id: "b", seq_order: 1 },
  ];

  it("numbers holds by sequence and feet separately", () => {
    const label = holdLabeler(holds);
    expect(label("a")).toBe("Hold 1");
    expect(label("b")).toBe("Hold 2");
    expect(label("c")).toBe("Hold 3");
    expect(label("foot1")).toBe("Foot 1");
    expect(label("gone")).toBe("A hold");
  });

  it("never shows ids, face numbers or metres", () => {
    const label = holdLabeler(holds);
    for (const code of [
      "off_surface",
      "face_out_of_range",
      "hash_mismatch",
      "duplicate_hold_id",
      "foot_in_sequence",
    ] as const) {
      const m = plainIssue(
        { code, message: "Hold c is 0.123 m off face 9", holdId: "c" },
        label,
      ).message;
      expect(m).not.toMatch(/0\.123|face 9|\bc\b/);
    }
    expect(
      plainIssue({ code: "off_surface", message: "x", holdId: "c" }, label)
        .message,
    ).toMatch(/^Hold 3 /);
  });

  it("keeps the server help on a failure view", () => {
    const help = {
      stage: "database" as const,
      stageLabel: "Saving to the database",
      userFixable: false,
      whatHappened: "Your climb wasn't saved.",
      whatYouCanDo: [],
      nextSteps: [],
      reference: "SB-ABCD2345",
    };
    expect(describeSaveFailure({ code: "error", message: "", help }).help).toBe(
      help,
    );
  });
});
