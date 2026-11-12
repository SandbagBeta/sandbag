import { parseSaveClimbInput } from "./saveInput";
import {
  buildSavePayload,
  describeSaveFailure,
  gradeError,
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
