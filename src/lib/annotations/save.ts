import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCanonicalSurface, MeshUnavailableError } from "./loadSurface";
import type { SaveClimbInput } from "./saveInput";
import {
  validateClimbAnnotations,
  type AnnotationIssue,
  type MeshSurface,
} from "./validate";

/**
 * SERVER ONLY. Validates a climb submission against the scan's canonical mesh,
 * then writes it through the service-role RPCs from migration
 * `20261112000500_annotation_rpcs.sql` (issue #22). The caller has already
 * authenticated the user: `userId` must come from the session, never the body.
 */

export type SaveFailure =
  /** The payload or the annotations are wrong; `issues` say what to fix. */
  | {
      ok: false;
      code: "validation";
      message: string;
      issues: AnnotationIssue[];
    }
  | { ok: false; code: "not_found"; message: string }
  | { ok: false; code: "forbidden"; message: string }
  /** The scan's mesh changed, or isn't published: reload and re-place holds. */
  | { ok: false; code: "stale"; message: string }
  /** Could not read the mesh; try again later. */
  | { ok: false; code: "mesh_unavailable"; message: string }
  | { ok: false; code: "error"; message: string };

export type SaveResult = { ok: true; climbId: string } | SaveFailure;

interface ScanRow {
  id: string;
  status: string;
  content_hash: string | null;
  glb_path: string | null;
}
interface ClimbRow {
  id: string;
  scan_id: string;
  name: string;
  created_by: string | null;
  status: string;
}

export interface SaveDeps {
  loadScan(id: string): Promise<ScanRow | null>;
  /** Every climb on the scan, any status. */
  listClimbs(scanId: string): Promise<{ id: string; name: string }[]>;
  loadClimb(id: string): Promise<ClimbRow | null>;
  loadSurface(ref: {
    content_hash: string;
    glb_path: string;
  }): Promise<MeshSurface>;
  rpc(
    fn: "create_climb_annotations" | "replace_climb_annotations",
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
}

export function supabaseSaveDeps(db: SupabaseClient): SaveDeps {
  return {
    async loadScan(id) {
      const { data } = await db
        .from("scans")
        .select("id, status, content_hash, glb_path")
        .eq("id", id)
        .maybeSingle();
      return (data as ScanRow | null) ?? null;
    },
    async listClimbs(scanId) {
      const { data } = await db
        .from("climbs")
        .select("id, name")
        .eq("scan_id", scanId);
      return (data as { id: string; name: string }[] | null) ?? [];
    },
    async loadClimb(id) {
      const { data } = await db
        .from("climbs")
        .select("id, scan_id, name, created_by, status")
        .eq("id", id)
        .maybeSingle();
      return (data as ClimbRow | null) ?? null;
    },
    loadSurface: (ref) => loadCanonicalSurface(db, ref),
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error };
    },
  };
}

const fail = (
  code: Exclude<SaveFailure["code"], "validation">,
  message: string,
): SaveFailure => ({
  ok: false,
  code,
  message,
});

const STALE_MESSAGE =
  "This scan's mesh changed since you placed these holds. Reload and place them again.";

/** Maps a database function error to a failure the client can act on. */
export function mapRpcError(error: {
  code?: string;
  message: string;
}): SaveFailure {
  if (error.code === "23505") {
    return {
      ok: false,
      code: "validation",
      message: "A climb with that name already exists on this scan.",
      issues: [
        {
          code: "name_duplicate",
          message: "A climb with that name already exists on this scan.",
        },
      ],
    };
  }
  if (error.code === "42501")
    return fail("forbidden", "You can't edit this climb.");
  if (error.code === "23514") {
    if (/hash_mismatch|scan_not_published/.test(error.message))
      return fail("stale", STALE_MESSAGE);
    if (/not_pending/.test(error.message))
      return fail("forbidden", "Only climbs waiting for review can be edited.");
    // too_few_holds, start_holds_count, duplicate_path_kind: the validator
    // catches these first; reaching here means the two drifted.
    return fail(
      "error",
      "The annotations were rejected. Check the holds and lines and try again.",
    );
  }
  return fail("error", "Saving failed. Try again.");
}

function validationFailure(issues: AnnotationIssue[]): SaveFailure {
  return {
    ok: false,
    code: "validation",
    message: issues.map((i) => i.message).join(" "),
    issues,
  };
}

export async function saveClimbAnnotations(
  deps: SaveDeps,
  userId: string,
  input: SaveClimbInput,
): Promise<SaveResult> {
  const scan = await deps.loadScan(input.scanId);
  if (
    !scan ||
    scan.status !== "published" ||
    !scan.content_hash ||
    !scan.glb_path
  ) {
    return fail("not_found", "That scan isn't available.");
  }
  if (scan.content_hash !== input.scanContentHash)
    return fail("stale", STALE_MESSAGE);

  let name = input.name;
  let climb: ClimbRow | null = null;
  if (input.climbId) {
    climb = await deps.loadClimb(input.climbId);
    if (!climb || climb.scan_id !== scan.id)
      return fail("not_found", "That climb isn't available.");
    if (climb.created_by !== userId)
      return fail("forbidden", "You can't edit this climb.");
    if (climb.status !== "pending_review") {
      return fail("forbidden", "Only climbs waiting for review can be edited.");
    }
    name = climb.name; // replace keeps the name; the validator needs a valid one
  }

  let mesh: MeshSurface;
  try {
    mesh = await deps.loadSurface({
      content_hash: scan.content_hash,
      glb_path: scan.glb_path,
    });
  } catch (err) {
    if (err instanceof MeshUnavailableError)
      return fail(
        "mesh_unavailable",
        "The scan's mesh couldn't be loaded. Try again later.",
      );
    throw err;
  }

  const others = (await deps.listClimbs(scan.id)).filter(
    (c) => c.id !== climb?.id,
  );
  const issues = validateClimbAnnotations(
    {
      name,
      holds: input.holds.map((h) => ({
        id: h.id,
        scan_content_hash: input.scanContentHash,
        position: h.position,
        face_index: h.face_index,
        type: h.type,
        seq_order: h.seq_order,
      })),
    },
    {
      scanContentHash: scan.content_hash,
      mesh,
      existingNames: others.map((c) => c.name),
    },
  );
  if (issues.length) return validationFailure(issues);

  const holds = input.holds.map((h) => ({
    position: h.position,
    normal: h.normal,
    face_index: h.face_index,
    type: h.type,
    seq_order: h.seq_order,
  }));
  const paths = input.paths.map((p) => ({ kind: p.kind, points: p.points }));

  if (climb) {
    const { error } = await deps.rpc("replace_climb_annotations", {
      p_user_id: userId,
      p_climb_id: climb.id,
      p_scan_content_hash: input.scanContentHash,
      p_holds: holds,
      p_paths: paths,
    });
    return error ? mapRpcError(error) : { ok: true, climbId: climb.id };
  }
  const { data, error } = await deps.rpc("create_climb_annotations", {
    p_user_id: userId,
    p_scan_id: scan.id,
    p_scan_content_hash: input.scanContentHash,
    p_name: input.name,
    p_description: input.description,
    p_proposed_grade: input.proposedGrade,
    p_fa_info: input.faInfo,
    p_holds: holds,
    p_paths: paths,
  });
  if (error) return mapRpcError(error);
  if (typeof data !== "string")
    return fail("error", "Saving failed. Try again.");
  return { ok: true, climbId: data };
}
