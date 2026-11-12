import {
  STAGE_LABELS,
  type FailureHelp,
  type FailureStage,
} from "../annotations/failureHelp";
import type { QcReport } from "../types";

/**
 * What to tell a contributor when uploading a scan or the automated checks
 * (QC) fail (#130). Same rubric and `FailureHelp` shape as saving a climb
 * (`src/lib/annotations/failureHelp.ts`): what happened, which stage, what
 * they can do, next steps. Failures the user can fix are explained only; the
 * rest are logged privately by the server (`./failures.ts`) and carry a
 * reference and a report link. Pure text and data, safe on client and server,
 * so the browser can use it for failures only it sees (a dropped connection).
 */

export type UploadFailureCode =
  // The user can fix these.
  | "session_expired"
  | "unsupported_file"
  | "obj_needs_zip"
  | "empty_file"
  | "file_too_large"
  | "zip_no_mesh"
  | "bad_area_id"
  | "unknown_area"
  | "area_needed"
  | "scan_not_found"
  | "past_upload"
  | "upload_unfinished"
  | "network"
  // Our side: logged.
  | "scan_create_failed"
  | "area_flag_failed"
  | "scan_check_failed"
  | "storage_check_failed"
  | "enqueue_failed";

interface Entry {
  stage: FailureStage;
  userFixable: boolean;
  whatHappened: string;
  whatYouCanDo: string[];
  nextSteps: string[];
}

const NOT_UPLOADED = "Your scan wasn't uploaded";
const OUR_SIDE_STEP = (reference?: string) =>
  reference
    ? `If it keeps happening, report it using the link below. Mention reference ${reference}.`
    : "If it keeps happening, report the problem.";

const ENTRIES: Readonly<Record<UploadFailureCode, Entry>> = {
  session_expired: {
    stage: "session",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: your sign-in expired.`,
    whatYouCanDo: ["Sign in again (a new tab is fine)."],
    nextSteps: ["Come back to the upload page and choose your file again."],
  },
  unsupported_file: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: that file type isn't supported.`,
    whatYouCanDo: [
      "Export the scan as .glb, .gltf or .ply, or as a .zip with an .obj or .gltf and its textures.",
    ],
    nextSteps: ["Choose the exported file and upload it."],
  },
  obj_needs_zip: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: an .obj file on its own is missing its materials and textures.`,
    whatYouCanDo: ["Zip the .obj with its .mtl file and texture images."],
    nextSteps: ["Upload the .zip."],
  },
  empty_file: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: the file is empty.`,
    whatYouCanDo: [
      "Check that the export finished and the file has some size on disk.",
    ],
    nextSteps: ["Export the scan again and upload the new file."],
  },
  file_too_large: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: the file is over the 200 MB limit.`,
    whatYouCanDo: [
      "Reduce the mesh (decimate it) or shrink the texture in your scanning app, then export again.",
    ],
    nextSteps: ["Upload the smaller file."],
  },
  zip_no_mesh: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: the .zip has no .obj or .gltf file inside.`,
    whatYouCanDo: [
      "Zip the mesh file together with its textures. The mesh must be an .obj or .gltf.",
    ],
    nextSteps: ["Upload the new .zip."],
  },
  bad_area_id: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: the OpenBeta area or climb id isn't in the right format.`,
    whatYouCanDo: [
      "Copy the id from the OpenBeta page again, or leave it blank and attach the area later.",
    ],
    nextSteps: ["Press Upload again."],
  },
  unknown_area: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: SandBag doesn't know that OpenBeta area or climb yet.`,
    whatYouCanDo: ["Leave the area blank for now and attach it later."],
    nextSteps: ["Press Upload again."],
  },
  area_needed: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: you marked the area sensitive, but no area was chosen to hide.`,
    whatYouCanDo: ["Add the OpenBeta area id, or untick the sensitive box."],
    nextSteps: ["Press Upload again."],
  },
  scan_not_found: {
    stage: "scan",
    userFixable: true,
    whatHappened: "We couldn't find that scan on your account.",
    whatYouCanDo: ["Start a new upload."],
    nextSteps: ["Go to the upload page and choose your file."],
  },
  past_upload: {
    stage: "upload",
    userFixable: true,
    whatHappened:
      "This scan is already past the upload step, so it can't be uploaded into again.",
    whatYouCanDo: ["Open the scan page to see where it is."],
    nextSteps: ["To send a different file, start a new upload."],
  },
  upload_unfinished: {
    stage: "upload",
    userFixable: true,
    whatHappened: "The upload hasn't finished yet, so it can't be checked.",
    whatYouCanDo: ["Keep the page open until the progress bar completes."],
    nextSteps: ["If it stopped, choose the same file again to resume."],
  },
  network: {
    stage: "upload",
    userFixable: true,
    whatHappened: `${NOT_UPLOADED}: the connection dropped.`,
    whatYouCanDo: ["Check your connection."],
    nextSteps: [
      "Choose the same file again; the upload resumes where it stopped.",
    ],
  },
  scan_create_failed: {
    stage: "database",
    userFixable: false,
    whatHappened: `${NOT_UPLOADED}: something went wrong on our side creating the scan.`,
    whatYouCanDo: ["Press Upload again."],
    nextSteps: [],
  },
  area_flag_failed: {
    stage: "database",
    userFixable: false,
    whatHappened: `${NOT_UPLOADED}: we couldn't record that the area is sensitive, so nothing was uploaded. Your file is safe on your device.`,
    whatYouCanDo: ["Press Upload again."],
    nextSteps: [],
  },
  scan_check_failed: {
    stage: "scan",
    userFixable: false,
    whatHappened:
      "We couldn't check your scan's state: something went wrong on our side.",
    whatYouCanDo: ["Wait a minute, then try again."],
    nextSteps: [],
  },
  storage_check_failed: {
    stage: "upload",
    userFixable: false,
    whatHappened:
      "Your file may have uploaded, but we couldn't confirm it: something went wrong on our side.",
    whatYouCanDo: ["Wait a minute, then try again."],
    nextSteps: [],
  },
  enqueue_failed: {
    stage: "qc",
    userFixable: false,
    whatHappened:
      "Your file uploaded, but we couldn't queue it for the automated checks.",
    whatYouCanDo: [
      "Wait a minute, then try again. The file doesn't need to be uploaded twice.",
    ],
    nextSteps: [],
  },
};

