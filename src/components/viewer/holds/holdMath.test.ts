import { Quaternion, Vector3 } from "three";
import type { Hold, Vec3 } from "@/lib/types";
import { demoBoulder, holdsForClimb, pathsForClimb } from "@/lib/fixtures";
import {
  countHoldsByType,
  groupHoldsByType,
  HOLD_SURFACE_OFFSET,
  markerTransform,
  normalToQuaternion,
  offsetAlongNormal,
  offsetPathPoints,
  pathMidpoint,
} from "./holdMath";
import {
  DIMMED_COLOR,
  HOLD_STYLE,
  HOLD_TYPES,
  PATH_KINDS,
  PATH_STYLE,
} from "./holdStyle";

const hold = (over: Partial<Hold>): Hold => ({
  id: "h",
  climb_id: "c",
  scan_content_hash: "x",
  position: [0, 0, 0],
  normal: [0, 1, 0],
  face_index: 0,
  type: "hand",
  ...over,
});

const rotateUp = (q: [number, number, number, number]) =>
  new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...q)).toArray();

describe("offsetAlongNormal", () => {
  it("moves d meters along the (normalized) normal", () => {
    expect(offsetAlongNormal([1, 2, 3], [0, 0, 2], 0.005)).toEqual([
      1, 2, 3.005,
    ]);
  });
  it("leaves the point alone for a zero normal", () => {
    expect(offsetAlongNormal([1, 2, 3], [0, 0, 0], 1)).toEqual([1, 2, 3]);
  });
});

describe("normalToQuaternion", () => {
  it.each<[Vec3]>([
    [[0, 0, 1]],
    [[1, 0, 0]],
    [[0, -1, 0]],
    [[0.3, 0.4, 0.866]],
  ])("rotates +Y onto %j", (n) => {
    const unit = new Vector3(...n).normalize().toArray();
    rotateUp(normalToQuaternion(n)).forEach((v, i) =>
      expect(v).toBeCloseTo(unit[i] ?? NaN, 6),
    );
  });
  it("is identity for +Y and for a zero normal", () => {
    expect(normalToQuaternion([0, 1, 0])).toEqual([0, 0, 0, 1]);
    expect(normalToQuaternion([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });
});

describe("markerTransform on the fixture", () => {
  it("sits each marker 5 mm off its surface point, axis along the normal", () => {
    for (const h of demoBoulder.holds) {
      const { position, quaternion } = markerTransform(h);
      const d = new Vector3(...position).distanceTo(new Vector3(...h.position));
      expect(d).toBeCloseTo(HOLD_SURFACE_OFFSET, 6);
      const axis = new Vector3(...rotateUp(quaternion));
      expect(axis.dot(new Vector3(...h.normal).normalize())).toBeCloseTo(1, 6);
    }
  });
});

describe("grouping", () => {
  const holds = [
    hold({ id: "a", type: "start" }),
    hold({ id: "b", type: "start" }),
    hold({ id: "c", type: "finish" }),
  ];
  it("groups by type with every type present", () => {
    const g = groupHoldsByType(holds);
    expect(Object.keys(g)).toEqual([...HOLD_TYPES]);
    expect(g.start.map((h) => h.id)).toEqual(["a", "b"]);
    expect(g.hand).toEqual([]);
  });
  it("counts by type", () => {
    expect(countHoldsByType(holds)).toEqual({
      start: 2,
      hand: 0,
      foot: 0,
      finish: 1,
    });
  });
});

describe("offsetPathPoints", () => {
  it("lifts each point along its nearest hold's normal", () => {
    const holds = [
      hold({ position: [0, 0, 0], normal: [0, 0, 1] }),
      hold({ position: [0, 10, 0], normal: [1, 0, 0] }),
    ];
    expect(
      offsetPathPoints(
        [
          [0, 1, 0],
          [0, 9, 0],
        ],
        holds,
        0.01,
      ),
    ).toEqual([
      [0, 1, 0.01],
      [0.01, 9, 0],
    ]);
  });
  it("returns points unchanged without holds", () => {
    const pts: Vec3[] = [[1, 1, 1]];
    expect(offsetPathPoints(pts, [])).toBe(pts);
  });
  it("leaves points beyond maxDist from every hold alone", () => {
    const holds = [hold({ position: [0, 0, 0], normal: [0, 0, 1] })];
    expect(
      offsetPathPoints(
        [
          [0, 0.1, 0],
          [0, 5, 0],
        ],
        holds,
        0.01,
        0.3,
      ),
    ).toEqual([
      [0, 0.1, 0.01],
      [0, 5, 0],
    ]);
  });
});

describe("pathMidpoint", () => {
  it("is halfway along the length, not the middle vertex", () => {
    expect(
      pathMidpoint([
        [0, 0, 0],
        [1, 0, 0],
        [1, 3, 0],
      ]),
    ).toEqual([1, 1, 0]);
  });
  it("handles degenerate input", () => {
    expect(pathMidpoint([])).toBeNull();
    expect(pathMidpoint([[2, 2, 2]])).toEqual([2, 2, 2]);
    expect(
      pathMidpoint([
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toEqual([1, 1, 1]);
  });
});

describe("path styles", () => {
  it("gives each kind a unique color and dash pattern; only the line is solid", () => {
    const styles = PATH_KINDS.map((k) => PATH_STYLE[k]);
    expect(new Set(styles.map((s) => s.color)).size).toBe(3);
    expect(new Set(styles.map((s) => JSON.stringify(s.dash))).size).toBe(3);
    expect(PATH_STYLE.line.dash).toBeNull();
    const holdColors = HOLD_TYPES.map((t) => HOLD_STYLE[t].color);
    for (const s of styles) expect(holdColors).not.toContain(s.color);
  });
  it("fixture gives every climb a line, a topout and a downclimb", () => {
    for (const c of demoBoulder.climbs) {
      const kinds = pathsForClimb(c.id).map((p) => p.kind);
      expect([...kinds].sort()).toEqual([...PATH_KINDS].sort());
    }
  });
});

describe("hold styles + fixture integrity used by the UI", () => {
  it("gives every type a unique color and a unique shape", () => {
    const styles = HOLD_TYPES.map((t) => HOLD_STYLE[t]);
    expect(new Set(styles.map((s) => s.color)).size).toBe(4);
    expect(new Set(styles.map((s) => s.shape)).size).toBe(4);
    expect(styles.map((s) => s.color)).not.toContain(DIMMED_COLOR);
  });

  it("has two climbs with disjoint holds, every type, and a line path", () => {
    expect(demoBoulder.climbs).toHaveLength(2);
    const [a, b] = demoBoulder.climbs.map((c) => holdsForClimb(c.id)) as [
      Hold[],
      Hold[],
    ];
    const ids = new Set(a.map((h) => h.id));
    expect(b.some((h) => ids.has(h.id))).toBe(false);
    for (const c of demoBoulder.climbs) {
      const counts = countHoldsByType(holdsForClimb(c.id));
      for (const t of HOLD_TYPES) expect(counts[t]).toBeGreaterThan(0);
      const line = pathsForClimb(c.id).find((p) => p.kind === "line");
      expect(line?.points.length).toBeGreaterThanOrEqual(2);
    }
  });
});
