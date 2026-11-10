import "server-only";
/**
 * Coordinate side of the OpenBeta cache (#27, ADR 001 §4). SERVER ONLY.
 *
 * The OpenBeta client (src/lib/openbeta/**) never reads coordinates. It
 * splices the selections below into its queries, hands each raw response
 * node to `takeAreaCoords` / `takeClimbCoords`, and gets back an opaque
 * `RawCoords` handle. The handle is an empty frozen object, so it stringifies
 * to "{}" in logs and errors. Only this module can resolve it, and it does so
 * only to write the locked-down *_coords tables with the service role.
 * Reading them back goes through src/lib/location.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bbox } from "../location";

/** GraphQL selections for coordinates. They merge with the caller's other `metadata { ... }` fields. */
export const AREA_COORDS_SELECTION = "metadata { lat lng bbox }";
export const CLIMB_COORDS_SELECTION = "metadata { lat lng }";

declare const brand: unique symbol;
/** Opaque coordinate handle. Carries nothing readable. */
export type RawCoords = { readonly [brand]: "RawCoords" };

interface Point {
  lat: number;
  lng: number;
  bbox: Bbox | null;
}
const points = new WeakMap<RawCoords, Point>();

const isLat = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 90;
const isLng = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 180;

/**
 * OpenBeta's `metadata.bbox` is `[minLng, minLat, maxLng, maxLat]`
 * (west, south, east, north): the GeoJSON order of RFC 7946 §5. Confirmed in
 * OpenBeta's source, which builds it with Turf's `bbox()`
 * (src/geo-utils.ts, src/db/utils/jobs/TreeUpdaters/updateAllAreas.ts), and in
 * the live responses recorded in src/lib/openbeta/__fixtures__ (pinned by
 * store.test.ts). We store it in the same order. Anything else is dropped.
 */
export function parseBbox(v: unknown): Bbox | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [w, s, e, n] = v as unknown[];
  if (!isLng(w) || !isLat(s) || !isLng(e) || !isLat(n)) return null;
  if (w > e || s > n) return null;
  return [w, s, e, n];
}

function take(node: unknown, withBbox: boolean): RawCoords | null {
  const meta = (node as { metadata?: Record<string, unknown> } | null)
    ?.metadata;
  if (!meta || !isLat(meta.lat) || !isLng(meta.lng)) return null;
  const handle = Object.freeze({}) as RawCoords;
  points.set(handle, {
    lat: meta.lat,
    lng: meta.lng,
    bbox: withBbox ? parseBbox(meta.bbox) : null,
  });
  return handle;
}

/** Coordinates of a raw OpenBeta `Area` node, or null when absent or invalid. */
export const takeAreaCoords = (node: unknown) => take(node, true);
/** Coordinates of a raw OpenBeta `Climb` node, or null when absent or invalid. */
export const takeClimbCoords = (node: unknown) => take(node, false);

export interface CoordsEntry {
  id: string;
  coords: RawCoords | null;
}

/** Thrown on a failed write. Carries only the PostgREST error code. */
export class CoordsWriteError extends Error {
  constructor(readonly code: string) {
    super(`[location] coords write failed (${code})`);
  }
}

async function upsert(
  client: SupabaseClient,
  table: "area_cache_coords" | "climb_cache_coords",
  entries: CoordsEntry[],
) {
  const key =
    table === "area_cache_coords" ? "openbeta_area_id" : "openbeta_climb_id";
  const rows = entries.flatMap(({ id, coords }) => {
    const p = coords && points.get(coords);
    if (!p) return [];
    const row: Record<string, unknown> = { [key]: id, lat: p.lat, lng: p.lng };
    if (table === "area_cache_coords") row.bbox = p.bbox;
    return [row];
  });
  if (!rows.length) return;
  const { error } = await client.from(table).upsert(rows, { onConflict: key });
  if (error) throw new CoordsWriteError(error.code ?? "unknown");
}

/** Upsert area coordinates (service role). Entries without coordinates are skipped. */
export const writeAreaCoords = (c: SupabaseClient, e: CoordsEntry[]) =>
  upsert(c, "area_cache_coords", e);
/** Upsert climb coordinates (service role). Entries without coordinates are skipped. */
export const writeClimbCoords = (c: SupabaseClient, e: CoordsEntry[]) =>
  upsert(c, "climb_cache_coords", e);
