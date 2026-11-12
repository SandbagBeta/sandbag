import type { SupabaseClient } from "@supabase/supabase-js";
import type { QcReport, Scan, TrustLevel } from "@/lib/types";

/**
 * Review queue data (issue #19). Reads use the reviewer's own session client,
 * so RLS (`scans_read`, reviewer trust) still applies. No location fields are
 * selected anywhere here; areas are shown by OpenBeta id only.
 */

/** v1: maintainers review (PRD §9). The lifecycle also allows `reviewer`. */
export function canReviewInUi(trust: TrustLevel | null | undefined): boolean {
  return trust === "maintainer";
}

/** Reviewer checklist, PRD §9. Approve requires every item confirmed. */
export const CHECKLIST = [
  { id: "is_boulder", label: "It is actually a boulder" },
  { id: "is_claimed", label: "It is the boulder the contributor claims" },
  { id: "coverage", label: "Scan coverage is adequate" },
  { id: "not_sensitive", label: "The area is not access-sensitive" },
] as const;

export type PendingScan = Pick<
  Scan,
  "id" | "openbeta_area_id" | "tri_count" | "created_at" | "qc_report"
> & { uploader_handle: string | null; qc_warnings: number };

export type ReviewScan = PendingScan & {
  glb_path: string | null;
  /** Reviewed scale (1 until a maintainer sets it): real size = GLB size * this. */
  scale_factor: number;
};

const COLUMNS =
  "id, uploader_id, openbeta_area_id, tri_count, created_at, qc_report, glb_path, scale_factor";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function countQcWarnings(report: QcReport | null): number {
  return (
    report?.checks.filter((c) => !c.pass && c.severity !== "info").length ?? 0
  );
}

export async function handles(db: SupabaseClient, ids: (string | null)[]) {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (!uniq.length) return new Map<string, string>();
  const { data, error } = await db
    .from("profiles")
    .select("id, handle")
    .in("id", uniq);
  if (error) throw new Error(`Could not load uploaders: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id as string, p.handle as string]));
}

type Row = Scan & { glb_path: string | null };

function shape(r: Row, byId: Map<string, string>): ReviewScan {
  return {
    id: r.id,
    glb_path: r.glb_path,
    scale_factor: r.scale_factor ?? 1,
    openbeta_area_id: r.openbeta_area_id,
    tri_count: r.tri_count,
    created_at: r.created_at,
    qc_report: r.qc_report,
    uploader_handle: (r.uploader_id && byId.get(r.uploader_id)) || null,
    qc_warnings: countQcWarnings(r.qc_report),
  };
}

/** Pending scans, oldest first (first in, first reviewed). */
export async function loadPendingScans(
  db: SupabaseClient,
): Promise<ReviewScan[]> {
  const { data, error } = await db
    .from("scans")
    .select(COLUMNS)
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    throw new Error(`Could not load the review queue: ${error.message}`);
  }
  const rows = (data ?? []) as Row[];
  const byId = await handles(
    db,
    rows.map((r) => r.uploader_id),
  );
  return rows.map((r) => shape(r, byId));
}

/** One pending scan, or null when it is missing or no longer pending. */
export async function loadReviewScan(
  db: SupabaseClient,
  id: string,
): Promise<ReviewScan | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db
    .from("scans")
    .select(COLUMNS)
    .eq("id", id)
    .eq("status", "pending_review")
    .maybeSingle();
  if (error) throw new Error(`Could not load the scan: ${error.message}`);
  if (!data) return null;
  const r = data as Row;
  return shape(r, await handles(db, [r.uploader_id]));
}
