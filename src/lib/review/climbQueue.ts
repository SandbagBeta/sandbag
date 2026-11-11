import type { SupabaseClient } from "@supabase/supabase-js";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { handles } from "./queue";

/**
 * Pending-climb review data (issue #25). Reads use the reviewer's session
 * client: `climbs_read`, `holds_read` and `paths_read` already let reviewers
 * see pending annotations. Holds and paths are mesh-local, so nothing here
 * carries geography.
 */

/** Annotation checklist, PRD §9 / §6 annotation QC. Approve needs every item. */
export const CLIMB_CHECKLIST = [
  { id: "holds_on_rock", label: "Holds sit on the rock where the climb goes" },
  { id: "start_finish", label: "Start and finish holds are marked" },
  { id: "line_follows", label: "The line connects the holds in sequence" },
  { id: "not_duplicate", label: "It is not a duplicate of a published climb" },
] as const;

export type PendingClimb = Pick<
  Climb,
  "id" | "scan_id" | "name" | "proposed_grade"
> & { created_at: string; author_handle: string | null };

export interface ReviewClimb {
  climb: PendingClimb & Pick<Climb, "description" | "fa_info">;
  /** Canonical GLB path of the (published) scan the climb is drawn on. */
  glb_path: string | null;
  holds: Hold[];
  paths: ClimbPath[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Climb & { created_at: string };

function shape(r: Row, byId: Map<string, string>): PendingClimb {
  return {
    id: r.id,
    scan_id: r.scan_id,
    name: r.name,
    proposed_grade: r.proposed_grade,
    created_at: r.created_at,
    author_handle: (r.created_by && byId.get(r.created_by)) || null,
  };
}

/** Pending climbs, oldest first. */
export async function loadPendingClimbs(
  db: SupabaseClient,
): Promise<PendingClimb[]> {
  const { data, error } = await db
    .from("climbs")
    .select("id, scan_id, name, proposed_grade, created_by, created_at")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not load pending climbs: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const byId = await handles(
    db,
    rows.map((r) => r.created_by),
  );
  return rows.map((r) => shape(r, byId));
}

/** One pending climb with its holds, paths and scan mesh; null if not pending. */
export async function loadReviewClimb(
  db: SupabaseClient,
  id: string,
): Promise<ReviewClimb | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db
    .from("climbs")
    .select(
      "id, scan_id, name, description, proposed_grade, fa_info, created_by, created_at",
    )
    .eq("id", id.toLowerCase())
    .eq("status", "pending_review")
    .maybeSingle();
  if (error) throw new Error(`Could not load the climb: ${error.message}`);
  if (!data) return null;
  const row = data as Row;
  const [scan, holds, paths, byId] = await Promise.all([
    db.from("scans").select("glb_path").eq("id", row.scan_id).maybeSingle(),
    db.from("holds").select("*").eq("climb_id", row.id),
    db.from("paths").select("*").eq("climb_id", row.id),
    handles(db, [row.created_by]),
  ]);
  for (const r of [scan, holds, paths]) {
    if (r.error)
      throw new Error(`Could not load the climb: ${r.error.message}`);
  }
  return {
    climb: {
      ...shape(row, byId),
      description: row.description,
      fa_info: row.fa_info,
    },
    glb_path:
      (scan.data as { glb_path: string | null } | null)?.glb_path ?? null,
    holds: (holds.data ?? []) as Hold[],
    paths: (paths.data ?? []) as ClimbPath[],
  };
}
