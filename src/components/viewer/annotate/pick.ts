import { Matrix3, type Mesh, type Object3D, type Vector3 } from "three";
import type { Vec3 } from "@/lib/types";

/**
 * Pure picking math for hold placement (issue #21). No React, no GL context:
 * everything works on a three.js raycast hit, so it is unit-testable in node.
 * All geometry is mesh-local to the canonical GLB (see src/lib/types.ts).
 */

/** The slice of a three.js Intersection we read. */
export interface PickHit {
  point: Vector3;
  object: Object3D;
  faceIndex?: number | null;
  face?: { normal: Vector3 } | null;
}

export interface Pick {
  position: Vec3;
  normal: Vec3;
  /** Global triangle index, see {@link buildFaceOffsets}. */
  faceIndex: number;
}

/** Max pointer travel (px) between down and up that still counts as a click. */
export const CLICK_MOVE_PX = 4;

/** True when the pointer moved at most {@link CLICK_MOVE_PX} between down and up. */
export function isClick(
  down: { x: number; y: number },
  up: { x: number; y: number },
): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_MOVE_PX;
}

function triangleCount(mesh: Mesh): number {
  const geo = mesh.geometry;
  const n = geo.index?.count ?? geo.getAttribute("position")?.count ?? 0;
  return Math.floor(n / 3);
}

/**
 * First global face index of every mesh under `root`. Counted in the same
 * order as `flattenDocument` (src/lib/qc/gltf.ts): depth-first scene
 * traversal, primitives in order, empty meshes skipped. That is the index
 * space validateClimbAnnotations checks against, so a hit's per-mesh
 * `faceIndex` plus its mesh's offset is what must be stored on a hold.
 */
export function buildFaceOffsets(root: Object3D): Map<Object3D, number> {
  const offsets = new Map<Object3D, number>();
  let next = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const tris = triangleCount(mesh);
    if (tris === 0) return;
    offsets.set(mesh, next);
    next += tris;
  });
  return offsets;
}

/** GLB-frame point (see `scale`), world-space unit normal and global face index of a hit; null if it has no face. */
export function pickFromHit(
  hit: PickHit,
  offsets: ReadonlyMap<Object3D, number>,
  /**
   * The picking ray's direction. The scan renders double-sided, so a hit can be
   * on a face's back: the normal is then flipped to point at the viewer, so the
   * marker sits on the side that was clicked.
   */
  rayDirection?: Vector3,
  /**
   * The scene's reviewed scale (#137). The scan is displayed scaled, so the hit
   * point is in displayed units; holds are stored in the GLB frame, so the
   * position is divided by it. Normals and face numbers are unaffected.
   */
  scale = 1,
): Pick | null {
  if (!hit.face || hit.faceIndex == null) return null;
  const offset = offsets.get(hit.object);
  if (offset === undefined) return null;
  hit.object.updateWorldMatrix(true, false);
  const n = hit.face.normal
    .clone()
    .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
  if (rayDirection && n.dot(rayDirection) > 0) n.negate();
  return {
    position: [hit.point.x / scale, hit.point.y / scale, hit.point.z / scale],
    normal: [n.x, n.y, n.z],
    faceIndex: offset + hit.faceIndex,
  };
}
