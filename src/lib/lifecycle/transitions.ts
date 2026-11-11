import type { LifecycleStatus } from "../types";

/**
 * Scan/climb lifecycle (PRD §8). The single source of truth for which status
 * changes are legal; nothing else may decide that.
 *
 *   scan:  uploaded → processing → failed_qc | pending_review
 *          failed_qc → processing          (QC re-run by the pipeline, #16)
 *          pending_review → published | rejected
 *   climb: (created at) pending_review → published | rejected
 *
 * One more edge is deliberately NOT in TRANSITIONS: takedown, published →
 * rejected for scans and climbs, by a maintainer with a reason (owner
 * decision on #20). Only `takeDown` (takedown.ts) can make it, so
 * canTransition / assertTransition / applyTransition / submitReview all
 * refuse it. See TAKEDOWN.
 *
 * Everything else is refused, including no-op self-transitions. `rejected`
 * is final (owner decision, 2026-11-10): there is no reopen; a new upload or
 * a new climb starts over. `request_changes` is a review verdict, not a
 * transition: the item stays pending_review (see review.ts). Contributors
 * never write status (no user role has a grant on the column), so every edge
 * here, the QC re-run included, is server-side only.
 */
export type LifecycleKind = "scan" | "climb";

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
  "uploaded",
  "processing",
  "failed_qc",
  "pending_review",
  "published",
  "rejected",
];

type Table = Record<LifecycleStatus, readonly LifecycleStatus[]>;

export const TRANSITIONS: Readonly<Record<LifecycleKind, Readonly<Table>>> = {
  scan: {
    uploaded: ["processing"],
    processing: ["failed_qc", "pending_review"],
    failed_qc: ["processing"],
    pending_review: ["published", "rejected"],
    published: [],
    // Final. No reopen edge (owner decision, 2026-11-10).
    rejected: [],
  },
  climb: {
    uploaded: [],
    processing: [],
    failed_qc: [],
    pending_review: ["published", "rejected"],
    published: [],
    rejected: [],
  },
};

/**
 * The takedown edge (both kinds). Kept out of TRANSITIONS so general callers
 * can't use it; only takeDown() writes it.
 */
export const TAKEDOWN = { from: "published", to: "rejected" } as const;

/** Status a new row starts in (matches the column defaults in schema v1). */
export const INITIAL_STATUS: Readonly<Record<LifecycleKind, LifecycleStatus>> =
  { scan: "uploaded", climb: "pending_review" };

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransitionError extends LifecycleError {
  constructor(
    readonly kind: LifecycleKind,
    readonly from: string,
    readonly to: string,
  ) {
    const allowed = isStatus(from) ? TRANSITIONS[kind][from] : [];
    super(
      `Invalid ${kind} transition ${from} → ${to}. ` +
        (allowed.length
          ? `From ${from} a ${kind} may only move to: ${allowed.join(", ")}.`
          : `${from} is not a state a ${kind} can leave.`) +
        (from === TAKEDOWN.from && to === TAKEDOWN.to
          ? " Taking down a published item goes through takeDown (maintainers only)."
          : ""),
    );
  }
}

export function isStatus(value: unknown): value is LifecycleStatus {
  return LIFECYCLE_STATUSES.includes(value as LifecycleStatus);
}

export function canTransition(
  kind: LifecycleKind,
  from: LifecycleStatus,
  to: LifecycleStatus,
): boolean {
  return TRANSITIONS[kind][from].includes(to);
}

/** Throws {@link InvalidTransitionError} unless `from → to` is legal for `kind`. */
export function assertTransition(
  kind: LifecycleKind,
  from: string,
  to: string,
): void {
  if (!isStatus(from) || !isStatus(to) || !canTransition(kind, from, to)) {
    throw new InvalidTransitionError(kind, from, to);
  }
}
