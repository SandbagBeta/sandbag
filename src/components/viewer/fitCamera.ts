import { Box3, Vector3 } from "three";

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
  /** Vertical field of view in degrees (we use 50; r3f default is 75). */
  fovDeg?: number;
  /** Extra breathing room around the bounding sphere. */
  margin?: number;
}

/** Direction from target to the default camera position (right, up, front). */
const VIEW_DIRECTION = new Vector3(0.6, 0.45, 1).normalize();

/**
 * Pure bounds → camera/controls math; keeps three.js math out of components
 * and testable without WebGL. Scale-independent: works for a 2 m boulder or
 * a 20 m cliff band.
 */
export function computeCameraFit(
  box: Box3,
  { fovDeg = 50, margin = 1.1 }: FitOptions = {},
): CameraFit {
  if (box.isEmpty()) {
    throw new Error("computeCameraFit: bounding box is empty");
  }
  const target = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  // Guard degenerate (flat/point) meshes so distances stay finite.
  const radius = Math.max(size.length() / 2, 0.01);

  const halfFov = (fovDeg * Math.PI) / 360;
  const distance = (radius / Math.sin(halfFov)) * margin;
  const position = target.clone().addScaledVector(VIEW_DIRECTION, distance);

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
