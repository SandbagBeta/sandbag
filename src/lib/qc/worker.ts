import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyTransition,
  TransitionConflictError,
  type ScanQcPatch,
} from "../lifecycle";
import type { LifecycleStatus, QcReport } from "../types";
import { UPLOADS_BUCKET } from "../upload/keys";
import type { UploadKind } from "../upload/validate";
import { checkFileSize } from "./checks";
import { formatMetrics } from "./metrics";
import { buildQcReport } from "./report";
import { runQcChecks } from "./run";
import { MAX_RAW_BYTES, QC_PIPELINE_VERSION } from "./thresholds";

/**
 * QC worker (#16 PR 2, ADR 003 §5): claims one job, runs the checks, writes
 * the verdict through the lifecycle module's atomic result patch. SERVER ONLY
 * (takes the service-role client; the route supplies it).
 *
 * Failure split (O8): a genuine mesh failure is a verdict (`failed_qc`, job
 * `done`, no retry). Anything thrown by storage, the database or the pipeline
 * itself is an infrastructure error: `fail_qc_job` schedules a retry, and when
 * attempts run out the scan goes to `failed_qc` with an "our side" message.
 *
 * Logging: ids, states and timings only. Never file bytes, parser messages or
 * anything geometric (a georeferenced scan's numbers are its location).
 */

const KINDS: readonly UploadKind[] = ["glb", "gltf", "ply", "zip"];

const OUR_SIDE =
  "Something went wrong on our side while checking this scan. It isn't a problem with your file; a maintainer has been notified.";

/** Report for a scan we couldn't check (O8). No file-derived content. */
export function infrastructureFailureReport(): QcReport {
  return buildQcReport(
    [
      {
        id: "pipeline_error",
        pass: false,
        severity: "error",
        message: OUR_SIDE,
      },
    ],
    null,
  );
}

type Result = "passed" | "failed" | "retry" | "exhausted" | "skipped";
export type QcJobOutcome =
  { result: "idle" } | { result: Result; scanId: string };

interface ClaimedJob {
  job_id: string;
  scan_id: string;
  raw_path: string;
  attempt: number;
  lease_token: string;
  exhausted: boolean;
}

export interface WorkerOptions {
  /** H2 cap for this deployment's plan (defaults to MAX_RAW_BYTES). */
  maxBytes?: number;
  log?: (line: string) => void;
}

/** Object size from a folder listing, so we know it before reading it. */
async function rawSize(db: SupabaseClient, rawPath: string): Promise<number> {
  const slash = rawPath.lastIndexOf("/");
  const name = rawPath.slice(slash + 1);
  const { data, error } = await db.storage
    .from(UPLOADS_BUCKET)
    .list(rawPath.slice(0, slash), { search: name });
  if (error) throw new Error("storage list failed");
  const hit = data?.find((o) => o.name === name);
  const size = (hit?.metadata as { size?: number } | undefined)?.size;
  if (typeof size !== "number") throw new Error("raw upload missing");
  return size;
}

