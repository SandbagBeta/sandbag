import { describe, expect, it } from "vitest";
import {
  AnnotationValidationError,
  assertValidClimbAnnotations,
  pointTriangleDistance,
  validateClimbAnnotations,
  type ClimbSubmission,
  type ValidationContext,
} from "./validate";
import type { Vec3 } from "../types";

const H = "a".repeat(64);
// One big triangle in the XZ plane (y = 0).
const mesh = { positions: [0, 0, 0, 10, 0, 0, 0, 0, 10], indices: [0, 1, 2] };
const ctx: ValidationContext = {
  scanContentHash: H,
  mesh,
  existingNames: ["Taken"],
};
const hold = (id: string, type: "start" | "hand" | "finish") => ({
  id,
  scan_content_hash: H,
  position: [1, 0, 1] as Vec3,
  face_index: 0,
  type,
  seq_order: undefined as number | undefined,
});
const good = (): ClimbSubmission => ({
  name: "Fresh",
  holds: [hold("1", "start"), hold("2", "hand"), hold("3", "finish")],
});
const codes = (s: ClimbSubmission, c = ctx) =>
  validateClimbAnnotations(s, c).map((i) => i.code);

describe("annotation validity", () => {
  it("accepts a valid climb", () => {
    expect(codes(good())).toEqual([]);
    expect(() => assertValidClimbAnnotations(good(), ctx)).not.toThrow();
  });

  it("requires 1-2 start holds", () => {
    const none = good();
    none.holds[0]!.type = "hand";
    expect(codes(none)).toContain("start_holds_count");
    const three = {
      name: "x",
      holds: [
        hold("1", "start"),
        hold("2", "start"),
        hold("3", "start"),
        hold("4", "hand"),
      ],
    };
    expect(codes(three)).toContain("start_holds_count");
    const two = {
      name: "x",
      holds: [hold("1", "start"), hold("2", "start"), hold("3", "finish")],
    };
    expect(codes(two)).toEqual([]);
  });

  it("requires at least 3 holds", () => {
    expect(codes({ name: "x", holds: good().holds.slice(0, 2) })).toContain(
      "too_few_holds",
    );
  });

  it("rejects duplicate hold ids and bad sequences", () => {
    const d = good();
    d.holds[1]!.id = "1";
    expect(codes(d)).toContain("duplicate_hold_id");
    const gap = good();
    gap.holds[0]!.seq_order = 0;
    gap.holds[1]!.seq_order = 2;
    expect(codes(gap)).toContain("bad_sequence");
    const ok = good();
    ok.holds.forEach((h, i) => (h.seq_order = i));
    expect(codes(ok)).toEqual([]);
    const dup = good();
    dup.holds[0]!.seq_order = 0;
    dup.holds[1]!.seq_order = 0;
    expect(codes(dup)).toContain("bad_sequence");
  });

  it("rejects holds off the surface or on a stale mesh", () => {
    const off = good();
    off.holds[0]!.position = [1, 0.5, 1];
    expect(codes(off)).toEqual(["off_surface"]);
    const near = good();
    near.holds[0]!.position = [1, 0.04, 1];
    expect(codes(near)).toEqual([]);
    const stale = good();
    stale.holds[0]!.scan_content_hash = "b".repeat(64);
    expect(codes(stale)).toEqual(["hash_mismatch"]);
    expect(codes(good(), { ...ctx, scanContentHash: null })).toContain(
      "hash_mismatch",
    );
    const face = good();
    face.holds[0]!.face_index = 5;
    expect(codes(face)).toEqual(["face_out_of_range"]);
    const nan = good();
    nan.holds[0]!.position = [NaN, 0, 0];
    expect(codes(nan)).toEqual(["off_surface"]);
  });

  it("rejects empty and duplicate names (case/space-insensitive)", () => {
    expect(codes({ ...good(), name: "  " })).toContain("name_empty");
    expect(codes({ ...good(), name: " tAKEN " })).toContain("name_duplicate");
  });

  it("throws one error listing every problem", () => {
    expect.assertions(2);
    try {
      assertValidClimbAnnotations({ name: "Taken", holds: [] }, ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(AnnotationValidationError);
      expect((e as AnnotationValidationError).issues).toHaveLength(3);
    }
  });

  it("computes triangle distance for face, vertex and edge regions", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 0, 1];
    expect(pointTriangleDistance([0.2, 1, 0.2], a, b, c)).toBeCloseTo(1);
    expect(pointTriangleDistance([-1, 0, -1], a, b, c)).toBeCloseTo(Math.SQRT2);
    expect(pointTriangleDistance([0.5, 0, -1], a, b, c)).toBeCloseTo(1);
    expect(pointTriangleDistance([1, 0, 1], a, b, c)).toBeCloseTo(
      Math.SQRT2 / 2,
    );
  });
});
