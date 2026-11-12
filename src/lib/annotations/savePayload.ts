import { V_GRADES } from "../grades/vScale";
import type { ClimbPath, Hold } from "../types";
import type { AnnotationIssue } from "./validate";

/**
 * Client side of the climb save (issue #22): assembles the `saveClimb`
 * payload from the editor state and turns each failure code into UI
 * instructions. Pure so both are unit-tested. Geometry stays mesh-local.
 */

export interface SaveFormState {
  name: string;
  description: string;
  proposed_grade: string;
  fa_info: string;
}

/**
 * Feet are unordered single points (seq_order null); every other hold is
 * numbered 0..n-1 in sequence order, so the line is built from them only.
 */
function sequencePayload(holds: Hold[]) {
  const seq = holds
    .filter((h) => h.type !== "foot")
    .sort((a, b) => (a.seq_order ?? 0) - (b.seq_order ?? 0));
  const order = new Map(seq.map((h, i) => [h.id, i]));
  return holds.map((h) => ({
    id: h.id,
    position: h.position,
    normal: h.normal,
    face_index: h.face_index,
    type: h.type,
    seq_order: order.get(h.id) ?? null,
  }));
}

export function buildSavePayload(input: {
  scanId: string;
  scanContentHash: string;
  meta: SaveFormState;
  holds: Hold[];
  paths: ClimbPath[];
}) {
  const { meta } = input;
  const fa = meta.fa_info.trim();
  return {
    scanId: input.scanId,
    scanContentHash: input.scanContentHash,
    name: meta.name.trim(),
    description: meta.description.trim(),
    proposedGrade: meta.proposed_grade,
    faInfo: fa === "" ? null : fa,
    holds: sequencePayload(input.holds),
    paths: input.paths.map((p) => ({ kind: p.kind, points: p.points })),
  };
}

/** Client-only check: the grade select must hold a real V grade. */
export function gradeError(grade: string): string | null {
  return V_GRADES.includes(grade) ? null : "Choose a proposed grade.";
}

export interface SaveFailureView {
  message: string;
  /** What the banner should offer besides the message. */
  action: "reload" | "sign-in" | "retry" | null;
  /** Field errors by form field. */
  fields: { name?: string };
  /** Hold ids to point at (select in the sequence list). */
  holdIds: string[];
  issues: AnnotationIssue[];
}

interface Failure {
  code: string;
  message: string;
  issues?: AnnotationIssue[];
}

/**
 * Plain-language text for issues about feet. Feet are optional and unordered,
 * so they never count toward the 3 holds. `foot_in_sequence` comes from the
 * server validator (code not yet in the shared union, hence the string compare).
 */
export function plainIssue(i: AnnotationIssue): AnnotationIssue {
  const code: string = i.code;
  if (code === "foot_in_sequence")
    return {
      ...i,
      message:
        "A foot hold was given a sequence number. Feet are optional single points, not part of the line. Remove it from the sequence and save again.",
    };
  if (code === "too_few_holds")
    return {
      ...i,
      message:
        "Add at least 3 start, hand or finish holds. Foot holds are optional and do not count.",
    };
  return i;
}

export function describeSaveFailure(f: Failure): SaveFailureView {
  const view = (
    message: string,
    action: SaveFailureView["action"],
  ): SaveFailureView => ({
    message,
    action,
    fields: {},
    holdIds: [],
    issues: [],
  });
  switch (f.code) {
    case "signed_out":
      return view("Your session expired. Sign in, then save again.", "sign-in");
    case "stale":
      return view(
        "This scan's mesh changed since you opened it, so your holds no longer match. Reload and place them again.",
        "reload",
      );
    case "not_found":
      return view("That scan or climb is no longer available.", null);
    case "forbidden":
      return view("You can only edit your own pending climbs.", null);
    case "mesh_unavailable":
      return view(
        "Could not read the scan to check your holds. Try again in a moment.",
        "retry",
      );
    case "validation": {
      const issues = (f.issues ?? []).map(plainIssue);
      const name = issues.find(
        (i) => i.code === "name_empty" || i.code === "name_duplicate",
      );
      return {
        message: "Fix the problems below, then save again.",
        action: null,
        fields: name ? { name: name.message } : {},
        holdIds: [
          ...new Set(issues.flatMap((i) => (i.holdId ? [i.holdId] : []))),
        ],
        issues,
      };
    }
    default:
      return view("Something went wrong saving. Try again.", "retry");
  }
}
