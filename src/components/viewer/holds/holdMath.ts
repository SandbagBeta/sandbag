import { Quaternion, Vector3 } from "three";
import type { Hold, HoldType, Vec3 } from "@/lib/types";
import { HOLD_TYPES } from "./holdStyle";

/** Markers float this far (m) above the surface to avoid z-fighting. */
export const HOLD_SURFACE_OFFSET = 0.005;
/** The climb line floats a little higher so markers don't swallow it. */
export const LINE_SURFACE_OFFSET = 0.01;

const UP = new Vector3(0, 1, 0);

export type Quat = [x: number, y: number, z: number, w: number];

export function offsetAlongNormal(p: Vec3, normal: Vec3, d: number): Vec3 {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len === 0) return [p[0], p[1], p[2]];
  const k = d / len;
  return [p[0] + normal[0] * k, p[1] + normal[1] * k, p[2] + normal[2] * k];
}

/** Rotation taking the marker's local +Y axis onto `normal`. */
export function normalToQuaternion(normal: Vec3): Quat {
  const n = new Vector3(...normal);
  if (n.lengthSq() === 0) return [0, 0, 0, 1];
  const q = new Quaternion().setFromUnitVectors(UP, n.normalize());
  return [q.x, q.y, q.z, q.w];
}

/** World-space pose of a hold's marker (fixture holds are in the GLB world frame). */
export function markerTransform(
  hold: Hold,
  offset = HOLD_SURFACE_OFFSET,
): { position: Vec3; quaternion: Quat } {
  return {
    position: offsetAlongNormal(hold.position, hold.normal, offset),
    quaternion: normalToQuaternion(hold.normal),
  };
}

export function groupHoldsByType(holds: Hold[]): Record<HoldType, Hold[]> {
  const groups = Object.fromEntries(
    HOLD_TYPES.map((t) => [t, [] as Hold[]]),
  ) as Record<HoldType, Hold[]>;
  for (const h of holds) groups[h.type].push(h);
  return groups;
}

export function countHoldsByType(holds: Hold[]): Record<HoldType, number> {
  const groups = groupHoldsByType(holds);
  return Object.fromEntries(
    HOLD_TYPES.map((t) => [t, groups[t].length]),
  ) as Record<HoldType, number>;
}

/**
 * Paths carry no normals, so lift each point along the normal of the nearest
 * hold of the same climb (lines run hold to hold). Unchanged if no holds.
 * Points farther than `maxDist` (m) from every hold stay put: a downclimb on
 * the far side of the boulder must not borrow a normal pointing the wrong way.
 */
export function offsetPathPoints(
  points: Vec3[],
  holds: Hold[],
  d = LINE_SURFACE_OFFSET,
  maxDist = Infinity,
): Vec3[] {
  if (holds.length === 0) return points;
  const maxSq = maxDist * maxDist;
  return points.map((p) => {
    let best: Hold | undefined;
    let bestDist = Infinity;
    for (const h of holds) {
      const dist =
        (h.position[0] - p[0]) ** 2 +
        (h.position[1] - p[1]) ** 2 +
        (h.position[2] - p[2]) ** 2;
      if (dist < bestDist) [best, bestDist] = [h, dist];
    }
    return best && bestDist <= maxSq ? offsetAlongNormal(p, best.normal, d) : p;
  });
}

/** The point halfway along a polyline's length (label anchor). */
export function pathMidpoint(points: Vec3[]): Vec3 | null {
  const first = points[0];
  if (!first) return null;
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec3;
    const b = points[i] as Vec3;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segs.push(len);
    total += len;
  }
  if (total === 0) return [first[0], first[1], first[2]];
  let remaining = total / 2;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i] as number;
    if (remaining <= len && len > 0) {
      const a = points[i] as Vec3;
      const b = points[i + 1] as Vec3;
      const t = remaining / len;
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    }
    remaining -= len;
  }
  const last = points[points.length - 1] as Vec3;
  return [last[0], last[1], last[2]];
}
