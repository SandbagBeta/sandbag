// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertQcReport } from "../lifecycle/qc-report";
import {
  checkColor,
  checkFileSize,
  checkFileType,
  checkFloaters,
  checkMeshQuality,
  checkParse,
  checkScale,
  checkTextureResolution,
  checkTooLarge,
  checkTriCount,
  checkVolume,
} from "./checks";
import { buildQcReport } from "./report";

/** [pass, severity] — the outcome that decides failed_qc vs review. */
const outcome = (r: { pass: boolean; severity: string } | null) =>
  r && [r.pass, r.severity];

describe("thresholds sit exactly where ADR 003 §8 puts them", () => {
  it("H3 too large: > 5,000,000 header triangles", () => {
    expect(outcome(checkTooLarge(5_000_000))).toEqual([true, "error"]);
    expect(outcome(checkTooLarge(5_000_001))).toEqual([false, "error"]);
    expect(checkTooLarge(6_200_000).message).toBe(
      "This scan is too large: 6.2M triangles; the limit is 5M. Decimate it to under 5M triangles and upload again.",
    );
  });

  it("H5 too few triangles: < 10,000 (and the 5M cap again)", () => {
    expect(outcome(checkTriCount(9_999))).toEqual([false, "error"]);
    expect(outcome(checkTriCount(10_000))).toEqual([true, "error"]);
    expect(outcome(checkTriCount(5_000_000))).toEqual([true, "error"]);
    expect(outcome(checkTriCount(5_000_001))).toEqual([false, "error"]);
    expect(checkTriCount(2_000).message).toBe(
      "Only 2,000 triangles; we need at least 10,000. Export at a higher mesh quality.",
    );
  });

  it("H6 / S3 scale: hard outside 0.3–30 m, warning outside 0.5–20 m", () => {
    const s = (m: number) => outcome(checkScale([m, m / 2, m / 2]));
    expect(s(0.29)).toEqual([false, "error"]);
    expect(s(0.3)).toEqual([false, "warning"]);
    expect(s(0.49)).toEqual([false, "warning"]);
    expect(s(0.5)).toEqual([true, "error"]);
    expect(s(20)).toEqual([true, "error"]);
    expect(s(20.1)).toEqual([false, "warning"]);
    expect(s(30)).toEqual([false, "warning"]);
    expect(s(30.1)).toEqual([false, "error"]);
  });

  it("H6 suggests the unit the export was probably in", () => {
    expect(checkScale([2000, 1500, 1500]).message).toBe(
      "The scan is 2,000 m across. It was probably exported in millimetres; export in metres.",
    );
    expect(checkScale([250, 100, 100]).message).toMatch(/in centimetres/);
    expect(checkScale([0.002, 0.001, 0.001]).message).toMatch(/kilometres/);
    expect(checkScale([90, 5, 5]).message).toMatch(/in centimetres/);
    expect(checkScale([50_000, 5, 5]).message).toMatch(
      /Check the export units \(metres\) and crop/,
    );
    expect(checkScale([0.4, 0.2, 0.2]).message).toMatch(/small for a boulder/);
    expect(checkScale([25, 5, 5]).message).toMatch(/large for a boulder/);
  });

  it("H7 volume: < 0.1% of the bounding box fails", () => {
    expect(outcome(checkVolume(0.000999))).toEqual([false, "error"]);
    expect(outcome(checkVolume(0.001))).toEqual([true, "error"]);
    expect(outcome(checkVolume(0))).toEqual([false, "error"]);
  });

  it("H8 / S2 floaters: ≥ 50% fails, 20–50% warns", () => {
    expect(outcome(checkFloaters(0.19))).toEqual([true, "error"]);
    expect(outcome(checkFloaters(0.2))).toEqual([false, "warning"]);
    expect(outcome(checkFloaters(0.49))).toEqual([false, "warning"]);
    expect(outcome(checkFloaters(0.5))).toEqual([false, "error"]);
    expect(checkFloaters(0.6).message).toBe(
      "60% of the mesh is disconnected floating pieces. Crop the scan to the boulder before exporting.",
    );
  });

  it("H9 colour: an image texture or vertex colours (O6)", () => {
    const tex = [{ width: 2048, height: 2048 }];
    const c = (textures: typeof tex, vertexColors: boolean, missing = 0) =>
      checkColor({ textures, vertexColors, missingTextures: missing });
    expect(outcome(c(tex, false))).toEqual([true, "error"]);
    expect(outcome(c([], true))).toEqual([true, "error"]);
    expect(outcome(c([], false))).toEqual([false, "error"]);
    expect(c([], false).message).toMatch(/no texture image and no vertex/);
    expect(c([], false, 1).message).toMatch(/isn't in the upload/);
  });

  it("H10 / S1 texture: < 1024 px fails, 1024–2047 warns, image textures only", () => {
    const t = (w: number, h = w) =>
      outcome(checkTextureResolution([{ width: w, height: h }]));
    expect(t(1023)).toEqual([false, "error"]);
    expect(t(1024)).toEqual([false, "warning"]);
    expect(t(2047)).toEqual([false, "warning"]);
    expect(t(2048)).toEqual([true, "error"]);
    expect(t(512, 2048)).toEqual([true, "error"]); // longest side counts
    expect(checkTextureResolution([])).toBeNull(); // vertex colours: skipped
    // The smallest texture decides.
    expect(
      outcome(
        checkTextureResolution([
          { width: 4096, height: 4096 },
          { width: 512, height: 512 },
        ]),
      ),
    ).toEqual([false, "error"]);
    expect(checkTextureResolution([{ width: 512, height: 512 }])!.message).toBe(
      "The texture is 512 px; we need at least 1,024 px. Export at 2,048 px (see the capture guide).",
    );
  });

  it("S4 mesh quality: > 1% degenerate faces or non-manifold edges warns", () => {
    const q = (degenerateFaces: number, nonManifoldEdges: number) =>
      checkMeshQuality({
        triCount: 10_000,
        degenerateFaces,
        edges: 15_000,
        nonManifoldEdges,
      });
    expect(outcome(q(100, 150))).toEqual([true, "warning"]);
    expect(outcome(q(101, 0))).toEqual([false, "warning"]);
    expect(outcome(q(0, 151))).toEqual([false, "warning"]);
    expect(q(300, 300).message).toMatch(
      /^3% of faces are degenerate \(zero area\) and 2% of edges are non-manifold\./,
    );
  });

  it("H2 file size: over the plan cap", () => {
    expect(outcome(checkFileSize(200 * 1024 * 1024))).toEqual([true, "error"]);
    expect(outcome(checkFileSize(200 * 1024 * 1024 + 1))).toEqual([
      false,
      "error",
    ]);
    const hostedFree = checkFileSize(60 * 1024 * 1024, 50 * 1024 * 1024);
    expect(hostedFree.message).toBe(
      "This file is 60 MB; the limit is 50 MB. Decimate the mesh or shrink the texture and upload again.",
    );
  });

  it("H1 file type and H4 parse", () => {
    expect(outcome(checkFileType("ply", "ply"))).toEqual([true, "error"]);
    expect(checkFileType("ply", "stl").message).toBe(
      "This file says .ply but isn't a PLY (it looks like an STL). Export as PLY again.",
    );
    expect(outcome(checkParse(null))).toEqual([true, "error"]);
    expect(outcome(checkParse("broken"))).toEqual([false, "error"]);
  });
});

describe("every check result is a valid, location-free report entry", () => {
  it("passes assertQcReport (no min/max/name/file keys, scalars only)", () => {
    const tex = [{ width: 1024, height: 1024 }];
    const checks = [
      checkFileType("glb", "jpeg"),
      checkFileSize(1),
      checkTooLarge(1),
      checkParse(null),
      checkTriCount(1),
      checkScale([1, 1, 1]),
      checkVolume(0.5),
      checkFloaters(0.3),
      checkColor({ textures: tex, vertexColors: true, missingTextures: 1 }),
      checkTextureResolution(tex)!,
      checkMeshQuality({
        triCount: 1,
        degenerateFaces: 1,
        edges: 1,
        nonManifoldEdges: 1,
      }),
    ];
    const report = buildQcReport(checks, [1.23456, 2, 3]);
    expect(() => assertQcReport(report)).not.toThrow();
    expect(report.extents_m).toEqual({ width: 1.235, height: 2, depth: 3 });
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
  });
});
