import type {
  LifecycleStatus,
  QcCheckResult,
  QcReport,
  Review,
  ScanStatusEvent,
} from "../types";

/** Pure helpers for the contributor's scan page (#17). Safe on server and client. */

export const STATUS_LABEL: Readonly<Record<LifecycleStatus, string>> = {
  uploaded: "Uploaded",
  processing: "Running automated checks",
  failed_qc: "Failed automated checks",
  pending_review: "Waiting for a reviewer",
  published: "Published",
  rejected: "Rejected",
};

export const STATUS_HELP: Readonly<Record<LifecycleStatus, string>> = {
  uploaded: "We have your file and will start the automated checks shortly.",
  processing: "This usually takes a few minutes.",
  failed_qc: "Fix the problems below and upload the scan again.",
  pending_review: "A reviewer will look at it soon.",
  published: "This scan is live.",
  rejected: "A reviewer declined this scan. Their reason is below.",
};

export interface FailureGroups {
  /** Failed `error` checks: these sent the scan to failed_qc. */
  blocking: QcCheckResult[];
  /** Failed `warning`/`info` checks: advisory, the scan still goes to review. */
  advisory: QcCheckResult[];
  passed: QcCheckResult[];
}

export function groupChecks(
  report: QcReport | null | undefined,
): FailureGroups {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  return {
    blocking: checks.filter((c) => !c.pass && c.severity === "error"),
    advisory: checks.filter((c) => !c.pass && c.severity !== "error"),
    passed: checks.filter((c) => c.pass),
  };
}

export interface TimelineStep {
  id: string;
  label: string;
  at: string;
}

/** Oldest first; the creation row (from_status null) reads "Uploaded". */
export function buildTimeline(
  events: readonly ScanStatusEvent[],
): TimelineStep[] {
  return [...events]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => ({
      id: e.id,
      label: STATUS_LABEL[e.to_status],
      at: e.created_at,
    }));
}

/** The reviewer feedback to show: the newest non-approving review. */
export function latestFeedback(reviews: readonly Review[]): Review | null {
  return (
    [...reviews]
      .filter((r) => r.verdict !== "approve")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

export function canRetry(
  status: LifecycleStatus,
  feedback: Review | null,
): boolean {
  return (
    status === "failed_qc" ||
    status === "rejected" ||
    (status === "pending_review" && feedback?.verdict === "request_changes")
  );
}
