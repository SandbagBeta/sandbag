import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecycleStatus } from "@/lib/types";
import {
  assertTransition,
  LifecycleError,
  type LifecycleKind,
} from "./transitions";

/**
 * SERVER ONLY. Applies a status transition with the service-role client, as
 * compare-and-set. This file and review.ts are the only places allowed to
 * write `status` on scans or climbs (enforced by status-guard.test.ts; the
 * column grant in the RLS migration is the DB-level backstop).
 */

export const TABLE: Readonly<Record<LifecycleKind, "scans" | "climbs">> = {
  scan: "scans",
  climb: "climbs",
};

/** Another writer changed the row first (or it vanished); nothing was written. */
export class TransitionConflictError extends LifecycleError {
  constructor(
    readonly kind: LifecycleKind,
    readonly id: string,
    readonly expected: string,
  ) {
    super(
      `Conflict: ${kind} ${id} is no longer ${expected} (another writer moved it, or it was deleted). Re-read and retry.`,
    );
  }
}

/** Publishing a scan needs its canonical GLB (constraint scans_published_has_mesh). */
export class MissingMeshError extends LifecycleError {
  constructor(readonly scanId: string) {
    super(
      `Cannot publish scan ${scanId}: it has no glb_path and content_hash yet. QC must produce the canonical GLB first.`,
    );
  }
}

/** A Supabase call failed; wraps the PostgREST error so callers get one type. */
export class LifecycleDbError extends LifecycleError {
  constructor(
    action: string,
    readonly dbError: unknown,
  ) {
    const msg =
      dbError && typeof dbError === "object" && "message" in dbError
        ? String(dbError.message)
        : String(dbError);
    super(`Database error while ${action}: ${msg}`);
  }
}

export function assertPublishable(scan: {
  id: string;
  glb_path: string | null;
  content_hash: string | null;
}): void {
  if (!scan.glb_path || !scan.content_hash) throw new MissingMeshError(scan.id);
}

export interface TransitionRequest {
  kind: LifecycleKind;
  id: string;
  from: LifecycleStatus;
  to: LifecycleStatus;
}

/**
 * `update <table> set status = to where id = ? and status = from`.
 * Throws InvalidTransitionError (before any DB call), MissingMeshError,
 * TransitionConflictError (zero rows matched) or LifecycleDbError.
 */
export async function applyTransition(
  db: SupabaseClient,
  { kind, id, from, to }: TransitionRequest,
): Promise<void> {
  assertTransition(kind, from, to);

  if (kind === "scan" && to === "published") {
    const { data, error } = await db
      .from("scans")
      .select("id, glb_path, content_hash")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new LifecycleDbError(`reading scan ${id}`, error);
    if (!data) throw new TransitionConflictError(kind, id, from);
    assertPublishable(data);
  }

  const { data, error } = await db
    .from(TABLE[kind])
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) throw new LifecycleDbError(`moving ${kind} ${id} to ${to}`, error);
  if (!data || data.length === 0) {
    throw new TransitionConflictError(kind, id, from);
  }
}
