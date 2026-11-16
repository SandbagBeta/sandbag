import type { SupabaseClient } from "@supabase/supabase-js";
import { cards, type BoulderCard, type ScanRow } from "../browse/load";

/**
 * Public profile data for /u/[handle]. Read with the request's own client, so
 * RLS applies, and filtered to published rows on top of it: RLS also lets a
 * reviewer (or the profile's owner) read unpublished rows, and this page is
 * public. Selects only handle, created_at and ids needed to join; the profile
 * id and any email are never returned. No coordinates (CLAUDE.md value 1).
 */

export const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

/** The handle if it is well formed, else null. Checked before any query. */
export function parseHandle(raw: unknown): string | null {
  return typeof raw === "string" && HANDLE_RE.test(raw) ? raw : null;
}

export interface PublicClimb {
  id: string;
  name: string;
  grade: string;
  scanId: string;
}

export interface PublicProfile {
  handle: string;
  /** ISO timestamp of the profile's creation. */
  memberSince: string;
  boulders: BoulderCard[];
  climbs: PublicClimb[];
}

export class ProfileLoadError extends Error {
  constructor(what: string, cause: { message: string }) {
    super(`Could not load ${what}: ${cause.message}`);
    this.name = "ProfileLoadError";
  }
}

/** Null when the handle is malformed or no profile has it (deleted accounts have none). */
export async function loadPublicProfile(
  db: SupabaseClient,
  rawHandle: string,
): Promise<PublicProfile | null> {
  const handle = parseHandle(rawHandle);
  if (!handle) return null;

  const prof = await db
    .from("profiles")
    .select("id, handle, created_at")
    .eq("handle", handle)
    .maybeSingle();
  if (prof.error) throw new ProfileLoadError("the profile", prof.error);
  const row = prof.data as {
    id: string;
    handle: string;
    created_at: string;
  } | null;
  if (!row) return null;

  const [scanRes, climbRes] = await Promise.all([
    db
      .from("scans")
      .select("id, openbeta_area_id, glb_path, content_hash")
      .eq("uploader_id", row.id)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
    db
      .from("climbs")
      .select("id, name, proposed_grade, scan_id")
      .eq("created_by", row.id)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
  ]);
  if (scanRes.error) throw new ProfileLoadError("scans", scanRes.error);
  if (climbRes.error) throw new ProfileLoadError("climbs", climbRes.error);

  // A published climb is public only while its scan is (RLS does this for
  // anonymous readers; repeated so a reviewer's view is the same).
  const climbRows = (climbRes.data ?? []) as {
    id: string;
    name: string;
    proposed_grade: string;
    scan_id: string;
  }[];
  const scanIds = [...new Set(climbRows.map((c) => c.scan_id))];
  let liveScans = new Set<string>();
  if (scanIds.length > 0) {
    const live = await db
      .from("scans")
      .select("id")
      .in("id", scanIds)
      .eq("status", "published");
    if (live.error) throw new ProfileLoadError("climbs", live.error);
    liveScans = new Set((live.data as { id: string }[]).map((s) => s.id));
  }

  return {
    handle: row.handle,
    memberSince: row.created_at,
    boulders: await cards(db, (scanRes.data ?? []) as ScanRow[]),
    climbs: climbRows
      .filter((c) => liveScans.has(c.scan_id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.proposed_grade,
        scanId: c.scan_id,
      })),
  };
}
