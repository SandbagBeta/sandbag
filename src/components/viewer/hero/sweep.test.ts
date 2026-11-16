import { describe, expect, it } from "vitest";
import {
  activeClimbIndex,
  angleDelta,
  azimuthOf,
  planSweep,
  sweepAzimuth,
} from "./sweep";

const deg = (r: number) => (r * 180) / Math.PI;

describe("azimuthOf", () => {
  it("is 0 facing +z and 90 degrees facing +x", () => {
    expect(azimuthOf([0, 0, 1])).toBeCloseTo(0);
    expect(deg(azimuthOf([1, 0, 0]))).toBeCloseTo(90);
    expect(deg(azimuthOf([-1, 0, 0]))).toBeCloseTo(-90);
  });
});

describe("angleDelta", () => {
  it("takes the short way round", () => {
    expect(
      deg(angleDelta((170 * Math.PI) / 180, (-170 * Math.PI) / 180)),
    ).toBeCloseTo(20);
    expect(deg(angleDelta(0, (190 * Math.PI) / 180))).toBeCloseTo(-170);
  });
});

describe("planSweep", () => {
  it("centres between two faces and reaches both", () => {
    const plan = planSweep([
      [0, 0, 1], // 0 degrees
      [-1, 0, 0], // -90 degrees
    ]);
    expect(deg(plan.center)).toBeCloseTo(-45);
    for (const phase of [Math.PI / 2, -Math.PI / 2]) {
      const az = sweepAzimuth(plan, phase);
      const nearest = Math.min(
        ...plan.faces.map((f) => Math.abs(angleDelta(az, f))),
      );
      expect(deg(nearest)).toBeLessThan(30);
    }
  });

  it("centres a pair straddling 180 degrees on 180, not 0", () => {
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const plan = planSweep([
      [Math.sin(a), 0, Math.cos(a)],
      [Math.sin(b), 0, Math.cos(b)],
    ]);
    expect(Math.abs(deg(angleDelta(plan.center, Math.PI)))).toBeLessThan(1);
  });

  it("keeps the swing between 35 and 80 degrees", () => {
    const one = planSweep([[0, 0, 1]]);
    expect(deg(one.amplitude)).toBeCloseTo(35);
    const wide = planSweep([
      [0, 0, 1],
      [0, 0, -1],
    ]);
    expect(deg(wide.amplitude)).toBeCloseTo(80);
  });

  it("copes with no usable normals", () => {
    const plan = planSweep([null]);
    expect(plan.center).toBe(0);
    expect(activeClimbIndex(plan, 0, 0)).toBe(0);
  });
});

describe("activeClimbIndex", () => {
  const plan = planSweep([
    [0, 0, 1],
    [-1, 0, 0],
  ]);
  it("picks the climb the camera faces", () => {
    expect(activeClimbIndex(plan, 0, 1)).toBe(0);
    expect(activeClimbIndex(plan, (-90 * Math.PI) / 180, 0)).toBe(1);
  });
  it("does not flip back and forth at the midpoint", () => {
    const mid = plan.center;
    expect(activeClimbIndex(plan, mid, 0)).toBe(0);
    expect(activeClimbIndex(plan, mid, 1)).toBe(1);
  });
});
