import type { SupabaseClient } from "@supabase/supabase-js";
import type { FailureHelp } from "../annotations/failureHelp";
import {
  logFailure,
  newReference,
  reportPathFor,
} from "../annotations/failureLog";
import type { QcReport } from "../types";
import {
  qcFailureHelp,
  QC_PIPELINE_ERROR,
  uploadFailureHelp,
  uploadFailureStage,
  type UploadFailureCode,
} from "./failureHelp";

/**
 * SERVER ONLY (#130). Builds upload and QC failure help and, for failures the
 * user can't fix, writes the private `failure_logs` row and hands back its
 * reference. `db` is the service-role client (the log is service-role only).
 * Nothing here throws: a log problem must not hide the real error.
 */

/** Help for an upload failure; logs it first when it is on our side. */
export async function explainUploadFailure(
  db: SupabaseClient,
  code: UploadFailureCode,
  ctx: { userId: string; scanId?: string | null },
): Promise<FailureHelp> {
  const plain = uploadFailureHelp(code);
  if (plain.userFixable) return plain;
  const reference = newReference();
  const logged = await logFailure(db, {
    reference,
    stage: uploadFailureStage(code),
    code,
    userId: ctx.userId,
    scanId: ctx.scanId ?? null,
  });
  // If the log write failed there is nothing to quote: no reference.
  return uploadFailureHelp(
    code,
    logged ? { reference, reportPath: reportPathFor(reference) } : undefined,
  );
}

/** Adds `help` to a failed result that has a code; passes anything else through. */
export async function withUploadHelp<
  R extends { ok: boolean; code?: UploadFailureCode },
>(
  getDb: () => SupabaseClient,
  result: R,
  ctx: { userId: string; scanId?: string | null },
): Promise<R | (R & { help: FailureHelp })> {
  if (result.ok || !result.code) return result;
  try {
    return {
      ...result,
      help: await explainUploadFailure(getDb(), result.code, ctx),
    };
  } catch {
    return { ...result, help: uploadFailureHelp(result.code) };
  }
}

/**
 * Records that QC failed for a reason on our side (retries or lease ran out,
 * scan stuck in processing) so the contributor can quote a reference. Called
 * beside the `pipeline_error` report. Constant, file-free `detail`.
 */
export async function logQcInfrastructureFailure(
  db: SupabaseClient,
  input: {
    scanId: string;
    /** From the raw path when known; otherwise looked up from the scan. */
    uploaderId?: string | null;
    code: "lease_expired" | "retries_exhausted" | "stuck_processing";
  },
): Promise<void> {
  try {
    let userId = input.uploaderId ?? null;
    if (!userId) {
      const { data } = await db
        .from("scans")
        .select("uploader_id")
        .eq("id", input.scanId)
        .maybeSingle();
      userId =
        (data as { uploader_id: string | null } | null)?.uploader_id ?? null;
    }
    await logFailure(db, {
      reference: newReference(),
      stage: "qc",
      code: input.code,
      userId,
      scanId: input.scanId,
      detail: "automated checks could not run",
    });
  } catch {
    /* logging is best effort */
  }
}

/**
 * Help for a scan that failed its automated checks. A failure on our side
 * looks up the reference the worker logged for this scan; pass the service
 * client and only for a scan the caller owns.
 */
export async function qcHelpForScan(
  db: SupabaseClient | null,
  scanId: string,
  report: QcReport | null | undefined,
): Promise<FailureHelp | null> {
  const ours = report?.checks?.some(
    (c) => !c.pass && c.id === QC_PIPELINE_ERROR,
  );
  if (!ours || !db) return qcFailureHelp(report);
  try {
    const { data } = await db
      .from("failure_logs")
      .select("reference")
      .eq("scan_id", scanId)
      .eq("stage", "qc")
      .order("created_at", { ascending: false })
      .limit(1);
    const reference = (data as { reference: string }[] | null)?.[0]?.reference;
    return qcFailureHelp(
      report,
      reference
        ? { reference, reportPath: reportPathFor(reference) }
        : undefined,
    );
  } catch {
    return qcFailureHelp(report);
  }
}
