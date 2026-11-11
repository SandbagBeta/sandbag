import { LifecycleError, type LifecycleKind } from "./transitions";

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

/** A transition's column patch is not allowed (unknown key, bad value, climb patch). */
export class InvalidPatchError extends LifecycleError {}

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
