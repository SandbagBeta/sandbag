import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { flattenDocument } from "../qc/gltf";
import { meshSurfaceFromParsed } from "./surface";
import { pointTriangleDistance } from "./validate";

/**
 * Two meshes at different node translations: A (1 triangle) at x=+10, then
 * B (2 triangles) at y=+5. Scene order is A, B.
 */
function twoMeshDoc() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const add = (
    positions: number[],
    indices: number[],
    translation: [number, number, number],
  ) => {
    const prim = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array(positions))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint16Array(indices))
          .setBuffer(buffer),
      );
    const node = doc
      .createNode()
      .setMesh(doc.createMesh().addPrimitive(prim))
      .setTranslation(translation);
    scene.addChild(node);
  };
  add([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [10, 0, 0]);
  add([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3], [0, 5, 0]);
  return doc;
}

const tri = (
  m: { positions: ArrayLike<number>; indices: ArrayLike<number> },
  face: number,
) =>
  [0, 1, 2].map((k) => {
    const v = m.indices[face * 3 + k]!;
    return [0, 1, 2].map((c) => m.positions[v * 3 + c]!) as [
      number,
      number,
      number,
    ];
  }) as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];

describe("meshSurfaceFromParsed (face_index contract, #22 B)", () => {
  const parsed = flattenDocument(twoMeshDoc(), "glb");
  const surface = meshSurfaceFromParsed(parsed);

  it("numbers faces globally, in scene order across primitives", () => {
    expect(surface.indices.length / 3).toBe(3);
    // Face 0 is mesh A (x ~ 10..11); faces 1 and 2 are mesh B (y ~ 5..6).
    const [a] = tri(surface, 0);
    expect(a![0]).toBeCloseTo(10, 5);
    const [b1] = tri(surface, 1);
    const [b2] = tri(surface, 2);
    expect(b1![1]).toBeCloseTo(5, 5);
    expect(b2![1]).toBeCloseTo(5, 5);
    // B's local indices are offset past A's three vertices.
    expect(Array.from(surface.indices)).toEqual([0, 1, 2, 3, 4, 5, 3, 5, 6]);
  });

  it("puts a surface point on its face in the GLB frame", () => {
    // Centroid of face 2 in world coordinates: B's second triangle, translated.
    const world: [number, number, number] = [
      (0 + 1 + 0) / 3,
      5 + (0 + 1 + 1) / 3,
      0,
    ];
    const [a, b, c] = tri(surface, 2);
    expect(pointTriangleDistance(world, a, b, c)).toBeLessThan(1e-4);
  });

  it("is needed: raw parsed positions are shifted by the bounding-box centre", () => {
    expect(parsed.centre.some((v) => Math.abs(v) > 1)).toBe(true);
    const world: [number, number, number] = [1 / 3, 5 + 2 / 3, 0];
    const [a, b, c] = tri(parsed, 2);
    expect(pointTriangleDistance(world, a, b, c)).toBeGreaterThan(1);
  });
});
