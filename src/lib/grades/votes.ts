import type { SupabaseClient } from "@supabase/supabase-js";
import type { Distribution } from "./consensus";
import { gradeRank } from "./vScale";

/** A row of public.climb_grade_distribution(p_climb_id). */
export interface DistributionRow {
  grade: string;
  votes: number;
}

/**
 * Maps RPC rows to a Distribution. Normalises case, merges duplicates, and
 * drops unknown grades and non-positive/non-finite counts so bad data can't
 * reach the histogram.
 */
export function rowsToDistribution(
  rows: readonly DistributionRow[] | null | undefined,
): Distribution {
  const out: Distribution = {};
  for (const r of rows ?? []) {
    if (gradeRank(r.grade) === null) continue;
    const n = Number(r.votes);
    if (!Number.isFinite(n) || n <= 0) continue;
    const key = r.grade.trim().toUpperCase();
    out[key] = (out[key] ?? 0) + Math.floor(n);
  }
  return out;
}

export class VoteError extends Error {
  constructor(what: string, cause: { message: string }) {
    super(`Could not ${what}: ${cause.message}`);
    this.name = "VoteError";
  }
}

/** Public aggregate counts for a published climb (empty for anything else). */
export async function loadDistribution(
  db: SupabaseClient,
  climbId: string,
): Promise<Distribution> {
  const { data, error } = await db.rpc("climb_grade_distribution", {
    p_climb_id: climbId,
  });
  if (error) throw new VoteError("load grade votes", error);
  return rowsToDistribution(data as DistributionRow[] | null);
}

/** The signed-in user's own vote (RLS shows only their row). */
export async function loadMyVote(
  db: SupabaseClient,
  climbId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("grade_votes")
    .select("grade")
    .eq("climb_id", climbId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new VoteError("load your vote", error);
  return (data as { grade: string } | null)?.grade ?? null;
}

/** One vote per user per climb; voting again changes it. RLS enforces ownership and published-only. */
export async function saveVote(
  db: SupabaseClient,
  climbId: string,
  userId: string,
  grade: string,
): Promise<void> {
  if (gradeRank(grade) === null) {
    throw new VoteError("save your vote", { message: "not a V-scale grade" });
  }
  const { error } = await db
    .from("grade_votes")
    .upsert(
      { climb_id: climbId, user_id: userId, grade: grade.trim().toUpperCase() },
      { onConflict: "climb_id,user_id" },
    );
  if (error) throw new VoteError("save your vote", error);
}
