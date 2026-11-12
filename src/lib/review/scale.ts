import {
  ReviewNotAllowedError,
  SubjectNotFoundError,
  TransitionConflictError,
  type SetScaleResult,
} from "@/lib/lifecycle";
import {
  STAGE_LABELS,
  type FailureHelp,
  type FailureStage,
} from "@/lib/annotations/failureHelp";
import { SCALE_FACTOR_MAX, SCALE_FACTOR_MIN, type QcReport } from "@/lib/types";
import { canReviewInUi } from "./queue";
import type { TrustLevel } from "@/lib/types";

/**
 * The maintainer's scale control on the review page (#137). Pure text and
 * data except {@link setScaleFor}, which only calls the injected lifecycle
 * function (`setScanScale`). Failures reuse `FailureHelp` and its rubric: what
 * happened, which step, what to do, next steps.
 */

/** Longest side of the scan in the GLB frame (m), from QC's `scale` check. */
export function longestSideFromQc(
  report: QcReport | null | undefined,
): number | null {
  const check = report?.checks?.find((c) => c.id === "scale");
  const v = check?.data?.longest_m;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Round to 3 significant figures for display ("13.3", "20", "0.0015"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "?";
  return String(Number(n.toPrecision(3)));
}

/** Real size (m) of a scan whose GLB size is `longest`. */
export function realSize(longest: number, factor: number): number {
  return longest * factor;
}

/** The one-line explanation shown beside the field. Plain English, with the worked example. */
export function scaleHelpText(longest: number | null): string {
  if (longest === null) {
    return `Real size = size in the file times this number. Enter ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}. 1 leaves the scan as it is.`;
  }
  const example = 20 / longest;
  const inRange = example >= SCALE_FACTOR_MIN && example <= SCALE_FACTOR_MAX;
  return (
    `This scan is ${formatNumber(longest)} m across. ` +
    (inRange
      ? `If the wall is really about 20 m wide, enter ${formatNumber(example)}. `
      : "") +
    `Enter a number from ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}; 1 leaves the scan as it is.`
  );
}

export type ParsedScale =
  { ok: true; factor: number } | { ok: false; error: string };

/** Parses the form field. Accepts "13.3", "13,3" and surrounding spaces; nothing else. */
export function parseScaleInput(raw: unknown): ParsedScale {
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(text)) {
    return {
      ok: false,
      error: `Enter a number, like 13.3 (from ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}).`,
    };
  }
  const factor = Number(text);
  if (
    !Number.isFinite(factor) ||
    factor < SCALE_FACTOR_MIN ||
    factor > SCALE_FACTOR_MAX
  ) {
    return {
      ok: false,
      error: `The scale must be from ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}. You entered ${text}.`,
    };
  }
  return { ok: true, factor };
}

function help(
  stage: FailureStage,
  whatHappened: string,
  whatYouCanDo: string[],
  nextSteps: string[],
  userFixable = true,
  reference?: { reference: string; reportPath: string },
): FailureHelp {
  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    userFixable,
    whatHappened,
    whatYouCanDo,
    nextSteps,
    ...(reference ?? {}),
  };
}

const NOT_SAVED = "The scale wasn't saved";

export const SCALE_SIGNED_OUT = help(
  "session",
  `${NOT_SAVED}: your sign-in expired.`,
  ["Sign in again (a new tab is fine)."],
  ["Come back to this page and press Set scale again."],
);

export const SCALE_NOT_MAINTAINER = help(
  "access",
  `${NOT_SAVED}: only maintainers can set a scan's scale.`,
  ["If you should be a maintainer, ask an existing maintainer."],
  ["You can still review the scan without changing its scale."],
);

export function invalidScaleHelp(message: string): FailureHelp {
  return help(
    "validation",
    `${NOT_SAVED}: ${message}`,
    [
      `Enter a number from ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}, like 13.3.`,
    ],
    ["Press Set scale again."],
  );
}

/**
 * Help for an error from `setScanScale`. Refusals and conflicts are things the
 * maintainer can act on and need no log. Anything else is ours: the caller logs
 * it and passes the reference.
 */
export function scaleFailureHelp(
  err: unknown,
  ref?: { reference: string; reportPath: string },
): FailureHelp {
  if (err instanceof ReviewNotAllowedError) {
    switch (err.code) {
      case "self_review":
        return help(
          "access",
          `${NOT_SAVED}: this is your own scan, and you can't set the scale of your own scan.`,
          ["Ask another maintainer to set it."],
          ["They can open this page from the review queue."],
        );
      case "not_pending":
        return help(
          "scan",
          `${NOT_SAVED}: this scan isn't waiting for review any more, so its scale is locked.`,
          ["Go back to the review queue."],
          [
            "If the published scale is wrong, ask for the scan to be taken down and uploaded again.",
          ],
        );
      case "not_maintainer":
        return SCALE_NOT_MAINTAINER;
      case "invalid_scale":
      case "invalid_input":
        return invalidScaleHelp(err.message);
      default:
        break;
    }
  }
  if (err instanceof SubjectNotFoundError) {
    return help(
      "scan",
      `${NOT_SAVED}: that scan doesn't exist.`,
      ["Go back to the review queue."],
      ["Open the scan from the queue again."],
    );
  }
  if (err instanceof TransitionConflictError) {
    return help(
      "scan",
      `${NOT_SAVED}: the scan was approved, rejected or changed while you were working on it.`,
      ["Reload this page to see where it is now."],
      ["If it is still waiting for review, press Set scale again."],
    );
  }
  return help(
    "database",
    `${NOT_SAVED}: something went wrong on our side.`,
    ["Wait a minute, then press Set scale again."],
    [
      ref
        ? `If it keeps failing, report it with the reference ${ref.reference}.`
        : "If it keeps failing, report it to the maintainers.",
    ],
    false,
    ref,
  );
}

export type ScaleFormState =
  | { ok: true; message: string; factor: number }
  | { ok: false; help: FailureHelp }
  | null;

export interface SetScaleDeps {
  maintainerId: string;
  trustLevel: TrustLevel | null;
  /** `setScanScale` bound to the service client. */
  set: (input: { scanId: string; factor: number }) => Promise<SetScaleResult>;
  /** Logs an unexpected error and returns its reference, or null if it couldn't be logged. */
  logUnexpected: (
    err: unknown,
  ) => Promise<{ reference: string; reportPath: string } | null>;
}

/** Authorizes, validates, writes, and turns every outcome into form state. */
export async function setScaleFor(
  deps: SetScaleDeps,
  input: { scanId: unknown; factor: unknown },
): Promise<ScaleFormState> {
  if (!canReviewInUi(deps.trustLevel)) {
    return { ok: false, help: SCALE_NOT_MAINTAINER };
  }
  const parsed = parseScaleInput(input.factor);
  if (!parsed.ok) return { ok: false, help: invalidScaleHelp(parsed.error) };
  try {
    await deps.set({
      scanId: String(input.scanId ?? ""),
      factor: parsed.factor,
    });
  } catch (err) {
    const expected =
      err instanceof ReviewNotAllowedError ||
      err instanceof SubjectNotFoundError ||
      err instanceof TransitionConflictError;
    const ref = expected ? null : await deps.logUnexpected(err);
    return { ok: false, help: scaleFailureHelp(err, ref ?? undefined) };
  }
  return {
    ok: true,
    factor: parsed.factor,
    message: `Scale set to ${formatNumber(parsed.factor)}.`,
  };
}
