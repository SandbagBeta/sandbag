import type { SupabaseClient } from "@supabase/supabase-js";
import type { Distribution } from "./consensus";
import { gradeRank } from "./vScale";
import type { VoteFailureCode } from "./voteFailure";

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
  constructor(
    what: string,
    cause: { message: string },
    /** What the user is told (see voteFailure.ts). */
    readonly code: VoteFailureCode = "error",
  ) {
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

/** Postgres error as supabase-js reports it. */
interface PgError {
  message: string;
  code?: string;
}

/**
 * Row-level security refusing a write on a climb that isn't published (the
 * policy's check) is the one 42501 the user can act on. A missing column
 * privilege also says 42501 but names "permission denied", and is our bug.
 */
function classify(error: PgError): VoteFailureCode {
  if (error.code === "23503") return "unknown_climb";
  if (error.code === "42501" && /row-level security/i.test(error.message)) {
    return "not_published";
  }
  return "error";
}

/**
 * One vote per user per climb; voting again changes it. RLS enforces
 * ownership and published-only.
 *
 * Not an upsert: `ON CONFLICT DO UPDATE` also writes `climb_id` and `user_id`,
 * and `authenticated` may only update `grade` (that grant is what stops a vote
 * being reassigned), so an upsert is refused. Update first; if the user has no
 * row yet, insert; if a concurrent request inserted one in between (23505),
 * update again.
 */
export async function saveVote(
  db: SupabaseClient,
  climbId: string,
  userId: string,
  grade: string,
): Promise<void> {
  if (gradeRank(grade) === null) {
    throw new VoteError(
      "save your vote",
      { message: "not a V-scale grade" },
      "invalid_grade",
    );
  }
  const value = grade.trim().toUpperCase();
  const fail = (error: PgError): never => {
    throw new VoteError("save your vote", error, classify(error));
  };
  const update = async (): Promise<boolean> => {
    const { data, error } = await db
      .from("grade_votes")
      .update({ grade: value })
      .eq("climb_id", climbId)
      .eq("user_id", userId)
      .select("climb_id");
    if (error) return fail(error);
    return (data?.length ?? 0) > 0;
  };

  if (await update()) return;
  const { error } = await db
    .from("grade_votes")
    .insert({ climb_id: climbId, user_id: userId, grade: value });
  if (!error) return;
  if (error.code !== "23505") return fail(error);
  if (!(await update())) {
    fail({ message: "the vote changed while saving", code: "40001" });
  }
}
