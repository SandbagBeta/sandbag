/**
 * fuzzed_1km (ADR 001, rule P5): a deterministic, non-reversible offset.
 *
 * offset = HMAC-SHA256(LOCATION_FUZZ_SECRET, "sandbag:fuzz:v1:" + areaId),
 * mapped uniformly onto an annulus of 200-1000 m around the point. The same
 * area always gets the same point, so repeated requests cannot be averaged
 * back to the truth (no per-request jitter), and without the secret the
 * offset cannot be predicted or undone. The 200 m floor keeps an unlucky draw
 * from landing on top of the real spot.
 *
 * Rotating the secret moves every fuzzed point; anyone holding old and new
 * points can intersect the two disks. Do not rotate it casually.
 */
import "server-only";
import { createHmac } from "node:crypto";

export const FUZZ_MIN_METERS = 200;
export const FUZZ_MAX_METERS = 1000;
export const FUZZ_SECRET_MIN_LENGTH = 32;
const FUZZ_SECRET_VAR = "LOCATION_FUZZ_SECRET";
const EARTH_RADIUS_M = 6_371_008.8;

export interface Point {
  lat: number;
  lng: number;
}

/** The fuzz secret, or null if it is missing or too short. Never throws. */
export function getFuzzSecret(
  source: Record<string, string | undefined> = process.env,
): string | null {
  const value = source[FUZZ_SECRET_VAR]?.trim();
  return value && value.length >= FUZZ_SECRET_MIN_LENGTH ? value : null;
}

export const FUZZ_SECRET_WARNING = `[location] ${FUZZ_SECRET_VAR} is missing or shorter than ${FUZZ_SECRET_MIN_LENGTH} characters; fuzzed_1km areas are returned as hidden. See .env.example.`;

/** Distance (m) and bearing (radians, clockwise from north) for an area. */
export function fuzzOffset(areaId: string, secret: string) {
  const mac = createHmac("sha256", secret)
    .update(`sandbag:fuzz:v1:${areaId.toLowerCase()}`)
    .digest();
  const u1 = mac.readUIntBE(0, 6) / 2 ** 48;
  const u2 = mac.readUIntBE(6, 6) / 2 ** 48;
  // sqrt makes the draw uniform over the annulus's area, not its radius.
  const distanceM = Math.sqrt(
    FUZZ_MIN_METERS ** 2 + u1 * (FUZZ_MAX_METERS ** 2 - FUZZ_MIN_METERS ** 2),
  );
  return { distanceM, bearing: 2 * Math.PI * u2 };
}

/**
 * Move `point` by the area's offset along a great circle. Spherical math
 * handles the shrinking longitude degree toward the poles; latitude is
 * clamped and longitude wrapped to [-180, 180).
 */
export function fuzzPoint(point: Point, areaId: string, secret: string): Point {
  const { distanceM, bearing } = fuzzOffset(areaId, secret);
  const toRad = Math.PI / 180;
  const d = distanceM / EARTH_RADIUS_M;
  const lat1 = point.lat * toRad;
  const lng1 = point.lng * toRad;
  const sinLat2 =
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * sinLat2,
    );
  const lat = Math.max(-90, Math.min(90, lat2 / toRad));
  const lng = ((((lng2 / toRad + 180) % 360) + 360) % 360) - 180;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("[location] fuzzing produced a non-finite point");
  }
  return { lat, lng };
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
