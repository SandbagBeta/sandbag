import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LifecycleStatus,
  Review,
  ReviewSubject,
  ReviewVerdict,
} from "../types";
import { applyTransition, assertPublishable } from "./apply";
import {
  LifecycleDbError,
  MissingMeshError,
  TransitionConflictError,
} from "./errors";
import { insertReview, readOne, undoReview, UUID } from "./internal";
import { LifecycleError } from "./transitions";

/**
 * SERVER ONLY. The review/publish flow (PRD §6, §8; ADR 001 P3), run with the
 * service-role client. The service role bypasses RLS, so this re-checks in
 * code what `reviews_insert_reviewer` enforces for user clients.
 *
 * Write order (supabase-js has no transactions), chosen so any partial failure
 * leaves the safer state:
 *   1. All reads and checks. Nothing is written if any check fails.
 *   2. Insert the review row.
 *   3. Apply the effect: CAS status change, or clear the area's P3 flag.
 * So an item is never published (or an area un-hidden) without a review row.
 * If step 3 definitely did not apply (CAS conflict, mesh gone), the review row
 * from step 2 is deleted so the audit trail doesn't record an effect that
 * never happened. If step 3 fails with an unknown outcome (DB/network error),
 * the row is kept: a review whose effect may be missing is safer than an
 * effect with no review. True atomicity needs a Postgres function (see PR).
 */

const SUBJECTS: readonly ReviewSubject[] = ["scan", "climb", "area"];
const VERDICTS: readonly ReviewVerdict[] = [
  "approve",
  "request_changes",
  "reject",
];

/** Status a verdict moves a pending scan/climb to; null = stays pending_review. */
export const VERDICT_TARGET: Readonly<
  Record<ReviewVerdict, LifecycleStatus | null>
> = { approve: "published", reject: "rejected", request_changes: null };

export class SubjectNotFoundError extends LifecycleError {
  constructor(
    readonly subjectType: string,
    readonly subjectId: string,
  ) {
    super(`Cannot review ${subjectType} ${subjectId}: it does not exist.`);
  }
}

export type ReviewRefusal =
  | "invalid_input"
  | "not_reviewer"
  | "self_review"
  | "reason_required"
  | "not_pending"
  /** takeDown only: trust_level must be maintainer. */
  | "not_maintainer"
  /** takeDown only: the subject must be published. */
  | "not_published";

export class ReviewNotAllowedError extends LifecycleError {
  constructor(
    readonly code: ReviewRefusal,
    message: string,
  ) {
    super(message);
  }
}

/** The area was re-flagged (or removed) between reading and clearing it. */
export class AreaFlagConflictError extends LifecycleError {
  constructor(readonly areaId: string) {
    super(
      `Conflict: area ${areaId} changed while it was being reviewed (a refresh re-parented it again). It stays hidden; review it again.`,
    );
  }
}

export interface ReviewInput {
  reviewerId: string;
  subjectType: ReviewSubject;
  subjectId: string;
  verdict: ReviewVerdict;
  reason?: string | null;
}

export interface ReviewResult {
  review: Review;
  /** New status of a scan/climb (unchanged for request_changes); absent for areas. */
  status?: LifecycleStatus;
  /** Areas only: whether this review cleared `ancestors_changed_at`. */
  areaFlagCleared?: boolean;
}

export function refuse(code: ReviewRefusal, message: string): never {
  throw new ReviewNotAllowedError(code, message);
}

export async function submitReview(
  db: SupabaseClient,
  input: ReviewInput,
): Promise<ReviewResult> {
  const { reviewerId, subjectType, subjectId, verdict } = input;
  const reason = input.reason?.trim() || null;

  // 1. Input and permission checks (no writes yet).
  if (!SUBJECTS.includes(subjectType) || !VERDICTS.includes(verdict)) {
    refuse("invalid_input", `Unknown subject type or verdict.`);
  }
  if (!UUID.test(reviewerId)) refuse("invalid_input", "Invalid reviewer id.");
  if (!UUID.test(subjectId)) {
    throw new SubjectNotFoundError(subjectType, subjectId);
  }
  if (verdict !== "approve" && !reason) {
    refuse("reason_required", `A ${verdict} review must give a reason.`);
  }

  const profile = await readOne<{ trust_level: string }>(
    db,
    "profiles",
    "trust_level",
    "id",
    reviewerId,
  );
  if (
    !profile ||
    (profile.trust_level !== "reviewer" && profile.trust_level !== "maintainer")
  ) {
    refuse("not_reviewer", "Only reviewers and maintainers can review.");
  }

  let area: { ancestors_changed_at: string | null } | null = null;
  if (subjectType === "area") {
    area = await readOne(
      db,
      "area_cache",
      "openbeta_area_id, ancestors_changed_at",
      "openbeta_area_id",
      subjectId,
    );
    if (!area) throw new SubjectNotFoundError(subjectType, subjectId);
  } else {
    const subject =
      subjectType === "scan"
        ? await readOne<{
            id: string;
            status: LifecycleStatus;
            uploader_id: string | null;
            glb_path: string | null;
            content_hash: string | null;
          }>(
            db,
            "scans",
            "id, status, uploader_id, glb_path, content_hash",
            "id",
            subjectId,
          )
        : await readOne<{
            id: string;
            status: LifecycleStatus;
            created_by: string | null;
          }>(db, "climbs", "id, status, created_by", "id", subjectId);
    if (!subject) throw new SubjectNotFoundError(subjectType, subjectId);

    const author =
      "uploader_id" in subject ? subject.uploader_id : subject.created_by;
    if (author === reviewerId) {
      refuse("self_review", `You can't review your own ${subjectType}.`);
    }
    if (subject.status !== "pending_review") {
      refuse(
        "not_pending",
        `${subjectType} ${subjectId} is ${subject.status}; only pending_review items can be reviewed.`,
      );
    }
    if (verdict === "approve" && "glb_path" in subject) {
      assertPublishable(subject);
    }
  }

  // 2. Record the review.
  const review = await insertReview(db, {
    subject_type: subjectType,
    subject_id: subjectId,
    reviewer_id: reviewerId,
    verdict,
    reason,
  });

  // 3. Apply its effect; undo the review row only if the effect surely didn't happen.
  const undo = (cause: Error) => undoReview(db, review.id, cause);

  if (subjectType === "area") {
    if (verdict !== "approve" || !area?.ancestors_changed_at) {
      // Reject / request_changes: fail closed, the flag stays set.
      return { review, areaFlagCleared: false };
    }
    const { data, error: updError } = await db
      .from("area_cache")
      .update({ ancestors_changed_at: null })
      .eq("openbeta_area_id", subjectId)
      .eq("ancestors_changed_at", area.ancestors_changed_at)
      .select("openbeta_area_id");
    if (updError) throw new LifecycleDbError("clearing area flag", updError);
    if (!data || data.length === 0) {
      return undo(new AreaFlagConflictError(subjectId));
    }
    return { review, areaFlagCleared: true };
  }

  const to = VERDICT_TARGET[verdict];
  if (!to) return { review, status: "pending_review" };
  try {
    await applyTransition(db, {
      kind: subjectType,
      id: subjectId,
      from: "pending_review",
      to,
    });
  } catch (err) {
    if (
      err instanceof TransitionConflictError ||
      err instanceof MissingMeshError
    ) {
      return undo(err);
    }
    throw err;
  }
  return { review, status: to };
}
