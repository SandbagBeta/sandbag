import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Raycaster,
  Vector3,
} from "three";
import { flattenDocument } from "@/lib/qc/gltf";
import { buildFaceOffsets, isClick, pickFromHit } from "./pick";

// Mesh A: 2 triangles (indexed quad). Mesh B: 1 triangle, moved to x=10 and
// scaled 2x in y. Same fixture is built for three.js and for flattenDocument.
const A_POS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const A_IDX = [0, 1, 2, 0, 2, 3];
const B_POS = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const B_IDX = [0, 1, 2];

function threeScene() {
  const mk = (pos: number[], idx: number[], x: number, sy: number) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    const m = new Mesh(g);
    m.position.set(x, 0, 0);
    m.scale.set(1, sy, 1);
    return m;
  };
  const root = new Group();
  const a = mk(A_POS, A_IDX, 0, 1);
  const b = mk(B_POS, B_IDX, 10, 2);
  root.add(a, b);
  root.updateMatrixWorld(true);
  return { root, a, b };
}

function gltfDoc() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const add = (pos: number[], idx: number[], x: number, sy: number) => {
    const prim = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array(pos))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Uint16Array(idx))
          .setBuffer(buffer),
      );
    scene.addChild(
      doc
        .createNode()
        .setMesh(doc.createMesh().addPrimitive(prim))
        .setTranslation([x, 0, 0])
        .setScale([1, sy, 1]),
    );
  };
  add(A_POS, A_IDX, 0, 1);
  add(B_POS, B_IDX, 10, 2);
  return doc;
}

describe("pickFromHit", () => {
  it("global face index matches flattenDocument order", () => {
    const { root, b } = threeScene();
    const flat = flattenDocument(gltfDoc(), "glb");
    const offsets = buildFaceOffsets(root);
    expect(offsets.get(b)).toBe(2);

    // Ray down -z through mesh B's triangle (world x=10.2, y=0.5).
    const hit = new Raycaster(
      new Vector3(10.2, 0.5, 5),
      new Vector3(0, 0, -1),
    ).intersectObject(root, true)[0]!;
    const pick = pickFromHit(hit, offsets)!;
    expect(pick.faceIndex).toBe(2);

    // Triangle 2 of the flattened mesh is mesh B's (same index space).
    const xs = [0, 1, 2].map(
      (k) => flat.positions[flat.indices[pick.faceIndex * 3 + k]! * 3]!,
    );
    const centre = flat.centre as unknown as ArrayLike<number>;
    expect(Math.min(...xs) + centre[0]!).toBeCloseTo(10);
    expect(Math.max(...xs) + centre[0]!).toBeCloseTo(11);
  });

  it("flips the normal toward the viewer when the hit is on a back face", () => {
    const { root } = threeScene();
    const offsets = buildFaceOffsets(root);
    // Mesh A's triangles face +z. Front hit: ray travels -z; back hit: +z.
    const front = new Raycaster(
      new Vector3(0.8, 0.2, 5),
      new Vector3(0, 0, -1),
    );
    const fh = front.intersectObject(root, true)[0]!;
    expect(
      pickFromHit(fh, offsets, front.ray.direction)!.normal[2],
    ).toBeCloseTo(1);
    const back = new Raycaster(new Vector3(0.8, 0.2, -5), new Vector3(0, 0, 1));
    // Same face, seen from behind (the default material would cull this hit).
    const flipped = pickFromHit(fh, offsets, back.ray.direction)!;
    expect(flipped.normal[2]).toBeCloseTo(-1);
  });

  it("first mesh keeps its local index", () => {
    const { root } = threeScene();
    const hit = new Raycaster(
      new Vector3(0.8, 0.2, 5),
      new Vector3(0, 0, -1),
    ).intersectObject(root, true)[0]!;
    expect(pickFromHit(hit, buildFaceOffsets(root))!.faceIndex).toBe(
      hit.faceIndex,
    );
  });

  it("returns world point and unit normal via the normal matrix", () => {
    const { root, b } = threeScene();
    b.rotation.x = Math.PI / 2; // local +z -> world -y
    b.scale.set(1, 1, 3); // non-uniform scale must not skew the normal
    root.updateMatrixWorld(true);
    const hit = new Raycaster(
      new Vector3(10.2, -5, 0.3),
      new Vector3(0, 1, 0),
    ).intersectObject(b, false)[0]!;
    const p = pickFromHit(hit, buildFaceOffsets(root))!;
    expect(p.position[0]).toBeCloseTo(10.2);
    expect(p.position[1]).toBeCloseTo(0);
    expect(Math.hypot(...p.normal)).toBeCloseTo(1);
    expect(p.normal[1]!).toBeCloseTo(-1);
  });

  it("maps a hit on a scaled scene back to the GLB frame (#137)", () => {
    const factor = 13.3;
    const plain = threeScene();
    const plainHit = new Raycaster(
      new Vector3(10.2, 0.5, 5),
      new Vector3(0, 0, -1),
    ).intersectObject(plain.root, true)[0]!;
    const want = pickFromHit(plainHit, buildFaceOffsets(plain.root))!;

    // Same scan under a scaled parent, picked by a ray in displayed units.
    const scaled = threeScene();
    const parent = new Group();
    parent.scale.setScalar(factor);
    parent.add(scaled.root);
    parent.updateMatrixWorld(true);
    const ray = new Raycaster(
      new Vector3(10.2 * factor, 0.5 * factor, 5 * factor),
      new Vector3(0, 0, -1),
    );
    const hit = ray.intersectObject(scaled.root, true)[0]!;
    const got = pickFromHit(
      hit,
      buildFaceOffsets(scaled.root),
      ray.ray.direction,
      factor,
    )!;

    expect(got.faceIndex).toBe(want.faceIndex);
    got.position.forEach((v, i) => expect(v).toBeCloseTo(want.position[i]!));
    got.normal.forEach((v, i) => expect(v).toBeCloseTo(want.normal[i]!));
    // Without the factor the stored hold would be 13.3x off the surface.
    expect(
      pickFromHit(hit, buildFaceOffsets(scaled.root))!.position[0],
    ).toBeCloseTo(want.position[0]! * factor);
  });

  it("returns null for meshes outside the offset map", () => {
    const { b } = threeScene();
    const hit = new Raycaster(
      new Vector3(10.2, 0.5, 5),
      new Vector3(0, 0, -1),
    ).intersectObject(b, false)[0]!;
    expect(pickFromHit(hit, new Map())).toBeNull();
  });
});

describe("isClick", () => {
  it("treats <=4px as a click and more as a drag", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
  });
});
