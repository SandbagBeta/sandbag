import type { Vec3 } from "@/lib/types";

/** Azimuth (radians, around +y, 0 at +z) of a direction: how three's OrbitControls measures it. */
export function azimuthOf(v: Vec3): number {
  return Math.atan2(v[0], v[2]);
}

/** Smallest signed angle from `a` to `b`, in (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface SweepPlan {
  /** Camera azimuth the swing is centred on. */
  center: number;
  /** Half-width of the swing. */
  amplitude: number;
  /** Camera azimuth that faces each climb head-on, in input order. */
  faces: number[];
}

const MIN_AMPLITUDE = (35 * Math.PI) / 180;
const MAX_AMPLITUDE = (80 * Math.PI) / 180;
const MARGIN = (25 * Math.PI) / 180;

/**
 * A back-and-forth swing that brings every climb's face in front of the camera.
 * `facings` are the climbs' dominant outward normals (null when a climb has no
 * usable one, which is skipped). One climb gives a gentle swing around it.
 */
export function planSweep(facings: readonly (Vec3 | null)[]): SweepPlan {
  const faces = facings.map((f) => (f ? azimuthOf(f) : NaN));
  const known = faces.filter((a) => Number.isFinite(a));
  const ref = known[0];
  if (ref === undefined) {
    return { center: 0, amplitude: MIN_AMPLITUDE, faces };
  }
  // Centre on the middle of the arc that holds every face (circular, so a
  // pair at +170 and -170 degrees centres on 180, not 0).
  const rel = known.map((a) => angleDelta(ref, a));
  const lo = Math.min(...rel);
  const hi = Math.max(...rel);
  const center = ref + (lo + hi) / 2;
  const half = (hi - lo) / 2;
  const amplitude = Math.min(
    MAX_AMPLITUDE,
    Math.max(MIN_AMPLITUDE, half + MARGIN),
  );
  return { center, amplitude, faces };
}

/** Camera azimuth at `phase` radians into the swing. */
export function sweepAzimuth(plan: SweepPlan, phase: number): number {
  return plan.center + plan.amplitude * Math.sin(phase);
}

/**
 * The climb whose face the camera is closest to. Sticks with `current` unless
 * another climb is closer by `hysteresis` radians, so the caption does not flicker
 * where two faces are equally near.
 */
export function activeClimbIndex(
  plan: SweepPlan,
  azimuth: number,
  current: number,
  hysteresis = (8 * Math.PI) / 180,
): number {
  let best = -1;
  let bestDist = Infinity;
  plan.faces.forEach((f, i) => {
    if (!Number.isFinite(f)) return;
    const d = Math.abs(angleDelta(azimuth, f));
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  if (best === -1) return current;
  const cur = plan.faces[current];
  if (cur !== undefined && Number.isFinite(cur)) {
    const curDist = Math.abs(angleDelta(azimuth, cur));
    if (curDist - bestDist < hysteresis) return current;
  }
  return best;
}
