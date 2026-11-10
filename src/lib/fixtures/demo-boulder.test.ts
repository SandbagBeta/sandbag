// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateBoulder } from "../../../scripts/lib/boulder-geometry.mjs";
import { buildGLB, readGLB } from "../../../scripts/lib/glb.mjs";
import {
  distanceToFace,
  faceNormal,
  nearestSurfacePoint,
} from "../../../scripts/lib/mesh-surface.mjs";
import { demoBoulder, holdsForClimb, pathsForClimb } from "./index";
import type { HoldType, PathKind, Vec3 } from "@/lib/types";

const GLB = fileURLToPath(
  new URL("../../../public/fixtures/demo-boulder.glb", import.meta.url),
);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const SURFACE_EPSILON = 0.002; // 2 mm — well above quantization error (~0.2 mm)

let bytes: Buffer;
let mesh: Awaited<ReturnType<typeof readGLB>>;
beforeAll(async () => {
  bytes = await readFile(GLB);
  mesh = await readGLB(bytes);
});

describe("generator determinism", () => {
  it("regenerating yields the committed bytes and content hash", async () => {
    const fresh = await buildGLB(generateBoulder(), { name: "demo-boulder" });
    expect(sha256(fresh)).toBe(sha256(bytes));
    expect(sha256(bytes)).toBe(demoBoulder.scan.content_hash);
  }, 30_000);
});

describe("demo-boulder.glb sanity", () => {
  it("is a small meshopt-compressed GLB with one primitive", () => {
    expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
    expect(mesh.extensions).toContain("EXT_meshopt_compression");
    expect(mesh.hasColors).toBe(true);
  });

  it("has a boulder-sized triangle count", () => {
    expect(mesh.triCount).toBeGreaterThanOrEqual(40_000);
    expect(mesh.triCount).toBeLessThanOrEqual(80_000);
    expect(mesh.triCount).toBe(demoBoulder.scan.tri_count);
  });

  it("is Y-up, in meters, centered with the ground at y = 0", () => {
    const { min, max } = mesh.bounds;
    expect(Math.abs(min[1])).toBeLessThan(0.005);
    expect(max[1]).toBeGreaterThan(1.5);
    expect(max[1]).toBeLessThan(2.1);
    expect(max[0] - min[0]).toBeGreaterThan(2.0);
    expect(max[0] - min[0]).toBeLessThan(3.0);
    expect(Math.abs(min[0] + max[0])).toBeLessThan(0.01);
    expect(Math.abs(min[2] + max[2])).toBeLessThan(0.01);
  });
});

describe("fixture holds and paths", () => {
  it("every hold lies on its referenced face with a matching normal", () => {
    for (const h of demoBoulder.holds) {
      expect(h.scan_content_hash).toBe(demoBoulder.scan.content_hash);
      expect(h.face_index).toBeLessThan(mesh.triCount);
      expect(distanceToFace(mesh, h.face_index, h.position)).toBeLessThan(
        SURFACE_EPSILON,
      );
      const n = faceNormal(mesh, h.face_index) as Vec3;
      const dot = n[0] * h.normal[0] + n[1] * h.normal[1] + n[2] * h.normal[2];
      expect(dot).toBeGreaterThan(0.99);
    }
  });

  it("every path point lies on the mesh surface", () => {
    for (const p of demoBoulder.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      for (const pt of p.points) {
        const { face_index } = nearestSurfacePoint(mesh, pt);
        expect(distanceToFace(mesh, face_index, pt)).toBeLessThan(
          SURFACE_EPSILON,
        );
      }
    }
  });

  it("has two climbs with distinct hold sets, all hold types and all path kinds", () => {
    expect(demoBoulder.climbs).toHaveLength(2);
    const holdIds = demoBoulder.climbs.map(
      (c) => new Set(holdsForClimb(c.id).map((h) => h.id)),
    );
    expect([...holdIds[0]!].some((id) => holdIds[1]!.has(id))).toBe(false);
    for (const c of demoBoulder.climbs) {
      expect(c.scan_id).toBe(demoBoulder.scan.id);
      const holds = holdsForClimb(c.id);
      const types = new Set<HoldType>(holds.map((h) => h.type));
      expect([...types].sort()).toEqual(["finish", "foot", "hand", "start"]);
      expect(holds.map((h) => h.seq_order)).toEqual(holds.map((_, i) => i));
      const kinds = pathsForClimb(c.id).map((p) => p.kind);
      expect(kinds.sort()).toEqual<PathKind[]>(["downclimb", "line", "topout"]);
    }
  });
});
