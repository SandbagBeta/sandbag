import "server-only";
import { createServiceClient } from "../supabase/service";
import type { QcJob } from "./scans";

/**
 * Upload-complete hook (#16, ADR 003 §5): records a QC job for a verified raw
 * upload. Service role, with `rawPath` taken from the object the caller
 * already checked, never from client input. It changes no scan status and
 * does no work in-line: the pg_cron sweep (every minute) calls
 * POST /api/qc/run, which claims the job. Idempotent: `enqueue_qc_job` returns
 * the scan's active job if there is one.
 */
export async function enqueueQc(job: QcJob): Promise<void> {
  const { error } = await createServiceClient().rpc("enqueue_qc_job", {
    p_scan_id: job.scanId,
    p_raw_path: job.rawPath,
  });
  if (error) throw new Error("Could not queue the scan for checking.");
}
