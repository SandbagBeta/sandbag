import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicUrl } from "@/lib/storage";
import type { Climb, ClimbPath, Hold, Scan } from "@/lib/types";

/**
 * Data for the public boulder page (/boulder/[id], issue #12). A "boulder" is
 * a published scan plus its published climbs. Reads use the request's
 * anon/user client, so RLS applies; we additionally filter on `published`
 * because RLS also lets an uploader read their own unpublished scans, and this
 * page (and its OG tags) is public.
 *
 * Nothing here carries geographic location: holds and paths are mesh-local
 * (types.ts). Area names come from OpenBeta and are public (ADR 001 D2).
 */
export interface BoulderData {
  scan: Pick<
    Scan,
    | "id"
    | "openbeta_area_id"
    | "content_hash"
    | "tri_count"
    | "capture_app"
    | "captured_at"
    | "license"
    | "scale_factor"
    | "created_at"
  > & { glb_path: string };
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isScanId(value: string): boolean {
  return UUID.test(value);
}

export class BoulderLoadError extends Error {
  constructor(what: string, cause: { message: string }) {
    super(`Could not load ${what}: ${cause.message}`);
    this.name = "BoulderLoadError";
  }
}

/** Returns null when the id is malformed or no published scan has it. */
export async function loadBoulder(
  db: SupabaseClient,
  id: string,
): Promise<BoulderData | null> {
  if (!isScanId(id)) return null;

  const scanRes = await db
    .from("scans")
    .select(
      "id, openbeta_area_id, glb_path, content_hash, tri_count, capture_app, captured_at, license, scale_factor, created_at",
    )
    .eq("id", id.toLowerCase())
    .eq("status", "published")
    .maybeSingle();
  if (scanRes.error) throw new BoulderLoadError("scan", scanRes.error);
  const scan = scanRes.data as BoulderData["scan"] | null;
  if (!scan?.glb_path) return null;

  const climbRes = await db
    .from("climbs")
    .select(
      "id, scan_id, name, description, proposed_grade, fa_info, status, created_by",
    )
    .eq("scan_id", scan.id)
    .eq("status", "published")
    .order("name");
  if (climbRes.error) throw new BoulderLoadError("climbs", climbRes.error);
  const climbs = (climbRes.data ?? []) as Climb[];
  if (climbs.length === 0) return { scan, climbs, holds: [], paths: [] };

  const ids = climbs.map((c) => c.id);
  const [holdRes, pathRes] = await Promise.all([
    db.from("holds").select("*").in("climb_id", ids),
    db.from("paths").select("*").in("climb_id", ids),
  ]);
  if (holdRes.error) throw new BoulderLoadError("holds", holdRes.error);
  if (pathRes.error) throw new BoulderLoadError("paths", pathRes.error);
  return {
    scan,
    climbs,
    holds: (holdRes.data ?? []) as Hold[],
    paths: (pathRes.data ?? []) as ClimbPath[],
  };
}

/** Public URL of an object in the `published` bucket (public read, ADR 002). */
export function publishedGlbUrl(supabaseUrl: string, glbPath: string): string {
  return supabasePublicUrl(supabaseUrl, "published", glbPath);
}

/**
 * Page title and one-line description for <title>, meta and Open Graph.
 * Built only from names and grades: never coordinates (CLAUDE.md value 1).
 */
export function describeBoulder(
  data: Pick<BoulderData, "climbs">,
  areaName: string | null,
): { title: string; description: string } {
  const title = areaName ?? "Boulder scan";
  const subject = areaName ? `3D scan of ${areaName}` : "3D boulder scan";
  const n = data.climbs.length;
  const grades = [...new Set(data.climbs.map((c) => c.proposed_grade))];
  const description =
    n === 0
      ? `${subject}. No climbs annotated yet.`
      : `${subject} with ${n} climb${n === 1 ? "" : "s"} (${grades.join(", ")}): ${data.climbs
          .map((c) => c.name)
          .join(", ")}.`;
  return { title, description };
}
