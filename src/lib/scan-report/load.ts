import type { SupabaseClient } from "@supabase/supabase-js";
import type { QcReport, Review, Scan, ScanStatusEvent } from "../types";
import type { FailureHelp } from "../annotations/failureHelp";
import { qcHelpForScan } from "../upload/failures";
import { isUuid } from "../upload/keys";

/** Everything the scan page shows. Read with the caller's client: RLS decides. */
export interface ScanReport {
  scan: Pick<Scan, "id" | "status" | "qc_report" | "retry_of" | "created_at">;
  events: ScanStatusEvent[];
  reviews: Review[];
  /** A retry that replaces this scan, if one exists. */
  retriedBy: { id: string; status: string } | null;
  /** Why the automated checks failed, in the shared failure-help shape. Null unless the scan failed them. */
  help: FailureHelp | null;
}

export async function loadScanReport(
  client: SupabaseClient,
  scanId: string,
  userId: string,
  /** Service-role client: only used to look up the reference of a failure logged on our side. */
  serviceDb: SupabaseClient | null = null,
): Promise<ScanReport | null> {
  if (!isUuid(scanId)) return null;
  const { data: scan } = await client
    .from("scans")
    .select("id, uploader_id, status, qc_report, retry_of, created_at")
    .eq("id", scanId)
    .maybeSingle();
  const row = scan as
    | (ScanReport["scan"] & {
        uploader_id: string | null;
        qc_report: QcReport | null;
      })
    | null;
  // Contributor view: someone else's scan is "not found", reviewers use /review.
  if (!row || row.uploader_id !== userId) return null;

  const [events, reviews, retry] = await Promise.all([
    client
      .from("scan_status_events")
      .select("id, scan_id, from_status, to_status, created_at")
      .eq("scan_id", scanId)
      .order("created_at", { ascending: true }),
    client
      .from("reviews")
      .select(
        "id, subject_type, subject_id, reviewer_id, verdict, reason, created_at",
      )
      .eq("subject_type", "scan")
      .eq("subject_id", scanId),
    client
      .from("scans")
      .select("id, status")
      .eq("retry_of", scanId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const { uploader_id: _omit, ...publicScan } = row;
  void _omit;
  return {
    scan: publicScan,
    events: (events.data ?? []) as ScanStatusEvent[],
    reviews: (reviews.data ?? []) as Review[],
    retriedBy: ((retry.data ?? [])[0] as ScanReport["retriedBy"]) ?? null,
    help:
      row.status === "failed_qc"
        ? await qcHelpForScan(serviceDb, scanId, row.qc_report)
        : null,
  };
}
