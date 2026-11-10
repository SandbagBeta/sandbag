/**
 * The location-privacy formatter (PRD §2.2, ADR 001 P1-P5). SERVER ONLY.
 *
 * Every code path that outputs coordinates (API responses, HTML, OG tags,
 * logs, exports) MUST get them from `getAreaLocation` / `getClimbLocation`.
 * They are the only readers of the locked-down `*_coords` tables, and the
 * `sandbag/no-raw-coordinates` lint rule blocks coordinate code anywhere
 * outside this file and src/lib/location/**.
 *
 *   const loc = await getAreaLocation(areaId);
 *   if (loc.privacy === "exact" || loc.privacy === "fuzzed_1km") {
 *     render(loc.lat, loc.lng);
 *   } // "hidden" / "unavailable": no coordinates exist on the object at all
 *
 * The functions never throw: any failure resolves to `{ privacy: "hidden" }`
 * and is logged without coordinates.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv, getServiceRoleKey } from "./supabase/env";
import type { LocationPrivacy } from "./types";
import { FUZZ_SECRET_WARNING, fuzzPoint, getFuzzSecret } from "./location/fuzz";
import {
  resolveEffectivePrivacy,
  type PrivacyChain,
  type PrivacyDecision,
} from "./location/privacy";

/** Corner order as stored by the OpenBeta client (#27 pins it with a parser test). */
export type Bbox = [number, number, number, number];

export type LocationOutput =
  | { privacy: "exact"; lat: number; lng: number; bbox: Bbox | null }
  /** No bbox: a bounding box encodes the real location. */
  | { privacy: "fuzzed_1km"; lat: number; lng: number }
  | { privacy: "hidden" }
  /** Not hidden, but no usable coordinates are cached. */
  | { privacy: "unavailable" };

