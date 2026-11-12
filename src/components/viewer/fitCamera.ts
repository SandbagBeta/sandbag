import { Box3, Vector3, type Object3D } from "three";
import type { Vec3 } from "@/lib/types";

/** Camera + OrbitControls settings derived from a scan's bounding box. */
export interface CameraFit {
  /** Orbit target: center of the bounds. */
  target: Vector3;
  /** Initial camera position: in front, slightly above, looking at target. */
  position: Vector3;
  /** Bounding-sphere radius of the scan. */
  radius: number;
  /** y of the ground plane (bottom of the bounds). */
  groundY: number;
  minDistance: number;
  maxDistance: number;
  /** Slightly above horizontal so the camera can't dip under the ground. */
  maxPolarAngle: number;
  near: number;
  far: number;
}

export interface FitOptions {
  /**
   * Outward direction of the scan's dominant surface (e.g. mean hold normal).
   * The camera goes on this side. Missing or near-vertical: default view.
   */
  facing?: Vec3 | null;
  /** Vertical field of view in degrees (we use 50; r3f default is 75). */
  fovDeg?: number;
  /** Extra breathing room around the bounding sphere. */
  margin?: number;
}

export const NO_GEOMETRY_MESSAGE = "scan has no geometry";

/**
 * World-space bounds of a loaded scan. Throws `NO_GEOMETRY_MESSAGE` when the
 * object has no measurable geometry (no meshes, NaN positions, or all
 * vertices at one point) so the error boundary shows it instead of the
 * loading overlay hanging forever.
 */
export function measureBounds(object: Object3D): Box3 {
  const box = new Box3().setFromObject(object, true);
  assertUsableBounds(box);
  return box;
}

/** Returns the box size, or throws `NO_GEOMETRY_MESSAGE` if unusable. */
function assertUsableBounds(box: Box3): Vector3 {
  if (box.isEmpty()) throw new Error(NO_GEOMETRY_MESSAGE);
  const size = box.getSize(new Vector3());
  const finite = [...box.min.toArray(), ...box.max.toArray()].every(
    Number.isFinite,
  );
  if (!finite || size.length() === 0) throw new Error(NO_GEOMETRY_MESSAGE);
  return size;
}

/** Direction from target to the default camera position (right, up, front). */
const VIEW_DIRECTION = new Vector3(0.6, 0.45, 1).normalize();

const ELEVATION = 0.45;

/** Unit mean of surface normals, or null when empty or they cancel out. */
export function dominantNormal(normals: readonly Vec3[]): Vec3 | null {
  const sum = new Vector3();
  for (const n of normals) {
    const v = new Vector3(...n);
    if (Number.isFinite(v.lengthSq())) sum.add(v);
  }
  if (sum.length() < 1e-6) return null;
  sum.normalize();
  return [sum.x, sum.y, sum.z];
}

/**
 * Camera direction (from target) for a surface facing `facing`: the normal's
 * horizontal part, raised slightly. Floors/ceilings (no horizontal part) and
 * missing normals use the default view.
 */
export function viewDirectionFor(facing?: Vec3 | null): Vector3 {
  if (facing) {
    const h = new Vector3(facing[0], 0, facing[2]);
    if (h.length() > 0.2) {
      h.normalize();
      return new Vector3(h.x, ELEVATION, h.z).normalize();
    }
  }
  return VIEW_DIRECTION.clone();
}

/**
 * Pure bounds → camera/controls math; keeps three.js math out of components
 * and testable without WebGL. Scale-independent: works for a 2 m boulder or
 * a 20 m cliff band.
 */
export function computeCameraFit(
  box: Box3,
  { fovDeg = 50, margin = 1.1, facing = null }: FitOptions = {},
): CameraFit {
  const size = assertUsableBounds(box);
  const target = box.getCenter(new Vector3());
  const radius = size.length() / 2;

  const halfFov = (fovDeg * Math.PI) / 360;
  const distance = (radius / Math.sin(halfFov)) * margin;
  const position = target
    .clone()
    .addScaledVector(viewDirectionFor(facing), distance);

  return {
    target,
    position,
    radius,
    groundY: box.min.y,
    minDistance: radius * 0.25,
    maxDistance: radius * 8,
    maxPolarAngle: Math.PI / 2 - 0.02,
    near: Math.max(radius / 100, 0.001),
    far: radius * 50,
  };
}

/**
 * True when the camera (offset from the orbit target) is on the far side of a
 * surface facing `facing`, so only the back of a one-sided scan is in view.
 * Cameras already on the front half are left alone (never steal the orbit).
 */
export function isBehind(offset: Vector3, facing?: Vec3 | null): boolean {
  if (!facing || offset.lengthSq() === 0) return false;
  const h = new Vector3(facing[0], 0, facing[2]);
  if (h.length() <= 0.2) return false;
  return offset.clone().setY(0).normalize().dot(h.normalize()) < 0;
}
