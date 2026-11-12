import {
  MissingMeshError,
  ReviewNotAllowedError,
  SubjectNotFoundError,
  TransitionConflictError,
  type ReviewInput,
} from "@/lib/lifecycle";
import type { ReviewVerdict, TrustLevel } from "@/lib/types";
import { CLIMB_CHECKLIST } from "./climbQueue";
import { CHECKLIST, canReviewInUi } from "./queue";

export interface DecideInput {
  /** Defaults to "scan". */
  subjectType?: "scan" | "climb";
  subjectId: string;
  verdict: unknown;
  reason: unknown;
  /** Checklist item ids the reviewer ticked. */
  checked: readonly string[];
}

export interface DecideDeps {
  reviewerId: string;
  trustLevel: TrustLevel | null;
  /**
   * Writes the review and flips status. Production passes the lifecycle
   * `submitReview` bound to the service client; status is never written here.
   */
  submit: (input: ReviewInput) => Promise<unknown>;
}

export type DecideResult =
  { ok: true; message: string } | { ok: false; error: string };

const VERDICTS: readonly ReviewVerdict[] = [
  "approve",
  "request_changes",
  "reject",
];
const DONE: Record<ReviewVerdict, string> = {
  approve: "Approved and published.",
  request_changes: "Changes requested. It stays in the queue.",
  reject: "Rejected.",
};

/** Authorizes (maintainer only), validates the form, then calls the lifecycle. */
export async function decideReview(
  deps: DecideDeps,
  input: DecideInput,
): Promise<DecideResult> {
  if (!canReviewInUi(deps.trustLevel)) {
    return { ok: false, error: "403: only maintainers can review." };
  }
  const verdict = input.verdict as ReviewVerdict;
  if (!VERDICTS.includes(verdict)) {
    return { ok: false, error: "Pick a verdict." };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (verdict !== "approve" && !reason) {
    return { ok: false, error: "Give the contributor a reason." };
  }
  const subjectType = input.subjectType ?? "scan";
  const checklist = subjectType === "climb" ? CLIMB_CHECKLIST : CHECKLIST;
  if (
    verdict === "approve" &&
    !checklist.every((c) => input.checked.includes(c.id))
  ) {
    return { ok: false, error: "Tick every checklist item before approving." };
  }
  try {
    await deps.submit({
      reviewerId: deps.reviewerId,
      subjectType,
      subjectId: input.subjectId,
      verdict,
      reason: reason || null,
    });
  } catch (err) {
    if (
      err instanceof ReviewNotAllowedError ||
      err instanceof SubjectNotFoundError ||
      err instanceof TransitionConflictError ||
      err instanceof MissingMeshError
    ) {
      return { ok: false, error: err.message };
    }
    throw err; // DB errors etc.: let the error boundary handle them.
  }
  return { ok: true, message: DONE[verdict] };
}

/**
 * Approve and reject take the subject out of the pending queue, so its review
 * page (which loads only pending subjects) would 404 on the next render.
 * Those verdicts send the reviewer back to the queue with a confirmation
 * (`?reviewed=<verdict>`); request_changes stays on the page.
 */
export function reviewRedirect(verdict: unknown): string | null {
  return verdict === "approve" || verdict === "reject"
    ? `/review?reviewed=${verdict}`
    : null;
}

/** Banner text for the queue's `?reviewed=` param; null for anything else. */
export function reviewedBanner(param: unknown): string | null {
  return param === "approve" || param === "reject" ? DONE[param] : null;
}
