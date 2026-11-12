import {
  STAGE_LABELS,
  type FailureHelp,
  type FailureStage,
} from "../annotations/failureHelp";

/**
 * What to tell a user when a grade vote isn't saved (#141): what happened,
 * which step, what they can do, next steps. Same `FailureHelp` shape as saving
 * a climb and uploading a scan. Failures the user can fix are explained only;
 * a server error carries a reference and report link when it was logged.
 * Pure text and data, safe on client and server.
 */
export type VoteFailureCode =
  "signed_out" | "unknown_climb" | "not_published" | "invalid_grade" | "error";

export type VoteOutcome = { ok: true } | { ok: false; help: FailureHelp };

interface Entry {
  stage: FailureStage;
  stageLabel: string;
  userFixable: boolean;
  whatHappened: string;
  whatYouCanDo: string[];
  nextSteps: string[];
}

const NOT_SAVED = "Your vote wasn't saved";

const ENTRIES: Readonly<Record<VoteFailureCode, Entry>> = {
  signed_out: {
    stage: "session",
    stageLabel: STAGE_LABELS.session,
    userFixable: true,
    whatHappened: `${NOT_SAVED}: you're not signed in, or your sign-in expired.`,
    whatYouCanDo: ["Sign in again (a new tab is fine)."],
    nextSteps: ["Come back to this page and pick your grade again."],
  },
  unknown_climb: {
    stage: "access",
    stageLabel: "Finding the climb",
    userFixable: true,
    whatHappened: `${NOT_SAVED}: that climb isn't available. It may have been removed.`,
    whatYouCanDo: ["Go back to the boulder page and open the climb again."],
    nextSteps: ["If it's gone, there's nothing to vote on."],
  },
  not_published: {
    stage: "access",
    stageLabel: "Checking the climb is open for votes",
    userFixable: true,
    whatHappened: `${NOT_SAVED}: this climb isn't published, and only published climbs can be graded.`,
    whatYouCanDo: ["Wait until a reviewer publishes it."],
    nextSteps: ["Come back to vote once it appears on the boulder page."],
  },
  invalid_grade: {
    stage: "payload",
    stageLabel: STAGE_LABELS.payload,
    userFixable: true,
    whatHappened: `${NOT_SAVED}: that isn't a V-scale grade (VB to V17).`,
    whatYouCanDo: ["Pick a grade from the list."],
    nextSteps: [],
  },
  error: {
    stage: "database",
    stageLabel: "Saving your vote",
    userFixable: false,
    whatHappened: `${NOT_SAVED}: something went wrong on our side.`,
    whatYouCanDo: ["Pick your grade again."],
    nextSteps: [],
  },
};

export function isVoteFailureUserFixable(code: VoteFailureCode): boolean {
  return ENTRIES[code].userFixable;
}

export function voteFailureHelp(
  code: VoteFailureCode,
  ref?: { reference: string; reportPath: string },
): FailureHelp {
  const e = ENTRIES[code];
  const nextSteps = e.userFixable
    ? [...e.nextSteps]
    : [
        ref
          ? `If it keeps happening, report it using the link below. Mention reference ${ref.reference}.`
          : "If it keeps happening, report the problem.",
      ];
  return {
    stage: e.stage,
    stageLabel: e.stageLabel,
    userFixable: e.userFixable,
    whatHappened: e.whatHappened,
    whatYouCanDo: [...e.whatYouCanDo],
    nextSteps,
    ...(ref && !e.userFixable
      ? { reference: ref.reference, reportPath: ref.reportPath }
      : {}),
  };
}
