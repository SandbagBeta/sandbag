import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecycleStatus, Review } from "../types";
import { LifecycleDbError, TransitionConflictError } from "./errors";
import { LifecycleError, type LifecycleKind } from "./transitions";

/**
 * SERVER ONLY, and private to src/lib/lifecycle: index.ts does not re-export
 * this file. `casStatus` writes whatever edge it is given, without consulting
 * TRANSITIONS; callers (applyTransition, takeDown) must check the edge first.
 */

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TABLE: Readonly<Record<LifecycleKind, "scans" | "climbs">> = {
  scan: "scans",
  climb: "climbs",
};

export async function readOne<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  key: string,
  value: string,
): Promise<T | null> {
  const { data, error } = await db
    .from(table)
    .select(columns)
    .eq(key, value)
    .maybeSingle();
  if (error) throw new LifecycleDbError(`reading ${table}`, error);
  return data as T | null;
}

/**
 * One statement: `update <table> set status = to, ...values where id = ? and
 * status = from`. Zero rows matched → TransitionConflictError, nothing written.
 */
export async function casStatus(
  db: SupabaseClient,
  kind: LifecycleKind,
  id: string,
  from: LifecycleStatus,
  to: LifecycleStatus,
  values: Record<string, unknown> = {},
): Promise<void> {
  const { data, error } = await db
    .from(TABLE[kind])
    .update({ ...values, status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) throw new LifecycleDbError(`moving ${kind} ${id} to ${to}`, error);
  if (!data || data.length === 0) {
    throw new TransitionConflictError(kind, id, from);
  }
}

export async function insertReview(
  db: SupabaseClient,
  row: Pick<
    Review,
    "subject_type" | "subject_id" | "reviewer_id" | "verdict" | "reason"
  >,
): Promise<Review> {
  const { data, error } = await db
    .from("reviews")
    .insert(row)
    .select("*")
    .single();
  if (error || !data) throw new LifecycleDbError("writing review", error);
  return data as Review;
}

/**
 * Deletes a review row whose effect definitely did not happen, then rethrows
 * `cause`. If the delete fails, the error names the orphaned review.
 */
export async function undoReview(
  db: SupabaseClient,
  reviewId: string,
  cause: Error,
): Promise<never> {
  const { error } = await db.from("reviews").delete().eq("id", reviewId);
  if (error) {
    throw new LifecycleError(
      `${cause.message} Also failed to remove review ${reviewId}, which records an effect that did not happen: ${error.message}`,
    );
  }
  throw cause;
}
