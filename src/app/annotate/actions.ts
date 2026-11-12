"use server";

import { parseSaveClimbInput } from "../../lib/annotations/saveInput";
import {
  saveClimbAnnotations,
  supabaseSaveDeps,
  type SaveResult,
} from "../../lib/annotations/save";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";

export type SaveClimbResult =
  SaveResult | { ok: false; code: "signed_out"; message: string };

/**
 * Creates a climb with its holds and paths (no `climbId`), or replaces the
 * holds and paths of the caller's own pending climb (`climbId` set). The user
 * always comes from the session cookie, never from the payload. Validation
 * runs server-side against the scan's canonical mesh; see
 * `src/lib/annotations/save.ts` for the result codes.
 */
export async function saveClimb(raw: unknown): Promise<SaveClimbResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return {
      ok: false,
      code: "signed_out",
      message: "Your session expired. Sign in again.",
    };
  }
  const parsed = parseSaveClimbInput(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "validation",
      message: parsed.issues.map((i) => i.message).join(" "),
      issues: parsed.issues,
    };
  }
  return saveClimbAnnotations(
    supabaseSaveDeps(createServiceClient()),
    data.user.id,
    parsed.input,
  );
}
