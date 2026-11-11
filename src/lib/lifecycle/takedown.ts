import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecycleStatus, Review } from "../types";
import { TransitionConflictError } from "./errors";
import { casStatus, insertReview, readOne, undoReview, UUID } from "./internal";
import { refuse, SubjectNotFoundError } from "./review";
import { TAKEDOWN, type LifecycleKind } from "./transitions";

/**
 * SERVER ONLY. Maintainer takedown (owner decision on #20): unpublish a
 * published scan or climb, `published → rejected`, with a required reason,
 * recorded as a `reviews` row with verdict `reject`. This is the only path
 * for that edge; it is not in TRANSITIONS, and submitReview keeps refusing
 * anything not pending_review.
 *
 * Same write order as submitReview: all checks, then the review row, then the
 * compare-and-set. If the CAS definitely didn't happen (conflict), the review
 * row is deleted; if its outcome is unknown (DB error), the row is kept.
 *
 * Climbs on a taken-down scan are not touched. `climbs_read` (RLS migration)
 * only shows a published climb while its scan is published, so they disappear
 * from public view with the scan, and come back only if the scan does (which
 * can't happen today: `rejected` is final). Their authors and reviewers still
 * see them. Uploaders can't delete a rejected scan (`scans_delete_own_before_
 * publish`), so takedown never cascades away other people's climbs.
 *
 * A maintainer may take down their own item: unlike approval, removing your
 * own content is no conflict of interest. Storage objects are not moved here
 * (ADR 002's publish/unpublish copies wait for the storage adapter, #50).
 */

export interface TakedownInput {
  maintainerId: string;
  /** Areas have no status, so they can't be taken down (refused). */
  subjectType: LifecycleKind;
  subjectId: string;
  reason: string;
}

export interface TakedownResult {
  review: Review;
  status: "rejected";
}

export async function takeDown(
  db: SupabaseClient,
  input: TakedownInput,
): Promise<TakedownResult> {
  const { maintainerId, subjectType, subjectId } = input;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";

  // 1. Input and permission checks (no writes yet).
  if (subjectType !== "scan" && subjectType !== "climb") {
    refuse(
      "invalid_input",
      `Only scans and climbs can be taken down, not ${String(subjectType)}.`,
    );
  }
  if (!UUID.test(maintainerId))
    refuse("invalid_input", "Invalid maintainer id.");
  if (!UUID.test(subjectId))
    throw new SubjectNotFoundError(subjectType, subjectId);
  if (!reason) refuse("reason_required", "A takedown must give a reason.");

  const profile = await readOne<{ trust_level: string }>(
    db,
    "profiles",
    "trust_level",
    "id",
    maintainerId,
  );
  if (profile?.trust_level !== "maintainer") {
    refuse("not_maintainer", "Only maintainers can take down published items.");
  }

  const table = subjectType === "scan" ? "scans" : "climbs";
  const subject = await readOne<{ id: string; status: LifecycleStatus }>(
    db,
    table,
    "id, status",
    "id",
    subjectId,
  );
  if (!subject) throw new SubjectNotFoundError(subjectType, subjectId);
  if (subject.status !== TAKEDOWN.from) {
    refuse(
      "not_published",
      `${subjectType} ${subjectId} is ${subject.status}; only published items can be taken down.`,
    );
  }

  // 2. Record the takedown as a reject review.
  const review = await insertReview(db, {
    subject_type: subjectType,
    subject_id: subjectId,
    reviewer_id: maintainerId,
    verdict: "reject",
    reason,
  });

  // 3. Compare-and-set; undo the review only if the CAS surely didn't apply.
  try {
    await casStatus(db, subjectType, subjectId, TAKEDOWN.from, TAKEDOWN.to);
  } catch (err) {
    if (err instanceof TransitionConflictError) {
      return undoReview(db, review.id, err);
    }
    throw err;
  }
  return { review, status: TAKEDOWN.to };
}
