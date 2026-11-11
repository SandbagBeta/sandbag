import { describe, expect, it } from "vitest";
import type { QcCheckResult, QcReport } from "../types";
import { assertQcReport, InvalidQcReportError, qcPassed } from "./qc-report";

const check = (over: Partial<QcCheckResult> = {}): QcCheckResult => ({
  id: "tri_count",
  pass: true,
  severity: "error",
  message: "ok",
  ...over,
});
const report = (checks: QcCheckResult[]): QcReport => ({
  pipeline_version: "qc-1.0.0",
  checks,
});

describe("qcPassed", () => {
  it("fails on any failing error check", () => {
    expect(qcPassed(report([check(), check({ pass: false })]))).toBe(false);
  });

  it("passes failing warnings and info through to review", () => {
    expect(
      qcPassed(
        report([
          check(),
          check({ id: "texture_res", pass: false, severity: "warning" }),
          check({ id: "note", pass: false, severity: "info" }),
        ]),
      ),
    ).toBe(true);
  });
});

describe("assertQcReport", () => {
  it("accepts a minimal report and one with extents", () => {
    expect(() => assertQcReport(report([check()]))).not.toThrow();
    expect(() =>
      assertQcReport({
        ...report([check({ data: { count: 2e4, watertight: false } })]),
        extents_m: { width: 2.5, height: 1.8, depth: 1.8 },
        recentred: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertQcReport({ ...report([check()]), extents_m: null }),
    ).not.toThrow();
  });

  // Privacy (PRD §2, ADR 003 §5): published scan rows are public, so these
  // shapes must never be writable.
  it.each([
    // eslint-disable-next-line sandbag/no-raw-coordinates -- fake keys proving the validator refuses coordinates; no real coords
    ["top-level coordinates", { lat: 1, lng: 2 }],
    // eslint-disable-next-line sandbag/no-raw-coordinates -- fake bbox proving the validator refuses corners; no real coords
    ["top-level corners", { bbox: [0, 0, 0, 1, 1, 1] }],
    ["exif", { exif: {} }],
    ["file name", { source_file: "IMG_0001.obj" }],
    ["recentre offset", { recentre_offset: [500000, 0, 4600000] }],
    [
      "corner inside extents",
      { extents_m: { width: 1, height: 1, depth: 1, max: 1 } },
    ],
    ["negative extent", { extents_m: { width: -1, height: 1, depth: 1 } }],
    ["non-boolean recentred", { recentred: [1, 2, 3] }],
  ])("refuses %s", (_label, extra) => {
    expect(() => assertQcReport({ ...report([check()]), ...extra })).toThrow(
      InvalidQcReportError,
    );
  });

  it.each([
    "min_x",
    "bbox_max",
    "origin",
    "offset_y",
    // eslint-disable-next-line sandbag/no-raw-coordinates -- key name the validator must refuse; no coordinate data
    "lat",
    "gps_alt",
    "node_name",
    "image_name",
    "file",
    "utm_zone",
  ])("refuses check data key %s", (key) => {
    expect(() =>
      assertQcReport(report([check({ data: { [key]: 1 } })])),
    ).toThrow(/looks like location or identifying metadata/);
  });

  it.each([
    ["string", "scan.obj"],
    ["array", [1, 2, 3]],
    ["NaN", Number.NaN],
  ])("refuses a %s data value", (_label, v) => {
    expect(() =>
      assertQcReport(report([check({ data: { count: v as number } })])),
    ).toThrow(InvalidQcReportError);
  });

  it.each([
    ["missing pipeline_version", { checks: [check()] }],
    ["empty checks", report([])],
    ["bad severity", report([check({ severity: "fatal" as "error" })])],
    ["blank message", report([check({ message: " " })])],
    ["not an object", "report"],
  ])("refuses %s", (_label, value) => {
    expect(() => assertQcReport(value)).toThrow(InvalidQcReportError);
  });
});
