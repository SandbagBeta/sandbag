"use server";

import {
  signedOutHelp,
  type FailureHelp,
} from "../../lib/annotations/failureHelp";
import {
  reportFailure,
  type ReportResult,
} from "../../lib/annotations/failureLog";
import {
  rejectPayload,
  saveClimbAnnotations,
  supabaseSaveDeps,
  type SaveResult,
} from "../../lib/annotations/save";
import { parseSaveClimbInput } from "../../lib/annotations/saveInput";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";

export type SaveClimbResult =
  | SaveResult
  | {
      ok: false;
      code: "signed_out";
      message: string;
      help: FailureHelp;
    };

/**
 * Creates a climb with its holds and paths (no `climbId`), or replaces the
 * holds and paths of the caller's own pending climb (`climbId` set). The user
 * always comes from the session cookie, never from the payload. Validation
 * runs server-side against the scan's canonical mesh; see
 * `src/lib/annotations/save.ts` for the result codes. Every failure carries
 * `help` (stage, what happened, what to do, next steps; a reference and
 * `reportPath` when it was logged).
 */
export async function saveClimb(raw: unknown): Promise<SaveClimbResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    const help = signedOutHelp();
    return {
      ok: false,
      code: "signed_out",
      message: help.whatHappened,
      help,
    };
  }
  const deps = supabaseSaveDeps(createServiceClient());
  const parsed = parseSaveClimbInput(raw);
  if (!parsed.ok) return rejectPayload(deps, data.user.id, parsed.issues);
  return saveClimbAnnotations(deps, data.user.id, parsed.input);
}

/**
 * The user adds a note to a failure they hit, by its reference (the
 * `help.reference` of a failed save). Only the user the failure happened to can.
 */
export async function reportSaveFailure(
  reference: string,
  note: string,
): Promise<ReportResult | { ok: false; code: "signed_out"; message: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return {
      ok: false,
      code: "signed_out",
      message: "Sign in to report a problem, then try again.",
    };
  }
  return reportFailure(
    createServiceClient(),
    data.user.id,
    String(reference),
    String(note),
  );
}
