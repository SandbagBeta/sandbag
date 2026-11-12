import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_SCALE,
  MIN_AUTO_SCALE,
  REFERENCE_DIAGONAL,
  clampSizePercent,
  effectiveMarkerScale,
  markerScale,
} from "./markerScale";

describe("markerScale", () => {
  it("is 1 at the reference size and proportional around it", () => {
    expect(markerScale(REFERENCE_DIAGONAL)).toBe(1);
    expect(markerScale(REFERENCE_DIAGONAL / 2)).toBeCloseTo(0.5);
    expect(markerScale(REFERENCE_DIAGONAL * 2)).toBeCloseTo(2);
  });
  it("clamps tiny and huge scans", () => {
    expect(markerScale(1e-6)).toBe(MIN_AUTO_SCALE);
    expect(markerScale(1e9)).toBe(MAX_AUTO_SCALE);
  });
  it("falls back to 1 for unusable diagonals", () => {
    for (const d of [null, undefined, 0, -3, NaN, Infinity]) {
      expect(markerScale(d)).toBe(1);
    }
  });
});

describe("clampSizePercent", () => {
  it("clamps, rounds and accepts numeric strings", () => {
    expect(clampSizePercent(10)).toBe(50);
    expect(clampSizePercent(999)).toBe(200);
    expect(clampSizePercent("125")).toBe(125);
    expect(clampSizePercent(99.6)).toBe(100);
  });
  it("defaults on junk", () => {
    expect(clampSizePercent("abc")).toBe(100);
    expect(clampSizePercent(null)).toBe(100);
    expect(clampSizePercent(NaN)).toBe(100);
  });
});

describe("effectiveMarkerScale", () => {
  it("multiplies scan scale by the percentage", () => {
    expect(effectiveMarkerScale(2, 200)).toBeCloseTo(1);
    expect(effectiveMarkerScale(2, 50)).toBeCloseTo(0.25);
    expect(effectiveMarkerScale(null, 100)).toBe(1);
  });
});
