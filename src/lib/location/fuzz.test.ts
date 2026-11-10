import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FUZZ_MAX_METERS,
  FUZZ_MIN_METERS,
  distanceMeters,
  fuzzPoint,
  getFuzzSecret,
} from "./fuzz";

vi.mock("server-only", () => ({}));

const SECRET = "test-secret-0123456789abcdef0123456789";
const AREA = "00000000-0000-4000-8000-000000000003";
const RAW = { lat: 43.0812, lng: -71.1704 };

describe("getFuzzSecret", () => {
  it("rejects a missing, blank or short secret", () => {
    expect(getFuzzSecret({})).toBeNull();
    expect(getFuzzSecret({ LOCATION_FUZZ_SECRET: "   " })).toBeNull();
    expect(getFuzzSecret({ LOCATION_FUZZ_SECRET: "x".repeat(31) })).toBeNull();
  });
  it("accepts a secret of 32+ characters", () => {
    expect(getFuzzSecret({ LOCATION_FUZZ_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("fuzzPoint (P5)", () => {
  it("is stable across calls", () => {
    const a = fuzzPoint(RAW, AREA, SECRET);
    expect(fuzzPoint(RAW, AREA, SECRET)).toEqual(a);
    expect(fuzzPoint(RAW, AREA.toUpperCase(), SECRET)).toEqual(a);
  });

  it("differs from the raw point, between areas, and between secrets", () => {
    const a = fuzzPoint(RAW, AREA, SECRET);
    expect(a).not.toEqual(RAW);
    expect(distanceMeters(a, RAW)).toBeGreaterThan(FUZZ_MIN_METERS - 1);
    const other = fuzzPoint(
      RAW,
      "00000000-0000-4000-8000-000000000004",
      SECRET,
    );
    expect(other).not.toEqual(a);
    expect(fuzzPoint(RAW, AREA, SECRET + "x")).not.toEqual(a);
  });

  it.each([
    ["mid-latitude", RAW],
    ["equator", { lat: 0, lng: 0 }],
    ["near the north pole", { lat: 89.999, lng: 10 }],
    ["the south pole", { lat: -90, lng: 0 }],
    ["antimeridian east", { lat: -16.5, lng: 179.9995 }],
    ["antimeridian west", { lat: 65.5, lng: -179.9995 }],
  ])("stays 200 m-1 km away and in range at %s", (_, raw) => {
    for (let i = 0; i < 300; i++) {
      const p = fuzzPoint(raw, randomUUID(), SECRET);
      const d = distanceMeters(raw, p);
      expect(d).toBeGreaterThanOrEqual(FUZZ_MIN_METERS - 0.5);
      expect(d).toBeLessThanOrEqual(FUZZ_MAX_METERS + 0.5);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lng).toBeLessThan(180);
    }
  });

  it("spreads points uniformly over the annulus area", () => {
    const n = 4000;
    let inner = 0;
    for (let i = 0; i < n; i++) {
      if (distanceMeters(RAW, fuzzPoint(RAW, randomUUID(), SECRET)) < 600) {
        inner++;
      }
    }
    // Expected share: (600² - 200²) / (1000² - 200²) = 1/3.
    expect(inner / n).toBeGreaterThan(0.29);
    expect(inner / n).toBeLessThan(0.38);
  });
});
