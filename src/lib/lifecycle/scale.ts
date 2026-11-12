import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCALE_FACTOR_MAX,
  SCALE_FACTOR_MIN,
  type LifecycleStatus,
} from "../types";
import { LifecycleDbError, TransitionConflictError } from "./errors";
import { readOne, UUID } from "./internal";
import { refuse, SubjectNotFoundError } from "./review";

/**
 * SERVER ONLY (service-role client). A maintainer sets a scan's reviewed scale
 * (#134) while it waits for review. The write is one compare-and-set on
 * `status = pending_review`, so it can't land on a scan that was published or
 * rejected in the meantime. It never touches `status`, the GLB or its hash.
 * Refusals use `ReviewNotAllowedError` (same codes as the review flow).
 */
export interface SetScaleInput {
  maintainerId: string;
  scanId: string;
  /** Real size = size in the GLB * factor. */
  factor: number;
}

export interface SetScaleResult {
  scale_factor: number;
  scale_set_by: string;
  scale_set_at: string;
}

export async function setScanScale(
  db: SupabaseClient,
  input: SetScaleInput,
): Promise<SetScaleResult> {
  const { maintainerId, scanId, factor } = input;
  if (!UUID.test(maintainerId))
    refuse("invalid_input", "Invalid maintainer id.");
  if (!UUID.test(scanId)) throw new SubjectNotFoundError("scan", scanId);
  if (
    typeof factor !== "number" ||
    !Number.isFinite(factor) ||
    factor < SCALE_FACTOR_MIN ||
    factor > SCALE_FACTOR_MAX
  ) {
    refuse(
      "invalid_scale",
      `The scale factor must be a number from ${SCALE_FACTOR_MIN} to ${SCALE_FACTOR_MAX}.`,
    );
  }

  const profile = await readOne<{ trust_level: string }>(
    db,
    "profiles",
    "trust_level",
    "id",
    maintainerId,
  );
  if (profile?.trust_level !== "maintainer") {
    refuse("not_maintainer", "Only maintainers can set a scan's scale.");
  }
  const scan = await readOne<{
    status: LifecycleStatus;
    uploader_id: string | null;
  }>(db, "scans", "status, uploader_id", "id", scanId);
  if (!scan) throw new SubjectNotFoundError("scan", scanId);
  if (scan.uploader_id === maintainerId) {
    refuse("self_review", "You can't set the scale of your own scan.");
  }
  if (scan.status !== "pending_review") {
    refuse(
      "not_pending",
      `Scan ${scanId} is ${scan.status}; its scale can only be set while it is pending review.`,
    );
  }

  const values = {
    scale_factor: factor,
    scale_set_by: maintainerId,
    scale_set_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("scans")
    .update(values)
    .eq("id", scanId)
    .eq("status", "pending_review")
    .select("id");
  if (error)
    throw new LifecycleDbError(`setting scale of scan ${scanId}`, error);
  if (!data || data.length === 0) {
    throw new TransitionConflictError("scan", scanId, "pending_review");
  }
  return values;
}
