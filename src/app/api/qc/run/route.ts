import { isQcRequestAuthorized } from "@/lib/qc/auth";
import { failStuckScans, processNextQcJob } from "@/lib/qc/worker";
import { createServiceClient } from "@/lib/supabase/service";

// QC needs Node (parsers, wasm, ~1.1 GB at 5M triangles), not an Edge
// Function (ADR 003 O1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Stop starting new jobs after this long, leaving room under maxDuration. */
const BUDGET_MS = 150_000;

/**
 * POST /api/qc/run: the QC worker. Called by the pg_cron sweep with
 * `Authorization: Bearer <QC_RUN_SECRET>`. The body is ignored, so a caller
 * can't pick a scan. Claims jobs one at a time until the queue is empty or the
 * time budget is spent, then fails stuck scans. Responds with counts only.
 */
export async function POST(req: Request) {
  if (!isQcRequestAuthorized(req.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const counts: Record<string, number> = {};
  try {
    const db = createServiceClient();
    while (Date.now() - started < BUDGET_MS) {
      const out = await processNextQcJob(db);
      if (out.result === "idle") break;
      counts[out.result] = (counts[out.result] ?? 0) + 1;
    }
    const stuck = await failStuckScans(db);
    return Response.json({ ok: true, jobs: counts, stuck });
  } catch {
    // Queue or database unreachable; the sweep calls again in a minute.
    return Response.json({ ok: false, jobs: counts }, { status: 503 });
  }
}
