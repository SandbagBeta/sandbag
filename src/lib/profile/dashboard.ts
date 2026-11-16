import type { SupabaseClient } from "@supabase/supabase-js";
import { editPath } from "../annotations/editClimb";
import { thumbPathFor } from "../browse/load";
import { consensusGrade, sandbagGrades, totalVotes } from "../grades/consensus";
import { gradeRank } from "../grades/vScale";
import { loadDistribution } from "../grades/votes";
import { groupChecks, latestFeedback } from "../scan-report/format";
import { trackerSteps, type TrackerStep } from "../scan-report/tracker";
import type { ClimbStatus, LifecycleStatus, QcReport, Review } from "../types";
import { derivedThumbKey } from "../upload/keys";

/**
 * Private dashboard data for /account. Every query is the signed-in user's own
 * and runs under their session, so RLS applies; the explicit user filter is a
 * second lock. Nothing here reads coordinates.
 */

const LIMIT = 100;
/** Votes get one RPC each, so show the newest few. */
const VOTE_LIMIT = 30;

export class DashboardLoadError extends Error {
  constructor(what: string, cause: { message: string }) {
    super(`Could not load ${what}: ${cause.message}`);
    this.name = "DashboardLoadError";
  }
}

export interface UploadItem {
  id: string;
  status: LifecycleStatus;
  createdAt: string;
  steps: TrackerStep[];
  /** Why it failed or was declined: the first blocking QC message, or the reviewer's note. */
  reason: string | null;
  /** Where its thumbnail is, if it should have one. The page turns this into a URL. */
  thumb: { bucket: "published" | "uploads"; key: string } | null;
}

export function reasonFor(
  status: LifecycleStatus,
  qcReport: QcReport | null,
  feedback: Review | null,
): string | null {
  if (status === "failed_qc") {
    return groupChecks(qcReport).blocking[0]?.message ?? null;
  }
  if (status === "rejected" || status === "pending_review") {
    return feedback ? (feedback.reason ?? "No reason was given.") : null;
  }
  return null;
}

export async function loadMyUploads(
  db: SupabaseClient,
  userId: string,
): Promise<UploadItem[]> {
  const res = await db
    .from("scans")
    .select(
      "id, status, glb_path, content_hash, qc_report, created_at, openbeta_area_id",
    )
    .eq("uploader_id", userId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (res.error) throw new DashboardLoadError("your uploads", res.error);
  type Row = {
    id: string;
    status: LifecycleStatus;
    glb_path: string | null;
    content_hash: string | null;
    qc_report: QcReport | null;
    created_at: string;
    openbeta_area_id: string | null;
  };
  const scans = (res.data ?? []) as Row[];
  if (scans.length === 0) return [];

  const rev = await db
    .from("reviews")
    .select("id, subject_id, verdict, reason, created_at")
    .eq("subject_type", "scan")
    .in(
      "subject_id",
      scans.map((s) => s.id),
    );
  if (rev.error) throw new DashboardLoadError("reviewer notes", rev.error);
  const reviews = (rev.data ?? []) as Review[];

  return scans.map((s) => {
    const feedback = latestFeedback(
      reviews.filter((r) => r.subject_id === s.id),
    );
    let thumb: UploadItem["thumb"] = null;
    if (s.status === "published") {
      const key = thumbPathFor({ ...s, openbeta_area_id: null });
      if (key) thumb = { bucket: "published", key };
    } else if (s.status === "pending_review" || s.status === "rejected") {
      // The QC worker writes it beside the canonical GLB once checks pass.
      thumb = { bucket: "uploads", key: derivedThumbKey(userId, s.id) };
    }
    return {
      id: s.id,
      status: s.status,
      createdAt: s.created_at,
      steps: trackerSteps(s.status, feedback),
      reason: reasonFor(s.status, s.qc_report, feedback),
      thumb,
    };
  });
}

export interface MyClimb {
  id: string;
  name: string;
  grade: string;
  status: ClimbStatus;
  scanId: string;
  /** Only published climbs have a page of their own. */
  climbHref: string | null;
  boulderHref: string;
  /** Pending climbs only. */
  editHref: string | null;
}

export async function loadMyClimbs(
  db: SupabaseClient,
  userId: string,
): Promise<MyClimb[]> {
  const res = await db
    .from("climbs")
    .select("id, name, proposed_grade, status, scan_id")
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (res.error) throw new DashboardLoadError("your climbs", res.error);
  return (
    (res.data ?? []) as {
      id: string;
      name: string;
      proposed_grade: string;
      status: ClimbStatus;
      scan_id: string;
    }[]
  ).map((c) => ({
    id: c.id,
    name: c.name,
    grade: c.proposed_grade,
    status: c.status,
    scanId: c.scan_id,
    climbHref: c.status === "published" ? `/climb/${c.id}` : null,
    boulderHref: `/boulder/${c.scan_id}?climb=${c.id}`,
    editHref: c.status === "pending_review" ? editPath(c.scan_id, c.id) : null,
  }));
}

export interface MyVote {
  climbId: string;
  name: string;
  myGrade: string;
  /** Most-voted grade; null until enough votes. */
  consensus: string | null;
  votes: number;
  /** Whole grades my vote sits above (+) or below (-) the consensus; null if either is unknown. */
  offset: number | null;
  /** Whole grades the consensus is above the proposed grade, same logic as the climb page. */
  sandbagged: number;
}

export async function loadMyVotes(
  db: SupabaseClient,
  userId: string,
): Promise<MyVote[]> {
  const res = await db
    .from("grade_votes")
    .select("climb_id, grade, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(VOTE_LIMIT);
  if (res.error) throw new DashboardLoadError("your grade votes", res.error);
  const votes = (res.data ?? []) as { climb_id: string; grade: string }[];
  if (votes.length === 0) return [];

  const cl = await db
    .from("climbs")
    .select("id, name, proposed_grade")
    .in(
      "id",
      votes.map((v) => v.climb_id),
    )
    .eq("status", "published");
  if (cl.error) throw new DashboardLoadError("voted climbs", cl.error);
  const byId = new Map(
    (cl.data as { id: string; name: string; proposed_grade: string }[]).map(
      (c) => [c.id, c],
    ),
  );

  const out: MyVote[] = [];
  await Promise.all(
    votes.map(async (v, i) => {
      const climb = byId.get(v.climb_id);
      if (!climb) return;
      const dist = await loadDistribution(db, v.climb_id);
      const consensus = consensusGrade(dist);
      const mine = gradeRank(v.grade);
      const theirs = consensus ? gradeRank(consensus) : null;
      out[i] = {
        climbId: climb.id,
        name: climb.name,
        myGrade: v.grade,
        consensus,
        votes: totalVotes(dist),
        offset: mine !== null && theirs !== null ? mine - theirs : null,
        sandbagged: sandbagGrades(consensus, climb.proposed_grade),
      };
    }),
  );
  return out.filter(Boolean);
}
