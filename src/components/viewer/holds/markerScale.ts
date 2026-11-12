/**
 * Marker sizing from the scan's size (issue #133). Scans arrive in arbitrary
 * file units, so marker geometry (authored for a ~4 m boulder, in metres) is
 * scaled by the mesh bounding-box diagonal, then by the user's size slider.
 * Pure: no three.js, no React.
 */

/** Bounding-box diagonal (file units) the marker constants were authored for. */
export const REFERENCE_DIAGONAL = 4;
export const MIN_AUTO_SCALE = 0.02;
export const MAX_AUTO_SCALE = 10;

export const MIN_SIZE_PERCENT = 50;
export const MAX_SIZE_PERCENT = 200;
export const DEFAULT_SIZE_PERCENT = 100;
export const SIZE_STEP_PERCENT = 10;

/** Multiplier for marker geometry and surface offsets on a scan of this diagonal. */
export function markerScale(diagonal: number | null | undefined): number {
  if (!diagonal || !Number.isFinite(diagonal) || diagonal <= 0) return 1;
  return Math.min(
    MAX_AUTO_SCALE,
    Math.max(MIN_AUTO_SCALE, diagonal / REFERENCE_DIAGONAL),
  );
}

/** Clamp to the slider's range; anything unusable becomes the default. */
export function clampSizePercent(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_SIZE_PERCENT;
  return Math.min(MAX_SIZE_PERCENT, Math.max(MIN_SIZE_PERCENT, Math.round(n)));
}

/** Final multiplier: scan-derived scale times the user's percentage. */
export function effectiveMarkerScale(
  diagonal: number | null | undefined,
  percent: number,
): number {
  return markerScale(diagonal) * (clampSizePercent(percent) / 100);
}
