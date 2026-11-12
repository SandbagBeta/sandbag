import type { AnnotationIssue, AnnotationIssueCode } from "./validate";

/**
 * What to tell the user when saving a climb fails (product decision,
 * 2026-11-12): why it failed, which part of the pipeline failed, what they can
 * do, and the next steps. Failures the user can fix are explained and nothing
 * more. Failures they can't are logged privately by the server and the user
 * gets a reference and a link to report them. Pure text and data: no I/O.
 */

/** The part of the save pipeline that failed. */
export type FailureStage =
  | "session"
  | "payload"
  | "scan"
  | "mesh"
  | "validation"
  | "access"
  | "database"
  | "unknown";

export const STAGE_LABELS: Readonly<Record<FailureStage, string>> = {
  session: "Checking you're signed in",
  payload: "Reading your annotation",
  scan: "Finding the scan",
  mesh: "Reading the 3D model",
  validation: "Checking your holds and lines",
  access: "Checking you can edit this climb",
  database: "Saving to the database",
  unknown: "Saving your climb",
};

export type FailureCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "stale"
  | "mesh_unavailable"
  | "error";

/** A failure before the user-facing help is attached. */
export interface RawFailure {
  code: FailureCode;
  stage: FailureStage;
  /** Short plain statement of what went wrong. */
  message: string;
  issues?: AnnotationIssue[];
  /** Provider or exception text for the private log. Never shown to the user. */
  detail?: string;
}

export interface FailureHelp {
  stage: FailureStage;
  stageLabel: string;
  /** True when the user can fix it. False failures are logged and have a reference. */
  userFixable: boolean;
  whatHappened: string;
  whatYouCanDo: string[];
  nextSteps: string[];
  /** Present only when the failure was logged (not user-fixable). */
  reference?: string;
  /** Relative link where the user can report it; present with `reference`. */
  reportPath?: string;
}

/** What to do about each validator problem, in the user's terms. */
export const ISSUE_HINTS: Readonly<Record<AnnotationIssueCode, string>> = {
  name_empty: "Give the climb a name.",
  name_duplicate:
    "Pick a different name: another climb on this boulder already uses it.",
  start_holds_count: "Mark 1 or 2 holds as start holds.",
  too_few_holds:
    "Add more start, hand or finish holds (foot holds don't count).",
  duplicate_hold_id: "Delete the duplicated hold and place it again.",
  hash_mismatch: "Place the highlighted holds again on the current model.",
  face_out_of_range: "Delete the highlighted hold and place it again.",
  off_surface:
    "Move the highlighted hold onto the rock surface, or delete it and place it again.",
  bad_sequence: "Put the holds back in order in the sequence list.",
  foot_in_sequence:
    "Take the foot hold out of the sequence: foot holds have no order.",
  bad_payload: "Check the highlighted field and correct it.",
};

/** Whether the user can fix this failure themselves. */
export function isUserFixable(raw: RawFailure): boolean {
  if (raw.code === "stale") return true;
  if (raw.code !== "validation") return false;
  return (raw.issues ?? []).every(
    (i) => i.code !== "bad_payload" || i.field !== undefined,
  );
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

export function buildHelp(
  raw: RawFailure,
  ref?: { reference: string; reportPath: string },
): FailureHelp {
  const userFixable = isUserFixable(raw);
  let whatYouCanDo: string[] = [];
  let nextSteps: string[] = [];
  let whatHappened = raw.message;

  switch (raw.code) {
    case "validation": {
      const issues = raw.issues ?? [];
      whatHappened = userFixable
        ? `Your climb wasn't saved: ${issues.length === 1 ? "1 thing needs" : `${issues.length} things need`} fixing first.`
        : "Your climb wasn't saved because the app sent something the server couldn't read.";
      whatYouCanDo = userFixable
        ? unique(issues.map((i) => ISSUE_HINTS[i.code]))
        : ["Reload the page and try saving again."];
      nextSteps = userFixable
        ? ["Fix the highlighted items, then press Save again."]
        : [];
      break;
    }
    case "stale":
      whatHappened =
        "Your climb wasn't saved: the 3D model changed after you placed these holds, so they no longer line up.";
      whatYouCanDo = [
        "Reload this page to get the latest model.",
        "Place your holds again on the new model.",
      ];
      nextSteps = ["Press Save once the holds are placed."];
      break;
    case "not_found":
      whatHappened =
        "Your climb wasn't saved: that scan or climb isn't available. It may have been removed or not published yet.";
      whatYouCanDo = ["Go back to the boulder page and open it again."];
      break;
    case "forbidden":
      whatHappened =
        "Your climb wasn't saved: you can't edit this climb. Only its author can, and only while it waits for review.";
      whatYouCanDo = [
        "Go back and open a climb you created, or start a new climb.",
      ];
      break;
    case "mesh_unavailable":
      whatHappened =
        "Your climb wasn't saved: we couldn't read this scan's 3D model, so your holds couldn't be checked.";
      whatYouCanDo = ["Wait a minute, then press Save again."];
      break;
    case "error":
      whatHappened =
        "Your climb wasn't saved: something went wrong on our side.";
      whatYouCanDo = ["Press Save again."];
      break;
  }

  if (!userFixable) {
    nextSteps = ref
      ? [
          `If it keeps happening, report it using the link below. Mention reference ${ref.reference}.`,
        ]
      : ["If it keeps happening, report the problem."];
  }

  return {
    stage: raw.stage,
    stageLabel: STAGE_LABELS[raw.stage],
    userFixable,
    whatHappened,
    whatYouCanDo,
    nextSteps,
    ...(ref && !userFixable
      ? { reference: ref.reference, reportPath: ref.reportPath }
      : {}),
  };
}

/** The sign-in expired. The user can fix it; nothing is logged. */
export function signedOutHelp(): FailureHelp {
  return {
    stage: "session",
    stageLabel: STAGE_LABELS.session,
    userFixable: true,
    whatHappened: "Your climb wasn't saved: your sign-in expired.",
    whatYouCanDo: ["Sign in again (a new tab is fine)."],
    nextSteps: ["Come back to this page and press Save again."],
  };
}
