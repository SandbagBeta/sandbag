import type { QcJob } from "./scans";

/**
 * STUB for #16 (QC pipeline). Called once a raw upload is verified. It does
 * nothing yet: the scan stays `uploaded` until #16 picks it up and moves it
 * to `processing` through the lifecycle module. #16 should make this enqueue
 * (or invoke the QC Edge Function), write `raw_path` server-side, and treat
 * repeat calls for the same scan as no-ops.
 */
export async function enqueueQc(job: QcJob): Promise<void> {
  void job;
}