async function download(db: SupabaseClient, rawPath: string) {
  const { data, error } = await db.storage
    .from(UPLOADS_BUCKET)
    .download(rawPath);
  if (error || !data) throw new Error("storage download failed");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Moves the scan to a QC verdict. A scan not yet `processing` (first run, or a
 * maintainer re-run from `failed_qc`) takes the `→ processing` hop first and
 * records `raw_path` there (ADR 003 §5 step 2). Results land in the one atomic
 * `processing → …` patch.
 */
async function finishScan(
  db: SupabaseClient,
  scanId: string,
  current: LifecycleStatus,
  to: "pending_review" | "failed_qc",
  rawPath: string,
  patch: ScanQcPatch,
) {
  if (current !== "processing") {
    await applyTransition(db, {
      kind: "scan",
      id: scanId,
      from: current,
      to: "processing",
      patch: { raw_path: rawPath },
    });
  }
  await applyTransition(db, {
    kind: "scan",
    id: scanId,
    from: "processing",
    to,
    patch,
  });
}

/**
 * Claims and processes at most one job. Job-level problems never throw; a
 * throw means the queue itself (claim) is unreachable.
 */
export async function processNextQcJob(
  db: SupabaseClient,
  opts: WorkerOptions = {},
): Promise<QcJobOutcome> {
  const log = opts.log ?? ((l: string) => console.info(l));
  const { data, error } = await db.rpc("claim_qc_job", {
    p_pipeline_version: QC_PIPELINE_VERSION,
  });
  if (error) throw new Error("claim_qc_job failed");
  const job = (Array.isArray(data) ? data[0] : data) as ClaimedJob | undefined;
  if (!job) return { result: "idle" };

  const { job_id: jobId, scan_id: scanId, lease_token: leaseToken } = job;
  const done = (result: Result): QcJobOutcome => {
    log(`qc job=${jobId} scan=${scanId} attempt=${job.attempt} -> ${result}`);
    return { result, scanId };
  };
  const complete = () =>
    db.rpc("complete_qc_job", { p_job_id: jobId, p_lease_token: leaseToken });
  const failInfra = (reason: string) =>
    db.rpc("fail_qc_job", {
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_error: reason,
    });

  let status: LifecycleStatus;
  try {
    const { data: scan, error: e } = await db
      .from("scans")
      .select("status")
      .eq("id", scanId)
      .maybeSingle();
    if (e) throw new Error("scan read failed");
    // A deleted scan cascades its jobs away; nothing to do.
    if (!scan) return done("skipped");
    status = scan.status as LifecycleStatus;
  } catch {
    await failInfra("could not read scan");
    return done("retry");
  }

  // Only uploaded (first run), processing (retry) and failed_qc (maintainer
  // re-run) scans are QC's to move. Anything else: finish the job, touch nothing.
  if (!["uploaded", "processing", "failed_qc"].includes(status)) {
    await complete();
    return done("skipped");
  }

  try {
    // The lease died on the last allowed attempt: don't run QC again (O8).
    if (job.exhausted) {
      await finishScan(db, scanId, status, "failed_qc", job.raw_path, {
        qc_report: infrastructureFailureReport(),
      });
      await failInfra("lease expired on final attempt");
      return done("exhausted");
    }

    const kind = job.raw_path.split(".").pop() as UploadKind;
    if (!KINDS.includes(kind)) throw new Error("unsupported stored extension");
    const maxBytes = opts.maxBytes ?? MAX_RAW_BYTES;

    // Too large is a verdict, decided from the object's size before reading
    // it, so an oversize file can't exhaust memory (ADR 003 §6).
    const size = await rawSize(db, job.raw_path);
    let report: QcReport;
    let passed = false;
    let triCount: number | null = null;
    let textureRes: number | null = null;
    if (size > maxBytes) {
      report = buildQcReport([checkFileSize(size, maxBytes)], null);
    } else {
      const bytes = await download(db, job.raw_path);
      const r = await runQcChecks({ bytes, kind, maxBytes });
      ({ report, passed, triCount, textureRes } = r);
      log(`qc scan=${scanId} ${formatMetrics(r.metrics)}`);
      // TODO(#16 PR 3): build the canonical GLB from r.mesh / r.document
      // (recentre, strip metadata, single mesh, compress, hash), upload it to
      // uploads/{uploader}/{scan}/derived/{hash}.glb and add glb_path and
      // content_hash to the patch below. Until then a pending_review scan has
      // NO published mesh and can't be published (scans_published_has_mesh).
    }

    await finishScan(
      db,
      scanId,
      status,
      passed ? "pending_review" : "failed_qc",
      job.raw_path,
      {
        tri_count: triCount,
        texture_res: passed ? textureRes : null,
        qc_report: report,
      },
    );
    await complete();
    return done(passed ? "passed" : "failed");
  } catch (e) {
    if (e instanceof TransitionConflictError) {
      // Another runner moved the scan first; it owns the outcome.
      await complete();
      return done("skipped");
    }
    // Constant, file-free reason: an error's own message may name a path.
    const { data: state } = await failInfra("qc pipeline error");
    if (state === "failed") {
      // Retries exhausted: tell the contributor it wasn't their file (O8).
      try {
        await finishScan(db, scanId, status, "failed_qc", job.raw_path, {
          qc_report: infrastructureFailureReport(),
        });
      } catch {
        /* the stuck-scan pass picks it up */
      }
      return done("exhausted");
    }
    return done("retry");
  }
}

/**
 * Moves scans stuck in `processing` with no live job to `failed_qc` (ADR 003
 * §6, supabase/README "Stuck processing scans"). Returns how many moved.
 */
export async function failStuckScans(
  db: SupabaseClient,
  log: (line: string) => void = (l) => console.info(l),
): Promise<number> {
  const { data, error } = await db.rpc("list_stuck_qc_scans");
  if (error) throw new Error("list_stuck_qc_scans failed");
  let moved = 0;
  for (const row of (data ?? []) as { scan_id: string }[]) {
    try {
      await applyTransition(db, {
        kind: "scan",
        id: row.scan_id,
        from: "processing",
        to: "failed_qc",
        patch: { qc_report: infrastructureFailureReport() },
      });
      moved++;
      log(`qc scan=${row.scan_id} stuck in processing -> failed_qc`);
    } catch (e) {
      if (!(e instanceof TransitionConflictError)) {
        log(`qc scan=${row.scan_id} stuck-scan transition failed`);
      }
    }
  }
  return moved;
}
