import type { SupabaseClient } from "@supabase/supabase-js";
import type { Climb, ClimbPath, Hold } from "../types";
import { STAGE_LABELS, type FailureHelp } from "./failureHelp";

/**
 * Editing your own pending climb (issue #22): who may, what to load, and what
 * to tell someone who may not. Same `FailureHelp` shape as saving (what
 * happened, which step, what you can do, next steps). `saveClimb` re-checks
 * all of this on the server; this only decides what the page shows.
 */

export type EditDenial = "not_found" | "not_author" | "not_pending";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DENIALS: Readonly<
  Record<
    EditDenial,
    Pick<FailureHelp, "whatHappened" | "whatYouCanDo" | "nextSteps">
  >
> = {
  not_found: {
    whatHappened:
      "You can't edit this climb: it isn't available. It may have been removed, or the link may be wrong.",
    whatYouCanDo: ["Go back to the boulder page and open it again."],
    nextSteps: [
      "To add a new climb, use the annotate page without a climb link.",
    ],
  },
  not_author: {
    whatHappened:
      "You can't edit this climb: only the person who created it can.",
    whatYouCanDo: ["Open a climb you created, or start a new climb."],
    nextSteps: [
      "Your climbs waiting for review are listed on your account page.",
    ],
  },
  not_pending: {
    whatHappened:
      "You can't edit this climb: it isn't waiting for review any more, and only climbs waiting for review can be edited.",
    whatYouCanDo: [
      "If it was published, add a new climb instead. If it was rejected, start a new one.",
    ],
    nextSteps: [
      "A reviewer's note, if there is one, is on your notifications page.",
    ],
  },
};

export function editDeniedHelp(reason: EditDenial): FailureHelp {
  return {
    stage: "access",
    stageLabel: STAGE_LABELS.access,
    userFixable: true,
    ...DENIALS[reason],
  };
}

/** Why `userId` can't edit `climb` on `scanId`, or null when they can. */
export function editDenial(
  climb: Pick<Climb, "scan_id" | "status" | "created_by"> | null,
  scanId: string,
  userId: string,
): EditDenial | null {
  if (!climb || climb.scan_id !== scanId) return "not_found";
  if (climb.created_by !== userId) return "not_author";
  if (climb.status !== "pending_review") return "not_pending";
  return null;
}

export interface EditableClimb {
  climb: Climb;
  holds: Hold[];
  paths: ClimbPath[];
}

export type EditLoad =
  ({ ok: true } & EditableClimb) | { ok: false; help: FailureHelp };

/**
 * Loads a climb with the caller's own session: RLS shows an author their own
 * pending climb, its holds and its paths. A database error is thrown (the page
 * error boundary shows it); everything the user can act on is returned.
 */
export async function loadEditableClimb(
  db: SupabaseClient,
  scanId: string,
  climbId: string,
  userId: string,
): Promise<EditLoad> {
  const denied = (r: EditDenial): EditLoad => ({
    ok: false,
    help: editDeniedHelp(r),
  });
  if (!UUID.test(climbId)) return denied("not_found");
  const { data, error } = await db
    .from("climbs")
    .select(
      "id, scan_id, name, description, proposed_grade, fa_info, status, created_by",
    )
    .eq("id", climbId.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`Could not load the climb: ${error.message}`);
  const climb = data as Climb | null;
  const reason = editDenial(climb, scanId, userId);
  if (reason || !climb) return denied(reason ?? "not_found");

  const [holds, paths] = await Promise.all([
    db.from("holds").select("*").eq("climb_id", climb.id),
    db.from("paths").select("*").eq("climb_id", climb.id),
  ]);
  if (holds.error)
    throw new Error(`Could not load holds: ${holds.error.message}`);
  if (paths.error)
    throw new Error(`Could not load paths: ${paths.error.message}`);
  return {
    ok: true,
    climb,
    holds: (holds.data ?? []) as Hold[],
    paths: (paths.data ?? []) as ClimbPath[],
  };
}

/** Where the author edits `climbId` (links on the account and notification pages). */
export const editPath = (scanId: string, climbId: string) =>
  `/boulder/${scanId}/annotate?climb=${climbId}`;

export interface PendingClimbLink {
  id: string;
  name: string;
  href: string;
}

/** The caller's own climbs that are still waiting for review (RLS: only theirs). */
export async function loadMyPendingClimbs(
  db: SupabaseClient,
  userId: string,
): Promise<PendingClimbLink[]> {
  const { data, error } = await db
    .from("climbs")
    .select("id, name, scan_id")
    .eq("created_by", userId)
    .eq("status", "pending_review")
    .order("name");
  if (error) throw new Error(`Could not load your climbs: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; scan_id: string }[]).map(
    (c) => ({ id: c.id, name: c.name, href: editPath(c.scan_id, c.id) }),
  );
}
