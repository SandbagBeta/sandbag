import type { LifecycleStatus, Review } from "../types";

/** Pure step-tracker mapping for the account dashboard. Safe on server and client. */

export type StepState = "done" | "current" | "upcoming" | "problem";

export interface TrackerStep {
  id: "uploaded" | "checking" | "review" | "published";
  label: string;
  state: StepState;
}

const BASE: ReadonlyArray<Pick<TrackerStep, "id" | "label">> = [
  { id: "uploaded", label: "Uploaded" },
  { id: "checking", label: "Checking" },
  { id: "review", label: "Waiting for review" },
  { id: "published", label: "Published" },
];

/** Index of the step a status sits on, and whether that step is a dead end. */
function position(
  status: LifecycleStatus,
  changesRequested: boolean,
): { at: number; problem: string | null } {
  switch (status) {
    case "uploaded":
      return { at: 0, problem: null };
    case "processing":
      return { at: 1, problem: null };
    case "failed_qc":
      return { at: 1, problem: "Failed checks" };
    case "pending_review":
      return {
        at: 2,
        problem: changesRequested ? "Changes requested" : null,
      };
    case "rejected":
      return { at: 2, problem: "Rejected" };
    case "published":
      return { at: 4, problem: null };
  }
}

export function trackerSteps(
  status: LifecycleStatus,
  feedback: Pick<Review, "verdict"> | null = null,
): TrackerStep[] {
  const { at, problem } = position(
    status,
    feedback?.verdict === "request_changes",
  );
  return BASE.map((s, i) => {
    if (i < at) return { ...s, state: "done" };
    if (i > at) return { ...s, state: "upcoming" };
    return problem
      ? { ...s, label: problem, state: "problem" }
      : { ...s, state: "current" };
  });
}

/** Statuses that still change by themselves, so the dashboard refreshes. */
export const isInFlight = (status: LifecycleStatus) =>
  status === "uploaded" || status === "processing";