export function isUploadFailureUserFixable(code: UploadFailureCode): boolean {
  return ENTRIES[code].userFixable;
}

/** The stage a code belongs to (the failure log needs it). */
export function uploadFailureStage(code: UploadFailureCode): FailureStage {
  return ENTRIES[code].stage;
}

/** `ref` is for failures the server logged; user-fixable ones never carry it. */
export function uploadFailureHelp(
  code: UploadFailureCode,
  ref?: { reference: string; reportPath: string },
): FailureHelp {
  const e = ENTRIES[code];
  return {
    stage: e.stage,
    stageLabel: STAGE_LABELS[e.stage],
    userFixable: e.userFixable,
    whatHappened: e.whatHappened,
    whatYouCanDo: [...e.whatYouCanDo],
    nextSteps: e.userFixable
      ? [...e.nextSteps]
      : [OUR_SIDE_STEP(ref?.reference)],
    ...(ref && !e.userFixable
      ? { reference: ref.reference, reportPath: ref.reportPath }
      : {}),
  };
}

/** QC check id the worker uses when the failure was ours, not the file's. */
export const QC_PIPELINE_ERROR = "pipeline_error";

/**
 * The help for a scan that failed its automated checks, from its public
 * `qc_report`. Null when no check blocked it. A `pipeline_error` is ours: it
 * is explained as such and carries `ref` when the worker logged it. Otherwise
 * each blocking check's own message (already written as what to fix) is the
 * advice.
 */
export function qcFailureHelp(
  report: QcReport | null | undefined,
  ref?: { reference: string; reportPath: string },
): FailureHelp | null {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const blocking = checks.filter((c) => !c.pass && c.severity === "error");
  if (blocking.length === 0) return null;
  const stage: FailureStage = "qc";
  if (blocking.some((c) => c.id === QC_PIPELINE_ERROR)) {
    return {
      stage,
      stageLabel: STAGE_LABELS[stage],
      userFixable: false,
      whatHappened:
        "Something went wrong on our side while checking your scan. It isn't a problem with your file.",
      whatYouCanDo: ["Wait a few minutes, then upload the scan again."],
      nextSteps: [OUR_SIDE_STEP(ref?.reference)],
      ...(ref ? { reference: ref.reference, reportPath: ref.reportPath } : {}),
    };
  }
  const n = blocking.length;
  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    userFixable: true,
    whatHappened: `Your scan didn't pass the automated checks: ${n === 1 ? "1 problem" : `${n} problems`} to fix.`,
    whatYouCanDo: [...new Set(blocking.map((c) => c.message))],
    nextSteps: [
      "Fix the file in your scanning app, then upload the new version from this page.",
    ],
  };
}
