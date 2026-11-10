import type { LifecycleStatus } from "@/lib/types";

/**
 * Scan/climb lifecycle (PRD §8). The single source of truth for which status
 * changes are legal; nothing else may decide that.
 *
 *   scan:  uploaded → processing → failed_qc | pending_review
 *          pending_review → published | rejected
 *   climb: (created at) pending_review → published | rejected
 *
 * Everything not listed is refused, including no-op self-transitions. Where
 * the PRD is silent (retrying a failed_qc scan in place, taking a published
 * item down, reopening a rejected one) the answer is "not allowed" until the
 * owner decides otherwise. `request_changes` is a review verdict, not a
 * transition: the item stays pending_review (see review.ts).
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
    failed_qc: [],
    pending_review: ["published", "rejected"],
    published: [],
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
          : `${from} is not a state a ${kind} can leave.`),
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