export interface LocationOptions {
  /** Service-role client; defaults to one built from env. Injected in tests. */
  client?: SupabaseClient;
  /** Env source for LOCATION_FUZZ_SECRET; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

const HIDDEN: LocationOutput = Object.freeze({ privacy: "hidden" });
const UNAVAILABLE: LocationOutput = Object.freeze({ privacy: "unavailable" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let serviceClient: SupabaseClient | null = null;
function db(opts: LocationOptions): SupabaseClient {
  if (opts.client) return opts.client;
  serviceClient ??= createClient(
    getPublicSupabaseEnv().url,
    getServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return serviceClient;
}

/** Thrown for any failed query; carries only the PostgREST error code. */
class LookupError extends Error {
  constructor(readonly code: string) {
    super(`[location] lookup failed (${code})`);
  }
}

function check<T>(res: { data: T; error: { code?: string } | null }): T {
  if (res.error) throw new LookupError(res.error.code ?? "unknown");
  return res.data;
}

/** Log a fail-closed event. Only the id and an error code, never row data. */
function logFailure(id: string, err: unknown) {
  const code =
    err instanceof LookupError ? err.code : (err as Error)?.name || "error";
  console.error("[location] failing closed to hidden", { id, code });
}

async function loadChain(
  client: SupabaseClient,
  areaId: string,
): Promise<PrivacyChain> {
  const area = check(
    await client
      .from("area_cache")
      .select("openbeta_area_id, ancestors, path_tokens, ancestors_changed_at")
      .eq("openbeta_area_id", areaId)
      .maybeSingle(),
  );
  if (!area || !Array.isArray(area.ancestors)) {
    return { areaId, area, ancestorRows: [], privacyRows: [] };
  }
  const ancestors = area.ancestors as string[];
  const [ancestorRes, privacyRes] = await Promise.all([
    ancestors.length
      ? client
          .from("area_cache")
          .select("openbeta_area_id, ancestors_changed_at")
          .in("openbeta_area_id", ancestors)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("area_privacy")
      .select("openbeta_area_id, location_privacy")
      .in("openbeta_area_id", [...ancestors, areaId]),
  ]);
  return {
    areaId,
    area,
    ancestorRows: check(ancestorRes) ?? [],
    privacyRows: check(privacyRes) ?? [],
  };
}

async function decide(
  client: SupabaseClient,
  areaId: string,
): Promise<PrivacyDecision> {
  if (!UUID.test(areaId)) return { privacy: "hidden", cause: "uncached" };
  return resolveEffectivePrivacy(await loadChain(client, areaId));
}

const isLat = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 90;
const isLng = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 180;

function toBbox(v: unknown): Bbox | null {
  return Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (v as Bbox)
    : null;
}

async function readCoords(
  client: SupabaseClient,
  table: "area_cache_coords" | "climb_cache_coords",
  id: string,
) {
  const key =
    table === "area_cache_coords" ? "openbeta_area_id" : "openbeta_climb_id";
  const columns = table === "area_cache_coords" ? "lat, lng, bbox" : "lat, lng";
  const row = check(
    await client.from(table).select(columns).eq(key, id).maybeSingle(),
  ) as { lat?: unknown; lng?: unknown; bbox?: unknown } | null;
  if (!row || !isLat(row.lat) || !isLng(row.lng)) return null;
  return { lat: row.lat, lng: row.lng, bbox: toBbox(row.bbox) };
}

/** Fuzzed point of the anchor area. Shared by every descendant and climb (P5). */
async function fuzzed(
  client: SupabaseClient,
  anchorId: string,
  opts: LocationOptions,
): Promise<LocationOutput> {
  const secret = getFuzzSecret(opts.env);
  if (!secret) {
    console.warn(FUZZ_SECRET_WARNING);
    return HIDDEN;
  }
  const raw = await readCoords(client, "area_cache_coords", anchorId);
  if (!raw) return UNAVAILABLE;
  const p = fuzzPoint(raw, anchorId, secret);
  return { privacy: "fuzzed_1km", lat: p.lat, lng: p.lng };
}

/** Coordinates for an OpenBeta area, filtered through its effective privacy. */
export async function getAreaLocation(
  areaId: string,
  opts: LocationOptions = {},
): Promise<LocationOutput> {
  try {
    const id = areaId.toLowerCase();
    const client = db(opts);
    const decision = await decide(client, id);
    if (decision.privacy === "hidden") return HIDDEN;
    if (decision.privacy === "fuzzed_1km") {
      return await fuzzed(client, decision.anchorId, opts);
    }
    const raw = await readCoords(client, "area_cache_coords", id);
    if (!raw) return UNAVAILABLE;
    return { privacy: "exact", lat: raw.lat, lng: raw.lng, bbox: raw.bbox };
  } catch (err) {
    logFailure(areaId, err);
    return HIDDEN;
  }
}

/** Coordinates for an OpenBeta climb. Its privacy is its (leaf) area's. */
export async function getClimbLocation(
  climbId: string,
  opts: LocationOptions = {},
): Promise<LocationOutput> {
  try {
    if (!UUID.test(climbId)) return HIDDEN;
    const id = climbId.toLowerCase();
    const client = db(opts);
    const climb = check(
      await client
        .from("climb_cache")
        .select("openbeta_area_id")
        .eq("openbeta_climb_id", id)
        .maybeSingle(),
    ) as { openbeta_area_id?: unknown } | null;
    if (!climb || typeof climb.openbeta_area_id !== "string") return HIDDEN;
    const decision = await decide(client, climb.openbeta_area_id);
    if (decision.privacy === "hidden") return HIDDEN;
    if (decision.privacy === "fuzzed_1km") {
      return await fuzzed(client, decision.anchorId, opts);
    }
    const raw = await readCoords(client, "climb_cache_coords", id);
    if (!raw) return UNAVAILABLE;
    return { privacy: "exact", lat: raw.lat, lng: raw.lng, bbox: null };
  } catch (err) {
    logFailure(climbId, err);
    return HIDDEN;
  }
}

/** Effective privacy without coordinates, e.g. for a "location hidden" notice. */
export async function getEffectivePrivacy(
  areaId: string,
  opts: LocationOptions = {},
): Promise<LocationPrivacy> {
  try {
    return (await decide(db(opts), areaId.toLowerCase())).privacy;
  } catch (err) {
    logFailure(areaId, err);
    return "hidden";
  }
}

export interface FlagAreaInput {
  areaId: string;
  /** The authenticated contributor's profile id, taken from the session, never from request input. */
  profileId: string;
  reason: string;
}

/**
 * A contributor marks an area as sensitive (e.g. at upload). It can only
 * ESCALATE: it inserts a `hidden` row when the area has none, and leaves any
 * existing row (of any value) untouched. Uses the service role because RLS
 * lets only maintainers write area_privacy; that is safe here because the
 * only possible effect is more restriction. Throws on failure so the caller
 * can tell the contributor the flag did not land.
 */
export async function flagAreaSensitive(
  input: FlagAreaInput,
  opts: Pick<LocationOptions, "client"> = {},
): Promise<{ status: "flagged" | "already_set" }> {
  const reason = input.reason?.trim();
  if (!UUID.test(input.areaId) || !UUID.test(input.profileId) || !reason) {
    throw new TypeError(
      "flagAreaSensitive: invalid areaId, profileId or reason",
    );
  }
  const { error } = await db(opts).from("area_privacy").insert({
    openbeta_area_id: input.areaId.toLowerCase(),
    location_privacy: "hidden",
    reason,
    set_by: input.profileId,
  });
  if (!error) return { status: "flagged" };
  // 23505 unique_violation: a row already exists. Never overwrite it.
  if (error.code === "23505") return { status: "already_set" };
  throw new LookupError(error.code ?? "unknown");
}
